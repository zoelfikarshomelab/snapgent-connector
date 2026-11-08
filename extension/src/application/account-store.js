// SPDX-License-Identifier: GPL-3.0-or-later
// Where the saved logins live: one object in extension storage, kept per site and per account. A login is sensitive, so this
// is never synced, only written to a file when the user asks for an export, and removing an account removes its cookies.
// Reading never rejects: a page can outlive
// its extension (reload, update) and every call then throws.

import { accountId, nameProblem } from "../domain/accounts/account.js";

export const KEY = "zsAccounts";

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

/** One site's entry, in the shape the rest of this module expects. */
function siteEntry(entry) {
  const accounts = isObject(entry) && isObject(entry.accounts) ? entry.accounts : {};
  const active = isObject(entry) && typeof entry.active === "string" ? entry.active : null;
  return { active, accounts };
}

/** One account as it is kept, or null when its name cannot be used. A file may bring its own `savedAt` and `switchedAt` (when the account became the one in use). */
const entryOf = ({ name, cookies, storage, savedAt, switchedAt }) => (nameProblem(name) ? null : {
  id: accountId(name), name: String(name).trim(), savedAt: Number.isFinite(savedAt) ? savedAt : Date.now(), cookies: cookies || [], storage: storage || {},
  ...(Number.isFinite(switchedAt) ? { switchedAt } : {}),
});

/** Saving over an account (the session in use captured again, a file imported) must not erase when it was switched to: the later of the two times stays. */
function keepSwitchedAt(entry, existing) {
  const times = [entry.switchedAt, existing && existing.switchedAt].filter(Number.isFinite);
  return times.length ? { ...entry, switchedAt: Math.max(...times) } : entry;
}

export class AccountStore {
  /** @param {{ store: { get: (key: string) => Promise<*>, set: (key: string, value: *) => Promise<void>|void }, now?: () => number }} deps `now` is the clock that stamps a switch (a test sets its own) */
  constructor({ store, now = Date.now }) {
    this._store = store;
    this._now = now;
  }

  async _all() {
    const saved = await this._store.get(KEY);
    return isObject(saved) ? saved : {};
  }

  async _site(site) {
    return siteEntry((await this._all())[site]);
  }

  async _write(site, entry) {
    const all = await this._all();
    all[site] = entry;
    await this._store.set(KEY, all);
  }

  /** The accounts of one site, the latest first, and which one was last used (as far as Snapgent knows). */
  async list(site) {
    const { active, accounts } = await this._site(site);
    return { active, accounts: Object.values(accounts).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)) };
  }

  async get(site, id) {
    return (await this._site(site)).accounts[id] || null;
  }

  /** Store these cookies under a name; an existing name (same id) is replaced. */
  async save(site, name, cookies, storage = {}) {
    const problem = nameProblem(name);
    if (problem) return { ok: false, error: problem };
    const { ids } = await this.saveAll(site, [{ name, cookies, storage }]);
    return { ok: true, id: ids[0] };
  }

  /** Store several accounts with one write; a name already kept is replaced, one that cannot be used is left out. The account in use stays. */
  async saveAll(site, items) {
    const { active, accounts } = await this._site(site);
    const added = Object.fromEntries(items.map((item) => entryOf(item)).filter(Boolean).map((entry) => [entry.id, keepSwitchedAt(entry, accounts[entry.id])]));
    await this._write(site, { active, accounts: { ...accounts, ...added } });
    return { ok: true, ids: Object.keys(added) };
  }

  /** Forget an account, and with it its cookies. An account in use is no longer marked as such. */
  async remove(site, id) {
    const { active, accounts } = await this._site(site);
    const { [id]: _gone, ...rest } = accounts;
    await this._write(site, { active: active === id ? null : active, accounts: rest });
    return { ok: true };
  }

  async setActive(site, id) {
    const { active, accounts } = await this._site(site);
    const next = id && accounts[id] ? id : null;
    // Only a CHANGE of account is a switch: writing the account in use back (a reload) keeps the time it was switched to.
    const changed = !!next && next !== active;
    const stamped = changed ? { ...accounts, [next]: { ...accounts[next], switchedAt: this._now() } } : accounts;
    await this._write(site, { active: next, accounts: stamped });
    return { ok: true, active: next };
  }
}
