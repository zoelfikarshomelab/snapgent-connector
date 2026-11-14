// SPDX-License-Identifier: GPL-3.0-or-later
// The two shapes a command can have, ready to put into the call-format template: the JSON envelope (the one the extension has
// always read) and the command block (a fenced block of `key: value` lines, where nothing is escaped).
//
// The extension reads both whatever the AI is taught here, so this choice is about what the model writes, not about what works.

import { BLOCK_SPEC, JSON_SPEC } from "../domain/tools/call-format.js";

/** The buttons that put one of the two shapes into the call-format box. */
export const formatButtons = () =>
  `<div style="display:flex;gap:6px;margin-top:8px">` +
  `<button id="zs-pref-format-json" type="button" class="zs-mcp-pop-btn">Use JSON</button>` +
  `<button id="zs-pref-format-block" type="button" class="zs-mcp-pop-btn">Use the command block</button>` +
  `</div>`;

/** Wire the buttons: each one writes its shape into the call-format box, which saves it. */
export function bindFormatButtons(pop) {
  const box = pop.querySelector("#zs-pref-tpl-format");
  if (!box) return;
  const write = (text) => {
    box.value = text;
    box.dispatchEvent(new (pop.ownerDocument.defaultView.Event)("change"));
  };
  const json = pop.querySelector("#zs-pref-format-json");
  const block = pop.querySelector("#zs-pref-format-block");
  if (json) json.addEventListener("click", () => write(JSON_SPEC));
  if (block) block.addEventListener("click", () => write(BLOCK_SPEC));
}
