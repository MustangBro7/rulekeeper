import type { DriftReport, Finding } from "./types.js";

const ESC = "[";
const RULE = "──────────────────────────────────────────────────────────";

function paint(enabled: boolean, code: string, value: string): string {
  return enabled ? `${ESC}${code}m${value}${ESC}0m` : value;
}

const BADGE: Record<Finding["severity"], { label: string; color: string }> = {
  error: { label: "✗ ERROR", color: "31" },
  warn: { label: "⚠ WARN ", color: "33" },
  info: { label: "· NOTE ", color: "36" },
};

function location(finding: Finding): string {
  return finding.line > 0 ? `${finding.file}:${finding.line}` : finding.file;
}

export function renderDriftTerminal(report: DriftReport, color = true): string {
  const output: string[] = [paint(color, "32;1", "▚ rulekeeper drift")];
  for (const repo of report.repos) {
    const claims = repo.files.reduce((total, file) => total + file.claims, 0);
    output.push(
      `${paint(color, "1", repo.name)} — ${claims} claims in ${repo.files.map((file) => file.name).join(", ")}`,
      RULE,
    );
    if (repo.findings.length === 0) {
      output.push(paint(color, "32", "✓ every checkable claim still matches the repository."));
    }
    for (const finding of repo.findings) {
      const badge = BADGE[finding.severity];
      output.push(
        `${paint(color, badge.color, badge.label)}  ${paint(color, "2", location(finding))}  ${paint(color, "1", finding.subject)}`,
        `         ${finding.message}`,
      );
      if (finding.actual) output.push(paint(color, "2", `         repo: ${finding.actual}`));
      if (finding.suggestion) output.push(paint(color, "36", `         → ${finding.suggestion}`));
      if (finding.context) output.push(paint(color, "2", `         doc:  ${finding.context}`));
      output.push("");
    }
    if (output[output.length - 1] === "") output.pop();
    output.push(RULE);
    const verified = Object.values(repo.verified).reduce((total, count) => total + count, 0);
    const scoreColor = repo.score >= 90 ? "32" : repo.score >= 70 ? "33" : "31";
    output.push(
      `${verified}/${claims} claims still true · ${report.totals.errors} error(s) · ${report.totals.warnings} warning(s) · ${report.totals.infos} note(s)`,
      `${paint(color, "1", "truth score")} ${paint(color, `${scoreColor};1`, String(repo.score))}${paint(color, "2", "/100")}`,
    );
  }
  return output.join("\n");
}

export function renderDriftMarkdown(report: DriftReport): string {
  const lines = [
    "# RuleKeeper drift report",
    "",
    `Generated ${report.generatedAt.slice(0, 10)} · ${report.totals.claims} claims checked · ${report.totals.errors} errors · ${report.totals.warnings} warnings · ${report.totals.infos} notes`,
    "",
  ];
  for (const repo of report.repos) {
    lines.push(`## ${repo.name} — truth score ${repo.score}/100`, "", "| Instruction file | Claims | Findings | Est. tokens | Last commit |", "|---|---:|---:|---:|---|");
    for (const file of repo.files) {
      lines.push(`| ${file.name} | ${file.claims} | ${file.findings} | ${file.tokensEstimate} | ${file.lastCommit || "unknown"} |`);
    }
    lines.push("", "### Findings", "");
    if (repo.findings.length === 0) lines.push("No drift detected — every checkable claim matches the repository.", "");
    else {
      lines.push("| Severity | Where | Subject | What is wrong | Fix |", "|---|---|---|---|---|");
      for (const finding of repo.findings) {
        const cell = (value: string) => value.replace(/\|/g, "\\|");
        lines.push(
          `| ${finding.severity} | ${cell(location(finding))} | \`${cell(finding.subject)}\` | ${cell(finding.message)} | ${cell(finding.suggestion ?? "—")} |`,
        );
      }
      lines.push("");
    }
  }
  lines.push("---", "Generated locally by RuleKeeper. Reports contain repository-relative paths only — no absolute paths, file contents, emails or usernames.", "");
  return lines.join("\n");
}
