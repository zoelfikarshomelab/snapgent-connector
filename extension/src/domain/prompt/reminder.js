// SPDX-License-Identifier: GPL-3.0-or-later

import { DEFAULT_SERVER_ID } from "../tools/default-server.js";
import { batchPhrase } from "./system-prompt.js";
import { renderTemplate } from "./templates.js";

export function compactTools(tools) {
  return (tools || [])
    .map((t) => {
      const name = t.name || "?";
      const desc = (t.description || "").split("\n")[0].trim();
      const props = (t.inputSchema && t.inputSchema.properties) || {};
      const args = Object.keys(props).join(", ");
      return `  ${name}(${args}) - ${desc}`;
    })
    .join("\n");
}

// A short reminder of the available commands, injected under a tool result every so often so the model does not drift from the
// exact command names over a long session. The wording is the user's (see domain/prompt/templates.js).
// `calls` is the effective Commands per reply, when known: the model drifts from that limit just as easily as from the names.
export function toolsReminder(template, tools, targetName = "Snapgent MCP", serverId = DEFAULT_SERVER_ID, calls) {
  const commands =
    `  list_commands(server: "${serverId}") - list available ${targetName} commands with full parameter details\n` +
    compactTools(tools);
  return renderTemplate(template, { commands, target: targetName, calls: batchPhrase(calls) });
}
