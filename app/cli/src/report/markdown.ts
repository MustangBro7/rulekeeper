import { writeFileSync } from "node:fs";
import type { Report } from "../types.js";

export function renderMarkdown(report: Report): string {
  const lines = [`# RuleKeeper report — ${report.window.since} → ${report.window.until}`, "", `**${report.totals.sessions} sessions** (${report.totals.sources.claude} Claude Code, ${report.totals.sources.codex} Codex) · ${report.totals.commands} commands · ${report.totals.edits} edits · ${report.totals.errors} errors`, ""];
  for (const repo of report.repos) {
    lines.push(`## ${repo.name}`, "", "### Instruction delivery", "", "| File | Sessions touching | In context | Est. tokens |", "|---|---:|---:|---:|");
    for (const file of repo.files) lines.push(`| ${file.name} | ${file.sessionsTouching} | ${file.sessionsInContext} | ${file.tokensEstimate} |`);
    lines.push("", "### Rule scoreboard", "", "| Verdict | Rule | Born | Followed | Violated | Pre-rule |", "|---|---|---|---:|---:|---:|");
    for (const rule of repo.rules) lines.push(`| ${rule.kind === "info" ? "info" : rule.verdict} | ${rule.quote.replace(/\|/g, "\\|")} | ${rule.born.slice(0, 10) || "unknown"} | ${rule.kind === "info" ? rule.observation : `${rule.followed}/${rule.applicable}`} | ${rule.violated} | ${rule.preRule} |`);
    const receipts = repo.rules.flatMap(rule => rule.receipts.map(receipt => ({ rule, receipt })));
    if (receipts.length) {
      lines.push("", "### Receipts", "");
      for (const { rule, receipt } of receipts) lines.push(`- **${rule.id}** — \`${receipt.sessionId8}\` · ${receipt.date} · ${receipt.evidence}`);
    }
    lines.push("");
  }
  lines.push("---", "Generated locally by RuleKeeper. Reports contain no absolute paths, file contents, command strings, emails, or usernames.", "");
  return lines.join("\n");
}
export function writeMarkdown(report: Report, path: string): void { writeFileSync(path, renderMarkdown(report), "utf8"); }
