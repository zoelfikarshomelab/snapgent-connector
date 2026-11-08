import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { isSshServerId, workspaceServerOf } from "../src/domain/ssh/server-id.js";
import { DEFAULT_SERVER_ID } from "../src/domain/tools/default-server.js";
import { chooseRemoteWorkspace } from "../src/application/remote-workspace.js";
import { ServerDirectory } from "../src/application/server-directory.js";
import { createWorkspaceBinding } from "../src/page/workspace-binding.js";
import { targetMenuHtml, workspaceMenuHtml } from "../src/ui/menu-html.js";
import { mountPopup } from "../src/ui/popup.js";
import { openRemoteFolderBrowser } from "../src/ui/ssh-folder-browser.js";
import { openSshDialog, statusLine } from "../src/ui/ssh-dialog.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
const win = () => new JSDOM("<!doctype html><body></body>").window;
const parse = (html) => new JSDOM(`<body>${html}</body>`).window.document;

describe("SSH servers in the page", () => {
  test("only a server the bridge named ssh-... is an SSH server, and only it is asked about its own folders", () => {
    assert.equal(isSshServerId("ssh-me-h"), true);
    for (const id of ["snapgent", "ssh-", "xssh-a", "", null, undefined, 5]) assert.equal(isSshServerId(id), false, String(id));
    assert.equal(workspaceServerOf("ssh-me-h"), "ssh-me-h");
    assert.equal(workspaceServerOf(DEFAULT_SERVER_ID), undefined);
  });

  test("a chat's folder is kept per server: this computer's folder is not sent to a server, and each server keeps its own", () => {
    const data = {};
    const storage = { get: async (key) => data[key], set: (key, value) => { data[key] = value; } };
    let server = "";
    const binding = createWorkspaceBinding({ storage, provider: { conversationKey: () => "/c/A" }, serverKey: () => server });
    binding.bind("/home/me/local");
    server = "ssh-me-h";
    assert.equal(binding.current(), null, "the local folder is not the server's");
    binding.bind("/srv/app");
    assert.equal(binding.current(), "/srv/app");
    server = "";
    assert.equal(binding.current(), "/home/me/local");
    assert.deepEqual(Object.keys(data.zsWorkspaceRoots).sort(), ["/c/A", "ssh-me-h>>/c/A"]);
  });

  test("an SSH server is named by its label and is never saved in the cache of servers the user added", () => {
    const sets = [];
    const directory = new ServerDirectory({
      store: { get: async () => undefined, set: (key, value) => sets.push([key, value]) },
      liveServers: () => [{ id: "snapgent", alive: true }, { id: "ssh-me-h", alive: true, tools: 3, remote: "me@h" }, { id: "extra", alive: true }],
    });
    assert.deepEqual(directory.servers().map((server) => [server.id, server.name]), [["ssh-me-h", "me@h"], ["extra", "extra"]]);
    assert.equal(directory.name("ssh-me-h"), "me@h");
    const cached = sets.filter(([key]) => key === "zsCustomMcpServers").at(-1)[1].map((server) => server.id);
    assert.deepEqual(cached, ["extra"]);
  });
});

describe("the menus", () => {
  test("the target menu offers SSH only where it can be handled, and the other rows are as before", () => {
    const options = [{ id: "snapgent", name: "VS Code" }];
    assert.equal(parse(targetMenuHtml(options, "snapgent")).querySelector(".zs-ssh-open"), null);
    const doc = parse(targetMenuHtml(options, "snapgent", { ssh: true }));
    assert.ok(doc.querySelector(".zs-ssh-open"));
    assert.equal(doc.querySelectorAll(".zs-target-opt").length, 1);
    assert.equal(doc.querySelectorAll(".zs-site-badge").length, 1);
  });

  test("the folder menu of a server has no Auto row and browses the server's folders; this computer's menu is unchanged", () => {
    const rows = (doc) => [...doc.querySelectorAll(".zs-ws-opt")].map((row) => row.dataset.path);
    const remote = parse(workspaceMenuHtml({ active: null, open: [], pinned: "/srv/app", remote: true }));
    assert.deepEqual(rows(remote), ["/srv/app"]);
    assert.match(remote.body.textContent, /Browse the server's folders/);
    assert.match(remote.body.textContent, /Open on the server/);
    assert.doesNotMatch(remote.body.textContent, /Auto|system's folder window/);
    const local = parse(workspaceMenuHtml({ active: null, open: ["/work/a"], pinned: null }));
    assert.deepEqual(rows(local), ["", "/work/a"]);
    assert.match(local.body.textContent, /Choose a folder…/);
  });
});

describe("the folder browser of a server", () => {
  const listing = (path, dirs, parent) => ({ ok: true, path, parent, dirs });
  function open(list, options = {}) {
    const w = win();
    const asked = [];
    const answer = openRemoteFolderBrowser({ document: w.document, label: "me@h", list: async (path) => { asked.push(path); return list(path); }, ...options });
    return { w, asked, answer, $: (selector) => w.document.querySelector(selector), $$: (selector) => [...w.document.querySelectorAll(selector)] };
  }

  test("it starts at the server's home, lists folder names as text, enters one on a click, goes up, and Use answers the folder", async () => {
    const tree = { "/home/me": listing("/home/me", ["a", "<b>x</b>"], "/home"), "/home/me/a": listing("/home/me/a", [], "/home/me") };
    const t = open((path) => tree[path || "/home/me"]);
    await flush();
    assert.deepEqual(t.asked, [undefined]);
    assert.equal(t.$(".zs-ssh-path").textContent, "/home/me");
    assert.deepEqual(t.$$(".zs-ssh-dir").map((button) => button.textContent), ["a", "<b>x</b>"]);
    assert.equal(t.$("b"), null, "a folder's name never becomes markup");
    t.$$(".zs-ssh-dir")[0].click();
    await flush();
    assert.equal(t.asked.at(-1), "/home/me/a");
    assert.match(t.$(".zs-ssh-dirs").textContent, /No folders inside/);
    t.$(".zs-ssh-up").click();
    await flush();
    assert.equal(t.asked.at(-1), "/home/me");
    t.$(".zs-ssh-use").click();
    assert.equal(await t.answer, "/home/me");
    assert.equal(t.w.document.getElementById("zs-mcp-pop"), null);
  });

  test("at the root there is no way up, and a folder that cannot be read says why and keeps the last listing", async () => {
    const t = open(async (path) => (path === "/bad" ? { ok: false, error: "That folder cannot be read" } : listing("/", ["bad"], null)));
    await flush();
    assert.equal(t.$(".zs-ssh-up").disabled, true);
    t.$(".zs-ssh-dir").click();
    await flush();
    assert.equal(t.asked.at(-1), "/bad", "a folder inside the root is /bad, not //bad");
    assert.equal(t.$(".zs-ssh-error").hidden, false);
    assert.match(t.$(".zs-ssh-error").textContent, /cannot be read/);
    assert.equal(t.$(".zs-ssh-path").textContent, "/");
  });

  test("a long folder list says it was cut", async () => {
    const t = open(async () => ({ ...listing("/", ["a"], null), truncated: true }));
    await flush();
    assert.match(t.$(".zs-ssh-dirs").textContent, /Only the first folders/);
  });

  test("nothing can be chosen before a listing arrives, and closing answers nothing", async () => {
    const t = open(() => new Promise(() => {}));
    assert.equal(t.$(".zs-ssh-use").disabled, true);
    t.$(".zs-mcp-pop-close").click();
    assert.equal(await t.answer, null);
  });

  test("a popup that replaces it counts as a no, so the question is never left hanging", async () => {
    const t = open(async () => listing("/", [], null));
    await flush();
    mountPopup(t.w.document);
    assert.equal(await t.answer, null);
  });

  test("a listing that fails to arrive is said, not thrown", async () => {
    const t = open(async () => { throw new Error("the connection dropped"); });
    await flush();
    assert.match(t.$(".zs-ssh-error").textContent, /connection dropped/);
  });
});

describe("the SSH dialog", () => {
  function open(over = {}) {
    const w = win();
    const calls = { connect: [], disconnect: [], connected: [] };
    const state = { listener: null, closed: 0 };
    openSshDialog({
      document: w.document,
      connect: over.connect || (async (target) => { calls.connect.push(target); return over.reply || { ok: true, server_id: "ssh-me-h", label: "me@h" }; }),
      disconnect: async (id) => { calls.disconnect.push(id); return over.disconnectReply || { ok: true }; },
      connected: () => over.connected || [],
      onStatus: (listener) => { state.listener = listener; return () => { state.listener = null; }; },
      onConnected: (reply) => calls.connected.push(reply),
      onClose: () => { state.closed += 1; },
    });
    const $ = (selector) => w.document.querySelector(selector);
    const submit = (text) => { $(".zs-ssh-input").value = text; $(".zs-ssh-form").dispatchEvent(new w.Event("submit", { cancelable: true })); };
    return { w, calls, state, $, submit };
  }

  test("the typed server is connected to, said so, and handed on", async () => {
    const t = open();
    t.submit("  me@h  ");
    await flush();
    assert.deepEqual(t.calls.connect, ["me@h"]);
    assert.match(t.$(".zs-ssh-status").textContent, /Connected to me@h/);
    assert.equal(t.$(".zs-ssh-status").dataset.kind, "ok");
    assert.deepEqual(t.calls.connected, [{ ok: true, server_id: "ssh-me-h", label: "me@h" }]);
    assert.equal(t.$(".zs-ssh-go").disabled, false);
  });

  test("nothing typed asks for the server and connects to nothing", async () => {
    const t = open();
    t.submit("   ");
    await flush();
    assert.deepEqual(t.calls.connect, []);
    assert.match(t.$(".zs-ssh-status").textContent, /user@host/);
  });

  test("a refusal is shown and the form is usable again; an exception is shown too", async () => {
    const refused = open({ reply: { ok: false, error: "Connection cancelled." } });
    refused.submit("me@h");
    await flush();
    assert.equal(refused.$(".zs-ssh-status").textContent, "Connection cancelled.");
    assert.equal(refused.$(".zs-ssh-status").dataset.kind, "bad");
    assert.equal(refused.$(".zs-ssh-input").disabled, false);
    assert.deepEqual(refused.calls.connected, []);
    const broken = open({ connect: async () => { throw new Error("no response"); } });
    broken.submit("me@h");
    await flush();
    assert.match(broken.$(".zs-ssh-status").textContent, /no response/);
  });

  test("while it connects, the steps the bridge reports are shown, and not before or after", async () => {
    let release;
    const t = open({ connect: () => new Promise((resolve) => { release = () => resolve({ ok: true, server_id: "ssh-me-h", label: "me@h" }); }) });
    t.state.listener({ state: "connecting", label: "me@h" });
    assert.equal(t.$(".zs-ssh-status").textContent, "", "nothing is being connected yet");
    t.submit("me@h");
    assert.equal(t.$(".zs-ssh-input").disabled, true);
    t.state.listener({ state: "connecting", label: "me@h" });
    assert.match(t.$(".zs-ssh-status").textContent, /Signing in to me@h.*window that opens/);
    t.state.listener({ state: "preparing", label: "me@h" });
    assert.match(t.$(".zs-ssh-status").textContent, /Putting the Snapgent server on me@h/);
    release();
    await flush();
    assert.match(t.$(".zs-ssh-status").textContent, /Connected to me@h/);
  });

  test("servers already connected are listed with a Disconnect, and one that is gone leaves the list", async () => {
    const t = open({ connected: [{ id: "ssh-me-h", label: "me@h" }, { id: "ssh-x-y", label: "<img src=x onerror=1>" }] });
    assert.equal(t.w.document.querySelectorAll(".zs-ssh-conn").length, 2);
    assert.equal(t.$("img"), null, "a label is text");
    t.$(".zs-ssh-off").click();
    await flush();
    assert.deepEqual(t.calls.disconnect, ["ssh-me-h"]);
    assert.equal(t.w.document.querySelectorAll(".zs-ssh-conn").length, 1);
    assert.match(t.$(".zs-ssh-status").textContent, /Disconnected from me@h/);
  });

  test("a Disconnect that fails says why and can be pressed again", async () => {
    const t = open({ connected: [{ id: "ssh-me-h", label: "me@h" }], disconnectReply: { ok: false, error: "That server is not connected." } });
    t.$(".zs-ssh-off").click();
    await flush();
    assert.equal(t.$(".zs-ssh-status").textContent, "That server is not connected.");
    assert.equal(t.$(".zs-ssh-off").disabled, false);
  });

  test("closing stops listening and tells the caller; typing does not reach the site's shortcuts", async () => {
    const t = open();
    let reached = false;
    t.w.document.addEventListener("keydown", () => { reached = true; });
    t.$(".zs-ssh-input").dispatchEvent(new t.w.KeyboardEvent("keydown", { key: "a", bubbles: true }));
    assert.equal(reached, false);
    t.$(".zs-mcp-pop-close").click();
    assert.equal(t.state.listener, null);
    assert.equal(t.state.closed, 1);
  });

  test("each state of a connection has its words", () => {
    assert.deepEqual(statusLine({ state: "ready", label: "me@h" }), { text: "Connected to me@h.", kind: "ok" });
    assert.deepEqual(statusLine({ state: "failed", label: "me@h", detail: "Permission denied" }), { text: "Permission denied", kind: "bad" });
    assert.equal(statusLine({ state: "failed" }).text, "Could not connect to the server.");
    assert.equal(statusLine({ state: "closed", detail: "The SSH connection ended. Connect again to continue." }).kind, "warn");
    assert.deepEqual(statusLine({ state: "mystery" }), { text: "", kind: "" });
    assert.deepEqual(statusLine(null), { text: "", kind: "" });
  });
});

describe("choosing a folder on a server", () => {
  const run = ({ picked = "/srv/app", allowed = true, reply = { ok: true } } = {}) => {
    const log = [];
    const result = chooseRemoteWorkspace({
      server: "ssh-me-h",
      browse: async (server) => { log.push(["browse", server]); return picked; },
      confirm: { ask: async (request) => { log.push(["ask", request.description]); return allowed; } },
      send: async (message) => { log.push(["send", message]); return reply; },
      setPending: (path) => log.push(["pending", path]),
    });
    return { result, log };
  };

  test("the folder is browsed, approved once, pinned on that server and kept for the chat", async () => {
    const { result, log } = run();
    assert.deepEqual(await result, { path: "/srv/app" });
    assert.deepEqual(log.map((entry) => entry[0]), ["browse", "ask", "send", "pending"]);
    assert.deepEqual(log[2][1], { type: "set_workspace", path: "/srv/app", server: "ssh-me-h" });
    assert.match(log[1][1], /\/srv\/app/);
  });

  test("closing the browser or refusing the question cancels, and a server that refuses the folder says why", async () => {
    assert.deepEqual(await run({ picked: null }).result, { cancelled: true });
    const refused = run({ allowed: false });
    assert.deepEqual(await refused.result, { cancelled: true });
    assert.deepEqual(refused.log.map((entry) => entry[0]), ["browse", "ask"], "nothing is pinned without approval");
    const bad = run({ reply: { ok: false, error: "Not a folder" } });
    assert.deepEqual(await bad.result, { error: "Not a folder" });
    assert.ok(!bad.log.some((entry) => entry[0] === "pending"));
    assert.deepEqual(await run({ reply: null }).result, { error: "Could not use that folder." });
  });
});

describe("the page's SSH state", () => {
  async function withChrome(run) {
    const handlers = [];
    globalThis.chrome = { runtime: { onMessage: { addListener: (handler) => handlers.push(handler) } } };
    try {
      const { createSsh } = await import("../src/page/ssh.js");
      return await run({ createSsh, handlers });
    } finally {
      delete globalThis.chrome;
    }
  }

  test("status pushed by the worker reaches listeners until they unsubscribe, and the connected servers are the ones the bridge labelled", async () => {
    await withChrome(async ({ createSsh, handlers }) => {
      const state = { bridge: { servers: [{ id: "snapgent", alive: true }, { id: "ssh-me-h", alive: true, remote: "me@h" }] } };
      const ssh = createSsh({ document: win().document, send: async () => ({ ok: true }), settings: { target: () => "snapgent", selectTarget: async () => {} }, state });
      const seen = [];
      const off = ssh.onStatus((message) => seen.push(message.state));
      handlers[0]({ type: "zs-ssh-status", state: "connecting" });
      handlers[0]({ type: "zs-status" });
      off();
      handlers[0]({ type: "zs-ssh-status", state: "ready" });
      assert.deepEqual(seen, ["connecting"]);
      assert.deepEqual(ssh.connected(), [{ id: "ssh-me-h", label: "me@h" }]);
    });
  });

  test("disconnecting the server the chat works on moves it back to this computer; any other leaves the target alone", async () => {
    await withChrome(async ({ createSsh }) => {
      const picked = [];
      const sent = [];
      const settings = { target: () => "ssh-me-h", selectTarget: async (id) => { picked.push(id); } };
      const ssh = createSsh({ document: win().document, send: async (message) => { sent.push(message); return { ok: true }; }, settings, state: { bridge: { servers: [] } } });
      await ssh.disconnect("ssh-other-x");
      assert.deepEqual(picked, []);
      await ssh.disconnect("ssh-me-h");
      assert.deepEqual(picked, [DEFAULT_SERVER_ID]);
      assert.deepEqual(sent.at(-1), { type: "ssh_disconnect", server: "ssh-me-h" });
    });
  });
});
