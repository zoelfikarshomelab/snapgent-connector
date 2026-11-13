// SPDX-License-Identifier: GPL-3.0-or-later
// The user's preferences that the preferences panel edits: how big one message may be, how many commands one reply may carry, how
// long the agent waits between commands, which folders are left out of the files that can be attached, and the wording of the
// messages the extension sends to the AI. All are kept in the extension's storage, the same on every site; the message size and
// the command count are read by message-budget.js from the same keys.

import { DEFAULT_BATCH_CALLS, DEFAULT_EXCLUDED_FOLDERS, clampBatchCalls, clampExcludedFolders, clampPromptChars } from "../domain/index.js";
import { clampContextFiles, DEFAULT_CONTEXT_FILES } from "../domain/prompt/context-file.js";
import { clampTemplates, DEFAULT_TEMPLATES } from "../domain/prompt/templates.js";
import { clampDelaySeconds, DEFAULT_DELAY_SECONDS } from "../domain/tools/delay.js";

export const KEYS = { chars: "zsMaxPromptChars", calls: "zsMaxBatchCalls", folders: "zsExcludedFolders", contextFiles: "zsContextFiles", asFile: "zsOutputAsFile", startContext: "zsStartContext", startTree: "zsStartTree", templates: "zsTemplates", delay: "zsCommandDelay", randomDelay: "zsRandomDelay" };

/** @param {{ storage: object, state: object }} deps  `state.filesChangedAt` is bumped when the excluded folders change: the file list is then out of date */
export function createPreferences({ storage, state, defaults }) {
  const defaultFolders = defaults && Array.isArray(defaults.excludedFolders) ? defaults.excludedFolders : DEFAULT_EXCLUDED_FOLDERS;
  const defaultContextFiles = defaults && Array.isArray(defaults.contextFiles) ? defaults.contextFiles : DEFAULT_CONTEXT_FILES;
  let folders = [...defaultFolders];
  const load = (saved) => { folders = clampExcludedFolders(saved, defaultFolders); };
  storage.get(KEYS.folders).then(load);
  storage.watch(KEYS.folders, (saved) => { load(saved); state.filesChangedAt = Date.now(); });

  let contextFiles = [...defaultContextFiles];
  const loadContext = (saved) => { contextFiles = clampContextFiles(saved, defaultContextFiles); };
  storage.get(KEYS.contextFiles).then(loadContext);
  storage.watch(KEYS.contextFiles, loadContext);

  let asFile = false;
  storage.get(KEYS.asFile).then((saved) => { asFile = saved === true; });
  storage.watch(KEYS.asFile, (saved) => { asFile = saved === true; });

  // What the start message carries: both parts are on until the user switches them off.
  let startContext = true;
  let startTree = true;
  storage.get(KEYS.startContext).then((saved) => { startContext = saved !== false; });
  storage.watch(KEYS.startContext, (saved) => { startContext = saved !== false; });
  storage.get(KEYS.startTree).then((saved) => { startTree = saved !== false; });
  storage.watch(KEYS.startTree, (saved) => { startTree = saved !== false; });

  // The wording of the messages the extension sends to the AI.
  let templates = clampTemplates();
  storage.get(KEYS.templates).then((saved) => { templates = clampTemplates(saved); });
  storage.watch(KEYS.templates, (saved) => { templates = clampTemplates(saved); });

  // How long the agent waits: after every command, and a random one after the last of them.
  let delay = DEFAULT_DELAY_SECONDS;
  let randomDelay = DEFAULT_DELAY_SECONDS;
  storage.get(KEYS.delay).then((saved) => { delay = clampDelaySeconds(saved); });
  storage.watch(KEYS.delay, (saved) => { delay = clampDelaySeconds(saved); });
  storage.get(KEYS.randomDelay).then((saved) => { randomDelay = clampDelaySeconds(saved); });
  storage.watch(KEYS.randomDelay, (saved) => { randomDelay = clampDelaySeconds(saved); });

  return {
    /** Whether a message over the size goes to the chat as a file (the general value; an AI's calibration may set its own). */
    asFile: () => asFile,
    setAsFile(value) { asFile = value === true; storage.set(KEYS.asFile, asFile); },
    /** Whether the first file found among the project instruction files goes into the start message. */
    startContext: () => startContext,
    setStartContext(value) { startContext = value === true; storage.set(KEYS.startContext, startContext); },
    /** Whether the project tree goes into the start message. */
    startTree: () => startTree,
    setStartTree(value) { startTree = value === true; storage.set(KEYS.startTree, startTree); },
    /** The folder names to leave out of the attachable files, as saved (the defaults until the user changes them). */
    excludedFolders: () => folders,
    /** The wording of the messages the extension sends to the AI. */
    templates: () => templates,
    setTemplates(value) { templates = clampTemplates(value); storage.set(KEYS.templates, templates); },
    /** The pause after every command, in seconds. */
    delay: () => delay,
    setDelay(value) { delay = clampDelaySeconds(value); storage.set(KEYS.delay, delay); },
    /** The most the random pause after the last command of a reply may be, in seconds. */
    randomDelay: () => randomDelay,
    setRandomDelay(value) { randomDelay = clampDelaySeconds(value); storage.set(KEYS.randomDelay, randomDelay); },
    /** What the panel shows. */
    async read() {
      const [chars, calls, saved, savedContext, savedAsFile, savedStartContext, savedStartTree, savedTemplates, savedDelay, savedRandomDelay] = await Promise.all([storage.get(KEYS.chars), storage.get(KEYS.calls), storage.get(KEYS.folders), storage.get(KEYS.contextFiles), storage.get(KEYS.asFile), storage.get(KEYS.startContext), storage.get(KEYS.startTree), storage.get(KEYS.templates), storage.get(KEYS.delay), storage.get(KEYS.randomDelay)]);
      return { chars: clampPromptChars(chars), calls: clampBatchCalls(calls ?? DEFAULT_BATCH_CALLS), asFile: savedAsFile === true, folders: clampExcludedFolders(saved, defaultFolders), contextFiles: clampContextFiles(savedContext, defaultContextFiles), startContext: savedStartContext !== false, startTree: savedStartTree !== false, templates: clampTemplates(savedTemplates), delay: clampDelaySeconds(savedDelay), randomDelay: clampDelaySeconds(savedRandomDelay) };
    },
    setChars: (value) => storage.set(KEYS.chars, clampPromptChars(value)),
    setCalls: (value) => storage.set(KEYS.calls, clampBatchCalls(value)),
    setFolders(list) {
      folders = clampExcludedFolders(list, defaultFolders);
      state.filesChangedAt = Date.now();
      storage.set(KEYS.folders, folders);
    },
    setContextFiles(list) {
      contextFiles = clampContextFiles(list, defaultContextFiles);
      storage.set(KEYS.contextFiles, contextFiles);
    },
    contextFiles: () => contextFiles,
    defaultFolders: () => [...defaultFolders],
    defaultContextFiles: () => [...defaultContextFiles],
    defaultTemplates: () => ({ ...DEFAULT_TEMPLATES }),
  };
}
