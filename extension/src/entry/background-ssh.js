// SPDX-License-Identifier: GPL-3.0-or-later
// SSH in the background worker: how the bridge's answers are passed on, and the window where the person answers ssh's questions.
//
// A passphrase is typed in a window of the extension's own, never in the chat page: the page's scripts can listen to every key typed
// there, and no dialog drawn inside it keeps them out. The window talks to this worker only, and only a message that comes from that
// page is believed (a content script's messages carry the chat site's address instead). The answer is passed on and forgotten:
// it is never stored, logged or kept after the window closes.

import { promptInfo } from "../domain/ssh/prompt-view.js";

export const PROMPT_PAGE = "ssh-prompt.html";
const WINDOW = { type: "popup", width: 480, height: 340, focused: true };

/**
 * What the page that asked gets back from a bridge message: everything the bridge put in it (`recent`, `dirs`, `server_id`, ...), without
 * the envelope. Picking fields one by one is what once made the folders used lately vanish on the way. A folder listing always has the
 * fields the menus read.
 */
export function replyOf(msg) {
  const reply = { ...msg };
  delete reply.type;
  delete reply.id;
  if (msg.type === "workspace" && msg.ok) {
    return { ...reply, active: msg.active || null, open: Array.isArray(msg.open) ? msg.open : [], pinned: msg.pinned || null, picked: msg.picked || null };
  }
  return reply;
}

/**
 * @param {{ windows?: { create: Function, remove: Function }, pageUrl: string, answer: (id: string, value: string|null) => Promise<*> }} deps
 *   `answer` hands the person's reply to the bridge (null: cancelled).
 */
export function createSshPrompts({ windows, pageUrl, answer }) {
  const open = new Map(); // question id -> { info, windowId }

  const fromPage = (sender) => !!(sender && typeof sender.url === "string" && sender.url.startsWith(pageUrl) && /^([?#]|$)/.test(sender.url.slice(pageUrl.length)));
  const forget = async (windowId) => {
    if (windowId === null || windowId === undefined || !windows) return;
    try { await windows.remove(windowId); } catch { /* it is gone already */ }
  };

  async function finish(id, value) {
    const entry = open.get(id);
    if (!entry) return false;
    open.delete(id); // first: closing the window below must not count as a cancel
    await answer(id, value);
    await forget(entry.windowId);
    return true;
  }

  return {
    /** A question from the bridge: open the window for it. Where no window can be opened it is answered as cancelled at once. */
    async show(message) {
      const info = promptInfo(message);
      if (!info.id) return;
      if (!windows || typeof windows.create !== "function") { await answer(info.id, null); return; }
      open.set(info.id, { info, windowId: null });
      let created;
      try {
        created = await windows.create({ ...WINDOW, url: `${pageUrl}?id=${encodeURIComponent(info.id)}` });
      } catch {
        if (open.delete(info.id)) await answer(info.id, null);
        return;
      }
      const entry = open.get(info.id);
      if (!entry) { await forget(created && created.id); return; } // answered while the window was still opening
      entry.windowId = created ? created.id : null;
    },

    /** The window was closed (by the person, or by us): a question it still held is cancelled. */
    windowClosed(windowId) {
      for (const [id, entry] of open) {
        if (entry.windowId !== windowId) continue;
        open.delete(id);
        Promise.resolve(answer(id, null)).catch(() => {});
      }
    },

    /** The bridge went away: nobody is waiting for an answer any more. */
    closeAll() {
      for (const [id, entry] of open) {
        open.delete(id);
        forget(entry.windowId);
      }
    },

    handles: (message) => !!message && (message.type === "ssh_prompt_get" || message.type === "ssh_prompt_answer"),

    /** The window's two messages: what to show, and what the person answered. Believed only when they come from the window itself. */
    async handle(message, sender) {
      if (!fromPage(sender)) return { ok: false, error: "not allowed" };
      const id = typeof message.prompt_id === "string" ? message.prompt_id : "";
      if (message.type === "ssh_prompt_get") {
        const entry = open.get(id);
        return entry ? { ok: true, kind: entry.info.kind, label: entry.info.label, text: entry.info.text } : { ok: false, error: "That question is no longer waiting." };
      }
      return { ok: await finish(id, typeof message.answer === "string" ? message.answer : null) };
    },
  };
}
