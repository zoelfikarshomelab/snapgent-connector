# SPDX-License-Identifier: GPL-3.0-or-later
"""Go adapter for the relations footer.

Imports it follows: packages that live inside the module (the module name comes from the nearest `go.mod`), mapped to the folder of
the package. A Go import names a package, not a file, so it is resolved to the files of that package that define a function the
importing file calls as `pkg.Func(` (the package name is the import's alias, or the last element of its path). That is decided when the
importing file is parsed, so a function added later to another file of the package shows once the importing file changes.

Not followed: the standard library and third-party packages, dot and blank imports, calls inside the same package (nothing in the file
says where they go) and method calls on values. The end of a function is the first `}` at the start of a line, which is what gofmt writes."""

import bisect
import re
from pathlib import Path
from typing import List, Optional, Tuple

from ..limits import MAX_SEARCH_FILE_BYTES
from .model import Definition, ImportRef, Parsed, inside

_FUNC = re.compile(r"^func\s+(\w+)\s*(?:\[[^\]\n]*\])?\s*\(", re.M)
_METHOD = re.compile(r"^func\s*\(\s*(?:\w+\s+)?\*?\s*(\w+)(?:\[[^\]\n]*\])?\s*\)\s*(\w+)\s*\(", re.M)
_IMPORT_BLOCK = re.compile(r"^import\s*\(([^)]*)\)", re.M)
_IMPORT_ONE = re.compile(r'^import\s+(?:(\w+|\.)\s+)?"([^"\n]+)"', re.M)
_IMPORT_LINE = re.compile(r'^\s*(?:(\w+|\.)\s+)?"([^"\n]+)"', re.M)
_MODULE = re.compile(r"^module\s+(\S+)", re.M)
_VERSION = re.compile(r"v\d+")


def _read(path: Path) -> str:
    try:
        if path.stat().st_size > MAX_SEARCH_FILE_BYTES:
            return ""
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def _end_line(text: str, offset: int, line_of) -> Optional[int]:
    eol = text.find("\n", offset)
    eol = len(text) if eol < 0 else eol
    first = text[offset:eol].rstrip()
    if first.endswith("}") and "{" in first:  # the whole function is on its first line
        return line_of(offset)
    close = text.find("\n}", eol)
    return line_of(close + 1) if close >= 0 else None


def _definitions(text: str) -> List[Definition]:
    starts = [0] + [i + 1 for i, char in enumerate(text) if char == "\n"]

    def line_of(offset: int) -> int:
        return bisect.bisect_right(starts, offset)

    found = [Definition(m.group(1), line_of(m.start()), _end_line(text, m.start(), line_of)) for m in _FUNC.finditer(text)]
    found += [Definition(m.group(2), line_of(m.start()), _end_line(text, m.start(), line_of), "method", m.group(1)) for m in _METHOD.finditer(text)]
    return sorted(found, key=lambda definition: definition.start)


def _module(root: Path, rel: str) -> Optional[Tuple[Path, str]]:
    """The folder of the nearest go.mod and the module name it declares."""
    here = (root / rel).parent
    for base in (here, *here.parents):
        if not inside(base, root):
            break
        manifest = base / "go.mod"
        if manifest.is_file():
            found = _MODULE.search(_read(manifest))
            return (base, found.group(1).strip('"')) if found else None
    return None


def _package_files(folder: Path) -> List[Path]:
    try:
        return sorted(p for p in folder.iterdir() if p.suffix == ".go" and not p.name.endswith("_test.go") and p.is_file())
    except OSError:
        return []


def _local_name(path: str) -> str:
    """The name a package is called by when the import gives none: its last path element, without a major-version suffix (`/v2`)."""
    parts = [part for part in path.split("/") if part]
    if len(parts) > 1 and _VERSION.fullmatch(parts[-1]):
        return parts[-2]
    return parts[-1]


def parse(root: Path, rel: str, text: str) -> Parsed:
    module = _module(root, rel)
    wanted: List[Tuple[int, Optional[str], str]] = []
    for block in _IMPORT_BLOCK.finditer(text):
        for line in _IMPORT_LINE.finditer(block.group(1)):
            wanted.append((block.start(1) + line.start(), line.group(1), line.group(2)))
    wanted.extend((m.start(), m.group(1), m.group(2)) for m in _IMPORT_ONE.finditer(text))
    found: List[Tuple[int, ImportRef]] = []
    for offset, alias, path in wanted:
        if module is None or alias in ("_", "."):
            continue
        base, name = module
        if path != name and not path.startswith(name + "/"):
            continue
        folder = base / path[len(name):].lstrip("/")
        if not inside(folder, root):
            continue
        files = _package_files(folder)
        if not files:
            continue
        alias = alias or _local_name(path)
        called = set(re.findall(r"(?<![\w.])" + re.escape(alias) + r"\.(\w+)\s*\(", text))
        owners = [file for file in files if called & {m.group(1) for m in _FUNC.finditer(_read(file))}] if called else []
        for file in (owners or files[:1]):  # with no call found the package is still named, through its first file
            found.append((offset, ImportRef(file.relative_to(root).as_posix(), alias=alias)))
    return Parsed([ref for _, ref in sorted(found, key=lambda item: item[0])], _definitions(text))
