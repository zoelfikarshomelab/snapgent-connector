// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { switchedLabel } from "../src/domain/accounts/account.js";
import { parseAccounts, serializeAccounts } from "../src/domain/accounts/transfer.js";
import { AccountStore } from "../src/application/account-store.js";
import { AccountSwitcher } from "../src/application/account-switcher.js";

const HOSTS = ["claude.ai"];
const cookie = (value) => ({ name: "sessionKey", value, domain: "claude.ai", hostOnly: true, path: "/", secure: true, session: true });
const memoryStore = () => { const data = {}; return { get: async (key) => data[key], set: async (key, value) => { data[key] = value; } }; };

function cookieJar(initial) {
  const jar = initial.map((item) => ({ ...item }));
  return {
    jar,
    getAll: async ({ domain }) => jar.filter((item) => item.domain === domain || item.domain.endsWith(`.${domain}`)),
    remove: async ({ name }) => { const at = jar.findIndex((item) => item.name === name); if (at >= 0) jar.splice(at, 1); },
    set: async (spec) => { jar.push({ name: spec.name, value: spec.value, domain: spec.domain || new URL(spec.url).hostname, path: spec.path }); },
  };
}

describe("account switch time: the label", () => {
  // Built from local parts, so the expected text does not depend on the machine's time zone.
  const at = (day, hour, minute) => new Date(2026, 10, day, hour, minute).getTime();
  const now = at(8, 16, 32);

  test("today, yesterday and an older day are named, with the clock time and how long ago", () => {
    assert.equal(switchedLabel(at(8, 14, 32), now), "switched today 14:32 · 2h ago");
    assert.equal(switchedLabel(at(7, 23, 5), now), "switched yesterday 23:05 · 17h ago");
    assert.equal(switchedLabel(at(3, 9, 0), now), "switched 3 Nov 09:00");
  });

  test("a few minutes ago, a time that was never set and a clock that is a little ahead are all handled", () => {
    assert.match(switchedLabel(now - 5 * 60000, now), /· 5m ago$/);
    assert.match(switchedLabel(now + 30000, now), /· just now$/);
    assert.equal(switchedLabel(undefined, now), "");
    assert.equal(switchedLabel(Number.NaN, now), "");
  });
});

describe("account switch time: where it is kept", () => {
  test("becoming the account in use stamps it, and writing the same one back (a reload) does not", async () => {
    let now = 1000;
    const store = new AccountStore({ store: memoryStore(), now: () => now });
    await store.save("claude", "Work", [cookie("a")]);
    assert.equal((await store.get("claude", "work")).switchedAt, undefined, "saving alone is not a switch");
    await store.setActive("claude", "work");
    assert.equal((await store.get("claude", "work")).switchedAt, 1000);
    now = 5000;
    await store.setActive("claude", "work");
    assert.equal((await store.get("claude", "work")).switchedAt, 1000, "a reload is not a switch");
    await store.setActive("claude", null);
    await store.setActive("claude", "work");
    assert.equal((await store.get("claude", "work")).switchedAt, 5000, "signed out and back in is a new switch");
  });

  test("switching stamps the account switched to and leaves the one switched away from with its own time", async () => {
    let now = 1000;
    const store = new AccountStore({ store: memoryStore(), now: () => now });
    const jar = cookieJar([cookie("a")]);
    const switcher = new AccountSwitcher({ store, cookies: jar, hosts: HOSTS });
    await switcher.capture("claude", "Work");
    jar.jar.length = 0;
    jar.jar.push(cookie("b"));
    now = 2000;
    await switcher.capture("claude", "Home");
    now = 3000;
    assert.equal((await switcher.activate("claude", "work")).ok, true);
    const stamps = Object.fromEntries((await store.list("claude")).accounts.map((account) => [account.id, account.switchedAt]));
    assert.deepEqual(stamps, { work: 3000, home: 2000 }, "saving Home on the way out must not erase when it was switched to");
  });

  test("an export carries the time, an import keeps the later of the two, and a file from before this existed still imports", async () => {
    const text = serializeAccounts("claude", [{ name: "Work", savedAt: 5, switchedAt: 7000, cookies: [cookie("a")], storage: {} }]);
    assert.equal(JSON.parse(text).accounts[0].switchedAt, 7000);
    const parsed = parseAccounts(text, { site: "claude", hosts: HOSTS });
    assert.equal(parsed.accounts[0].switchedAt, 7000);

    const earlier = new AccountStore({ store: memoryStore(), now: () => 1000 });
    await earlier.save("claude", "Work", [cookie("old")]);
    await earlier.setActive("claude", "work");
    await earlier.saveAll("claude", parsed.accounts);
    assert.equal((await earlier.get("claude", "work")).switchedAt, 7000, "the file's later time wins");

    const later = new AccountStore({ store: memoryStore(), now: () => 9000 });
    await later.save("claude", "Work", [cookie("old")]);
    await later.setActive("claude", "work");
    await later.saveAll("claude", parsed.accounts);
    assert.equal((await later.get("claude", "work")).switchedAt, 9000, "this browser's later time stays");

    const legacy = JSON.stringify({ format: "snapgent-accounts", version: 1, site: "claude", accounts: [{ name: "Home", savedAt: 5, cookies: [cookie("h")], storage: {} }] });
    const old = parseAccounts(legacy, { site: "claude", hosts: HOSTS });
    assert.equal(old.ok, true);
    assert.equal(old.accounts[0].switchedAt, undefined);
  });
});
