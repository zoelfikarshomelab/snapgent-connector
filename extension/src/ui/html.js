// SPDX-License-Identifier: GPL-3.0-or-later
// HTML escaping for strings that end up inside HTML templates, and the two ways templates are put on the page.

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ENTITIES[char]);

// The nodes of a template, parsed in a document of their own: nothing in it runs and nothing is on the page until the caller
// adds the nodes. The explicit <body> keeps a leading <style> in the body instead of the head. Callers escape every dynamic
// value with escapeHtml first: this is parsing, not sanitising.
const nodesOf = (el, html) => {
  const doc = el.ownerDocument;
  const Parser = (doc.defaultView || globalThis).DOMParser;
  const parsed = new Parser().parseFromString(`<!DOCTYPE html><body>${html}`, "text/html");
  return Array.from(parsed.body.childNodes, (node) => doc.importNode(node, true));
};

/** Replace the children of `el` with the nodes of an HTML template. */
export function setHtml(el, html) {
  el.replaceChildren(...nodesOf(el, html));
}

/** Add the nodes of an HTML template at the end of `el`. */
export function appendHtml(el, html) {
  el.append(...nodesOf(el, html));
}
