// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { pageWith } from "./support/jsdom-provider.js";
import { openAccountsImport } from "../src/ui/accounts-import.js";
import { createAccountImport } from "../src/page/account-import.js";
import { siteFor } from "../src/sites/registry.js";

const PAGE = "<!doctype html><body></body>";

/** Press "Choose file…" and answer the file window with a file holding `text`, the way a browser would. */
async function chooseFile({ window, document }, text) {
  const make = document.createElement.bind(document);
  let input;
  document.createElement = (tag) => { const el = make(tag); if (tag === "input") input = el; return el; };
  document.querySelector(".zs-acc-import-pick").click();
  Object.defineProperty(input, "files", { value: [{ text: async () => text }] });
  input.dispatchEvent(new window.Event("change"));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("importing logins on the page", () => {
  test("the window stays open, hands the chosen file's text over and shows the answer", async () => {
    const page = pageWith(PAGE);
    const got = [];
    openAccountsImport({ document: page.document, siteName: "Claude", onText: async (text) => { got.push(text); return { ok: true, message: "Imported 1 login(s)." }; } });
    await chooseFile(page, "file text");
    assert.deepEqual(got, ["file text"]);
    assert.equal(page.document.querySelector(".zs-acc-import-result").textContent, "Imported 1 login(s).");
    assert.ok(page.document.getElementById("zs-mcp-pop"), "the window is still there to be read");
  });

  test("the background is asked with the site's own id and hosts, and its answer is worded for the user", async () => {
    const page = pageWith(PAGE);
    const sent = [];
    const send = async (message) => { sent.push(message); return { ok: true, imported: 2, skipped: 1 }; };
    assert.equal(createAccountImport({ document: page.document, site: siteFor("claude.ai"), send }).open(), true);
    await chooseFile(page, "{}");
    assert.deepEqual(sent, [{ type: "accounts_import", site: "claude", hosts: ["claude.ai", "anthropic.com"], text: "{}" }]);
    assert.equal(page.document.querySelector(".zs-acc-import-result").textContent, "Imported 2 login(s); 1 could not be used.");
  });

  test("a refused file says why, and a site without accounts opens nothing", async () => {
    const page = pageWith(PAGE);
    createAccountImport({ document: page.document, site: siteFor("claude.ai"), send: async () => ({ ok: false, error: "That is not a Snapgent accounts file." }) }).open();
    await chooseFile(page, "x");
    assert.equal(page.document.querySelector(".zs-acc-import-result").textContent, "That is not a Snapgent accounts file.");
    const other = pageWith(PAGE);
    assert.equal(createAccountImport({ document: other.document, site: siteFor("chatgpt.com") && undefined, send: async () => ({}) }).open(), false);
    assert.equal(other.document.getElementById("zs-mcp-pop"), null);
  });
});
