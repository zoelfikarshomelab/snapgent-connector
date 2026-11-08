# SPDX-License-Identifier: GPL-3.0-or-later
"""JavaScript and TypeScript adapter for the relations footer.

Regular expressions only, on purpose: a real parser is a heavy dependency for a program that ships as one file. The imports are the
static ones that name a relative path (`import ... from`, `import "x"`, `require("x")`). The end of a function is found by matching
braces while skipping strings and comments, which is coarse (a regular expression literal holding a quote or a brace can fool it)
but right for ordinary code."""

import bisect
import os
import re
from pathlib import Path
from typing import Iterator, List, Optional, Tuple

from .model import Definition, ImportRef, Parsed, inside

EXTENSIONS = (".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts")
_NL = "\n"
_BLANKS = " " + chr(9)
_FROM = re.compile(r'\b(?:import|export)\s+([^\'";()]*?)\s*from\s*[\'"]([^\'"]+)[\'"]')
_SIDE = re.compile(r'\bimport\s*[\'"]([^\'"]+)[\'"]')
_REQUIRE = re.compile(r'(?:(?:const|let|var)\s+(\{[^}]*\}|[\w$]+)\s*=\s*)?\brequire\(\s*[\'"]([^\'"]+)[\'"]\s*\)')
# Three kinds of definition, one capture group each: `function name(`, `const name = function / (...) => / x =>`, and `class name`.
_DEFINITION = re.compile(
    r'^[ \t]*(?:export[ \t]+(?:default[ \t]+)?)?(?:async[ \t]+)?function\b[ \t]*\*?[ \t]*([\w$]+)[ \t]*\('
    r'|^[ \t]*(?:export[ \t]+)?(?:const|let|var)[ \t]+([\w$]+)[ \t]*=[ \t]*(?:async[ \t]+)?(?:function\b|\([^)\n]*\)[ \t]*=>|[\w$]+[ \t]*=>)'
    r'|^[ \t]*(?:export[ \t]+(?:default[ \t]+)?)?(?:abstract[ \t]+)?class[ \t]+([\w$]+)', re.M)


def _skip_string(text: str, i: int) -> int:
    quote = text[i]
    j = i + 1
    while j < len(text):
        char = text[j]
        if char == chr(92):  # a backslash: the next character is escaped
            j += 2
            continue
        if char == quote:
            return j + 1
        if char == _NL and quote != "`":
            return j  # an unterminated quote (an apostrophe in a regex or in JSX text): stop at the line end instead of swallowing the file
        j += 1
    return len(text)


def _code_chars(text: str, i: int) -> Iterator[Tuple[int, str]]:
    """(index, character) of everything that is code: strings and comments are skipped."""
    n = len(text)
    while i < n:
        char = text[i]
        if char in ("'", '"', "`"):
            i = _skip_string(text, i)
            continue
        if char == "/" and text[i + 1:i + 2] == "/":
            end = text.find(_NL, i)
            i = n if end < 0 else end
            continue
        if char == "/" and text[i + 1:i + 2] == "*":
            end = text.find("*/", i + 2)
            i = n if end < 0 else end + 2
            continue
        yield i, char
        i += 1


def _matching(text: str, i: int, opening: str, closing: str) -> Optional[int]:
    """Index of the bracket that closes the one at `i`, or None."""
    depth = 0
    for position, char in _code_chars(text, i):
        if char == opening:
            depth += 1
        elif char == closing:
            depth -= 1
            if depth == 0:
                return position
    return None


def _first_brace(text: str, i: int) -> Optional[int]:
    for position, char in _code_chars(text, i):
        if position - i > 1000:  # a declaration without a body (an overload, an abstract method): do not read on through the file
            return None
        if char == "{":
            return position
    return None


def _braced(text: str) -> frozenset:
    """The real names in `{ a, b as c, type D }` (what is taken from the module, not what it is called here)."""
    names = set()
    for part in text.replace("{", " ").replace("}", " ").split(","):
        word = part.split(" as ")[0].split(":")[0].strip()
        if word.startswith("type "):
            word = word[5:].strip()
        if re.fullmatch(r"[\w$]+", word):
            names.add(word)
    return frozenset(names)


def _clause(clause: str) -> Tuple[frozenset, Optional[str]]:
    brace = re.search(r"\{([^}]*)\}", clause)
    names = _braced(brace.group(1)) if brace else frozenset()
    star = re.search(r"\*\s*as\s+([\w$]+)", clause)
    alias = star.group(1) if star else None
    if alias is None:
        default = re.match(r"\s*([\w$]+)\s*(?:,|$)", clause)
        alias = default.group(1) if default and default.group(1) != "type" else None
    return names, alias


def _resolve(root: Path, rel: str, spec: str) -> Optional[str]:
    """The workspace file a relative import names; packages (`react`) are not in the workspace and are left out."""
    if not spec.startswith("."):
        return None
    base = Path(os.path.normpath(os.path.join(str((root / rel).parent), spec)))
    if not inside(base, root):
        return None
    candidates = [base] + [Path(str(base) + ext) for ext in EXTENSIONS] + [base / ("index" + ext) for ext in EXTENSIONS]
    if base.suffix in (".js", ".mjs", ".cjs", ".jsx"):  # TypeScript writes the compiled extension in the import
        candidates += [base.with_suffix(ext) for ext in (".ts", ".tsx", ".mts", ".cts")]
    for candidate in candidates:
        if candidate.suffix.lower() in EXTENSIONS and candidate.is_file():
            return candidate.relative_to(root).as_posix()
    return None


def _end_line(text: str, match, group: int, line_of) -> Optional[int]:
    if "=>" in match.group(0):
        i = text.find("=>", match.start()) + 2
        while i < len(text) and text[i] in _BLANKS:
            i += 1
        if i >= len(text) or text[i] != "{":
            eol = text.find(_NL, i)  # an expression body: taken to end on its first line
            return line_of(len(text) if eol < 0 else eol)
        opening = i
    elif group == 3:
        opening = _first_brace(text, match.end())
    else:
        paren = match.end() - 1 if group == 1 else text.find("(", match.end())
        closing = _matching(text, paren, "(", ")") if paren >= 0 else None
        opening = _first_brace(text, closing + 1) if closing is not None else None
    close = _matching(text, opening, "{", "}") if opening is not None else None
    return line_of(close) if close is not None else None


def _definitions(text: str) -> List[Definition]:
    starts = [0] + [i + 1 for i, char in enumerate(text) if char == _NL]

    def line_of(offset: int) -> int:
        return bisect.bisect_right(starts, offset)

    found: List[Definition] = []
    for match in _DEFINITION.finditer(text):
        group = match.lastindex
        found.append(Definition(match.group(group), line_of(match.start(group)), _end_line(text, match, group, line_of)))
    return found


def parse(root: Path, rel: str, text: str) -> Parsed:
    found: List[Tuple[int, ImportRef]] = []
    for match in _FROM.finditer(text):
        path = _resolve(root, rel, match.group(2))
        if path:
            names, alias = _clause(match.group(1))
            found.append((match.start(), ImportRef(path, names, alias)))
    for match in _SIDE.finditer(text):
        path = _resolve(root, rel, match.group(1))
        if path:
            found.append((match.start(), ImportRef(path)))
    for match in _REQUIRE.finditer(text):
        path = _resolve(root, rel, match.group(2))
        if not path:
            continue
        target = match.group(1) or ""
        if target.startswith("{"):
            found.append((match.start(), ImportRef(path, _braced(target))))
        else:
            found.append((match.start(), ImportRef(path, alias=target or None)))
    return Parsed([ref for _, ref in sorted(found, key=lambda item: item[0])], _definitions(text))
