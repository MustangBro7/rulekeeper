import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { assertRedacted } from "./report/json.js";
import type { Report, SharePayload, Verdict } from "./types.js";

const WORKER_URL = "https://rulekeeper.abhinavmohan12.workers.dev";
const MAX_SHARE_BYTES = 60_000;
export interface ShareOptions { yes?: boolean; dryRun?: boolean; workerUrl?: string }

function readReport(path: string): Report {
  const raw = readFileSync(path, "utf8"); const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || (parsed as { v?: unknown }).v !== 1) throw new Error("Expected a RuleKeeper v1 report");
  return parsed as Report;
}

function ruleCount(report: Report): number {
  return report.repos.reduce((total, repo) => total + repo.rules.length, 0);
}

function serialize(report: SharePayload): string {
  return JSON.stringify(report);
}

function withTrimMetadata(report: SharePayload, originalRepos: number, originalRules: number, receiptsDropped: boolean): SharePayload {
  const omittedRepos = originalRepos - report.repos.length;
  const omittedRules = originalRules - ruleCount(report);
  if (!receiptsDropped && omittedRepos === 0 && omittedRules === 0) return report;
  return { ...report, trimmed: true, omittedRepos, omittedRules };
}

const VERDICT_PRIORITY: Record<Verdict, number> = {
  broken: 0,
  "not-delivered": 1,
  "dead-weight": 2,
  works: 3,
  untested: 4,
};

/** Builds the exact body sent to the share worker, excluding untested rules and trimming further only when necessary. */
export function buildSharePayload(report: Report): { report: SharePayload; payload: string } {
  const originalRepos = report.repos.length;
  const originalRules = ruleCount(report);
  let current: SharePayload = {
    ...report,
    repos: report.repos
      .map((repo) => ({
        ...repo,
        untestedCount: repo.rules.filter((rule) => rule.verdict === "untested").length,
        rules: repo.rules.filter((rule) => rule.verdict !== "untested"),
      }))
      .filter((repo) => repo.rules.length > 0),
  };
  let receiptsDropped = false;
  let final = withTrimMetadata(current, originalRepos, originalRules, receiptsDropped);

  if (Buffer.byteLength(serialize(final)) >= MAX_SHARE_BYTES) {
    current = { ...current, repos: current.repos.map(repo => ({
      ...repo,
      rules: repo.rules.map(rule => {
        if (rule.receipts.length <= 3) return rule;
        receiptsDropped = true;
        return { ...rule, receipts: rule.receipts.slice(0, 3) };
      }),
    })) };
    final = withTrimMetadata(current, originalRepos, originalRules, receiptsDropped);
  }

  if (Buffer.byteLength(serialize(final)) >= MAX_SHARE_BYTES) {
    current = { ...current, repos: current.repos.map(repo => ({
      ...repo,
      rules: repo.rules
        .map((rule, index) => ({ rule, index }))
        .sort((a, b) => VERDICT_PRIORITY[a.rule.verdict] - VERDICT_PRIORITY[b.rule.verdict] || a.index - b.index)
        .slice(0, 25)
        .map(({ rule }) => rule),
    })) };
    final = withTrimMetadata(current, originalRepos, originalRules, receiptsDropped);
  }

  if (Buffer.byteLength(serialize(final)) >= MAX_SHARE_BYTES) {
    const repos = current.repos.map((repo, index) => ({ repo, index }));
    const removalOrder = [...repos].sort((a, b) => a.repo.rules.length - b.repo.rules.length || a.index - b.index);
    const removed = new Set<number>();
    for (const candidate of removalOrder) {
      removed.add(candidate.index);
      current = { ...current, repos: repos.filter(item => !removed.has(item.index)).map(item => item.repo) };
      final = withTrimMetadata(current, originalRepos, originalRules, receiptsDropped);
      if (Buffer.byteLength(serialize(final)) < MAX_SHARE_BYTES) break;
    }
  }

  const payload = serialize(final);
  if (Buffer.byteLength(payload) >= MAX_SHARE_BYTES) throw new Error(`Unable to trim share payload below ${MAX_SHARE_BYTES} bytes`);
  assertRedacted(final);
  return { report: final, payload };
}

export async function shareReport(path: string, options: ShareOptions = {}): Promise<void> {
  const { report, payload } = buildSharePayload(readReport(path));
  if (options.dryRun) { stdout.write(`${payload}\n`); return; }
  const rules = ruleCount(report);
  const trimming = report.trimmed ? ` Trimmed for sharing: omitted ${report.omittedRepos} repo(s) and ${report.omittedRules} rule(s).` : "";
  stdout.write(`Will upload exactly: ${report.repos.length} repo(s), ${rules} rule(s), ${Buffer.byteLength(payload)} bytes of redacted JSON.${trimming}\n`);
  if (!options.yes) {
    if (!stdin.isTTY) throw new Error("Confirmation requires an interactive terminal; use --yes to confirm explicitly");
    const io = createInterface({ input: stdin, output: stdout }); const answer = await io.question("Upload this report? [y/N] "); io.close();
    if (!/^y(?:es)?$/i.test(answer.trim())) { stdout.write("Share cancelled.\n"); return; }
  }
  const base = (options.workerUrl || process.env.RULEKEEPER_WORKER_URL || WORKER_URL).replace(/\/$/, "");
  const response = await fetch(`${base}/api/reports`, { method: "POST", headers: { "content-type": "application/json" }, body: payload });
  if (!response.ok) throw new Error(`Share failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  const result = await response.json() as { id?: string; url?: string; deleteSecret?: string };
  if (!result.id || !result.url || !result.deleteSecret) throw new Error("Share service returned an invalid response");
  stdout.write(`${result.url}\nDelete: rulekeeper share --delete ${result.id} --secret ${result.deleteSecret}\nThis link expires in 30 days.\n`);
}

export async function deleteShare(id: string, secret: string, workerUrl?: string): Promise<void> {
  if (!id || !secret) throw new Error("--delete requires an id and --secret");
  const base = (workerUrl || process.env.RULEKEEPER_WORKER_URL || WORKER_URL).replace(/\/$/, "");
  const response = await fetch(`${base}/api/reports/${encodeURIComponent(id)}`, { method: "DELETE", headers: { "x-delete-secret": secret } });
  if (!response.ok) throw new Error(`Delete failed (${response.status})`); stdout.write(`Deleted report ${id}.\n`);
}
