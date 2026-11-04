import { DEFAULT_SCHEDULE } from "./config.js";

export function schedule(session) {
  const s = session && session.schedule ? session.schedule : DEFAULT_SCHEDULE;
  return { ...DEFAULT_SCHEDULE, ...s };
}
export function elapsedMin(session, now) {
  if (!session || !session.startedAt) return null;
  return (now - session.startedAt) / 60000;
}
export function fmt(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
export function words(t) { return (t || "").trim().split(/\s+/).filter(Boolean).length; }
export function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

/** Phase gating for a step with {unlock, warn, target} at elapsed minutes e. */
export function gate(step, e) {
  if (e == null) return { state: "pre", locked: true };
  if (e < step.unlock) return { state: "locked", locked: true, secs: (step.unlock - e) * 60 };
  if (e < step.warn) return { state: "open", locked: false, secs: (step.warn - e) * 60 };
  if (e < step.target) return { state: "warn", locked: false, secs: (step.target - e) * 60 };
  return { state: "over", locked: false };
}

export const sessPath = (sid) => `sessions/${sid}`;
