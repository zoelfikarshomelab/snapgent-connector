// SPDX-License-Identifier: GPL-3.0-or-later
// "Import logins" on the page. A popup cannot do it: the file window takes the popup's focus, the popup closes and its handler goes
// with it, so nothing happens once a file is chosen. The page stays open, so the file window opens here, and the background (which
// holds the saved logins) is asked to take the text of the file.

import { importMessage } from "../domain/accounts/transfer.js";
import { accountHostsOf } from "../sites/registry.js";
import { openAccountsImport } from "../ui/index.js";

/** @param {{ document: Document, site: object|undefined, send: (message: object) => Promise<object> }} deps `site` is the registry entry, undefined where a site keeps no accounts */
export function createAccountImport({ document, site, send }) {
  return {
    /** Open the import window; false when this site keeps no accounts. */
    open() {
      if (!site) return false;
      openAccountsImport({
        document, siteName: site.name,
        onText: async (text) => {
          const reply = await send({ type: "accounts_import", site: site.id, hosts: accountHostsOf(site), text });
          return { ok: !!reply.ok, message: importMessage(reply) };
        },
      });
      return true;
    },
  };
}
