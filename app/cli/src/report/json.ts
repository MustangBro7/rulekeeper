import { writeFileSync } from "node:fs";
import type { Report } from "../types.js";
import { looksAbsolute } from "../util.js";

export function validateRedaction(value: unknown): string[] {
  const errors: string[] = [];
  function visit(current: unknown, trail: string): void {
    if (typeof current === "string") {
      if (looksAbsolute(current)) errors.push(`${trail}: absolute or home-relative path`);
      if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(current)) errors.push(`${trail}: email address`);
      if (/^(?:cd\s+)?(?:npm|npx|pnpm|yarn|bun|cargo|git|go|python|wrangler)\s+\S+/i.test(current) && !trail.endsWith("quote")) errors.push(`${trail}: command string`);
    } else if (Array.isArray(current)) current.forEach((item, index) => visit(item, `${trail}[${index}]`));
    else if (current !== null && typeof current === "object") for (const [key, item] of Object.entries(current)) visit(item, trail ? `${trail}.${key}` : key);
  }
  visit(value, "report"); return errors;
}

export function assertRedacted(value: unknown): asserts value is Report {
  const errors = validateRedaction(value); if (errors.length) throw new Error(`Report violates redaction invariant:\n${errors.join("\n")}`);
}

export function renderJson(report: Report): string {
  assertRedacted(report); return `${JSON.stringify(report, null, 2)}\n`;
}
export function writeJson(report: Report, path: string): void { writeFileSync(path, renderJson(report), "utf8"); }
