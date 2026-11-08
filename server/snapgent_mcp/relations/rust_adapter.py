# SPDX-License-Identifier: GPL-3.0-or-later
"""Rust adapter for the relations footer.

Imports it follows: `mod x;` (to `x.rs` or `x/mod.rs` beside the file) and `use` paths that start with `crate::`, `self::`, `super::` or a
child module of the file, including `{a, b}` groups. Calls it recognises: `name(` for an imported function, `module::name(` for an imported
module and `Type::name(` for an associated function. Method calls on a value (`x.send()`) are not seen, and neither are re-exports,
macros and trait dispatch.

The end of a function is found by matching braces while skipping strings, character literals and comments; a lifetime is told from a
character literal. It is coarse: a generic bound that holds a function type, or a macro body, can fool it."""

import bisect
import re
from pathlib import Path
from typing import Iterator, List, Optional, Tuple

from .model import Definition, ImportRef, Parsed, inside

_FN = re.compile(r'^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?(?:(?:const|async|unsafe|default)[ \t]+)*(?:extern[ \t]+"[^"]*"[ \t]+)?fn[ \t]+(\w+)', re.M)
_BLOCK = re.compile(r"^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?(?:unsafe[ \t]+)?(impl|trait)\b", re.M)
_USE = re.compile(r"^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?use[ \t]+([^;]+);", re.M)
_MOD = re.compile(r"^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?mod[ \t]+(\w+)[ \t]*;", re.M)
_CHAR = re.compile(r"'(?:\\[^'\n]+|[^\\'\n])'")
_ROOT_FILES = ("mod.rs", "lib.rs", "main.rs")


def _skip_string(text: str, i: int) -> int:
    j = i + 1
    while j < len(text):
        if text[j] == chr(92):  # a backslash: the next character is escaped
            j += 2
            continue
        if text[j] == '"':
            return j + 1
        j += 1
    return len(text)


def _code_chars(text: str, i: int) -> Iterator[Tuple[int, str]]:
    """(index, character) of everything that is code: strings (also raw ones), character literals and comments are skipped."""
    n = len(text)
    while i < n:
        char = text[i]
        following = text[i + 1:i + 2]
        if char == '"':
            i = _skip_string(text, i)
            continue
        if char == "r" and following in ('"', "#") and not (i and (text[i - 1].isalnum() or text[i - 1] == "_")):
            j = i + 1
            while text[j:j + 1] == "#":
                j += 1
            if text[j:j + 1] == '"':
                hashes = j - i - 1
                end = text.find('"' + "#" * hashes, j + 1)
                i = n if end < 0 else end + 1 + hashes
                continue
        if char == "'":
            literal = _CHAR.match(text, i)
            if literal:  # 'x' or '\n'; anything else is a lifetime and the quote is just a character
                i = literal.end()
                continue
        if char == "/" and following == "/":
            end = text.find("\n", i)
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
    """Index of the `{` that opens a body, or None when a `;` comes first (a trait method without a default body)."""
    for position, char in _code_chars(text, i):
        if position - i > 2000:
            return None
        if char == "{":
            return position
        if char == ";":
            return None
    return None


def _skip_generics(text: str) -> str:
    text = text.lstrip()
    if not text.startswith("<"):
        return text
    depth = 0
    for index, char in enumerate(text):
        if char == "<":
            depth += 1
        elif char == ">" and text[index - 1:index] != "-":
            depth -= 1
            if depth == 0:
                return text[index + 1:]
    return text


def _params_open(text: str, i: int) -> Optional[int]:
    """Index of the `(` that opens a function's parameters, looking from just after its name (generics are stepped over)."""
    n = len(text)
    while i < n and text[i] in " \t\n":
        i += 1
    if text[i:i + 1] == "<":
        depth = 0
        while i < n:
            if text[i] == "<":
                depth += 1
            elif text[i] == ">" and text[i - 1] != "-":
                depth -= 1
                if depth == 0:
                    i += 1
                    break
            i += 1
        while i < n and text[i] in " \t\n":
            i += 1
    return i if text[i:i + 1] == "(" else None


def _owner(kind: str, header: str) -> Optional[str]:
    """The type an `impl` block is for (or the trait a `trait` block declares), from the text between the keyword and the `{`."""
    if kind == "impl" and " for " in header:
        header = header.split(" for ", 1)[1]
    found = re.match(r"\s*&?\s*(?:mut\s+)?(?:\w+::)*(\w+)", _skip_generics(header))
    return found.group(1) if found else None


def _definitions(text: str) -> List[Definition]:
    starts = [0] + [i + 1 for i, char in enumerate(text) if char == "\n"]

    def line_of(offset: int) -> int:
        return bisect.bisect_right(starts, offset)

    blocks: List[Tuple[int, int, str]] = []
    for match in _BLOCK.finditer(text):
        brace = _first_body(text, match.end())
        close = _matching(text, brace, "{", "}") if brace is not None else None
        owner = _owner(match.group(1), text[match.end():brace]) if brace is not None else None
        if close is not None and owner:
            blocks.append((line_of(match.start()), line_of(close), owner))
    found: List[Definition] = []
    for match in _FN.finditer(text):
        start = line_of(match.start())
        end = None
        paren = _params_open(text, match.end())
        closing = _matching(text, paren, "(", ")") if paren is not None else None
        if closing is not None:
            brace = _first_body(text, closing + 1)
            if brace is None:
                end = start
            else:
                close = _matching(text, brace, "{", "}")
                end = line_of(close) if close is not None else None
        owner = None
        for first, last, name in blocks:
            if first < start <= last and (owner is None or first > owner[0]):
                owner = (first, name)
        found.append(Definition(match.group(1), start, end, "method" if owner else "function", owner[1] if owner else None))
    return found


def _split_top(body: str) -> List[str]:
    items: List[str] = []
    depth = 0
    current = ""
    for char in body:
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
        if char == "," and depth == 0:
            items.append(current)
            current = ""
        else:
            current += char
    items.append(current)
    return [item.strip() for item in items if item.strip()]


def _expand(spec: str, prefix: List[str]) -> Iterator[Tuple[List[str], Optional[str]]]:
    """`(path segments, alias)` for every name a `use` brings in: `a::{b, c as d}` gives a::b and a::c with the alias d."""
    spec = " ".join(spec.split())
    if "{" in spec:
        head, rest = spec.split("{", 1)
        base = prefix + [part for part in head.replace(" ", "").split("::") if part]
        for item in _split_top(rest.rsplit("}", 1)[0]):
            yield from _expand(item, base)
        return
    name, _, alias = spec.partition(" as ")
    segments = prefix + [part for part in name.replace(" ", "").split("::") if part]
    if segments and segments[-1] == "self":
        segments = segments[:-1]
    yield segments, (alias.strip() or None)


def _module_dir(root: Path, rel: str) -> Path:
    """The folder that holds the child modules of this file: its own folder for mod.rs, lib.rs and main.rs, a folder named after it otherwise."""
    path = root / rel
    return path.parent if path.name in _ROOT_FILES else path.parent / path.stem


def _src_root(root: Path, rel: str) -> Optional[Path]:
    here = (root / rel).parent
    for base in (here, *here.parents):
        if not inside(base, root):
            break
        if (base / "Cargo.toml").is_file():
            return base / "src"
    for base in (here, *here.parents):
        if not inside(base, root):
            break
        if base.name == "src":
            return base
    return None


def _find(folder: Path, name: str) -> Optional[Path]:
    for candidate in (folder / f"{name}.rs", folder / name / "mod.rs"):
        if candidate.is_file():
            return candidate
    return None


def _resolve(root: Path, rel: str, segments: List[str]):
    """`(file, segments left over, last module name)` for the longest run of modules at the start of `segments`, or None."""
    here = _module_dir(root, rel)
    rest = list(segments)
    base: Optional[Path] = here
    if rest[0] == "crate":
        base, rest = _src_root(root, rel), rest[1:]
    elif rest[0] == "self":
        rest = rest[1:]
    elif rest[0] == "super":
        while rest and rest[0] == "super":
            base, rest = base.parent, rest[1:]
    if base is None or not rest:
        return None
    found: Optional[Path] = None
    last = None
    used = 0
    for segment in rest:
        target = _find(base, segment)
        if target is None or not inside(target, root):
            break
        found, last, used = target, segment, used + 1
        base = base / segment  # the folder that holds this module's own children
    if found is None:
        return None
    return found.relative_to(root).as_posix(), rest[used:], last


def parse(root: Path, rel: str, text: str) -> Parsed:
    found: List[Tuple[int, ImportRef]] = []
    here = _module_dir(root, rel)
    for match in _MOD.finditer(text):
        target = _find(here, match.group(1))
        if target is not None and inside(target, root):
            found.append((match.start(), ImportRef(target.relative_to(root).as_posix(), alias=match.group(1), sep="::")))
    for match in _USE.finditer(text):
        for segments, alias in _expand(match.group(1), []):
            hit = _resolve(root, rel, segments) if segments else None
            if hit is None:
                continue
            path, rest, last = hit
            named = alias if alias and alias != "_" else None
            if not rest:  # the use names a module: it is called as `module::name(`
                ref = ImportRef(path, alias=named or last, sep="::")
            elif rest == ["*"]:
                ref = ImportRef(path, frozenset({"*"}))
            elif alias:  # renamed: the name it is called by is not the one it has in the file
                ref = ImportRef(path)
            else:
                ref = ImportRef(path, frozenset({rest[0]}))
            found.append((match.start(), ref))
    return Parsed([ref for _, ref in sorted(found, key=lambda item: item[0])], _definitions(text))
