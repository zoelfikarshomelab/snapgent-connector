import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createCaptchaAlert } from "../src/page/captcha-alert.js";
import { profileProblems } from "../src/infrastructure/calibration/index.js";

describe("bot check alert", () => {
  function setup() {
    const state = { present: false, t: 0, beeps: 0, toasts: [] };
    const alert = createCaptchaAlert({
      provider: { captchaPresent: () => state.present },
      window: {},
      toast: (text) => state.toasts.push(text),
      beep: () => { state.beeps += 1; },
      now: () => state.t,
    });
    return { state, alert };
  }

  test("silent while there is no bot check", () => {
    const { state, alert } = setup();
    alert.tick();
    assert.equal(state.beeps, 0);
    assert.equal(state.toasts.length, 0);
  });

  test("beeps the moment it appears, repeats every few seconds, stops when it is gone", () => {
    const { state, alert } = setup();
    state.present = true;
    alert.tick();
    assert.equal(state.beeps, 1);
    assert.equal(state.toasts.length, 1);
    state.t = 1000; alert.tick();
    assert.equal(state.beeps, 1, "not again within the repeat time");
    state.t = 4500; alert.tick();
    assert.equal(state.beeps, 2);
    assert.equal(state.toasts.length, 1, "the notice is shown once per appearance");
    state.present = false; state.t = 9000; alert.tick();
    assert.equal(state.beeps, 2);
    state.present = true; state.t = 9100; alert.tick();
    assert.equal(state.beeps, 3, "a new appearance beeps at once");
  });

  test("a provider without the part (not calibrated) does nothing", () => {
    const alert = createCaptchaAlert({ provider: {}, window: {}, beep: () => assert.fail("no beep") });
    assert.equal(alert.tick(), false);
  });
});

describe("captcha part of a profile", () => {
  const base = { version: 1, site: "chat.deepseek.com", composer: { selector: "textarea" }, send: { enter: true }, assistant: { turn: ".a" }, user: { turn: ".u" } };
  test("optional, but needs a selector when present", () => {
    assert.deepEqual(profileProblems(base), []);
    assert.deepEqual(profileProblems({ ...base, captcha: { selector: "iframe" } }), []);
    assert.deepEqual(profileProblems({ ...base, captcha: {} }), ["captcha needs a selector"]);
  });
});
