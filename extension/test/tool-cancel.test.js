// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ToolCatalogue } from "../src/application/tool-catalogue.js";
import { ToolRunner } from "../src/application/tool-runner.js";
import { DEFAULT_TEMPLATES } from "../src/domain/prompt/templates.js";
import { fakeBridge, fakeSession, fakeSink, fakeTimers, fakeVisibility, flush, tool } from "./support/fakes.js";

// A call that never answers, so Stop is what ends it.
const hangs = () => new Promise(() => {});

function setup(server, tools) {
  const timers = fakeTimers();
  const bridge = fakeBridge({ tools, results: { run_command: hangs, echo: hangs } });
  const session = fakeSession({ target: server, enabled: new Set([server]), servers: [{ id: server, alive: true, tools: tools.length }] });
  const catalogue = new ToolCatalogue({ bridge, session, now: timers.now });
  const runner = new ToolRunner({ bridge, catalogue, session, visibility: fakeVisibility(), sink: fakeSink(), timers, templates: () => DEFAULT_TEMPLATES });
  return { runner, bridge, session, timers };
}

async function stopDuring(t, call) {
  const pending = t.runner.run(call, { jobKey: "k1" });
  await flush();
  t.session.state.stopped = true;
  t.timers.advance(150);
  return pending;
}

describe("Stop ends the command on the machine, not only the wait", () => {
  test("a server reached over SSH is told to cancel the job, as the default server is", async () => {
    const t = setup("ssh-me-h", [tool("tree", {}, "ssh-me-h"), tool("run_command", { command: { type: "string" } }, "ssh-me-h")]);
    assert.match((await stopDuring(t, { tool: "run_command", arguments: { command: "sleep", args: ["99"] } })).text, /stopped/);
    assert.equal(t.bridge.calls.length, 2, "the command, then the cancellation");
    assert.equal(t.bridge.calls[1].server, "ssh-me-h");
    const sent = Object.values(t.bridge.calls[1].arguments);
    assert.ok(sent.includes("cancel") && sent.includes("k1"), "the cancellation names the job");
  });

  test("a server with no folder tool knows nothing of jobs, so it is not sent one", async () => {
    const t = setup("other", [tool("echo", {}, "other")]);
    assert.match((await stopDuring(t, { tool: "echo" })).text, /stopped/);
    assert.equal(t.bridge.calls.length, 1);
  });
});
