// SPDX-License-Identifier: GPL-3.0-or-later
// What the page does with SSH servers: the connect dialog, the folder browser of a server, and how far a connection has got (the background
// worker pushes the bridge's `ssh_status` as `zs-ssh-status`).

import { DEFAULT_SERVER_ID } from "../domain/tools/default-server.js";
import { openSshDialog } from "../ui/ssh-dialog.js";
import { openRemoteFolderBrowser } from "../ui/ssh-folder-browser.js";

/** @param {{ document: Document, send: Function, settings: object, state: object, toast?: (text: string) => void }} deps */
export function createSsh({ document, send, settings, state, toast = () => {} }) {
  const listeners = new Set();
  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (message && message.type === "zs-ssh-status") for (const listener of [...listeners]) listener(message);
    });
  } catch { /* no extension messaging here */ }

  // The servers the bridge says are SSH connections (it gives each one the `user@host` it was made for).
  const connected = () => ((state.bridge && state.bridge.servers) || []).filter((server) => server.remote).map((server) => ({ id: server.id, label: server.remote }));
  const labelOf = (id) => (connected().find((server) => server.id === id) || { label: id }).label;
  const onStatus = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };

  async function disconnect(id) {
    const reply = await send({ type: "ssh_disconnect", server: id });
    if (reply && reply.ok && settings.target() === id) await settings.selectTarget(DEFAULT_SERVER_ID); // nothing is left to work with there
    return reply;
  }

  return {
    onStatus,
    connected,
    disconnect,
    openDialog() {
      openSshDialog({
        document, connect: (target) => send({ type: "ssh_connect", target }), disconnect, connected, onStatus,
        onConnected: async (reply) => {
          toast(`Connected to ${reply.label || reply.server_id}`);
          await settings.selectTarget(reply.server_id); // the chat now works on that machine (the page reloads against it)
        },
      });
    },
    /** The person browses a server's folders; the chosen path, or null. */
    browse: (server) => openRemoteFolderBrowser({ document, list: (path) => send({ type: "ssh_list_dirs", server, path }), label: labelOf(server) }),
  };
}
