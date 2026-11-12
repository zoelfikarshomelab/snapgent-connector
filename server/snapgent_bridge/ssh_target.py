# SPDX-License-Identifier: GPL-3.0-or-later
"""Where an SSH connection goes, and the ssh command lines built from it. Pure: text in, lists out, no process is started.

A target is typed into a text box, so nothing in it is trusted. The user and the host must look like a user and a host (never a
word that starts with "-", which ssh would read as an option such as -oProxyCommand=...), and every command line puts the host
after `--` as well, so the two checks back each other up."""

import hashlib
import re
from typing import Any, List, NamedTuple, Tuple

DEFAULT_PORT = 22
SERVER_ID_MAX = 64
_USER = re.compile(r"[A-Za-z0-9_][A-Za-z0-9._-]{0,63}")
_HOST = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?")
_IPV6 = re.compile(r"[0-9A-Fa-f:.]{2,45}")
_PORT = re.compile(r"[0-9]{1,5}")
_USAGE = "Give the server as user@host (for example me@192.168.1.20)."

# Nothing is forwarded (no agent, no X11, and nothing the user's own ssh config would forward), and a dead connection is
# noticed within a minute instead of hanging.
_COMMON = ["-o", "ForwardAgent=no", "-o", "ForwardX11=no", "-o", "ClearAllForwardings=yes",
           "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3", "-o", "LogLevel=ERROR"]


class TargetError(ValueError):
    """The text is not a usable server; the message is shown to the user."""


class SshTarget(NamedTuple):
    user: str
    host: str
    port: int = DEFAULT_PORT

    @property
    def label(self) -> str:
        """`user@host`, with `:port` when it is not the usual one (an IPv6 address goes in brackets)."""
        host = f"[{self.host}]" if ":" in self.host else self.host
        return f"{self.user}@{host}" + (f":{self.port}" if self.port != DEFAULT_PORT else "")


def _port(text: str) -> int:
    if not text:
        return DEFAULT_PORT
    if not _PORT.fullmatch(text) or not 1 <= int(text) <= 65535:
        raise TargetError("The port must be a number from 1 to 65535.")
    return int(text)


def _split_host(rest: str) -> Tuple[str, int]:
    if rest.startswith("["):
        host, closing, tail = rest[1:].partition("]")
        valid = bool(closing) and ":" in host and _IPV6.fullmatch(host) is not None and (not tail or tail.startswith(":"))
        if not valid:
            raise TargetError(_USAGE)
        return host, _port(tail[1:])
    host, _, port = rest.partition(":")
    if not _HOST.fullmatch(host):
        raise TargetError(_USAGE)
    return host, _port(port)


def parse_target(text: Any) -> SshTarget:
    """`user@host`, `user@host:port` or `user@[ipv6]:port` -> a target, or TargetError."""
    if not isinstance(text, str):
        raise TargetError(_USAGE)
    user, at, rest = text.strip().partition("@")
    if not at or not _USER.fullmatch(user):
        raise TargetError(_USAGE)
    host, port = _split_host(rest)
    return SshTarget(user, host, port)


def server_id(target: SshTarget) -> str:
    """The id the connection has as an MCP server (it must fit config.json's rule for ids: letters, digits, `.`, `_`, `-`)."""
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", target.label.replace("@", "-")).strip("-")
    name = f"ssh-{slug}"
    if len(name) > SERVER_ID_MAX:
        digest = hashlib.sha1(target.label.encode("utf-8"), usedforsecurity=False).hexdigest()[:8]
        name = f"{name[:SERVER_ID_MAX - 9]}-{digest}"
    return name


def _destination(target: SshTarget) -> List[str]:
    return ["-l", target.user, "-p", str(target.port), "--", target.host]


def master_args(target: SshTarget, control_path: str) -> List[str]:
    """The one connection that signs in (and may ask the user). The others share it."""
    return ["-M", "-N", "-o", f"ControlPath={control_path}", "-o", "ControlMaster=yes", *_COMMON,
            "-o", "ConnectTimeout=20", "-o", "NumberOfPasswordPrompts=2", *_destination(target)]


def control_args(target: SshTarget, control_path: str, operation: str) -> List[str]:
    """Ask the master something (`check`: is it up, `exit`: close it)."""
    return ["-o", f"ControlPath={control_path}", "-O", operation, *_destination(target)]


def client_args(target: SshTarget, control_path: str, remote_command: str) -> List[str]:
    """A command on the server through the master: never asks anything (BatchMode) and has no terminal (-T), so the bytes of an MCP session arrive as they were written."""
    return ["-T", "-o", f"ControlPath={control_path}", "-o", "ControlMaster=no", "-o", "BatchMode=yes", *_COMMON,
            *_destination(target), remote_command]


def direct_args(target: SshTarget, remote_command: str, *, batch: bool = True) -> List[str]:
    """One ssh that signs in, runs a command and ends: what a platform without shared connections has (Windows).

    The first connection may ask (a host seen for the first time, a key with a passphrase); every one after it runs in
    BatchMode, so a command can never sit waiting for a person who is not there."""
    asking = ["-o", "BatchMode=yes"] if batch else ["-o", "NumberOfPasswordPrompts=2"]
    return ["-T", *_COMMON, "-o", "ConnectTimeout=20", *asking, *_destination(target), remote_command]
