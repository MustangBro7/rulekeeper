import type { User } from "./auth.ts";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export interface ShellOptions {
  title: string;
  user?: User | null;
  active?: "projects" | "docs" | null;
  bare?: boolean;
}

export function shell(options: ShellOptions, body: string): string {
  const nav = options.user
    ? `<nav class="top-nav">
          <a href="/app"${options.active === "projects" ? ' aria-current="page"' : ""}>projects</a>
          <a href="/app/docs"${options.active === "docs" ? ' aria-current="page"' : ""}>setup</a>
          <span class="who">${
            options.user.avatar_url
              ? `<img class="avatar" src="${escapeHtml(options.user.avatar_url)}" alt="" width="26" height="26">`
              : ""
          }<span>${escapeHtml(options.user.login)}</span></span>
          <form method="post" action="/auth/logout" style="margin:0"><button class="btn btn-ghost btn-sm" type="submit">sign out</button></form>
        </nav>`
    : `<nav class="top-nav"><a href="/">home</a><a class="btn btn-sm" href="/auth/github">Sign in</a></nav>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#07090a">
  <meta name="robots" content="noindex">
  <title>${escapeHtml(options.title)}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/app.css">
  <script src="/app.js" defer></script>
</head>
<body>
  ${options.bare ? "" : `<header class="top"><div class="wrap top-in"><a class="brand" href="/app"><b aria-hidden="true">▚</b> rulekeeper</a>${nav}</div></header>`}
  <main><div class="wrap">${body}</div></main>
  <footer><div class="wrap foot-in">
    <span>▚ rulekeeper — evidence, not vibes</span>
    <span><a href="/">marketing site</a> · <a href="https://github.com/MustangBro7/rulekeeper" rel="noopener">github ↗</a></span>
  </div></footer>
</body>
</html>`;
}

export function scoreClass(score: number | null | undefined): string {
  if (score === null || score === undefined) return "s-none";
  if (score >= 90) return "s-good";
  if (score >= 70) return "s-warn";
  return "s-bad";
}

export function notice(kind: "ok" | "err", message: string): string {
  return `<p class="notice ${kind}">${escapeHtml(message)}</p>`;
}

export function severityPills(counts: { errors: number; warnings: number; infos: number }): string {
  if (counts.errors === 0 && counts.warnings === 0 && counts.infos === 0) {
    return `<span class="pill ok">✓ clean</span>`;
  }
  const pills: string[] = [];
  if (counts.errors > 0) pills.push(`<span class="pill e">${counts.errors} error${counts.errors === 1 ? "" : "s"}</span>`);
  if (counts.warnings > 0) pills.push(`<span class="pill w">${counts.warnings} warning${counts.warnings === 1 ? "" : "s"}</span>`);
  if (counts.infos > 0) pills.push(`<span class="pill i">${counts.infos} note${counts.infos === 1 ? "" : "s"}</span>`);
  return pills.join("");
}

export function delta(current: number, previous: number | null): string {
  if (previous === null) return `<span class="delta flat">first run</span>`;
  const change = current - previous;
  if (change === 0) return `<span class="delta flat">no change</span>`;
  const direction = change > 0 ? "up" : "down";
  return `<span class="delta ${direction}">${change > 0 ? "▲" : "▼"} ${Math.abs(change)}</span>`;
}

export function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "unknown";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toISOString().slice(0, 10);
}

/** Inline sparkline for a project card. Oldest value first. */
export function sparkline(scores: number[], width = 92, height = 26): string {
  if (scores.length < 2) return "";
  const max = 100;
  const min = Math.min(0, ...scores);
  const span = max - min || 1;
  const step = width / (scores.length - 1);
  const points = scores.map((score, index) => {
    const x = index * step;
    const y = height - ((score - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `<svg class="spark" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><path d="M${points.join(" L")}"/></svg>`;
}

/** Full trend chart for the project page. Oldest value first. */
export function trendChart(runs: Array<{ score: number; created_at: string }>): string {
  if (runs.length === 0) return `<p class="empty">No runs yet.</p>`;
  const width = 900;
  const height = 240;
  const padLeft = 34;
  const padRight = 14;
  const padTop = 16;
  const padBottom = 26;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;
  const step = runs.length > 1 ? plotW / (runs.length - 1) : 0;

  const x = (index: number) => padLeft + (runs.length > 1 ? index * step : plotW / 2);
  const y = (score: number) => padTop + plotH - (Math.max(0, Math.min(100, score)) / 100) * plotH;

  const points = runs.map((run, index) => `${x(index).toFixed(1)},${y(run.score).toFixed(1)}`);
  const line = `M${points.join(" L")}`;
  const area = `${line} L${x(runs.length - 1).toFixed(1)},${(padTop + plotH).toFixed(1)} L${x(0).toFixed(1)},${(padTop + plotH).toFixed(1)} Z`;

  const gridlines = [0, 25, 50, 75, 100]
    .map((value) => {
      const gy = y(value).toFixed(1);
      return `<line class="grid" x1="${padLeft}" y1="${gy}" x2="${width - padRight}" y2="${gy}"/><text class="axis" x="${padLeft - 7}" y="${Number(gy) + 3}" text-anchor="end">${value}</text>`;
    })
    .join("");

  const dots = runs
    .map((run, index) => {
      const label = `${run.score}/100 · ${new Date(run.created_at).toISOString().slice(0, 10)}`;
      return `<circle class="dot" cx="${x(index).toFixed(1)}" cy="${y(run.score).toFixed(1)}" r="${runs.length > 40 ? 2 : 3.5}"><title>${escapeHtml(label)}</title></circle>`;
    })
    .join("");

  const first = runs[0];
  const last = runs[runs.length - 1];
  const labels = first && last
    ? `<text class="axis" x="${padLeft}" y="${height - 8}">${escapeHtml(new Date(first.created_at).toISOString().slice(0, 10))}</text>
       <text class="axis" x="${width - padRight}" y="${height - 8}" text-anchor="end">${escapeHtml(new Date(last.created_at).toISOString().slice(0, 10))}</text>`
    : "";

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Truth score over the last ${runs.length} runs">
    <defs><linearGradient id="scoreFill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#3ddc97" stop-opacity="0.26"/>
      <stop offset="100%" stop-color="#3ddc97" stop-opacity="0"/>
    </linearGradient></defs>
    ${gridlines}
    <path class="area" d="${area}"/>
    <path class="line" d="${line}"/>
    ${dots}
    ${labels}
  </svg>`;
}
