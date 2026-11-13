// SPDX-License-Identifier: GPL-3.0-or-later
// The controls the preferences panel is made of. Shared by the panels that have one, so they all look the same.

/** A slider with its label, the value it stands for and a note under it. */
export const slider = (id, label, min, max, step, note) =>
  `<div class="zs-pref"><div style="display:flex;justify-content:space-between;gap:8px;font-weight:600"><span>${label}</span><span id="${id}-value"></span></div>` +
  `<input type="range" id="${id}" min="${min}" max="${max}" step="${step}" style="width:100%;box-sizing:border-box;margin:8px 0 2px" aria-label="${label}">` +
  `<div class="zs-mcp-pop-note">${note}</div></div>`;

/** Show what a slider stands for next to it, and save it when it changes. */
export function bindSlider(pop, id, value, show, store) {
  const input = pop.querySelector(`#${id}`);
  const label = pop.querySelector(`#${id}-value`);
  input.value = String(value);
  label.textContent = show(value);
  input.addEventListener("input", () => { label.textContent = show(Number(input.value)); });
  input.addEventListener("change", () => store(Number(input.value)));
  return input;
}
