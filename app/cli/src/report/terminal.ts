import type { Report, ScoredRule } from "../types.js";

const ESC = "\u001b[";
function paint(enabled: boolean, code: string, value: string): string { return enabled ? `${ESC}${code}m${value}${ESC}0m` : value; }
function quote(rule: ScoredRule): string {
  return rule.kind === "command" || rule.kind === "gate" || rule.kind === "custom-command" ? `\`${rule.quote}\`` : `“${rule.quote}”`;
}
function receipt(rule: ScoredRule): string {
  const first = rule.receipts[0]; return first ? ` · receipt: session ${first.sessionId8}` : "";
}
function line(rule: ScoredRule, color: boolean): string {
  const count = `${rule.followed}/${rule.applicable}`;
  if (rule.verdict === "works") return `${paint(color, "32", "✓ WORKS")}        ${quote(rule)} — ${rule.kind === "command" || rule.kind === "gate" || rule.kind === "custom-command" ? "ran " : "followed "}${paint(color, "32", count)}`;
  if (rule.verdict === "dead-weight") return `${paint(color, "33", "△ DEAD-WEIGHT")}  ${quote(rule)} — followed ${count}, including without instruction context`;
  if (rule.verdict === "not-delivered") return `${paint(color, "31", "✗ DELIVERY GAP")} ${quote(rule)} — ${paint(color, "31", count)} sessions received it${receipt(rule)}`;
  if (rule.verdict === "broken") {
    const evidence = rule.receipts[0]?.evidence;
    const reason = rule.kind === "command" || rule.kind === "gate" ? (evidence?.startsWith("required after ") ? evidence : "required after code edits") : rule.kind === "custom-command" ? (evidence ?? "required after matching edits") : "rule was violated";
    return `${paint(color, "31", "✗ BROKEN")}       ${quote(rule)} — ${reason}, ${rule.kind === "command" || rule.kind === "gate" || rule.kind === "custom-command" ? "ran " : "followed "}${count}${receipt(rule)}`;
  }
  return "";
}

export function renderTerminal(report: Report, color = true): string {
  const repos = report.repos.filter(repo => Math.max(0, ...repo.files.map(file => file.sessionsTouching)) >= 2);
  const rules = repos.flatMap(repo => repo.rules); const output = [
    paint(color, "32;1", "▚ rulekeeper adherence"),
    `${report.totals.sessions} sessions · ${report.totals.commands} commands · ${report.totals.edits} edits · ${repos.length} repos`,
    "────────────────────────────────────────────────────────"
  ];
  for (const repo of repos) {
    output.push(paint(color, "1", repo.name));
    const visible = repo.rules.filter(rule => rule.kind !== "info" && rule.verdict !== "untested");
    const unique = visible.filter((rule, index) => visible.findIndex(candidate => line(candidate, false) === line(rule, false)) === index);
    const delivery = unique.filter(rule => rule.verdict === "not-delivered");
    const broken = unique.filter(rule => rule.verdict === "broken");
    const works = unique.filter(rule => rule.verdict === "works");
    const dead = unique.filter(rule => rule.verdict === "dead-weight");
    for (const rule of delivery) output.push(line(rule, color));
    for (const rule of broken.slice(0, 8)) output.push(line(rule, color));
    if (broken.length > 8) output.push(`  +${broken.length - 8} more`);
    for (const rule of works) output.push(line(rule, color));
    for (const rule of dead) output.push(line(rule, color));
  }
  output.push("────────────────────────────────────────────────────────");
  const tested = rules.filter(rule => rule.kind !== "info" && rule.verdict !== "untested");
  output.push(`${tested.filter(rule => rule.verdict === "dead-weight").length} of ${tested.length} tested rules were dead weight.`);
  return output.join("\n");
}
