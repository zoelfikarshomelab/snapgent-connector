import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ToolCatalogue } from "../src/application/tool-catalogue.js";
import { ToolRunner } from "../src/application/tool-runner.js";
import { WAIT_STUCK_MINUTES, waitOut } from "../src/application/wait-loop.js";
import { DEFAULT_TEMPLATES } from "../src/domain/prompt/templates.js";
import { fakeBridge, fakeSession, fakeSink, fakeTimers, fakeVisibility, tool } from "./support/fakes.js";

const running = (body) => ({ ok: true, text: `⏳ Still running (1 min 30 s so far, run_id r7). Output since your last look:\n${body}\nWait again with wait_command, or end it with stop_command.` });
const finished = (body) => ({ ok: true, text: `✓ Finished with exit code 0 after 3 min 0 s (run_id r7). Output since your last look:\n${body}` });
const QUIET = "(no new output)";

/** A clock that moves by what each call waited, and a call that answers from a script. */
function scripted(answer) {
  const log = { seconds: [], t: 0 };
  const callOnce = async (seconds) => {
    log.seconds.push(seconds);
    log.t += seconds * 1000;
    return answer(log.seconds.length);
  };
  return { log, callOnce, options: { isStopped: () => false, now: () => log.t } };
}

describe("waiting out a background command", () => {
  test("repeats the wait until it ends and gives the model one answer with everything printed meanwhile", async () => {
    const answers = [running("line a"), running(QUIET), running("line b"), finished("line c")];
    const { log, callOnce, options } = scripted((n) => answers[n - 1]);
    const result = await waitOut(callOnce, options);
    assert.equal(log.seconds.length, 4);
    assert.ok(log.seconds.every((s) => s === 90));
    assert.ok(result.ok);
    assert.doesNotMatch(result.text, /^⏳/);
    assert.match(result.text, /Finished with exit code 0/);
    for (const line of ["line a", "line b", "line c"]) assert.ok(result.text.includes(line), line);
    assert.ok(result.text.indexOf("line a") < result.text.indexOf("line b") && result.text.indexOf("line b") < result.text.indexOf("line c"));
  });

  test("no new output for the whole stuck window gives up, says the command was not stopped and keeps what it printed", async () => {
    const { log, callOnce, options } = scripted((n) => (n === 1 ? running("first words") : running(QUIET)));
    const result = await waitOut(callOnce, options);
    assert.equal(result.ok, false);
    assert.match(result.error, new RegExp(`No new output for ${WAIT_STUCK_MINUTES} min`));
    assert.match(result.error, /NOT stopped/);
    assert.match(result.error, /run_id r7/);
    assert.ok(result.error.includes("first words"));
    // 90 s per call: the call that printed something, then the quiet ones until the window is full
    assert.equal(log.seconds.length, 1 + (WAIT_STUCK_MINUTES * 60) / 90);
  });

  test("new output restarts the stuck clock: a slow command that keeps printing is never taken for stuck", async () => {
    const { log, callOnce, options } = scripted((n) => (n === 32 ? finished("end") : n === 16 ? running("progress") : running(QUIET)));
    const result = await waitOut(callOnce, options);
    assert.ok(result.ok);
    assert.equal(log.seconds.length, 32);
    assert.ok(result.text.includes("progress") && result.text.includes("end"));
  });

  test("a failure ends the wait with the output printed before it in front of the error", async () => {
    const answers = [running("building…"), { ok: false, error: "Command exited with status 3 after 1 min:\ntail" }];
    const { callOnce, options } = scripted((n) => answers[n - 1]);
    const result = await waitOut(callOnce, options);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes("building…"));
    assert.match(result.error, /status 3/);
  });

  test("a stop ends the wait at once, whether the call reports it or the flag is raised between two waits", async () => {
    const reported = scripted(() => ({ ok: false, kind: "stopped" }));
    assert.deepEqual(await waitOut(reported.callOnce, reported.options), { ok: false, kind: "stopped" });
    const flagged = scripted(() => running("x"));
    assert.deepEqual(await waitOut(flagged.callOnce, { ...flagged.options, isStopped: () => true }), { ok: false, kind: "stopped" });
    assert.equal(flagged.log.seconds.length, 1);
  });

  test("a result that is not a 'still running' answer is passed on untouched", async () => {
    const done = finished("all");
    const { callOnce, options } = scripted(() => done);
    assert.equal(await waitOut(callOnce, options), done);
  });
});

describe("ToolRunner: wait_command", () => {
  test("is repeated by the runner and the model only sees the final answer", async () => {
    const timers = fakeTimers();
    let calls = 0;
    const bridge = fakeBridge({
      tools: [tool("wait_command", { run_id: { type: "string" } })],
      results: { wait_command: () => { calls++; return calls < 3 ? running(`part ${calls}`) : finished("last"); } },
    });
    const session = fakeSession();
    const catalogue = new ToolCatalogue({ bridge, session, now: timers.now });
    const runner = new ToolRunner({ bridge, catalogue, session, visibility: fakeVisibility(), sink: fakeSink(), timers, templates: () => DEFAULT_TEMPLATES });
    const answer = await runner.run({ tool: "wait_command", arguments: { run_id: "r7", wait_seconds: 5 } });
    assert.equal(bridge.calls.length, 3);
    assert.ok(bridge.calls.every((call) => call.arguments.wait_seconds === 90 && call.arguments.run_id === "r7"));
    assert.ok(answer.text.startsWith("I ran `wait_command r7"));
    assert.match(answer.body, /Finished with exit code 0/);
    assert.ok(answer.body.includes("part 1") && answer.body.includes("part 2") && answer.body.includes("last"));
  });
});
