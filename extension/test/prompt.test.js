import { test } from "node:test";
import assert from "node:assert/strict";
import * as ZS from "../src/domain/index.js";
import { cleanContext } from "../src/domain/prompt/context-file.js";
import { DEFAULT_TEMPLATES, clampTemplates, renderTemplate, sampleValues } from "../src/domain/prompt/templates.js";
import { commandLine, callJson } from "../src/domain/tools/command-line.js";
import { commandMessage } from "../src/domain/tools/command-message.js";

const workspace = { name: "snapgent-connector", path: "/home/me/snapgent-connector", git: true };
const values = ZS.buildPromptValues({ workspace, targetName: "VS Code" });
const start = ZS.buildStartMessage({ template: DEFAULT_TEMPLATES.start, values: { ...values, commands: "snapgent commands (2):\n\nread_files(...)", tree: "root\n└── a.js", ask: ZS.askLine() } });

test("the start message opens with the project, in plain words and with no tag", () => assert.ok(start.startsWith("Hi. snapgent-connector is your current workspace.")));
test("the start message says where the project is and that it is a git repository", () => assert.ok(start.includes("/home/me/snapgent-connector, and it is a git repository")));
test("without a known workspace it speaks of this folder", () => assert.ok(ZS.buildPromptValues().project === "This folder"));
test("the start message names the target and says there is an MCP server", () => {
  assert.ok(start.includes("VS Code"));
  assert.match(start, /MCP server/);
});
test("the start message looks like nothing a bot or a system tag would say", () => assert.ok(!/CONTEXT:|ZS-SYS|━━━|SYSTEM/.test(start.replaceAll(workspace.name, ""))));
test("system prompt carries no Roblox leftovers", () => assert.ok(!/roblox|luau|###LUA/i.test(start)));

const withNotes = ZS.buildStartMessage({ template: DEFAULT_TEMPLATES.start, values: { ...ZS.buildPromptValues({ customPrompt: "Reply in Indonesian", providerNotes: "site note" }), commands: "c", ask: ZS.askLine() } });
test("the custom prompt and the site note are in the message", () => {
  assert.ok(withNotes.includes("Reply in Indonesian"));
  assert.ok(withNotes.includes("site note"));
});

test("the start message holds the commands and the tree, and asks for a short answer", () => {
  assert.ok(start.includes("read_files(...)") && start.includes("└── a.js"));
  assert.ok(start.endsWith("I will tell you what I want to do."));
  assert.match(start, /reply "understood"/);
});
test("a start message without a tree leaves that part out", () => assert.ok(!ZS.buildStartMessage({ template: DEFAULT_TEMPLATES.start, values: { ...values, commands: "c", ask: ZS.askLine() } }).includes("what the project looks like")));
const withContext = ZS.buildStartMessage({ template: DEFAULT_TEMPLATES.start, values: { ...values, commands: "c", instructions: "use pnpm", instructions_file: "AGENTS.md", ask: ZS.askLine() } });
test("a found instruction file goes into the start message", () => {
  assert.ok(withContext.includes("use pnpm"));
  assert.ok(withContext.includes("AGENTS.md"));
  assert.ok(withContext.indexOf("use pnpm") < withContext.indexOf("These are the commands"));
});
test("without one, the start message says nothing about project instructions", () => assert.ok(!ZS.buildStartMessage({ template: DEFAULT_TEMPLATES.start, values: { ...values, commands: "c", ask: ZS.askLine() } }).includes("instructions I keep")));

const reminderTools = [{ name: "read_files", description: "Read files", inputSchema: { properties: { paths: { type: "array" } } } }];
test("the reminder lists the commands and, when given, how many one reply may carry", () => {
  const reminder = ZS.toolsReminder(DEFAULT_TEMPLATES.reminder, reminderTools, "VS Code", "snapgent", 5);
  assert.ok(reminder.includes("read_files(paths)"));
  assert.ok(reminder.includes("at most 5 commands"));
  assert.ok(ZS.toolsReminder(DEFAULT_TEMPLATES.reminder, reminderTools, "VS Code", "snapgent", 1).includes("at most 1 command"));
  assert.ok(!ZS.toolsReminder(DEFAULT_TEMPLATES.reminder, reminderTools, "VS Code", "snapgent", 1).includes("1 commands"));
});
test("without a Commands per reply value the reminder says nothing about a limit", () => {
  assert.ok(!ZS.toolsReminder(DEFAULT_TEMPLATES.reminder, reminderTools).includes("at most"));
  assert.ok(!ZS.toolsReminder(DEFAULT_TEMPLATES.reminder, reminderTools, "VS Code", "snapgent", 0).includes("at most"));
});

test("the prompt tells the model the effective Commands per reply when given", () => {
  assert.ok(ZS.buildPromptValues({ calls: 5 }).calls === "at most 5 commands");
  assert.ok(ZS.buildPromptValues({ calls: 1 }).calls === "at most 1 command");
  assert.ok(ZS.buildPromptValues().calls === "several commands");
  assert.ok(ZS.buildPromptValues({ calls: 0 }).calls === "several commands");
});

test("the instructions tell the model the relations footer comes by default and to use ranges after it", () => {
  assert.match(start, /When read_files offers a relations option/);
  assert.match(start, /`relations: false`/);
  assert.match(start, /with ranges instead of whole files/);
});

test("the templates are the user's: what they write is what the model reads", () => {
  const mine = renderTemplate("I ran `{{command}}`.\n\n{{output}}", { command: "tree .", output: "a.js" });
  assert.equal(mine, "I ran `tree .`.\n\na.js");
});

test("a paragraph whose value is empty is left out, label and all", () => {
  const text = renderTemplate("Before.\n\nThe tree:\n{{tree}}\n\nAfter.", { tree: "" });
  assert.equal(text, "Before.\n\nAfter.");
  assert.ok(!text.includes("The tree:"));
});

test("a paragraph that still says something of its own is kept", () => {
  const text = renderTemplate("Hello {{project}}!", { project: "" });
  assert.equal(text, "Hello !");
});

test("an empty template falls back to the default, and a saved one is kept", () => {
  const clamped = clampTemplates({ start: "", result: "mine" });
  assert.equal(clamped.start, DEFAULT_TEMPLATES.start);
  assert.equal(clamped.result, "mine");
  assert.equal(clamped.reminder, DEFAULT_TEMPLATES.reminder);
});

test("the command a call stands for is written the way a person types it", () => {
  assert.equal(commandLine("tree", { args: "." }), "tree .");
  assert.equal(commandLine("tree", { path: "src" }), "tree src");
  assert.equal(commandLine("run_command", { command: "npm", args: ["test"] }), "npm test");
  assert.equal(commandLine("read_files", { paths: ["a.js", "b.js"] }), "read_files a.js b.js");
  assert.equal(commandLine("tree", { path: ".", max_depth: 2 }), "tree . max_depth=2");
  assert.equal(commandLine("list_commands"), "list_commands");
});

test("the example of a call is the envelope the model should write", () => {
  assert.equal(callJson("tree", { args: "." }), '{"command":"tree","params":{"args":"."}}');
});

test("a command that worked reads like a chat, and shows the command it ran", () => {
  const message = commandMessage({ tool: "tree", arguments: { args: "." } }, { body: "a.js" }, DEFAULT_TEMPLATES);
  assert.ok(message.includes("tree ."));
  assert.ok(message.includes("a.js"));
  assert.ok(!message.includes("»"));
});

test("a command that failed says so, and shows the call that works", () => {
  const message = commandMessage({ tool: "tree", arguments: { args: "." } }, { body: "the folder does not exist", isError: true }, DEFAULT_TEMPLATES);
  assert.match(message, /did not work/);
  assert.match(message, /the folder does not exist/);
  assert.ok(message.includes('{"command":"tree","params":{"args":"."}}'));
  assert.ok(!message.startsWith("ERROR"));
});

test("a failed command shows the call even when the user's template leaves it out", () => {
  const message = commandMessage({ tool: "tree", arguments: { args: "." } }, { body: "boom", isError: true }, { error: "It did not work: {{error}}" });
  assert.ok(message.includes('{"command":"tree","params":{"args":"."}}'));
});

test("the sample values fill every template", () => {
  for (const name of Object.keys(DEFAULT_TEMPLATES)) {
    const text = renderTemplate(DEFAULT_TEMPLATES[name], sampleValues(name));
    assert.ok(text.length > 0, name);
    assert.ok(!text.includes("{{"), name);
  }
});

const clean = (text) => cleanContext(text);
test("a file reference in an instruction file stays a plain path, without its @", () => {
  assert.equal(clean("see @docs/ARCHITECTURE.md and @./a.md, also @src/"), "see docs/ARCHITECTURE.md and ./a.md, also src/");
});
test("an @ that is not a path is still defused, an address is left alone", () => {
  assert.equal(clean("@import rules\nmail a@b.com, ask @john."), "[at]import rules\nmail a@b.com, ask [at]john.");
});
test("the read_files wrapping is removed", () => assert.equal(clean("===== AGENTS.md =====\n1: use pnpm\n2: @docs/x.md"), "use pnpm\ndocs/x.md"));

test("parse-error falls back to malformed", () => assert.ok(ZS.FEEDBACK.parseError("nope").includes("could not be read")));
