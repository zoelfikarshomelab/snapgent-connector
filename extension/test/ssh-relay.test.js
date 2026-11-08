import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createSshPrompts, replyOf } from "../src/entry/background-ssh.js";
import { MAX_PROMPT_CHARS, promptInfo, promptView } from "../src/domain/ssh/prompt-view.js";

const PAGE = "chrome-extension://abc/ssh-prompt.html";
const fromPage = { url: `${PAGE}?id=p1` };
const fromSite = { url: "https://chatgpt.com/c/1" };
const ask = { type: "ssh_prompt", prompt_id: "p1", kind: "secret", label: "me@h", text: "Enter passphrase for key 'k':" };

function harness({ windows = true } = {}) {
  const log = { created: [], removed: [], answers: [] };
  let next = 10;
  const api = windows ? { create: async (options) => { log.created.push(options); return { id: next++ }; }, remove: async (id) => { log.removed.push(id); } } : undefined;
  const prompts = createSshPrompts({ windows: api, pageUrl: PAGE, answer: async (id, value) => { log.answers.push([id, value]); return { ok: true }; } });
  return { prompts, log };
}

describe("what the page gets back from the bridge", () => {
  test("everything the bridge sent is passed on, without the envelope: the folders used lately and a folder listing are not lost", () => {
    const reply = replyOf({ type: "workspace", id: 7, ok: true, active: "/a", open: ["/a"], pinned: null, recent: ["/r1", "/r2"] });
    assert.deepEqual(reply, { ok: true, active: "/a", open: ["/a"], pinned: null, picked: null, recent: ["/r1", "/r2"] });
    const listing = replyOf({ type: "workspace", id: 8, ok: true, path: "/home/me", parent: "/home", dirs: ["a", "b"], truncated: false });
    assert.deepEqual([listing.path, listing.dirs, listing.open], ["/home/me", ["a", "b"], []]);
  });

  test("a folder answer always has the fields the menus read, and a failure keeps only its reason", () => {
    assert.deepEqual(replyOf({ type: "workspace", id: 1, ok: true }), { ok: true, active: null, open: [], pinned: null, picked: null });
    assert.deepEqual(replyOf({ type: "workspace", id: 1, ok: false, error: "down" }), { ok: false, error: "down" });
  });

  test("an SSH answer is passed on as it is, minus the envelope", () => {
    assert.deepEqual(replyOf({ type: "ssh", id: 3, ok: true, server_id: "ssh-me-h", label: "me@h" }), { ok: true, server_id: "ssh-me-h", label: "me@h" });
    assert.deepEqual(replyOf({ type: "ssh", id: 3, ok: false, error: "Connection cancelled." }), { ok: false, error: "Connection cancelled." });
  });
});

describe("the question window", () => {
  test("a question opens a small window of the extension's own, named by the question's id", async () => {
    const { prompts, log } = harness();
    await prompts.show({ ...ask, prompt_id: "a b&c" });
    assert.equal(log.created.length, 1);
    assert.equal(log.created[0].url, `${PAGE}?id=a%20b%26c`);
    assert.equal(log.created[0].type, "popup");
  });

  test("the window asks what to show and is told; a message that does not come from the window is refused and learns nothing", async () => {
    const { prompts } = harness();
    await prompts.show(ask);
    assert.deepEqual(await prompts.handle({ type: "ssh_prompt_get", prompt_id: "p1" }, fromPage), { ok: true, kind: "secret", label: "me@h", text: "Enter passphrase for key 'k':" });
    for (const sender of [fromSite, undefined, {}, { url: `${PAGE}.evil` }, { url: "chrome-extension://other/ssh-prompt.html?id=p1" }]) {
      assert.deepEqual(await prompts.handle({ type: "ssh_prompt_get", prompt_id: "p1" }, sender), { ok: false, error: "not allowed" }, JSON.stringify(sender));
    }
    assert.equal((await prompts.handle({ type: "ssh_prompt_get", prompt_id: "nope" }, fromPage)).ok, false);
  });

  test("an answer is handed to the bridge once, the window is closed, and a second answer finds nothing waiting", async () => {
    const { prompts, log } = harness();
    await prompts.show(ask);
    assert.deepEqual(await prompts.handle({ type: "ssh_prompt_answer", prompt_id: "p1", answer: "hunter2" }, fromPage), { ok: true });
    assert.deepEqual(log.answers, [["p1", "hunter2"]]);
    assert.deepEqual(log.removed, [10]);
    assert.deepEqual(await prompts.handle({ type: "ssh_prompt_answer", prompt_id: "p1", answer: "again" }, fromPage), { ok: false });
    assert.equal(log.answers.length, 1);
  });

  test("an answer from a chat page is never passed on", async () => {
    const { prompts, log } = harness();
    await prompts.show(ask);
    assert.equal((await prompts.handle({ type: "ssh_prompt_answer", prompt_id: "p1", answer: "stolen" }, fromSite)).ok, false);
    assert.deepEqual(log.answers, []);
  });

  test("an answer that is not text is a cancel", async () => {
    const { prompts, log } = harness();
    await prompts.show(ask);
    await prompts.handle({ type: "ssh_prompt_answer", prompt_id: "p1", answer: 42 }, fromPage);
    assert.deepEqual(log.answers, [["p1", null]]);
  });

  test("closing the window without answering cancels the question, once, and closing after an answer does not", async () => {
    const { prompts, log } = harness();
    await prompts.show(ask);
    prompts.windowClosed(10);
    prompts.windowClosed(10);
    assert.deepEqual(log.answers, [["p1", null]]);
    const again = harness();
    await again.prompts.show(ask);
    await again.prompts.handle({ type: "ssh_prompt_answer", prompt_id: "p1", answer: "x" }, fromPage);
    again.prompts.windowClosed(10); // the window we closed ourselves reports itself closing
    assert.deepEqual(again.log.answers, [["p1", "x"]]);
  });

  test("answered while the window is still opening: the window is closed as soon as it exists", async () => {
    const log = { answers: [], removed: [] };
    let release;
    const windows = { create: () => new Promise((resolve) => { release = () => resolve({ id: 5 }); }), remove: async (id) => { log.removed.push(id); } };
    const prompts = createSshPrompts({ windows, pageUrl: PAGE, answer: async (id, value) => { log.answers.push([id, value]); } });
    const opening = prompts.show(ask);
    assert.deepEqual(await prompts.handle({ type: "ssh_prompt_answer", prompt_id: "p1", answer: "x" }, fromPage), { ok: true });
    release();
    await opening;
    assert.deepEqual(log.removed, [5]);
    assert.deepEqual(log.answers, [["p1", "x"]]);
  });

  test("where no window can be opened the question is answered as cancelled at once, and so when opening it fails", async () => {
    const none = harness({ windows: false });
    await none.prompts.show(ask);
    assert.deepEqual(none.log.answers, [["p1", null]]);
    const answers = [];
    const failing = createSshPrompts({ windows: { create: async () => { throw new Error("no"); }, remove: async () => {} }, pageUrl: PAGE, answer: async (id, value) => { answers.push([id, value]); } });
    await failing.show(ask);
    assert.deepEqual(answers, [["p1", null]]);
  });

  test("when the bridge goes away the windows are closed and nothing is answered", async () => {
    const { prompts, log } = harness();
    await prompts.show(ask);
    prompts.closeAll();
    await Promise.resolve();
    assert.deepEqual(log.removed, [10]);
    assert.deepEqual(log.answers, []);
    assert.equal((await prompts.handle({ type: "ssh_prompt_get", prompt_id: "p1" }, fromPage)).ok, false);
  });

  test("a question without an id is ignored, and only the window's own two messages are handled here", async () => {
    const { prompts, log } = harness();
    await prompts.show({ type: "ssh_prompt", text: "x" });
    assert.deepEqual(log.created, []);
    assert.equal(prompts.handles({ type: "ssh_prompt_get" }), true);
    assert.equal(prompts.handles({ type: "ssh_prompt_answer" }), true);
    assert.equal(prompts.handles({ type: "workspaces" }), false);
    assert.equal(prompts.handles(null), false);
  });
});

describe("how a question is worded", () => {
  test("an unknown kind is hidden like a secret, a long text is cut, and the buttons follow the kind", () => {
    assert.equal(promptInfo({ prompt_id: "p", kind: "weird" }).kind, "secret");
    assert.equal(promptInfo({ prompt_id: "p", text: "x".repeat(MAX_PROMPT_CHARS + 50) }).text.length, MAX_PROMPT_CHARS);
    assert.deepEqual(promptInfo(null), { id: "", kind: "secret", label: "", text: "" });
    assert.deepEqual(promptView(promptInfo({ prompt_id: "p", kind: "confirm", label: "me@h", text: "Continue (yes/no)?" })),
      { title: "SSH · me@h", text: "Continue (yes/no)?", secret: false, confirm: true, ok: "Yes", cancel: "No" });
    assert.deepEqual(promptView(promptInfo({ prompt_id: "p", kind: "secret" })), { title: "SSH", text: "", secret: true, confirm: false, ok: "OK", cancel: "Cancel" });
  });
});
