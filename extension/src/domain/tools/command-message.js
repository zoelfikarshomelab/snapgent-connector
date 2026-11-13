// SPDX-License-Identifier: GPL-3.0-or-later
// The message the model reads for one command: the command as it would be typed, what it returned, and - when it failed - the call
// as it should be written. The wording is the user's (see domain/prompt/templates.js). Pure.

import { renderTemplate } from "../prompt/templates.js";
import { callJson, commandLine } from "./command-line.js";
import { bareToolName } from "./names.js";

/**
 * @param {{ tool: string, arguments?: object }} call the call the model wrote
 * @param {{ body: string, isError?: boolean }} outcome what came back
 * @param {{ result?: string, error?: string }} templates the user's wording
 * @returns {string} the message the model reads
 */
export function commandMessage(call, outcome, templates = {}) {
  const command = commandLine(call.tool, call.arguments);
  const example = callJson(call.tool, call.arguments);
  const values = { command, name: bareToolName(call.tool), output: outcome.body, error: outcome.body, example };
  const template = outcome.isError ? templates.error : templates.result;
  let text = template ? renderTemplate(template, values) : outcome.body;
  // A failed command always shows the call that should be written: it is how the model learns the shape.
  if (outcome.isError && !text.includes(example)) text = `${text}\n\nA command like this one runs:\n\n${example}`;
  return text;
}
