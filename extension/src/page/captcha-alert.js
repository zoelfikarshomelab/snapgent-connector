// SPDX-License-Identifier: GPL-3.0-or-later
// Plays a sound when the site's bot check (the "captcha" part of the calibration) shows up, so the user notices it and solves it
// by hand. Sound only: it never touches the puzzle. It repeats while the puzzle stays, until it is gone.

function defaultBeep(win) {
  let ctx = null;
  return () => {
    const Ctor = win.AudioContext || win.webkitAudioContext;
    if (!Ctor) return;
    ctx = ctx || new Ctor();
    if (ctx.state === "suspended") ctx.resume();
    const t = ctx.currentTime;
    for (const offset of [0, 0.25, 0.5]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.value = 0.25;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t + offset);
      osc.stop(t + offset + 0.15);
    }
  };
}

/**
 * @param {{ provider: object, window: Window, toast?: (text: string) => void, diag?: Function, beep?: () => void,
 *           now?: () => number, intervalMs?: number, repeatMs?: number }} deps
 * @returns {{ start: () => void, stop: () => void, tick: () => boolean }}
 */
export function createCaptchaAlert({ provider, window, toast = () => {}, diag = () => {}, beep = defaultBeep(window), now = Date.now, intervalMs = 1000, repeatMs = 4000 }) {
  let was = false;
  let lastBeep = 0;
  let timer = null;

  function tick() {
    let present = false;
    try { present = !!(provider.captchaPresent && provider.captchaPresent()); } catch { /* the page is changing */ }
    if (present) {
      if (!was) { diag("captcha.appeared", {}); toast("Bot check detected: solve the puzzle."); }
      if (!was || now() - lastBeep >= repeatMs) {
        lastBeep = now();
        try { beep(); } catch { /* no audio here */ }
      }
    }
    was = present;
    return present;
  }

  return {
    start() { if (!timer) timer = window.setInterval(tick, intervalMs); },
    stop() { if (timer) { window.clearInterval(timer); timer = null; } },
    tick,
  };
}
