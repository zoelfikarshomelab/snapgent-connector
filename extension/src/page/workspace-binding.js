// SPDX-License-Identifier: GPL-3.0-or-later
// Which folder each chat works in. The server follows VS Code's active window, which changes while a chat runs (and is the wrong
// answer for a second chat in another project); a chat is therefore tied to the folder it was started in. The folder is kept per
// conversation (so it survives a reload and a server restart) and sent with every command.

const KEY = "zsWorkspaceRoots";
const REMEMBER_LIMIT = 300;

/**
 * @param {{ storage: { get: (key: string) => Promise<*>, set: (key: string, value: *) => void },
 *           provider: { conversationKey: () => string }, accountKey?: () => string, serverKey?: () => string }} deps
 *   `accountKey` is the login in use: the folders of a chat are kept per login, so a chat opened under one account does not
 *   inherit the folder another account's chat of the same URL worked in.
 *   `serverKey` names the SSH server the chat works on ("" for this computer): a folder is a path on ONE machine, so this computer's folder
 *   is never sent to a server, nor a server's folder used on this computer.
 */
export function createWorkspaceBinding({ storage, provider, accountKey = () => "", serverKey = () => "" }) {
  const scopeKey = () => {
    const key = provider.conversationKey();
    if (!key) return key;
    const account = accountKey();
    const scoped = account ? `${account}::${key}` : key;
    const server = serverKey();
    return server ? `${server}>>${scoped}` : scoped;
  };
  let roots = {};
  let pending = null; // chosen at the start, before the new chat has an id to keep it under
  storage.get(KEY).then((saved) => { roots = { ...(saved && typeof saved === "object" ? saved : {}), ...roots }; });

  const save = () => storage.set(KEY, Object.fromEntries(Object.entries(roots).slice(-REMEMBER_LIMIT)));

  return {
    /** The folder this chat works in, or null (an older chat that has none yet). */
    current() {
      const key = scopeKey();
      return (key && roots[key]) || pending || null;
    },
    /** A folder chosen for a chat that is about to start. */
    setPending(path) { pending = path || null; },
    clearPending() { pending = null; },
    /** The chat has an id now: keep its folder under it. */
    commit() {
      const key = scopeKey();
      if (!key || !pending) return;
      roots[key] = pending;
      pending = null;
      save();
    },
    /** The user chose a folder for this chat (the bar's menu); `null` lets it follow the server again. */
    bind(path) {
      const key = scopeKey();
      if (!key) { pending = path || null; return; }
      if (path) roots[key] = path; else delete roots[key];
      save();
    },
  };
}
