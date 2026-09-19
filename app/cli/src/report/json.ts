import { writeFileSync } from "node:fs";
import type { DriftReport, Report } from "../types.js";
import { looksAbsolute } from "../util.js";

/**
 * Leaf keys whose values are quoted from the user's own instruction files.
 * Command-shaped text is expected there; absolute paths and emails never are.
 */
const AUTHORED_KEYS = new Set(["quote", "context", "message", "suggestion", "actual", "subject", "evidence"]);

export function validateRedaction(value: unknown): string[] {
  const errors: string[] = [];
  function visit(current: unknown, trail: string, key: string): void {
    if (typeof current === "string") {
      if (looksAbsolute(current)) errors.push(`${trail}: absolute or home-relative path`);
      if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(current)) errors.push(`${trail}: email address`);
      if (
        /^(?:cd\s+)?(?:npm|npx|pnpm|yarn|bun|cargo|git|go|python|wrangler)\s+\S+/i.test(current) &&
        !AUTHORED_KEYS.has(key)
      ) {
        errors.push(`${trail}: command string`);
      }
    } else if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${trail}[${index}]`, key));
    } else if (current !== null && typeof current === "object") {
      for (const [childKey, item] of Object.entries(current)) {
        visit(item, trail ? `${trail}.${childKey}` : childKey, childKey);
      }
    }
  }
  visit(value, "report", "");
  return errors;
}

export function assertRedacted<T>(value: T): asserts value is T {
  const errors = validateRedaction(value);
  if (errors.length) throw new Error(`Report violates redaction invariant:\n${errors.join("\n")}`);
}

export function renderJson(report: Report | DriftReport): string {
  assertRedacted(report);
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function writeJson(report: Report | DriftReport, path: string): void {
  writeFileSync(path, renderJson(report), "utf8");
}
