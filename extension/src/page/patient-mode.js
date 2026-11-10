// SPDX-License-Identifier: GPL-3.0-or-later
// The Patient switch, kept per site. On a site without a reliable "generating" signal (Meta AI has no stop button) a reply that
// pauses while the model thinks looks finished. With Patient on, response-watcher.js never ends on an empty read and calls a reply
// finished only after its text stayed unchanged for a while; only then is it read for commands. The choice is stored per site
// (provider id), so a reload keeps it.

const KEY = "zsPatient";

/** @param {{ state: object, provider: object, storage: object, onChange: () => void, diag: Function }} deps */
export function createPatientMode({ state, provider, storage, onChange, diag }) {
  let saved = {};
  const adopt = (value) => (value && typeof value === "object" ? { ...value } : {});
  const idOf = () => String(provider.id || "");

  function apply(on) {
    if (on === state.patient) return;
    state.patient = on;
    diag("patientMode", { on });
    onChange();
  }
  const sync = () => apply(saved[idOf()] === true);

  storage.get(KEY).then((value) => { saved = { ...adopt(value), ...saved }; sync(); });
  storage.watch(KEY, (value) => { saved = adopt(value); sync(); });

  function set(on) {
    if (on) saved[idOf()] = true; else delete saved[idOf()];
    storage.set(KEY, { ...saved });
    apply(on);
  }

  return { sync, set, toggle: () => set(!state.patient) };
}
