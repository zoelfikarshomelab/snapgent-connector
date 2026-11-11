// SPDX-License-Identifier: GPL-3.0-or-later
// Plays a sound when the site's bot check (the "captcha" part of the calibration) shows up, so the user notices it and solves it
// by hand. Sound only: it never touches the puzzle. It repeats while the puzzle stays, until it is gone.

export function defaultBeep(win) {
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
// hCaptcha's puzzle frame: found without any calibration, so the pause works on a site that was never calibrated too.
const HCAPTCHA_FRAME = 'iframe[src*="hcaptcha.com"][src*="frame=challenge"]';

export function createCaptchaAlert({ provider, window, document = null, state = null, toast = () => {}, diag = () => {}, beep = defaultBeep(window), now = Date.now, intervalMs = 500, repeatMs = 4000 }) {
  let was = false;
  let lastBeep = 0;
  let timer = null;

  function builtInPresent() {
    if (!document) return false;
    try {
      return [...document.querySelectorAll(HCAPTCHA_FRAME)].some((el) => {
        if (!el.isConnected || !el.getClientRects().length) return false;
        if (typeof el.checkVisibility === "function" && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
        const box = el.getBoundingClientRect();
        return box.width > 50 && box.height > 50;
      });
    } catch { return false; }
  }

  function tick() {
    let present = false;
    try { present = !!(provider.captchaPresent && provider.captchaPresent()); } catch { /* the page is changing */ }
    present = present || builtInPresent();
    if (state) state.captcha = present; // set first: everything that acts on the page checks it
    if (present) {
      if (!was) { diag("captcha.appeared", {}); toast("Bot check detected: the agent is paused until you solve it."); }
      if (!was || now() - lastBeep >= repeatMs) {
        lastBeep = now();
        try { beep(); } catch { /* no audio here */ }
      }
    }
    if (was && !present) { diag("captcha.gone", {}); toast("Bot check done: continuing."); }
    was = present;
    return present;
  }

  return {
    start() { if (!timer) timer = window.setInterval(tick, intervalMs); },
    stop() { if (timer) { window.clearInterval(timer); timer = null; } },
    tick,
  };
}
