// SPDX-License-Identifier: GPL-3.0-or-later
// "Import logins": a small window on the chat page that opens the file window and says what came of the file. It lives on the page
// because a popup closes the moment a file window takes its focus, and the answer would have nowhere to be shown.

import { escapeHtml as esc, setHtml } from "./html.js";
import { closeButton, mountPopup } from "./popup.js";
import { chooseTextFiles } from "./file-transfer.js";

const GOOD = "#3ddc97";
const BAD = "#ff6b6b";

/**
 * @param {{ document: Document, siteName: string, onText: (text: string) => Promise<{ ok: boolean, message: string }> }} deps
 *   `onText` gets the text of the chosen file and says what happened to it
 */
export function openAccountsImport({ document, siteName, onText }) {
  const { pop, close } = mountPopup(document);
  setHtml(pop,
    `<div class="zs-mcp-pop-card" role="dialog" aria-label="Import logins">` +
      `<div class="zs-mcp-pop-head"><span>Import logins · ${esc(siteName)}</span>${closeButton}</div>` +
      `<div class="zs-mcp-pop-note">Choose a file exported from the Accounts section. A login with the same name is replaced; the login in use does not change.</div>` +
      `<div class="zs-mcp-pop-note zs-acc-import-result"></div>` +
      `<div class="zs-mcp-pop-foot"><button type="button" class="zs-mcp-pop-btn zs-mcp-pop-btn-block zs-acc-import-pick">Choose file…</button></div>` +
    `</div>`);
  const result = pop.querySelector(".zs-acc-import-result");
  pop.querySelector(".zs-mcp-pop-close").addEventListener("click", close);
  // The click is the user's own, on this page: that is what lets the browser open the file window.
  pop.querySelector(".zs-acc-import-pick").addEventListener("click", () => chooseTextFiles(document, {}, async ([text]) => {
    result.style.color = "";
    result.textContent = "Importing…";
    const outcome = await onText(text);
    result.style.color = outcome.ok ? GOOD : BAD;
    result.textContent = outcome.message;
  }));
  return { close };
}
