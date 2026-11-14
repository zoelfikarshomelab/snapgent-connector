import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { feed, lineHtml, state } from "../src/ui/ansi.js";
import { createTerminal } from "../src/page/terminal.js";

describe("ansi.feed", () => {
  const drained = (initial, ...chunks) => {
    let parsed = null;
    const lines = [];
    for (const chunk of chunks) {
      parsed = feed(parsed ? parsed.state : initial, chunk);
      lines.push(...parsed.lines);
    }
    return { lines, state: parsed.state };
  };

  test("splits lines and clears by carriage return, as a progress bar does", () => {
    const { lines } = drained(state(), "first\n", "33%\r50%\r60%\n");
    assert.equal(lines[0].map((s) => s.text).join(""), "first");
    assert.equal(lines[1].map((s) => s.text).join(""), "60%");
  });

  test("an escape cut by the chunk end continues in the next chunk", () => {
    const { lines } = drained(state(), "before \x1b[3", "2mwarning\nplain\n");
    const one = lines[0];
    assert.equal(one.map((s) => s.text).join(""), "before warning");
    assert.ok(one.every((s) => !s.codes.some((code) => code >= 90)), "the bare '3' was not read as a code");
  });

  test("colours are parsed into codes and rendered as classes", () => {
    const { lines } = drained(state(), "\x1b[1;31merror \x1b[32mok\x1b[0m\n");
    const html = lineHtml(lines[0]);
    assert.match(html, /zs-a-fg1/);
    assert.match(html, /zs-a-fg2/);
    assert.match(html, /zs-a-bold/);
    assert.ok(!lineHtml(lines[0]).includes("&lt;"), "plain text stays plain");
  });

  test("HTML in the output is escaped", () => {
    const { lines } = drained(state(), "<script>alert(1)</script>\n");
    const html = lineHtml(lines[0]);
    assert.doesNotMatch(html, /<script/);
    assert.match(html, /&lt;script/);
  });
});

describe("a command typed into the terminal", () => {
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  function setup() {
    const { window } = new JSDOM("<!doctype html><body></body>");
    const ran = [];
    const t = createTerminal({ document: window.document, diag: () => {} });
    t.setRunner(async (call) => { ran.push(call); return { text: "ok", body: "ok", isError: false }; });
    return { window, t, ran, $: (s) => window.document.querySelector(s) };
  }

  test("a command copied from the chat runs, in the command block", async () => {
    const page = setup();
    // Exactly what the copy gives: the block's text, without a fence and without a newline at the end.
    page.$(".zs-t-input").value = "name: run_command\ncommand: sleep 5";
    page.$(".zs-t-run").click();
    await flush();
    assert.deepEqual(page.ran, [{ tool: "run_command", arguments: { command: "sleep 5" } }]);
  });

  test("a command in the JSON shape runs as well", async () => {
    const page = setup();
    page.$(".zs-t-input").value = '{"command":"run_command","params":{"command":"sleep 5"}}';
    page.$(".zs-t-run").click();
    await flush();
    assert.deepEqual(page.ran, [{ tool: "run_command", arguments: { command: "sleep 5" } }]);
  });

  test("text that is no command is refused, and the hint says how to write one", () => {
    const page = setup();
    page.$(".zs-t-input").value = "just some words";
    page.$(".zs-t-run").click();
    assert.equal(page.ran.length, 0);
    assert.match(page.$(".zs-t-hint").textContent, /No command found/);
  });

  test("the empty box shows the shape in use", () => {
    const page = setup();
    assert.equal(page.$(".zs-t-input").placeholder, '{"command":"git_status","params":{}}');
    page.t.setCallFormat(() => "```command\nname: git_status\n```");
    assert.equal(page.$(".zs-t-input").placeholder, "name: git_status");
  });
});

describe("the terminal panel store", () => {
  function setup() {
    const { window } = new JSDOM("<!doctype html><body></body>");
    const events = [];
    const diag = (event, data) => events.push({ event, data });
    const t = createTerminal({ document: window.document, diag });
    t.start();
    return { window, t, events, $: (s) => window.document.querySelector(s), $$: (s) => [...window.document.querySelectorAll(s)] };
  }
  const begin = (t, key = "k1", name = "run_command", label = "npm test") => t.begin({ key, name, label });

  test("an unknown jobKey is left alone: other chats run in other pages", () => {
    const { t } = setup();
    t.ingest({ type: "tool_stream", jobKey: "nope", stream: "stdout", text: "hi\n" });
    assert.equal(t.runningCount(), 0);
  });

  test("a begun command is a running tab, and its chunks become lines", () => {
    const page = setup();
    begin(page.t);
    assert.deepEqual(page.t.runningCount(), 1);
    page.t.ingest({ jobKey: "k1", stream: "stdout", text: "installing\nbundling\n" });
    const body = page.$(".zs-t-term");
    assert.equal(body.querySelectorAll(".zs-t-line").length, 2);
    assert.match(page.$(".zs-t-tab").textContent, /npm test/);
    assert.match(page.$(".zs-t-dot").textContent, /●/);
  });

  test("the tab settles with the call's answer and stops counting as running", () => {
    const page = setup();
    begin(page.t);
    page.t.finish("k1", "success");
    assert.deepEqual(page.t.runningCount(), 0);
    const statuses = page.$$(".zs-t-tab").map((el) => el.className);
    assert.match(statuses.join(" "), /zs-t-success/);
  });

  test("Stop on the running tab goes out through the wired cancel callback", () => {
    const page = setup();
    const asked = [];
    page.t.setCancel((key, name) => asked.push([key, name]));
    begin(page.t);
    page.$(".zs-t-stop").click();
    assert.deepEqual(asked, [["k1", "run_command"]]);
  });

  test("the Stop button is hidden once the command settles", () => {
    const page = setup();
    begin(page.t);
    page.t.finish("k1", "failed");
    assert.equal(page.$(".zs-t-stop").hidden, true);
  });

  test("finished tabs cap: the oldest finished ones go first, the running one never", () => {
    const page = setup();
    for (let index = 0; index < 25; index++) {
      begin(page.t, `k${index}`, "run_command", `command ${index}`);
      page.t.finish(`k${index}`, "success");
    }
    begin(page.t, "running", "run_command", "the running one");
    assert.equal(page.t.runningCount(), 1);
    const keys = page.$$(".zs-t-tab").map((el) => el.dataset.key);
    assert.equal(keys.length, 20, "at most 20 tabs");
    assert.ok(keys.includes("running"));
    assert.ok(!keys.includes("k0"), "the oldest finished tab was dropped");
    assert.ok(keys.includes("k24"), "the newest ones stay");
  });

  test("the brightest lines survive the cap: nothing is written after finish", () => {
    const page = setup();
    begin(page.t);
    page.t.finish("k1", "success");
    page.t.ingest({ jobKey: "k1", stream: "stdout", text: "late\n" });
    assert.equal(page.$(".zs-t-line"), null);
  });

  test("the panel has a resize grip in its free corner", () => {
    const page = setup();
    assert.ok(page.$(".zs-t-grip"), "the bottom-left grip is drawn");
  });

  describe("moving and resizing", () => {
    function placed() {
      const page = setup();
      const { window } = page;
      Object.defineProperty(window.document.documentElement, "clientWidth", { value: 1000, configurable: true });
      Object.defineProperty(window.document.documentElement, "clientHeight", { value: 800, configurable: true });
      const panel = page.$("#zs-term");
      panel.getBoundingClientRect = () => ({ left: 100, right: 500, top: 10, width: 400, height: 300 });
      Object.defineProperty(panel, "offsetWidth", { value: 400, configurable: true });
      Object.defineProperty(panel, "offsetHeight", { value: 300, configurable: true });
      const fire = (el, type, x, y) => el.dispatchEvent(Object.assign(new window.Event(type, { bubbles: true }), { clientX: x, clientY: y }));
      return { panel, handle: page.$(".zs-t-drag"), grip: page.$(".zs-t-grip"), fire };
    }

    test("the panel has a move handle like the Files window", () => {
      const page = setup();
      assert.ok(page.$(".zs-t-drag"), "the move handle is drawn");
    });

    test("dragging the handle moves the panel and keeps it inside the window", () => {
      const { panel, handle, fire } = placed();
      fire(handle, "pointerdown", 200, 200);
      fire(handle, "pointermove", 250, 260);
      assert.equal(panel.style.left, "150px");
      assert.equal(panel.style.top, "70px");
      assert.equal(panel.style.right, "auto");
      assert.equal(panel.style.bottom, "auto");
      fire(handle, "pointermove", 5000, 5000);
      assert.equal(panel.style.left, "600px", "stops at the right edge of the page");
      assert.equal(panel.style.top, "500px", "stops at the bottom of the page");
      fire(handle, "pointerup", 5000, 5000);
      fire(handle, "pointermove", 0, 0);
      assert.equal(panel.style.left, "600px", "nothing changes after the drag ended");
    });

    test("resizing after a move keeps the top and right edges where they are", () => {
      const { panel, grip, fire } = placed();
      fire(grip, "pointerdown", 100, 310);
      fire(grip, "pointermove", 50, 360);
      assert.equal(panel.style.width, "450px");
      assert.equal(panel.style.height, "350px");
      assert.equal(panel.style.right, "500px");
      assert.equal(panel.style.left, "auto");
      assert.equal(panel.style.top, "10px");
      fire(grip, "pointermove", -5000, 9000);
      assert.equal(panel.style.width, "500px", "the left edge stops at the page's left");
      assert.equal(panel.style.height, "790px", "the bottom stops at the page's bottom");
    });
  });
});
