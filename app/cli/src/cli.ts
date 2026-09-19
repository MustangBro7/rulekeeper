#!/usr/bin/env node
import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { scan } from "./pipeline.js";
import { runDrift } from "./drift/pipeline.js";
import { renderDriftMarkdown, renderDriftTerminal } from "./drift/render.js";
import { writeJson } from "./report/json.js";
import { renderTerminal } from "./report/terminal.js";
import { deleteShare, shareReport } from "./share.js";
import { runAdherenceDemo, runDriftDemo } from "./demo.js";

const VERSION = "2.0.0";
const OUT_DIR = "rulekeeper-report";

const HELP = `
▚ rulekeeper — keep agent instructions true, and prove agents follow them

Usage
  rulekeeper drift [options]        Is CLAUDE.md still true about this repo?
  rulekeeper adherence [options]    Did agents actually follow it?
  rulekeeper demo [drift|adherence] Run against bundled fixtures
  rulekeeper share [reportPath]     Publish a redacted report link

drift — static check, no logs read, safe in CI
  --dir <repo>        Repository to check (default: current directory)
  --strict            Exit non-zero on warnings as well as errors
  --no-history        Skip git-history checks (staleness)
  --json <path>       JSON output (default: ./${OUT_DIR}/drift.json)
  --md <path>         Markdown output (default: ./${OUT_DIR}/drift.md)

adherence — reads local Claude Code / Codex transcripts, never uploads
  --since <28d|date>  Start of window (default: 28 days ago)
  --until <date>      End of window (default: today)
  --dir <repo>        Limit results to one repository
  --json <path>       JSON output (default: ./${OUT_DIR}/adherence.json)
  --md <path>         Markdown output (default: ./${OUT_DIR}/adherence.md)

share
  --yes               Skip interactive confirmation
  --dry-run           Print the exact payload without uploading
  --delete <id>       Delete a shared report (requires --secret)
  --secret <secret>   Delete secret returned when sharing

Global
  --no-color          Disable ANSI color
  --quiet             Suppress the terminal report
  --help, -h          Show help
  --version, -v       Show version
`.trim();

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseUntil(value: string | undefined): string {
  const selected = value ?? day(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(selected) || Number.isNaN(Date.parse(`${selected}T00:00:00Z`))) {
    throw new Error(`Invalid date: ${selected}`);
  }
  return selected;
}

function parseSince(value: string | undefined, until: string): string {
  if (!value) {
    const date = new Date(`${until}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 28);
    return day(date);
  }
  const relative = /^(\d+)(d|w)$/.exec(value);
  if (relative) {
    const date = new Date(`${until}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - Number(relative[1]) * (relative[2] === "w" ? 7 : 1));
    return day(date);
  }
  return parseUntil(value);
}

function requireOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

function outputPath(args: string[], flag: string, fallback: string): string {
  const path = resolve(requireOption(args, flag) ?? `${OUT_DIR}/${fallback}`);
  mkdirSync(dirname(path), { recursive: true });
  return path;
}

function runDriftCommand(args: string[]): void {
  const color = !args.includes("--no-color");
  const report = runDrift({
    ...(requireOption(args, "--dir") ? { dir: requireOption(args, "--dir") as string } : {}),
    ...(args.includes("--no-history") ? { noHistory: true } : {}),
  });
  writeJson(report, outputPath(args, "--json", "drift.json"));
  writeFileSync(outputPath(args, "--md", "drift.md"), renderDriftMarkdown(report), "utf8");
  if (!args.includes("--quiet")) console.log(renderDriftTerminal(report, color));
  const failing = report.totals.errors + (args.includes("--strict") ? report.totals.warnings : 0);
  if (failing > 0) process.exitCode = 1;
}

function runAdherenceCommand(args: string[]): void {
  const until = parseUntil(requireOption(args, "--until"));
  const since = parseSince(requireOption(args, "--since"), until);
  if (since > until) throw new Error("--since must not be after --until");
  const selectedDir = requireOption(args, "--dir");
  const report = scan({
    since,
    until,
    ...(selectedDir ? { dir: selectedDir } : {}),
    jsonPath: outputPath(args, "--json", "adherence.json"),
    markdownPath: outputPath(args, "--md", "adherence.md"),
  });
  if (!args.includes("--quiet")) console.log(renderTerminal(report, !args.includes("--no-color")));
}

function defaultSharePath(): string {
  for (const candidate of ["drift.json", "adherence.json", "report.json"]) {
    const path = resolve(OUT_DIR, candidate);
    if (existsSync(path)) return path;
  }
  throw new Error(`No report found in ./${OUT_DIR}. Run "rulekeeper drift" or "rulekeeper adherence" first.`);
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (!args.length || args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }
  if (args.includes("--version") || args.includes("-v")) {
    console.log(VERSION);
    return;
  }
  const command = args[0];
  const color = !args.includes("--no-color");

  if (command === "demo") {
    const which = args[1] && !args[1].startsWith("-") ? args[1] : "drift";
    if (which === "adherence") console.log(runAdherenceDemo(color));
    else if (which === "drift") console.log(runDriftDemo(color));
    else throw new Error(`Unknown demo: ${which}. Try "rulekeeper demo drift" or "rulekeeper demo adherence".`);
    return;
  }
  if (command === "drift") return runDriftCommand(args);
  if (command === "adherence") return runAdherenceCommand(args);
  if (command === "share") {
    const deleteId = requireOption(args, "--delete");
    if (deleteId) {
      await deleteShare(deleteId, requireOption(args, "--secret") ?? "", process.env.RULEKEEPER_WORKER_URL);
      return;
    }
    const positional = args.slice(1).find((value) => !value.startsWith("-"));
    await shareReport(positional ? resolve(positional) : defaultSharePath(), {
      yes: args.includes("--yes"),
      dryRun: args.includes("--dry-run"),
      ...(process.env.RULEKEEPER_WORKER_URL ? { workerUrl: process.env.RULEKEEPER_WORKER_URL } : {}),
    });
    return;
  }
  if (command === "scan") throw new Error('"scan" split into two commands: "rulekeeper drift" and "rulekeeper adherence".');
  throw new Error(`Unknown command: ${command}\n\n${HELP}`);
}

/** npm installs the bin as a symlink, so argv[1] must be resolved before comparing. */
export function invokedDirectly(entry = process.argv[1], moduleUrl = import.meta.url): boolean {
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main().catch((error) => {
    console.error(`rulekeeper: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
