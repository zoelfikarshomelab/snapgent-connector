# SPDX-License-Identifier: GPL-3.0-or-later
"""The program ssh runs when it needs a passphrase (SSH_ASKPASS). It asks the bridge, over a socket only this user can reach, and
prints the answer for ssh. It never reads a terminal: the answer comes from the popup in the browser extension.

Standard library only and no bridge code, so it starts fast (ssh waits for it)."""

import json
import os
import socket
import sys
from typing import Mapping, Optional, Sequence, TextIO

SOCKET_VARIABLE = "SNAPGENT_ASKPASS_SOCKET"
PORT_VARIABLE = "SNAPGENT_ASKPASS_PORT"  # Windows: a loopback port instead of a unix socket
TOKEN_VARIABLE = "SNAPGENT_ASKPASS_TOKEN"
WAIT_SECONDS = 150.0  # a little more than the bridge waits for the person
MAX_REPLY_BYTES = 8192


def _connection(path: str, port: Optional[str]) -> socket.socket:
    """Where the bridge is listening: a unix socket, or a loopback port on a machine that has none (Windows)."""
    if port:
        return socket.create_connection(("127.0.0.1", int(port)), timeout=WAIT_SECONDS)
    if not hasattr(socket, "AF_UNIX"):  # Windows Python has none: fail like any unreachable bridge, so ssh just gets no answer
        raise OSError("unix sockets are not available here")
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        connection.settimeout(WAIT_SECONDS)
        connection.connect(path)
    except OSError:
        connection.close()  # nothing is listening: fail like an unreachable bridge, but do not leak the socket
        raise
    return connection


def ask(path: Optional[str], token: str, prompt: str, hint: str, port: Optional[str] = None) -> Optional[str]:
    """The answer, or None when the person cancelled (or the bridge refused)."""
    with _connection(path or "", port) as connection:
        connection.sendall((json.dumps({"token": token, "prompt": prompt, "hint": hint}) + "\n").encode("utf-8"))
        data = b""
        while not data.endswith(b"\n") and len(data) < MAX_REPLY_BYTES:
            chunk = connection.recv(4096)
            if not chunk:
                break
            data += chunk
    reply = json.loads(data.decode("utf-8"))
    answer = reply.get("answer") if isinstance(reply, dict) and reply.get("ok") else None
    return answer if isinstance(answer, str) else None


def main(argv: Sequence[str], env: Optional[Mapping[str, str]] = None, out: Optional[TextIO] = None) -> int:
    env = os.environ if env is None else env
    out = sys.stdout if out is None else out
    path, port, token = env.get(SOCKET_VARIABLE), env.get(PORT_VARIABLE), env.get(TOKEN_VARIABLE)
    if (not path and not port) or not token:
        return 1
    try:
        answer = ask(path, token, argv[0] if argv else "", env.get("SSH_ASKPASS_PROMPT", ""), port)
    except (OSError, ValueError):
        return 1
    if answer is None:
        return 1
    out.write(answer + "\n")
    out.flush()
    return 0
