import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { formatClock, formatDuration } from "../src/domain/tools/run-times.js";
import { createTerminal } from "../src/page/terminal.js";

describe("run times", () => {
  test("the clock shows hours, minutes and seconds, padded", () => {
    assert.equal(formatClock(new Date(2026, 10, 10, 9, 3, 7).getTime()), "09:03:07");
    assert.equal(formatClock(new Date(2026, 10, 10, 23, 59, 59).getTime()), "23:59:59");
    assert.equal(formatClock(NaN), "");
  });

  test("a duration is short and says when it was under a second", () => {
    assert.deepEqual([formatDuration(300), formatDuration(45000), formatDuration(125000), formatDuration(3720000)], ["<1 s", "45 s", "2 min 5 s", "1 h 2 min"]);
    assert.equal(formatDuration(-1), "");
  });
});

describe("the terminal shows what ran and when", () => {
  test("the info strip and the tab tooltip carry the full command and its times", () => {
    const { window } = new JSDOM("<!doctype html><body></body>");
    let clock = new Date(2026, 10, 10, 14, 3, 22).getTime();
    const t = createTerminal({ document: window.document, diag: () => {}, now: () => clock });
    t.start();
    const long = `npm run build -- ${"--flag ".repeat(30)}`.trim();
    t.begin({ key: "k1", name: "run_command", label: long });
    const meta = window.document.querySelector(".zs-t-meta");
    assert.equal(meta.hidden, false);
    assert.equal(window.document.querySelector(".zs-t-cmd").textContent, `$ ${long}`, "the command is not cut");
    assert.match(window.document.querySelector(".zs-t-times").textContent, /Started 14:03:22 · running/);
    clock += 108000;
    t.finish("k1", "success");
    assert.match(window.document.querySelector(".zs-t-times").textContent, /Started 14:03:22 · ended 14:05:10 · took 1 min 48 s/);
    const tip = window.document.querySelector(".zs-t-tab").title;
    assert.ok(tip.includes(long) && tip.includes("14:03:22"), "the tooltip has what the badge cuts off");
  });

  test("the log file of a running command is shown beside the times and is not part of its output", () => {
    const { window } = new JSDOM("<!doctype html><body></body>");
    const t = createTerminal({ document: window.document, diag: () => {}, now: () => 0 });
    t.start();
    t.begin({ key: "k2", name: "run_command", label: "docker build ." });
    t.ingest({ jobKey: "k2", seq: 1, stream: "log", text: "/tmp/snapgent-r7-abc.log" });
    assert.match(window.document.querySelector(".zs-t-times").textContent, /running · log \/tmp\/snapgent-r7-abc\.log/);
    assert.equal(window.document.querySelectorAll(".zs-t-term > *").length, 0, "the path is not drawn as output");
    t.finish("k2", "success");
    assert.doesNotMatch(window.document.querySelector(".zs-t-times").textContent, /log \/tmp/);
  });
});
