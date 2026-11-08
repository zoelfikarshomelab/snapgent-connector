// SPDX-License-Identifier: GPL-3.0-or-later
// Accounts as a file: what an export holds and what an import takes back. Pure. A file can come from anywhere, so nothing in
// it is trusted: only known cookie fields survive, only cookies of the site's own hosts, only the page-storage keys the site's
// registry entry names, and a name that cannot be an account is left out instead of being guessed at.

import { cookieBelongsTo, cookieWriteSpec, nameProblem } from "./account.js";

export const FORMAT = "snapgent-accounts";
export const VERSION = 1;

// The fields `cookieWriteSpec` reads: a cookie keeps no more than it needs to be written back (never `storeId` or `partitionKey`).
const COOKIE_FIELDS = ["name", "value", "domain", "hostOnly", "path", "secure", "httpOnly", "session", "sameSite", "expirationDate"];

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

export const exportFileName = (site) => `snapgent-accounts-${site}.json`;

/** What the user is told about an import, from the background's answer. */
export const importMessage = (reply) => (reply.ok
  ? `Imported ${reply.imported} login(s)${reply.skipped ? `; ${reply.skipped} could not be used` : ""}.`
  : reply.error || "Could not import that file.");

/** The text of an export file: every account of one site. The id is left out, it is made from the name again on import. */
export function serializeAccounts(site, accounts, now = Date.now()) {
  const list = accounts.map(({ name, savedAt, cookies, storage }) => ({ name, savedAt: savedAt || null, cookies: cookies || [], storage: storage || {} }));
  return JSON.stringify({ format: FORMAT, version: VERSION, site, exportedAt: now, accounts: list }, null, 2);
}

function cleanCookie(cookie, hosts) {
  if (!isObject(cookie) || !cookieWriteSpec(cookie) || !cookieBelongsTo(cookie, hosts)) return null;
  return Object.fromEntries(COOKIE_FIELDS.filter((field) => field in cookie).map((field) => [field, cookie[field]]));
}

const cleanStorage = (storage, keys) => Object.fromEntries(
  Object.entries(isObject(storage) ? storage : {}).filter(([key, value]) => keys.includes(key) && typeof value === "string"),
);

/** One account of a file as the store keeps it, or null when it has no usable name or nothing a login is made of. */
function cleanAccount(item, { hosts, storageKeys }) {
  if (!isObject(item) || typeof item.name !== "string" || nameProblem(item.name)) return null;
  const cookies = (Array.isArray(item.cookies) ? item.cookies : []).map((cookie) => cleanCookie(cookie, hosts)).filter(Boolean);
  const storage = cleanStorage(item.storage, storageKeys);
  if (!cookies.length && !Object.keys(storage).length) return null;
  return { name: item.name, savedAt: Number.isFinite(item.savedAt) ? item.savedAt : undefined, cookies, storage };
}

/**
 * Read an export file.
 * @param {string} text
 * @param {{ site: string, hosts: string[], storageKeys?: string[] }} rules what the site's own login may be made of
 * @returns {{ ok: true, accounts: object[], skipped: number } | { ok: false, error: string }}
 */
export function parseAccounts(text, rules) {
  const { site, hosts, storageKeys = [] } = rules;
  let data;
  try { data = JSON.parse(text); } catch { return { ok: false, error: "That file is not valid JSON." }; }
  if (!isObject(data) || data.format !== FORMAT || !Array.isArray(data.accounts)) return { ok: false, error: "That is not a Snapgent accounts file." };
  if (data.version !== VERSION) return { ok: false, error: "That file was written by another version of Snapgent." };
  if (data.site !== site) return { ok: false, error: `That file holds logins for ${data.site}, not ${site}.` };
  const accounts = data.accounts.map((item) => cleanAccount(item, { hosts, storageKeys })).filter(Boolean);
  if (!accounts.length) return { ok: false, error: "That file holds no login that can be imported." };
  return { ok: true, accounts, skipped: data.accounts.length - accounts.length };
}
