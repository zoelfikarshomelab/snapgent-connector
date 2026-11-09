# SPDX-License-Identifier: GPL-3.0-or-later
"""A short preview of a long command output: its first and last lines, and how to read the rest.

A build or a test run can print thousands of lines and almost all of them are noise to the model. It gets the start (what ran) and the
end (where it failed), plus a note that says how to read the middle without running the command again."""

import json

from .limits import PREVIEW_HEAD_LINES, PREVIEW_TAIL_LINES


def line_count(text: str) -> int:
    """Lines the way get_command_output numbers them."""
    return len(text.splitlines())


def is_long(text: str, head: int = PREVIEW_HEAD_LINES, tail: int = PREVIEW_TAIL_LINES) -> bool:
    return line_count(text) > head + tail


def _call(run_id: str, **params) -> str:
    return json.dumps({"command": "get_command_output", "params": {"run_id": run_id, **params}}, separators=(",", ":"))


def preview(text: str, run_id: str, numbered: bool = True, head: int = PREVIEW_HEAD_LINES, tail: int = PREVIEW_TAIL_LINES) -> str:
    """`text` itself when it is short; else its first `head` and last `tail` lines with a note in between.

    `numbered` says whether the line numbers of `text` are the ones get_command_output uses. A slice of a log (what wait_command adds)
    is not numbered, because its first line is somewhere in the middle of the log."""
    lines = text.splitlines()
    if len(lines) <= head + tail:
        return text
    omitted = len(lines) - head - tail
    if numbered:
        scope = (f"{omitted:,} lines left out of the middle ({head + 1:,}-{len(lines) - tail:,} of {len(lines):,}): "
                 f"this is a preview, the first {head} and the last {tail} lines.")
    else:
        scope = f"{omitted:,} lines left out of the middle of this new output: this is a preview, the first {head} and the last {tail} lines."
    note = (f"... [{scope} Read the whole log with {_call(run_id, max_lines=5000)} "
            f"or more of the end (for example to look for an error) with {_call(run_id, start_line=-200)}. "
            "Do not run the command again.] ...")
    shown = "\n".join(lines[:head] + [note] + lines[len(lines) - tail:])
    return shown + "\n" if text.endswith("\n") else shown
