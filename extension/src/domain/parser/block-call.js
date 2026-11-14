// SPDX-License-Identifier: GPL-3.0-or-later
// The command block: a fenced block of `key: value` lines that the model writes instead of the JSON envelope. Pure.
//
//   ```command
//   name: run_command
//   command: npm test
//   args: ["--watch"]
//   ```
//
// The first line names the command. A value is the rest of its line; a list, a number or true/false is written as JSON; text
// that holds quotes or line breaks (a file's content, a command line) goes after a `|`, on its own indented lines, as it is.
// Nothing is escaped, so a payload that JSON cannot carry survives.
//
// The reader needs to know what each parameter is: the tool's schema says it (a boolean stays a boolean, a number a number).

const FENCE_RE = /^[ \t]*```[ \t]*(command|snapgent)[ \t]*$/i;
const CLOSE_RE = /^[ \t]*```[ \t]*$/;
// A key may be indented as far as the fence is: a model that puts the block in a list indents the whole thing.
const KEY_RE = /^([A-Za-z_][A-Za-z0-9_.-]*)[ \t]*:(.*)$/;
const INDENT_RE = /^[ \t]*/;

/** The blocks in the text: where each one starts, what is in it, and whether it was closed. */
export function scanBlocks(text) {
  const lines = String(text || "").split("\n");
  const out = [];
  let index = 0;
  let offset = 0;
  while (index < lines.length) {
    const start = offset;
    if (!FENCE_RE.test(lines[index])) { offset += lines[index].length + 1; index++; continue; }
    const indent = INDENT_RE.exec(lines[index])[0].length;
    const body = [];
    index++;
    offset += lines[index - 1].length + 1;
    let closed = false;
    while (index < lines.length) {
      if (CLOSE_RE.test(lines[index])) { closed = true; offset += lines[index].length + 1; index++; break; }
      body.push(lines[index]);
      offset += lines[index].length + 1;
      index++;
    }
    out.push({ start, at: start, body, closed, indent });
  }
  return out;
}

/** Does the text hold a command block at all? */
export const hasBlock = (text) => scanBlocks(text).length > 0;

/** A block that was opened and not closed: the model is still writing it. */
export const hasOpenBlock = (text) => scanBlocks(text).some((block) => !block.closed);

/** The common indentation of the lines, so the text can be read without it. */
function dedent(lines) {
  const filled = lines.filter((line) => line.trim());
  if (!filled.length) return "";
  const indent = Math.min(...filled.map((line) => INDENT_RE.exec(line)[0].length));
  return lines.map((line) => (line.trim() ? line.slice(indent) : "")).join("\n").replace(/\s+$/, "");
}

/** What the value of a key means, given what the tool says about that parameter. */
function typedValue(raw, block, schema) {
  const type = (schema && schema.type) || "";
  if (block) {
    // A raw block is text; a list of strings when the parameter is a list.
    if (type === "array") return raw.split("\n").map((line) => line.trim()).filter(Boolean);
    return raw;
  }
  if (type === "string") return raw;
  if (type === "boolean") {
    const low = raw.toLowerCase();
    if (low === "true") return true;
    if (low === "false") return false;
    return raw;
  }
  if (type === "integer" || type === "number") {
    const number = Number(raw);
    return Number.isFinite(number) ? number : raw;
  }
  if (type === "array" || type === "object") {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  // No schema to go by: what the value looks like decides.
  const low = raw.toLowerCase();
  if (low === "true") return true;
  if (low === "false") return false;
  if (raw.startsWith("[") || raw.startsWith("{")) {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

/**
 * The call a block body holds.
 * @param {string[]} body the lines between the fences
 * @param {{ schemaOf?: (name: string) => object|null, indent?: number }} [options] `schemaOf` gives the parameter types of a
 *   command; `indent` is how far the block itself is indented (a line indented further belongs to a raw value)
 * @returns {{ tool: string, arguments: object }|null} null when the block names no command
 */
export function parseBlockBody(body, { schemaOf, indent = 0 } = {}) {
  const values = {};
  let name = "";
  let index = 0;
  while (index < body.length) {
    const line = body[index];
    if (!line.trim()) { index++; continue; }
    // A line indented deeper than the block belongs to the raw value above it, never to a key.
    if (INDENT_RE.exec(line)[0].length > indent) { index++; continue; }
    const key = KEY_RE.exec(line.trim());
    if (!key) {
      // The first line may be the command's name on its own, with no key in front of it.
      if (!name && !Object.keys(values).length) { name = line.trim(); index++; continue; }
      index++;
      continue;
    }
    const param = key[1];
    const rest = key[2].trim();
    if (rest === "|" || rest === "|-" || rest === "|+") {
      const lines = [];
      index++;
      while (index < body.length && (!body[index].trim() || INDENT_RE.exec(body[index])[0].length > indent)) {
        lines.push(body[index]);
        index++;
      }
      values[param] = { raw: dedent(lines), block: true };
      continue;
    }
    values[param] = { raw: rest, block: false };
    index++;
  }
  if (!name) {
    const named = values.name;
    if (named && !named.block) name = named.raw.trim();
  }
  if (!name) return null;
  const schema = typeof schemaOf === "function" ? schemaOf(name) : null;
  const args = {};
  for (const [key2, value] of Object.entries(values)) {
    if (key2 === "name") continue;
    args[key2] = typedValue(value.raw, value.block, (schema && schema[key2]) || null);
  }
  return { tool: name, arguments: args };
}

/**
 * Every command the text holds, in the order they were written.
 * A block that was not closed is left out: the model is still writing it, and half a command must never run.
 * @param {string} text
 * @param {{ schemaOf?: (name: string) => object|null }} [options]
 * @returns {Array<{ tool: string, arguments: object, at: number }>}
 */
export function parseBlockCalls(text, { schemaOf } = {}) {
  return scanBlocks(text)
    .filter((block) => block.closed)
    .map((block) => {
      const call = parseBlockBody(block.body, { schemaOf, indent: block.indent });
      return call ? { ...call, at: block.at } : null;
    })
    .filter(Boolean);
}

/** The command a block names, before it is closed (the name is typed first). */
export function blockName(text) {
  for (const block of scanBlocks(text)) {
    const call = parseBlockBody(block.body, { indent: block.indent });
    if (call && call.tool) return call.tool;
  }
  return "";
}
