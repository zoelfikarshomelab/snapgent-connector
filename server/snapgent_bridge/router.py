"""Turns one request from the extension into replies. No sockets: it talks through `reply` and `broadcast`."""

import asyncio
import os
import time
from typing import Any, Awaitable, Callable, Dict, Optional

from . import folder_picker, protocol
from .config import PROTECTED_SERVER_ID, ConfigStore
from .registry import ServerRegistry
from .settings import MAX_LOG_CHARS

Reply = Callable[[Dict[str, Any]], Awaitable[None]]


class RequestRouter:
    def __init__(self, registry: ServerRegistry, config: ConfigStore, broadcast: Reply, version: str,
                 log: Callable[[str], None], ssh: Optional[Any] = None) -> None:
        self._registry = registry
        self._config = config
        self._broadcast = broadcast
        self._version = version
        self._log = log
        self._ssh = ssh  # the SSH connections (ssh_manager.py); None where there is no such thing
        self._handlers = {
            "ping": self._ping,
            "list_tools": self._list_tools,
            "call_tool": self._call_tool,
            "restart_mcp": self._restart_mcp,
            "add_server": self._add_server,
            "remove_server": self._remove_server,
            "workspaces": self._workspaces,
            "set_workspace": self._set_workspace,
            "pick_folder": self._pick_folder,
            "ssh_connect": self._ssh_connect,
            "ssh_disconnect": self._ssh_disconnect,
            "ssh_answer": self._ssh_answer,
            "ssh_list_dirs": self._ssh_list_dirs,
        }

    def connected_message(self) -> Dict[str, Any]:
        return protocol.connected_message(
            self._version, self._registry.any_alive, self._registry.catalog, self._registry.status()
        )

    async def handle(self, request: Dict[str, Any], reply: Reply) -> None:
        kind = request.get("type")
        handler = self._handlers.get(kind)
        if handler is None:
            await reply(protocol.error_message(request.get("id"), f"Unknown bridge request: {kind}"))
            return
        await handler(request, reply)

    # ── handlers ───────────────────────────────────────────────────────────

    async def _ping(self, request, reply):
        await reply({"type": "pong", "id": request.get("id")})

    async def _list_tools(self, request, reply):
        await reply(protocol.tools_message(self.connected_message(), request.get("id")))

    async def _restart_mcp(self, request, reply):
        request_id = request.get("id")
        try:
            await self._registry.restart(self._config.load_servers())
            message = protocol.mcp_status_message(
                request_id, True, self._registry.any_alive, self._registry.catalog, self._registry.status()
            )
        except (OSError, RuntimeError) as error:
            message = protocol.mcp_status_message(request_id, False, False, error=str(error))
        await reply(message)
        await self._broadcast(self.connected_message())

    async def _add_server(self, request, reply):
        await self._change_servers(
            request, reply,
            lambda: self._config.add_server(request.get("server_id"), request.get("command"), request.get("args", []), request.get("env", {})),
        )

    async def _remove_server(self, request, reply):
        await self._change_servers(request, reply, lambda: self._config.remove_server(request.get("server_id")))

    async def _change_servers(self, request, reply, mutate) -> None:
        request_id = request.get("id")
        try:
            mutate()
            await self._registry.restart(self._config.load_servers())
        except (OSError, RuntimeError) as error:  # ConfigError is a RuntimeError
            await reply(protocol.server_changed_message(request_id, False, str(error)))
            return
        await reply(protocol.server_changed_message(request_id, True))
        await self._broadcast(self.connected_message())

    async def _workspaces(self, request, reply):
        await self._ask_server(request, reply, "snapgent/workspaces", {}, local_finish=self._with_recent)

    async def _set_workspace(self, request, reply):
        await self._ask_server(request, reply, "snapgent/set_workspace", {"path": request.get("path")}, local_finish=self._remember)

    async def _ssh_list_dirs(self, request, reply):
        """The folders inside a folder of an SSH server: a server has no system folder window to choose from."""
        await self._ask_server(request, reply, "snapgent/list_dirs", {"path": request.get("path")}, remote_only=True)

    async def _with_ssh(self, request, reply, action):
        if self._ssh is None:
            result = {"ok": False, "error": "SSH connections are not available in this bridge."}
        else:
            result = await action(self._ssh)
        await reply(protocol.ssh_message(request.get("id"), result))

    async def _ssh_connect(self, request, reply):
        await self._with_ssh(request, reply, lambda ssh: ssh.connect(request.get("target")))

    async def _ssh_disconnect(self, request, reply):
        await self._with_ssh(request, reply, lambda ssh: ssh.disconnect(request.get("server")))

    async def _ssh_answer(self, request, reply):
        async def answer(ssh):
            return {"ok": ssh.answer(request.get("prompt_id"), request.get("answer"))}
        await self._with_ssh(request, reply, answer)

    def _with_recent(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """The folders used lately that still exist: what a chat can start in when no editor has a folder open."""
        return {**data, "recent": [path for path in self._config.recent_folders() if os.path.isdir(path)]}

    def _remember(self, data: Dict[str, Any]) -> Dict[str, Any]:
        if data.get("pinned"):
            try:
                self._config.remember_folder(data["pinned"])
            except (OSError, RuntimeError) as error:  # a recent list that cannot be saved must not fail the choice
                self._log(f"recent folders not saved: {error}")
        return data

    async def _pick_folder(self, request, reply):
        """Open the system's folder window on this machine; the answer is the chosen path (or none when it was closed)."""
        try:
            chosen = await folder_picker.pick_folder()
        except folder_picker.PickerUnavailable as error:
            await reply(protocol.workspace_message(request.get("id"), False, error=str(error)))
            return
        await reply(protocol.workspace_message(request.get("id"), True, {"picked": chosen}))

    def _target_server(self, server_id) -> Optional[str]:
        """The server a workspace question is for: the default one, or an SSH server that is connected. Never any other server."""
        if not server_id or server_id == PROTECTED_SERVER_ID:
            return PROTECTED_SERVER_ID
        return server_id if self._ssh is not None and self._ssh.owns(server_id) else None

    async def _ask_server(self, request, reply, method, params, local_finish=None, remote_only=False):
        """The bar's questions about a server's workspace (which folders, which one is pinned): the default server's, or the SSH
        server named in `server`. What only makes sense on this computer (the folders used lately, which are paths here) is left
        out for a server somewhere else."""
        request_id = request.get("id")
        server_id = self._target_server(request.get("server"))
        if server_id is None:
            await reply(protocol.workspace_message(request_id, False, error="That server is not connected."))
            return
        local = server_id == PROTECTED_SERVER_ID
        if remote_only and local:
            await reply(protocol.workspace_message(request_id, False, error="The folders of this computer are chosen in its own folder window."))
            return
        server = self._registry.servers.get(server_id)
        if server is None:
            await reply(protocol.workspace_message(request_id, False, error="The Snapgent MCP server is not configured."))
            return
        try:
            data = await server.request(method, params)
        except (asyncio.TimeoutError, RuntimeError, OSError) as error:
            await reply(protocol.workspace_message(request_id, False, error=str(error) or "The Snapgent MCP server did not answer."))
            return
        data = data if isinstance(data, dict) else {}
        await reply(protocol.workspace_message(request_id, True, local_finish(data) if local and local_finish else data))

    async def _call_tool(self, request, reply):
        call = protocol.parse_tool_call(request)
        if call is None:
            await reply(protocol.tool_error(request.get("id"), "Invalid tool call."))
            return
        target = self._registry.resolve_for_call(call.name, call.selected_server)
        if target.error:
            await reply(protocol.tool_error(call.request_id, target.error, target.kind))
            return
        started = time.monotonic()
        try:
            result = await target.server.call_tool(target.tool_name, call.arguments, call.timeout_seconds)
        except (asyncio.TimeoutError, RuntimeError, OSError, ValueError) as error:
            elapsed_ms = int((time.monotonic() - started) * 1000)
            kind = "timeout" if isinstance(error, asyncio.TimeoutError) else "tool_error"
            await reply(protocol.tool_error(call.request_id, str(error), kind))
            self._log(f"<- {call.name} ERROR: {str(error)[:MAX_LOG_CHARS]} ({elapsed_ms} ms)")
            return
        elapsed_ms = int((time.monotonic() - started) * 1000)
        # Only slow calls are logged, so timing data is available without spamming.
        if elapsed_ms >= 250:
            self._log(f"<- {call.name} took {elapsed_ms} ms")
        message, text = protocol.tool_result_message(call.request_id, result)
        await reply(message)
        # Keep the result out of the log: previews of every call (especially large
        # list_dir/read_file results) were the main source of log spam. Failures
        # are still logged above.
