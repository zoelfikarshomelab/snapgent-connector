// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { FORMAT, VERSION, exportFileName, parseAccounts, serializeAccounts } from "../src/domain/accounts/transfer.js";
import { AccountStore } from "../src/application/account-store.js";
import { AccountTransfer } from "../src/application/account-transfer.js";
import { accountHostsOf, accountStorageOf, siteFor } from "../src/sites/registry.js";
import { chooseTextFiles, downloadText } from "../src/ui/file-transfer.js";

const claude = siteFor("claude.ai");
const deepseek = siteFor("chat.deepseek.com");
const rulesOf = (id, site) => ({ site: id, hosts: accountHostsOf(site), storageKeys: accountStorageOf(site) });
const rules = rulesOf("claude", claude);
const cookie = { name: "sessionKey", value: "sk-a", domain: "claude.ai", hostOnly: true, path: "/", secure: true, httpOnly: true, session: true, sameSite: "lax", storeId: "0" };

const memoryStore = () => { const data = {}; return { data, get: async (key) => data[key], set: async (key, value) => { data[key] = value; } }; };
const transferOf = (store, { hosts, storageKeys } = rules) => new AccountTransfer({ store, hosts, storageKeys });
const fileOf = (extra = {}, accounts = [{ name: "Work", savedAt: 5, cookies: [cookie], storage: {} }]) => JSON.stringify({ format: FORMAT, version: VERSION, site: "claude", accounts, ...extra });

describe("accounts as a file: what is written and what is taken back", () => {
  test("an export names its site and every account, and the same text imports again", () => {
    const text = serializeAccounts("claude", [{ id: "work", name: "Work", savedAt: 5, cookies: [cookie], storage: {} }], 99);
    const doc = JSON.parse(text);
    assert.deepEqual([doc.format, doc.version, doc.site, doc.exportedAt], [FORMAT, VERSION, "claude", 99]);
    assert.equal("id" in doc.accounts[0], false, "an id is made from the name again on import");
    const back = parseAccounts(text, rules);
    assert.deepEqual([back.ok, back.skipped], [true, 0]);
    assert.deepEqual(back.accounts.map((a) => [a.name, a.savedAt, a.cookies[0].value]), [["Work", 5, "sk-a"]]);
    assert.equal(exportFileName("deepseek"), "snapgent-accounts-deepseek.json");
  });

  test("a file that is not an accounts file for this site is refused with a reason", () => {
    const refused = (text) => parseAccounts(text, rules);
    assert.match(refused("{nope").error, /not valid JSON/);
    assert.match(refused(JSON.stringify({ hello: 1 })).error, /not a Snapgent accounts file/);
    assert.match(refused("null").error, /not a Snapgent accounts file/);
    assert.match(refused(fileOf({ site: "deepseek" })).error, /deepseek, not claude/);
    assert.match(refused(fileOf({ version: 2 })).error, /another version/);
    assert.match(refused(fileOf({}, [])).error, /no login/);
  });

  test("only what a login is made of comes back: known fields, the site's own cookies and usable names", () => {
    const text = fileOf({}, [
      { name: "Work", cookies: [cookie, { ...cookie, name: "evil", domain: "example.com" }, { name: "", value: "x", domain: "claude.ai" }, "junk"], storage: { userToken: "t" }, extra: 1 },
      { name: "   ", cookies: [cookie] },
      { name: 5, cookies: [cookie] },
      { name: "Empty", cookies: [] },
    ]);
    const result = parseAccounts(text, rules);
    assert.deepEqual(result.accounts.map((a) => a.name), ["Work"]);
    assert.equal(result.skipped, 3);
    const [work] = result.accounts;
    assert.deepEqual(work.cookies.map((c) => c.name), ["sessionKey"], "a cookie of another host, or one that cannot be written, is dropped");
    assert.equal("storeId" in work.cookies[0], false);
    assert.deepEqual(work.storage, {}, "Claude names no page-storage key, so none is taken");
    assert.equal("extra" in work, false);
  });

  test("a DeepSeek login that lives only in page storage travels through a file, and only its allowed key", () => {
    const deepRules = rulesOf("deepseek", deepseek);
    const text = serializeAccounts("deepseek", [{ name: "Work", savedAt: 1, cookies: [], storage: { userToken: "tok", secret: "s", other: 5 } }]);
    const result = parseAccounts(text, deepRules);
    assert.equal(result.ok, true);
    assert.deepEqual(result.accounts[0].storage, { userToken: "tok" });
  });
});

describe("accounts as a file: the store and the transfer", () => {
  test("saveAll writes once, replaces a name already kept and leaves the account in use alone", async () => {
    const memory = memoryStore();
    let writes = 0;
    const store = new AccountStore({ store: { get: memory.get, set: async (key, value) => { writes += 1; await memory.set(key, value); } } });
    await store.save("claude", "Work", [cookie]);
    await store.setActive("claude", "work");
    writes = 0;
    const result = await store.saveAll("claude", [{ name: "Work", cookies: [{ ...cookie, value: "new" }] }, { name: "Home", cookies: [cookie], savedAt: 7 }, { name: " ", cookies: [] }]);
    assert.deepEqual([result.ids, writes], [["work", "home"], 1]);
    const { active, accounts } = await store.list("claude");
    assert.equal(active, "work");
    assert.equal(accounts.find((a) => a.id === "work").cookies[0].value, "new");
    assert.equal(accounts.find((a) => a.id === "home").savedAt, 7);
  });

  test("exporting nothing says so, and an export imports into another store without switching the login in use", async () => {
    const source = new AccountStore({ store: memoryStore() });
    assert.match((await transferOf(source).exportText("claude")).error, /No login is saved/);
    await source.save("claude", "Work", [cookie]);
    await source.save("claude", "Home", [{ ...cookie, value: "sk-h" }]);
    const exported = await transferOf(source).exportText("claude");
    assert.deepEqual([exported.ok, exported.count], [true, 2]);

    const target = new AccountStore({ store: memoryStore() });
    const imported = await transferOf(target).importText("claude", exported.text);
    assert.deepEqual([imported.ok, imported.imported, imported.skipped], [true, 2, 0]);
    const { active, accounts } = await target.list("claude");
    assert.deepEqual(accounts.map((a) => [a.id, a.cookies[0].value]).sort(), [["home", "sk-h"], ["work", "sk-a"]]);
    assert.equal(active, null);
  });

  test("a refused file stores nothing", async () => {
    const target = new AccountStore({ store: memoryStore() });
    const result = await transferOf(target).importText("claude", "{nope");
    assert.equal(result.ok, false);
    assert.deepEqual((await target.list("claude")).accounts, []);
  });
});

describe("file transfer helpers", () => {
  test("a text is offered as a download of that name and the link is removed again", () => {
    const events = [];
    const link = { click: () => events.push("click"), remove: () => events.push("remove") };
    const document = { createElement: (tag) => { events.push(tag); return link; }, documentElement: { appendChild: (el) => events.push(el === link ? "append" : "other") } };
    downloadText(document, "{}", "x.json");
    assert.deepEqual(events, ["a", "append", "click", "remove"]);
    assert.equal(link.download, "x.json");
    assert.match(link.href, /^blob:/);
  });

  test("the texts of the chosen files are handed over, and a cancelled window hands over nothing", async () => {
    let change;
    const input = { addEventListener: (_type, fn) => { change = fn; }, click() {} };
    const got = [];
    chooseTextFiles({ createElement: () => input }, { multiple: true }, (texts) => got.push(texts));
    assert.deepEqual([input.type, input.multiple], ["file", true]);
    assert.match(input.accept, /json/);
    input.files = [];
    await change();
    assert.deepEqual(got, []);
    input.files = [{ text: async () => "a" }, { text: async () => "b" }];
    await change();
    assert.deepEqual(got, [["a", "b"]]);
  });
});
