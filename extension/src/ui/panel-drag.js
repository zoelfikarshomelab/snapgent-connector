// SPDX-License-Identifier: GPL-3.0-or-later
// Resizing (bottom-left grip) and moving (drag handle) of the terminal panel; it only changes the panel's own position and size.

export function attachPanelDrag({ document, panel }) {
  // The panel is anchored at the top-right, so its bottom-left grip is the only corner that can grow
  // in both directions: left widens it, down makes it taller. Never larger than the window.
  const gripEl = panel.querySelector(".zs-t-grip");
  const MIN_W = 320;
  const MIN_H = 200;
  // After the panel was moved, the top and right edges stay where they are while resizing (as in the Files window).
  let drag = null;
  gripEl.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const rect = panel.getBoundingClientRect();
    const view = document.documentElement;
    drag = { x: event.clientX, y: event.clientY, w: rect.width, h: rect.height, right: rect.right, top: rect.top };
    panel.style.left = "auto";
    panel.style.bottom = "auto";
    panel.style.right = `${Math.round(view.clientWidth - rect.right)}px`;
    panel.style.top = `${Math.round(rect.top)}px`;
    if (gripEl.setPointerCapture) gripEl.setPointerCapture(event.pointerId);
    panel.classList.add("zs-t-resizing");
  });
  gripEl.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const view = document.documentElement;
    const width = Math.min(drag.right, Math.max(MIN_W, drag.w + (drag.x - event.clientX)));
    const height = Math.min(view.clientHeight - drag.top, Math.max(MIN_H, drag.h + (event.clientY - drag.y)));
    panel.style.width = `${Math.round(width)}px`;
    panel.style.height = `${Math.round(height)}px`;
  });
  const endDrag = () => { drag = null; panel.classList.remove("zs-t-resizing"); };
  gripEl.addEventListener("pointerup", endDrag);
  gripEl.addEventListener("pointercancel", endDrag);

  // Moving: the handle in the bottom-right corner sets left/top, so a dragged panel stays where it was dropped.
  const moveEl = panel.querySelector(".zs-t-drag");
  let move = null;
  moveEl.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const rect = panel.getBoundingClientRect();
    move = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
    if (moveEl.setPointerCapture) moveEl.setPointerCapture(event.pointerId);
    panel.classList.add("zs-t-resizing");
  });
  moveEl.addEventListener("pointermove", (event) => {
    if (!move) return;
    const view = document.documentElement;
    const left = Math.min(Math.max(0, move.left + event.clientX - move.x), Math.max(0, view.clientWidth - panel.offsetWidth));
    const top = Math.min(Math.max(0, move.top + event.clientY - move.y), Math.max(0, view.clientHeight - panel.offsetHeight));
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  });
  const endMove = () => { move = null; panel.classList.remove("zs-t-resizing"); };
  moveEl.addEventListener("pointerup", endMove);
  moveEl.addEventListener("pointercancel", endMove);
}
