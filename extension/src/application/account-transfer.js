// SPDX-License-Identifier: GPL-3.0-or-later
// Saved logins to and from a file, for one site. Orchestration only: what a file may hold is decided in domain/accounts/transfer.js
// and where the accounts live is the store's business. An import adds to what is saved and never switches the login in use.

import { parseAccounts, serializeAccounts } from "../domain/accounts/transfer.js";

export class AccountTransfer {
  /**
   * @param {{ store: import("./account-store.js").AccountStore,
   *           hosts: string[],           the site's cookie hosts: a cookie of any other host in a file is dropped
   *           storageKeys?: string[] }} deps  the page-storage keys the site's login also lives in
   */
  constructor({ store, hosts, storageKeys = [] }) {
    Object.assign(this, { _store: store, _hosts: hosts, _keys: storageKeys });
  }

  /** The text of a file holding every login saved for `site`. */
  async exportText(site) {
    const { accounts } = await this._store.list(site);
    if (!accounts.length) return { ok: false, error: "No login is saved yet." };
    return { ok: true, text: serializeAccounts(site, accounts), count: accounts.length };
  }

  /** Add the logins of a file; a name already saved is replaced. A file that is refused changes nothing. */
  async importText(site, text) {
    const parsed = parseAccounts(text, { site, hosts: this._hosts, storageKeys: this._keys });
    if (!parsed.ok) return parsed;
    const { ids } = await this._store.saveAll(site, parsed.accounts);
    return { ok: true, imported: ids.length, skipped: parsed.skipped };
  }
}
