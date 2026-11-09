"""Running child processes with bounded output and time."""

import os
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Callable, List, Optional, Tuple

from .background import RUNS, BackgroundRun, handover_report
from .jobs import CANCELLED_MESSAGE, current_job, stop_process
from .limits import (BACKGROUND_MAX_SECONDS, COMMAND_OUTPUT_CHARS, COMMAND_TIMEOUT_SECONDS, FOREGROUND_SECONDS, MAX_OUTPUT_CHARS,
                     STREAM_MAX_CHARS, STREAM_MAX_CHUNKS)
from .outputs import CACHE
from .preview import is_long, preview

# One live message never carries more than this (the WebSocket and the page stay small).
CHUNK_MESSAGE_CHARS = 16_000
# Live output is reported at most this often; lines that arrive together travel together.
FLUSH_SECONDS = 0.05
FLUSH_CHARS = 4_000
# The runner must look at poll()/cancel() this often; a quiet command must not freeze Stop.
POLL_SECONDS = 0.1
# After the process is gone: how long to wait for a last line, and how many quiet rounds end the drain.
DRAIN_SECONDS = 0.1
DRAIN_QUIET_ROUNDS = 3

# on_chunk(stream, text): stream is "stdout" or "stderr". Must never raise into the runner (it is wrapped anyway).
ChunkCallback = Callable[[str, str], None]

_EVENT = Tuple[str, str]


def clamp_chars(requested: Optional[int], default: int = COMMAND_OUTPUT_CHARS) -> int:
    """The size to keep: what the caller asked for, within sane bounds."""
    if requested is None:
        return default
    return max(1_000, min(int(requested), MAX_OUTPUT_CHARS))


def compact(output: str, limit: int, run_id: str) -> str:
    """Keep the start and the end (errors are usually at the end), say what was left out and how to get it."""
    if len(output) <= limit:
        return output
    head_chars = limit * 2 // 5
    tail_chars = limit - head_chars
    omitted = output[head_chars:len(output) - tail_chars]
    marker = (f"\n... [{len(omitted):,} characters / {omitted.count(chr(10)) + 1:,} lines omitted from the middle; "
              f"full output kept as run_id {run_id}, read it with get_command_output] ...\n")
    return output[:head_chars] + marker + output[len(output) - tail_chars:]


def _without_bundle(paths: str) -> str:
    """`paths` (a colon separated list, as LD_LIBRARY_PATH is) without the folders this program unpacked itself into (`/tmp/_MEIxxxx`, or `sys._MEIPASS`)."""
    bundle = getattr(sys, "_MEIPASS", None)
    # Always ":" (these variables are Unix ones, whatever system the tests run on).
    kept = [entry for entry in paths.split(":") if entry and "/_MEI" not in entry and not (bundle and entry.startswith(bundle))]
    return ":".join(kept)


def child_environment() -> dict:
    """The environment a command should see. The one-file Linux program points LD_LIBRARY_PATH at the libraries bundled inside it;
    a child that inherits that (bash, git, cargo) loads them instead of the system's and dies with `symbol lookup error`. PyInstaller
    keeps the user's own value in `<NAME>_ORIG`: put it back. That value can itself name the unpacked folder of the program that started
    this one (the bridge starts this program again), so those folders are taken out either way."""
    env = dict(os.environ)
    if getattr(sys, "frozen", False):
        for name in ("LD_LIBRARY_PATH", "LD_PRELOAD", "DYLD_LIBRARY_PATH"):
            original = env.pop(f"{name}_ORIG", None)
            value = _without_bundle(original if original is not None else "")
            if value:
                env[name] = value
            else:
                env.pop(name, None)
    return env


def _drain_pipe(pipe, stream: str, events: "queue.Queue[_EVENT]", stop: threading.Event) -> None:
    """Read one pipe to the end, forwarding every line. The reader never blocks the process exit."""
    try:
        for line in iter(pipe.readline, ""):
            if line:
                events.put((stream, line))
            if stop.is_set():
                break
        remainder = pipe.read()
        if remainder:
            events.put((stream, remainder))
    except (OSError, ValueError):
        pass
    finally:
        try:
            pipe.close()
        except (OSError, ValueError):
            pass


class _StreamState:
    """What the runner knows about the live report: how much it sent, and where the full output lives."""

    def __init__(self, display: str) -> None:
        self.display = display
        # Only a watched run reserves a cache slot up front; an unwatched one is stored at the end (if it is big).
        self.run_id: Optional[str] = None
        self.chunks = 0
        self.chars = 0
        self.capped = False
        # Each stream's full text, kept apart so the final answer merges them exactly like before
        # (stdout, then stderr on its own block) no matter how their lines interleaved live.
        self.out_parts: List[str] = []
        self.err_parts: List[str] = []
        # A command that goes on in the background has no final merged text: its output is the live one, as the log has it.
        self.keep_parts = True
        self.log: Optional[Callable[[str], None]] = None

    def keep(self, stream: str, text: str) -> None:
        if self.keep_parts:
            (self.out_parts if stream == "stdout" else self.err_parts).append(text)

    def record(self, text: str) -> None:
        """Add output to the cache (and to the log file once the command is in the background)."""
        CACHE.append(self.ensure_id(), text)
        if self.log is not None:
            self.log(text)

    def ensure_id(self) -> str:
        if self.run_id is None:
            self.run_id = CACHE.begin(self.display)
        return self.run_id

    def emit(self, stream: str, text: str, on_chunk: Optional[ChunkCallback]) -> bool:
        """Forward one batch; False when the callback is gone or the live budget ran out (the full output is still kept)."""
        if on_chunk is None:
            return True
        start = 0
        while start < len(text):
            piece, start = text[start:start + CHUNK_MESSAGE_CHARS], start + CHUNK_MESSAGE_CHARS
            self.chunks += 1
            self.chars += len(piece)
            if self.chunks > STREAM_MAX_CHUNKS or self.chars > STREAM_MAX_CHARS:
                if not self.capped:
                    self.capped = True
                    try:
                        on_chunk(stream, "\n…[live output paused: still running, full output is kept]…\n")
                    except Exception:
                        pass
                return False
            try:
                on_chunk(stream, piece)
            except Exception:
                return False
        return True


def _flush(events: "queue.Queue[_EVENT]", state: _StreamState, on_chunk: Optional[ChunkCallback],
           deadline: float) -> bool:
    """Move queued lines to the callback and the cache, batched by time or size. False when the streams went quiet."""
    pending = {"stdout": [], "stderr": []}
    sizes = {"stdout": 0, "stderr": 0}
    try:
        first = events.get(timeout=max(0.0, deadline - time.monotonic()))
    except queue.Empty:
        return False
    pending[first[0]].append(first[1])
    sizes[first[0]] += len(first[1])
    block_until = time.monotonic() + FLUSH_SECONDS
    while sizes["stdout"] + sizes["stderr"] < FLUSH_CHARS and time.monotonic() < block_until:
        try:
            kind, line = events.get_nowait()
        except queue.Empty:
            break
        pending[kind].append(line)
        sizes[kind] += len(line)
    if pending["stdout"]:
        state.keep("stdout", "".join(pending["stdout"]))
        state.record("".join(pending["stdout"]))
    if pending["stderr"]:
        state.keep("stderr", "".join(pending["stderr"]))
        state.record("[stderr] " + "".join(pending["stderr"]))
    alive = True
    for stream in ("stdout", "stderr"):
        if pending[stream] and not state.emit(stream, "".join(pending[stream]), on_chunk):
            alive = False
    return alive


def _hand_over(display: str, process, readers, events, stop, state: _StreamState, started: float) -> BackgroundRun:
    """The call has to answer but the command is not done: it goes on, and a thread of its own collects what it prints from here."""
    run = RUNS.start(state.ensure_id(), display, process, started)
    state.keep_parts = False  # no final merged text for a command that outlives its call
    state.out_parts.clear()
    state.err_parts.clear()
    entry = CACHE.get(run.run_id)
    run.write_log(str(entry["output"]) if entry else "", append=False)
    state.log = run.write_log
    threading.Thread(target=_finish_in_background, args=(run, readers, events, stop, state), daemon=True, name=f"background-{run.run_id}").start()
    return run


def _finish_in_background(run: BackgroundRun, readers, events, stop, state: _StreamState) -> None:
    """Keep collecting what the command prints after the call that started it has answered, until it ends (or runs too long)."""
    process = run.process
    hard_deadline = run.started + BACKGROUND_MAX_SECONDS
    try:
        while process.poll() is None:
            if time.monotonic() >= hard_deadline:
                run.stop("limit")
                break
            _flush(events, state, None, min(hard_deadline, time.monotonic() + POLL_SECONDS))
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
    finally:
        stop.set()
        for reader in readers:
            reader.join(timeout=2)
        quiet = 0
        while quiet < DRAIN_QUIET_ROUNDS:
            if _flush(events, state, None, time.monotonic() + DRAIN_SECONDS):
                quiet = 0
            else:
                quiet += 1
        CACHE.finish(run.run_id, process.returncode)
        run.finish(process.returncode)


def run_process_streaming(command: List[str], cwd: Path, timeout: int = COMMAND_TIMEOUT_SECONDS,
                          max_output_chars: Optional[int] = None,
                          on_chunk: Optional[ChunkCallback] = None, detach: bool = False) -> str:
    """Run without a shell, reporting each stream's lines while they arrive.

    With `detach`, a command still running when `min(timeout, FOREGROUND_SECONDS)` is up is NOT stopped: it goes on in the background
    (see background.py) and the answer is a report of what it printed so far, with how to follow it. The extension and the bridge stop
    waiting for a call after COMMAND_TIMEOUT_SECONDS, so the call has to answer before that.

    Returns the same merged `stdout + [stderr]` text as `run_process` (and raises the same errors),
    but calls `on_chunk(stream, text)` for each batch of lines while the command runs, so a watcher
    can show it live. The live interleaving in the cache is replaced by the final merged streams at the end.
    """
    job = current_job()
    group = {"start_new_session": True} if os.name != "nt" else {"creationflags": getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)}
    display = " ".join(command)
    state = _StreamState(display)
    started = time.monotonic()
    window = min(timeout, FOREGROUND_SECONDS) if detach else timeout
    deadline = started + window
    process = subprocess.Popen(
        command, cwd=str(cwd), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8",
        errors="replace", shell=False, env=child_environment(), **group,
    )
    if job:
        job.attach(process)
    events: "queue.Queue[_EVENT]" = queue.Queue()
    stop = threading.Event()
    readers = [threading.Thread(target=_drain_pipe, args=(process.stdout, "stdout", events, stop), daemon=True),
               threading.Thread(target=_drain_pipe, args=(process.stderr, "stderr", events, stop), daemon=True)]
    for reader in readers:
        reader.start()
    timed_out = False
    handed_over = False
    try:
        while process.poll() is None:
            if time.monotonic() >= deadline:
                timed_out = True
                break
            if job and job.cancelled:
                break
            # A short wait: long enough to collect a burst, short enough that Stop and the deadline are still seen.
            _flush(events, state, on_chunk, min(deadline, time.monotonic() + POLL_SECONDS))
        if timed_out and detach and not (job and job.cancelled) and RUNS.has_room():
            # The call has to answer and the command is not done: let it go on instead of stopping it.
            while _flush(events, state, on_chunk, time.monotonic()):
                pass
            run = _hand_over(display, process, readers, events, stop, state, started)
            handed_over = True
        elif timed_out or (job and job.cancelled):
            stop_process(process)
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        else:
            try:
                process.wait(timeout=max(0.0, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                stop_process(process)
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                timed_out = True
    finally:
        if handed_over:
            if job:
                job.detach(process)  # a Stop of the job no longer reaches it: stop_command does
        else:
            stop.set()
            for reader in readers:
                reader.join(timeout=2)
            if job:
                job.detach(process)
            # Whatever the readers left behind (they are joined, so nothing more will arrive).
            quiet = 0
            while quiet < DRAIN_QUIET_ROUNDS:
                if _flush(events, state, on_chunk, time.monotonic() + DRAIN_SECONDS):
                    quiet = 0
                else:
                    quiet += 1
    if handed_over:
        text = run.output()
        run.take_new(text)  # what the report shows counts as shown
        return handover_report(run, text, clamp_chars(max_output_chars), window)
    if timed_out:
        if state.run_id is not None:
            CACHE.finish(state.run_id, None)
        raise RuntimeError(
            f"The command was stopped after {window} seconds without finishing. It may still be needed: " +
            ("Too many commands are already running in the background, so it could not go on there: wait for one to finish (wait_command) "
             "or end one (stop_command), then run it again." if detach else
             "run long jobs detached or in smaller steps (for example start a build in the background and check on it).")
        )
    if job and job.cancelled:
        if state.run_id is not None:
            CACHE.finish(state.run_id, None)
        raise RuntimeError(CANCELLED_MESSAGE)
    # The final answer is stdout, then stderr on its own block (a failing build prints why on stderr even when
    # stdout is not empty); strip each side so a trailing newline does not add a blank line.
    stdout_text, stderr_text = "".join(state.out_parts).strip(), "".join(state.err_parts).strip()
    output = (f"{stdout_text}\n[stderr]\n{stderr_text}" if stdout_text and stderr_text
              else (stdout_text or stderr_text or "(no output)"))
    limit = clamp_chars(max_output_chars)
    if state.run_id is not None:
        CACHE.set_output(state.run_id, output)
        CACHE.finish(state.run_id, process.returncode)
    if len(output) > limit or is_long(output):
        run_id = state.run_id or CACHE.store(display, process.returncode, output)
        # The model gets the first and last lines only: a long log is mostly noise, and the whole of it stays one get_command_output away.
        output = preview(output, run_id)
        if len(output) > limit:  # a few enormous lines can still be too much
            output = compact(output, limit, run_id)
    if process.returncode:
        raise RuntimeError(f"Command exited with status {process.returncode}:\n{output}")
    return output


def run_process(command: List[str], cwd: Path, timeout: int = COMMAND_TIMEOUT_SECONDS,
                max_output_chars: Optional[int] = None) -> str:
    """Run without a shell. Returns trimmed output; a non-zero exit becomes a RuntimeError with that output.
    When it runs for a job, the job can stop it (and what it started) at any time."""
    return run_process_streaming(command, cwd, timeout=timeout, max_output_chars=max_output_chars)
