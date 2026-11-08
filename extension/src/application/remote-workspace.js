// SPDX-License-Identifier: GPL-3.0-or-later
// Which folder a chat on a server over SSH works in, when nothing there has said: the person browses the server's folders. A server has no
// editor with a folder open, so "the only open folder" never answers. The folder is chosen in a window of the chat page, which a script of
// the site could drive, so it is asked about once more in the dialog the page cannot click (the same question a typed path gets).

/**
 * @param {{ server: string, browse: (server: string) => Promise<string|null>, confirm: { ask: (request: object) => Promise<boolean> },
 *           send: (message: object) => Promise<object>, setPending: (path: string) => void }} deps
 * @returns {Promise<{ path?: string, cancelled?: boolean, error?: string }>}
 */
export async function chooseRemoteWorkspace({ server, browse, confirm, send, setPending }) {
  const path = await browse(server);
  if (!path) return { cancelled: true };
  const allowed = await confirm.ask({ description: `Let the agent read and change files in this folder on the server?\n${path}`, tool: "Workspace", risk: "write" });
  if (!allowed) return { cancelled: true };
  const pinned = await send({ type: "set_workspace", path, server });
  if (!pinned || !pinned.ok) return { error: (pinned && pinned.error) || "Could not use that folder." };
  setPending(path);
  return { path };
}
