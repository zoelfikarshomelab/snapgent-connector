// SPDX-License-Identifier: GPL-3.0-or-later
// The window where the person answers a question ssh asked: a passphrase (typed hidden), a yes/no about a host seen for the first time, or
// a notice. It belongs to the extension, not to a chat page, so no site script can read what is typed here. What ssh says is shown as
// plain text, never as markup.

import { promptView } from "../domain/ssh/prompt-view.js";

const ask = (runtime, message) => new Promise((resolve) => {
  try {
    runtime.sendMessage(message, (reply) => resolve(reply || { ok: false, error: "no response" }));
  } catch (error) {
    resolve({ ok: false, error: String((error && error.message) || error) });
  }
});

/** @param {{ document: Document, runtime: { sendMessage: Function }, promptId: string, close?: () => void }} deps */
export async function mountSshPrompt({ document, runtime, promptId, close = () => document.defaultView.close() }) {
  const root = document.getElementById("app");
  const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
  const info = await ask(runtime, { type: "ssh_prompt_get", prompt_id: promptId });
  root.textContent = "";
  if (!info.ok) {
    root.append(el("p", { className: "text", textContent: info.error || "This question is no longer waiting." }), el("button", { type: "button", className: "cancel", textContent: "Close", onclick: close }));
    return { answered: false };
  }

  const view = promptView(info);
  const input = view.secret ? el("input", { type: "password", className: "secret", autocomplete: "off", spellcheck: false }) : null;
  if (input) input.setAttribute("aria-label", "Answer");
  let done = false;
  const reply = async (value) => {
    if (done) return; // one answer only, whatever is pressed next
    done = true;
    if (input) input.value = "";
    await ask(runtime, { type: "ssh_prompt_answer", prompt_id: promptId, answer: value });
    close();
  };

  const ok = el("button", { type: view.confirm ? "button" : "submit", className: "ok", textContent: view.ok });
  const cancel = el("button", { type: "button", className: "cancel", textContent: view.cancel });
  if (view.confirm) {
    ok.onclick = () => reply("yes");
    cancel.onclick = () => reply("no");
  } else {
    cancel.onclick = () => reply(null);
  }
  const form = el("form", {});
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!view.confirm) reply(input ? input.value : "");
  });
  form.append(...(input ? [input] : []), el("div", { className: "buttons" }));
  form.lastChild.append(cancel, ok);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") reply(null); });

  root.append(el("h1", { textContent: view.title }), el("p", { className: "text", textContent: view.text }), form);
  if (input) input.focus();
  return { answered: false };
}
