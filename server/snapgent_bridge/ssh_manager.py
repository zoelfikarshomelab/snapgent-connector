# SPDX-License-Identifier: GPL-3.0-or-later
"""The SSH servers the user connected from the browser: connecting (with the questions ssh asks going to the extension's popup),
making the server ready, joining it to the other MCP servers, and noticing when it goes away.

A connection is never written to config.json: there is nothing to restore after a restart, because nothing about the login is
kept. When the connection ends the server is taken away and the user connects (and signs in) again."""

import asyncio
import secrets
from typing import Any, Awaitable, Callable, Dict, Optional, Tuple

from .askpass import CONFIRM, MAX_ANSWER_CHARS, Prompt
from .registry import ServerRegistry
from .ssh_bundle import Bundle, build_bundle
from .ssh_remote import RemoteError, prepare_remote, serve_command
from .ssh_session import SshError, SshSession, platform_problem, ssh_problem
from .ssh_target import SshTarget, TargetError, parse_target, server_id

PROMPT_SECONDS = 120.0  # how long the popup waits for the person

Broadcast = Callable[[Dict[str, Any]], Awaitable[None]]


class SshManager:
    def __init__(self, registry: ServerRegistry, broadcast: Broadcast, announce: Callable[[], Awaitable[None]],
                 log: Callable[[str], None], *, session_factory: Callable[..., Any] = SshSession,
                 make_bundle: Callable[[], Bundle] = build_bundle,
                 check: Callable[[], Awaitable[Optional[str]]] = ssh_problem,
                 platform_check: Callable[[], Optional[str]] = platform_problem) -> None:
        self._registry = registry
        self._broadcast = broadcast
        self._announce = announce  # tell the extension the list of servers changed
        self._log = log
        self._session_factory = session_factory
        self._make_bundle = make_bundle
        self._check = check
        self._platform_check = platform_check
        self._bundle: Optional[Bundle] = None
        self._ssh_ok = False
        self._sessions: Dict[str, Any] = {}
        self._busy = set()
        self._pending: Dict[str, Tuple[asyncio.Future, str]] = {}

    def owns(self, server: Any) -> bool:
        return isinstance(server, str) and server in self._sessions

    # ── connecting ─────────────────────────────────────────────────────────

    async def connect(self, text: Any) -> Dict[str, Any]:
        try:
            target = parse_target(text)
        except TargetError as error:
            return {"ok": False, "error": str(error)}
        problem = await self._problem()
        if problem:
            return {"ok": False, "error": problem}
        sid = server_id(target)
        existing = self._sessions.get(sid)
        if existing is not None:
            if existing.target != target:
                return {"ok": False, "error": f"{existing.target.label} already has that name here. Disconnect it first."}
            if existing.alive:
                return {"ok": True, "server_id": sid, "label": target.label, "already": True}
            await self._drop(sid)
        if sid in self._busy:
            return {"ok": False, "error": "Already connecting to that server."}
        self._busy.add(sid)
        try:
            return await self._open(sid, target)
        finally:
            self._busy.discard(sid)

    async def _problem(self) -> Optional[str]:
        problem = self._platform_check()
        if problem is None and not self._ssh_ok:
            problem = await self._check()
            self._ssh_ok = problem is None
        return problem

    async def _open(self, sid: str, target: SshTarget) -> Dict[str, Any]:
        session = self._session_factory(target, log=self._log)
        try:
            await self._status(sid, target, "connecting")
            await session.connect(lambda prompt: self._ask(sid, target, prompt))
            await self._status(sid, target, "preparing")
            self._bundle = self._bundle or self._make_bundle()
            name = await prepare_remote(session, self._bundle)
            server = self._registry.attach(sid, session.server_config(serve_command(name)), label=target.label)
            if not await server.start():
                raise SshError(server.error or "The Snapgent server did not start on the machine.")
            self._registry.rebuild_catalog()
        except (SshError, RemoteError, ValueError) as error:
            await self._registry.detach(sid)
            await session.close()
            await self._status(sid, target, "failed", str(error))
            return {"ok": False, "error": str(error)}
        except BaseException:
            await self._registry.detach(sid)
            await session.close()
            raise
        self._sessions[sid] = session
        await self._status(sid, target, "ready")
        await self._announce()
        return {"ok": True, "server_id": sid, "label": target.label}

    # ── the questions ssh asks ─────────────────────────────────────────────

    async def _ask(self, sid: str, target: SshTarget, prompt: Prompt) -> Optional[str]:
        prompt_id = secrets.token_hex(8)
        future = asyncio.get_running_loop().create_future()
        self._pending[prompt_id] = (future, prompt.kind)
        try:
            await self._broadcast({"type": "ssh_prompt", "prompt_id": prompt_id, "server_id": sid, "label": target.label,
                                   "kind": prompt.kind, "text": prompt.text})
            return await asyncio.wait_for(future, PROMPT_SECONDS)
        except asyncio.TimeoutError:
            return None
        finally:
            self._pending.pop(prompt_id, None)

    def answer(self, prompt_id: Any, value: Any) -> bool:
        """The person's answer to a question (None: cancelled). False when nothing is waiting for it."""
        entry = self._pending.get(prompt_id) if isinstance(prompt_id, str) else None
        if entry is None or entry[0].done():
            return False
        future, kind = entry
        if not isinstance(value, str):
            future.set_result(None)
        elif kind == CONFIRM:
            future.set_result("yes" if value.strip().lower() == "yes" else "no")  # only an explicit yes counts
        else:
            future.set_result(value[:MAX_ANSWER_CHARS])
        return True

    # ── ending ─────────────────────────────────────────────────────────────

    async def _status(self, sid: str, target: SshTarget, state: str, detail: str = "") -> None:
        await self._broadcast({"type": "ssh_status", "server_id": sid, "label": target.label, "state": state, "detail": detail})

    async def _drop(self, sid: str) -> Optional[SshTarget]:
        await self._registry.detach(sid)
        session = self._sessions.pop(sid, None)
        if session is None:
            return None
        await session.close()
        return session.target

    async def disconnect(self, server: Any) -> Dict[str, Any]:
        if not self.owns(server):
            return {"ok": False, "error": "That server is not connected."}
        target = await self._drop(server)
        if target is not None:
            await self._status(server, target, "closed")
        await self._announce()
        return {"ok": True}

    async def reap(self) -> bool:
        """Take away the servers whose connection ended (or whose server stopped). True when something changed."""
        ended = []
        for sid, session in self._sessions.items():
            server = self._registry.servers.get(sid)
            if not session.alive or server is None or not server.alive:
                ended.append(sid)
        for sid in ended:
            target = await self._drop(sid)
            if target is not None:
                await self._status(sid, target, "closed", "The SSH connection ended. Connect again to continue.")
        return bool(ended)

    async def shutdown(self) -> None:
        for entry in list(self._pending.values()):
            if not entry[0].done():
                entry[0].set_result(None)
        for sid in list(self._sessions):
            await self._drop(sid)
