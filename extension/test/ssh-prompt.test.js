import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { mountSshPrompt } from "../src/ui/ssh-prompt.js";

const info = (over = {}) => ({ ok: true, kind: "secret", label: "me@h", text: "Enter passphrase for key 'k':", ...over });

async function open(reply = info()) {
  const { window } = new JSDOM("<!doctype html><body><main id=\"app\"></main></body>");
  const sent = [];
  let closed = 0;
  const runtime = { sendMessage: (message, done) => { sent.push(message); done(message.type === "ssh_prompt_get" ? reply : { ok: true }); } };
  await mountSshPrompt({ document: window.document, runtime, promptId: "p1", close: () => { closed += 1; } });
  const $ = (selector) => window.document.querySelector(selector);
  const settled = () => new Promise((resolve) => setImmediate(resolve));
  return { window, sent, $, closed: () => closed, settled };
}

describe("the SSH question window", () => {
  test("a passphrase is typed hidden, sent when OK is pressed, cleared, and the window closes", async () => {
    const w = await open();
    assert.equal(w.$("h1").textContent, "SSH · me@h");
    assert.equal(w.$(".text").textContent, "Enter passphrase for key 'k':");
    assert.equal(w.$("input").type, "password");
    assert.equal(w.$("input").autocomplete, "off");
    w.$("input").value = "hunter2";
    w.$("form").dispatchEvent(new w.window.Event("submit", { cancelable: true }));
    await w.settled();
    assert.deepEqual(w.sent.at(-1), { type: "ssh_prompt_answer", prompt_id: "p1", answer: "hunter2" });
    assert.equal(w.$("input").value, "");
    assert.equal(w.closed(), 1);
  });

  test("Cancel and Escape answer nothing, and only one answer is ever sent", async () => {
    const w = await open();
    w.$(".cancel").click();
    w.window.document.dispatchEvent(new w.window.KeyboardEvent("keydown", { key: "Escape" }));
    w.$("form").dispatchEvent(new w.window.Event("submit", { cancelable: true }));
    await w.settled();
    const answers = w.sent.filter((m) => m.type === "ssh_prompt_answer");
    assert.deepEqual(answers, [{ type: "ssh_prompt_answer", prompt_id: "p1", answer: null }]);
    assert.equal(w.closed(), 1);
  });

  test("a new host is a yes/no question with no typing: Yes answers yes, No answers no", async () => {
    const yes = await open(info({ kind: "confirm", text: "Continue connecting (yes/no)?" }));
    assert.equal(yes.$("input"), null);
    assert.equal(yes.$(".ok").textContent, "Yes");
    yes.$(".ok").click();
    await yes.settled();
    assert.equal(yes.sent.at(-1).answer, "yes");
    const no = await open(info({ kind: "confirm" }));
    no.$(".cancel").click();
    await no.settled();
    assert.equal(no.sent.at(-1).answer, "no");
  });

  test("what ssh says is text, never markup", async () => {
    const w = await open(info({ label: "<b>x</b>", text: "<img src=x onerror=alert(1)> hello" }));
    assert.equal(w.$("img"), null);
    assert.equal(w.$("b"), null);
    assert.match(w.$(".text").textContent, /<img src=x/);
  });

  test("a question that is no longer waiting says so, sends no answer and offers to close", async () => {
    const w = await open({ ok: false, error: "That question is no longer waiting." });
    assert.match(w.$(".text").textContent, /no longer waiting/);
    assert.equal(w.$("input"), null);
    w.$("button").click();
    assert.equal(w.closed(), 1);
    assert.equal(w.sent.filter((m) => m.type === "ssh_prompt_answer").length, 0);
  });
});

describe("the page and its bundle", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

  test("the page loads only its own script, and the build makes that script", () => {
    const html = read("../static/ssh-prompt.html");
    assert.match(html, /<script src="ssh-prompt\.js"><\/script>/);
    assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)/, "no inline script: the extension's policy would refuse it");
    assert.match(read("../build/build.mjs"), /"ssh-prompt":\s*join\(root, "src\/entry\/ssh-prompt\.js"\)/);
  });
});
