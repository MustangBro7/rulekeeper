import type { AnyReport, DriftFinding, DriftReport, SharedReport, SharedRule } from "./reports.ts";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

const STYLES = `
:root{color-scheme:dark;--bg:#07090a;--panel:#0e1214;--panel-2:#11161a;--line:#1c2429;--line-soft:#151c21;--ink:#eef3f2;--ink-2:#a7b6b6;--ink-3:#6d7d7e;--muted:#4d5a5c;--drift:#f5b544;--adhere:#3ddc97;--crit:#ff6b6b;--mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;--sans:"Inter Tight",Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.6;-webkit-font-smoothing:antialiased}
body::before{content:"";position:fixed;inset:0;z-index:-1;background:radial-gradient(800px 500px at 10% -10%,rgba(245,181,68,.12),transparent 60%),radial-gradient(760px 480px at 92% 2%,rgba(61,220,151,.1),transparent 60%)}
a{color:var(--adhere);text-decoration:none}a:hover{text-decoration:underline;text-underline-offset:3px}
code{font-family:var(--mono)}
.wrap{width:min(1000px,calc(100% - 40px));margin-inline:auto}
.top{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:20px 0;border-bottom:1px solid var(--line-soft)}
.logo{display:inline-flex;align-items:center;gap:8px;color:var(--ink);font-family:var(--mono);font-weight:700;font-size:15px}
.logo b{background:linear-gradient(135deg,var(--drift),var(--adhere));-webkit-background-clip:text;background-clip:text;color:transparent}
.meta{color:var(--muted);font-family:var(--mono);font-size:12px}
main{padding:52px 0 70px}
.kicker{margin:0 0 12px;font-family:var(--mono);font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--tone,var(--ink-3))}
h1{margin:0 0 12px;font-size:clamp(28px,5vw,44px);line-height:1.06;letter-spacing:-.035em;font-weight:600}
.sub{margin:0;color:var(--ink-2);max-width:62ch}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;margin:38px 0;background:var(--line-soft);border:1px solid var(--line-soft);border-radius:12px;overflow:hidden}
.stat{padding:20px;background:var(--panel)}
.stat b{display:block;font-size:26px;letter-spacing:-.03em;color:var(--tone,var(--adhere))}
.stat span{color:var(--ink-3);font-size:12px}
.panel{border:1px solid var(--line);border-radius:12px;background:var(--panel);overflow:hidden}
.panel-head{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;padding:14px 18px;border-bottom:1px solid var(--line-soft);background:var(--panel-2)}
h2{margin:0;font-size:15px;font-weight:600;letter-spacing:-.01em}
.row{padding:15px 18px}
.row+.row{border-top:1px solid var(--line-soft)}
.badge{display:inline-block;min-width:118px;font-family:var(--mono);font-size:11.5px;font-weight:700;letter-spacing:.05em}
.good{color:var(--adhere)}.crit{color:var(--crit)}.warn{color:var(--drift)}.dim{color:var(--ink-3)}
.quote{color:var(--ink)}
.counts{margin-left:10px;color:var(--ink-3);font-family:var(--mono);font-size:12px}
.receipt{margin:6px 0 0 18px;color:var(--ink-3);font-family:var(--mono);font-size:11.5px}
.receipt::before{content:"└ ";color:var(--muted)}
.finding{display:grid;grid-template-columns:96px 1fr;gap:16px}
.finding .where{color:var(--ink-3);font-family:var(--mono);font-size:11.5px;margin:2px 0 0}
.finding h3{margin:0 0 4px;font-size:15px;font-weight:600;letter-spacing:-.01em;font-family:var(--mono)}
.finding p{margin:0;color:var(--ink-2);font-size:14px}
.finding .fix{margin-top:5px;color:var(--adhere);font-family:var(--mono);font-size:12px}
.finding .actual,.finding .doc{margin-top:4px;color:var(--muted);font-family:var(--mono);font-size:11.5px;overflow-wrap:anywhere}
.empty{padding:36px 18px;color:var(--ink-2);text-align:center}
.score{font-family:var(--mono);font-size:12px;color:var(--ink-3)}
.score b{font-size:20px;letter-spacing:-.02em}
.install{display:flex;justify-content:space-between;align-items:center;gap:20px;flex-wrap:wrap;margin-top:32px;padding:15px 18px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}
.install code{color:var(--adhere);font-size:12.5px;overflow-wrap:anywhere}
footer{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap;padding:24px 0;border-top:1px solid var(--line-soft);color:var(--muted);font-family:var(--mono);font-size:11.5px}
.nf{max-width:620px}.nf h1{color:var(--crit)}
@media(max-width:760px){.stats{grid-template-columns:repeat(2,1fr)}.finding{grid-template-columns:1fr;gap:4px}.badge{display:block;margin-bottom:4px}.counts{display:block;margin:4px 0 0}}
@media(max-width:420px){.stats{grid-template-columns:1fr}}
`;

function shell(title: string, body: string, tone: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#07090a">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(title)}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  <style>${STYLES}</style>
</head>
<body style="--tone:${tone}">
  <header class="wrap top">
    <a class="logo" href="/"><b aria-hidden="true">▚</b> rulekeeper</a>
    <span class="meta">evidence, not vibes</span>
  </header>
  ${body}
  <footer class="wrap">
    <span>generated locally · selectively shared · expires in 30 days</span>
    <a href="/">rulekeeper.dev</a>
  </footer>
</body>
</html>`;
}

const INSTALL = `<div class="install">
        <code>npm i -g https://github.com/MustangBro7/rulekeeper/releases/latest/download/rulekeeper-cli.tgz</code>
        <a href="/">run it on your own repo →</a>
      </div>`;

/* ── Adherence ─────────────────────────────────────────────── */

function verdict(rule: SharedRule): { symbol: string; label: string; className: string } {
  if (rule.verdict === "works") return { symbol: "✓", label: "WORKS", className: "good" };
  if (rule.verdict === "broken") return { symbol: "✗", label: "BROKEN", className: "crit" };
  if (rule.verdict === "not-delivered") return { symbol: "✗", label: "DELIVERY GAP", className: "crit" };
  if (rule.verdict === "dead-weight") return { symbol: "△", label: "DEAD WEIGHT", className: "warn" };
  return { symbol: "·", label: "UNTESTED", className: "dim" };
}

function renderRule(rule: SharedRule): string {
  const state = verdict(rule);
  const receipts = rule.receipts.map((receipt) => `
          <p class="receipt">session ${escapeHtml(receipt.sessionId8)} · ${escapeHtml(receipt.date)} · ${escapeHtml(receipt.evidence)}</p>`).join("");
  return `<div class="row">
          <span class="badge ${state.className}">${state.symbol} ${state.label}</span><span class="quote">“${escapeHtml(rule.quote)}”</span><span class="counts">${rule.followed}/${rule.applicable} followed · ${rule.violated} violated</span>${receipts}
        </div>`;
}

function renderAdherencePage(report: SharedReport): string {
  const ruleCount = report.repos.reduce((total, repo) => total + repo.rules.length, 0);
  const broken = report.repos.reduce(
    (total, repo) => total + repo.rules.filter((rule) => rule.verdict === "broken" || rule.verdict === "not-delivered").length,
    0,
  );
  const dead = report.repos.reduce((total, repo) => total + repo.rules.filter((rule) => rule.verdict === "dead-weight").length, 0);

  const repos = report.repos.map((repo) => `<section class="panel" style="margin-bottom:20px">
        <div class="panel-head">
          <h2>${escapeHtml(repo.name)}</h2>
          <span class="meta">${repo.rules.length} scored rule(s)${(repo.untestedCount ?? 0) > 0 ? ` · ${repo.untestedCount} not exercised` : ""}</span>
        </div>
        ${repo.rules.length > 0 ? repo.rules.map(renderRule).join("") : '<p class="empty">No scored rules in this repository.</p>'}
      </section>`).join("");

  return shell(
    `RuleKeeper adherence — ${ruleCount} rules scored`,
    `<main class="wrap">
      <p class="kicker">rulekeeper adherence</p>
      <h1>Did the agents follow the rules?</h1>
      <p class="sub">${report.totals.sessions} sessions replayed between ${escapeHtml(report.window.since)} and ${escapeHtml(report.window.until)} — ${report.totals.sources.claude} from Claude Code, ${report.totals.sources.codex} from Codex.</p>
      <div class="stats">
        <div class="stat"><b>${report.totals.sessions}</b><span>sessions</span></div>
        <div class="stat"><b>${ruleCount}</b><span>rules scored</span></div>
        <div class="stat"><b>${broken}</b><span>broken or undelivered</span></div>
        <div class="stat"><b>${dead}</b><span>dead weight</span></div>
      </div>
      ${repos}
      ${INSTALL}
    </main>`,
    "#3ddc97",
  );
}

/* ── Drift ─────────────────────────────────────────────────── */

const SEVERITY_BADGE: Record<string, { label: string; className: string }> = {
  error: { label: "✗ ERROR", className: "crit" },
  warn: { label: "⚠ WARN", className: "warn" },
  info: { label: "· NOTE", className: "dim" },
};

function renderFinding(finding: DriftFinding): string {
  const badge = SEVERITY_BADGE[finding.severity] ?? SEVERITY_BADGE.info!;
  const where = finding.line > 0 ? `${finding.file}:${finding.line}` : finding.file;
  return `<div class="row finding">
          <div>
            <span class="badge ${badge.className}">${badge.label}</span>
            <p class="where">${escapeHtml(where)}</p>
          </div>
          <div>
            <h3>${escapeHtml(finding.subject)}</h3>
            <p>${escapeHtml(finding.message)}</p>
            ${finding.actual ? `<p class="actual">repo: ${escapeHtml(finding.actual)}</p>` : ""}
            ${finding.suggestion ? `<p class="fix">→ ${escapeHtml(finding.suggestion)}</p>` : ""}
            ${finding.context ? `<p class="doc">doc: ${escapeHtml(finding.context)}</p>` : ""}
          </div>
        </div>`;
}

function renderDriftPage(report: DriftReport): string {
  const repos = report.repos.map((repo) => `<section class="panel" style="margin-bottom:20px">
        <div class="panel-head">
          <h2>${escapeHtml(repo.name)}</h2>
          <span class="score">truth score <b class="${repo.score >= 90 ? "good" : repo.score >= 70 ? "warn" : "crit"}">${repo.score}</b>/100 · ${repo.files.map((file) => escapeHtml(file.name)).join(", ")}</span>
        </div>
        ${repo.findings.length > 0 ? repo.findings.map(renderFinding).join("") : '<p class="empty">✓ Every checkable claim still matches the repository.</p>'}
      </section>`).join("");

  return shell(
    `RuleKeeper drift — ${report.totals.errors} errors, ${report.totals.warnings} warnings`,
    `<main class="wrap">
      <p class="kicker">rulekeeper drift</p>
      <h1>Is the instruction file still true?</h1>
      <p class="sub">${report.totals.claims} claims made by ${report.totals.files} instruction file(s) were checked against the repository as it exists today.</p>
      <div class="stats">
        <div class="stat"><b>${report.totals.claims}</b><span>claims checked</span></div>
        <div class="stat"><b>${report.totals.verified}</b><span>still true</span></div>
        <div class="stat"><b class="crit">${report.totals.errors}</b><span>errors</span></div>
        <div class="stat"><b class="warn">${report.totals.warnings}</b><span>warnings</span></div>
      </div>
      ${repos}
      ${INSTALL}
    </main>`,
    "#f5b544",
  );
}

export function renderSharePage(report: AnyReport): string {
  return report.kind === "drift" ? renderDriftPage(report) : renderAdherencePage(report);
}

export function renderNotFoundPage(): string {
  return shell(
    "RuleKeeper — report not found",
    `<main class="wrap nf">
      <p class="kicker">404</p>
      <h1>This report has expired.</h1>
      <p class="sub">Shared reports are deleted after 30 days, or whenever their author deletes them. Reports are always generated locally — run the CLI to produce a fresh one.</p>
      ${INSTALL}
    </main>`,
    "#ff6b6b",
  );
}
