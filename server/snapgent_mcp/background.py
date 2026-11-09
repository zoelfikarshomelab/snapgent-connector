# SPDX-License-Identifier: GPL-3.0-or-later
"""Commands that outlived the call that started them.

A build can take longer than one tool call may wait: the extension and the bridge give up on a call after two minutes. Instead of
stopping the command and calling that a failure, the call answers with what it printed so far, and the command goes on here, in
the background. Its output keeps filling the output cache and a log file in the temporary folder, and later calls ask about it
by its run id (`wait_command`, `get_command_output`, `stop_command`) without running anything again.

The log file's name cannot be guessed and only this user can read it: a name that can be guessed, in a folder everyone can write
to, lets someone else plant a link there and make this program write where it should not."""

import atexit
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, Optional, Tuple

from .jobs import stop_process
from .limits import BACKGROUND_KEPT_SECONDS, BACKGROUND_MAX_SECONDS, MAX_BACKGROUND_RUNS, WAIT_DEFAULT_SECONDS
from .outputs import CACHE


def duration(seconds: float) -> str:
    total = int(round(seconds))
    hours, rest = divmod(total, 3600)
    minutes, secs = divmod(rest, 60)
    if hours:
        return f"{hours} h {minutes} min"
    if minutes:
        return f"{minutes} min {secs} s"
    return f"{secs} s"


def tail(text: str, limit: int) -> Tuple[str, int]:
    """The last `limit` characters of `text` (starting at a line when that costs little), and how many characters came before them."""
    if len(text) <= limit:
        return text, 0
    cut = len(text) - limit
    shown = text[cut:]
    if text[cut - 1] != "\n":  # the cut is inside a line: drop that half line, but only when the next one is near
        newline = shown.find("\n")
        if 0 <= newline < 200:
            shown = shown[newline + 1:]
    return shown, len(text) - len(shown)


class BackgroundRun:
    def __init__(self, run_id: str, display: str, process: Any, started: float, log_path: Path,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.run_id = run_id
        self.display = display
        self.process = process
        self.started = started
        self.log_path = log_path
        self.exit_code: Optional[int] = None
        self.finished: Optional[float] = None
        self.stopped_by: Optional[str] = None  # "user" (stop_command), "limit" (it ran too long) or "exit" (this program ended)
        self._clock = clock
        self._reported = 0
        self._done = threading.Event()
        self._lock = threading.Lock()

    @property
    def running(self) -> bool:
        return not self._done.is_set()

    @property
    def pid(self) -> int:
        return self.process.pid

    @property
    def reported(self) -> int:
        """How many characters of its output the model has been shown."""
        return self._reported

    def elapsed(self) -> float:
        return (self.finished if self.finished is not None else self._clock()) - self.started

    def finish(self, exit_code: Optional[int]) -> None:
        self.exit_code = exit_code
        self.finished = self._clock()
        self._done.set()

    def wait(self, seconds: float) -> bool:
        """True when it has ended (within `seconds`)."""
        return self._done.wait(max(0.0, seconds))

    def stop(self, reason: str) -> None:
        self.stopped_by = self.stopped_by or reason
        stop_process(self.process)

    def write_log(self, text: str, append: bool = True) -> None:
        try:
            with open(self.log_path, "a" if append else "w", encoding="utf-8", errors="replace") as handle:
                handle.write(text)
        except OSError:
            pass  # a log that cannot be written must not end the command

    def output(self) -> str:
        """Everything it printed so far: from the output cache, else from the log file (the cache forgets old runs, the log does not)."""
        entry = CACHE.get(self.run_id)
        if entry is not None:
            return str(entry["output"])
        try:
            return self.log_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ""

    def take_new(self, text: str) -> str:
        """What of `text` the model has not been shown yet; from now on it counts as shown."""
        with self._lock:
            start = min(self._reported, len(text))
            self._reported = len(text)
            return text[start:]


class BackgroundRuns:
    def __init__(self, clock: Callable[[], float] = time.monotonic, kept: float = BACKGROUND_KEPT_SECONDS,
                 max_runs: int = MAX_BACKGROUND_RUNS) -> None:
        self._clock = clock
        self._kept = kept
        self._max = max_runs
        self._runs: Dict[str, BackgroundRun] = {}
        self._lock = threading.Lock()

    def has_room(self) -> bool:
        with self._lock:
            self._expire()
            return sum(1 for run in self._runs.values() if run.running) < self._max

    def start(self, run_id: str, display: str, process: Any, started: float) -> BackgroundRun:
        descriptor, name = tempfile.mkstemp(prefix=f"snapgent-{run_id}-", suffix=".log")  # a random name, readable by this user only
        os.close(descriptor)
        run = BackgroundRun(run_id, display, process, started, Path(name), self._clock)
        with self._lock:
            self._runs[run_id] = run
        return run

    def get(self, run_id: str) -> Optional[BackgroundRun]:
        with self._lock:
            self._expire()
            return self._runs.get(run_id)

    def _expire(self) -> None:
        now = self._clock()
        for run_id in [key for key, run in self._runs.items() if run.finished is not None and now - run.finished > self._kept]:
            self._forget(run_id)

    def _forget(self, run_id: str) -> None:
        run = self._runs.pop(run_id)
        try:
            run.log_path.unlink()
        except OSError:
            pass

    def shutdown(self) -> None:
        """At exit: end what still runs (nobody is left to read it) and remove the log files."""
        with self._lock:
            runs = list(self._runs.values())
            self._runs.clear()
        for run in runs:
            if run.running:
                run.stop("exit")
            try:
                run.log_path.unlink()
            except OSError:
                pass


RUNS = BackgroundRuns()
atexit.register(RUNS.shutdown)


def _commands(run_id: str) -> str:
    return (
        f'  {{"command":"wait_command","params":{{"run_id":"{run_id}"}}}}  waits up to {WAIT_DEFAULT_SECONDS} s for it to finish and returns only the output printed since your last look\n'
        f'  {{"command":"get_command_output","params":{{"run_id":"{run_id}"}}}}  reads any part of the output so far\n'
        f'  {{"command":"stop_command","params":{{"run_id":"{run_id}"}}}}  ends it'
    )


def handover_report(run: BackgroundRun, text: str, limit: int, window: float) -> str:
    """What the call that started the command answers when it had to stop waiting: the end of the output and how to go on from here."""
    shown, omitted = tail(text, limit)
    counted = f"Output so far: {len(text):,} characters"
    counted += f"; the last {len(shown):,} are shown below ({omitted:,} earlier ones left out)." if omitted else "."
    return "\n".join([
        f"⏳ Still running after {duration(window)}. The command was NOT stopped: it goes on in the background.",
        f"`{run.display}`  (run_id {run.run_id}, pid {run.pid})",
        counted,
        "----- output so far -----",
        shown or "(nothing printed yet)",
        "----- end of output so far -----",
        "To follow it without running it again, send one of these:",
        _commands(run.run_id),
        f"Everything it prints is also written to {run.log_path} on the machine where it runs (for the user to follow with tail -f; "
        "you read it with the commands above, not by path). "
        f"It is stopped by itself after {duration(BACKGROUND_MAX_SECONDS)}.",
    ])


def wait_report(run: BackgroundRun, new_text: str, limit: int) -> str:
    """The answer of wait_command. Raises when the command ended badly, so the model sees the failure it is."""
    shown, omitted = tail(new_text, limit)
    body = shown or "(no new output)"
    if omitted:
        body = f"[{omitted:,} earlier characters of the new output left out: get_command_output reads them]\n{body}"
    spent = duration(run.elapsed())
    if run.running:
        return (f"⏳ Still running ({spent} so far, run_id {run.run_id}). Output since your last look:\n{body}\n"
                "Wait again with wait_command, or end it with stop_command.")
    if run.stopped_by == "limit":
        raise RuntimeError(f"The command was stopped after {duration(BACKGROUND_MAX_SECONDS)}, the longest a background command may run. "
                           f"Output since your last look:\n{body}")
    if run.stopped_by in ("user", "exit"):
        return f"Stopped with stop_command after {spent} (run_id {run.run_id}). Output since your last look:\n{body}"
    if run.exit_code:
        raise RuntimeError(f"Command exited with status {run.exit_code} after {spent}:\n{body}")
    return f"✓ Finished with exit code 0 after {spent} (run_id {run.run_id}). Output since your last look:\n{body}"
