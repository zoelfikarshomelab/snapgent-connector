// SPDX-License-Identifier: GPL-3.0-or-later
// Where the control bar sits: next to a small button that shows or hides it, and that the user can drag anywhere in the window.
// Without a saved position the button is in the bottom right corner. The bar opens above the button when the button is in the
// lower half of the window and below it when it is in the upper half. It never attaches to the site's text box, so nothing about a
// site's layout can squeeze, cover or hide it. Pure geometry: rectangles in, pixel numbers out.

export const BAR_WIDTH = 210;
const MARGIN = 16;
const EDGE = 4;          // the least room kept between the bar and the window's edge
const TOGGLE = 34;       // the show/hide button's size
const TOGGLE_GAP = 8;
const MIN_HEIGHT = 40;

const clamp = (value, min, max) => Math.min(Math.max(value, min), Math.max(min, max));

/** A stored position of the button ({ left, top } in pixels), or null when there is none (or it is not numbers). */
export const positionOf = (value) => (value && Number.isFinite(value.left) && Number.isFinite(value.top) ? { left: value.left, top: value.top } : null);

/** The show/hide button: where the user dropped it (kept inside the window), else the bottom right corner. @returns {{ left: number, top: number }} */
export function toggleGeometry(viewport, pos) {
  if (!pos) return { left: Math.round(viewport.width - TOGGLE - MARGIN), top: Math.round(viewport.height - TOGGLE - MARGIN) };
  return {
    left: Math.round(clamp(pos.left, 0, viewport.width - TOGGLE)),
    top: Math.round(clamp(pos.top, 0, viewport.height - TOGGLE)),
  };
}

/** True when the bar opens below the button: the button sits in the upper half of the window. */
const opensBelow = (viewport, t) => t.top + TOGGLE / 2 < viewport.height / 2;

/**
 * The Stop button that stands in for the hidden bar: right above the show/hide button, or right under it when the button is in the
 * upper half, its right edge in line with the button's.
 * @returns {{ left: number, top: number }}
 */
export function floatingStopGeometry(viewport, size, pos) {
  const t = toggleGeometry(viewport, pos);
  const width = size.width || 90;
  const height = size.height || 32;
  return {
    left: Math.round(clamp(t.left + TOGGLE - width, EDGE, viewport.width - width - EDGE)),
    top: opensBelow(viewport, t) ? t.top + TOGGLE + TOGGLE_GAP : Math.max(EDGE, t.top - TOGGLE_GAP - height),
  };
}

/**
 * The bar, a narrow column above the button or below it, its right edge in line with the button's (moved left when that would push
 * it out of the window).
 * @returns {{ left: number, top: number, maxHeight: number }}
 */
export function barGeometry(viewport, barSize, pos) {
  const t = toggleGeometry(viewport, pos);
  const below = opensBelow(viewport, t);
  const width = barSize.width || BAR_WIDTH;
  const height = barSize.height || MIN_HEIGHT;
  const room = below ? viewport.height - (t.top + TOGGLE + TOGGLE_GAP) - EDGE : t.top - TOGGLE_GAP - EDGE;
  const maxHeight = Math.max(MIN_HEIGHT, room);
  const shown = Math.min(height, maxHeight);
  return {
    left: Math.round(clamp(t.left + TOGGLE - width, EDGE, viewport.width - width - EDGE)),
    top: Math.round(below ? t.top + TOGGLE + TOGGLE_GAP : t.top - TOGGLE_GAP - shown),
    maxHeight,
  };
}
