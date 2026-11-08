# SPDX-License-Identifier: GPL-3.0-or-later
"""Stand-ins for the SSH tests: a server that starts without a process, and a session that connects without ssh."""

from pathlib import Path
from types import SimpleNamespace
from typing import Optional

from snapgent_bridge.mcp_client import MCPServer


class FakeServer(MCPServer):
    def __init__(self, server_id, config=None, tools=("t",), starts=True):
        super().__init__(server_id, config or {}, cwd=Path.cwd(), client_version="test", log=lambda _m: None)
        self._names = list(tools)
        self.starts = starts
        self.start_calls = 0
        self.stopped = False

    async def start(self) -> bool:
        self.start_calls += 1
        if not self.starts:
            self.error = "boom"
            return False
        self.process = SimpleNamespace(returncode=None)
        self.ready = True
        self.tools = [{"name": name} for name in self._names]
        return True

    async def stop(self) -> None:
        self.process = None
        self.ready = False
        self.tools = []
        self.stopped = True

    def die(self) -> None:
        self.process = None


class FakeSession:
    """What SshManager needs of a session. `script` decides what connecting does."""

    def __init__(self, target, script=None):
        self.target = target
        self.script = script or (lambda session, ask: None)
        self.alive = False
        self.closed = False
        self.commands = []
        self.python = b"3 12\n"

    async def connect(self, ask) -> None:
        result = self.script(self, ask)
        if hasattr(result, "__await__"):
            await result
        self.alive = True

    async def run(self, command, stdin: Optional[bytes] = None, timeout: float = 60.0):
        self.commands.append(command)
        if "sys.version_info" in command:
            return 0, self.python, b""
        return 0, b"", b""

    def server_config(self, remote_command):
        return {"command": "ssh", "args": [remote_command], "env": {}}

    async def close(self) -> None:
        self.closed = True
        self.alive = False
