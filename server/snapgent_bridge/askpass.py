# SPDX-License-Identifier: GPL-3.0-or-later
"""The bridge's side of SSH_ASKPASS: what ssh asks for (a passphrase, a yes/no about a new host) reaches the person through the
browser extension, never through a terminal, and the answer goes straight back to ssh.

ssh runs a tiny script (written into a folder only this user can open); the script runs this program's `--askpass` mode, which
speaks to the socket below. The socket answers only a caller that knows a random token, which lives in the environment of the
ssh it was made for. The answer is never written anywhere and never logged: not even the question is."""

import asyncio
import hmac
import json
import os
import secrets
import shlex
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Awaitable, Callable, Dict, List, NamedTuple, Optional, Set

from . import settings
from .askpass_helper import PORT_VARIABLE, SOCKET_VARIABLE, TOKEN_VARIABLE

SECRET = "secret"    # a passphrase or password: typed hidden
CONFIRM = "confirm"  # a yes/no question (a host seen for the first time)
INFO = "info"        # something to show, nothing to answer
MAX_PROMPT_CHARS = 2000
MAX_ANSWER_CHARS = 1024
REQUEST_WAIT_SECONDS = 5
_IS_WINDOWS = os.name == "nt"  # a module constant so a test can pretend to be the other platform


class Prompt(NamedTuple):
    text: str
    kind: str


def classify_prompt(text: str, hint: str) -> str:
    """What kind of answer ssh wants. Anything not recognised is a secret: hidden is the safe way to be wrong."""
    hint = (hint or "").lower()
    if hint == "confirm" or "(yes/no" in text.lower():
        return CONFIRM
    return INFO if hint == "none" else SECRET


def askpass_command() -> List[str]:
    """The command that runs this program as the askpass helper: the packaged program by itself, a clone through Python."""
    if getattr(sys, "frozen", False):
        return [sys.executable]
    return [sys.executable, str(settings.ROOT / "snapgent.py")]


class AskpassBroker:
    def __init__(self, ask: Callable[[Prompt], Awaitable[Optional[str]]], log: Callable[[str], None]) -> None:
        self._ask = ask
        self._log = log
        self._server: Optional[asyncio.AbstractServer] = None
        self._token = secrets.token_urlsafe(24)
        self._helper_dir: Optional[Path] = None  # Windows only: the folder holding the .cmd, removed with the broker
        self._tasks: Set[asyncio.Future] = set()
        self.cancelled = False  # the person (or the time) said no to a question

    async def start(self, directory: Path, command: List[str]) -> Dict[str, str]:
        """Listen inside `directory` (which only this user can open); the environment ssh must be started with."""
        if _IS_WINDOWS:
            return await self._start_tcp(command)
        helper = directory / "askpass"
        helper.write_text("#!/bin/sh\nexec " + " ".join(shlex.quote(part) for part in command) + ' --askpass "$@"\n', encoding="utf-8")
        helper.chmod(0o700)
        path = directory / "a"
        self._server = await asyncio.start_unix_server(self._handle, path=str(path))
        path.chmod(0o600)
        # `force`: ask through the helper even when a terminal exists, so ssh never reads the one the bridge runs in.
        return {"SSH_ASKPASS": str(helper), "SSH_ASKPASS_REQUIRE": "force", SOCKET_VARIABLE: str(path), TOKEN_VARIABLE: self._token}

    async def _start_tcp(self, command: List[str]) -> Dict[str, str]:
        """Windows: asyncio has no unix sockets there, so the helper reaches the bridge on a loopback port instead.

        Nothing listens on the network, and the random token in ssh's environment is what keeps every other program on the
        machine out. ssh runs SSH_ASKPASS with the question as its argument, so there is no room for a flag: the packaged
        program recognises itself from the token, and a clone (python plus a script) gets a small `.cmd` to carry both."""
        self._server = await asyncio.start_server(self._handle, host="127.0.0.1", port=0)
        port = self._server.sockets[0].getsockname()[1]
        if len(command) == 1:
            # The packaged program is one file, so ssh can run it as the helper itself: the token in its environment is
            # how it knows. ssh passes the question as the only argument, so a `--askpass` flag has nowhere to go.
            askpass = command[0]
        else:
            # A clone is two words (python and the script): a tiny .cmd carries both and the flag.
            self._helper_dir = Path(tempfile.mkdtemp(prefix="sgask-"))
            helper = self._helper_dir / "askpass.cmd"
            helper.write_text("@echo off\r\n" + subprocess.list2cmdline([*command, "--askpass"]) + " %*\r\n", encoding="utf-8")
            askpass = str(helper)
        return {"SSH_ASKPASS": askpass, "SSH_ASKPASS_REQUIRE": "force", PORT_VARIABLE: str(port), TOKEN_VARIABLE: self._token}

    async def stop(self) -> None:
        server, self._server = self._server, None
        if server is not None:
            server.close()
        helper = self._helper_dir
        if helper is not None:
            shutil.rmtree(helper, ignore_errors=True)
            self._helper_dir = None
        tasks = list(self._tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def _answer(self, reader: asyncio.StreamReader) -> Dict[str, object]:
        refused: Dict[str, object] = {"ok": False, "answer": ""}
        try:
            request = json.loads(await asyncio.wait_for(reader.readline(), REQUEST_WAIT_SECONDS))
            if not isinstance(request, dict) or not hmac.compare_digest(str(request.get("token", "")).encode("utf-8"), self._token.encode("utf-8")):
                return refused
        except (asyncio.TimeoutError, ValueError, OSError):
            return refused
        text = str(request.get("prompt", ""))[:MAX_PROMPT_CHARS]
        answer = await self._ask(Prompt(text, classify_prompt(text, str(request.get("hint", "")))))
        if answer is None:
            self.cancelled = True
            return refused
        return {"ok": True, "answer": answer[:MAX_ANSWER_CHARS]}

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        task = asyncio.current_task()
        self._tasks.add(task)
        try:
            reply = await self._answer(reader)
            writer.write(json.dumps(reply).encode("utf-8") + b"\n")
            await writer.drain()
        except OSError:
            self._log("the askpass helper went away before it was answered")
        finally:
            self._tasks.discard(task)
            writer.close()
