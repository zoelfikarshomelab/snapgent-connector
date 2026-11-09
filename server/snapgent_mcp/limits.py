"""Size and time limits. One place, so a change here is visible and testable."""

IGNORED_DIRECTORIES = frozenset({
    ".git", ".hg", ".svn", ".venv", "venv", "node_modules",
    "__pycache__", ".pytest_cache", ".mypy_cache", ".next", "dist", "build",
})
MAX_RESULTS = 2000
MAX_LISTED_FILES = 50_000             # the most find_files may be asked for (the extension lists a whole project to tag files)
MAX_FILE_CHARS = 200_000
MAX_OUTPUT_CHARS = 1_000_000          # hard ceiling for any size the extension asks for
COMMAND_OUTPUT_CHARS = 40_000         # a command's output is shortened to head + tail beyond this unless told otherwise
OUTPUT_CACHE_MAX_RUNS = 20
OUTPUT_CACHE_MAX_CHARS = 20_000_000
GIT_LIST_SECONDS = 15                 # how long to wait for git to list a project before walking the folder instead
MAX_FILES_PER_READ = 50
MAX_SEARCH_FILE_BYTES = 1_000_000     # search_files skips bigger files (bundles, dumps, logs)
SEARCH_TIME_SECONDS = 20              # search_files returns what it has found by then, and says so
MAX_LINES_PER_READ = 1000
DEFAULT_RELATIONS_DEPTH = 3           # read_files(relations=true): how many calls deep the chain goes unless told otherwise
MAX_RELATIONS_DEPTH = 8
MAX_FOOTER_LINES = 28                 # the most lines of that chain printed per file; the rest is counted as "+N lainnya"
MAX_TREE_DEPTH = 8
SAFE_PROJECT_SCRIPTS = frozenset({"build", "check", "format", "lint", "test", "typecheck"})

COMMAND_TIMEOUT_SECONDS = 120  # as long as the bridge waits for one tool call (builds, installs)
SCRIPT_TIMEOUT_SECONDS = 300
COMMIT_TIMEOUT_SECONDS = 120

# A command still running when one call has to answer is not stopped: it goes on in the background and the call answers with what it
# printed so far. The call answers BEFORE the extension and the bridge give up on it (they wait COMMAND_TIMEOUT_SECONDS), so what the
# model gets back is an answer, never a timeout.
FOREGROUND_SECONDS = 100
WAIT_DEFAULT_SECONDS = 90       # wait_command: how long one call waits for a background command unless told otherwise
WAIT_MAX_SECONDS = 100
BACKGROUND_MAX_SECONDS = 3600   # a command still running after this long is stopped
BACKGROUND_KEPT_SECONDS = 3600  # a finished background command (and its log file) is forgotten after this long
MAX_BACKGROUND_RUNS = 5         # running at once; beyond that a command that takes too long is stopped, as it always was

# Live command output: a running command reports what it prints while it runs (the terminal panel).
STREAM_MAX_CHUNKS = 5_000      # live messages per command; past this the stream says so and goes quiet (the full output is still kept)
STREAM_MAX_CHARS = 1_000_000   # live characters per command, same deal
STREAM_TAIL_CHARS = 2_000      # how much of a cancelled command's output travels with the cancellation
TERMINAL_TABS_KEPT = 20        # finished commands remembered per page before the oldest is dropped
