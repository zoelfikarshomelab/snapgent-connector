"""Tools that run processes."""

import json
import os
import shutil
import sys
import time
from pathlib import Path
from typing import List, Optional

from ..background import RUNS, BackgroundRun, duration, wait_report
from ..command_line import command_parts
from ..context import Context
from ..limits import (COMMAND_TIMEOUT_SECONDS, MAX_OUTPUT_CHARS, SAFE_PROJECT_SCRIPTS, SCRIPT_TIMEOUT_SECONDS,
                      WAIT_DEFAULT_SECONDS, WAIT_MAX_SECONDS)
from ..outputs import CACHE
from ..paths import find_outside_root, resolve_inside
from ..process import CHUNK_MESSAGE_CHARS, clamp_chars, run_process_streaming
from ..security.commands import unsafe_for_cmd
from .registry import EXECUTE, READ, tool
from .schema import STR, STR_LIST, integer

OUTPUT_CHARS = integer(1_000, MAX_OUTPUT_CHARS)  # how much of the output to keep; the middle is cut beyond it

LOCKFILE_MANAGERS = (("pnpm-lock.yaml", "pnpm"), ("yarn.lock", "yarn"), ("bun.lock", "bun"), ("bun.lockb", "bun"))


def package_manager(root: Path) -> str:
    """npm unless a lockfile says otherwise."""
    for lockfile, manager in LOCKFILE_MANAGERS:
        if (root / lockfile).exists():
            return manager
    return "npm"


def python_interpreter(frozen: bool = getattr(sys, "frozen", False)) -> str:
    """The Python that runs the project's tests. In a packaged .exe `sys.executable` is the .exe itself."""
    if not frozen:
        return sys.executable
    found = shutil.which("python3") or shutil.which("python") or shutil.which("py")
    if not found:
        raise FileNotFoundError("Python was not found on PATH, so pytest cannot be run.")
    return found


def shell_wrap(command: List[str], windows: Optional[bool] = None) -> List[str]:
    """On Windows, npm/pnpm/... are .cmd shims that need cmd.exe, which would run `& other-command`
    smuggled into any argument; refuse such arguments instead of trusting the quoting."""
    if windows is None:
        windows = os.name == "nt"
    if not windows:
        return command
    unsafe = unsafe_for_cmd(command)
    if unsafe:
        raise ValueError(f"Refusing arguments with shell metacharacters on Windows: {unsafe[0][:60]!r}")
    return ["cmd.exe", "/c", *command]


def outside_root_argument(command: str, args: List[str], root: Path) -> Optional[str]:
    """What the command is given that leads out of the root, or None. The program may live anywhere (/usr/bin/python3); only a
    program written as a relative path that climbs out with `..` counts, and every argument is checked."""
    climbs = ".." in command.replace("\\", "/").split("/")
    return find_outside_root(([command] if climbs else []) + list(args), root)


@tool("run_command", "Run a command with the workspace as its working directory.",
      {"command": STR, "args": STR_LIST, "max_output_chars": OUTPUT_CHARS}, ["command"], risk=EXECUTE)
def run_command(ctx: Context, command: str, args: Optional[List[str]] = None, max_output_chars: Optional[int] = None) -> str:
    if not command.strip():
        raise ValueError("Command cannot be empty.")
    # A command line written in one piece ("sleep 5") is split into the program and its arguments.
    parts = command_parts(command, args)
    stray = outside_root_argument(parts[0], parts[1:], ctx.root)
    if stray:
        raise ValueError(f"Refused: '{stray}' points outside the workspace root ({ctx.root}). Use a path inside the root, or choose another folder in the bar. This is a safety check, not a sandbox.")
    return run_process_streaming(shell_wrap(parts), ctx.root, timeout=COMMAND_TIMEOUT_SECONDS, detach=True,
                                 max_output_chars=max_output_chars, on_chunk=ctx.stream)


def resolve_directory(directory, root: Path) -> Path:
    """The directory a script runs in: the workspace root unless `directory` names a folder inside it."""
    if directory is None or str(directory).strip() in ("", "."):
        return root
    target = resolve_inside(str(directory), root)
    if not target.is_dir():
        raise NotADirectoryError(f"Not a directory: {directory}")
    return target


def script_command(script: str, directory: Path) -> List[str]:
    if script not in SAFE_PROJECT_SCRIPTS:
        raise ValueError(f"Script must be one of: {', '.join(sorted(SAFE_PROJECT_SCRIPTS))}.")
    package_path = directory / "package.json"
    if not package_path.is_file():
        raise FileNotFoundError(f"No package.json found in {directory}.")
    try:
        package = json.loads(package_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Could not read package.json: {error}") from error
    if script not in (package.get("scripts") or {}):
        raise ValueError(f"package.json does not define the '{script}' script.")
    return shell_wrap([package_manager(directory), "run", script])


@tool("run_project_script", "Run a named safe script (build, check, format, lint, test, typecheck) from package.json in a directory (default: workspace root).",
      {"script": STR, "directory": STR, "max_output_chars": OUTPUT_CHARS}, ["script"], risk=EXECUTE)
def run_project_script(ctx: Context, script: str, directory: Optional[str] = None, max_output_chars: Optional[int] = None) -> str:
    target = resolve_directory(directory, ctx.root)
    return run_process_streaming(script_command(script, target), target, timeout=SCRIPT_TIMEOUT_SECONDS, detach=True,
                                 max_output_chars=max_output_chars, on_chunk=ctx.stream)


@tool("run_tests", "Run the test script, pytest, unittest, or .NET tests configured in a directory (default: workspace root).",
      {"directory": STR, "max_output_chars": OUTPUT_CHARS}, risk=EXECUTE)
def run_tests(ctx: Context, directory: Optional[str] = None, max_output_chars: Optional[int] = None) -> str:
    target = resolve_directory(directory, ctx.root)
    if (target / "package.json").is_file():
        return run_project_script(ctx, "test", directory=str(target), max_output_chars=max_output_chars)
    if (target / "pyproject.toml").is_file() or (target / "pytest.ini").is_file():
        return run_process_streaming([python_interpreter(), "-m", "pytest"], target, timeout=SCRIPT_TIMEOUT_SECONDS, detach=True,
                                     max_output_chars=max_output_chars, on_chunk=ctx.stream)
    if any(target.glob("test_*.py")) or any((target / "tests").glob("test_*.py")):
        return run_process_streaming([python_interpreter(), "-m", "unittest", "discover"], target, timeout=SCRIPT_TIMEOUT_SECONDS, detach=True,
                                     max_output_chars=max_output_chars, on_chunk=ctx.stream)
    if any(target.glob("*.sln")) or any(target.glob("*.csproj")):
        return run_process_streaming(["dotnet", "test"], target, timeout=SCRIPT_TIMEOUT_SECONDS, detach=True,
                                     max_output_chars=max_output_chars, on_chunk=ctx.stream)
    raise FileNotFoundError(f"No supported test setup found in {target} (package.json, pytest, unittest, or .NET project).")


@tool("get_command_output", "Read more of an earlier command's output that was shortened (its run_id is in the omitted-output note), "
                            "without running the command again. Lines are numbered from 1; use negative start_line to count from the end.",
      {"run_id": STR, "start_line": integer(), "max_lines": integer(1, 5000), "max_chars": OUTPUT_CHARS}, ["run_id"], risk=READ)
def get_command_output(ctx: Context, run_id: str, start_line: int = 1, max_lines: int = 500, max_chars: Optional[int] = None) -> str:
    run = CACHE.get(str(run_id).strip())
    if run is None:
        raise LookupError(f"No saved output for run_id '{run_id}': only the most recent runs are kept. Run the command again if it is still needed.")
    lines = str(run["output"]).splitlines()
    total = len(lines)
    start = max(0, total + int(start_line)) if int(start_line) < 0 else max(0, int(start_line) - 1)
    chosen = lines[start:start + max(1, int(max_lines))]
    body = "\n".join(f"{start + offset + 1}: {line}" for offset, line in enumerate(chosen))
    limit = 40_000 if max_chars is None else max(1_000, min(int(max_chars), MAX_OUTPUT_CHARS))
    if len(body) > limit:
        body = body[:limit] + "\n[cut here: ask for a smaller max_lines or a later start_line]"
    header = f"run_id {run_id}: `{run['command']}` {_exit_note(run)}; lines {start + 1}-{start + len(chosen)} of {total}"
    return f"{header}\n{body}"


def _exit_note(run: dict) -> str:
    code = run["exit_code"]
    return f"exited {code}" if code is not None else "has no exit code (still running, or it was stopped)"


def _background_run(run_id: str) -> BackgroundRun:
    run = RUNS.get(str(run_id).strip())
    if run is None:
        raise LookupError(f"No background command with run_id '{run_id}'. Either it never went on in the background, or it finished a while ago "
                          "and was forgotten (the output of a command that finished is read with get_command_output).")
    return run


def _stream_new(ctx: Context, text: str) -> None:
    """Show new output in the terminal panel while it is waited for (a call nobody watches has no stream)."""
    if ctx.stream is None:
        return
    for start in range(0, len(text), CHUNK_MESSAGE_CHARS):
        ctx.stream("stdout", text[start:start + CHUNK_MESSAGE_CHARS])


@tool("wait_command", "Wait for a command that went on in the background (its run_id is in the note that said so; nothing is started again) and get only "
                      "the output it printed since you were last shown some. "
                      f"Waits up to wait_seconds (default {WAIT_DEFAULT_SECONDS}, at most {WAIT_MAX_SECONDS}) for it to finish.",
      {"run_id": STR, "wait_seconds": integer(1, WAIT_MAX_SECONDS), "max_output_chars": OUTPUT_CHARS}, ["run_id"], risk=READ)
def wait_command(ctx: Context, run_id: str, wait_seconds: Optional[int] = None, max_output_chars: Optional[int] = None) -> str:
    run = _background_run(run_id)
    seconds = WAIT_DEFAULT_SECONDS if wait_seconds is None else max(1, min(int(wait_seconds), WAIT_MAX_SECONDS))
    deadline = time.monotonic() + seconds
    seen = run.reported  # what the terminal panel has not been shown yet is what this wait adds to it
    while True:
        text = run.output()
        if len(text) > seen:
            _stream_new(ctx, text[seen:])
            seen = len(text)
        if not run.running or time.monotonic() >= deadline:
            break
        run.wait(0.2)
    final = run.output()  # one read for both: what arrived since the last look is shown live AND counted as seen, never only one of the two
    if len(final) > seen:
        _stream_new(ctx, final[seen:])
    return wait_report(run, run.take_new(final), clamp_chars(max_output_chars))


@tool("stop_command", "End a command that is running in the background (its run_id is in the note that said so), and what it started. "
                      "Its output so far stays readable with get_command_output.",
      {"run_id": STR}, ["run_id"], risk=EXECUTE)
def stop_command(ctx: Context, run_id: str) -> str:
    run = _background_run(run_id)
    if not run.running:
        return f"`{run.display}` had already finished (exit code {run.exit_code})."
    run.stop("user")
    run.wait(15)
    return f"Stopped `{run.display}` (run_id {run.run_id}) after {duration(run.elapsed())}. Its output so far is still there: get_command_output reads it."
