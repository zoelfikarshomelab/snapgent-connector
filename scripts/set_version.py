#!/usr/bin/env python3
"""Set the version of the whole project from one place.

    python scripts/set_version.py 3.10.0

`VERSION` in the repo root is the number the bridge and the extension build read. This script writes it and brings along the files
that have to repeat it: the package files, the README badge and release links, and the website's "Latest release". The changelog is
written by hand: it only says when the section for the version is missing.
"""

import argparse
import re
import sys
from pathlib import Path
from typing import List, Optional

SEMVER = re.compile(r"\d+\.\d+\.\d+")


def _rewrite(path: Path, pattern: str, make, count: int = 0) -> bool:
    """Apply a regex replacement to a file, byte for byte otherwise. True when the file changed."""
    if not path.is_file():
        return False
    text = path.read_bytes().decode("utf-8")
    new = re.sub(pattern, make, text, count=count)
    if new == text:
        return False
    path.write_bytes(new.encode("utf-8"))
    return True


def set_version(repo: Path, version: str) -> List[str]:
    """Write `version` everywhere it is repeated; returns the files that changed (relative to `repo`)."""
    if not SEMVER.fullmatch(version):
        raise ValueError(f"The version must look like 3.10.0, not {version!r}.")
    changed: List[str] = []

    def note(name: str, did: bool) -> None:
        if did:
            changed.append(name)

    version_file = repo / "VERSION"
    before = version_file.read_text(encoding="utf-8").strip() if version_file.is_file() else None
    if before != version:
        version_file.write_text(version + "\n", encoding="utf-8")
        changed.append("VERSION")
    field = r'("version":\s*")[^"]+(")'
    keep = lambda m: m.group(1) + version + m.group(2)  # noqa: E731
    note("extension/package.json", _rewrite(repo / "extension" / "package.json", field, keep, count=1))
    # The lock file names the root package twice (top level and `packages[""]`); every later "version" is a dependency's.
    note("extension/package-lock.json", _rewrite(repo / "extension" / "package-lock.json", field, keep, count=2))
    note("README.md", _rewrite(repo / "README.md", r"V\d+\.\d+\.\d+", lambda m: "V" + version))
    note("docs/index.html", _rewrite(repo / "docs" / "index.html", r"(Latest release: V)\d+\.\d+(?:\.\d+)?", lambda m: m.group(1) + version))
    return changed


def changelog_has(repo: Path, version: str) -> bool:
    path = repo / "CHANGELOG.md"
    return path.is_file() and re.search(rf"^## \[V?{re.escape(version)}\]", path.read_text(encoding="utf-8"), re.MULTILINE) is not None


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("version", help="for example 3.10.0")
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args(argv)
    try:
        changed = set_version(args.repo, args.version)
    except ValueError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    for name in changed:
        print(f"updated {name}")
    if not changed:
        print("Nothing to change: the version was already set everywhere.")
    if not changelog_has(args.repo, args.version):
        print(f"NOTE: CHANGELOG.md has no section '## [{args.version}]' yet; add it before you tag the release.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
