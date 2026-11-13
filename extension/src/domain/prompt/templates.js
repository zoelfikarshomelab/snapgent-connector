// SPDX-License-Identifier: GPL-3.0-or-later
// The texts the extension sends to the AI, written the way a person would write them in a chat: the first message of a session,
// the reminder under a result, the answer of a command that worked, the report of one that failed, and the note that repeats the
// instructions in a long conversation.
//
// Every one of them is a template the user can rewrite in the preferences. The extension fills the placeholders and leaves out a
// paragraph whose value is empty, so an optional part (the project tree, the instruction file) simply does not appear when there
// is nothing to show. Pure: a template in, text out.

/** The templates there are, in the order the preferences panel shows them. */
export const TEMPLATE_NAMES = ["start", "reminder", "result", "error", "resend"];

/** What each template may use. Anything else is left empty. */
export const PLACEHOLDERS = {
  start: ["project", "where", "target", "commands", "tree", "instructions", "instructions_file", "calls", "skills", "notes", "extra", "ask"],
  reminder: ["target", "commands", "calls"],
  result: ["command", "name", "output"],
  error: ["command", "name", "error", "example"],
  resend: ["brief", "project", "target"],
};

const ASK = 'If that is all clear, just reply "understood" and wait. Do not run anything yet: I will tell you what I want to do.';

export const DEFAULT_TEMPLATES = {
  start: `Hi. {{project}} is your current workspace.

{{where}}

You and I are working on it together: you look at the files, change them and run commands for me, and everything you run comes back to you here.

The instructions I keep for this project (from {{instructions_file}}):
{{instructions}}

Skills I keep in this project (reusable instructions: read a skill's SKILL.md with read_files first when a task matches one, and never run its scripts without asking me):
{{skills}}

I have an MCP server ({{target}}) running for this chat, so you can work in the project instead of only telling me what to do. Nothing of yours reaches my machine on its own, so everything you know about the project has to come from the commands below:

These are the commands you can use:
{{commands}}

This is what the project looks like (junk folders such as node_modules and .git are left out):
{{tree}}

A note about this chat site:
{{notes}}

Something more from me:
{{extra}}

Whenever you want something done, write the command as its own fenced JSON block in your reply:

\`\`\`json
{"command":"exact_command_name","params":{"key":"value"}}
\`\`\`

It runs here in {{project}}, and what it returned comes back in my next message, each answer naming the command it came from. Use only the commands and parameters listed for you. If one you need is missing, or something is offline, say so plainly instead of claiming the task is done.

A few habits that keep this quick and cheap:
- You may write {{calls}} in one reply, each in its own fenced JSON block. They run in order and you get ONE message back with every result. Group commands that do not depend on each other (for example \`tree\` and a \`read_files\` of files you already know you need). If a command needs the result of an earlier one, wait for that result instead. A failing command stops the rest of the group.
- Everything sent back to you shares one size limit. Output that is too long is cut in the middle (the start and the end are kept); files or commands that do not fit are listed as not read / not run, so ask for them in your next reply. Prefer a few targeted commands over reading everything.
- A long command output reaches you as a preview: only its first and last lines, with a note in the middle that says how many lines were left out. That note has a run_id: use \`get_command_output\` with it to read the whole log, or only more of the end with a negative start_line (for example -200 when something failed), rather than running the command again.
- When my message ends with "Attached files" and \`===== path =====\` blocks, those are files I tagged, with line numbers, as they are right now: use them directly and do not read them again unless you need more than is shown.
- To explore, start from the project tree, then \`read_files\` with several related files in one call. Do not read files one at a time when a bulk read is possible. When read_files offers a relations option, its footer (the chain of files each one calls into, with their line ranges) comes by default: use it to find what to read next, then read just the pieces you need with ranges instead of whole files, and pass \`relations: false\` when you re-read something you already have the footer for.
- Stay inside the folder and the files I ask about, and never make broad or destructive changes without asking me first.
- If a command fails, use the error to adjust the next one, and never pretend it worked.
- Write each command as a JSON block like the one above, not as a native function call.
- When you are done, sum up briefly what you did.

{{ask}}`,

  reminder: `A quick reminder, not a new task and nothing to answer: these are the commands you can use ({{target}}), with their exact names and parameters.

{{commands}}

You may write {{calls}} in one reply; they run in order and are answered in one message.`,

  result: `I ran \`{{command}}\` for you. Here is what came back:

{{output}}`,

  error: `The command \`{{command}}\` did not work:

{{error}}

Here is how that command should be written, so that it runs:

{{example}}`,

  resend: `A note from me, not a new task: there is nothing to answer here. In a long chat this can get lost, so here is how we are working together once more. The commands do run on my machine, and what they return is what you have been getting from me. Just carry on with the task; do not acknowledge this note.

{{brief}}`,
};

const PLACEHOLDER = /\{\{\s*([a-z_]+)\s*\}\}/g;

/**
 * Fill the placeholders of a template.
 * A paragraph that holds an empty value is left out, unless it still says something of its own (a label ending in a colon goes
 * with its value, so it goes too).
 * @param {string} template
 * @param {Record<string, string>} values
 * @returns {string}
 */
export function renderTemplate(template, values = {}) {
  const blocks = String(template || "").split(/\n\s*\n/);
  const kept = [];
  for (const block of blocks) {
    const rendered = renderBlock(block, values);
    if (rendered !== null) kept.push(rendered);
  }
  return kept.join("\n\n").trim();
}

function renderBlock(block, values) {
  let empty = false;
  const filled = block.replace(PLACEHOLDER, (_, key) => {
    const value = values ? values[key] : undefined;
    if (value === undefined || value === null || String(value).trim() === "") {
      empty = true;
      return "";
    }
    return String(value);
  });
  if (!empty) return filled.trim();
  const rest = filled.trim();
  if (!rest || rest.endsWith(":")) return null;
  return rest;
}

/**
 * The templates to use: the ones the user saved, and the default for every template they left empty (an empty template would
 * leave the AI without the instructions it needs).
 * @param {unknown} saved
 * @returns {Record<string, string>}
 */
export function clampTemplates(saved) {
  const given = saved && typeof saved === "object" ? saved : {};
  const out = {};
  for (const name of TEMPLATE_NAMES) {
    const value = typeof given[name] === "string" ? given[name] : "";
    out[name] = value.trim() ? value : DEFAULT_TEMPLATES[name];
  }
  return out;
}

/** The closing line of the start message: the model is asked to answer with one word and wait. */
export const askLine = () => ASK;

/** The list of placeholders a template may use, as one line for the preferences panel. */
export const placeholderList = (name) => (PLACEHOLDERS[name] || []).map((key) => `{{${key}}}`).join(" ");

/**
 * Example values for a template, so the preferences panel can show what the message looks like without running anything.
 */
export function sampleValues(name) {
  return {
    start: {
      project: "snapgent-connector",
      where: "It is at /home/me/snapgent-connector, and it is a git repository.",
      target: "VS Code",
      commands: "read_files(paths) - Read files as bulk text\ntree(path) - Show a filtered tree of the workspace",
      tree: "snapgent-connector\n├── extension\n└── server",
      instructions: "use pnpm, never npm",
      instructions_file: "AGENTS.md",
      calls: "at most 5 commands",
      ask: ASK,
    },
    reminder: {
      target: "VS Code",
      commands: "read_files(paths) - Read files as bulk text\ntree(path) - Show a filtered tree of the workspace",
      calls: "at most 5 commands",
    },
    result: {
      command: "tree .",
      name: "tree",
      output: "snapgent-connector\n├── extension\n│   └── src\n└── server",
    },
    error: {
      command: "tree .",
      name: "tree",
      error: "the folder /nope does not exist.",
      example: '{"command":"tree","params":{"path":"."}}',
    },
    resend: {
      brief: "the instructions again, in full",
      project: "snapgent-connector",
      target: "VS Code",
    },
  }[name] || {};
}
