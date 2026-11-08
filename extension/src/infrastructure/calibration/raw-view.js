// SPDX-License-Identifier: GPL-3.0-or-later
// Some chat pages draw a JSON code block as a collapsible tree with a Tree/Raw toggle. A collapsed node keeps none of its
// content in the page (only "5 items"), so the text of the reply is not JSON any more and the command in it cannot be read.
// The Raw view holds the whole text, so it is switched on before the reply is read.
//
// The toggle is found by what it says (a "Raw" control with a "Tree" control near it), not by how one site builds it: the controls may
// be wrapped one by one or be tabs or radios, and the chosen one may be told by a class, an aria attribute or a data-state.

const CONTROLS = "button, [role=tab], [role=radio], [role=button]";
const REACH = 3; // how many levels above a Raw control its Tree control may sit
// Words in a class name that say "this one is chosen". "inactive" and "unselected" contain them but mean the opposite, so a name is cut
// into words first ("t--active", "isActive") and a word that follows "not", "non", "un" or "in" does not count.
const CHOSEN_WORDS = new Set(["active", "selected", "current", "checked"]);
const NEGATIONS = new Set(["not", "non", "un", "in"]);
const CHOSEN_STATE = /^(on|active|selected|checked)$/i;

const label = (control) => (control.textContent || control.getAttribute("aria-label") || "").trim().toLowerCase();
const words = (name) => name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const chosenByClass = (control) => String(control.className).split(/\s+/).some((name) => {
  const parts = words(name);
  return parts.some((part, at) => CHOSEN_WORDS.has(part) && !NEGATIONS.has(parts[at - 1]));
});
const isChosen = (control) =>
  chosenByClass(control) ||
  ["aria-pressed", "aria-selected", "aria-checked"].some((name) => control.getAttribute(name) === "true") ||
  (control.hasAttribute("aria-current") && control.getAttribute("aria-current") !== "false") ||
  CHOSEN_STATE.test(control.getAttribute("data-state") || "");

/** Is there a Tree control beside this Raw one, close enough to be its toggle, with no other Raw control in the way? */
function hasTreeBeside(raw, root) {
  for (let box = raw.parentElement, level = 0; box && level < REACH && root.contains(box); box = box.parentElement, level++) {
    const names = [...box.querySelectorAll(CONTROLS)].map(label);
    if (names.includes("tree")) return names.filter((name) => name === "raw").length === 1;
  }
  return false;
}

/** Every Raw control that belongs to a Tree/Raw toggle under `root`, and whether it is the chosen one already. */
function togglesIn(root) {
  if (!root || typeof root.querySelectorAll !== "function") return [];
  return [...root.querySelectorAll(CONTROLS)]
    .filter((control) => label(control) === "raw" && !control.closest("#zs-root") && hasTreeBeside(control, root))
    .map((button) => ({ button, chosen: isChosen(button) }));
}

/**
 * Press every Raw control that sits beside a Tree control and is not the chosen one yet.
 * @returns {number} how many were pressed
 */
export function showRawViews(root) {
  let pressed = 0;
  for (const { button, chosen } of togglesIn(root)) {
    if (chosen) continue;
    try { button.click(); pressed++; } catch { /* a control that cannot be pressed: the tree text is read as it is */ }
  }
  return pressed;
}

/** What a bug report needs: how many toggles there are under `root`, and how many of them are not on Raw yet. */
export function rawViewState(root) {
  const toggles = togglesIn(root);
  return { pairs: toggles.length, notShown: toggles.filter((toggle) => !toggle.chosen).length };
}
