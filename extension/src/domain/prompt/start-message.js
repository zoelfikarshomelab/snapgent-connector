// SPDX-License-Identifier: GPL-3.0-or-later
// The first message of a session, and the standing instructions it carries. Everything the model would otherwise have to ask for
// one command at a time (which commands exist, what the project looks like) is in it, so the model's whole part of the start is
// one short answer. The wording is the user's (see domain/prompt/templates.js). Pure.

import { ensureCallFormat, renderTemplate } from "./templates.js";

/**
 * @param {{ template: string, values?: Record<string, string> }} parts
 *   `values` carries everything the template may use: the facts (the project, the target) and the parts of a session (the command
 *   list, the project tree, the instruction file). A part that is empty is left out of the message.
 */
export function buildStartMessage({ template, values = {} }) {
  return renderTemplate(ensureCallFormat(template), values);
}

/**
 * The same template without the parts of a session (the command list, the tree, the instruction file and the closing question):
 * what is repeated to a model that forgot how we work, in the middle of a long conversation.
 */
export function buildBrief({ template, values = {} }) {
  return renderTemplate(ensureCallFormat(template), { ...values, commands: "", tree: "", instructions: "", instructions_file: "", ask: "" });
}
