// SPDX-License-Identifier: GPL-3.0-or-later
// How a question that ssh asked (through the bridge) is worded for the person: what it is called, whether the answer is typed hidden,
// and which buttons it has. Pure: a message in, a description out.

export const MAX_PROMPT_CHARS = 2000;
const KINDS = ["secret", "confirm", "info"];

/** The parts of a bridge `ssh_prompt` message that are used, cut to a sane size. An unknown kind is a secret: hidden is the safe way to be wrong. */
export function promptInfo(message) {
  const source = message && typeof message === "object" ? message : {};
  return {
    id: typeof source.prompt_id === "string" ? source.prompt_id : "",
    kind: KINDS.includes(source.kind) ? source.kind : "secret",
    label: String(source.label || "").slice(0, 200),
    text: String(source.text || "").slice(0, MAX_PROMPT_CHARS),
  };
}

/** What the window shows for a question: its title, its words, whether the answer is hidden, and what the two buttons say. */
export function promptView(info) {
  const confirm = info.kind === "confirm";
  return { title: info.label ? `SSH · ${info.label}` : "SSH", text: info.text, secret: info.kind === "secret", confirm, ok: confirm ? "Yes" : "OK", cancel: confirm ? "No" : "Cancel" };
}
