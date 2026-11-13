// SPDX-License-Identifier: GPL-3.0-or-later
// The arguments of a call, before it is sent: the folders the user left out of attachments are added to what the model asked for,
// and a command that may limit its own output is told how much room it has in this message. Pure.

import { bareToolName } from "./names.js";

// The commands that walk the folder and take `exclude`: the user's list of folders left out of attachments is added to what the model wrote.
const EXCLUDING_COMMANDS = ["tree", "search_files", "find_files"];
// The size parameters a tool may advertise (read_files, run_command / run_project_script / run_tests, get_command_output).
const OUTPUT_LIMIT_ARGUMENTS = ["max_total_chars", "max_output_chars", "max_chars"];

/**
 * The folders the user left out of attachments are left out of what the model lists and searches too: they are added to its own `exclude`.
 * A find_files call with `exclude_only` is the file list of the `@` menu, which sends that list itself and wants nothing else added.
 */
export function withExcluded(name, args, excludedFolders = () => []) {
  if (!EXCLUDING_COMMANDS.includes(bareToolName(name)) || args.exclude_only === true) return args;
  let own = [];
  try { own = excludedFolders() || []; } catch { /* a broken preference must never stop a command */ }
  const folders = Array.isArray(own) ? own.filter((item) => typeof item === "string" && item.trim()) : [];
  if (!folders.length) return args;
  const asked = Array.isArray(args.exclude) ? args.exclude.filter((item) => typeof item === "string") : [];
  return { ...args, exclude: [...new Set([...asked, ...folders])] };
}

/**
 * Hand the call's share of the message to the tool, when the tool can limit its own output (it then reads or keeps
 * only what fits, and says what it left out). A smaller limit the model chose itself is kept.
 * @param {object[]} advertised the tools the server offers
 */
export function withBudget(advertised, name, args, budgetChars) {
  if (!Number.isFinite(budgetChars) || budgetChars <= 0) return args;
  const tool = (advertised || []).find((item) => bareToolName(item.name) === bareToolName(name));
  const properties = (tool && tool.inputSchema && tool.inputSchema.properties) || {};
  const limited = { ...args };
  for (const key of OUTPUT_LIMIT_ARGUMENTS) {
    if (!(key in properties)) continue;
    const ceiling = Number(properties[key] && properties[key].maximum); // a size the tool would refuse is lowered to its largest
    const room = Number.isFinite(ceiling) && ceiling > 0 ? Math.min(budgetChars, ceiling) : budgetChars;
    const own = Number(limited[key]);
    limited[key] = Number.isFinite(own) && own > 0 ? Math.min(own, room) : room;
  }
  return limited;
}
