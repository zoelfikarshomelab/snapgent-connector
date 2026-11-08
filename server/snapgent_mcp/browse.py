# SPDX-License-Identifier: GPL-3.0-or-later
"""Folders to choose from, for the bar's folder window on a machine that has no system window of its own (an SSH server).

Only folder NAMES leave here, never a file or its contents. Choosing one still goes through the same checks as typing its path
(`checked_folder`), so this adds a way to look, not a way to reach anything new."""

import os
from pathlib import Path
from typing import Any, Dict, Optional

MAX_ENTRIES = 1000


def list_dirs(path: Optional[str] = None, home: Optional[Path] = None) -> Dict[str, Any]:
    """The folders inside `path` (the user's home when none is given), with where `..` leads. Raises ValueError with a message for the user."""
    home = Path.home() if home is None else home
    base = Path(path.strip() if isinstance(path, str) and path.strip() else str(home)).expanduser()
    if not base.is_absolute():
        raise ValueError("Give the full path of a folder (it must start from the root, for example /home/me).")
    try:
        folder = base.resolve()
    except (OSError, RuntimeError) as error:
        raise ValueError(f"That path cannot be used: {error}") from error
    if not folder.is_dir():
        raise ValueError(f"That folder does not exist: {folder}")
    names = []
    truncated = False
    try:
        with os.scandir(folder) as entries:
            for entry in entries:
                try:
                    if not entry.is_dir():
                        continue
                except OSError:
                    continue
                if len(names) >= MAX_ENTRIES:
                    truncated = True
                    break
                names.append(entry.name)
    except OSError as error:
        raise ValueError(f"That folder cannot be read: {error}") from error
    names.sort(key=str.lower)
    parent = None if folder == Path(folder.anchor) else str(folder.parent)
    return {"path": str(folder), "parent": parent, "home": str(home), "dirs": names, "truncated": truncated}
