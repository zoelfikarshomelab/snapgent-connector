"""Tools that look at files without changing them."""

import fnmatch
import os
import re
import subprocess
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple

from ..context import Context
from ..limits import IGNORED_DIRECTORIES, MAX_FILES_PER_READ, MAX_FILE_CHARS, GIT_LIST_SECONDS, MAX_LISTED_FILES, MAX_OUTPUT_CHARS, MAX_RESULTS, MAX_SEARCH_FILE_BYTES, DEFAULT_RELATIONS_DEPTH, MAX_RELATIONS_DEPTH, MAX_TREE_DEPTH, SEARCH_TIME_SECONDS
from ..paths import relative, resolve_inside, walk_files
from ..relations import build_footer
from ..process import child_environment
from ..security import TRUSTED
from ..security.files import is_sensitive
from .registry import READ, tool
from .schema import BOOL, DEPTH, RANGES, RELATIONS, STR, STR_LIST, integer

# Junk that is almost never useful as source context, on top of IGNORED_DIRECTORIES.
# Kept as names so it works regardless of where in the tree they appear.
DEFAULT_EXCLUDED = frozenset({
    "vendor", "node_modules", ".git", "dist", "build", "target", ".next", ".nuxt",
    "__pycache__", ".venv", "venv", ".pytest_cache", ".mypy_cache", ".tox",
    ".idea", ".vscode", ".cache", "coverage", ".turbo", ".svelte-kit",
    # Toolchains and package caches that live inside a project folder in some setups, whatever the framework.
    ".rustup", ".cargo", ".gradle", ".m2", ".npm", ".pnpm-store", ".yarn", ".nuget", ".pub-cache", ".dart_tool", ".terraform",
    ".parcel-cache", ".angular", ".nx", ".expo", ".sass-cache", ".bundle", ".stack-work", ".eggs", "__pypackages__", "site-packages",
    "bower_components", "Pods", "DerivedData", "elm-stuff",
})
# Never hidden by .gitignore: where Plan mode keeps its plans.
ALWAYS_LISTED = ".snapgent"


def _excluded_names(exclude, only: bool = False) -> set:
    """Folder names to skip: the built-in lists plus `exclude`; with `only`, just `exclude` (the user's own list replaces the built-in one).
    `.git` is never entered either way."""
    names = {".git"} if only else set(IGNORED_DIRECTORIES) | set(DEFAULT_EXCLUDED)
    if exclude:
        for item in exclude:
            if isinstance(item, str) and item.strip():
                names.add(item.strip())
    return names


def _git_listing(ctx: Context, base: Path):
    """The files git itself counts as the project's: tracked ones, and new ones that .gitignore does not hide. None when this is not a
    git checkout (or git is missing or slow): the caller then walks the folder. .gitignore is what every framework already uses to say
    which folders are generated, so it replaces a list of names that could never be complete."""
    start = relative(base, ctx.root)
    command = ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"] + ([] if start == "." else ["--", start])
    try:
        done = subprocess.run(command, cwd=str(ctx.root), capture_output=True, timeout=GIT_LIST_SECONDS, env=child_environment())
    except (OSError, subprocess.SubprocessError):
        return None
    if done.returncode != 0:
        return None
    return sorted({path for path in done.stdout.decode("utf-8", errors="replace").split("\0") if path})


def _visible_files(ctx: Context, base: Path, excluded: set):
    """`(path, relative path)` of every file under `base` the agent may see. A base that is itself inside an excluded folder has none."""
    hide = ctx.policy.mode != TRUSTED
    start = relative(base, ctx.root)
    if start != "." and any(part in excluded for part in start.split("/")):
        return
    listed = _git_listing(ctx, base)
    if listed is None:
        candidates = walk_files(base, ctx.root, excluded)
    else:
        seen = set(listed)
        extra = [(path, rel) for path, rel in walk_files(ctx.root / ALWAYS_LISTED, ctx.root, excluded)
                 if rel not in seen and (start == "." or rel.startswith(f"{start}/"))] if (ctx.root / ALWAYS_LISTED).is_dir() else []
        candidates = ((ctx.root / rel, rel) for rel in listed if not any(part in excluded for part in rel.split("/")))
        candidates = _then(candidates, extra)
    for file_path, rel in candidates:
        if listed is not None and not file_path.is_file():  # removed since it was committed, or a submodule
            continue
        if hide and is_sensitive(rel):
            continue
        yield file_path, rel


def _then(first, second):
    yield from first
    yield from second


def _tree(ctx: Context, base: Path, max_depth, excluded: set) -> str:
    lines: List[str] = [str(base.name or ".")]
    count = [0]

    def walk(current: Path, depth: int, prefix: str):
        if (max_depth is not None and depth > max_depth) or count[0] >= MAX_RESULTS:
            return
        try:
            children = sorted(current.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
        except OSError:
            return
        # Skip excluded directories and hidden secret files (non-trusted mode).
        filtered = []
        for child in children:
            if child.name in excluded:
                continue
            if child.is_file() and ctx.policy.mode != TRUSTED and is_sensitive(relative(child, ctx.root)):
                continue
            filtered.append(child)
        for index, child in enumerate(filtered):
            if count[0] >= MAX_RESULTS:
                return
            last = index == len(filtered) - 1
            branch = "└── " if last else "├── "
            lines.append(f"{prefix}{branch}{child.name}")
            count[0] += 1
            if child.is_dir():
                extension = "    " if last else "│   "
                walk(child, depth + 1, prefix + extension)

    walk(base, 0, "")
    if count[0] >= MAX_RESULTS:
        lines.append("... [truncated]")
    return "\n".join(lines)


@tool("tree", "Show a filtered tree of workspace files and folders. Junk folders are excluded by default. No depth limit by default.",
      {"path": STR, "max_depth": integer(0, MAX_TREE_DEPTH), "exclude": STR_LIST}, risk=READ)
def tree(ctx: Context, path: str = ".", max_depth: int = None, exclude: List[str] = None) -> str:
    target = resolve_inside(path, ctx.root)
    if not target.is_dir():
        raise NotADirectoryError(f"Not a directory: {path}")
    if max_depth is not None:
        max_depth = max(0, min(int(max_depth), MAX_TREE_DEPTH))
    return _tree(ctx, target, max_depth, _excluded_names(exclude))


@tool("find_files", "Find workspace files by glob pattern.", {"path": STR, "pattern": STR, "exclude": STR_LIST, "max_results": integer(1, MAX_LISTED_FILES), "exclude_only": BOOL}, risk=READ)
def find_files(ctx: Context, path: str = ".", pattern: str = "*", exclude: List[str] = None, max_results: int = None,
               exclude_only: bool = False) -> List[str]:
    base = resolve_inside(path, ctx.root)
    if not base.exists():
        raise FileNotFoundError(f"Path not found: {path}")
    if not base.is_dir():
        raise NotADirectoryError(f"Not a directory: {path}")
    excluded = _excluded_names(exclude, exclude_only)
    limit = MAX_RESULTS if max_results is None else max(1, min(int(max_results), MAX_LISTED_FILES))
    start = relative(base, ctx.root)
    cut = 0 if start == "." else len(start) + 1
    everything = pattern == "*"
    matches: List[str] = []
    for file_path, rel in _visible_files(ctx, base, excluded):  # stops walking the moment there is enough
        if everything or fnmatch.fnmatch(file_path.name, pattern) or fnmatch.fnmatch(rel[cut:], pattern):
            matches.append(rel)
            if len(matches) >= limit:
                break
    return matches


@tool("search_files", "Search text in workspace files. Returns compact 'path:line: text' lines.",
      {"path": STR, "query": STR, "file_pattern": STR, "case_sensitive": BOOL, "exclude": STR_LIST}, ["path", "query"], risk=READ)
def search_files(ctx: Context, path: str, query: str, file_pattern: str = "*", case_sensitive: bool = False,
                exclude: List[str] = None) -> List[str]:
    target = resolve_inside(path, ctx.root)
    if not target.exists():
        raise FileNotFoundError(f"Path not found: {path}")
    if not query.strip():
        raise ValueError("Search query cannot be empty.")
    needle = query if case_sensitive else query.lower()
    excluded = _excluded_names(exclude)
    matches: List[str] = []
    deadline = time.monotonic() + SEARCH_TIME_SECONDS
    for file_path, rel in ([(target, relative(target, ctx.root))] if target.is_file() else _visible_files(ctx, target, excluded)):
        if time.monotonic() >= deadline:
            matches.append(f"[search stopped after {SEARCH_TIME_SECONDS} seconds; narrow it with a smaller path or file_pattern]")
            break
        if not fnmatch.fnmatch(file_path.name, file_pattern):
            continue
        try:
            if file_path.stat().st_size > MAX_SEARCH_FILE_BYTES:
                continue
            with file_path.open("rb") as handle:
                data = handle.read()
        except OSError:
            continue
        if b"\0" in data[:8192]:  # a binary file
            continue
        text = data.decode("utf-8", errors="replace")
        if needle not in (text if case_sensitive else text.lower()):
            continue
        for line_number, line in enumerate(text.splitlines(), start=1):
            if needle in (line if case_sensitive else line.lower()):
                matches.append(f"{rel}:{line_number}: {line[:500]}")
                if len(matches) >= MAX_RESULTS:
                    return matches
    return matches


def _read(ctx: Context, path: str) -> str:
    target = resolve_inside(path, ctx.root)
    if not target.is_file():
        raise FileNotFoundError(f"File not found: {path}")
    content = target.read_text(encoding="utf-8", errors="replace")
    return content[:MAX_FILE_CHARS] + "\n[truncated]" if len(content) > MAX_FILE_CHARS else content


def _relative(ctx: Context, path: str):
    """The workspace-relative form of `path`, or None when it leaves the workspace."""
    try:
        return relative(resolve_inside(path, ctx.root), ctx.root)
    except ValueError:
        return None


def _is_on(value) -> bool:
    """A flag the model may send as text."""
    return value is True or (isinstance(value, str) and value.strip().lower() == "true")


def _relations_footer(ctx: Context, path: str, depth, read_here: set) -> str:
    rel = _relative(ctx, path)
    if rel is None:
        return ""
    levels = DEFAULT_RELATIONS_DEPTH if depth is None else max(1, min(int(depth), MAX_RELATIONS_DEPTH))
    return build_footer(ctx.root, rel, levels, read_here - {rel})


_LINE_RANGE = re.compile(r"(\d+)(?:\s*-\s*(\d+))?")


def _parse_lines(spec) -> List[Tuple[int, int]]:
    """Inclusive 1-based (start, end) pairs from "21-40", "5-10,40-60", a single line "7", or a list of such strings."""
    items = [spec] if isinstance(spec, str) else spec
    if not isinstance(items, (list, tuple)) or not items or not all(isinstance(item, str) for item in items):
        raise ValueError('lines must be a string like "21-40" or "5-10,40-60", or a list of such strings.')
    found: List[Tuple[int, int]] = []
    for item in items:
        for part in item.split(","):
            text = part.strip()
            match = _LINE_RANGE.fullmatch(text)
            if not match:
                raise ValueError(f'Bad line range "{text}": use "21-40" or a single line such as "7".')
            start = int(match.group(1))
            end = int(match.group(2) or start)
            if start < 1 or end < start:
                raise ValueError(f'Bad line range "{text}": lines start at 1 and the end cannot come before the start.')
            found.append((start, end))
    return found


def _merge_ranges(found: List[Tuple[int, int]]) -> List[Tuple[int, int]]:
    """Sorted, with overlapping or touching ranges joined, so no line is printed twice."""
    merged: List[List[int]] = []
    for start, end in sorted(found):
        if merged and start <= merged[-1][1] + 1:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return [(start, end) for start, end in merged]


def _targets(paths: List[str], ranges) -> List[Tuple[str, Any]]:
    """What to read, in order, as `(path, line specs)`; the specs are None for a whole file. A path named in `ranges` is read only for
    those lines even when `paths` lists it too (the model asked for a piece, not for the file), and a path only in `ranges` comes after the others."""
    wanted: Dict[str, List[Any]] = {}
    if ranges is not None:
        if not isinstance(ranges, list):
            raise ValueError('ranges must be a list of [path, lines] pairs, for example [["src/a.js", "21-40"]].')
        for entry in ranges:
            if not (isinstance(entry, (list, tuple)) and len(entry) == 2 and isinstance(entry[0], str)):
                raise ValueError('Each ranges entry must be [path, lines], for example ["src/a.js", "21-40"].')
            wanted.setdefault(entry[0], []).append(entry[1])
    targets: List[Tuple[str, Any]] = []
    emitted = set()
    for path in paths:
        if path not in wanted:
            targets.append((path, None))
        elif path not in emitted:
            targets.append((path, wanted[path]))
            emitted.add(path)
    targets.extend((path, specs) for path, specs in wanted.items() if path not in emitted)
    return targets


def _full_block(ctx: Context, path: str) -> str:
    content = _read(ctx, path)
    numbered = "\n".join(f"{number}: {line}" for number, line in enumerate(content.splitlines(), start=1))
    return f"===== {path} =====\n{numbered}\n"


def _range_block(ctx: Context, path: str, specs: List[Any]) -> str:
    """Only the asked lines, numbered as in the file so they match edit_file and the relations footer. A range that runs past the end is
    cut there and a note says how long the file is, so the model knows it saw everything that exists."""
    target = resolve_inside(path, ctx.root)
    if not target.is_file():
        raise FileNotFoundError(f"File not found: {path}")
    wanted: List[Tuple[int, int]] = []
    for spec in specs:
        wanted.extend(_parse_lines(spec))
    lines = target.read_text(encoding="utf-8", errors="replace").splitlines()
    total = len(lines)
    notes: List[str] = []
    shown: List[str] = []
    for start, end in _merge_ranges(wanted):
        if start > total:
            notes.append(f"[lines {start}-{end} are past the end: the file has only {total} lines]")
            continue
        if end > total:
            notes.append(f"[lines {start}-{end} cut at line {total}: the file has only {total} lines]")
            end = total
        shown.extend(f"{number}: {lines[number - 1]}" for number in range(start, end + 1))
    body = "\n".join(notes + shown)
    return f"===== {path} =====\n{body}\n" if body else f"===== {path} =====\n"


@tool("read_files", f"Read up to {MAX_FILES_PER_READ} workspace files as bulk text with line numbers. "
                   f"Total output is capped; files that do not fit are listed as remaining instead of being truncated. "
                   f"relations=true adds the files each one calls into; ranges reads only some lines.",
      {"paths": STR_LIST, "max_total_chars": integer(1, MAX_OUTPUT_CHARS), "ranges": RANGES, "relations": RELATIONS, "depth": DEPTH}, ["paths"], risk=READ)
def read_files(ctx: Context, paths: List[str], max_total_chars: int = None, ranges: List[Any] = None,
               relations: bool = False, depth: int = None) -> str:
    if len(paths) > MAX_FILES_PER_READ:
        raise ValueError(f"Read at most {MAX_FILES_PER_READ} files per request.")
    targets = _targets(paths, ranges)
    if len(targets) > MAX_FILES_PER_READ:
        raise ValueError(f"Read at most {MAX_FILES_PER_READ} files per request.")
    budget = MAX_FILE_CHARS if max_total_chars is None else max(1, min(int(max_total_chars), MAX_OUTPUT_CHARS))
    relations_on = _is_on(relations)
    read_here = {rel for rel in (_relative(ctx, name) for name, _ in targets) if rel} if relations_on else set()
    chunks: List[str] = []
    remaining: List[str] = []
    used = 0
    for path, specs in targets:
        try:
            block = _full_block(ctx, path) if specs is None else _range_block(ctx, path, specs)
        except (FileNotFoundError, ValueError, OSError) as error:
            chunks.append(f"===== {path} =====\nERROR: {error}\n")
            continue
        if relations_on:
            try:
                block += _relations_footer(ctx, path, depth, read_here)
            except (OSError, ValueError) as error:
                block += f"→ relasi: gagal ({error})\n"
        if not chunks and len(block) > budget:
            # Even the first file would overflow the budget: keep its start rather than blow the limit.
            block = block[:budget] + f"\n[cut at {budget:,} characters: this file is larger than the space left]\n"
            chunks.append(block)
            used += len(block)
        elif not chunks or used + len(block) <= budget:
            chunks.append(block)
            used += len(block)
        else:
            remaining.append(path)
    result = "".join(chunks)
    if remaining:
        result += f"\n... [{len(remaining)} more files remaining: {', '.join(remaining)}]\n"
    return result if result.strip() else "(no files read)"