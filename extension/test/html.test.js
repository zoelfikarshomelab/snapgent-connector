import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { appendHtml, escapeHtml, setHtml } from "../src/ui/html.js";

const doc = () => new JSDOM("<body></body>").window.document;

describe("setHtml and appendHtml", () => {
  test("setHtml replaces what was there", () => {
    const el = doc().createElement("div");
    el.innerHTML = "<i>old</i>";
    setHtml(el, '<b class="a">new</b><span>x</span>');
    assert.equal(el.querySelector("i"), null);
    assert.equal(el.children.length, 2);
    assert.equal(el.querySelector(".a").textContent, "new");
  });

  test("a template that starts with <style> keeps it inside the target, also in a shadow root", () => {
    const host = doc().createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    setHtml(shadow, "<style>p { color: red; }</style><p>hi</p>");
    assert.ok(shadow.querySelector("style"));
    assert.equal(shadow.querySelector("p").textContent, "hi");
  });

  test("appendHtml keeps the existing children and adds at the end", () => {
    const el = doc().createElement("div");
    setHtml(el, "<p>one</p>");
    appendHtml(el, "<p>two</p>");
    assert.deepEqual([...el.children].map((child) => child.textContent), ["one", "two"]);
  });

  test("an escaped value stays text", () => {
    const el = doc().createElement("div");
    setHtml(el, `<p>${escapeHtml("<img src=x onerror=1>")}</p>`);
    assert.equal(el.querySelector("img"), null);
    assert.equal(el.querySelector("p").textContent, "<img src=x onerror=1>");
  });
});
