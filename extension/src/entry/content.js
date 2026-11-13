// SPDX-License-Identifier: GPL-3.0-or-later
// The content script: turns a chat site into a VS Code agent. Only composes the page modules (src/page); each does one job and
// reaches the others through the objects passed to it. Anything that reads the site goes through `provider`.

import { PartQueue, ServerDirectory } from "../application/index.js";
import defaultCalibrations from "../../profiles/default-calibrations.json";
import { buildResendRider } from "../domain/prompt/resend.js";
import { createAccountImport } from "../page/account-import.js";
import { createAccountScope } from "../page/account-scope.js";
import { createAccountStorage } from "../page/account-storage.js";
import { createAttachments } from "../page/attachments.js";
import { createAgentMode } from "../page/agent-mode.js";
import { createPatientMode } from "../page/patient-mode.js";
import { createAtPopup } from "../page/at-popup.js";
import { createAutoResume } from "../page/auto-resume.js";
import { createBar } from "../page/bar.js";
import { createBatchJobs } from "../page/batch-jobs.js";
import { createBridgeStatus } from "../page/bridge-status.js";
import { createCalibrationActions } from "../page/calibration-actions.js";
import { createCaptchaAlert } from "../page/captcha-alert.js";
import { createChat } from "../page/chat.js";
import { createDiagnostics, watchForStalls } from "../page/diagnostics.js";
import { createExtensionBridge } from "../page/extension-bridge.js";
import { createLoop } from "../page/loop.js";
import { createMessageBudget } from "../page/message-budget.js";
import { startPageWatch } from "../page/page-watch.js";
import { createPromptResend } from "../page/prompt-resend.js";
import { createReplay } from "../page/replay.js";
import { createPreferences } from "../page/preferences.js";
import { defaultPreferences } from "../infrastructure/calibration/defaults.js";
import { createProvider } from "../page/provider.js";
import { createSession } from "../page/session.js";
import { createSettings } from "../page/settings.js";
import { createSsh } from "../page/ssh.js";
import { createState } from "../page/state.js";
import { createStop } from "../page/stop.js";
import { createStorage } from "../page/storage.js";
import { createTerminal } from "../page/terminal.js";
import { createTools } from "../page/tools.js";
import { createTurns } from "../page/turns.js";
import { installUserInput } from "../page/user-input.js";
import { createVisibility } from "../page/visibility.js";
import { accountSiteFor, accountStorageOf } from "../sites/registry.js";

const storage = createStorage();
const state = createState();
let record = () => {};
const diag = (event, data) => record(event, data);
const provider = createProvider({ document, location, storage, diag, defaults: defaultCalibrations });
record = createDiagnostics({ provider, state, document, window });
watchForStalls({ diag, state, setInterval });

// The bar is made after the parts it shows; the parts that need it reach it through this.
let bar;
const redraw = () => { if (bar) bar.render(); };
const notify = (level, title, text) => bar.banner(level, title, text);

const send = createExtensionBridge();
const settings = createSettings({ storage, location, onChange: redraw });
// The login in use, so one account's chats do not inherit another's folders. Empty on a site without accounts.
const accountSite = accountSiteFor(location.hostname);
const accounts = createAccountScope({ storage, site: accountSite ? accountSite.id : "" });
// The login keys a site keeps in localStorage (DeepSeek's token): the background reads and writes them through this, nothing else.
const accountStorage = createAccountStorage({ area: window.localStorage, allowed: accountSite ? accountStorageOf(accountSite) : [] });
// "Import logins" opens its file window here, on the page: a popup closes as soon as a file window takes its focus.
const accountImport = createAccountImport({ document, site: accountSite, send });
// The terminal panel lives from page load on: it must be listening before the first command starts.
const terminal = createTerminal({ document, diag, onChange: redraw });
terminal.start();
const serverDirectory = new ServerDirectory({ store: storage, liveServers: () => state.bridge.servers || [], onChange: redraw, log: (...args) => console.warn("[snapgent]", ...args) });
const visibility = createVisibility({ document, state, diag, onParkChange: redraw });
// The preferences before the tools: the runner adds the folders left out of attachments to the model's own tree and search commands.
const preferences = createPreferences({ storage, state, defaults: defaultPreferences(defaultCalibrations) });
// The budget before the tools: the system prompt tells the model the effective Commands per reply, so the tools need its `calls` getter.
const budget = createMessageBudget({ storage, hostname: location.hostname, provider, diag });
// The SSH connect dialog and folder browser, made below with the bar's toast: the tools reach it only when a chat starts on a server.
let ssh;
const tools = createTools({ send, provider, state, settings, serverDirectory, visibility, storage, diag, banner: notify, terminal, accountKey: accounts.id, calls: budget.calls, excludedFolders: preferences.excludedFolders, browseRemote: (server) => ssh.browse(server), templates: () => preferences.templates() });
terminal.setCancel((jobKey, name) => tools.runner.cancelJob(jobKey, name));
terminal.setRunner((call, options) => tools.manual.run(call, options));
terminal.setTools(() => tools.catalogue.active());
const bridgeStatus = createBridgeStatus({ state, settings, tools, send, bar: () => bar, diag });
let stop;
let session;
let attachments;
let agentMode;
let patientMode;
let replay;
ssh = createSsh({ document, send, settings, state, toast: (text) => bar.toast(text) });
const calibration = createCalibrationActions({ document, location, provider, state, storage, settings, preferences, toast: (text) => bar.toast(text), previewStartMessage: () => session?.previewStartMessage?.(), previewReminderMessage: async () => { await tools.catalogue.ensure(); return tools.catalogue.active().length ? tools.reminderText() : null; }, previewBrief: () => tools.brief() });
bar = createBar({
  document, window, provider, state, settings, serverDirectory, tools, monitor: bridgeStatus.monitor, storage, preferences, send, calibration, terminal, ssh,
  files: { list: () => attachments.listFiles(), refresh: () => attachments.refresh(), insert: (paths) => attachments.insert(paths), canList: () => attachments.canList() },
  onStart: () => session.start(),
  onStop: () => stop.stopLoop(),
  onPlay: () => replay.play(),
  onAdopt: () => session.adopt(),
  onTogglePatient: () => patientMode.toggle(),
  onToggleMode: () => { if (!agentMode.toggle()) bar.toast("Send a message first · this chat has no id yet"); },
});

const chat = createChat({ document, provider, state, visibility, catalogue: tools.catalogue, diag, cover: bar.cover, banner: notify, progress: (text) => bar.coverLabel(text), budget });
const { turnKey, executed, progress } = createTurns({ provider });
const resend = createPromptResend({ provider, state, storage, rider: () => buildResendRider(preferences.templates().resend, tools.brief()), limit: budget.limit, chat, diag });
const parts = new PartQueue();
const loop = createLoop({ state, provider, tools, chat, bar, visibility, executed, budget, jobs: createBatchJobs({ storage, provider, turnKey }), progress, resend, parts, diag });
session = createSession({ state, provider, tools, chat, bar, reminder: loop.reminder, limit: budget.limit, storage, settings, serverDirectory, preferences, diag });
stop = createStop({ document, state, provider, bar, diag });
agentMode = createAgentMode({ state, provider, storage, onStop: () => stop.stopLoop(), onChange: redraw, diag });
replay = createReplay({ state, provider, executed, progress, loop, bar, diag });
patientMode = createPatientMode({ state, provider, storage, onChange: redraw, diag });

let userInput;
attachments = createAttachments({ provider, state, tools, chat, bar, budget, parts, preferences, startTurn: (base) => userInput.startTurn(base), diag });
userInput = installUserInput({ document, state, provider, bar, resend, loop, takeOver: attachments.takeOver, diag });
createAtPopup({ document, window, root: bar.root, state, settings, provider, attachments, preferences, calibration, toast: bar.toast, diag });
createAutoResume({ document, state, provider, executed, loop, diag });
startPageWatch({ document, window, provider, session, bar, agentMode });
createCaptchaAlert({ provider, window, document, state, toast: (text) => bar.toast(text), diag }).start();
// The popup asks before it switches logins: a running agent would be left talking to a session that is no longer there.
try {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message && message.type === "zs-account-storage-read") { sendResponse({ ok: true, values: accountStorage.read(message.keys) }); return undefined; }
    if (message && message.type === "zs-account-storage-write") { sendResponse({ ok: true, written: accountStorage.write(message.entries) }); return undefined; }
    if (message && message.type === "zs-accounts-import") { sendResponse({ ok: accountImport.open() }); return undefined; }
    if (!message || message.type !== "zs-account-status") return undefined;
    sendResponse({ ok: true, supported: !!accountSite, account: accounts.id(), busy: !!(state.running || state.starting) });
    return undefined;
  });
} catch { /* no extension messaging here */ }
resend.hydrate();
settings.ready.then(bridgeStatus.start);
console.log(`[snapgent] content script ready (provider: ${provider.id})`);
