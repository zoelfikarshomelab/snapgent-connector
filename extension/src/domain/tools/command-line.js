// SPDX-License-Identifier: GPL-3.0-or-later
// The command a call stands for, written the way a person would type it in a terminal: "tree ." for the tree command, "npm test"
// for a call that runs npm. It is what the model is told ran, so it has to read like the command itself and not like a protocol.
// Pure: a call in, text out.

import { bareToolName } from "./names.js";

// The parameters that read as plain words after the command name.
const PLAIN = ["args", "path", "paths", "query", "pattern", "file_pattern", "script", "run_id"];

const words = (value) => (value === undefined || value === null ? [] : Array.isArray(value) ? value.map((item) => String(item)) : [String(value)]);

/**
 * @param {string} name the command's name
 * @param {object} [args] the arguments the model wrote
 * @returns {string} the command as it would be typed
 */
export function commandLine(name, args = {}) {
  const given = args && typeof args === "object" ? args : {};
  // A call that runs a program IS that program: "npm test", not "run_command npm test".
  if (typeof given.command === "string" && given.command.trim()) {
    return [given.command.trim(), ...words(given.args)].join(" ");
  }
  const parts = [bareToolName(name)];
  for (const [key, value] of Object.entries(given)) {
    if (key === "command" || value === undefined || value === null || value === "") continue;
    if (PLAIN.includes(key)) {
      parts.push(...words(value));
      continue;
    }
    parts.push(`${key}=${Array.isArray(value) ? `[${value.join(", ")}]` : value}`);
  }
  return parts.join(" ");
}

/**
 * The call as the model should write it: the envelope the extension reads. It is the example the model is given when a command
 * fails, so it shows the shape the extension expects.
 * @param {string} name
 * @param {object} [args]
 * @returns {string}
 */
export function callJson(name, args = {}) {
  const params = args && typeof args === "object" ? args : {};
  return JSON.stringify({ command: bareToolName(name), params });
}
