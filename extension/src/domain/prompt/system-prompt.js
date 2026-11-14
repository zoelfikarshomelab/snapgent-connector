// SPDX-License-Identifier: GPL-3.0-or-later
// The facts the start message, the reminder and the re-statement are written around: the project, the target, how many
// commands one reply may carry, and the shape of a command. The wording around them is the user's (see domain/prompt/templates.js).
// Pure.

import { SESSION_PHRASE } from "../constants.js";
import { specOf } from "../tools/call-format.js";

/** How many commands one reply may carry, as the phrase the templates use. */
export function batchPhrase(calls) {
  const count = Number.isFinite(calls) && calls > 0 ? Math.round(calls) : 0;
  if (!count) return "several commands";
  return `at most ${count} command${count === 1 ? "" : "s"}`;
}

/**
 * @param {{ workspace?: { name?: string, path?: string, git?: boolean }|null, targetName?: string, customPrompt?: string,
 *           providerNotes?: string, skills?: { name: string, description: string, path?: string }[], calls?: number,
 *           callFormat?: string }} opts
 *   `calls` is the effective Commands per reply (the general preference, or this site's own when it has one).
 *   `callFormat` is the user's call-format template: the shape of a command, the same in the start message and the reminder.
 * @returns {Record<string, string>} the values the templates may use
 */
export function buildPromptValues({ workspace = null, targetName = "Snapgent MCP", customPrompt = "", providerNotes = "", skills = [], calls, callFormat = "" } = {}) {
  const name = (workspace && workspace.name) || "This folder";
  const path = workspace && workspace.path ? workspace.path : "";
  const where = path
    ? `It is at ${path}${workspace && workspace.git ? ", and it is a git repository" : ""}.`
    : "";
  const skillList = Array.isArray(skills) && skills.length
    ? skills.map((s) => `- ${s.name}: ${s.description} (path: ${s.path || ".snapgent/skills/" + s.name + "/SKILL.md"})`).join("\n")
    : "";
  return {
    project: name,
    where,
    target: targetName,
    calls: batchPhrase(calls),
    skills: skillList,
    notes: String(providerNotes || "").trim(),
    extra: String(customPrompt || "").trim(),
    call_format: specOf(callFormat),
  };
}

/** The words that mark a message as ours, so the page recognises a session later. */
export const sessionPhrase = () => SESSION_PHRASE;
