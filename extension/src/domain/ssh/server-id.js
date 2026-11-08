// SPDX-License-Identifier: GPL-3.0-or-later
// Which MCP servers are SSH connections. The bridge names each one "ssh-<user>-<host>" (snapgent_bridge/ssh_target.py) and only it can make
// such a server: a folder question for one goes to that server instead of the default one. Pure.

export const SSH_PREFIX = "ssh-";

export const isSshServerId = (id) => typeof id === "string" && id.startsWith(SSH_PREFIX) && id.length > SSH_PREFIX.length;

/** The server a folder question must be sent to: the SSH server when the target is one, otherwise nothing (the default server answers). */
export const workspaceServerOf = (target) => (isSshServerId(target) ? target : undefined);
