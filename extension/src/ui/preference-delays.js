// SPDX-License-Identifier: GPL-3.0-or-later
// The two pauses of the agent, in the preferences panel: one after every command that runs, and a random one after the last
// command of a reply. Both are in seconds, both are off until the user asks for them.
//
// The pauses are the user's own, so they are general: every site waits the same. The composer says how long is left while the
// agent waits ("delay 5").

import { clampDelaySeconds, MAX_DELAY_SECONDS } from "../domain/tools/delay.js";

const BOX = "border:1px solid rgba(128,128,128,.4);border-radius:6px";

/** A number field: the pause in seconds. */
const numberField = (id, label, note) =>
  `<div class="zs-pref"><div style="display:flex;justify-content:space-between;gap:8px;font-weight:600"><span>${label}</span>` +
  `<span style="display:flex;align-items:center;gap:6px;white-space:nowrap">seconds` +
  `<input type="number" id="${id}" min="0" max="${MAX_DELAY_SECONDS}" step="1" style="width:84px;box-sizing:border-box;${BOX};padding:3px 6px;background:transparent;color:inherit" aria-label="${label}"></span></div>` +
  `<div class="zs-mcp-pop-note">${note}</div></div>`;

/** The two pauses. */
export const delayFields = () =>
  numberField("zs-pref-delay", "Delay per command",
    "A pause after every command that runs, before the next one starts. The composer says how long is left (`delay 5`); Stop ends the wait at once.") +
  numberField("zs-pref-random-delay", "Random delay after the commands",
    "A random pause of up to this many seconds after all the commands of a reply have run, before the results go back to the AI.");

/** Wire the fields: each change is saved as it is made, and a value the panel does not allow is brought back into it. */
export function bindDelays(pop, values, save) {
  for (const [id, key, value] of [["zs-pref-delay", "delay", values.delay || 0], ["zs-pref-random-delay", "randomDelay", values.randomDelay || 0]]) {
    const input = pop.querySelector(`#${id}`);
    input.value = String(value);
    input.addEventListener("change", () => {
      const seconds = clampDelaySeconds(input.value);
      input.value = String(seconds); // what the field shows is what is saved
      if (save[key]) save[key](seconds);
    });
  }
}

/** Put both pauses back to none. */
export function resetDelays(pop, save) {
  for (const [id, key] of [["zs-pref-delay", "delay"], ["zs-pref-random-delay", "randomDelay"]]) {
    const input = pop.querySelector(`#${id}`);
    if (!input) continue;
    input.value = "0";
    if (save[key]) save[key](0);
  }
}
