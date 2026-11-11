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
TOKEN_VARIABLE = "SNAPGENT_ASKPASS_TOKEN"
WAIT_SECONDS = 150.0  # a little more than the bridge waits for the person
MAX_REPLY_BYTES = 8192


def ask(path: str, token: str, prompt: str, hint: str) -> Optional[str]:
    """The answer, or None when the person cancelled (or the bridge refused)."""
    if not hasattr(socket, "AF_UNIX"):  # Windows Python has none: fail like any unreachable bridge, so ssh just gets no answer
        raise OSError("unix sockets are not available here")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(WAIT_SECONDS)
        connection.connect(path)
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
    path, token = env.get(SOCKET_VARIABLE), env.get(TOKEN_VARIABLE)
    if not path or not token:
        return 1
    try:
        answer = ask(path, token, argv[0] if argv else "", env.get("SSH_ASKPASS_PROMPT", ""))
    except (OSError, ValueError):
        return 1
    if answer is None:
        return 1
    out.write(answer + "\n")
    out.flush()
    return 0
