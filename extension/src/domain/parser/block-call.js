// SPDX-License-Identifier: GPL-3.0-or-later
// The command block: `key: value` lines that the model writes instead of the JSON envelope.
//
//   name: run_command
//   command: npm test
//   args: ["--watch"]
//
// A block reaches us two ways: as the raw markdown the model typed (```command ... ```), or as the text of the code block the
// site rendered it into -- a site keeps the text of a code block, not the fence around it, so the fence is often not there at
// all. Both are read here, and a block that is still being written (the reply was cut off in the middle of it) is not read.
//
// The first line names the command. A value is the rest of its line; a list, a number or true/false is written as JSON; text
// that holds quotes or line breaks (a file's content, a command line) goes after a `|`, on its own indented lines, as it is.
// Nothing is escaped, so a payload that JSON cannot carry survives.
//
// The reader needs to know what each parameter is: the tool's schema says it (a boolean stays a boolean, a number a number).

const FENCE_RE = /^[ \t]*```[ \t]*(command|snapgent)[ \t]*$/i;
const CLOSE_RE = /^[ \t]*```[ \t]*$/;
const KEY_RE = /^([A-Za-z_][A-Za-z0-9_.-]*)[ \t]*:(.*)$/;
/** The name of a command: an identifier, not a sentence. */
const NAME_RE = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const INDENT_RE = /^[ \t]*/;

const indentOf = (line) => INDENT_RE.exec(line)[0].length;

/**
 * The blocks in the text: the fenced ones and the bare ones, each with the lines it holds.
 * @param {string} text
 * @param {{ complete?: boolean }} [options] `complete` says the text is whole (what the user pasted into the terminal), so a
 *   block that runs to the end of it is read and not taken for one that was cut off.
 */
export function scanBlocks(text, { complete = false } = {}) {
  const lines = String(text || "").split("\n");
  const taken = new Array(lines.length).fill(false);
  const out = [];
  let index = 0;

  // The fenced blocks: the raw markdown, fence and all.
  while (index < lines.length) {
    if (!FENCE_RE.test(lines[index])) { index++; continue; }
    const start = index;
    const indent = indentOf(lines[index]);
    const body = [];
    index++;
    let closed = false;
    while (index < lines.length) {
      if (CLOSE_RE.test(lines[index])) { closed = true; index++; break; }
      body.push(lines[index]);
      index++;
    }
    for (let i = start; i < index; i++) taken[i] = true;
    out.push({ start, body, closed, indent, fenced: true });
  }

  // The bare ones: a run of `key: value` lines that starts with the command's name. This is what a site leaves behind when
  // it renders the model's code block: the text of the block, without the fence.
  index = 0;
  while (index < lines.length) {
    if (taken[index]) { index++; continue; }
    const key = KEY_RE.exec(lines[index]);
    if (!key || key[1] !== "name" || !NAME_RE.test(key[2].trim())) { index++; continue; }
    const indent = indentOf(lines[index]);
    const body = [lines[index]];
    let at = index + 1;
    while (at < lines.length && !taken[at] && lines[at].trim()) {
      const next = KEY_RE.exec(lines[at]);
      const deeper = indentOf(lines[at]) > indent;
      if (!next && !deeper) break; // a line that is neither a key nor part of a raw value ends the block
      body.push(lines[at]);
      at++;
    }
    // A block that runs to the end of the reply was cut off: it is not read.
    const closed = complete || at < lines.length;
    for (let i = index; i < at; i++) taken[i] = true;
    out.push({ start: index, body, closed, indent, fenced: false });
    index = at;
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
  const indent = Math.min(...filled.map((line) => indentOf(line)));
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
  if (type === "array" || (type === "object")) {
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
    if (indentOf(line) > indent) { index++; continue; }
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
      while (index < body.length && (!body[index].trim() || indentOf(body[index]) > indent)) {
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
 * @param {{ schemaOf?: (name: string) => object|null, knowsTool?: (name: string) => boolean, complete?: boolean }} [options]
 *   `knowsTool` keeps prose that merely starts with "name:" from being read as a command; `complete` says the text is whole.
 * @returns {Array<{ tool: string, arguments: object, at: number }>}
 */
export function parseBlockCalls(text, { schemaOf, knowsTool, complete = false } = {}) {
  const lines = String(text || "").split("\n");
  const offsets = [];
  let at = 0;
  for (const line of lines) { offsets.push(at); at += line.length + 1; }
  const calls = [];
  for (const block of scanBlocks(text, { complete })) {
    if (!block.closed) continue;
    const call = parseBlockBody(block.body, { schemaOf, indent: block.indent });
    if (!call) continue;
    // A bare block (one without a fence) is only a command when it names one the server offers.
    if (!block.fenced && typeof knowsTool === "function" && !knowsTool(call.tool)) continue;
    calls.push({ ...call, at: offsets[block.start] || 0 });
  }
  return calls;
}

/** The command a block names, before it is closed (the name is typed first). */
export function blockName(text) {
  for (const block of scanBlocks(text)) {
    const call = parseBlockBody(block.body, { indent: block.indent });
    if (call && call.tool) return call.tool;
  }
  return "";
}
