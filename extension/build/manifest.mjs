// SPDX-License-Identifier: GPL-3.0-or-later
// Pure manifest generation: base.json + the site registry + per-browser deltas.
import { SITES, allMatches } from "../src/sites/registry.js";

// Reading and writing a site's cookies is what makes switching logins possible: only asked for when a site offers accounts.
const needsCookies = (sites) => (sites.some((site) => site.accounts) ? ["cookies"] : []);

export const TARGETS = ["chrome", "firefox"];
const GECKO_ID = "snapgent@zoelfikars.github.io";
// Firefox 140 (Android 142) is the first release that knows `data_collection_permissions`, which addons.mozilla.org asks for.
const FIREFOX_MIN_VERSION = "140.0";
const FIREFOX_ANDROID_MIN_VERSION = "142.0";

// One content script for every site: it is calibrated from a stored profile or says "not calibrated" (docs/CALIBRATION.md).
export function contentScripts(sites = SITES) {
  return sites.map((site) => ({
    matches: site.matches,
    js: ["content.js"],
    css: ["overlay.css"],
    run_at: "document_idle",
  }));
}

export function hostPermissions(sites = SITES) {
  const extra = sites.flatMap((site) => site.extraHosts || []);
  // A login may live on host names beyond the ones a content script runs on (Claude's session also touches anthropic.com):
  // without permission for them the cookies cannot be read or written, and a switch would silently do nothing.
  const accountHosts = sites.flatMap((site) => (site.accountHosts || []).map((host) => `https://*.${host}/*`));
  return [...new Set([...allMatches(), ...extra, ...accountHosts, "http://127.0.0.1/*", "ws://127.0.0.1/*"])];
}

export function buildManifest(base, { target, version }) {
  if (!TARGETS.includes(target)) throw new Error(`Unknown target "${target}"`);
  const manifest = {
    ...base,
    permissions: [...new Set([...(base.permissions || []), ...needsCookies(SITES)])],
    version,
    host_permissions: hostPermissions(),
    content_scripts: contentScripts(),
  };
  if (target === "firefox") {
    // Firefox MV3 has no service workers; it runs the background as an event page.
    manifest.background = { scripts: ["background.js"] };
    // The extension only talks to the bridge on 127.0.0.1 and collects nothing, hence "none".
    manifest.browser_specific_settings = {
      gecko: { id: GECKO_ID, strict_min_version: FIREFOX_MIN_VERSION, data_collection_permissions: { required: ["none"] } },
      gecko_android: { strict_min_version: FIREFOX_ANDROID_MIN_VERSION },
    };
  } else {
    manifest.background = { service_worker: "background.js" };
  }
  return manifest;
}
