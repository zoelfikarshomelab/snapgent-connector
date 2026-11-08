# SPDX-License-Identifier: GPL-3.0-or-later
"""Plain data and one helper shared by the relation engine and the language adapters."""

from dataclasses import dataclass
from pathlib import Path
from typing import FrozenSet, List, Optional


@dataclass(frozen=True)
class Definition:
    """A function or class: its name and the inclusive lines it spans (`end` is None when the end could not be found)."""
    name: str
    start: int
    end: Optional[int]
    kind: str = "function"        # "function", "class" or "method"; PHP tells them apart, the other adapters keep the default
    owner: Optional[str] = None   # the class a method belongs to

    @property
    def label(self) -> str:
        return f"{self.owner}::{self.name}" if self.owner else self.name


@dataclass(frozen=True)
class ImportRef:
    """One import of a workspace file. `names` are the names taken from it; `alias` is the local name of the whole module (`import b`)."""
    path: str
    names: FrozenSet[str] = frozenset()
    alias: Optional[str] = None
    via: Optional[str] = None  # CodeIgniter: the property a loaded model or library is reached by (`$this->via->method()`)
    sep: str = "."  # what joins `alias` and a name in a call: "." for most languages, "::" for Rust


@dataclass(frozen=True)
class Parsed:
    imports: List[ImportRef]
    definitions: List[Definition]


def inside(path: Path, root: Path) -> bool:
    return path == root or root in path.parents
