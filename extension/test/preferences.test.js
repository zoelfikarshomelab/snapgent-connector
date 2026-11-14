import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { DEFAULT_CONTEXT_FILES, clampContextFiles } from "../src/domain/prompt/context-file.js";
import { DEFAULT_EXCLUDED_FOLDERS, clampExcludedFolders, parseFolderNames } from "../src/domain/prompt/excluded-folders.js";
import { DEFAULT_TEMPLATES, TEMPLATE_NAMES } from "../src/domain/prompt/templates.js";
import { BLOCK_SPEC } from "../src/domain/tools/call-format.js";
import { MAX_DELAY_SECONDS } from "../src/domain/tools/delay.js";
import { createPreferences, KEYS } from "../src/page/preferences.js";
import { openPreferences } from "../src/ui/preferences-popup.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));

function fakeStorage(initial = {}) {
  const data = { ...initial };
  const watchers = {};
  return {
    data,
    get: async (key) => data[key],
    set(key, value) { data[key] = value; (watchers[key] || []).forEach((fn) => fn(value)); },
    remove(key) { delete data[key]; },
    watch(key, fn) { (watchers[key] = watchers[key] || []).push(fn); },
  };
}

describe("excluded folders", () => {
  test("a typed list becomes clean names: one per line or comma, no slashes, no empties, no repeats", () => {
    assert.deepEqual(parseFolderNames("node_modules\n./target/, dist/ ,\n\nnode_modules\n/build"), ["node_modules", "target", "dist", "build"]);
    assert.deepEqual(parseFolderNames("   "), []);
  });

  test("nothing saved means the defaults; an empty saved list is respected", () => {
    assert.deepEqual(clampExcludedFolders(undefined), DEFAULT_EXCLUDED_FOLDERS);
    assert.deepEqual(clampExcludedFolders("junk"), DEFAULT_EXCLUDED_FOLDERS);
    assert.deepEqual(clampExcludedFolders([]), []);
    assert.deepEqual(clampExcludedFolders(["a", 7, "a/", "b"]), ["a", "b"]);
  });

  test("the defaults skip the usual suspects", () => {
    for (const name of ["node_modules", "target", ".rustup", ".git"]) assert.ok(DEFAULT_EXCLUDED_FOLDERS.includes(name), name);
  });
});

describe("project instruction files", () => {
  test("a typed list becomes clean names: no ./ or slashes around, no empties, no repeats, at most 20; nothing usable means the defaults", () => {
    assert.deepEqual(clampContextFiles(["./AGENTS.md", "AGENTS.md/", "", "CLAUDE.md", "AGENTS.md"]), ["AGENTS.md", "CLAUDE.md"]);
    assert.deepEqual(clampContextFiles(undefined), DEFAULT_CONTEXT_FILES);
    assert.deepEqual(clampContextFiles("junk"), DEFAULT_CONTEXT_FILES);
  });
});

describe("preferences", () => {
  test("start as the defaults, are saved in storage, and a change of the folders marks the file list as out of date", async () => {
    const storage = fakeStorage();
    const state = { filesChangedAt: 0 };
    const preferences = createPreferences({ storage, state });
    await flush();
    assert.deepEqual(preferences.excludedFolders(), DEFAULT_EXCLUDED_FOLDERS);
    preferences.setFolders(["tmp", "tmp/", "cache"]);
    assert.deepEqual(storage.data[KEYS.folders], ["tmp", "cache"]);
    assert.deepEqual(preferences.excludedFolders(), ["tmp", "cache"]);
    assert.ok(state.filesChangedAt > 0);
    preferences.setChars(5);
    preferences.setCalls(500);
    assert.equal(storage.data[KEYS.chars], 10000, "kept within the slider");
    assert.equal(storage.data[KEYS.calls], 30);
  });

  test("a change made elsewhere (another tab) is picked up", async () => {
    const storage = fakeStorage();
    const state = { filesChangedAt: 0 };
    const preferences = createPreferences({ storage, state });
    storage.set(KEYS.folders, ["only-this"]);
    assert.deepEqual(preferences.excludedFolders(), ["only-this"]);
    assert.ok(state.filesChangedAt > 0);
  });

  test("project instruction files: the defaults until changed, then saved as a clean list", async () => {
    const storage = fakeStorage();
    const preferences = createPreferences({ storage, state: {} });
    await flush();
    assert.deepEqual(preferences.contextFiles(), DEFAULT_CONTEXT_FILES);
    preferences.setContextFiles(["./AGENTS.md", "AGENTS.md", "CLAUDE.md", "  ", "docs/GEMINI.md"]);
    assert.deepEqual(storage.data[KEYS.contextFiles], ["AGENTS.md", "CLAUDE.md", "docs/GEMINI.md"]);
  });

  test("read() gives what the panel shows", async () => {
    const preferences = createPreferences({ storage: fakeStorage({ [KEYS.chars]: 150000, [KEYS.calls]: 12 }), state: {} });
    const read = await preferences.read();
    assert.deepEqual({ ...read, templates: undefined }, { chars: 150000, calls: 12, asFile: false, folders: DEFAULT_EXCLUDED_FOLDERS, contextFiles: DEFAULT_CONTEXT_FILES, startContext: true, startTree: true, templates: undefined, delay: 0, randomDelay: 0 });
    assert.deepEqual(read.templates, DEFAULT_TEMPLATES, "the wording of the messages starts at the defaults");
  });

  test("the pauses: none until they are asked for, then saved, kept within what the panel allows, and read back", async () => {
    const storage = fakeStorage();
    const preferences = createPreferences({ storage, state: {} });
    await flush();
    assert.equal(preferences.delay(), 0);
    assert.equal(preferences.randomDelay(), 0);
    preferences.setDelay(7);
    preferences.setRandomDelay(30);
    assert.equal(storage.data[KEYS.delay], 7);
    assert.equal(storage.data[KEYS.randomDelay], 30);
    assert.equal(preferences.delay(), 7);
    assert.equal(preferences.randomDelay(), 30);
    const read = await preferences.read();
    assert.deepEqual([read.delay, read.randomDelay], [7, 30]);
    // A value the panel does not allow is brought back into it.
    preferences.setDelay(99999);
    assert.equal(preferences.delay(), MAX_DELAY_SECONDS);
    preferences.setDelay("nonsense");
    assert.equal(preferences.delay(), 0, "nothing usable means no pause");
    preferences.setRandomDelay(-5);
    assert.equal(preferences.randomDelay(), 0);
  });

  test("a pause changed in another tab is picked up", async () => {
    const storage = fakeStorage();
    const preferences = createPreferences({ storage, state: {} });
    storage.set(KEYS.delay, 12);
    assert.equal(preferences.delay(), 12);
    storage.set(KEYS.randomDelay, 4);
    assert.equal(preferences.randomDelay(), 4);
  });

  test("the templates are saved as the user writes them, and read back", async () => {
    const storage = fakeStorage();
    const preferences = createPreferences({ storage, state: {} });
    await flush();
    assert.deepEqual(preferences.templates(), DEFAULT_TEMPLATES);
    preferences.setTemplates({ ...DEFAULT_TEMPLATES, result: "mine" });
    assert.equal(storage.data[KEYS.templates].result, "mine");
    assert.equal(preferences.templates().result, "mine");
    assert.equal(preferences.templates().reminder, DEFAULT_TEMPLATES.reminder, "the ones the user did not touch stay as they were");
  });

  test("output as file: off until switched on, saved as true or false, and read back", async () => {
    const storage = fakeStorage();
    const preferences = createPreferences({ storage, state: {} });
    await flush();
    assert.equal(preferences.asFile(), false);
    preferences.setAsFile(true);
    assert.equal(storage.data[KEYS.asFile], true);
    assert.equal((await preferences.read()).asFile, true);
    preferences.setAsFile("yes");
    assert.equal(storage.data[KEYS.asFile], false, "only true counts");
  });
});

describe("what the start message carries", () => {
  test("the tree and the instruction files are on until switched off, saved as true or false, read back, and a change from another tab is picked up", async () => {
    const storage = fakeStorage();
    const preferences = createPreferences({ storage, state: {} });
    await flush();
    assert.equal(preferences.startTree(), true);
    assert.equal(preferences.startContext(), true);
    preferences.setStartTree(false);
    preferences.setStartContext(false);
    assert.equal(storage.data[KEYS.startTree], false);
    assert.equal(storage.data[KEYS.startContext], false);
    const read = await preferences.read();
    assert.deepEqual([read.startContext, read.startTree], [false, false]);
    storage.set(KEYS.startTree, true);
    assert.equal(preferences.startTree(), true);
    preferences.setStartTree("yes");
    assert.equal(storage.data[KEYS.startTree], false, "only true counts");
  });
});

describe("preferences panel", () => {
  function open() {
    const w = new JSDOM("<!doctype html><body></body>").window;
    const saved = [];
    openPreferences({
      document: w.document, values: { chars: 100000, calls: 8, folders: ["node_modules", "target"] }, defaults: { folders: ["node_modules", "target", "dist"] },
      save: { chars: (v) => saved.push(["chars", v]), calls: (v) => saved.push(["calls", v]), folders: (v) => saved.push(["folders", v]) },
    });
    const fire = (el, type) => el.dispatchEvent(new w.Event(type, { bubbles: true }));
    return { w, saved, fire, $: (selector) => w.document.querySelector(selector) };
  }

  test("shows the current values, and each change is saved as it is made", () => {
    const { $, saved, fire } = open();
    assert.equal($("#zs-pref-chars").value, "100000");
    assert.match($("#zs-pref-chars-value").textContent, /100k chars/);
    assert.equal($("#zs-pref-calls-value").textContent, "8 commands");
    assert.equal($("#zs-pref-folders").value, "node_modules\ntarget");

    $("#zs-pref-calls").value = "1"; fire($("#zs-pref-calls"), "input"); fire($("#zs-pref-calls"), "change");
    assert.equal($("#zs-pref-calls-value").textContent, "1 command");
    $("#zs-pref-folders").value = "node_modules, .rustup\n\nbuild/"; fire($("#zs-pref-folders"), "change");
    assert.deepEqual(saved, [["calls", 1], ["folders", ["node_modules", ".rustup", "build"]]]);
  });

  test("restoring the defaults fills the box and saves them", () => {
    const { $, saved } = open();
    $("#zs-pref-reset").click();
    assert.equal($("#zs-pref-folders").value, "node_modules\ntarget\ndist");
    assert.deepEqual(saved, [["folders", ["node_modules", "target", "dist"]]]);
  });

  test("typing in the box does not reach the site's keyboard shortcuts", () => {
    const { w, $ } = open();
    let reached = false;
    w.document.addEventListener("keydown", () => { reached = true; });
    $("#zs-pref-folders").dispatchEvent(new w.KeyboardEvent("keydown", { key: "a", bubbles: true }));
    assert.equal(reached, false);
  });

  test("project instruction files: shown, saved as a clean list, and reset with the defaults", () => {
    const w = new JSDOM("<!doctype html><body></body>").window;
    const saved = [];
    openPreferences({
      document: w.document, values: { chars: 100000, calls: 8, folders: [], contextFiles: ["AGENTS.md"] },
      defaults: { folders: [], contextFiles: ["AGENTS.md", "CLAUDE.md", "GEMINI.md"] },
      save: { chars() {}, calls() {}, folders() {}, contextFiles: (list) => saved.push(list) },
    });
    const $ = (selector) => w.document.querySelector(selector);
    assert.equal($("#zs-pref-context").value, "AGENTS.md");
    $("#zs-pref-context").value = " AGENTS.md \n\nCLAUDE.md";
    $("#zs-pref-context").dispatchEvent(new w.Event("change", { bubbles: true }));
    assert.deepEqual(saved, [["AGENTS.md", "CLAUDE.md"]]);
    $("#zs-pref-reset").click();
    assert.equal($("#zs-pref-context").value, "AGENTS.md\nCLAUDE.md\nGEMINI.md");
    assert.deepEqual(saved, [["AGENTS.md", "CLAUDE.md"], ["AGENTS.md", "CLAUDE.md", "GEMINI.md"]]);
  });

  test("the start message checkboxes are on by default, saved when changed, and ticked again by the defaults", () => {
    const w = new JSDOM("<!doctype html><body></body>").window;
    const saved = [];
    openPreferences({
      document: w.document, values: { chars: 100000, calls: 8, folders: [] }, defaults: { folders: [] },
      save: { chars() {}, calls() {}, folders() {}, startContext: (v) => saved.push(["context", v]), startTree: (v) => saved.push(["tree", v]) },
    });
    const $ = (selector) => w.document.querySelector(selector);
    assert.equal($("#zs-pref-start-tree").checked, true);
    assert.equal($("#zs-pref-start-context").checked, true);
    $("#zs-pref-start-tree").checked = false;
    $("#zs-pref-start-tree").dispatchEvent(new w.Event("change", { bubbles: true }));
    assert.deepEqual(saved, [["tree", false]]);
    $("#zs-pref-reset").click();
    assert.equal($("#zs-pref-start-tree").checked, true);
    assert.deepEqual(saved.slice(1), [["context", true], ["tree", true]]);
  });

  test("a start message part saved as off is shown unticked", () => {
    const w = new JSDOM("<!doctype html><body></body>").window;
    openPreferences({
      document: w.document, values: { chars: 100000, calls: 8, folders: [], startContext: false, startTree: false }, defaults: { folders: [] },
      save: { chars() {}, calls() {}, folders() {} },
    });
    assert.equal(w.document.querySelector("#zs-pref-start-tree").checked, false);
    assert.equal(w.document.querySelector("#zs-pref-start-context").checked, false);
  });

  test("the reminder test is offered and writes the reminder through its action", () => {
    const w = new JSDOM("<!doctype html><body></body>").window;
    const called = [];
    openPreferences({
      document: w.document, values: { chars: 100000, calls: 8, folders: [] }, defaults: { folders: [] },
      save: { chars() {}, calls() {}, folders() {} }, actions: { onFillReminder: () => called.push("reminder") },
    });
    assert.match(w.document.querySelector(".zs-pref-card").textContent, /the real reminder/);
    w.document.querySelector("#zs-pref-reminder-fill").click();
    assert.deepEqual(called, ["reminder"]);
  });

  test("every template has a field, and its button writes an example through its action", () => {
    const w = new JSDOM("<!doctype html><body></body>").window;
    const called = [];
    openPreferences({
      document: w.document, values: { chars: 100000, calls: 8, folders: [], templates: DEFAULT_TEMPLATES }, defaults: { folders: [] },
      save: { chars() {}, calls() {}, folders() {} }, actions: { onFillTemplate: (name) => called.push(name) },
    });
    const $ = (selector) => w.document.querySelector(selector);
    const buttons = TEMPLATE_NAMES.map((name) => {
      assert.ok($(`#zs-pref-tpl-${name}`), `the field of ${name}`);
      assert.equal($(`#zs-pref-tpl-${name}`).value, DEFAULT_TEMPLATES[name]);
      return $(`#zs-pref-tpl-${name}-fill`);
    });
    // The first click closes the popup, so the buttons are taken before it.
    for (const button of buttons) button.click();
    assert.deepEqual(called, TEMPLATE_NAMES);
  });

  test("a template the user writes is saved as it is, and the defaults come back with the reset", () => {
    const w = new JSDOM("<!doctype html><body></body>").window;
    const saved = [];
    openPreferences({
      document: w.document, values: { chars: 100000, calls: 8, folders: [], templates: DEFAULT_TEMPLATES }, defaults: { folders: [] },
      save: { chars() {}, calls() {}, folders() {}, templates: (all) => saved.push(all) },
    });
    const $ = (selector) => w.document.querySelector(selector);
    const box = $("#zs-pref-tpl-result");
    box.value = "mine";
    box.dispatchEvent(new w.Event("change", { bubbles: true }));
    assert.equal(saved[0].result, "mine");
    $("#zs-pref-reset").click();
    assert.equal($("#zs-pref-tpl-result").value, DEFAULT_TEMPLATES.result);
    assert.equal(saved[saved.length - 1].result, DEFAULT_TEMPLATES.result);
  });

  test("the pauses have a number field each, are saved as they are changed, and go back to none with the defaults", () => {
    const w = new JSDOM("<!doctype html><body></body>").window;
    const saved = [];
    openPreferences({
      document: w.document, values: { chars: 100000, calls: 8, folders: [], delay: 5, randomDelay: 20 },
      defaults: { folders: [] },
      save: { chars() {}, calls() {}, folders() {}, delay: (v) => saved.push(["delay", v]), randomDelay: (v) => saved.push(["random", v]) },
    });
    const $ = (selector) => w.document.querySelector(selector);
    assert.equal($("#zs-pref-delay").type, "number", "a number field, not a slider");
    assert.equal($("#zs-pref-delay").value, "5");
    assert.equal($("#zs-pref-random-delay").value, "20");
    $("#zs-pref-delay").value = "9";
    $("#zs-pref-delay").dispatchEvent(new w.Event("change", { bubbles: true }));
    assert.deepEqual(saved, [["delay", 9]]);
    // A value the panel does not allow is brought back into it, in the field as well.
    $("#zs-pref-random-delay").value = "99999";
    $("#zs-pref-random-delay").dispatchEvent(new w.Event("change", { bubbles: true }));
    assert.equal($("#zs-pref-random-delay").value, String(MAX_DELAY_SECONDS));
    assert.deepEqual(saved[1], ["random", MAX_DELAY_SECONDS]);
    $("#zs-pref-reset").click();
    assert.equal($("#zs-pref-delay").value, "0");
    assert.equal($("#zs-pref-random-delay").value, "0");
    assert.deepEqual(saved.slice(2), [["delay", 0], ["random", 0]]);
  });

  test("the command format is a template of its own, with the two shapes ready to put in it", () => {
    const w = new JSDOM("<!doctype html><body></body>").window;
    const saved = [];
    openPreferences({
      document: w.document, values: { chars: 100000, calls: 8, folders: [], templates: DEFAULT_TEMPLATES }, defaults: { folders: [] },
      save: { chars() {}, calls() {}, folders() {}, templates: (all) => saved.push(all) },
    });
    const $ = (selector) => w.document.querySelector(selector);
    assert.equal($("#zs-pref-tpl-format").value, DEFAULT_TEMPLATES.format, "the box starts at the JSON shape");
    $("#zs-pref-format-block").click();
    assert.equal($("#zs-pref-tpl-format").value, BLOCK_SPEC, "the command block is one click away");
    assert.equal(saved[0].format, BLOCK_SPEC, "and it is saved");
    $("#zs-pref-reset").click();
    assert.equal($("#zs-pref-tpl-format").value, DEFAULT_TEMPLATES.format, "the defaults bring the JSON shape back");
  });

  test("calibration actions are offered and wired, and there is no section for the bar", () => {
    const w = new JSDOM("<!doctype html><body></body>").window;
    const called = [];
    openPreferences({
      document: w.document, values: { chars: 100000, calls: 8, folders: [] }, defaults: { folders: [] },
      save: { chars() {}, calls() {}, folders() {} },
      actions: { onCalibrate: () => called.push("cal"), onExportAll: () => called.push("all") },
    });
    assert.equal(w.document.querySelector("#zs-bar-corner"), null);
    assert.equal(w.document.querySelector("#zs-bar-hide"), null);
    const start = w.document.querySelector("#zs-cal-start");
    const all = w.document.querySelector("#zs-cal-export-all");
    // Clicking a row closes the popup, so the references are taken before the first click.
    start.click();
    all.click();
    assert.deepEqual(called, ["cal", "all"]);
  });
});

describe("the attachable files follow the preference", () => {
  test("the list is asked for with the user's own excluded folders instead of the built-in ones", async () => {
    const { createAttachments } = await import("../src/page/attachments.js");
    const asked = [];
    const tools = { runner: { run: async (call) => { asked.push(call.arguments); return { text: "I ran `find_files` for you.", body: "[\"a/b.go\"]", isError: false }; } }, catalogue: { active: () => [] } };
    const state = { filesChangedAt: 0 };
    const attachments = createAttachments({ provider: {}, state, tools, chat: {}, bar: {}, budget: {}, parts: {}, preferences: { excludedFolders: () => ["tmp", ".rustup"] }, startTurn() {}, diag() {} });
    assert.deepEqual((await attachments.listFiles()).paths, ["a/", "a/b.go"]);
    assert.deepEqual(asked[0].exclude, ["tmp", ".rustup"]);
    assert.equal(asked[0].exclude_only, true);
  });
});
