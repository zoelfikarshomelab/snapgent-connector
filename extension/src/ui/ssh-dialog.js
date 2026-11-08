// SPDX-License-Identifier: GPL-3.0-or-later
// The dialog that connects to a server over SSH: where to type user@host, how far the connection has got, and the servers already connected
// (each with a Disconnect). The passphrase of the person's key is NOT asked here: a page of the chat site can listen to every key typed in it,
// so ssh's questions are answered in a window of the extension's own (see entry/background-ssh.js).

import { setHtml } from "./html.js";
import { closeButton, mountPopup } from "./popup.js";

/** What to say about one `ssh_status` push of the bridge. */
export function statusLine(message) {
  const label = (message && message.label) || "the server";
  switch (message && message.state) {
    case "connecting": return { text: `Signing in to ${label}… If ssh asks for a passphrase, answer in the window that opens.`, kind: "" };
    case "preparing": return { text: `Putting the Snapgent server on ${label}…`, kind: "" };
    case "ready": return { text: `Connected to ${label}.`, kind: "ok" };
    case "failed": return { text: message.detail || `Could not connect to ${label}.`, kind: "bad" };
    case "closed": return { text: message.detail || `Disconnected from ${label}.`, kind: "warn" };
    default: return { text: "", kind: "" };
  }
}

/**
 * @param {{ document: Document, connect: (target: string) => Promise<object>, disconnect: (id: string) => Promise<object>,
 *           connected?: () => Array<{ id: string, label?: string }>, onStatus?: (listener: (message: object) => void) => () => void,
 *           onConnected?: (reply: object) => void, onClose?: () => void }} deps
 */
export function openSshDialog({ document, connect, disconnect, connected = () => [], onStatus = () => () => {}, onConnected = () => {}, onClose = () => {} }) {
  let unsubscribe = () => {};
  const { pop, close } = mountPopup(document, { onClose: () => { unsubscribe(); onClose(); } });
  setHtml(pop,
    `<div class="zs-mcp-pop-card zs-ssh-card" role="dialog" aria-label="Connect over SSH">` +
    `<div class="zs-mcp-pop-head"><span>Connect over SSH</span>${closeButton}</div>` +
    `<div class="zs-mcp-pop-body"><form class="zs-ssh-form"><input class="zs-ssh-input" type="text" spellcheck="false" autocomplete="off" placeholder="user@host or user@host:port" aria-label="Server, as user@host">` +
    `<button type="submit" class="zs-mcp-pop-btn zs-mcp-pop-btn-primary zs-ssh-go">Connect</button></form>` +
    `<div class="zs-ssh-status" role="status" aria-live="polite"></div><div class="zs-ssh-conns"></div>` +
    `<div class="zs-mcp-pop-note">The tools (reading, editing, commands) run on that machine, which needs python3. The passphrase of your key is asked in a separate window of the extension, never in this page, and is not stored. OpenSSH 8.4 or newer is needed.</div></div></div>`);
  const $ = (selector) => pop.querySelector(selector);
  const input = $(".zs-ssh-input");
  const go = $(".zs-ssh-go");
  const say = (text, kind = "") => { const el = $(".zs-ssh-status"); el.textContent = text || ""; el.dataset.kind = kind; };
  // Typing here must not trigger the site's own keyboard shortcuts.
  for (const type of ["keydown", "keyup", "keypress", "input"]) input.addEventListener(type, (event) => event.stopPropagation());

  const drawConnections = (list) => {
    const box = $(".zs-ssh-conns");
    box.textContent = "";
    for (const server of list) {
      const name = server.label || server.id;
      const row = document.createElement("div");
      row.className = "zs-ssh-conn";
      const text = document.createElement("span");
      text.textContent = name;
      const off = document.createElement("button");
      off.type = "button";
      off.className = "zs-mcp-pop-btn zs-mcp-pop-btn-small zs-ssh-off";
      off.textContent = "Disconnect";
      off.addEventListener("click", async () => {
        off.disabled = true;
        let reply;
        try { reply = await disconnect(server.id); } catch (error) { reply = { ok: false, error: String((error && error.message) || error) }; }
        if (reply && reply.ok) { row.remove(); say(`Disconnected from ${name}.`, "warn"); return; }
        off.disabled = false;
        say((reply && reply.error) || "Could not disconnect.", "bad");
      });
      row.append(text, off);
      box.appendChild(row);
    }
  };
  drawConnections(connected());

  let busy = false;
  unsubscribe = onStatus((message) => {
    if (!busy) return;
    const line = statusLine(message);
    say(line.text, line.kind);
  });

  $(".zs-ssh-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const target = input.value.trim();
    if (!target) { say("Type the server as user@host.", "warn"); return; }
    busy = true;
    go.disabled = true;
    input.disabled = true;
    say("Connecting…");
    let reply;
    try { reply = await connect(target); } catch (error) { reply = { ok: false, error: String((error && error.message) || error) }; }
    busy = false;
    go.disabled = false;
    input.disabled = false;
    if (!reply || !reply.ok) { say((reply && reply.error) || "Could not connect.", "bad"); return; }
    say(`Connected to ${reply.label || target}.`, "ok");
    onConnected(reply);
  });
  $(".zs-mcp-pop-close").addEventListener("click", close);
  input.focus();
  return { close };
}
