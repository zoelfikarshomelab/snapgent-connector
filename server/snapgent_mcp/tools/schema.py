"""JSON-schema fragments for tool parameters."""

from typing import Any, Dict, Optional

from ..limits import MAX_RELATIONS_DEPTH

STR: Dict[str, Any] = {"type": "string"}
BOOL: Dict[str, Any] = {"type": "boolean"}
STR_LIST: Dict[str, Any] = {"type": "array", "items": STR}
# read_files: each entry is a [path, lines] pair. The description is what the model reads in the command list, so it carries the format.
RANGES: Dict[str, Any] = {
    "type": "array",
    "description": 'Read only some lines of a file. Each entry is [path, lines], where lines is "21-40", "5-10,40-60" or a list such as ["1-10", "15-25"]; leave lines out ([path], or just the path) to read the whole file. '
                   'A path named here with lines is read only for those lines (numbers stay the file\'s own), even if it is also in paths. A range past the end is cut at the last line and says so.',
    "items": {"type": "array", "minItems": 1},
}


def integer(minimum: Optional[int] = None, maximum: Optional[int] = None) -> Dict[str, Any]:
    schema: Dict[str, Any] = {"type": "integer"}
    if minimum is not None:
        schema["minimum"] = minimum
    if maximum is not None:
        schema["maximum"] = maximum
    return schema


# read_files: the descriptions are what the model reads in the command list.
RELATIONS: Dict[str, Any] = {
    "type": "boolean",
    "description": "Add a footer to each file listing the files it calls into, as a chain with each function's line range and where it is called. "
                   "On by default; pass false to leave the footer out (for example when re-reading a file). Use ranges for the pieces you need afterwards.",
}
DEPTH: Dict[str, Any] = {**integer(1, MAX_RELATIONS_DEPTH), "description": "With relations: how many calls deep the chain goes (default 3)."}
