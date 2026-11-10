// SPDX-License-Identifier: GPL-3.0-or-later
// How the terminal shows when a command ran: the clock time down to the second, and how long it took. Pure.

const two = (value) => String(value).padStart(2, "0");

/** Local time of day, `14:03:22`. */
export function formatClock(ms) {
  if (!Number.isFinite(ms)) return "";
  const date = new Date(ms);
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}

/** A span as `45 s`, `2 min 5 s` or `1 h 2 min`; under a second says so. */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return "<1 s";
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours} h ${minutes} min`;
  if (minutes) return `${minutes} min ${seconds} s`;
  return `${seconds} s`;
}
