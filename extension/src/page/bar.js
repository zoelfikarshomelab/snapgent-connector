// SPDX-License-Identifier: GPL-3.0-or-later
// The control bar: a narrow column in a corner of the window with the agent's status, Start / Stop, the pills that choose the target,
// the approval mode and the workspace, and the "switch AI" menu; a small button beside it shows or hides it. It never attaches to
// the site's own layout. Also owns the other things the page shows the user: notices, toasts, the first-run card and the cover over
// the composer while the agent types.

import {
  computeBarView, createBarPlacer, createInputCover, createNotifications, createSetupCard, shouldShowSetup, applyTheme,
  computeMenuPlacement, applyMenuPlacement, viewportOf, setHtml,
} from "../ui/index.js";
import { controlFace } from "../domain/agent/agent-mode.js";
import { isWorkspaceServer } from "../domain/agent/session-start.js";
import { createBarMenus } from "./bar-menus.js";
import { createBarSettings } from "./bar-settings.js";
import { createFilesMenu } from "./files-menu.js";
import { createMenuGroup } from "./pill-menu.js";
import { createSiteMenu } from "./site-menu.js";
import { TEMPLATE } from "./bar-template.js";

const GITHUB_URL = "https://github.com/zoelfikarshomelab/snapgent-connector";

/**
 * @param {{ document: Document, window: Window, provider: object, state: object, settings: object, serverDirectory: object, tools: object,
 *           monitor: object, storage: object, preferences: object, send: Function, calibration: object, files: object, onStart: () => void, onStop: () => void }} deps
 */
export function createBar({ document, window, provider, state, settings, serverDirectory, tools, monitor, storage, preferences, send, calibration, terminal, ssh = null, files, onStart, onStop, onPlay, onToggleMode, onTogglePatient, onAdopt }) {
  const root = document.createElement("div");
  root.id = "zs-root";
  const notifications = createNotifications({ root });
  setHtml(root, TEMPLATE);
  document.documentElement.appendChild(root);
  const $ = (selector) => root.querySelector(selector);
  const el = { bar: $("#zs-bar"), state: $("#zs-state"), action: $("#zs-action"), stop: $("#zs-stop"), play: $("#zs-play"), discuss: $("#zs-discuss"), patient: $("#zs-patient"), stopFloat: $("#zs-stop-float"), toggle: $("#zs-toggle"), menu: $("#zs-menu") };

  // Where the bar sits (the show/hide button's left/top, null until it is dragged) and whether it is shown: the user's choice, the same on every site.
  let prefs = { left: null, top: null, hidden: false };
  storage.get("zsBarPrefs").then((saved) => { if (saved) prefs = { ...prefs, ...saved }; });
  storage.watch("zsBarPrefs", (saved) => { prefs = { ...prefs, ...saved }; });
  const barPrefs = { get: () => prefs, set(change) { prefs = { ...prefs, ...change }; storage.set("zsBarPrefs", prefs); } };
  // The show/hide button is also the handle: a click shows or hides the bar, a drag moves it (the bar follows the button).
  let drag = null;
  let suppressClick = false;
  el.toggle.addEventListener("pointerdown", (event) => {
    if (event.button) return;
    const rect = el.toggle.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
    if (el.toggle.setPointerCapture) el.toggle.setPointerCapture(event.pointerId);
  });
  el.toggle.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return; // a click that wobbles is still a click
    drag.moved = true;
    prefs = { ...prefs, left: Math.round(drag.left + dx), top: Math.round(drag.top + dy) };
  });
  const endDrag = () => {
    if (!drag) return;
    if (drag.moved) {
      suppressClick = true; // the click that ends a drag must not also hide the bar
      setTimeout(() => { suppressClick = false; }, 0);
      barPrefs.set({}); // keeps the place the button was dropped
    }
    drag = null;
  };
  el.toggle.addEventListener("pointerup", endDrag);
  el.toggle.addEventListener("pointercancel", endDrag);
  el.toggle.addEventListener("click", (event) => { event.stopPropagation(); if (suppressClick) return; barPrefs.set({ hidden: !prefs.hidden }); });

  const group = createMenuGroup();
  const menus = createBarMenus({ document, root, group, settings, serverDirectory, send, confirm: tools.confirm, catalogue: tools.catalogue, workspace: tools.workspace, monitor, toast: notifications.toast, ssh });
  // Skills, MCP servers and Preferences live in their own buttons; the Files window opens the same Preferences dialog.
  const isWorkspaceTarget = () => isWorkspaceServer(settings.target(), tools.catalogue ? tools.catalogue.active().map((t) => t.name) : []);
  const barSettings = createBarSettings({
    document, root, settings, serverDirectory, tools, preferences, calibration, isWorkspaceTarget, storage,
    syncMenus: () => menus.sync(),
  });
  const filesMenu = createFilesMenu({
    document, root, group, state, settings, files, preferences, toast: notifications.toast,
    openPreferences: barSettings.openPreferences,
  });
  const siteMenu = createSiteMenu({
    document, window, menu: el.menu, button: $("#zs-switch"), group, provider, calibration, barPrefs,
  });
  $("#zs-switch-name").textContent = provider.displayName || provider.id;

  const cover = createInputCover({ document, provider });
  const setup = createSetupCard({ document, githubUrl: GITHUB_URL, onDismiss: () => settings.markSetupSeen() });

  const placer = createBarPlacer({
    document, provider, prefs: barPrefs.get,
    parts: () => ({ bar: el.bar, root, menuEl: el.menu, toggleEl: el.toggle, stopEl: el.stop, stopFloatEl: el.stopFloat }),
    positionMenu: (anchor) => {
      if (el.menu.hidden) return;
      applyMenuPlacement(el.menu, computeMenuPlacement({ anchor, menuWidth: el.menu.offsetWidth, defaultWidth: 274, viewport: viewportOf(document, window), align: "right", roomAbove: 180 }));
    },
  });
  (function place() { window.requestAnimationFrame(place); placer.place(); })(); // scheduled first, so a throw cannot stop the loop

  // ── what the bar says ──
  let lastSignature = "";
  let lastTermCount = -1;
  function render() {
    menus.sync();
    filesMenu.sync();
    // The terminal pill carries a count of the commands still running, however the bar otherwise looks.
    const running = terminal ? terminal.runningCount() : 0;
    if (running !== lastTermCount) {
      const badge = $("#zs-term-badge");
      badge.hidden = running === 0;
      badge.textContent = running ? String(running) : "";
      lastTermCount = running;
    }
    const view = computeBarView({
      staleExtension: state.staleExtension, starting: state.starting, started: state.started, running: state.running, parked: state.parked,
      blankChat: !state.started && !state.starting && !state.staleExtension && (provider.isFreshChat() || provider.chatIsEmpty()),
      bridge: state.bridge, bridgeOk: monitor.bridgeOk,
      target: { id: settings.target(), name: serverDirectory.name(settings.target()) },
      activeToolCount: tools.catalogue.active().length,
      workspaceReady: monitor.workspaceReady, workspaceProbePending: monitor.workspaceProbePending, workspaceFolder: tools.workspace.bound(),
      modeWarning: !state.started && !state.starting && provider.modeWarning ? provider.modeWarning() : null,
      needsCalibration: !!provider.needsCalibration,
      discuss: !!state.discuss,
    });
    const busy = !el.stop.hidden;
    // The Stop slot has a second face, Play, while the agent is idle in a live session (see domain/agent/agent-mode.js).
    el.play.hidden = controlFace({ discuss: state.discuss, busy, started: state.started, starting: state.starting, stale: state.staleExtension }) !== "play";
    el.discuss.hidden = !state.started || state.starting || state.staleExtension;
    el.discuss.dataset.on = state.discuss ? "1" : "0";
    el.discuss.setAttribute("aria-pressed", state.discuss ? "true" : "false");
    el.discuss.title = state.discuss ? "Discussion: the agent is off. Click to turn it on" : "Agent is on. Click for Discussion: no command is read or run";
    el.patient.hidden = !!state.staleExtension;
    el.patient.dataset.on = state.patient ? "1" : "0";
    el.patient.setAttribute("aria-pressed", state.patient ? "true" : "false");
    el.patient.title = state.patient ? "Patient mode is on: a reply counts as finished only after its text stopped changing for a while. Click to turn it off" : "Patient mode is off. Click to wait longer before a reply counts as finished (for sites that cut off a thinking reply)";
    // Only touch the DOM when something changed: rewriting the status restarts the spinner's CSS animation.
    const signature = [view.tone, view.spinner, view.message, view.label, view.kind, view.disabled, view.warn, busy].join("|");
    if (signature === lastSignature) return;
    lastSignature = signature;
    el.bar.classList.remove("tone-standby", "tone-active", "tone-warn", "tone-noagent", "tone-starting");
    el.bar.classList.add(`tone-${view.tone}`);
    setHtml(el.state, `${view.spinner ? `<span class="zs-spin"></span>` : ""}<span class="zs-state-txt">${view.message}</span>`);
    el.state.classList.toggle("zs-state-warn", view.warn);
    el.action.textContent = view.label;
    el.action.dataset.kind = view.kind;
    el.action.disabled = view.disabled;
    el.action.style.display = busy || !view.kind ? "none" : ""; // Stop takes the action button's place while the agent is busy
  }

  el.action.addEventListener("click", () => {
    if (el.action.dataset.kind === "start") onStart();
    else if (el.action.dataset.kind === "adopt") { if (onAdopt) onAdopt(); }
    else if (el.action.dataset.kind === "calibrate") {
      // A part that stopped matching is redone on its own; a site never calibrated is done from the start.
      const problem = provider.health && provider.health().problems[0];
      calibration.open(problem && ["composer", "send"].includes(problem.role) ? problem.role : null);
    }
  });
  el.term = $("#zs-term-btn");
  el.term.addEventListener("click", (event) => { event.stopPropagation(); if (terminal) terminal.toggle(); });
  el.stop.addEventListener("click", onStop);
  el.play.addEventListener("click", () => { if (onPlay) onPlay(); });
  el.discuss.addEventListener("click", () => { if (onToggleMode) onToggleMode(); });
  el.patient.addEventListener("click", () => { if (onTogglePatient) onTogglePatient(); });
  el.stopFloat.addEventListener("click", (event) => { event.stopPropagation(); el.stop.click(); }); // the same Stop, reachable while the bar is hidden

  applyTheme(document);
  setInterval(() => applyTheme(document), 4000); // follow the host page toggling its theme
  document.addEventListener("zs-provider-changed", render);
  render();

  let nudged = false;
  return {
    render,
    root,
    cover: cover.set,
    coverLabel: cover.setLabel,
    toast: (text) => notifications.toast(text),
    banner: (level, title, text) => notifications.banner(level, title, text),
    openMenu: (toSupport) => { if (el.menu.hidden) siteMenu.toggle(toSupport); },
    openPreferences: barSettings.openPreferences,

    /** Stop is shown while the agent is busy; it stays through the wind-down so it does not blink as the site's signals flicker. */
    showStop(visible) {
      const allow = (visible || state.stopping) && !state.starting;
      const was = el.stop.hidden;
      el.stop.hidden = !allow;
      if (allow && !state.stopping && el.stop.dataset.state === "stopping") {
        el.stop.disabled = false;
        el.stop.textContent = "■";
        el.stop.title = "Stop"; el.stop.setAttribute("aria-label", "Stop");
        el.stopFloat.textContent = "■";
        delete el.stop.dataset.state;
      }
      if (was !== el.stop.hidden) render();
    },
    /** The moment Stop is clicked, so the user sees it registered while the loop winds down. */
    markStopping() {
      el.stop.hidden = false;
      el.stop.disabled = true;
      el.stop.dataset.state = "stopping";
      el.stop.textContent = "⏳";
      el.stop.title = "Stopping…"; el.stop.setAttribute("aria-label", "Stopping…");
      el.stopFloat.textContent = "⏳";
      render();
    },
    /** The user typed in a fresh chat without starting the agent: plain chat is fine, so only point at Start, once. */
    nudgeStart() {
      if (state.started || !provider.isFreshChat()) return;
      if (!nudged) { nudged = true; notifications.toast("Click “▶︎ Start” to begin."); }
      el.action.classList.add("zs-flash");
      setTimeout(() => el.action.classList.remove("zs-flash"), 1200);
    },
    /** The bridge status changed: `lost` means it was connected a moment ago and is not any more. */
    bridgeChanged({ connected, lost }) {
      if (lost) notifications.setBridgeLost(true);
      if (connected) {
        notifications.setBridgeLost(false);
        if (!settings.setupSeen()) settings.markSetupSeen();
      }
      render();
      const show = shouldShowSetup({ dismissed: settings.setupSeen(), bridgeConnected: connected, hasSession: state.started || state.starting, chatIsEmpty: provider.chatIsEmpty() });
      if (show) setup.show(); else setup.hide();
    },
    /** The page outlived its extension build. Unlike a bridge outage this never heals: no Close button, only the reload. */
    showStaleExtension() {
      state.staleExtension = true; // latched BEFORE painting, so the bar drops its frozen "Agent active" in the same pass
      render();
      notifications.showStaleExtension();
    },
  };
}
