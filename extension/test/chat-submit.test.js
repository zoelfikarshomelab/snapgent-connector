// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createChat } from "../src/page/chat.js";
import { SESSION_PHRASE } from "../src/domain/constants.js";

// Older Node versions have no File; the output-file module only needs something with a name to hand to the provider.
globalThis.File ??= class { constructor(parts, name) { this.parts = parts; this.name = name; } };

const long = "x".repeat(30000);

function setup() {
  const typed = [];
  const attached = [];
  const editor = { text: "" };
  const provider = {
    id: "x",
    userCount: () => 1,
    assistantCount: () => 1,
    lastAssistant: () => null,
    streamLen: () => 0,
    isGenerating: () => false,
    isBusyNow: () => false,
    editorText: () => editor.text,
    async typeAndSend(text) { typed.push(text); editor.text = ""; },
    async attachFile(file, method) { attached.push({ name: file.name, method }); },
  };
  const chat = createChat({
    document: {},
    provider,
    state: {},
    visibility: { isHidden: () => false, waitUntilVisible: async () => true, parkHidden: async () => 0 },
    catalogue: { knows: () => true, names: () => new Set() },
    diag() {},
    cover() {},
    banner() {},
    budget: { asFile: () => true, limit: () => 20000 },
  });
  return { chat, typed, attached };
}

describe("what goes into the chat as a file and what is typed", () => {
  test("a long message that only quotes the session words (a tagged file that mentions them) is attached, not typed whole", async () => {
    const { chat, typed, attached } = setup();
    await chat.turns.submit(`Attached files:\n${SESSION_PHRASE}\n${long}`);
    assert.equal(attached.length, 1);
    assert.match(typed[0], /^\[This message was too long to type/);
    assert.ok(typed[0].length < 1000, "only the short note was typed");
  });

  test("the start message goes through submitInline and is typed as it is, never attached", async () => {
    const { chat, typed, attached } = setup();
    const start = `proj ${SESSION_PHRASE} ${long}`;
    await chat.turns.submitInline(start);
    assert.equal(attached.length, 0);
    assert.equal(typed[0], start);
  });
});
