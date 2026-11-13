// SPDX-License-Identifier: GPL-3.0-or-later
// Executes one command from the model and returns the text to send back.
// It always returns an answer: the model must ALWAYS receive an output.
//
// Order of decisions (each delegated to a focused module):
//   1. not while the tab is hidden             -> VisibilityPort
//   2. commands we answer ourselves            -> domain/tools/virtual-commands
//   3. is this server allowed / is the tool real -> domain/tools/isolation + ToolCatalogue
//   4. call the bridge under guards            -> call-guard
//      (a risky action first needs the user's approval -> ConfirmPort)
//   5. shape the result for the model          -> domain/tools/result-feedback
//
// What the model reads is written from the user's templates (domain/prompt/templates.js): the body of the
// answer, the command it came from, and - when it failed - the call as it should be written.

import { FEEDBACK } from "../domain/prompt/feedback.js";
import { JOB_ARGUMENT, JOB_OP_ARGUMENT, MODE_ARGUMENT, RESERVED_ARGUMENT, ROOT_ARGUMENT, declinedFeedback, needsApproval, unavailableFeedback, withoutReserved } from "../domain/tools/confirmation.js";
import { withBudget, withExcluded } from "../domain/tools/call-arguments.js";
import { commandMessage } from "../domain/tools/command-message.js";
import { isolationError } from "../domain/tools/isolation.js";
import { toFeedback } from "../domain/tools/result-feedback.js";
import { runningDetail } from "../domain/tools/result-summary.js";
import { LIST_SERVERS, isListCommands, renderCommandList, renderServerList } from "../domain/tools/virtual-commands.js";
import { bareToolName } from "../domain/tools/names.js";
import { DEFAULT_SERVER_ID } from "../domain/tools/default-server.js";
import { callWithGuards } from "./call-guard.js";
import { waitOut } from "./wait-loop.js";

const DEFAULT_TIMEOUT_MS = 120000;
const STOPPED_BEFORE_RUN = "the command was not run: you stopped it before it started.";

export class ToolRunner {
  /**
   * @param {{ bridge: import("./ports.js").BridgePort,
   *           catalogue: import("./tool-catalogue.js").ToolCatalogue,
   *           session: import("./ports.js").SessionPort,
   *           visibility: import("./ports.js").VisibilityPort,
   *           sink: import("./ports.js").SinkPort,
   *           confirm?: import("./ports.js").ConfirmPort,
   *           approvalMode?: () => string,
   *           workspaceRoot?: () => (string|null),   // the folder this chat works in, sent with every VS Code command
   *           excludedFolders?: () => string[],      // the folders the user left out of attachments, added to tree / search_files / find_files
   *           templates?: () => { result: string, error: string },   // the user's wording for a command that worked and one that failed
   *           timers?: import("./ports.js").Timers,
   *           timeoutMs?: number,
   *           now?: () => number }} deps
   */
  constructor({ bridge, catalogue, session, visibility, sink, confirm = null, approvalMode = () => "manual", workspaceRoot = () => null, excludedFolders = () => [], templates = () => ({}), timers = globalThis, timeoutMs = DEFAULT_TIMEOUT_MS, now = Date.now }) {
    this._bridge = bridge;
    this._catalogue = catalogue;
    this._session = session;
    this._visibility = visibility;
    this._sink = sink;
    this._confirm = confirm;
    this._approvalMode = approvalMode;
    this._workspaceRoot = workspaceRoot;
    this._excludedFolders = excludedFolders;
    this._templates = templates;
    this._timers = timers;
    this._timeoutMs = timeoutMs;
    this._now = now;
  }

  /**
   * @param {{ tool: string, arguments?: object }} call
   * @param {{ budgetChars?: number, jobKey?: string }} [options]  the most output the model may be sent for this call;
   *   the name the VS Code server knows the call by (the same call again is answered, not run twice; Stop cancels it)
   * @returns {Promise<{ text: string, body: string, isError: boolean, images?: object[], event?: string }>}
   *   `text` is what the model reads, `body` is the raw output (what the terminal panel and the extension itself read).
   */
  async run(call, { budgetChars, jobKey } = {}) {
    const name = call.tool;
    const args = call.arguments || {};
    if (!name) return this._answer(call, { body: FEEDBACK.parseError("malformed"), isError: true });

    // This is the single choke point for ALL execution, so it is also where we
    // refuse to run blind while the tab is in the background.
    if (this._visibility.isHidden() && !this._session.isStopped()) {
      this._sink.diag("tool.waitVisible", { name });
      if (!(await this._visibility.waitUntilVisible()) || this._session.isStopped()) return this._answer(call, { body: STOPPED_BEFORE_RUN, isError: true });
    }

    const target = this._session.target();
    if (name === LIST_SERVERS) return this._answer(call, await this._listServers(target));
    if (isListCommands(name)) return this._answer(call, await this._listCommands(name, target, args));

    const refusal = isolationError({ name, target, targetEnabled: this._session.isEnabled(target) });
    if (refusal) return this._answer(call, { body: refusal, isError: true });
    if (!this._catalogue.names().size) await this._catalogue.ensure();
    const workspaceTarget = target === DEFAULT_SERVER_ID || this._catalogue.active().some((tool) => ["tree", "list_dir", "list_commands"].includes(bareToolName(tool.name)));
    if (workspaceTarget && !this._catalogue.names().size) return this._answer(call, { body: FEEDBACK.workspaceClosed(this._workspaceRoot()), isError: true });
    if (!this._catalogue.knows(name)) return this._answer(call, { body: FEEDBACK.unknownTool(name, [...this._catalogue.names()]), isError: true });

    return this._execute(call, name, withBudget(this._catalogue.all, name, withExcluded(name, withoutReserved(args), this._excludedFolders), budgetChars), target, jobKey);
  }

  /**
   * The message the model reads, written from the user's templates: the command that ran, its output, and - when it failed -
   * the call as it should be written.
   */
  _answer(call, outcome) {
    const text = commandMessage(call, outcome, this._templates() || {});
    return { text, body: outcome.body, isError: !!outcome.isError, images: outcome.images, event: outcome.event };
  }

  async _listServers(target) {
    await this._catalogue.ensure();
    // The model only ever sees the selected server, and only if its toggle is on.
    const servers = this._session.servers().filter((sv) => sv.id === target && this._session.isEnabled(sv.id));
    return renderServerList({ servers, target });
  }

  async _listCommands(name, target, args) {
    await this._catalogue.ensure();
    return renderCommandList({
      name,
      target,
      asked: typeof args.server === "string" ? args.server.trim() : "",
      enabled: this._session.isEnabled(target),
      tools: this._catalogue.all,
    });
  }

  _callBridge(name, args, target, jobKey) {
    // The VS Code server applies the bar's choice (plan / manual / auto) and keeps the call under its job key; other servers know nothing of either.
    const workspaceTarget = target === DEFAULT_SERVER_ID || this._catalogue.active().some((tool) => ["tree", "list_dir", "list_commands"].includes(bareToolName(tool.name)));
    const root = workspaceTarget ? this._workspaceRoot() : null;
    const sent = workspaceTarget ? { ...args, [MODE_ARGUMENT]: this._approvalMode(), ...(jobKey ? { [JOB_ARGUMENT]: jobKey } : {}), ...(root ? { [ROOT_ARGUMENT]: root } : {}) } : args;
    return callWithGuards(
      () => this._bridge.callTool({ name, arguments: sent, timeout: this._timeoutMs, server: target }),
      { timeoutMs: this._timeoutMs, isStopped: () => this._session.isStopped(), timers: this._timers },
    );
  }

  /** Ask the user; returns the text to give the model when the action must not run, or null to proceed. */
  async _askUser(confirmation) {
    if (!this._confirm) return unavailableFeedback(confirmation.description);
    const approved = await this._confirm.ask({ description: confirmation.description, tool: confirmation.tool, risk: confirmation.risk });
    this._sink.diag("tool.confirm", { tool: confirmation.tool, approved });
    return approved ? null : declinedFeedback(confirmation.description);
  }

  /**
   * The default server, or any server that advertises a folder tool (an editor's fork, a server reached over SSH): the ones that take a job key and can end a command.
   */
  _isWorkspaceTarget(target) {
    return target === DEFAULT_SERVER_ID || this._catalogue.active().some((tool) => ["tree", "list_dir", "list_commands"].includes(bareToolName(tool.name)));
  }

  /** Stop only abandons the wait: the command itself keeps running on the machine unless the server is told to end it. */
  _cancelJob(name, target, jobKey) {
    if (!jobKey || !this._isWorkspaceTarget(target)) return;
    const cancel = { [JOB_ARGUMENT]: jobKey, [JOB_OP_ARGUMENT]: "cancel", [MODE_ARGUMENT]: this._approvalMode() };
    Promise.resolve(this._bridge.callTool({ name, arguments: cancel, timeout: 5000, server: target })).catch(() => {});
  }

  /** Stop from the terminal panel: the same cancellation as the loop's Stop, named after that one tab. */
  cancelJob(jobKey, name, target) {
    this._cancelJob(name, target || this._session.target(), jobKey);
  }

  _terminalBegin(jobKey, name, args, target) {
    const workspaceTarget = target === DEFAULT_SERVER_ID || this._catalogue.active().some((tool) => ["tree", "list_dir", "list_commands"].includes(bareToolName(tool.name)));
    if (!jobKey || !workspaceTarget) return; // only folder-aware servers stream; others have no terminal
    try {
      this._sink.terminal && this._sink.terminal.begin({ key: jobKey, name, label: runningDetail({ arguments: args }) });
    } catch { /* the panel must never break a command */ }
  }

  _terminalEnd(jobKey, status, text) {
    if (!jobKey) return;
    try {
      this._sink.terminal && this._sink.terminal.finish(jobKey, status, text);
    } catch { /* ditto */ }
  }

  /** wait_command is waited out here (see wait-loop.js): the model gets one answer when the command is over, not one per wait. */
  _dispatch(name, args, target, jobKey) {
    if (bareToolName(name) !== "wait_command") return this._callBridge(name, args, target, jobKey);
    return waitOut(
      (seconds) => this._callBridge(name, { ...args, wait_seconds: seconds }, target, jobKey),
      { isStopped: () => this._session.isStopped(), now: this._now },
    );
  }

  async _execute(call, name, args, target, jobKey) {
    this._terminalBegin(jobKey, name, args, target);
    let result;
    try {
      result = await this._dispatch(name, args, target, jobKey);
    } catch (error) {
      this._terminalEnd(jobKey, "failed");
      throw error;
    }
    if (result && result.kind === "stopped") { this._terminalEnd(jobKey, "stopped"); this._cancelJob(name, target, jobKey); return this._answer(call, { body: "the command was stopped: you ended the session while it was still running.", isError: true }); }
    if (needsApproval(result)) {
      const refusal = await this._askUser(result.confirmation);
      if (refusal) { this._terminalEnd(jobKey, "failed", refusal); return this._answer(call, { body: refusal, isError: true }); }
      // Repeat the very same call, now carrying the one-time token only the extension was given.
      result = await this._callBridge(name, { ...args, [RESERVED_ARGUMENT]: result.confirmation.token }, target, jobKey);
      if (result && result.kind === "stopped") { this._terminalEnd(jobKey, "stopped"); this._cancelJob(name, target, jobKey); return this._answer(call, { body: "the command was stopped: you ended the session while it was still running.", isError: true }); }
    }
    const status = result && result.ok ? "success" : (result && result.kind === "cancelled" ? "stopped" : "failed");

    const feedback = toFeedback(result, {
      name,
      supportsVision: this._session.supportsVision(),
      timeoutSeconds: this._timeoutMs / 1000,
    });
    if (feedback.images) {
      this._sink.images(feedback.images, name);
      this._sink.diag("images.stashed", { count: feedback.images.length });
    }
    if (feedback.event === "stale-extension") {
      this._sink.staleExtension(result.error, name);
      this._sink.diag("bridge.staleExtension", { name, error: result.error });
    }
    const answer = this._answer(call, feedback);
    // The tab keeps the very text the model is given, so Copy hands over what a manual reply would need.
    this._terminalEnd(jobKey, status, answer.text);
    return answer;
  }
}
