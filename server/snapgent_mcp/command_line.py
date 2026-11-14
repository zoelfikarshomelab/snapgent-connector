"""One command line, as the model wrote it: "npm test" means the program npm with the argument test.

The model writes a command the way a person types it, in one piece. The tools want the program and its arguments apart, so
the line is split here - once, before anything looks at it: the security checks and the run itself then see the same command.
A command that is a program of its own (it is on PATH, or it is a path) is left alone, and the arguments the model gave come
after it.
"""

import os
import shlex
import shutil
from typing import Any, Dict, List, Optional, Sequence


def split_command_line(command: str) -> List[str]:
    """The words of a command line: "npm test" is the program npm with the argument test."""
    text = str(command).strip()
    if not text:
        return [text]
    try:
        parts = shlex.split(text, posix=(os.name != "nt"))
    except ValueError:  # an unbalanced quote: run it as it is, and let it fail as it is
        return [text]
    if os.name == "nt":
        # Windows keeps the quotes around a word; they are not part of the program.
        parts = [part.strip('"') for part in parts]
    return [part for part in parts if part] or [text]


def command_parts(command: str, args: Optional[Sequence[Any]] = None) -> List[str]:
    """The program and its arguments: the program first, then everything the model gave."""
    text = str(command).strip()
    if not text:
        return [command]
    given = [str(arg) for arg in (args or [])]
    if shutil.which(text):
        return [text, *given]  # it is a program of its own: run it as it is
    parts = split_command_line(text)
    if len(parts) <= 1:
        return [text, *given]
    return [*parts, *given]


def normalize_arguments(name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    """The arguments as the policy and the tools see them: a command line written in one piece is split."""
    if name != "run_command":
        return arguments
    command = arguments.get("command")
    if not isinstance(command, str) or not command.strip():
        return arguments
    parts = command_parts(command, arguments.get("args"))
    return {**arguments, "command": parts[0], "args": parts[1:]}
