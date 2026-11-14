import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { exampleCall } from "../src/domain/tools/example-call.js";
import { parseToolCalls } from "../src/domain/parser/index.js";
import { openCommandExamples } from "../src/ui/command-examples.js";
import { createTerminal } from "../src/page/terminal.js";
import { BLOCK_SPEC } from "../src/domain/tools/call-format.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const tool = (name, properties, required = [], description = "First line\nSecond line") => ({ name, description, inputSchema: { properties, required } });

describe("exampleCall", () => {
  test("a command without parameters has empty params", () => {
    assert.deepEqual(exampleCall(tool("git_status", {})), { name: "git_status", description: "First line", call: '{"command":"git_status","params":{}}', optional: [] });
  });

  test("required parameters are filled, the others are only named", () => {
    const example = exampleCall(tool("read_files", { paths: { type: "array", items: { type: "string" } }, max_total_chars: { type: "integer" } }, ["paths"]));
    assert.equal(example.call, '{"command":"read_files","params":{"paths":["path/to/file.txt"]}}');
    assert.deepEqual(example.optional, ["max_total_chars"]);
  });

  test("an array of objects gets one item, an enum its first value, a prefixed name its bare name", () => {
    const patch = exampleCall(tool("snapgent/apply_patch", {
      path: { type: "string" },
      edits: { type: "array", items: { type: "object", properties: { old_text: { type: "string" }, new_text: { type: "string" } }, required: ["old_text", "new_text"] } },
      mode: { type: "string", enum: ["a", "b"] },
    }, ["path", "edits", "mode"]));
    assert.equal(patch.call, '{"command":"apply_patch","params":{"path":"path/to/file.txt","edits":[{"old_text":"old text","new_text":"new text"}],"mode":"a"}}');
  });

  test("what it writes is read back by the parser the terminal uses", () => {
    const [call] = parseToolCalls(exampleCall(tool("search_files", { path: { type: "string" }, query: { type: "string" } }, ["path", "query"])).call);
    assert.equal(call.tool, "search_files");
    assert.deepEqual(call.arguments, { path: "path/to/file.txt", query: "text to find" });
  });

  test("in the command block the example is written as a block, and it is read back the same", () => {
    const example = exampleCall(tool("run_command", { command: { type: "string" }, args: { type: "array", items: { type: "string" } } }, ["command"]), BLOCK_SPEC);
    assert.ok(example.call.startsWith("```command\nname: run_command"));
    const [call] = parseToolCalls(example.call, { complete: true });
    assert.equal(call.tool, "run_command");
    assert.equal(call.arguments.command, "git");
  });
});

describe("command examples popup", () => {
  const examples = [
    { name: "git_status", description: "<b>Status</b>", call: '{"command":"git_status","params":{}}', optional: [] },
    { name: "tree", description: "Tree", call: '{"command":"tree","params":{}}', optional: ["path", "max_depth"] },
  ];
  const open = (over = {}) => {
    const w = new JSDOM("<!doctype html><body></body>").window;
    const events = [];
    openCommandExamples({ document: w.document, examples, copy: async (text) => { events.push(["copy", text]); return true; }, onUse: (text) => events.push(["use", text]), ...over });
    return { doc: w.document, events };
  };

  test("one card per command with its call, optional names, and nothing becomes markup", () => {
    const { doc } = open();
    const cards = [...doc.querySelectorAll(".zs-ex")];
    assert.equal(cards.length, 2);
    assert.equal(cards[1].querySelector(".zs-ex-json").textContent, '{"command":"tree","params":{}}');
    assert.equal(cards[1].querySelector(".zs-ex-opt").textContent, "Optional: path, max_depth");
    assert.equal(doc.querySelector("b.zs-ex-name").textContent, "git_status");
    assert.equal(cards[0].querySelector(".zs-ex-desc b"), null);
  });

  test("Copy hands over the call and says so; Use passes it on and closes the popup", async () => {
    const { doc, events } = open();
    const first = doc.querySelector(".zs-ex");
    first.querySelector(".zs-ex-copy").click();
    await flush();
    assert.deepEqual(events, [["copy", examples[0].call]]);
    assert.match(first.querySelector(".zs-ex-copy").textContent, /Copied/);
    first.querySelector(".zs-ex-use").click();
    assert.deepEqual(events[1], ["use", examples[0].call]);
    assert.equal(doc.getElementById("zs-mcp-pop"), null);
  });

  test("a failed copy is said, and with no commands the popup explains why", async () => {
    const failing = open({ copy: async () => { throw new Error("no"); } });
    failing.doc.querySelector(".zs-ex-copy").click();
    await flush();
    assert.match(failing.doc.querySelector(".zs-ex-copy").textContent, /failed/);
    const empty = open({ examples: [] });
    assert.match(empty.doc.querySelector(".zs-mcp-pop-body").textContent, /No commands are available/);
  });
});

describe("the terminal's Examples button", () => {
  test("opens the examples of the active commands, and Use fills the input", () => {
    const { window } = new JSDOM("<!doctype html><body></body>");
    const t = createTerminal({ document: window.document, diag: () => {} });
    t.setTools(() => [tool("git_status", {})]);
    window.document.querySelector(".zs-t-examples").click();
    assert.equal(window.document.querySelectorAll(".zs-ex").length, 1);
    window.document.querySelector(".zs-ex-use").click();
    assert.equal(window.document.querySelector(".zs-t-input").value, '{"command":"git_status","params":{}}');
  });

  test("the examples are written in the shape the AI is taught", () => {
    const { window } = new JSDOM("<!doctype html><body></body>");
    const t = createTerminal({ document: window.document, diag: () => {} });
    t.setTools(() => [tool("git_status", {})]);
    t.setCallFormat(() => BLOCK_SPEC);
    window.document.querySelector(".zs-t-examples").click();
    assert.match(window.document.querySelector(".zs-ex-json").textContent, /```command\nname: git_status/);
  });
});
