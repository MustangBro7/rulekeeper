import type { User } from "./auth.ts";
import type { DriftFinding, DriftReport } from "./reports.ts";
import type { Mute, Project, ProjectSummary, Run } from "./projects.ts";
import {
  delta,
  escapeHtml,
  relativeTime,
  scoreClass,
  severityPills,
  shell,
  sparkline,
  trendChart,
} from "./ui.ts";

const SEV_LABEL: Record<string, { label: string; cls: string }> = {
  error: { label: "✗ ERROR", cls: "e" },
  warn: { label: "⚠ WARN", cls: "w" },
  info: { label: "· NOTE", cls: "i" },
};

export function loginPage(error?: string): string {
  return shell(
    { title: "Sign in — RuleKeeper", bare: true },
    `<div class="login">
      <a class="brand" href="/" style="justify-content:center;margin-bottom:26px"><b aria-hidden="true">▚</b> rulekeeper</a>
      <h1>Track instruction drift over time.</h1>
      <p>Sign in with GitHub to connect a repository, wire up CI, and watch whether your agent instructions stay true.</p>
      ${error ? `<p class="notice err">${escapeHtml(error)}</p>` : ""}
      <a class="btn" href="/auth/github">Continue with GitHub</a>
      <p class="meta" style="margin-top:22px">We only request <code>read:user</code>. RuleKeeper never reads your code — reports are generated on your machine or in your CI runner.</p>
    </div>`,
  );
}

export function projectsPage(user: User, projects: ProjectSummary[], flash?: string, error?: string): string {
  const cards = projects
    .map((project) => {
      const score = project.latest?.score ?? null;
      const trend = project.latest
        ? `${delta(project.latest.score, project.previous_score)}`
        : `<span class="delta flat">awaiting first run</span>`;
      return `<a class="pcard" href="/app/p/${escapeHtml(project.id)}">
        <div class="pcard-top">
          <div>
            <h3>${escapeHtml(project.name)}</h3>
            <span class="slug">${escapeHtml(project.slug)}</span>
          </div>
          <div class="score ${scoreClass(score)}">${score === null ? "—" : score}<small>/100</small></div>
        </div>
        <div class="pcard-foot">
          <div class="pills">${
            project.latest
              ? severityPills(project.latest)
              : `<span class="pill">no runs yet</span>`
          }</div>
          ${trend}
        </div>
        <div class="pcard-foot">
          <span class="meta">${project.latest ? `updated ${escapeHtml(relativeTime(project.latest.created_at))}` : "never run"}</span>
          <span class="meta">${project.run_count} run${project.run_count === 1 ? "" : "s"}</span>
        </div>
      </a>`;
    })
    .join("");

  const body = projects.length
    ? `<div class="projects">${cards}</div>`
    : `<div class="panel"><div class="empty">
        <h3>No projects yet</h3>
        <p>Add a repository, drop the GitHub Action into it, and every push will report whether its instruction files still match the code.</p>
      </div></div>`;

  return shell(
    { title: "Projects — RuleKeeper", user, active: "projects" },
    `<div class="page-head">
      <div>
        <h1>Projects</h1>
        <p class="lede">Every tracked repository, with the truth score from its most recent run on the default branch.</p>
      </div>
    </div>
    ${flash ? `<p class="notice ok">${escapeHtml(flash)}</p>` : ""}
    ${error ? `<p class="notice err">${escapeHtml(error)}</p>` : ""}
    <div class="panel" style="margin-bottom:22px">
      <div class="panel-head"><h2>Add a repository</h2></div>
      <div class="panel-body">
        <form method="post" action="/app/projects" class="row">
          <div class="field">
            <label for="slug">Repository</label>
            <input id="slug" name="slug" type="text" placeholder="owner/repo" required autocomplete="off">
            <p class="hint">Just an identifier for the dashboard — we never clone it.</p>
          </div>
          <div class="field" style="flex:0 1 180px">
            <label for="branch">Default branch</label>
            <input id="branch" name="default_branch" type="text" value="main" autocomplete="off">
          </div>
          <button class="btn" type="submit">Add project</button>
        </form>
      </div>
    </div>
    ${body}`,
  );
}

function findingRow(
  projectId: string,
  finding: DriftFinding & { fingerprint: string; muted: boolean },
): string {
  const sev = SEV_LABEL[finding.severity] ?? SEV_LABEL.info!;
  const where = finding.line > 0 ? `${finding.file}:${finding.line}` : finding.file;
  const action = finding.muted
    ? `<form method="post" action="/app/p/${escapeHtml(projectId)}/unmute">
         <input type="hidden" name="fingerprint" value="${escapeHtml(finding.fingerprint)}">
         <button class="btn btn-ghost btn-sm" type="submit">unmute</button>
       </form>`
    : `<form method="post" action="/app/p/${escapeHtml(projectId)}/mute">
         <input type="hidden" name="code" value="${escapeHtml(finding.code)}">
         <input type="hidden" name="file" value="${escapeHtml(finding.file)}">
         <input type="hidden" name="subject" value="${escapeHtml(finding.subject)}">
         <button class="btn btn-ghost btn-sm" type="submit">accept</button>
       </form>`;

  return `<div class="finding${finding.muted ? " is-muted" : ""}">
    <div>
      <span class="sev ${sev.cls}">${sev.label}</span>
      <p class="where">${escapeHtml(where)}</p>
      ${finding.muted ? `<p class="where">accepted</p>` : ""}
    </div>
    <div>
      <h4>${escapeHtml(finding.subject)}</h4>
      <p>${escapeHtml(finding.message)}</p>
      ${finding.actual ? `<p class="actual">repo: ${escapeHtml(finding.actual)}</p>` : ""}
      ${finding.suggestion ? `<p class="fix">→ ${escapeHtml(finding.suggestion)}</p>` : ""}
      ${finding.context ? `<p class="doc">doc: ${escapeHtml(finding.context)}</p>` : ""}
    </div>
    <div class="actions">${action}</div>
  </div>`;
}

export interface ProjectViewData {
  project: Project;
  runs: Run[];
  latest: { run: Run; report: DriftReport } | null;
  findings: Array<DriftFinding & { fingerprint: string; muted: boolean }>;
  filter: string;
  flash?: string | undefined;
}

export function projectPage(user: User, data: ProjectViewData): string {
  const { project, runs, latest, findings, filter } = data;
  const chronological = [...runs].reverse();
  const score = latest?.run.score ?? null;

  const visible = findings.filter((finding) => {
    if (filter === "all") return true;
    if (filter === "accepted") return finding.muted;
    if (filter === "open") return !finding.muted;
    return finding.severity === filter && !finding.muted;
  });

  const counts = {
    open: findings.filter((f) => !f.muted).length,
    error: findings.filter((f) => f.severity === "error" && !f.muted).length,
    warn: findings.filter((f) => f.severity === "warn" && !f.muted).length,
    info: findings.filter((f) => f.severity === "info" && !f.muted).length,
    accepted: findings.filter((f) => f.muted).length,
  };

  const tab = (key: string, label: string) =>
    `<a href="/app/p/${escapeHtml(project.id)}?filter=${key}" aria-current="${filter === key}">${label}</a>`;

  const history = runs.length
    ? `<table>
        <thead><tr><th>When</th><th>Branch</th><th>Commit</th><th class="num">Score</th><th class="num">Errors</th><th class="num">Warnings</th></tr></thead>
        <tbody>${runs
          .slice(0, 15)
          .map(
            (run) => `<tr>
              <td>${escapeHtml(relativeTime(run.created_at))}</td>
              <td class="mono">${escapeHtml(run.branch ?? "—")}${run.pr_number ? ` <span class="meta">#${run.pr_number}</span>` : ""}</td>
              <td class="mono">${escapeHtml((run.commit_sha ?? "—").slice(0, 7))}</td>
              <td class="num ${scoreClass(run.score)}">${run.score}</td>
              <td class="num">${run.errors}</td>
              <td class="num">${run.warnings}</td>
            </tr>`,
          )
          .join("")}</tbody>
      </table>`
    : `<p class="empty">No runs recorded yet.</p>`;

  const findingsBody = latest
    ? visible.length
      ? visible.map((finding) => findingRow(project.id, finding)).join("")
      : `<p class="empty">Nothing here. ${filter === "open" && counts.open === 0 ? "Every claim in this repository still checks out." : "Try another filter."}</p>`
    : `<div class="empty">
        <h3>Waiting for the first run</h3>
        <p>Once CI (or your laptop) pushes a report, the findings land here.</p>
        <a class="btn" href="/app/p/${escapeHtml(project.id)}/settings">Set up CI</a>
      </div>`;

  return shell(
    { title: `${project.name} — RuleKeeper`, user, active: "projects" },
    `<div class="page-head">
      <div>
        <p class="crumb"><a href="/app">projects</a> / ${escapeHtml(project.slug)}</p>
        <h1>${escapeHtml(project.name)}</h1>
        <p class="lede">Tracking <code>${escapeHtml(project.default_branch)}</code> · ${runs.length} run${runs.length === 1 ? "" : "s"} recorded.</p>
      </div>
      <div style="display:flex;gap:10px;align-items:center">
        <a class="btn btn-ghost" href="/app/p/${escapeHtml(project.id)}/settings">Settings &amp; CI</a>
      </div>
    </div>
    ${data.flash ? `<p class="notice ok">${escapeHtml(data.flash)}</p>` : ""}

    <div class="stats">
      <div class="stat"><b class="${scoreClass(score)}">${score === null ? "—" : score}</b><span>truth score${latest ? ` · ${delta(latest.run.score, runs[1]?.score ?? null).replace(/<[^>]+>/g, "")}` : ""}</span></div>
      <div class="stat"><b>${latest?.run.claims ?? 0}</b><span>claims checked</span></div>
      <div class="stat"><b class="s-bad">${counts.error}</b><span>open errors</span></div>
      <div class="stat"><b class="s-warn">${counts.warn}</b><span>open warnings</span></div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h2>Truth score over time</h2>
        <span class="meta">${chronological.length} run${chronological.length === 1 ? "" : "s"}</span>
      </div>
      <div class="panel-body">${trendChart(chronological.map((run) => ({ score: run.score, created_at: run.created_at })))}</div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h2>Findings</h2>
        <div class="filters">
          ${tab("open", `open (${counts.open})`)}
          ${tab("error", `errors (${counts.error})`)}
          ${tab("warn", `warnings (${counts.warn})`)}
          ${tab("info", `notes (${counts.info})`)}
          ${tab("accepted", `accepted (${counts.accepted})`)}
          ${tab("all", "all")}
        </div>
      </div>
      ${findingsBody}
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Run history</h2></div>
      ${history}
    </div>`,
  );
}

export function settingsPage(
  user: User,
  project: Project,
  tokens: Array<{ id: string; name: string; prefix: string; created_at: string; last_used_at: string | null }>,
  mutes: Mute[],
  origin: string,
  newToken?: string,
  flash?: string,
): string {
  const workflow = `name: rulekeeper
on: [push, pull_request]

jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: MustangBro7/rulekeeper@v2
        with:
          token: \${{ secrets.RULEKEEPER_TOKEN }}
          strict: false`;

  const manual = `npx rulekeeper drift --report \\
  --token "$RULEKEEPER_TOKEN" \\
  --api ${origin}`;

  const tokenRows = tokens.length
    ? `<table>
        <thead><tr><th>Name</th><th>Token</th><th>Created</th><th>Last used</th><th></th></tr></thead>
        <tbody>${tokens
          .map(
            (token) => `<tr>
              <td>${escapeHtml(token.name)}</td>
              <td class="mono">${escapeHtml(token.prefix)}…</td>
              <td>${escapeHtml(relativeTime(token.created_at))}</td>
              <td>${token.last_used_at ? escapeHtml(relativeTime(token.last_used_at)) : "<span class='meta'>never</span>"}</td>
              <td style="text-align:right">
                <form method="post" action="/app/p/${escapeHtml(project.id)}/tokens/${escapeHtml(token.id)}/revoke">
                  <button class="btn btn-danger btn-sm" type="submit">revoke</button>
                </form>
              </td>
            </tr>`,
          )
          .join("")}</tbody>
      </table>`
    : `<p class="empty">No tokens yet. Create one to let CI report in.</p>`;

  const muteRows = mutes.length
    ? `<table>
        <thead><tr><th>Finding</th><th>Where</th><th>Accepted</th><th></th></tr></thead>
        <tbody>${mutes
          .map(
            (mute) => `<tr>
              <td><span class="mono">${escapeHtml(mute.code)}</span> — ${escapeHtml(mute.subject)}</td>
              <td class="mono">${escapeHtml(mute.file)}</td>
              <td>${escapeHtml(relativeTime(mute.created_at))}</td>
              <td style="text-align:right">
                <form method="post" action="/app/p/${escapeHtml(project.id)}/unmute">
                  <input type="hidden" name="fingerprint" value="${escapeHtml(mute.fingerprint)}">
                  <button class="btn btn-ghost btn-sm" type="submit">unmute</button>
                </form>
              </td>
            </tr>`,
          )
          .join("")}</tbody>
      </table>`
    : `<p class="empty">Nothing accepted. Findings you accept on the project page appear here and stop failing the build.</p>`;

  return shell(
    { title: `${project.name} settings — RuleKeeper`, user, active: "projects" },
    `<div class="page-head">
      <div>
        <p class="crumb"><a href="/app">projects</a> / <a href="/app/p/${escapeHtml(project.id)}">${escapeHtml(project.slug)}</a> / settings</p>
        <h1>Settings &amp; CI</h1>
        <p class="lede">Wire this repository up so every push reports whether its instruction files still match the code.</p>
      </div>
    </div>
    ${flash ? `<p class="notice ok">${escapeHtml(flash)}</p>` : ""}
    ${
      newToken
        ? `<div class="notice ok">
             <strong>Token created — copy it now, it is not shown again.</strong>
             <div class="token" style="margin-top:10px">
               <code id="new-token">${escapeHtml(newToken)}</code>
               <button class="btn btn-sm" type="button" data-copy-target="new-token">copy</button>
             </div>
           </div>`
        : ""
    }

    <div class="panel">
      <div class="panel-head"><h2>Connect CI</h2></div>
      <div class="panel-body">
        <ol class="steps">
          <li>
            <h3>Create an ingest token</h3>
            <p>CI uses this to report results. Store it as a repository secret named <code>RULEKEEPER_TOKEN</code>.</p>
            <form method="post" action="/app/p/${escapeHtml(project.id)}/tokens" class="row">
              <div class="field" style="flex:0 1 240px">
                <label for="tname" class="sr-only">Token name</label>
                <input id="tname" name="name" type="text" placeholder="github-actions" value="github-actions">
              </div>
              <button class="btn" type="submit">Create token</button>
            </form>
          </li>
          <li>
            <h3>Add the workflow</h3>
            <p>Commit this to <code>.github/workflows/rulekeeper.yml</code>.</p>
            <div class="copywrap">
              <button class="copy" type="button" data-copy-target="wf">copy</button>
              <pre class="code" id="wf">${escapeHtml(workflow)}</pre>
            </div>
          </li>
          <li>
            <h3>Or report from anywhere</h3>
            <p>Any CI system works — the CLI just needs the token.</p>
            <div class="copywrap">
              <button class="copy" type="button" data-copy-target="manual">copy</button>
              <pre class="code" id="manual">${escapeHtml(manual)}</pre>
            </div>
          </li>
        </ol>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Ingest tokens</h2></div>
      ${tokenRows}
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Accepted findings</h2><span class="meta">${mutes.length} accepted</span></div>
      ${muteRows}
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Danger zone</h2></div>
      <div class="panel-body">
        <p class="lede" style="margin-bottom:14px">Deleting a project removes its run history, tokens and accepted findings. This cannot be undone.</p>
        <form method="post" action="/app/p/${escapeHtml(project.id)}/delete" onsubmit="return confirm('Delete ${escapeHtml(project.slug)} and all its history?')">
          <button class="btn btn-danger" type="submit">Delete project</button>
        </form>
      </div>
    </div>`,
  );
}

export function docsPage(user: User, origin: string): string {
  const install = "npm i -g https://github.com/MustangBro7/rulekeeper/releases/latest/download/rulekeeper-cli.tgz";
  const action = `- uses: MustangBro7/rulekeeper@v2
  with:
    token: \${{ secrets.RULEKEEPER_TOKEN }}
    strict: false       # also fail on warnings
    working-directory: . # where CLAUDE.md lives`;

  return shell(
    { title: "Setup — RuleKeeper", user, active: "docs" },
    `<div class="page-head">
      <div>
        <h1>Setup</h1>
        <p class="lede">RuleKeeper runs in your CI, checks your instruction files against the code, fails the build on errors, and reports the result here.</p>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>How it fits together</h2></div>
      <div class="panel-body">
        <ol class="steps">
          <li><h3>Add a project</h3><p>Each tracked repository gets its own history, ingest tokens and accepted-findings list.</p><a class="btn btn-ghost btn-sm" href="/app">Go to projects</a></li>
          <li><h3>Create a token and add the Action</h3><p>The workflow runs <code>rulekeeper drift</code> on every push and pull request, then reports the result.</p>
            <div class="copywrap"><button class="copy" type="button" data-copy-target="act">copy</button><pre class="code" id="act">${escapeHtml(action)}</pre></div>
          </li>
          <li><h3>Watch the score</h3><p>The project page shows the truth score over time. A drop means a doc started lying to your agents.</p></li>
        </ol>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Run it locally</h2></div>
      <div class="panel-body">
        <div class="copywrap"><button class="copy" type="button" data-copy-target="cli">copy</button><pre class="code" id="cli">${escapeHtml(`${install}

rulekeeper drift                    # check the current repo
rulekeeper drift --strict           # fail on warnings too
rulekeeper drift --report --token rk_… --api ${origin}`)}</pre></div>
        <p class="hint" style="margin-top:14px">The CLI has zero runtime dependencies and reads no session logs in <code>drift</code> mode. Reports contain repository-relative paths, counts and quotes from your own docs — never absolute paths, file contents or credentials.</p>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>What fails a build</h2></div>
      <table>
        <thead><tr><th>Severity</th><th>Meaning</th><th>Fails build</th></tr></thead>
        <tbody>
          <tr><td><span class="mono s-bad">error</span></td><td>A path, script or target the doc names does not exist.</td><td>always</td></tr>
          <tr><td><span class="mono s-warn">warn</span></td><td>A dependency, env var or package manager that disagrees with the repo.</td><td>with <code>strict</code></td></tr>
          <tr><td><span class="mono">info</span></td><td>Staleness and coverage signals worth a look.</td><td>never</td></tr>
        </tbody>
      </table>
    </div>`,
  );
}

export function errorPage(status: number, title: string, message: string, user?: User | null): string {
  return shell(
    { title: `${status} — RuleKeeper`, ...(user ? { user } : {}) },
    `<div class="page-head"><div>
      <p class="crumb">${status}</p>
      <h1>${escapeHtml(title)}</h1>
      <p class="lede">${escapeHtml(message)}</p>
      <p style="margin-top:20px"><a class="btn btn-ghost" href="/app">Back to projects</a></p>
    </div></div>`,
  );
}
