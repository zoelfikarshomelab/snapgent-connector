// SPDX-License-Identifier: GPL-3.0-or-later
// wait_command, waited out. A command that went on in the background is followed by the model with wait_command, and every
// "still running" answer would cost the model a turn. Here the same call is repeated until the command is over, and only the
// final answer reaches the model, with the output printed meanwhile in front of it. Each repeat is one short call to the server
// (it answers within the bridge's limit); the live output keeps going to the terminal panel through the job key.
//
// A command that prints NOTHING NEW for WAIT_STUCK_MINUTES is taken for stuck: the wait ends with an error telling the model so.
// The command itself is not stopped: the model (or the user) decides with stop_command.

export const WAIT_STUCK_MINUTES = 30; // <- change this to make the wait shorter or longer

const STUCK_MS = WAIT_STUCK_MINUTES * 60 * 1000;
const CHUNK_SECONDS = 90;  // how long one call to the server waits (it may wait 100 s at most; the bridge gives up after 120 s)
const KEPT_CHARS = 30000;  // the most of the output printed while waiting that goes back to the model; the rest stays in get_command_output

const RUNNING_RE = /^⏳ Still running \(/;
const BODY_RE = /Output since your last look:\n([\s\S]*?)\nWait again with wait_command/;
const RUN_ID_RE = /run_id (r\d+)/;
const NO_NEW_OUTPUT = "(no new output)";

function earlierNote(earlier, runId) {
  let text = earlier.join("\n");
  let cut = 0;
  if (text.length > KEPT_CHARS) { cut = text.length - KEPT_CHARS; text = text.slice(cut); }
  const lost = cut ? `[${cut.toLocaleString("en")} earlier characters left out${runId ? `: get_command_output reads them (run_id ${runId})` : ""}]\n` : "";
  return `[Output printed while waiting, before the answer below]\n${lost}${text}\n[end of output printed while waiting]`;
}

/** The final answer with what was printed during the earlier waits in front of it (their "still running" answers are not shown). */
function withEarlier(result, earlier, runId) {
  if (!result || !earlier.length || result.kind === "stopped") return result;
  const note = earlierNote(earlier, runId);
  if (result.ok) return { ...result, text: `${note}\n${result.text}` };
  if (typeof result.error === "string") return { ...result, error: `${note}\n${result.error}` };
  return result;
}

/**
 * @param {(seconds: number) => Promise<object>} callOnce  one wait_command call to the server, waiting at most `seconds`
 * @param {{ isStopped: () => boolean, now: () => number, stuckMs?: number }} options
 * @returns {Promise<object>} the bridge result of the call that ended the wait (or an error result when it was given up)
 */
export async function waitOut(callOnce, { isStopped, now, stuckMs = STUCK_MS }) {
  const earlier = [];
  let runId = "";
  let lastNewAt = now();
  for (;;) {
    const result = await callOnce(CHUNK_SECONDS);
    const text = result && result.ok && typeof result.text === "string" ? result.text : "";
    if (!RUNNING_RE.test(text)) return withEarlier(result, earlier, runId);
    if (isStopped()) return { ok: false, kind: "stopped" };
    runId = (RUN_ID_RE.exec(text) || [])[1] || runId;
    const body = (BODY_RE.exec(text) || [])[1];
    if (body && body !== NO_NEW_OUTPUT) {
      earlier.push(body);
      lastNewAt = now();
    } else if (now() - lastNewAt >= stuckMs) {
      const minutes = Math.round(stuckMs / 60000);
      const printed = earlier.length ? `\n${earlierNote(earlier, runId)}` : "";
      return {
        ok: false,
        error: `No new output for ${minutes} min, so the wait was given up. The command was NOT stopped and may still be running${runId ? ` (run_id ${runId})` : ""}: it looks stuck. ` +
          `Read its output with get_command_output, wait again with wait_command, or end it with stop_command.${printed}`,
      };
    }
  }
}
