// SPDX-License-Identifier: GPL-3.0-or-later
// How a message of ours is recognised: the result of a command, written the way an older version wrote it, and the way the
// default template writes it. The wording is the user's (see domain/prompt/templates.js), so a rewritten template is recognised
// by the page remembering what it sent (see page/state.js), not by these shapes. Pure.

/** The old shapes, still recognised so a chat started with them keeps working. */
const LEGACY = String.raw`(?:»[ \t]+\S+[ \t]*(?:\n|$)|Output of '[^']*':)`;
/** The shape the default result template writes: "I ran `tree .` for you. ..." */
const CURRENT = "(?:I ran[ \\t]+`[^`\\n]+`[^\\n]*(?:\\n|$))";

const HEADER = `(?:${LEGACY}|${CURRENT})`;
const AT_START = new RegExp(`^\\s*${HEADER}`);
const ON_A_LINE = new RegExp(`(?:^|\\n)\\s*${HEADER}`);
const LEADING_HEADER = /^\s*(?:»[ \t]+\S+[ \t]*|Output of '[^']*':|I ran[ \t]+`[^`\n]+`[^\n]*)\n?/;

/** Does this message BEGIN with a result of ours? */
export const startsWithResult = (text) => AT_START.test(text);

/** Is there a result of ours anywhere in this text (a turn may carry other text before it)? */
export const containsResult = (text) => ON_A_LINE.test(text);

/** A result without its first line. */
export const withoutResultHeader = (feedback) => feedback.replace(LEADING_HEADER, "");

/**
 * A short, comparable shape of a text: what a chat page cannot change much (no case, no spacing, no punctuation). It is how the
 * page recognises a message of its own after the user rewrote the templates.
 */
export const shapeOf = (text, size = 40) => String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, size);

/**
 * Is this text one of the messages the extension sent? The page keeps the shapes of what it sent (see page/state.js).
 * @param {string[]} shapes
 * @param {string} text
 */
export const matchesShape = (shapes, text) => {
  const mine = shapeOf(text, 24);
  if (!mine) return false;
  return (shapes || []).some((shape) => String(shape).slice(0, 24) === mine);
};
