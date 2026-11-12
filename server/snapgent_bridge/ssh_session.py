# SPDX-License-Identifier: GPL-3.0-or-later
"""One SSH connection to one server, held open by the bridge for as long as the user works there.

This is the POSIX half; Windows has no shared connections and uses ssh_direct.DirectSshSession instead (new_session picks).

It is a shared connection (OpenSSH's ControlMaster): the user signs in ONCE, through the popup in the browser, and everything that
follows rides on that login without asking again: looking at the server, putting the Snapgent MCP server there, and the MCP
session itself. Nothing about the login is kept: no password, no passphrase, no file. When the connection ends the user signs in
again.

The control socket lives in a folder only this user can open, made for this connection and removed when it ends."""

import asyncio
import os
import re
import shutil
import tempfile
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from . import ssh_target
from .askpass import AskpassBroker, Prompt, askpass_command
from .folder_picker import clean_environment

CONNECT_SECONDS = 180.0  # includes the time a person takes to type a passphrase
CONTROL_SECONDS = 5.0
RUN_SECONDS = 60.0
MIN_SSH = (8, 4)  # the first OpenSSH that can be told to ask through SSH_ASKPASS even when a terminal exists
STDERR_KEPT = 2000

Ask = Callable[[Prompt], Awaitable[Optional[str]]]


class SshError(RuntimeError):
    """The connection could not be made or used; the message is shown to the user."""


def version_problem(text: str) -> Optional[str]:
    # Win32-OpenSSH calls itself `OpenSSH_for_Windows_9.5p1`: the version sits in the same place either way.
    match = re.search(r"OpenSSH(?:_for_Windows)?_([0-9]+)\.([0-9]+)", text or "")
    if match is None:
        return "Only OpenSSH is supported, and the installed ssh did not say it is OpenSSH."
    version = (int(match.group(1)), int(match.group(2)))
    if version < MIN_SSH:
        return f"OpenSSH {version[0]}.{version[1]} is too old: 8.4 or newer is needed."
    return None


def platform_problem(which: Callable[[str], Optional[str]] = shutil.which) -> Optional[str]:
    """Why this machine cannot use SSH at all, or None.

    Windows has no shared connections, so it gets one ssh per command instead (DirectSshSession). Either way the ssh
    program itself has to be there."""
    if which("ssh") is None:
        return "ssh was not found. Install the OpenSSH client."
    return None


async def ssh_problem(ssh: str = "ssh", spawn: Callable[..., Any] = asyncio.create_subprocess_exec) -> Optional[str]:
    """Why the installed ssh cannot be used, or None."""
    try:
        process = await spawn(ssh, "-V", stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        output, _ = await asyncio.wait_for(process.communicate(), 10)
    except (OSError, asyncio.TimeoutError):
        return "ssh could not be started. Install the OpenSSH client."
    return version_problem(output.decode("utf-8", "replace"))


class SshSession:
    def __init__(self, target: ssh_target.SshTarget, *, ssh: Any = "ssh", log: Callable[[str], None] = lambda _message: None,
                 spawn: Callable[..., Any] = asyncio.create_subprocess_exec) -> None:
        self.target = target
        self._ssh = [ssh] if isinstance(ssh, str) else list(ssh)  # a list is for tests: `python fake-ssh.py`
        self._log = log
        self._spawn = spawn
        self._dir: Optional[Path] = None
        self._master: Optional[Any] = None
        self._broker: Optional[AskpassBroker] = None
        self._env: Dict[str, str] = {}
        self._stderr_task: Optional[asyncio.Future] = None
        self._stderr_tail = ""

    @property
    def alive(self) -> bool:
        return self._master is not None and self._master.returncode is None

    @property
    def control_path(self) -> str:
        assert self._dir is not None
        return str(self._dir / "m")  # short and fixed: a unix socket path may not be longer than about 100 characters

    # ── connecting ─────────────────────────────────────────────────────────

    async def connect(self, ask: Ask) -> None:
        """Sign in. `ask` is how ssh reaches the person (passphrase, new host); it returns None when they cancel."""
        if self._master is not None:
            raise SshError("This connection is already open.")
        # /tmp on purpose: the default temp folder can be so long (macOS) that the control socket path would pass the unix limit.
        # mkdtemp makes a fresh, random, owner-only folder, so a fixed parent is safe.
        self._dir = Path(tempfile.mkdtemp(prefix="sg-", dir="/tmp" if os.path.isdir("/tmp") else None))  # nosec B108
        try:
            self._broker = AskpassBroker(ask, self._log)
            extra = await self._broker.start(self._dir, askpass_command())
            self._env = clean_environment(dict(os.environ))
            self._env.pop("SSH_ASKPASS_PROMPT", None)
            self._env.update(extra)
            try:
                self._master = await self._spawn(
                    *self._ssh, *ssh_target.master_args(self.target, self.control_path), env=self._env,
                    stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
                    start_new_session=True,  # no controlling terminal to fall back on
                )
            except OSError as error:
                raise SshError(f"ssh could not be started: {error}") from error
            self._stderr_task = asyncio.ensure_future(self._collect_stderr(self._master.stderr))
            await self._wait_ready()
        except BaseException:
            await self.close()
            raise

    async def _collect_stderr(self, stream: asyncio.StreamReader) -> None:
        try:
            while True:
                line = await stream.readline()
                if not line:
                    return
                self._stderr_tail = (self._stderr_tail + line.decode("utf-8", "replace"))[-STDERR_KEPT:]
        except (OSError, ValueError):
            return

    async def _wait_ready(self) -> None:
        loop = asyncio.get_running_loop()
        deadline = loop.time() + CONNECT_SECONDS
        while loop.time() < deadline:
            if self._master.returncode is not None:
                raise SshError(await self._failure())
            if os.path.exists(self.control_path) and await self._control("check"):
                return
            await asyncio.sleep(0.3)
        raise SshError("The server did not answer in time.")

    async def _failure(self) -> str:
        if self._stderr_task is not None:
            try:
                await asyncio.wait_for(self._stderr_task, 1.0)
            except asyncio.TimeoutError:
                pass
        if self._broker is not None and self._broker.cancelled:
            return "Connection cancelled."
        lines = self._stderr_tail.strip().splitlines()
        return lines[-1] if lines else f"ssh stopped with exit code {self._master.returncode}."

    # ── using it ───────────────────────────────────────────────────────────

    async def _run_ssh(self, args: List[str], stdin: Optional[bytes], timeout: float) -> Tuple[int, bytes, bytes]:
        process = await self._spawn(
            *self._ssh, *args, env=self._env,
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

    async def _control(self, operation: str) -> bool:
        try:
            code, _, _ = await self._run_ssh(ssh_target.control_args(self.target, self.control_path, operation), None, CONTROL_SECONDS)
        except (SshError, OSError):
            return False
        return code == 0

    async def run(self, command: str, stdin: Optional[bytes] = None, timeout: float = RUN_SECONDS) -> Tuple[int, bytes, bytes]:
        """Run a command on the server through the open connection: (exit code, stdout, stderr)."""
        if not self.alive:
            raise SshError("The SSH connection is closed.")
        return await self._run_ssh(ssh_target.client_args(self.target, self.control_path, command), stdin, timeout)

    def server_config(self, remote_command: str) -> Dict[str, Any]:
        """The MCP server entry that runs `remote_command` on the server (stdio over the shared connection)."""
        return {"command": self._ssh[0],
                "args": [*self._ssh[1:], *ssh_target.client_args(self.target, self.control_path, remote_command)], "env": {}}

    # ── closing ────────────────────────────────────────────────────────────

    async def close(self) -> None:
        master, self._master = self._master, None
        if master is not None and master.returncode is None:
            if self._dir is not None and os.path.exists(self.control_path):
                await self._control("exit")
            try:
                await asyncio.wait_for(master.wait(), 3)
            except asyncio.TimeoutError:
                master.terminate()
                try:
                    await asyncio.wait_for(master.wait(), 3)
                except asyncio.TimeoutError:
                    master.kill()
                    await master.wait()
        if self._stderr_task is not None:
            self._stderr_task.cancel()
            await asyncio.gather(self._stderr_task, return_exceptions=True)
            self._stderr_task = None
        if self._broker is not None:
            await self._broker.stop()
            self._broker = None
        if self._dir is not None:
            shutil.rmtree(self._dir, ignore_errors=True)
            self._dir = None
