// SPDX-License-Identifier: GPL-3.0-or-later
// The shape of a command: the one the model writes. Pure.
//
// There are two: the JSON envelope ({"command": ..., "params": {...}}) and the command block (a fenced block of `key: value`
// lines). Which one is in use is the user's own setting: the call-format template (see domain/prompt/templates.js). Its text is
// what the model is taught, so the start message, the reminder and the example of a command that failed all say the same thing.
//
// This module is about the TEXT. The reader of a block lives in domain/parser/block-call.js; the reader of JSON in
// domain/parser/tool-call.js. Both are always read: a model that writes the other shape is still understood.

import { callJson } from "./command-line.js";
import { bareToolName } from "./names.js";

/** The JSON format, as it is taught today. */
export const JSON_SPEC = `Whenever you want something done, write the command as its own fenced JSON block in your reply:

\`\`\`json
{"command":"exact_command_name","params":{"key":"value"}}
\`\`\``;

/** The command block: nothing is escaped, so a file's content or a command line with quotes goes in as it is. */
export const BLOCK_SPEC = `Whenever you want something done, write the command as its own fenced block in your reply:

\`\`\`command
name: exact_command_name
key: value
\`\`\`

A value that is a list, a number or true/false is written as JSON (\`["a.js","b.js"]\`, \`5\`, \`false\`). Text that holds quotes or line breaks (a file's content, a command line) goes after a \`|\`, on its own indented lines:

\`\`\`command
name: edit_file
path: src/a.js
old_text: |
    const x = "hello";
new_text: |
    const x = "world";
\`\`\``;

/** How each format is called in the notes the model reads. */
export const JSON_SHAPE = { label: "JSON object", example: '{"command": "name", "params": { ...your parameters... }}' };
export const BLOCK_SHAPE = { label: "command block", example: "```command\nname: name\nkey: value\n```" };

/** The format in use: the one the user's template shows. */
export function formatOf(templateText) {
  return /```[ \t]*(command|snapgent)/i.test(String(templateText || "")) ? "block" : "json";
}

/** The text the model is taught: the user's template, or the JSON format when there is none. */
export function specOf(templateText) {
  const text = String(templateText || "").trim();
  return text || JSON_SPEC;
}

/** How the format in use is called in the notes the model reads. */
export const shapeOf = (templateText) => (formatOf(templateText) === "block" ? BLOCK_SHAPE : JSON_SHAPE);

/** The call as a command block: the example a command that failed is shown with. */
export function renderBlock(name, args = {}) {
  const lines = [`name: ${bareToolName(name)}`];
  for (const [key, value] of Object.entries(args || {})) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string") {
      if (value.includes("\n") || value !== value.trim()) lines.push(`${key}: |`, ...value.split("\n").map((line) => `    ${line}`));
      else lines.push(`${key}: ${value}`);
      continue;
    }
    if (typeof value === "object") { lines.push(`${key}: ${JSON.stringify(value)}`); continue; }
    lines.push(`${key}: ${String(value)}`);
  }
  return ["```command", ...lines, "```"].join("\n");
}

/** The call as it should be written, in the format in use. */
export function renderCall(name, args, templateText) {
  if (formatOf(templateText) === "block") return renderBlock(name, args);
  return callJson(name, args);
}
