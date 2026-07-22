import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseClaudeText } from "./parse/claude.js";
import { parseCodexText } from "./parse/codex.js";
import { discoverInstructionFiles } from "./discover.js";
import { buildReport } from "./score.js";
import { renderTerminal } from "./report/terminal.js";
import type { RepoContext } from "./types.js";

function fixtureRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "demo-fixtures");
}

export function runDemo(color = true): string {
  const fixtures = fixtureRoot(); const repoRoot = join(fixtures, "repo");
  const expand = (name: string) => readFileSync(join(fixtures, name), "utf8").replaceAll("__REPO__", repoRoot);
  const claude = parseClaudeText([expand("claude.jsonl")], "demo-cl", join(fixtures, "claude.jsonl"));
  const codex = parseCodexText(expand("codex.jsonl"), "demo-cx", join(fixtures, "codex.jsonl"));
  const repo: RepoContext = { root: repoRoot, name: "acme-dashboard", sessions: [claude, codex], files: discoverInstructionFiles(repoRoot) };
  const report = buildReport([repo], [claude, codex], "2099-01-01", "2099-01-31", () => "2026-01-01T00:00:00Z");
  return `${renderTerminal(report, color)}\n\nDemo used synthetic logs only. Next: rulekeeper scan`;
}
