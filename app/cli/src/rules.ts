import { basename, join, relative } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { ExtractedRule, InstructionFile, RepoContext } from "./types.js";
import { normalizeCommand, safeRegex, shortQuote } from "./util.js";

const RUNNERS = /^(?:(?:npm|npx|pnpm|yarn|bun|cargo|go|make|just|uv|pytest|python|python3|pip|poetry|ruff|wrangler|tsc|eslint|biome|deno|git|docker|node|sh|bash|ruby|rake|vercel|vitest|jest|sqlite3)(?:\s|$)|\.\/[^\s]+(?:\s|$))/;
const BACKTICK = /`([^`\n]+)`/g;
const MAX_COMMAND_RULES_PER_FILE = 12;

function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "rule"; }
function plausibleCommand(command: string): boolean {
  const value = command.trim();
  return Boolean(value) && !/[{}<>()]/.test(value) && !value.includes("=>") && RUNNERS.test(value);
}

function repoRelativePath(repo: RepoContext, file: InstructionFile): string {
  return relative(repo.root, file.path).replaceAll("\\", "/") || file.name;
}

function deliveryRule(repo: RepoContext, file: InstructionFile): ExtractedRule {
  const path = repoRelativePath(repo, file);
  return { id: `delivery-${slug(path)}`, kind: "delivery", quote: `${path} in context`, file };
}

export function extractRules(repo: RepoContext): ExtractedRule[] {
  const rules: ExtractedRule[] = [];
  const seenFiles = new Set<string>();
  for (const file of repo.files) {
    const relativePath = repoRelativePath(repo, file);
    if (seenFiles.has(relativePath)) continue;
    seenFiles.add(relativePath);
    rules.push(deliveryRule(repo, file));
    const seen = new Set<string>();
    const commands: string[] = [];
    for (const match of file.content.matchAll(BACKTICK)) {
      const command = (match[1] ?? "").trim();
      const normalized = normalizeCommand(command);
      if (!plausibleCommand(command) || seen.has(normalized) || seen.size >= MAX_COMMAND_RULES_PER_FILE) continue;
      seen.add(normalized);
      commands.push(normalized);
    }
    const gates = commands.filter(command => /(check|test|lint|typecheck|verify|build)\b/i.test(command));
    if (gates.length) rules.push({ id: `gate-${slug(relativePath)}`, kind: "gate", quote: shortQuote(`run checks: ${gates.join(" · ")}`), commands: gates, file });
    for (const command of commands.filter(value => !gates.includes(value))) rules.push({ id: `info-${slug(command)}`, kind: "info", quote: shortQuote(command), command, file });
    const managers = [...file.content.matchAll(/\buse\s+(npm|pnpm|yarn|bun)\b/gi)].map(match => match[1]?.toLowerCase()).filter((x): x is "npm"|"pnpm"|"yarn"|"bun" => Boolean(x));
    const unique = [...new Set(managers)];
    const manager = unique[0];
    if (unique.length === 1 && manager) rules.push({ id: `package-manager-${manager}`, kind: "package-manager", quote: `Use ${manager} as the package manager`, packageManager: manager, file });
  }
  const customPath = join(repo.root, ".rulekeeper.json");
  if (existsSync(customPath)) {
    try {
      const parsed = JSON.parse(readFileSync(customPath, "utf8")) as { rules?: unknown[] };
      const customFile: InstructionFile = { path: customPath, name: basename(customPath), content: readFileSync(customPath, "utf8"), markers: [], tokensEstimate: Math.floor(Buffer.byteLength(readFileSync(customPath, "utf8")) / 4) };
      for (const value of parsed.rules ?? []) {
        if (value === null || typeof value !== "object") continue;
        const item = value as Record<string, unknown>; const id = typeof item.id === "string" ? item.id : ""; const description = typeof item.description === "string" ? item.description : id;
        if (!id) continue;
        const applies = item.appliesTo as Record<string, unknown> | undefined;
        const editsMatching = typeof applies?.editsMatching === "string" ? safeRegex(applies.editsMatching) : undefined;
        const requireCommand = typeof item.requireCommand === "string" ? safeRegex(item.requireCommand) : undefined;
        const forbidContent = typeof item.forbidContent === "string" ? safeRegex(item.forbidContent) : undefined;
        const inEditsMatching = typeof item.inEditsMatching === "string" ? safeRegex(item.inEditsMatching) : undefined;
        if (requireCommand && editsMatching) {
          const command = typeof item.requireCommand === "string" ? item.requireCommand : description;
          rules.push({ id, kind: "custom-command", quote: shortQuote(command), command, file: customFile, editsMatching, requireCommand });
        }
        else if (forbidContent && inEditsMatching) rules.push({ id, kind: "custom-content", quote: shortQuote(description), file: customFile, forbidContent, inEditsMatching });
      }
    } catch { /* invalid custom config is ignored, like malformed log lines */ }
  }
  const counts = new Map<string, number>();
  for (const rule of rules) { const count = counts.get(rule.id) ?? 0; counts.set(rule.id, count + 1); if (count) rule.id = `${rule.id}-${count + 1}`; }
  return rules;
}
