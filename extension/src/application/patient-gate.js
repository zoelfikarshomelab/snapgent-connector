// SPDX-License-Identifier: GPL-3.0-or-later
// Patient mode for ResponseWatcher (sites with no reliable "generating" signal, such as Meta AI): a reply is finished only once it HAS
// text and that text stayed unchanged for a while. An empty or reasoning-only read is never finished: it waits, bounded only by the
// overall response timeout. The reply is read for commands only after this gate lets it through.

import { hasOpenToolBlock, hasToolSignature } from "../domain/parser/index.js";

const QUIET_MS = 15000;     // a plain answer is finished after its text stayed unchanged this long
const TOOL_QUIET_MS = 4000; // ...or this long when the reply already holds a complete command

/**
 * @param {(() => boolean) | undefined} patient  whether patient mode is on
 * @param {import("./watch-state.js").WatchState} s
 * @param {{ reply?: string }} d  what was just read
 * @param {(phase: "checking"|"writing") => void} say  tells the user what is being waited for
 * @returns {null | { wait: number }} null lets the tick go on; otherwise the tick waits
 */
export function patientGate(patient, s, d, say) {
  if (!(patient && patient())) return null;
  const hasReply = !!(d.reply && d.reply.length);
  const complete = hasReply && hasToolSignature(d.reply) && !hasOpenToolBlock(d.reply);
  if (hasReply && s.now() - s.lastChangeAt >= (complete ? TOOL_QUIET_MS : QUIET_MS)) return null;
  s.doneSince = 0;
  say(hasReply ? "checking" : "writing");
  return { wait: 300 };
}
