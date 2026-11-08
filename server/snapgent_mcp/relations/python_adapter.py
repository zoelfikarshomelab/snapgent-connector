# SPDX-License-Identifier: GPL-3.0-or-later
"""Python adapter for the relations footer: imports and definitions from the standard `ast` module."""

import ast
from pathlib import Path
from typing import List, Optional

from .model import Definition, ImportRef, Parsed, inside


def _module_file(root: Path, rel: str, dotted: str, level: int) -> Optional[str]:
    """The workspace file a module name refers to, or None (the standard library and installed packages are not in the workspace).
    An absolute name is tried from the importing file's folder and every folder above it up to the root, because projects keep their
    packages under `src/`, `server/` and the like without saying so."""
    here = (root / rel).parent
    parts = [part for part in dotted.split(".") if part]
    if level:
        base = here
        for _ in range(level - 1):
            base = base.parent
        bases = [base]
    else:
        bases = [here, *here.parents]
    for base in bases:
        if not inside(base, root):
            continue
        candidates = [base.joinpath(*parts[:-1], parts[-1] + ".py")] if parts else []
        candidates.append(base.joinpath(*parts, "__init__.py"))
        for candidate in candidates:
            if candidate.is_file():
                return candidate.relative_to(root).as_posix()
    return None


def _from_refs(root: Path, rel: str, node: ast.ImportFrom) -> List[ImportRef]:
    module = node.module or ""
    refs: List[ImportRef] = []
    taken: List[str] = []
    for name in node.names:
        if name.name == "*":
            continue
        submodule = _module_file(root, rel, f"{module}.{name.name}" if module else name.name, node.level)
        if submodule:  # `from pkg import mod`: the name is a module, called as `mod.f()`
            refs.append(ImportRef(submodule, alias=name.asname or name.name))
        else:
            taken.append(name.name)
    source = _module_file(root, rel, module, node.level)
    if source and (taken or not refs):
        refs.append(ImportRef(source, frozenset(taken)))
    return refs


def parse(root: Path, rel: str, text: str) -> Parsed:
    try:
        tree = ast.parse(text)
    except (SyntaxError, ValueError) as error:
        raise ValueError(f"not valid Python: {error}") from error
    definitions: List[Definition] = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            # A decorator belongs to the function: reading from the def line would cut it off.
            start = min([node.lineno] + [decorator.lineno for decorator in node.decorator_list])
            definitions.append(Definition(node.name, start, node.end_lineno))
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for name in node.names:
                path = _module_file(root, rel, name.name, 0)
                if path:
                    found.append((node.lineno, ImportRef(path, alias=name.asname or (None if "." in name.name else name.name))))
        elif isinstance(node, ast.ImportFrom):
            found.extend((node.lineno, ref) for ref in _from_refs(root, rel, node))
    return Parsed([ref for _, ref in sorted(found, key=lambda item: item[0])], definitions)
