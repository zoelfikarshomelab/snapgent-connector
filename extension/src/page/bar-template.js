// SPDX-License-Identifier: GPL-3.0-or-later
// The icons and markup of the control bar, kept apart from bar.js, which wires them up.

import { pillHtml } from "../ui/index.js";

const BOLT = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>`;
const TERM = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>`;
const GEAR = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
const FILES = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`;
const STAR = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
const MCP = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>`;
const CHAT = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
const INFO = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
const WAIT = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
const pill = (id, nameId, label, title = "", popup) => pillHtml({ id, nameId, label, title, popup });
export const TEMPLATE = `
  <div id="zs-bar">
    <span id="zs-state"></span>
    <button id="zs-action"></button>
    <div id="zs-tools">
      <button id="zs-term-btn" type="button" aria-label="Terminal: commands running in this chat" title="Terminal: see what the running command prints, and stop it">${TERM}<span id="zs-term-badge" hidden></span></button>
      <button id="zs-files-btn" type="button" aria-haspopup="menu" aria-label="Files: tag files in your message" title="Pick files: their contents go with your next message">${FILES}<span id="zs-files-badge" hidden></span></button>
      <button id="zs-skills-btn" type="button" aria-label="Skills" title="Skills">${STAR}</button>
      <button id="zs-mcp-btn" type="button" aria-label="MCP settings" title="MCP settings">${MCP}</button>
      <button id="zs-prefs-btn" type="button" aria-label="Preferences" title="Preferences">${GEAR}</button>
      <button id="zs-info-btn" type="button" aria-label="Tutorial" title="Tutorial">${INFO}</button>
      <button id="zs-discuss" type="button" hidden aria-pressed="false" aria-label="Agent or Discussion mode" title="Discussion mode">${CHAT}</button>
      <button id="zs-patient" type="button" aria-pressed="false" aria-label="Patient mode" title="Patient mode">${WAIT}</button>
      <button id="zs-play" type="button" hidden aria-label="Read the last reply and run its command" title="Read the last reply and run its command">▶</button>
      <button id="zs-stop" type="button" hidden aria-label="Stop" title="Stop">■</button>
    </div>
    ${pill("zs-mode-btn", "zs-mode-name", "Choose how risky actions are approved", "Plan: read only. Manual: asks first. Auto: never asks.")}
    ${pill("zs-ws-btn", "zs-ws-name", "Choose the workspace folder", "Which folder the agent works in")}
    ${pill("zs-target-btn", "zs-target-name", "Choose MCP target", "Choose which MCP server receives commands", "listbox")}
    ${pill("zs-switch", "zs-switch-name", "Switch AI and options", "Switch AI and options")}
  </div>
  <button id="zs-stop-float" type="button" hidden aria-label="Stop" title="Stop">■</button>
  <button id="zs-toggle" type="button" aria-label="Show or hide snapgent">${BOLT}</button>
  <div id="zs-menu" hidden></div><div id="zs-target-menu" hidden></div><div id="zs-mode-menu" hidden></div><div id="zs-ws-menu" hidden></div><div id="zs-files-menu" hidden></div>`;
