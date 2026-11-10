import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { barGeometry, floatingStopGeometry, positionOf, toggleGeometry } from "../src/ui/bar-placement.js";

const viewport = { width: 1000, height: 800 };
const bar = { width: 210, height: 300 };

describe("bar placement", () => {
  test("positionOf keeps only a pair of numbers", () => {
    assert.deepEqual(positionOf({ left: 5, top: 9, corner: "top" }), { left: 5, top: 9 });
    for (const bad of [null, undefined, {}, { left: null, top: null }, { left: "1", top: 2 }]) assert.equal(positionOf(bad), null, JSON.stringify(bad));
  });

  test("without a saved position the button is in the bottom right corner and the bar opens above it", () => {
    const t = toggleGeometry(viewport, null);
    const g = barGeometry(viewport, bar, null);
    assert.deepEqual(t, { left: 950, top: 750 });
    assert.ok(g.top + bar.height < t.top, "the bar ends above the button");
    assert.equal(g.left + bar.width, t.left + 34, "its right edge lines up with the button's");
  });

  test("a button in the upper half opens the bar below it", () => {
    const t = toggleGeometry(viewport, { left: 500, top: 100 });
    const g = barGeometry(viewport, bar, { left: 500, top: 100 });
    assert.ok(g.top > t.top + 34);
    const stop = floatingStopGeometry(viewport, { width: 34, height: 34 }, { left: 500, top: 100 });
    assert.ok(stop.top > t.top + 34, "the floating Stop goes under it");
  });

  test("a dropped position is kept inside the window, whatever the window's size now", () => {
    assert.deepEqual(toggleGeometry(viewport, { left: -50, top: 5000 }), { left: 0, top: 766 });
    assert.deepEqual(toggleGeometry({ width: 300, height: 300 }, { left: 900, top: 10 }), { left: 266, top: 10 });
  });

  test("near the left edge the bar stays inside the window", () => {
    const g = barGeometry(viewport, bar, { left: 0, top: 400 });
    assert.ok(g.left >= 0);
  });

  test("the bar never gets less height than the minimum", () => {
    const g = barGeometry({ width: 1000, height: 100 }, bar, { left: 500, top: 10 });
    assert.ok(g.maxHeight >= 40);
  });
});
