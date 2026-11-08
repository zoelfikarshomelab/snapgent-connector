// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isWorkspaceServer } from "../src/domain/agent/session-start.js";

describe("which targets work in a folder", () => {
  test("a server reached over SSH does, even before its tools have been fetched, so the folder and approval pills are shown before Start", () => {
    assert.equal(isWorkspaceServer("ssh-me-h", []), true);
    assert.equal(isWorkspaceServer("ssh-me-h", undefined), true);
  });

  test("the default server still does, and a plain server without a folder tool still does not", () => {
    assert.equal(isWorkspaceServer("snapgent", []), true);
    assert.equal(isWorkspaceServer("git", []), false);
    assert.equal(isWorkspaceServer("git", ["git_status"]), false);
  });

  test("any server that advertises a folder tool does, as before", () => {
    assert.equal(isWorkspaceServer("fork", ["tree"]), true);
    assert.equal(isWorkspaceServer("fork", ["fork/list_dir"]), true);
  });

  test("a name that merely looks like an SSH server is not one", () => {
    assert.equal(isWorkspaceServer("xssh-a", []), false);
    assert.equal(isWorkspaceServer("ssh-", []), false);
  });
});
