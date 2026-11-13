import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { bareToolName, isKnownName } from "../src/domain/tools/names.js";
import { isolationError } from "../src/domain/tools/isolation.js";
import { toFeedback } from "../src/domain/tools/result-feedback.js";
import { renderCommandList, renderServerList } from "../src/domain/tools/virtual-commands.js";

describe("names", () => {
  test("bareToolName strips a server prefix", () => {
    assert.equal(bareToolName("snapgent/read_file"), "read_file");
    assert.equal(bareToolName("read_file"), "read_file");
    assert.equal(bareToolName(undefined), "");
  });

  test("isKnownName matches across prefixes and rejects empty input", () => {
    const names = new Set(["snapgent/read_file", "git_status"]);
    assert.equal(isKnownName(names, "read_file"), true);
    assert.equal(isKnownName(names, "other/git_status"), true);
    assert.equal(isKnownName(names, "nope"), false);
    assert.equal(isKnownName(new Set(), "read_file"), false);
    assert.equal(isKnownName(names, ""), false);
  });
});

describe("isolationError", () => {
  test("allows an enabled target with a bare or matching-prefix name", () => {
    assert.equal(isolationError({ name: "read_file", target: "snapgent", targetEnabled: true }), null);
    assert.equal(isolationError({ name: "snapgent/read_file", target: "snapgent", targetEnabled: true }), null);
  });
  test("refuses a disabled target and a foreign prefix", () => {
    assert.match(isolationError({ name: "x", target: "snapgent", targetEnabled: false }), /disabled/);
    assert.match(isolationError({ name: "evil/x", target: "snapgent", targetEnabled: true }), /Only the selected target/);
  });
});

describe("virtual commands", () => {
  test("renderCommandList: ordered refusals, then the scoped catalogue", () => {
    const tools = [{ name: "a", description: "A", inputSchema: {} }];
    const base = { name: "list_commands", target: "snapgent", enabled: true, tools };
    assert.match(renderCommandList({ ...base, asked: "other" }).body, /not available/);
    assert.match(renderCommandList({ ...base, enabled: false }).body, /disabled/);
    assert.match(renderCommandList({ ...base, tools: [] }).body, /No commands available/);
    assert.match(renderCommandList({ ...base, tools: [{ ...tools[0], server: "other" }] }).body, /has no commands available/);
    assert.match(renderCommandList(base).body, /snapgent commands \(1\):\n\na: A/);
    assert.equal(renderCommandList({ ...base, asked: "other" }).isError, true, "a refusal is a failure");
    assert.equal(renderCommandList(base).isError, false);
  });

  test("renderServerList falls back to 'unknown' when the bridge reported nothing", () => {
    assert.match(renderServerList({ servers: [], target: "snapgent" }).body, /unknown \(bridge did not report server health\)/);
    assert.match(renderServerList({ servers: [{ id: "snapgent", alive: false }], target: "snapgent" }).body, /offline \(no tools\)/);
  });
});

describe("toFeedback", () => {
  const opts = { name: "read_file", supportsVision: false };

  test("success, empty success, and a parameter complaint disguised as success", () => {
    assert.deepEqual(toFeedback({ ok: true, text: "x" }, opts), { body: "x", isError: false });
    assert.deepEqual(toFeedback({ ok: true, text: "" }, opts), { body: "(the command returned nothing)", isError: false });
    const complaint = toFeedback({ ok: true, text: "path is required" }, opts);
    assert.equal(complaint.isError, true);
    assert.match(complaint.body, /a parameter of this command is missing or wrong: path is required/);
  });

  test("timeout message uses the configured seconds", () => {
    const feedback = toFeedback({ ok: false, kind: "timeout", error: "slow" }, { ...opts, timeoutSeconds: 5 });
    assert.match(feedback.body, /timed out after 5 seconds/);
    assert.equal(feedback.isError, true);
  });

  test("a cancellation from the terminal reads as one, not as an error to fix", () => {
    const feedback = toFeedback({ ok: false, kind: "cancelled", error: "The command was cancelled by the user before it finished." }, opts);
    assert.match(feedback.body, /stopped before it finished/);
    assert.match(feedback.body, /cancelled by the user/);
    assert.doesNotMatch(feedback.body, /^ERROR/);
  });

  test("no result at all means the bridge is offline", () => {
    const feedback = toFeedback(undefined, opts);
    assert.match(feedback.body, /bridge is unreachable/);
    assert.equal(feedback.isError, true);
  });
});
