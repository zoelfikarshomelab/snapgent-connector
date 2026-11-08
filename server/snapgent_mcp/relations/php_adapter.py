# SPDX-License-Identifier: GPL-3.0-or-later
"""PHP adapter for the relations footer: plain PHP and CodeIgniter 3.

Imports it follows, only when they are written out as string literals:
- CodeIgniter 3 loader calls, `$this->load->model('x')`, `library`, `helper` and `view`, mapped to `application/{models,libraries,helpers,views}/`.
  A model or library is reached as `$this->x->method()`; a model loaded under another name (a second argument) or a library given an object
  name is not followed, because the name it is reached by would be a guess. The array form of the loader is not read either.
- `require` / `include` (and `_once`), with a literal path or `__DIR__ . '/x.php'`.
- `use Name\\Space\\Kelas;`, found by the class's file name when exactly one file in the workspace fits (or one whose path ends with the namespace).

The end of a function is found by matching braces while skipping strings and comments, which is coarse (a heredoc or inline HTML can fool it)."""

import bisect
import os
import re
import time
from pathlib import Path
from typing import Dict, Iterator, List, Optional, Tuple

from ..limits import IGNORED_DIRECTORIES
from ..security.files import is_sensitive
from .model import Definition, ImportRef, Parsed, inside

_NL = chr(10)
_BACKSLASH = chr(92)
_Q = r"[\x22\x27]"
_NOT_Q = r"[^\x22\x27]"
_LOAD = re.compile(r"\$this->load->(model|library|helper|view)\(\s*(" + _Q + r")(" + _NOT_Q + r"+)\2")
_INCLUDE = re.compile(r"\b(?:require|include)(?:_once)?\b\s*\(?\s*(__DIR__\s*\.\s*)?(" + _Q + r")(" + _NOT_Q + r"+)\2")
_USE = re.compile(r"^use\s+([\w\\]+)\s*;", re.M)
_SECOND_STRING = re.compile(r"\s*,\s*(" + _Q + r")" + _NOT_Q + r"+\1")
_LAST_STRING = re.compile(r",\s*(" + _Q + r")" + _NOT_Q + r"+\1\s*\)\s*$")
_CLASS = re.compile(r"^[ \t]*(?:(?:abstract|final|readonly)[ \t]+)*(?:class|interface|trait)[ \t]+(\w+)", re.M)
_FUNCTION = re.compile(r"^[ \t]*(?:(?:public|protected|private|static|final|abstract)[ \t]+)*function[ \t]+&?[ \t]*(\w+)[ \t]*\(", re.M)
_FOLDERS = {"model": "models", "library": "libraries", "helper": "helpers", "view": "views"}
# Where a `use` is looked up: third-party code is not the project's own.
_INDEX_SKIP = frozenset(IGNORED_DIRECTORIES) | {"vendor"}
_INDEX: Dict[str, Tuple[float, Dict[str, List[str]]]] = {}
_INDEX_SECONDS = 30


def _skip_string(text: str, i: int) -> int:
    quote = text[i]
    j = i + 1
    while j < len(text):  # PHP strings may span lines (SQL), so a newline does not end one
        if text[j] == _BACKSLASH:
            j += 2
            continue
        if text[j] == quote:
            return j + 1
        j += 1
    return len(text)


def _code_chars(text: str, i: int) -> Iterator[Tuple[int, str]]:
    """(index, character) of everything that is code: strings and comments (`//`, `#`, `/* */`) are skipped; `#[` starts an attribute."""
    n = len(text)
    while i < n:
        char = text[i]
        following = text[i + 1:i + 2]
        if char in ("'", '"', "`"):
            i = _skip_string(text, i)
            continue
        if (char == "/" and following == "/") or (char == "#" and following != "["):
            end = text.find(_NL, i)
            i = n if end < 0 else end
            continue
        if char == "/" and following == "*":
            end = text.find("*/", i + 2)
            i = n if end < 0 else end + 2
            continue
        yield i, char
        i += 1


def _matching(text: str, i: int, opening: str, closing: str) -> Optional[int]:
    depth = 0
    for position, char in _code_chars(text, i):
        if char == opening:
            depth += 1
        elif char == closing:
            depth -= 1
            if depth == 0:
                return position
    return None


def _first_body(text: str, i: int) -> Optional[int]:
    """Index of the `{` that opens a body, or None when a `;` comes first (an abstract method or an interface)."""
    for position, char in _code_chars(text, i):
        if position - i > 2000:
            return None
        if char == "{":
            return position
        if char == ";":
            return None
    return None


def _definitions(text: str) -> List[Definition]:
    starts = [0] + [i + 1 for i, char in enumerate(text) if char == _NL]

    def line_of(offset: int) -> int:
        return bisect.bisect_right(starts, offset)

    classes: List[Definition] = []
    for match in _CLASS.finditer(text):
        brace = _first_body(text, match.end())
        close = _matching(text, brace, "{", "}") if brace is not None else None
        classes.append(Definition(match.group(1), line_of(match.start()), line_of(close) if close is not None else None, "class"))
    found = list(classes)
    for match in _FUNCTION.finditer(text):
        start = line_of(match.start())
        closing = _matching(text, match.end() - 1, "(", ")")
        end = None
        if closing is not None:
            brace = _first_body(text, closing + 1)
            if brace is None:
                end = start
            else:
                close = _matching(text, brace, "{", "}")
                end = line_of(close) if close is not None else None
        owner = None
        for candidate in classes:
            if candidate.end is not None and candidate.start < start <= candidate.end and (owner is None or candidate.start > owner.start):
                owner = candidate
        found.append(Definition(match.group(1), start, end, "method" if owner else "function", owner.name if owner else None))
    return sorted(found, key=lambda definition: definition.start)


def _application(root: Path, rel: str) -> Optional[Path]:
    """CodeIgniter's `application` folder for this file: the one it sits in, or the nearest one beside a folder above it."""
    here = (root / rel).parent
    for base in (here, *here.parents):
        if not inside(base, root):
            break
        if base.name == "application":
            return base
        if (base / "application").is_dir():
            return base / "application"
    return None


def _on_disk(root: Path, candidate: Path) -> Optional[str]:
    """The path a candidate really has on disk, as the disk spells it, or None when there is no such file.

    Windows and macOS compare file names without case, so the CI3 guess `user_model.php` opens `User_model.php` there and the
    footer would name a path that does not exist on Linux. The folder's own names are what is reported, so every platform agrees."""
    if not inside(candidate, root) or not candidate.is_file():
        return None
    try:
        spelled = {name.lower(): name for name in os.listdir(candidate.parent)}
    except OSError:
        return None
    name = spelled.get(candidate.name.lower())
    if name is None:
        return None
    actual = candidate.parent / name
    if not actual.is_file():
        return None
    return actual.relative_to(root).as_posix()


def _loaded_file(root: Path, app: Path, kind: str, name: str) -> Optional[str]:
    """The file CodeIgniter would load for `load->kind(name)`. Names may carry a subfolder; the file name is tried as written, with a capital first
    letter (the CI3 convention) and in lower case."""
    parts = [part for part in name.replace(_BACKSLASH, "/").split("/") if part]
    if not parts:
        return None
    stem = parts[-1] + ("_helper" if kind == "helper" else "")
    variants = []
    for variant in (stem, stem[:1].upper() + stem[1:], stem.lower()):
        if variant not in variants:
            variants.append(variant)
    folder = app / _FOLDERS[kind]
    for variant in variants:
        candidate = Path(os.path.normpath(str(folder.joinpath(*parts[:-1], variant + ".php"))))
        found = _on_disk(root, candidate)
        if found is not None:
            return found
    return None


def _renamed(text: str, match, kind: str) -> bool:
    """Whether the loader call gives the model or library another name than its own, which this adapter does not follow."""
    stop = text.find(";", match.end())
    rest = text[match.end():len(text) if stop < 0 else stop]
    return bool(_SECOND_STRING.match(rest)) if kind == "model" else bool(_LAST_STRING.search(rest))


def _classes(root: Path) -> Dict[str, List[str]]:
    """File stem -> workspace files of that name, for finding the file of a `use`d class. Kept for a short while: a project is walked once, not per file."""
    hit = _INDEX.get(str(root))
    now = time.monotonic()
    if hit and now - hit[0] < _INDEX_SECONDS:
        return hit[1]
    index: Dict[str, List[str]] = {}
    for current, dirs, names in os.walk(root):
        dirs[:] = sorted(name for name in dirs if name not in _INDEX_SKIP)
        for name in sorted(names):
            if name.endswith(".php"):
                rel = (Path(current) / name).relative_to(root).as_posix()
                if not is_sensitive(rel):
                    index.setdefault(name[:-4], []).append(rel)
    _INDEX[str(root)] = (now, index)
    return index


def _class_file(root: Path, dotted: str) -> Optional[str]:
    parts = [part for part in dotted.split(_BACKSLASH) if part]
    if not parts:
        return None
    found = _classes(root).get(parts[-1], [])
    if len(found) > 1:  # several files of that name: only a path that ends with the namespace can settle it
        tail = "/".join(parts).lower() + ".php"
        found = [path for path in found if path.lower().endswith(tail)]
    return found[0] if len(found) == 1 else None


def _included(root: Path, here: Path, match) -> Optional[str]:
    spec = match.group(3)
    if match.group(1):
        candidates = [here / spec.lstrip("/" + _BACKSLASH)]
    elif spec.startswith("/") or ":" in spec:
        return None
    else:
        candidates = [here / spec, root / spec]
    for candidate in candidates:
        path = Path(os.path.normpath(str(candidate)))
        if path.suffix.lower() == ".php":
            found = _on_disk(root, path)
            if found is not None:
                return found
    return None


def parse(root: Path, rel: str, text: str) -> Parsed:
    found: List[Tuple[int, ImportRef]] = []
    app = None
    looked = False
    for match in _LOAD.finditer(text):
        if not looked:
            app, looked = _application(root, rel), True
        kind, name = match.group(1), match.group(3)
        target = _loaded_file(root, app, kind, name) if app else None
        if target is None:
            continue
        base = [part for part in name.replace(_BACKSLASH, "/").split("/") if part][-1]
        if kind == "helper":
            ref = ImportRef(target, frozenset({"*"}))
        elif kind == "view":
            ref = ImportRef(target)
        else:
            via = None if _renamed(text, match, kind) else (base if kind == "model" else base.lower())
            ref = ImportRef(target, via=via)
        found.append((match.start(), ref))
    here = (root / rel).parent
    for match in _INCLUDE.finditer(text):
        target = _included(root, here, match)
        if target:
            found.append((match.start(), ImportRef(target, frozenset({"*"}))))
    for match in _USE.finditer(text):
        target = _class_file(root, match.group(1))
        if target:
            found.append((match.start(), ImportRef(target, frozenset({match.group(1).split(_BACKSLASH)[-1]}))))
    return Parsed([ref for _, ref in sorted(found, key=lambda item: item[0])], _definitions(text))
