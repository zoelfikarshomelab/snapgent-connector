// SPDX-License-Identifier: GPL-3.0-or-later
// Commands the extension answers itself (they never reach the bridge). They answer with a body and say whether they failed:
// the wording around it is the user's (see domain/prompt/templates.js).

import { formatCatalogue } from "./catalogue.js";
import { DEFAULT_SERVER_ID } from "./default-server.js";

export const LIST_SERVERS = "list_mcp_servers";
export const isListCommands = (name) => name === "list_commands" || name === "list_tools";

/** A tool without a "server" tag comes from an older bridge: treat it as the default server. */
export const serverOf = (tool) => tool.server || DEFAULT_SERVER_ID;

/**
 * @param {{ servers: Array<{id:string, alive?:boolean, tools?:number}>, target: string }} input
 *   `servers` must already be limited to the selected, enabled server.
 * @returns {{ body: string, isError: boolean }}
 */
export function renderServerList({ servers, target }) {
  const lines = servers.length
    ? servers.map((sv) => {
        const label = sv.id === DEFAULT_SERVER_ID ? "Snapgent MCP (default target)" : `${sv.id} (addon)`;
        return `- ${sv.id}: ${label} - ${sv.alive ? `${sv.tools || 0} commands available` : "offline (no tools)"}`;
      })
    : [`- ${DEFAULT_SERVER_ID}: Snapgent MCP (default target) - unknown (bridge did not report server health)`];
  return {
    body: `Connected MCP servers (${lines.length}):\n${lines.join("\n")}\n` +
      `Use list_commands with a "server" param (one of the ids above) to see that server's exact commands. Without "server", list_commands defaults to "${target}".`,
    isError: false,
  };
}

/**
 * @param {{ name: string, target: string, asked?: string, enabled: boolean, tools: object[] }} input
 *   `tools` is the full advertised catalogue; it is scoped to `target` here.
 * @returns {{ body: string, isError: boolean }}
 */
export function renderCommandList({ name, target, asked = "", enabled, tools }) {
  // Only the selected server can be listed. Asking for any other gets a generic
  // refusal that does not reveal whether that server exists or is connected.
  if (asked && asked !== target) {
    return { body: `server "${asked}" is not available. Only the selected target "${target}" can be used in this session. Do NOT try other servers; ask the user to switch the target in the snapgent selector if needed.`, isError: true };
  }
  if (!enabled) {
    return { body: `MCP server "${target}" is disabled by the user. Do NOT use it. Tell the user to enable it in the MCP settings if it is needed.`, isError: true };
  }
  if (!tools.length) return { body: "No commands available - the bridge or selected MCP server may be offline.", isError: true };
  const scoped = tools.filter((tool) => serverOf(tool) === target);
  if (!scoped.length) {
    return { body: `the selected server "${target}" has no commands available (it may be offline). Do NOT try other servers; tell the user to check the target in the snapgent selector.`, isError: true };
  }
  return { body: `${target} commands (${scoped.length}):\n\n${formatCatalogue(scoped)}`, isError: false };
}
