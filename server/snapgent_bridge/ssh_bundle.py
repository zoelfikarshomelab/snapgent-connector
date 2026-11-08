# SPDX-License-Identifier: GPL-3.0-or-later
"""The Snapgent MCP server as one small archive, to put on a server the user connects to, so nothing has to be installed there.

The package only uses Python's standard library, so Python alone can run it straight out of the archive. The archive holds the
source files and nothing else, always in the same order and with the same dates: the same sources give the same bytes, and its
name on the server comes from them, so a changed server is put there again and an unchanged one is left alone."""

import hashlib
import io
import sys
import zipfile
from pathlib import Path
from typing import NamedTuple, Optional

PACKAGE = "snapgent_mcp"
_STAMP = (1980, 1, 1, 0, 0, 0)


class Bundle(NamedTuple):
    data: bytes
    digest: str  # 16 hex digits of the archive's SHA-256: part of its name on the server


def package_dir() -> Path:
    """Where the package's source files are: next to this program in a clone, inside the unpacked program when it is packaged."""
    if getattr(sys, "frozen", False):
        bundled = Path(getattr(sys, "_MEIPASS", ".")) / PACKAGE
        if bundled.is_dir():
            return bundled
    import snapgent_mcp
    return Path(snapgent_mcp.__file__).resolve().parent


def build_bundle(package: Optional[Path] = None) -> Bundle:
    root = package or package_dir()
    sources = sorted((path for path in root.rglob("*.py") if "__pycache__" not in path.parts),
                     key=lambda path: path.relative_to(root).as_posix())
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sources:
            info = zipfile.ZipInfo(f"{PACKAGE}/{path.relative_to(root).as_posix()}", _STAMP)
            info.external_attr = 0o644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes())
    data = buffer.getvalue()
    return Bundle(data, hashlib.sha256(data).hexdigest()[:16])
