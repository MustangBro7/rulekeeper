#!/usr/bin/env node
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { scan } from "./pipeline.js";
import { renderTerminal } from "./report/terminal.js";
import { deleteShare, shareReport } from "./share.js";
import { runDemo } from "./demo.js";

const VERSION = "1.0.0";
const HELP = `
▚ rulekeeper — prove whether coding agents follow repository rules

Usage
  rulekeeper scan [options]
  rulekeeper share [reportPath] [--yes|--dry-run]
  rulekeeper demo

Scan options
  --since <28d|date>  Start of window (default: 28 days ago)
  --until <date>      End of window (default: today)
  --dir <repo>        Limit results to one repository
  --json <path>       JSON output (default: ./rulekeeper-report/report.json)
  --md <path>         Markdown output (default: ./rulekeeper-report/report.md)
  --no-color          Disable ANSI color
  --quiet             Do not print the terminal report

Share options
  --yes               Skip interactive confirmation
  --dry-run           Print the exact payload without uploading
  --delete <id>       Delete a shared report (requires --secret)
  --secret <secret>   Delete secret returned when sharing

Global
  --help, -h          Show help
  --version, -v       Show version
`.trim();

function day(date: Date): string { return date.toISOString().slice(0, 10); }
function parseUntil(value: string | undefined): string {
  const selected = value ?? day(new Date()); if (!/^\d{4}-\d{2}-\d{2}$/.test(selected) || Number.isNaN(Date.parse(`${selected}T00:00:00Z`))) throw new Error(`Invalid date: ${selected}`); return selected;
}
function parseSince(value: string | undefined, until: string): string {
  if (!value) { const date = new Date(`${until}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - 28); return day(date); }
  const relative = /^(\d+)(d|w)$/.exec(value);
  if (relative) { const date = new Date(`${until}T00:00:00Z`); date.setUTCDate(date.getUTCDate() - Number(relative[1]) * (relative[2] === "w" ? 7 : 1)); return day(date); }
  return parseUntil(value);
}
function option(args: string[], name: string): string | undefined { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; }
function requireOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name); if (index < 0) return undefined; const value = args[index + 1]; if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`); return value;
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  if (!args.length || args.includes("--help") || args.includes("-h")) { console.log(HELP); return; }
  if (args.includes("--version") || args.includes("-v")) { console.log(VERSION); return; }
  const command = args[0];
  if (command === "demo") { console.log(runDemo(!args.includes("--no-color"))); return; }
  if (command === "scan") {
    const until = parseUntil(requireOption(args, "--until")); const since = parseSince(requireOption(args, "--since"), until);
    if (since > until) throw new Error("--since must not be after --until");
    const out = resolve("rulekeeper-report"); mkdirSync(out, { recursive: true });
    const selectedDir = requireOption(args, "--dir");
    const report = scan({ since, until, ...(selectedDir ? { dir: selectedDir } : {}), jsonPath: resolve(requireOption(args, "--json") ?? `${out}/report.json`), markdownPath: resolve(requireOption(args, "--md") ?? `${out}/report.md`) });
    if (!args.includes("--quiet")) console.log(renderTerminal(report, !args.includes("--no-color")));
    return;
  }
  if (command === "share") {
    const deleteId = requireOption(args, "--delete");
    if (deleteId) { await deleteShare(deleteId, requireOption(args, "--secret") ?? "", process.env.RULEKEEPER_WORKER_URL); return; }
    const positional = args.slice(1).find(value => !value.startsWith("-"));
    await shareReport(resolve(positional ?? "rulekeeper-report/report.json"), { yes: args.includes("--yes"), dryRun: args.includes("--dry-run"), ...(process.env.RULEKEEPER_WORKER_URL ? { workerUrl: process.env.RULEKEEPER_WORKER_URL } : {}) }); return;
  }
  throw new Error(`Unknown command: ${command}\n\n${HELP}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main().catch(error => { console.error(`rulekeeper: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
