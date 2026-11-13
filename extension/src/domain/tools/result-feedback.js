// SPDX-License-Identifier: GPL-3.0-or-later
// Turns a raw bridge result into what the model reads back: the body of the answer, and whether the command failed. The wording
// around it is the user's (see domain/prompt/templates.js). Pure.

import { FEEDBACK } from "../prompt/feedback.js";

const IMAGE_NOTE = "the image is attached to this message";

// An MCP server may report a missing/invalid parameter as a SUCCESS whose text is just the complaint (e.g. "path is required").
// Treat that as the error it is.

const PARAM_COMPLAINT_RE = /^[\w .'"-]{0,60}\bis (required|not available|invalid)\b[\w .'"-]{0,80}$/i;

/**
 * @typedef {{ ok?: boolean, text?: string, images?: object[], kind?: string, error?: string }} BridgeResult
 * @returns {{ body: string, isError: boolean, images?: object[], event?: "stale-extension" }}
 */
export function toFeedback(result, { name, supportsVision, timeoutSeconds = 120 }) {
  if (!result) return { body: FEEDBACK.bridgeOffline, isError: true };

  if (result.ok) {
    const body = result.text && result.text.trim();
    if (body && PARAM_COMPLAINT_RE.test(body)) {
      return { body: `a parameter of this command is missing or wrong: ${body}. Check the command's parameters with list_commands, fix the call and try again.`, isError: true };
    }
    const images = result.images && result.images.length ? result.images : null;
    if (images && !supportsVision) {
      // Any tool can turn out to return images; refuse cleanly rather than attach a
      // file this provider's model will never process.
      return { body: `this command returned an image, but this assistant cannot see images. Do NOT call it again. Use a different command to get the information as text instead.`, isError: true };
    }
    if (images) {
      const caption = body || `${images.length} image(s) captured.`;
      return {
        body: `${caption}\n(The ${IMAGE_NOTE} - you can see it directly. Analyse it and continue.)`,
        images,
        isError: false,
      };
    }
    return { body: result.text && result.text.length ? result.text : "(the command returned nothing)", isError: false };
  }

  // A page reload is the only cure for an orphaned content script: say exactly that.
  if (result.kind === "stale-extension") return { body: FEEDBACK.staleExtension, isError: true, event: "stale-extension" };
  // The user stopped the command from the terminal panel: say so plainly, without scaring the model.
  if (result.kind === "cancelled") {
    const note = result.error && result.error.trim() ? result.error.trim() : "you stopped it before it finished.";
    return { body: `this command was stopped before it finished (${note}). Its last output is in the terminal panel. Ask the user how they want to proceed.`, isError: true };
  }
  if (result.kind === "disconnected") return { body: FEEDBACK.bridgeOffline, isError: true };
  if (result.kind === "timeout") {
    return { body: `this command timed out after ${timeoutSeconds} seconds.\n${result.error}\nTry a shorter or simpler call.`, isError: true };
  }
  return { body: `${result.error}\nRead it carefully, fix the call or try a different approach.`, isError: true };
}
