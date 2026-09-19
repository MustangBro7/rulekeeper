import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseClaudeText } from "./parse/claude.js";
import { parseCodexText } from "./parse/codex.js";
import { discoverInstructionFiles } from "./discover.js";
import { buildReport } from "./score.js";
import { renderTerminal } from "./report/terminal.js";
import { analyzeRepo } from "./drift/pipeline.js";
import { renderDriftTerminal } from "./drift/render.js";
import type { DriftReport, RepoContext } from "./types.js";

function fixtureRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "demo-fixtures");
}

export function runDriftDemo(color = true): string {
  const repo = analyzeRepo(join(fixtureRoot(), "drift-repo"), { noHistory: true });
  const report: DriftReport = {
    v: 2,
    kind: "drift",
    generatedAt: new Date().toISOString(),
    totals: {
      repos: 1,
      files: repo.files.length,
      claims: repo.files.reduce((total, file) => total + file.claims, 0),
      verified: Object.values(repo.verified).reduce((total, count) => total + count, 0),
      errors: repo.findings.filter((finding) => finding.severity === "error").length,
      warnings: repo.findings.filter((finding) => finding.severity === "warn").length,
      infos: repo.findings.filter((finding) => finding.severity === "info").length,
    },
    repos: [repo],
  };
  return `${renderDriftTerminal(report, color)}\n\nDemo used a bundled fixture repository. Next: rulekeeper drift`;
}

export function runAdherenceDemo(color = true): string {
  const fixtures = fixtureRoot();
  const repoRoot = join(fixtures, "repo");
  const expand = (name: string) => readFileSync(join(fixtures, name), "utf8").replaceAll("__REPO__", repoRoot);
  const claude = parseClaudeText([expand("claude.jsonl")], "demo-cl", join(fixtures, "claude.jsonl"));
  const codex = parseCodexText(expand("codex.jsonl"), "demo-cx", join(fixtures, "codex.jsonl"));
  const repo: RepoContext = {
    root: repoRoot,
    name: "acme-dashboard",
    sessions: [claude, codex],
    files: discoverInstructionFiles(repoRoot),
  };
  const report = buildReport([repo], [claude, codex], "2099-01-01", "2099-01-31", () => "2026-01-01T00:00:00Z");
  return `${renderTerminal(report, color)}\n\nDemo used synthetic logs only. Next: rulekeeper adherence`;
}
