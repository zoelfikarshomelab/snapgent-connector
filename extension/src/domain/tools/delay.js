// SPDX-License-Identifier: GPL-3.0-or-later
// How long the agent waits: the pause after every command, and the random one after the last of them. Pure.
//
// Both are the user's own settings (Preferences). The extension waits them out between the commands of one reply, so the chat
// reads like someone working step by step instead of a program that answers in one burst.

export const DEFAULT_DELAY_SECONDS = 0;
export const MAX_DELAY_SECONDS = 600; // ten minutes: a pause this long is a stopwatch, not a pause

/** The pause the user set, in whole seconds within what the panel allows. Anything unusable means no pause. */
export function clampDelaySeconds(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_DELAY_SECONDS;
  return Math.min(MAX_DELAY_SECONDS, number);
}

/** The random pause after the commands of a reply: a whole number of seconds, up to the most the user allowed. */
export function randomDelaySeconds(max, random = Math.random) {
  const limit = clampDelaySeconds(max);
  if (!limit) return DEFAULT_DELAY_SECONDS;
  return Math.min(limit, Math.floor(random() * (limit + 1)));
}

/** What the composer says while the agent waits: the seconds that are left. */
export const delayLabel = (seconds) => `delay ${Math.max(0, Math.round(Number(seconds) || 0))}`;

/** What the composer says while a command runs: the pause that follows it. */
export const sleepLabel = (seconds) => (seconds > 0 ? `sleep ${Math.round(seconds)}` : "");
