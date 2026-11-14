// SPDX-License-Identifier: GPL-3.0-or-later
// Turns an MCP tool descriptor into an example call the user can copy: the call the extension reads, with the
// required parameters filled by placeholders. Pure: a descriptor in, text out.
//
// The call is written in the shape the AI is taught (the user's call-format template): the JSON envelope, or the command
// block. The extension reads both, so either runs.

import { bareToolName } from "./names.js";
import { renderCall } from "./call-format.js";

// Placeholders by parameter name; anything else gets a value that fits its type.
const TEXT = {
  command: "git", query: "text to find", content: "text", old_text: "old text", new_text: "new text",
  message: "feat: summary", pattern: "**/*.js", file_pattern: "*.js", run_id: "r1",
};
const PATHY = /path|file|source|destination|directory|folder/i;

function sample(name, schema) {
  if (!schema || typeof schema !== "object") return "";
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
  if (schema.type === "array") return schema.items ? [sample(name, schema.items)] : [];
  if (schema.type === "object") {
    const props = schema.properties || {};
    const wanted = Array.isArray(schema.required) ? schema.required : Object.keys(props);
    return Object.fromEntries(wanted.filter((key) => props[key]).map((key) => [key, sample(key, props[key])]));
  }
  if (schema.type === "integer" || schema.type === "number") return 1;
  if (schema.type === "boolean") return true;
  return TEXT[name] || (PATHY.test(name) ? "path/to/file.txt" : name);
}

/**
 * @param {{ name: string, description?: string, inputSchema?: object }} tool
 * @param {string} [format] the user's call-format template: the shape the call is written in
 * @returns {{ name: string, description: string, call: string, optional: string[] }}
 *   `call` carries the required parameters only; `optional` names the others, so the example stays short.
 */
export function exampleCall(tool, format = "") {
  const props = (tool.inputSchema && tool.inputSchema.properties) || {};
  const required = new Set((tool.inputSchema && tool.inputSchema.required) || []);
  const params = {};
  for (const [key, schema] of Object.entries(props)) if (required.has(key)) params[key] = sample(key, schema);
  const name = bareToolName(tool.name);
  return {
    name,
    description: String(tool.description || "").split("\n")[0],
    call: renderCall(name, params, format),
    optional: Object.keys(props).filter((key) => !required.has(key)),
  };
}
