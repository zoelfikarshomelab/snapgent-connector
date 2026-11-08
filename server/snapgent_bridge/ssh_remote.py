# SPDX-License-Identifier: GPL-3.0-or-later
"""What happens on the server, as fixed text: a look for python3, the upload of the Snapgent MCP server, and the command that runs it.

Everything sent to the server is built here from constants. The one thing that varies is the archive's name, which must be a hex
digest before it goes into a command, so nothing the user typed can end up in a shell command on the server. The upload goes to
~/.snapgent, a folder only that user can enter, and python runs in isolated mode (-I), so neither PYTHONPATH nor a stray file
in the working folder can put other code in front of the Snapgent server."""

import re
import shlex
from typing import Optional, Protocol, Tuple

from .ssh_bundle import Bundle

MIN_PYTHON = (3, 9)
REMOTE_DIR = ".snapgent"
NOT_YOURS = 3  # exit code of the upload script when ~/.snapgent belongs to someone else
_DIGEST = re.compile(r"[0-9a-f]{16}")


class RemoteError(RuntimeError):
    """The server cannot be made ready; the message says what to do about it."""


class RemoteShell(Protocol):
    async def run(self, command: str, stdin: Optional[bytes] = None, timeout: float = 60.0) -> Tuple[int, bytes, bytes]: ...


def archive_name(digest: str) -> str:
    if not isinstance(digest, str) or not _DIGEST.fullmatch(digest):
        raise ValueError("The archive name must come from a 16-digit hex digest.")
    return f"mcp-{digest}.zip"


def probe_command() -> str:
    return "python3 -c " + shlex.quote("import sys; print(sys.version_info[0], sys.version_info[1])")


def exists_command(name: str) -> str:
    return "sh -c " + shlex.quote(f'test -f "$HOME/{REMOTE_DIR}/{name}"')


def upload_command(name: str) -> str:
    """Reads the archive from stdin. The folder is checked to be the user's own BEFORE anything is written into it, and the file
    appears under its name only once it is complete."""
    script = (
        f'd="$HOME/{REMOTE_DIR}"; umask 077; '
        f'if [ -e "$d" ] && [ ! -O "$d" ]; then echo "{REMOTE_DIR} belongs to someone else" >&2; exit {NOT_YOURS}; fi; '
        f'mkdir -p "$d" && chmod 700 "$d" && cat > "$d/{name}.part" && mv -f "$d/{name}.part" "$d/{name}"'
    )
    return "sh -c " + shlex.quote(script)


def serve_command(name: str) -> str:
    """Runs the Snapgent MCP server out of the archive. `sh -c` makes it the same whatever shell the user's account has."""
    code = (
        "import os,sys;"
        f'sys.path.insert(0,os.path.join(os.path.expanduser("~"),"{REMOTE_DIR}","{name}"));'
        "from snapgent_mcp.server import main;main()"
    )
    return "sh -c " + shlex.quote("exec python3 -I -c " + shlex.quote(code))


def _python_version(output: bytes) -> Optional[Tuple[int, int]]:
    # The last line that looks like a version: a login banner may have printed lines of its own before it.
    found = re.findall(rb"^([0-9]+) ([0-9]+)[ \t\r]*$", output, re.MULTILINE)
    return (int(found[-1][0]), int(found[-1][1])) if found else None


def _tail(error: bytes) -> str:
    return error.decode("utf-8", "replace").strip()[-300:]


async def prepare_remote(shell: RemoteShell, bundle: Bundle) -> str:
    """Make the Snapgent MCP server ready on the server; the name of its archive there."""
    name = archive_name(bundle.digest)
    code, output, _ = await shell.run(probe_command(), timeout=20)
    version = _python_version(output) if code == 0 else None
    if version is None:
        raise RemoteError("python3 was not found on the server. Snapgent runs its tools there with python3 (3.9 or newer).")
    if version < MIN_PYTHON:
        raise RemoteError(f"The server has python3 {version[0]}.{version[1]}; 3.9 or newer is needed.")
    code, _, _ = await shell.run(exists_command(name), timeout=20)
    if code != 0:
        code, _, error = await shell.run(upload_command(name), stdin=bundle.data, timeout=120)
        if code == NOT_YOURS:
            raise RemoteError(f"~/{REMOTE_DIR} on the server belongs to someone else, so Snapgent will not use it.")
        if code != 0:
            raise RemoteError(f"Could not copy the Snapgent server to the machine: {_tail(error) or f'exit code {code}'}")
    return name
