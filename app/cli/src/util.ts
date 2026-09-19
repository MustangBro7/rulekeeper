import { isAbsolute, basename } from "node:path";

export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function asString(value: unknown): string { return typeof value === "string" ? value : ""; }
export function updateTimes(target: { firstTs: string; lastTs: string }, ts: string): void {
  if (!ts) return;
  if (!target.firstTs || ts < target.firstTs) target.firstTs = ts;
  if (!target.lastTs || ts > target.lastTs) target.lastTs = ts;
}
export function safeRegex(source: string): RegExp | undefined {
  try { return new RegExp(source); } catch { return undefined; }
}
export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ").replace(/^(?:sudo\s+)?/, "");
}
export function shortQuote(value: string): string { return value.replace(/\s+/g, " ").trim().slice(0, 140); }
export function safeBasename(value: string): string { return basename(value) || "repository"; }
export function looksAbsolute(value: string): boolean {
  return isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || /(?:^|\s)~[\\/]/.test(value) || /(?:^|\s)\/(?:Users|home|Volumes|private|tmp|var)\//.test(value);
}
export function dateOnly(ts: string): string { return ts.slice(0, 10); }
export function sessionInWindow(ts: string, since: string, until: string): boolean {
  const day = dateOnly(ts); return Boolean(day && day >= since.slice(0, 10) && day <= until.slice(0, 10));
}

/** Replaces absolute/home paths in user-authored text so quoted doc lines stay shareable. */
export function redactAbsolute(value: string): string {
  return value
    .replace(/(?:^|(?<=\s))~?\/(?:Users|home|Volumes|private|tmp|var)\/[^\s"'`)]*/g, "\u2039path\u203a")
    .replace(/(?:^|(?<=\s))~\/[^\s"'`)]*/g, "\u2039path\u203a")
    .replace(/\b[A-Za-z]:[\\/][^\s"'`)]*/g, "\u2039path\u203a");
}
