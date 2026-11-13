// SPDX-License-Identifier: GPL-3.0-or-later
// The words the extension sends back to the model: why a command did not work, and the few notes that ride along with a result.
// They are the reason inside the messages; the wording around them is the user's (see domain/prompt/templates.js). Pure data.

import { closestName } from "../tools/closest-name.js";

// Feedback sent back to the model so it can self-correct.
export const FEEDBACK = {
  // A command-shaped reply that could not be turned into a runnable call.
  // The failures are DIFFERENT problems, so the note is tailored per `reason`
  // to tell the model exactly what to fix (a generic "bad JSON" was misleading
  // for the non-JSON cases). Falls back to the generic "malformed" text for any
  // unrecognised reason.
  parseError: (reason) => {
    const notes = {
      malformed:
        "the command in your reply could not be read: its JSON is not valid. " +
        'Write it again as one plain JSON object, exactly like {"command": "name", "params": {...}}. ' +
        "You may add a short note around it.",
      unclosed:
        "the command in your reply was cut off before it finished, so it could not run. Write the WHOLE command " +
        "again in one piece as one plain JSON object, exactly like " +
        '{"command": "name", "params": {...}}.',
      envelope:
        "you wrote a command's parameters as a bare JSON object, without the envelope around them, so it was not read as " +
        "a command. Wrap them like " +
        '{"command": "name", "params": { ...your parameters... }} - the parameter keys go INSIDE ' +
        '"params".',
      // The model named a REAL tool but under the wrong key - it wrote the call
      // the way a function-calling API would (e.g. {"toolName": "read_file",
      // "file": "..."}) instead of snapgent's envelope. Seen live on
      // ChatGPT in a long session. Naming the wrong keys explicitly matters: a
      // generic "bad JSON" note made the model rewrite the SAME shape.
      toolKey:
        "you used the wrong key to name the command, so it was not read and did not run. The key must be exactly " +
        '"command" - not "toolName", "tool", "name", "function" or "action" - and every argument goes INSIDE "params", like ' +
        '{"command": "name", "params": { ...your parameters... }}.',
      // DeepSeek sometimes falls back to its own native agentic markup. The
      // note must NEVER quote the markers literally: the reply that follows
      // often echoes the wording, and a quoted marker would re-trigger the
      // detector and loop the error forever. Describe it, don't reproduce it.
      dsml:
        "you wrote that call in your own internal tool-call markup (the DSML invoke/parameter " +
        "tags), which I cannot read, so the command did not run. Never use those tags here. Write the call as one " +
        'plain-text JSON object instead, exactly like {"command": "name", "params": { ...your parameters... }}.',
    };
    return notes[reason] || notes.malformed;
  },
  // Appended to the results of calls that were written in the model's own markup. Like `dsml` above it describes that markup and
  // never quotes it: a quoted marker in a user turn is echoed back by the model.
  nativeFormat:
    "\n\n(A note from me: the commands above were written in your own internal tool-call markup. They were run this time, but do not " +
    "use that markup or any internal tool of your own here. Call my commands instead, as one plain-text JSON " +
    'object: {"command": "name", "params": { ...your parameters... }}.)',
  // Appended to the result of a reply that held ONE command while more are allowed: the model drifts into one command per reply and
  // the user had to remind it every time. `max` is the effective Commands per reply.
  singleCommand: (max) =>
    `\n\n(A note from me: your last reply held a single command. You may write up to ${max} commands in one reply; they run in order and are ` +
    "answered in one message, so put commands that do not depend on each other in the same reply.)",
  // The editor has no folder open, so the server offers no commands. Said to the model instead of a list of no valid commands.
  workspaceClosed: (folder) =>
    `no project folder is open in the user's editor right now, so no command can run${folder ? ` (this chat works in ${folder})` : ""}. ` +
    "Do NOT retry. Tell the user to open that folder in their editor (VS Code or Antigravity), then continue.",
  unknownTool: (name, valid) =>
    `there is no command called "${name}". It does not exist. ` +
    (closestName(valid, name) ? `Did you mean "${closestName(valid, name)}"? Its parameter names may differ too, so check them. ` : "") +
    "The commands there are: " +
    valid.join(", ") +
    ". Use an exact name and the parameter keys from the list.",
  // The page outlived the extension build it was running (reload / auto-update
  // / disable+enable). Nothing here can recover it - only a page reload can -
  // so the model must NOT be told the bridge is down and must NOT retry, or it
  // burns the whole conversation re-issuing commands that can never run. See
  // createExtensionBridge (src/page/extension-bridge.js).
  staleExtension:
    "the extension was reloaded or updated while this page was open, so this " +
    "tab is running a version of it that no longer exists and NO command can reach the user's " +
    "machine from here. The bridge and the editor are NOT the problem - do not tell the user " +
    "to check them, and do not retry the command, because every retry will fail the same way. " +
    "Tell the user in one short sentence to RELOAD THIS PAGE (F5), then stop and wait.",
  bridgeOffline:
    "the local bridge is unreachable, so no command could run. " +
    "This is an environment problem on the user's machine (the bridge is not " +
    "running), NOT your mistake. Tell the user in " +
    "one short sentence that the bridge is offline, then stop " +
    "sending commands until they confirm it is back.",
  truncated:
    "(A note from me: your previous reply was cut off by a length limit before you " +
    "finished. Continue from exactly where you stopped. Do NOT restart and do " +
    "NOT repeat what you already wrote.)",
};
