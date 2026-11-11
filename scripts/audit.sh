#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Security audit for the whole repository: run it before pushing (the CI runs the same script).
# Checks: npm dependencies, Python dependencies, Python source (bandit) and secrets in tracked files.
# Needs node/npm and uv (uvx fetches bandit and pip-audit on demand). Every check runs; the exit code says if any failed.
# NPM_AUDIT_LEVEL (default: moderate) and BANDIT_LEVEL (default: -ll, medium and up) tune how strict it is.

set -u
cd "$(dirname "$0")/.."

NPM_AUDIT_LEVEL="${NPM_AUDIT_LEVEL:-moderate}"
BANDIT_LEVEL="${BANDIT_LEVEL:--ll}"
failed=()
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

step() { printf '\n== %s ==\n' "$1"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "missing tool: $1 ($2)" >&2; exit 2; }; }
need npm "install Node.js"
need uv "https://docs.astral.sh/uv/"

step "Extension dependencies (npm audit, level $NPM_AUDIT_LEVEL)"
(cd extension && npm audit --audit-level="$NPM_AUDIT_LEVEL") || failed+=("npm audit")

step "Python dependencies (pip-audit)"
# No requirements file exists: the runtime needs websockets, the Windows/Linux build needs pyinstaller. Pin them as a fresh install would.
if printf 'websockets\npyinstaller\n' | uv pip compile - -q -o "$tmp/requirements.txt" \
  && uvx pip-audit --disable-pip --no-deps -r "$tmp/requirements.txt"; then :; else failed+=("pip-audit"); fi

step "Python source (bandit $BANDIT_LEVEL)"
uvx bandit -r server scripts "$BANDIT_LEVEL" -q || failed+=("bandit")

step "Secrets in tracked files"
PATTERN='-----BEGIN ([A-Z]+ )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,}|sk-[A-Za-z0-9]{32,}|xox[baprs]-[A-Za-z0-9-]{10,}'
# git grep exits 0 on a match, 1 on none and 2 or more on an error: an error must not pass as "none found".
hits="$(git grep -nIE -e "$PATTERN" -- . ':(exclude)extension/package-lock.json' ':(exclude)scripts/audit.sh')"
status=$?
if [ "$status" -eq 0 ]; then
  echo "$hits"
  echo "possible secret above" >&2
  failed+=("secrets")
elif [ "$status" -eq 1 ]; then
  echo "none found"
else
  echo "git grep failed (exit $status)" >&2
  failed+=("secrets (scan error)")
fi

printf '\n'
if [ "${#failed[@]}" -gt 0 ]; then
  echo "AUDIT FAILED: ${failed[*]}" >&2
  exit 1
fi
echo "AUDIT OK"
