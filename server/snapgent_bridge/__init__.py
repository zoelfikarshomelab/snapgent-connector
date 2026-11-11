"""Local bridge between the browser extension and MCP servers."""

import sys
from pathlib import Path


def _read_version() -> str:
    """The project's version, from the one `VERSION` file in the repo root (packed next to the program in the one-file build)."""
    bundle = getattr(sys, "_MEIPASS", None)
    path = Path(bundle) / "VERSION" if bundle else Path(__file__).resolve().parents[2] / "VERSION"
    return path.read_text(encoding="utf-8").strip()


BRIDGE_VERSION = _read_version()
