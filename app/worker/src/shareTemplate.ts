import type { SharedReport, SharedRule } from "./reports.ts";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function verdict(rule: SharedRule): { symbol: "✓" | "✗" | "·"; label: string; className: string } {
  if (rule.verdict === "works") return { symbol: "✓", label: "WORKS", className: "good" };
  if (rule.verdict === "broken") return { symbol: "✗", label: "BROKEN", className: "crit" };
  if (rule.verdict === "not-delivered") return { symbol: "✗", label: "NOT DELIVERED", className: "crit" };
  if (rule.verdict === "dead-weight") return { symbol: "✗", label: "DEAD WEIGHT", className: "warn" };
  return { symbol: "·", label: "UNTESTED", className: "muted" };
}

const STYLES = `
:root{color-scheme:dark;--bg:#0b0f0e;--panel:#101615;--panel-2:#0e1312;--ink:#e8f0ee;--ink-2:#9fb0ac;--muted:#5f6f6b;--line:#1d2624;--accent:#34d399;--accent-dim:#10643f;--good:#34d399;--crit:#f87171;--warn:#fbbf24}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Consolas,monospace;font-size:14px;line-height:1.65}a{color:var(--accent);text-underline-offset:3px}.wrap{width:min(960px,calc(100% - 36px));margin:0 auto}.top{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:22px 0;border-bottom:1px solid var(--line)}.logo{color:var(--ink);font-weight:800;text-decoration:none;letter-spacing:.04em}.logo span,.kicker{color:var(--accent)}main{padding:58px 0 72px}.kicker{margin:0 0 12px;font-size:11px;letter-spacing:.2em;text-transform:uppercase}h1{margin:0 0 10px;font-size:clamp(28px,5vw,44px);line-height:1.15}.sub{margin:0;color:var(--ink-2)}.stats{display:grid;grid-template-columns:repeat(4,1fr);margin:36px 0;border:1px solid var(--line);background:var(--panel-2)}.stat{padding:18px;border-left:1px solid var(--line)}.stat:first-child{border-left:0}.stat b{display:block;color:var(--accent);font-size:24px}.stat span{color:var(--ink-2);font-size:11px}.terminal{border:1px solid var(--line);background:var(--panel);box-shadow:0 0 60px rgba(52,211,153,.05)}.bar{padding:10px 14px;border-bottom:1px solid var(--line);color:var(--muted);font-size:11px}.bar::before{content:"●  ●  ●";margin-right:14px;color:var(--line)}.repo{padding:22px}.repo+.repo{border-top:1px solid var(--line)}h2{margin:0 0 14px;font-size:15px}.rule{padding:12px 0;border-top:1px solid var(--line)}.rule:first-of-type{border-top:0}.verdict{display:inline-block;min-width:128px;font-weight:800}.good{color:var(--good)}.crit{color:var(--crit)}.warn{color:var(--warn)}.muted,.meta{color:var(--muted)}.quote{color:var(--ink)}.counts{margin-left:8px;color:var(--ink-2);font-size:12px}.receipt{margin:6px 0 0 20px;color:var(--ink-2);font-size:11px}.receipt::before{content:"└ receipt: ";color:var(--muted)}.empty{padding:30px;color:var(--ink-2)}.install{display:flex;justify-content:space-between;gap:20px;margin-top:28px;padding:14px 16px;border:1px solid var(--line);background:var(--panel)}code{color:var(--accent)}footer{display:flex;justify-content:space-between;gap:20px;padding:26px 0;border-top:1px solid var(--line);color:var(--ink-2);font-size:11px}.not-found{max-width:680px}.not-found .terminal{margin-top:30px;padding:28px}.not-found h1{color:var(--crit)}@media(max-width:650px){.stats{grid-template-columns:repeat(2,1fr)}.stat:nth-child(3){border-top:1px solid var(--line);border-left:0}.stat:nth-child(4){border-top:1px solid var(--line)}.top,.install,footer{align-items:flex-start;flex-direction:column}.verdict{display:block}.counts{display:block;margin:3px 0 0}.repo{padding:18px}}
`;

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#0b0f0e">
  <title>${escapeHtml(title)}</title>
  <style>${STYLES}</style>
</head>
<body>
  <header class="wrap top"><a class="logo" href="/"><span>▚</span> rulekeeper</a><span class="meta">evidence, not vibes</span></header>
  ${body}
  <footer class="wrap"><span>generated locally · selectively shared</span><a href="/">rulekeeper home</a></footer>
</body>
</html>`;
}

function renderRule(rule: SharedRule): string {
  const state = verdict(rule);
  const receipts = rule.receipts.map((receipt) => `
          <p class="receipt">session ${escapeHtml(receipt.sessionId8)} · ${escapeHtml(receipt.date)} · ${escapeHtml(receipt.evidence)}</p>`).join("");
  return `<div class="rule">
          <span class="verdict ${state.className}">${state.symbol} ${state.label}</span><span class="quote">“${escapeHtml(rule.quote)}”</span>
          <span class="counts">${rule.followed}/${rule.applicable} followed · ${rule.violated} violated</span>${receipts}
        </div>`;
}

export function renderSharePage(report: SharedReport): string {
  const ruleCount = report.repos.reduce((total, repo) => total + repo.rules.length, 0);
  const repos = report.repos.map((repo) => `<section class="repo">
        <h2><span class="kicker">repo</span> ${escapeHtml(repo.name)} · ${repo.rules.length} rules</h2>
        ${(repo.untestedCount ?? 0) > 0 ? `<p class="meta">+${repo.untestedCount} rules not exercised in this window</p>` : ""}
        ${repo.rules.length > 0 ? repo.rules.map(renderRule).join("") : '<p class="meta">No scored rules in this repository.</p>'}
      </section>`).join("");

  return shell(`RuleKeeper report · ${report.repos.length} repos`, `<main class="wrap">
    <p class="kicker">shared rule audit · v1</p>
    <h1>${report.totals.sessions} sessions. ${ruleCount} rules. Receipts included.</h1>
    <p class="sub">Window ${escapeHtml(report.window.since)} → ${escapeHtml(report.window.until)} · generated ${escapeHtml(report.generatedAt.slice(0, 10))}</p>
    <section class="stats" aria-label="Report totals">
      <div class="stat"><b>${report.totals.sessions}</b><span>sessions</span></div>
      <div class="stat"><b>${report.totals.commands}</b><span>commands</span></div>
      <div class="stat"><b>${report.totals.edits}</b><span>edits</span></div>
      <div class="stat"><b>${report.totals.errors}</b><span>errors</span></div>
    </section>
    <section class="terminal" aria-label="Rule scoreboard">
      <div class="bar">rulekeeper report — scoreboard</div>
      ${repos || '<p class="empty">No repositories in this report.</p>'}
    </section>
    <div class="install"><span>Run your own local audit</span><code>$ npx rulekeeper scan</code></div>
  </main>`);
}

export function renderNotFoundPage(): string {
  return shell("Report not found · RuleKeeper", `<main class="wrap not-found">
    <p class="kicker">share lookup</p>
    <h1>404 · report not found</h1>
    <p class="sub">This report does not exist, was deleted, or expired after 30 days.</p>
    <section class="terminal"><p class="crit">✗ No shared report at this address.</p><p><a href="/">Return to RuleKeeper</a> or run <code>npx rulekeeper scan</code>.</p></section>
  </main>`);
}
