// SPDX-License-Identifier: GPL-3.0-or-later
// Whether this conversation is a snapgent session, and starting one. The state is derived from the chat itself and remembered per
// conversation (session-tracker), so it survives reloads and virtualised lists that drop the system prompt from the page.

import { SessionStarter, SessionTracker, textShowsSession } from "../application/index.js";
import { SESSION_PHRASE } from "../domain/constants.js";
import { buildStartMessage } from "../domain/prompt/start-message.js";
import { DEFAULT_SERVER_ID } from "../domain/tools/default-server.js";
import { waitFor } from "./visibility.js";

/**
 * @param {{ state: object, provider: object, tools: object, chat: object, bar: object, reminder: object, limit: () => number,
 *           storage: object, settings: object, serverDirectory: object, diag: Function }} deps
 */
export function createSession({ state, provider, tools, chat, bar, reminder, limit, storage, settings, serverDirectory, preferences, diag }) {
  const tracker = new SessionTracker({ store: storage });

  const lifecycle = {
    canStart: () => !state.running && !state.starting,
    begin() {
      state.userStopped = false;
      state.stop = false; // a halt left by an aborted start
      // The reply already on screen (a reload restores an in-progress generation) must never be run into this new chat.
      state.bootBaselineId = provider.lastAssistantId ? provider.lastAssistantId() : null;
      state.starting = true;
      const generation = ++state.startGen;
      state.startingKey = null; // unknown until the conversation gets an id
      reminder.reset();
      provider.setInputLock(true);
      bar.cover(true);
      bar.render();
      return () => state.startGen === generation; // false once the user opened another chat
    },
    markStarted() {
      state.started = true;
      tracker.remember(provider.conversationKey());
      tools.workspace.commit();
      bar.render();
    },
    end(alive) {
      // Only our OWN starting state is torn down: if superseded, the session sync owns it now.
      if (!alive()) return;
      state.starting = false;
      state.startingKey = null;
      if (!state.started) tools.workspace.clearPending(); // a start that did not finish leaves no folder behind
      bar.cover(false);
      provider.setInputLock(false);
      bar.render();
    },
  };

  const starter = new SessionStarter({
    session: lifecycle,
    page: {
      isEmpty: () => provider.chatIsEmpty(),
      isStarted: () => state.started,
      ensureComposerReady: (reason) => provider.ensureComposerReady(reason),
      displayName: () => provider.displayName,
    },
    target: {
      id: settings.target,
      name: () => serverDirectory.name(settings.target()),
      bridgeConnected: () => !!state.bridge.connected,
      serverAlive: () => !!(state.bridge.servers || []).find((server) => server.id === DEFAULT_SERVER_ID && server.alive),
    },
    catalogue: tools.catalogue,
    callTool: (name, args, timeout) => tools.bridge.callTool({ name, arguments: tools.workspace.withRoot(args), timeout }),
    skills: tools.skills,
    workspace: tools.workspace,
    startMessage: ({ commands, tree, context }) => buildStartMessage({ prompt: tools.systemPrompt(), commands, tree, context }),
    chat: { ...chat.turns, submit: chat.turns.submitInline || chat.turns.submit }, // the start message is typed, never attached as a file
    runner: tools.runner,
    initialContext: { limit },
    view: { toast: bar.toast, banner: bar.banner },
    layout: {
      // Our message must show up as a user turn carrying its own words: that is how the session is recognised later.
      sentMessageVisible: () => waitFor(() => provider.allItems().some((item) => provider.isUserItem(item) && provider.itemText(item).includes(SESSION_PHRASE)), 5000),
      describe: chat.describeLayout,
    },
    isStopped: () => state.stop,
    contextFiles: async () => { const values = await preferences.read(); return values.contextFiles; },
    startPrefs: async () => { const values = await preferences.read(); return { tree: values.startTree, instructions: values.startContext, folders: values.folders }; },
    diag,
  });

  const markerInDom = () => provider.allItems().some((item) => textShowsSession(item.textContent || "", SESSION_PHRASE));

  /** Reconcile the flags with the conversation now on screen. Called on every page change. */
  function sync() {
    const decide = () => tracker.decide({
      starting: state.starting, startingKey: state.startingKey, running: state.running, loopKey: state.loopKey, injecting: state.injecting,
      started: state.started, key: provider.conversationKey(), chatEmpty: provider.chatIsEmpty(), markerInDom,
    });
    const loopKeyBefore = state.loopKey;
    let decision = decide();
    if (decision.startingKey !== undefined) state.startingKey = decision.startingKey;
    if (decision.loopKey !== undefined) state.loopKey = decision.loopKey;
    if (decision.abandonStart) {
      // The start in flight bails at its next checkpoint (its generation is dead) and its own cleanup is gated on that, so it would
      // never lift the cover: lift it here, or it sticks on the fresh chat.
      state.startGen++;
      state.starting = false;
      provider.setInputLock(false);
      bar.cover(false);
      decision = decide(); // no longer starting: the new chat's own state is computed in the same pass
    }
    if (decision.abandonLoop) {
      diag("loop.abandonedNewChat", { from: loopKeyBefore, to: provider.conversationKey() });
      state.stop = true; // the loop breaks at its next checkpoint; its cleanup resets the flags, cover and lock
    }
    if (decision.started !== undefined) state.started = decision.started;
    tools.workspace.settle();
    bar.render();
  }

  /**
   * The user says this open conversation is a session the extension lost track of (it was reinstalled, or the chat began
   * long before). Nothing is sent: the chat keeps its history and the next Play reads its last reply, so a batch that was
   * cut off is carried on instead of a whole start message being repeated.
   */
  async function adopt() {
    if (state.started || state.starting || state.running || state.injecting) return;
    // The tracker writes its whole remembered set; adopting before the saved set is loaded would overwrite it.
    await tracker.ready;
    const chatEmpty = provider.chatIsEmpty();
    if (!tracker.adopt(provider.conversationKey(), { chatEmpty })) {
      bar.toast(chatEmpty ? "Use Start on an empty chat." : "Send a message first · this chat has no id yet");
      return;
    }
    // A halt or a Stop from an earlier attempt must not hold the resumed conversation back.
    state.userStopped = false;
    state.stop = false;
    state.started = true;
    bar.render();
    bar.toast("Agent on in this chat · ▶ reads the last reply");
  }

  tracker.ready.then(sync);

  return { start: () => starter.start(), previewStartMessage: () => starter.preview(), adopt, sync };
}
