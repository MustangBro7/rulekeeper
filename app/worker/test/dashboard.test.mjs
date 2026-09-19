import test from "node:test";
import assert from "node:assert/strict";
import { readCookie } from "../src/auth.ts";
import { fingerprint, randomBase36, sha256Hex } from "../src/ids.ts";
import { normalizeSlug, annotate } from "../src/projects.ts";
import { delta, escapeHtml, relativeTime, scoreClass, severityPills, sparkline, trendChart } from "../src/ui.ts";
import { loginPage, projectsPage, projectPage, settingsPage, docsPage } from "../src/pages.ts";

const user = { id: "usr_1", github_id: 1, login: "octocat", name: "Octo", avatar_url: null };

function request(cookie) {
  return new Request("https://example.com/", cookie ? { headers: { Cookie: cookie } } : undefined);
}

/* ── ids ─────────────────────────────────────────── */

test("randomBase36 produces the requested length from the alphabet", () => {
  const value = randomBase36(40);
  assert.equal(value.length, 40);
  assert.match(value, /^[0-9a-z]+$/);
  assert.notEqual(value, randomBase36(40));
});

test("fingerprint is stable and distinguishes findings", async () => {
  const a = await fingerprint("missing-path", "CLAUDE.md", "src/x.ts");
  assert.equal(a, await fingerprint("missing-path", "CLAUDE.md", "src/x.ts"));
  assert.notEqual(a, await fingerprint("missing-path", "CLAUDE.md", "src/y.ts"));
  assert.notEqual(a, await fingerprint("missing-script", "CLAUDE.md", "src/x.ts"));
  assert.equal(a.length, 32);
});

test("fingerprint does not collide across field boundaries", async () => {
  assert.notEqual(await fingerprint("a", "b", "c"), await fingerprint("ab", "", "c"));
});

test("sha256Hex matches a known digest", async () => {
  assert.equal(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
});

/* ── cookies ─────────────────────────────────────── */

test("readCookie finds a value among several", () => {
  assert.equal(readCookie(request("a=1; rk_session=abc; b=2"), "rk_session"), "abc");
  assert.equal(readCookie(request("other=1"), "rk_session"), undefined);
  assert.equal(readCookie(request(), "rk_session"), undefined);
});

test("readCookie keeps values containing equals signs", () => {
  assert.equal(readCookie(request("rk_session=a=b=c"), "rk_session"), "a=b=c");
});

/* ── slugs ───────────────────────────────────────── */

test("normalizeSlug accepts repo identifiers and strips URL noise", () => {
  assert.equal(normalizeSlug("owner/repo"), "owner/repo");
  assert.equal(normalizeSlug("  owner/repo  "), "owner/repo");
  assert.equal(normalizeSlug("https://github.com/owner/repo"), "owner/repo");
  assert.equal(normalizeSlug("https://github.com/owner/repo.git"), "owner/repo");
  assert.equal(normalizeSlug("bare-name"), "bare-name");
});

test("normalizeSlug rejects paths, spaces and traversal", () => {
  assert.equal(normalizeSlug(""), null);
  assert.equal(normalizeSlug("a/b/c"), null);
  assert.equal(normalizeSlug("owner repo"), null);
  assert.equal(normalizeSlug("../etc/passwd"), null);
  assert.equal(normalizeSlug("x".repeat(200)), null);
});

/* ── annotate ────────────────────────────────────── */

test("annotate marks findings the owner has accepted", async () => {
  const finding = { code: "missing-path", file: "CLAUDE.md", subject: "src/x.ts", severity: "error", line: 1, message: "m", context: "" };
  const other = { ...finding, subject: "src/y.ts" };
  const mutes = [{ fingerprint: await fingerprint("missing-path", "CLAUDE.md", "src/x.ts") }];
  const result = await annotate([finding, other], mutes);
  assert.equal(result[0].muted, true);
  assert.equal(result[1].muted, false);
  assert.equal(result[0].fingerprint.length, 32);
});

/* ── ui primitives ───────────────────────────────── */

test("escapeHtml neutralises markup", () => {
  assert.equal(escapeHtml(`<img src=x onerror="alert('1')">`), "&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;");
});

test("scoreClass buckets by health", () => {
  assert.equal(scoreClass(100), "s-good");
  assert.equal(scoreClass(90), "s-good");
  assert.equal(scoreClass(80), "s-warn");
  assert.equal(scoreClass(40), "s-bad");
  assert.equal(scoreClass(null), "s-none");
});

test("delta describes movement against the previous run", () => {
  assert.match(delta(90, 80), /up.*10/s);
  assert.match(delta(70, 80), /down.*10/s);
  assert.match(delta(80, 80), /no change/);
  assert.match(delta(80, null), /first run/);
});

test("relativeTime degrades gracefully", () => {
  assert.equal(relativeTime("not-a-date"), "unknown");
  assert.equal(relativeTime(new Date().toISOString()), "just now");
  assert.match(relativeTime(new Date(Date.now() - 3 * 86400e3).toISOString()), /^3d ago$/);
});

test("severityPills reports clean when there is nothing to report", () => {
  assert.match(severityPills({ errors: 0, warnings: 0, infos: 0 }), /clean/);
  assert.match(severityPills({ errors: 1, warnings: 0, infos: 0 }), /1 error</);
  assert.match(severityPills({ errors: 2, warnings: 2, infos: 2 }), /2 errors.*2 warnings.*2 notes/s);
});

test("sparkline needs at least two points and stays in bounds", () => {
  assert.equal(sparkline([]), "");
  assert.equal(sparkline([50]), "");
  const svg = sparkline([0, 50, 100], 100, 20);
  assert.match(svg, /<svg/);
  for (const [, y] of svg.matchAll(/,(-?[\d.]+)/g)) {
    assert.ok(Number(y) >= -0.01 && Number(y) <= 20.01, `y ${y} out of bounds`);
  }
});

test("trendChart renders a point per run with accessible labels", () => {
  const runs = [
    { score: 90, created_at: "2026-09-01T00:00:00Z" },
    { score: 40, created_at: "2026-09-02T00:00:00Z" },
    { score: 100, created_at: "2026-09-03T00:00:00Z" },
  ];
  const svg = trendChart(runs);
  assert.equal([...svg.matchAll(/<circle/g)].length, 3);
  assert.match(svg, /90\/100 · 2026-09-01/);
  assert.match(svg, /aria-label="Truth score over the last 3 runs"/);
});

test("trendChart handles a single run without dividing by zero", () => {
  const svg = trendChart([{ score: 70, created_at: "2026-09-01T00:00:00Z" }]);
  assert.match(svg, /<circle/);
  assert.doesNotMatch(svg, /NaN/);
});

test("trendChart says so when there is nothing to plot", () => {
  assert.match(trendChart([]), /No runs yet/);
});

/* ── pages ───────────────────────────────────────── */

const project = { id: "prj_1", user_id: "usr_1", slug: "owner/repo", name: "repo", default_branch: "main", created_at: "2026-09-01T00:00:00Z" };
const run = { id: "run_1", project_id: "prj_1", kind: "drift", branch: "main", commit_sha: "abcdef1234", pr_number: null, score: 55, claims: 11, verified: 6, errors: 2, warnings: 3, infos: 0, created_at: "2026-09-19T00:00:00Z" };
const report = { v: 2, kind: "drift", generatedAt: "2026-09-19T00:00:00Z", totals: { repos: 1, files: 1, claims: 11, verified: 6, errors: 2, warnings: 3, infos: 0 }, repos: [] };

test("login page offers GitHub and no dashboard nav", () => {
  const html = loginPage();
  assert.match(html, /Continue with GitHub/);
  assert.doesNotMatch(html, /sign out/);
});

test("login page surfaces an error when given one", () => {
  assert.match(loginPage("Sign-in failed"), /Sign-in failed/);
});

test("projects page prompts for the first repository when empty", () => {
  const html = projectsPage(user, []);
  assert.match(html, /No projects yet/);
  assert.match(html, /Add a repository/);
});

test("projects page shows score, pills and trend for each project", () => {
  const html = projectsPage(user, [{ ...project, latest: run, previous_score: 100, run_count: 9 }]);
  assert.match(html, /55/);
  assert.match(html, /2 errors/);
  assert.match(html, /9 runs/);
  assert.match(html, /▼ 45/);
});

test("project page filters findings and counts them", () => {
  const findings = [
    { code: "missing-path", severity: "error", file: "CLAUDE.md", line: 3, subject: "src/a.ts", message: "gone", context: "", fingerprint: "f1", muted: false },
    { code: "unknown-env-var", severity: "warn", file: "CLAUDE.md", line: 9, subject: "API_KEY", message: "unused", context: "", fingerprint: "f2", muted: true },
  ];
  const open = projectPage(user, { project, runs: [run], latest: { run, report }, findings, filter: "open" });
  assert.match(open, /open \(1\)/);
  assert.match(open, /accepted \(1\)/);
  assert.match(open, /src\/a\.ts/);
  assert.doesNotMatch(open, /API_KEY/);

  const accepted = projectPage(user, { project, runs: [run], latest: { run, report }, findings, filter: "accepted" });
  assert.match(accepted, /API_KEY/);
  assert.match(accepted, /unmute/);
});

test("project page invites CI setup before the first run", () => {
  const html = projectPage(user, { project, runs: [], latest: null, findings: [], filter: "open" });
  assert.match(html, /Waiting for the first run/);
  assert.match(html, /Set up CI/);
});

test("project page escapes hostile finding content", () => {
  const findings = [{ code: "missing-path", severity: "error", file: "CLAUDE.md", line: 1, subject: "<script>alert(1)</script>", message: "x", context: "", fingerprint: "f", muted: false }];
  const html = projectPage(user, { project, runs: [run], latest: { run, report }, findings, filter: "open" });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test("settings page shows the new token exactly once and the workflow", () => {
  const html = settingsPage(user, project, [], [], "https://rk.example", "rk_secret_value");
  assert.match(html, /rk_secret_value/);
  assert.match(html, /copy it now/);
  assert.match(html, /\.github\/workflows/);
  assert.match(html, /MustangBro7\/rulekeeper@v2/);
});

test("settings page lists tokens by prefix, never in full", () => {
  const html = settingsPage(user, project, [{ id: "tok_1", name: "ci", prefix: "rk_abcdefgh", created_at: run.created_at, last_used_at: null }], [], "https://rk.example");
  assert.match(html, /rk_abcdefgh…/);
  assert.match(html, /revoke/);
  assert.match(html, /never/);
});

test("docs page explains what fails a build", () => {
  const html = docsPage(user, "https://rk.example");
  assert.match(html, /rulekeeper drift/);
  assert.match(html, /with <code>strict<\/code>/);
});
