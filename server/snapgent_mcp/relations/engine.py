# SPDX-License-Identifier: GPL-3.0-or-later
"""The relations footer of read_files: the files a file calls into, as a short chain with the line range of each function.

The engine is shared; a language only supplies an adapter, `parse(root, rel, text) -> Parsed` (its imports and its definitions).
Only what the source says outright is followed (static imports, and names called by name from files that were imported), and the
footer says so when it has nothing: a relation that is guessed is worse than one that is missing."""

import re
from pathlib import Path
from typing import Dict, List, Set, Tuple

from ..limits import IGNORED_DIRECTORIES, MAX_FOOTER_LINES, MAX_SEARCH_FILE_BYTES
from ..security.files import is_sensitive
from . import go_adapter, html_adapter, js_adapter, php_adapter, python_adapter, rust_adapter
from .model import ImportRef, Parsed

ADAPTERS = {".py": python_adapter.parse, ".php": php_adapter.parse, ".go": go_adapter.parse, ".rs": rust_adapter.parse,
            ".html": html_adapter.parse, ".htm": html_adapter.parse, **{extension: js_adapter.parse for extension in js_adapter.EXTENSIONS}}
# Shared helpers that nearly everything imports: naming them is enough, opening them would only fill the footer.
HUB_STEMS = frozenset({"logger", "log", "logging", "constants", "consts", "config", "settings", "utils", "util", "helpers", "helper", "common", "types"})
_HARD_CAP = 400  # the walk stops after this many lines; the footer prints MAX_FOOTER_LINES of them and counts the rest

# Parsed files by path, valid while the modification time and the size stay the same. Imports are resolved when a file is parsed, so a
# file created later that an import names is picked up once the importing file changes.
_CACHE: Dict[str, Tuple[Tuple[int, int], Parsed]] = {}
_CACHE_LIMIT = 4000


def _load(root: Path, rel: str) -> Parsed:
    path = root / rel
    stat = path.stat()
    if stat.st_size > MAX_SEARCH_FILE_BYTES:
        raise ValueError("file is too large to analyse")
    stamp = (stat.st_mtime_ns, stat.st_size)
    hit = _CACHE.get(str(path))
    if hit and hit[0] == stamp:
        return hit[1]
    parsed = ADAPTERS[path.suffix.lower()](root, rel, path.read_text(encoding="utf-8", errors="replace"))
    if len(_CACHE) >= _CACHE_LIMIT:
        _CACHE.clear()
    _CACHE[str(path)] = (stamp, parsed)
    return parsed


def _hidden(rel: str) -> bool:
    return any(part in IGNORED_DIRECTORIES for part in rel.split("/")) or is_sensitive(rel)


def _merged(refs: List[ImportRef]) -> List[ImportRef]:
    """One entry per imported file, in the order first imported, with the names and the alias of every import of it."""
    merged: Dict[str, ImportRef] = {}
    for ref in refs:
        old = merged.get(ref.path)
        merged[ref.path] = ref if old is None else ImportRef(ref.path, old.names | ref.names, old.alias or ref.alias, old.via or ref.via,
                                                              sep=old.sep if old.alias else ref.sep)
    return list(merged.values())


def _patterns(definition, ref: ImportRef, shadowed: bool = False) -> List[str]:
    """The regular expressions that count as a call of `definition` from a file that imported `ref`. A `*` in `names` means every top-level
    function of the file is in scope (PHP include/require and CodeIgniter helpers)."""
    name = re.escape(definition.name)
    every = "*" in ref.names
    found: List[str] = []
    if definition.kind == "method":
        if ref.via:  # CodeIgniter: a model or library made by the loader is a property of the caller
            found.append(r"\$this->" + re.escape(ref.via) + r"->" + name + r"\s*\(")
        if every or definition.owner in ref.names:
            found.append(r"(?<![\w$])" + re.escape(definition.owner) + r"::" + name + r"\s*\(")
        return found
    if definition.kind == "class":
        return [r"\bnew\s+" + name + r"\b"] if every or definition.name in ref.names else []
    if (every or definition.name in ref.names) and not shadowed:  # a bare call means this file's own function when it defines one of that name
        found.append(r"(?<![\w$.])(?<!->)(?<!::)" + name + r"\s*\(")
    if ref.alias:
        found.append(r"(?<![\w$.])" + re.escape(ref.alias) + re.escape(ref.sep) + name + r"\s*\(")
    return found


def _call_sites(text: str, ref: ImportRef, definitions, own: Set[str]):
    """`(definition, first line that calls it)` for the functions of an imported file that `text` calls by name. A name the file defines
    itself is left out (it is shadowed), and `obj.name(` is never taken for a call of an imported `name`."""
    found = []
    for definition in definitions:
        # Only a bare call is hidden by a function of the same name in this file; `pkg.Name(` is not (Go code has `New` everywhere).
        patterns = _patterns(definition, ref, definition.kind == "function" and definition.name in own)
        lines = [text.count("\n", 0, hit.start()) + 1 for hit in (re.search(pattern, text) for pattern in patterns) if hit]
        if lines:
            found.append((definition, min(lines)))
    return sorted(found, key=lambda item: item[1])


def _span(definition) -> str:
    return f"L{definition.start}" if definition.end in (None, definition.start) else f"L{definition.start}-{definition.end}"


def _describe(root: Path, caller: str, ref: ImportRef, text: str, own: Set[str], level: int, depth: int, skip, seen: Set[str], lines: List[str]) -> None:
    indent = "  " * level
    suffix = Path(ref.path).suffix.lower()
    if suffix not in ADAPTERS:  # a style sheet or another file an HTML page names: it is listed, not analysed
        lines.append(f"{indent}{ref.path}: dirujuk, isi tidak dianalisis ({suffix})")
        return
    try:
        target = _load(root, ref.path)
    except (OSError, ValueError) as error:
        lines.append(f"{indent}{ref.path}: tidak bisa diurai ({error})")
        return
    calls = _call_sites(text, ref, target.definitions, own)
    if not calls:
        lines.append(f"{indent}{ref.path}: diimpor, pemanggilan tidak terdeteksi")
        return
    for definition, line in calls:
        lines.append(f"{indent}{ref.path}: {definition.label}() {_span(definition)}  ← dipanggil {caller} L{line}")
    if level < depth:
        _walk(root, ref.path, level + 1, depth, skip, seen, lines)


def _walk(root: Path, caller: str, level: int, depth: int, skip, seen: Set[str], lines: List[str]) -> None:
    parsed = _load(root, caller)
    text = (root / caller).read_text(encoding="utf-8", errors="replace")
    own = {definition.name for definition in parsed.definitions if definition.kind != "method"}
    indent = "  " * level
    for ref in _merged(parsed.imports):
        if len(lines) >= _HARD_CAP:
            return
        target = ref.path
        if target == caller or _hidden(target):
            continue
        if target in skip:
            lines.append(f"{indent}{target}: ikut terbaca di panggilan ini")
        elif target in seen:
            lines.append(f"{indent}{target}: lihat di atas")
        elif Path(target).stem.lower() in HUB_STEMS:
            seen.add(target)
            lines.append(f"{indent}{target}: file umum, tidak dibuka lebih dalam")
        else:
            seen.add(target)
            _describe(root, caller, ref, text, own, level, depth, skip, seen, lines)


def build_footer(root: Path, rel: str, depth: int, skip=frozenset(), max_lines: int = MAX_FOOTER_LINES) -> str:
    """The footer for the workspace file `rel`. `skip` holds the files read in the same call: they are named, not opened again.
    It always says something, so that "no relations" and "language not supported" can never look alike."""
    suffix = Path(rel).suffix.lower()
    if suffix not in ADAPTERS:
        return f"→ relasi: tidak didukung untuk {suffix or 'file tanpa ekstensi'}\n"
    try:
        _load(root, rel)
    except (OSError, ValueError) as error:
        return f"→ relasi: file tidak bisa diurai ({error})\n"
    lines: List[str] = []
    _walk(root, rel, 1, max(1, depth), skip, {rel}, lines)
    if not lines:
        return "→ relasi: tidak ada impor file lokal yang terdeteksi (relasi dinamis tidak terlihat)\n"
    shown = ["→ rantai pemanggilan:"] + lines[:max_lines]
    if len(lines) > max_lines:
        capped = "+" if len(lines) >= _HARD_CAP else ""
        shown.append(f"  +{len(lines) - max_lines}{capped} lainnya")
    return "\n".join(shown) + "\n"
