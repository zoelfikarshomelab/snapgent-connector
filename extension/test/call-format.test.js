import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { classifyReply } from "../src/domain/agent/reply-classifier.js";
import { parseToolCalls } from "../src/domain/parser/tool-call.js";
import { hasOpenToolBlock, hasToolSignature, toolNameFromText } from "../src/domain/parser/detect.js";
import { FEEDBACK } from "../src/domain/prompt/feedback.js";
import { DEFAULT_TEMPLATES, TEMPLATE_NAMES, clampTemplates, ensureCallFormat, renderTemplate } from "../src/domain/prompt/templates.js";
import { buildPromptValues } from "../src/domain/prompt/system-prompt.js";
import { toolsReminder } from "../src/domain/prompt/reminder.js";
import { commandMessage } from "../src/domain/tools/command-message.js";
import { BLOCK_SPEC, BLOCK_SHAPE, JSON_SHAPE, JSON_SPEC, formatOf, renderBlock, shapeOf, specOf } from "../src/domain/tools/call-format.js";

const schemaOf = (name) => ({
  command: { type: "string" },
  args: { type: "array" },
  paths: { type: "array" },
  path: { type: "string" },
  relations: { type: "boolean" },
  max_lines: { type: "integer" },
  old_text: { type: "string" },
  new_text: { type: "string" },
});

const block = (...lines) => ["```command", ...lines, "```"].join("\n");

describe("the command block", () => {
  test("a block is read as a command with its parameters", () => {
    const reply = block("name: run_command", "command: npm test", "args: [\"--watch\"]");
    assert.deepEqual(parseToolCalls(reply, { schemaOf }), [{ tool: "run_command", arguments: { command: "npm test", args: ["--watch"] } }]);
  });

  test("text with quotes and line breaks goes in as it is: nothing is escaped", () => {
    const reply = block("name: edit_file", "path: src/a.js", "old_text: |", '    const x = "hello";', "    const y = 'world';", "new_text: |", '    const x = "bye";');
    const [call] = parseToolCalls(reply, { schemaOf });
    assert.equal(call.tool, "edit_file");
    assert.equal(call.arguments.old_text, 'const x = "hello";\nconst y = \'world\';');
    assert.equal(call.arguments.new_text, 'const x = "bye";');
  });

  test("the parameter types come from the tool: a boolean stays a boolean, a number a number", () => {
    const reply = block("name: read_files", "paths: [\"a.js\"]", "relations: false", "max_lines: 500");
    const [call] = parseToolCalls(reply, { schemaOf });
    assert.deepEqual(call.arguments, { paths: ["a.js"], relations: false, max_lines: 500 });
  });

  test("without a schema a value is what it looks like", () => {
    const [call] = parseToolCalls(block("name: read_files", "relations: false", "paths: [\"a.js\"]"));
    assert.equal(call.arguments.relations, false);
    assert.deepEqual(call.arguments.paths, ["a.js"]);
  });

  test("a list of paths may be written one per line", () => {
    const [call] = parseToolCalls(block("name: read_files", "paths: |", "    a.js", "    b.js"), { schemaOf });
    assert.deepEqual(call.arguments.paths, ["a.js", "b.js"]);
  });

  test("a block that is indented is read as it is", () => {
    const reply = ["  ```command", "  name: edit_file", "  path: src/a.js", "  old_text: |", "      const x = 1;", "  ```"].join("\n");
    const [call] = parseToolCalls(reply, { schemaOf });
    assert.equal(call.tool, "edit_file");
    assert.equal(call.arguments.path, "src/a.js");
    assert.equal(call.arguments.old_text, "const x = 1;", "the raw value stops at the next key");
  });

  test("several blocks in one reply are all read, in the order they were written", () => {
    const reply = [block("name: a"), "and then", block("name: b")].join("\n");
    assert.deepEqual(parseToolCalls(reply), [{ tool: "a", arguments: {} }, { tool: "b", arguments: {} }]);
  });

  test("a block and a JSON call in one reply are both read, in the order they were written", () => {
    const reply = [block("name: a"), '{"command":"b","params":{}}'].join("\n");
    assert.deepEqual(parseToolCalls(reply), [{ tool: "a", arguments: {} }, { tool: "b", arguments: {} }]);
  });

  test("a block that is still being written is not read as a command yet", () => {
    const half = "```command\nname: run_command\ncommand: npm";
    assert.equal(hasToolSignature(half), true, "the reply is a command reply");
    assert.equal(hasOpenToolBlock(half), true, "but the block is still open");
    assert.equal(toolNameFromText(half), "run_command", "and the command is already named");
  });

  test("a block without a name names no command", () => {
    const reply = block("path: src/a.js");
    assert.equal(hasToolSignature(reply), true);
    assert.deepEqual(parseToolCalls(reply), []);
  });
});

describe("the shape of a command is the user's own", () => {
  test("the default is the JSON shape, and an empty template falls back to it", () => {
    assert.equal(formatOf(""), "json");
    assert.equal(specOf(""), JSON_SPEC);
    assert.equal(shapeOf(""), JSON_SHAPE);
    assert.equal(DEFAULT_TEMPLATES.format, JSON_SPEC);
    assert.equal(clampTemplates({ format: "  " }).format, JSON_SPEC, "an empty template falls back to the JSON shape");
  });

  test("a template that shows the command block means the command block", () => {
    assert.equal(formatOf(BLOCK_SPEC), "block");
    assert.equal(shapeOf(BLOCK_SPEC), BLOCK_SHAPE);
    assert.equal(specOf(BLOCK_SPEC), BLOCK_SPEC);
  });

  test("the format is one of the templates, so the user can rewrite it", () => {
    assert.ok(TEMPLATE_NAMES.includes("format"));
  });
});

describe("every message about a command says the same shape", () => {
  test("the start message, the reminder and the example of a failed command all show the format", () => {
    const values = buildPromptValues({ callFormat: BLOCK_SPEC });
    const start = renderTemplate(DEFAULT_TEMPLATES.start, { ...values, commands: "c", ask: "ask" });
    const reminder = toolsReminder(DEFAULT_TEMPLATES.reminder, [], "VS Code", "snapgent", 5, BLOCK_SPEC);
    const failed = commandMessage({ tool: "tree", arguments: { path: "." } }, { body: "no such folder", isError: true }, { error: DEFAULT_TEMPLATES.error, format: BLOCK_SPEC });
    assert.ok(start.includes(BLOCK_SPEC), "the start message teaches the format");
    assert.ok(reminder.includes(BLOCK_SPEC), "the reminder repeats it");
    assert.ok(failed.includes("```command"), "the failed command is shown in that shape");
    assert.ok(failed.includes("name: tree"));
    assert.ok(!failed.includes('"command"'), "and not in the other one");
  });

  test("with the JSON shape the same three messages show the JSON shape", () => {
    const values = buildPromptValues({});
    const start = renderTemplate(DEFAULT_TEMPLATES.start, { ...values, commands: "c", ask: "ask" });
    const reminder = toolsReminder(DEFAULT_TEMPLATES.reminder, [], "VS Code", "snapgent", 5);
    const failed = commandMessage({ tool: "tree", arguments: { path: "." } }, { body: "no such folder", isError: true }, { error: DEFAULT_TEMPLATES.error });
    assert.ok(start.includes(JSON_SPEC));
    assert.ok(reminder.includes(JSON_SPEC));
    assert.ok(failed.includes('{"command":"tree","params":{"path":"."}}'));
  });

  test("the notes that ask for a rewrite name the shape in use", () => {
    assert.ok(FEEDBACK.parseError("malformed", JSON_SHAPE).includes("JSON object"));
    assert.ok(FEEDBACK.parseError("malformed", BLOCK_SHAPE).includes("command block"));
    assert.ok(FEEDBACK.parseError("unclosed", BLOCK_SHAPE).includes("```command"));
    assert.ok(FEEDBACK.parseError("noName", BLOCK_SHAPE).includes("name:"));
  });

  test("a call is written back in the shape in use", () => {
    assert.equal(renderBlock("tree", { path: "." }), "```command\nname: tree\npath: .\n```");
    // Quotes need no escaping; only text that holds a line break goes on its own lines.
    assert.equal(renderBlock("edit_file", { path: "a.js", old_text: 'x = "1"' }), '```command\nname: edit_file\npath: a.js\nold_text: x = "1"\n```');
    assert.equal(renderBlock("edit_file", { path: "a.js", old_text: "one\ntwo" }), '```command\nname: edit_file\npath: a.js\nold_text: |\n    one\n    two\n```');
  });
});

describe("the shape of a command is in the message even when the template never asked for it", () => {
  test("a template from before the shape was a template still teaches the shape in use", () => {
    // The paragraph the extension used to write, as it stands in a template the user saved before this change.
    const oldStart = `Hi. {{project}} is your current workspace.

${JSON_SPEC}

It runs here in {{project}}.

{{ask}}`;
    const values = buildPromptValues({ callFormat: BLOCK_SPEC });
    const start = renderTemplate(ensureCallFormat(oldStart), { ...values, commands: "c", ask: "ask" });
    assert.ok(start.includes(BLOCK_SPEC), "the shape in use is taught");
    assert.ok(!start.includes(JSON_SPEC), "and the old JSON paragraph is gone, not next to it");
  });

  test("a template that never mentioned the shape gets it before the closing question", () => {
    const custom = `Hi. {{project}} is your current workspace.

{{commands}}

{{ask}}`;
    const values = buildPromptValues({ callFormat: BLOCK_SPEC });
    const start = renderTemplate(ensureCallFormat(custom), { ...values, commands: "c", ask: "ask me" });
    assert.ok(start.includes(BLOCK_SPEC));
    assert.ok(start.indexOf(BLOCK_SPEC) < start.indexOf("ask me"), "the closing question stays last");
  });

  test("a template that asks for the shape itself is left alone", () => {
    const custom = "Hi.\n\n{{call_format}}\n\n{{ask}}";
    assert.equal(ensureCallFormat(custom), custom);
  });

  test("the reminder carries the shape too, whatever its template says", () => {
    const oldReminder = "A quick reminder: these are the commands you can use.\n\n{{commands}}\n\nYou may write {{calls}} in one reply.";
    const reminder = toolsReminder(oldReminder, [], "VS Code", "snapgent", 5, BLOCK_SPEC);
    assert.ok(reminder.includes(BLOCK_SPEC), "the shape in use is repeated");
  });
});

describe("the command block a site leaves behind", () => {
  // A site renders the model's code block and keeps its text, not the fence around it: the reply the extension reads has no
  // ```command in it at all.
  const domText = ["Saya akan menjalankan perintah itu.", "", "name: run_command", "command: sleep 5", "", "Selesai."].join("\n");

  test("a reply whose code block lost its fence is still a command", () => {
    const calls = parseToolCalls(domText, { schemaOf, knowsTool: (name) => name === "run_command" });
    assert.deepEqual(calls, [{ tool: "run_command", arguments: { command: "sleep 5" } }]);
    assert.equal(hasToolSignature(domText), true);
    assert.equal(hasOpenToolBlock(domText), false);
  });

  test("the same reply is read as a command by the classifier", () => {
    const result = classifyReply(domText, { item: {}, hasContinueButton: () => false, knowsTool: (name) => name === "run_command", catalogueSize: 1, schemaOf });
    assert.equal(result.result.kind, "tool");
    assert.deepEqual(result.result.calls, [{ tool: "run_command", arguments: { command: "sleep 5" } }]);
  });

  test("a block that was cut off is not read, and the reply asks for a rewrite", () => {
    const cut = "name: run_command\ncommand: sle";
    assert.deepEqual(parseToolCalls(cut, { schemaOf }), []);
    assert.equal(hasOpenToolBlock(cut), true, "it is still being written");
    const result = classifyReply(cut, { item: {}, hasContinueButton: () => false, knowsTool: () => true, catalogueSize: 1, schemaOf });
    assert.equal(result.result.kind, "parse_error");
    assert.equal(result.result.reason, "unclosed");
  });

  test("prose that merely starts with name: is not a command", () => {
    const prose = "name: my-service\nimage: nginx\n";
    assert.deepEqual(parseToolCalls(prose, { schemaOf, knowsTool: () => false }), [], "the server offers no such command");
    assert.deepEqual(parseToolCalls(prose, { schemaOf }), [{ tool: "my-service", arguments: { image: "nginx" } }], "without a catalogue to check against, any name counts");
  });

  test("two code blocks one after the other, with no line between them, are two commands", () => {
    // A site that renders two code blocks leaves no line between them: the second block must not be swallowed by the first.
    const reply = ["name: run_command", "command: sleep 2", "name: run_command", "command: sleep 2", ""].join("\n");
    const calls = parseToolCalls(reply, { schemaOf, knowsTool: () => true });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls.map((call) => call.arguments.command), ["sleep 2", "sleep 2"]);
  });

  test("three code blocks with the site's own heading between them are three commands", () => {
    const reply = ["Cuplikan kode", "name: run_command", "command: sleep 2", "Cuplikan kode", "name: run_command", "command: sleep 2", "Cuplikan kode", "name: run_command", "command: sleep 2", ""].join("\n");
    assert.equal(parseToolCalls(reply, { schemaOf, knowsTool: () => true }).length, 3);
  });

  test("a bare block with a raw value keeps it as it is", () => {
    // The text of a code block, as the page hands it over: the block ends the reply and the page ends it with a line break.
    const reply = ["name: edit_file", "path: src/a.js", "old_text: |", '    const x = "hello";', ""].join("\n");
    const [call] = parseToolCalls(reply, { schemaOf, knowsTool: () => true });
    assert.equal(call.arguments.old_text, 'const x = "hello";');
  });
});

describe("the reply classifier", () => {
  const ctx = { item: {}, hasContinueButton: () => false, knowsTool: () => true, catalogueSize: 3, schemaOf };

  test("a reply that holds a command block is a command", () => {
    const result = classifyReply(block("name: run_command", "command: npm test"), ctx);
    assert.equal(result.result.kind, "tool");
    assert.deepEqual(result.result.calls, [{ tool: "run_command", arguments: { command: "npm test" } }]);
  });

  test("a block that names no command asks for a rewrite", () => {
    const result = classifyReply(block("path: src/a.js"), ctx);
    assert.equal(result.result.kind, "parse_error");
    assert.equal(result.result.reason, "noName");
  });

  test("a block that was cut off asks for a rewrite", () => {
    const result = classifyReply("```command\nname: run_command\ncommand: npm", ctx);
    assert.equal(result.result.kind, "parse_error");
    assert.equal(result.result.reason, "unclosed");
  });

  test("a JSON reply still works exactly as before", () => {
    const result = classifyReply('{"command":"run_command","params":{"command":"npm test"}}', ctx);
    assert.equal(result.result.kind, "tool");
    assert.deepEqual(result.result.calls, [{ tool: "run_command", arguments: { command: "npm test" } }]);
  });
});
