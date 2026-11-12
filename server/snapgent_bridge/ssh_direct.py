# SPDX-License-Identifier: GPL-3.0-or-later
"""One ssh per command, for a platform without OpenSSH's shared connections (Windows).

Windows has no ControlMaster, so nothing can be held open: the first connection signs in and may ask (a host seen for the
first time, a key with a passphrase), and every command after it runs in BatchMode so it cannot wait for a person. The
price is a new connection per command; the gain is that SSH works where a shared connection cannot exist."""

import asyncio
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from . import ssh_target
from .askpass import AskpassBroker, askpass_command
from .folder_picker import clean_environment
from .ssh_session import CONNECT_SECONDS, RUN_SECONDS, Ask, SshError


def spawn_options() -> Dict[str, Any]:
    """POSIX gets a session of its own (no controlling terminal to fall back on). Windows has no such flag and gets a
    hidden window instead, so no console flashes on the user's screen for every connection."""
    if os.name == "nt":
        return {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0)}
    return {"start_new_session": True}


class DirectSshSession:
    """A connection per command, kept as one session so the rest of the bridge sees no difference."""

    def __init__(self, target: ssh_target.SshTarget, *, ssh: Any = "ssh", log: Callable[[str], None] = lambda _message: None,
                 spawn: Callable[..., Any] = asyncio.create_subprocess_exec) -> None:
        self.target = target
        self._ssh = [ssh] if isinstance(ssh, str) else list(ssh)
        self._log = log
        self._spawn = spawn
        self._dir: Optional[Path] = None
        self._broker: Optional[AskpassBroker] = None
        self._env: Dict[str, str] = {}
        self._ready = False

    @property
    def alive(self) -> bool:
        return self._ready

    async def connect(self, ask: Ask) -> None:
        """Sign in once. `ask` is how ssh reaches the person, exactly as with a shared connection."""
        if self._ready:
            raise SshError("This connection is already open.")
        self._dir = Path(tempfile.mkdtemp(prefix="sg-"))
        try:
            self._broker = AskpassBroker(ask, self._log)
            extra = await self._broker.start(self._dir, askpass_command())
            self._env = clean_environment(dict(os.environ))
            self._env.pop("SSH_ASKPASS_PROMPT", None)
            self._env.update(extra)
            code, _, error = await self._run_ssh(ssh_target.direct_args(self.target, "true", batch=False), None, CONNECT_SECONDS)
        except BaseException:
            await self.close()
            raise
        if code != 0:
            reason = self._failure(error, code)
            await self.close()
            raise SshError(reason)
        self._ready = True

    def _failure(self, error: bytes, code: int) -> str:
        if self._broker is not None and self._broker.cancelled:
            return "Connection cancelled."
        lines = error.decode("utf-8", "replace").strip().splitlines()
        return lines[-1] if lines else f"ssh stopped with exit code {code}."

    async def _run_ssh(self, args: List[str], stdin: Optional[bytes], timeout: float) -> Tuple[int, bytes, bytes]:
        process = await self._spawn(
            *self._ssh, *args, env=self._env, **spawn_options(),
            stdin=asyncio.subprocess.PIPE if stdin is not None else asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        try:
            output, error = await asyncio.wait_for(process.communicate(stdin), timeout)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            raise SshError("The server took too long to answer.")
        return process.returncode, output, error

    async def run(self, command: str, stdin: Optional[bytes] = None, timeout: float = RUN_SECONDS) -> Tuple[int, bytes, bytes]:
        """Run a command on the server over a connection of its own: (exit code, stdout, stderr)."""
        if not self._ready:
            raise SshError("The SSH connection is closed.")
        return await self._run_ssh(ssh_target.direct_args(self.target, command), stdin, timeout)

    def server_config(self, remote_command: str) -> Dict[str, Any]:
        """The MCP server entry: its own ssh per message, through the same key, never asking."""
        return {"command": self._ssh[0], "args": [*self._ssh[1:], *ssh_target.direct_args(self.target, remote_command)], "env": {}}

    async def close(self) -> None:
        self._ready = False
        if self._broker is not None:
            await self._broker.stop()
            self._broker = None
        if self._dir is not None:
            shutil.rmtree(self._dir, ignore_errors=True)
            self._dir = None


def new_session(target: ssh_target.SshTarget, **kwargs: Any) -> Any:
    """The session this machine can have: shared connections where OpenSSH offers them, one ssh per command where not."""
    if os.name == "nt":
        return DirectSshSession(target, **kwargs)
    from .ssh_session import SshSession
    return SshSession(target, **kwargs)
