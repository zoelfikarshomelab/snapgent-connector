import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { AgentLoop } from "../src/application/agent-loop.js";
import { clampDelaySeconds, delayLabel, MAX_DELAY_SECONDS, randomDelaySeconds, sleepLabel } from "../src/domain/tools/delay.js";
import { runningLabel } from "../src/domain/tools/result-summary.js";
import { flush } from "./support/fakes.js";
import { createLoopHarness, textTurn, toolTurn } from "./support/loop-fakes.js";

const both = { kind: "tool", item: {}, calls: [{ tool: "a" }, { tool: "b" }] };

/** Let the fake clock run, then let the loop carry on with what it did. */
const tick = async (h, ms = 1000) => { h.timers.advance(ms); await flush(); };
const labels = (h) => h.events("progress").map((e) => e[1]);

describe("the pauses the user sets", () => {
  test("a pause is a whole number of seconds within what the panel allows, and nothing unusable means no pause", () => {
    assert.equal(clampDelaySeconds(0), 0);
    assert.equal(clampDelaySeconds(12), 12);
    assert.equal(clampDelaySeconds("7"), 7);
    assert.equal(clampDelaySeconds(-3), 0);
    assert.equal(clampDelaySeconds("junk"), 0);
    assert.equal(clampDelaySeconds(undefined), 0);
    assert.equal(clampDelaySeconds(MAX_DELAY_SECONDS + 100), MAX_DELAY_SECONDS);
  });

  test("the random pause is a whole number of seconds up to the most the user allowed", () => {
    assert.equal(randomDelaySeconds(0), 0);
    assert.equal(randomDelaySeconds(10, () => 0), 0);
    assert.equal(randomDelaySeconds(10, () => 0.999), 10);
    assert.equal(randomDelaySeconds(10, () => 0.5), 5);
    assert.ok(randomDelaySeconds(10, () => 0.42) <= 10);
  });

  test("the composer says how long is left, and the running line names the pause that follows", () => {
    assert.equal(delayLabel(5), "delay 5");
    assert.equal(delayLabel(0), "delay 0");
    assert.equal(sleepLabel(10), "sleep 10");
    assert.equal(sleepLabel(0), "", "no pause means nothing to name");
    assert.equal(runningLabel({ tool: "run_command" }, { index: 0, total: 3 }, 10), "1/3 · run_command · sleep 10");
    assert.equal(runningLabel({ tool: "run_command" }, { index: 0, total: 3 }), "1/3 · run_command", "without a pause the line says nothing about one");
  });
});

describe("the pause between the commands of a reply", () => {
  test("the running line names the pause that follows, and the pause is counted down in the composer", async () => {
    const h = createLoopHarness({ responses: [both, textTurn], delay: { perCommand: () => 2 } });
    const promise = new AgentLoop(h.deps).run("base-0");
    await flush();
    assert.deepEqual(labels(h), ["Running command 1/2 · a · sleep 2", "delay 2"]);
    await tick(h);
    assert.deepEqual(labels(h), ["Running command 1/2 · a · sleep 2", "delay 2", "delay 1"]);
    // The pause is over: the next command starts, and its own pause is named as well.
    await tick(h);
    assert.deepEqual(labels(h), ["Running command 1/2 · a · sleep 2", "delay 2", "delay 1", "Running command 2/2 · b · sleep 2", "delay 2"]);
    await tick(h);
    await tick(h);
    await promise;
    assert.equal(h.state.submitted.length, 1, "the results go back after the pauses");
    assert.ok(labels(h).includes("2/2 commands done · sending the results to the AI…"));
  });

  test("the pause does not count in the place of the command in the batch", async () => {
    const h = createLoopHarness({ responses: [both, textTurn], delay: { perCommand: () => 1 } });
    const promise = new AgentLoop(h.deps).run("base-0");
    await flush();
    for (let i = 0; i < 6; i++) await tick(h);
    await promise;
    const running = labels(h).filter((text) => text.startsWith("Running"));
    assert.deepEqual(running, ["Running command 1/2 · a · sleep 1", "Running command 2/2 · b · sleep 1"]);
  });

  test("no pause means the commands run one after the other, as before", async () => {
    const h = createLoopHarness({ responses: [both, textTurn] });
    await new AgentLoop(h.deps).run("base-0");
    assert.deepEqual(labels(h), ["Running command 1/2 · a", "Running command 2/2 · b", "2/2 commands done · sending the results to the AI…"]);
  });

  test("a Stop during the pause ends the wait, and nothing is sent back to the AI", async () => {
    const h = createLoopHarness({ responses: [both, textTurn], delay: { perCommand: () => 5 } });
    const promise = new AgentLoop(h.deps).run("base-0");
    await flush();
    assert.deepEqual(labels(h), ["Running command 1/2 · a · sleep 5", "delay 5"]);
    h.state.stopped = true; // the user pressed Stop while the agent was waiting
    await tick(h);
    await promise;
    assert.equal(h.state.submitted.length, 0, "the results are not sent after a Stop");
    assert.ok(!labels(h).some((text) => text.startsWith("Running command 2/2")), "the second command does not run");
  });
});

describe("the random pause after the commands of a reply", () => {
  test("it waits after the last command, before the results go back", async () => {
    const h = createLoopHarness({ responses: [both, textTurn], delay: { random: () => 3 }, random: () => 0.99 });
    const promise = new AgentLoop(h.deps).run("base-0");
    await flush();
    assert.deepEqual(labels(h), ["Running command 1/2 · a", "Running command 2/2 · b", "delay 3"]);
    assert.equal(h.state.submitted.length, 0, "the results wait for the pause");
    await tick(h);
    await tick(h);
    assert.deepEqual(labels(h).slice(-2), ["delay 2", "delay 1"]);
    await tick(h);
    await promise;
    assert.equal(h.state.submitted.length, 1, "the results go back after the pause");
    assert.ok(labels(h).includes("2/2 commands done · sending the results to the AI…"));
  });

  test("without a random pause the results go back at once", async () => {
    const h = createLoopHarness({ responses: [toolTurn("read_file"), textTurn] });
    await new AgentLoop(h.deps).run("base-0");
    assert.deepEqual(labels(h), ["Running read_file", "Command done · sending the results to the AI…"]);
  });
});
