# SPDX-License-Identifier: GPL-3.0-or-later
"""HTML adapter for the relations footer: the local files a page loads.

`<script src>` (JavaScript and TypeScript files) and `<link href>` (style sheets) that name a file of the workspace; addresses with a scheme
(`https:`, `data:`) or a leading `//` are left out. A page defines no functions of its own here, but a function of a loaded script that the
page calls by name (an inline handler such as `onclick`) is shown like any other call. A style sheet is listed and not opened."""

import os
import re
from pathlib import Path
from typing import List, Optional, Tuple

from .js_adapter import EXTENSIONS
from .model import ImportRef, Parsed, inside

_SCRIPT = re.compile(r"<script\b[^>]*?\bsrc\s*=\s*([\x22\x27])(.*?)\1", re.I | re.S)
_LINK = re.compile(r"<link\b[^>]*?\bhref\s*=\s*([\x22\x27])(.*?)\1", re.I | re.S)


def _local(root: Path, here: Path, spec: str) -> Optional[str]:
    """The workspace file an address names, or None. A leading `/` is tried from the workspace root first (the site root), then from the page."""
    spec = re.split(r"[?#]", spec.strip(), maxsplit=1)[0]
    if not spec or spec.startswith("//") or ":" in spec.split("/", 1)[0]:
        return None
    candidates = [here / spec.lstrip("/")]
    if spec.startswith("/"):
        candidates.insert(0, root / spec.lstrip("/"))
    for candidate in candidates:
        path = Path(os.path.normpath(str(candidate)))
        if inside(path, root) and path.is_file():
            return path.relative_to(root).as_posix()
    return None


def parse(root: Path, rel: str, text: str) -> Parsed:
    here = (root / rel).parent
    found: List[Tuple[int, ImportRef]] = []
    for match in _SCRIPT.finditer(text):
        target = _local(root, here, match.group(2))
        if target and Path(target).suffix.lower() in EXTENSIONS:
            found.append((match.start(), ImportRef(target, frozenset({"*"}))))
    for match in _LINK.finditer(text):
        target = _local(root, here, match.group(2))
        if target and Path(target).suffix.lower() == ".css":
            found.append((match.start(), ImportRef(target)))
    return Parsed([ref for _, ref in sorted(found, key=lambda item: item[0])], [])
