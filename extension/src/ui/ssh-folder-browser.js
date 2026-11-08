// SPDX-License-Identifier: GPL-3.0-or-later
// Chooses a folder on a machine reached over SSH. The system's folder window shows THIS computer's folders, so for a server the bar lists the
// server's own: one level at a time, folder names only, asked of the server through the bridge. What comes back is a path the person clicked
// to; whoever uses it still asks for approval before the agent works there (this window is part of the chat page, so a script of the site
// could drive it).

import { escapeHtml as esc, setHtml } from "./html.js";
import { closeButton, mountPopup } from "./popup.js";

const inside = (folder, name) => `${String(folder).replace(/\/+$/, "")}/${name}`;

/**
 * @param {{ document: Document, list: (path?: string) => Promise<{ ok: boolean, path?: string, parent?: string|null, dirs?: string[], truncated?: boolean, error?: string }>,
 *           label?: string, start?: string|null }} deps  `list` asks the server for the folders inside `path` (its home folder when none is given)
 * @returns {Promise<string|null>} the chosen folder, or null when the window was closed
 */
export function openRemoteFolderBrowser({ document, list, label = "the server", start = null }) {
  return new Promise((resolve) => {
    let finished = false;
    let watch = null;
    const finish = (value) => {
      if (finished) return;
      finished = true;
      if (watch) watch.disconnect();
      resolve(value);
    };
    const { pop, close } = mountPopup(document, { onClose: () => finish(null) });
    // Another popup replaces this one without closing it: that is a "no" as well, or the question would never be answered.
    watch = new document.defaultView.MutationObserver(() => { if (!pop.isConnected) finish(null); });
    watch.observe(document.documentElement, { childList: true });

    setHtml(pop,
      `<div class="zs-mcp-pop-card zs-ssh-card" role="dialog" aria-label="Choose a folder on the server">` +
      `<div class="zs-mcp-pop-head"><span>Folder on ${esc(label)}</span>${closeButton}</div>` +
      `<div class="zs-mcp-pop-body"><div class="zs-ssh-path" aria-live="polite"></div><div class="zs-mcp-pop-note zs-ssh-error" hidden></div>` +
      `<div class="zs-ssh-dirs" aria-label="Folders"></div></div>` +
      `<div class="zs-mcp-pop-foot"><button type="button" class="zs-mcp-pop-btn zs-ssh-up" disabled>↑ Up</button>` +
      `<button type="button" class="zs-mcp-pop-btn zs-mcp-pop-btn-primary zs-ssh-use" disabled>Use this folder</button></div></div>`);
    const $ = (selector) => pop.querySelector(selector);
    let current = null;
    let parent = null;
    let loading = false;
    const showError = (text) => { const el = $(".zs-ssh-error"); el.textContent = text || ""; el.hidden = !text; };
    const note = (text) => { const el = document.createElement("div"); el.className = "zs-mcp-pop-note"; el.textContent = text; return el; };

    async function load(path) {
      if (loading) return;
      loading = true;
      showError("");
      let reply;
      try { reply = await list(path); } catch (error) { reply = { ok: false, error: String((error && error.message) || error) }; }
      loading = false;
      if (finished) return;
      if (!reply || !reply.ok) { showError((reply && reply.error) || "Could not read that folder."); return; }
      current = reply.path;
      parent = reply.parent || null;
      $(".zs-ssh-path").textContent = current;
      $(".zs-ssh-up").disabled = !parent;
      $(".zs-ssh-use").disabled = false;
      const box = $(".zs-ssh-dirs");
      box.textContent = "";
      const names = Array.isArray(reply.dirs) ? reply.dirs : [];
      for (const name of names) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "zs-ssh-dir";
        button.textContent = name; // a folder's name is text, whatever it holds
        button.addEventListener("click", () => load(inside(current, name)));
        box.appendChild(button);
      }
      if (!names.length) box.appendChild(note("No folders inside."));
      if (reply.truncated) box.appendChild(note("Only the first folders are listed."));
    }

    $(".zs-mcp-pop-close").addEventListener("click", close);
    $(".zs-ssh-up").addEventListener("click", () => { if (parent) load(parent); });
    $(".zs-ssh-use").addEventListener("click", () => { if (!current) return; finish(current); close(); });
    load(start || undefined);
  });
}
