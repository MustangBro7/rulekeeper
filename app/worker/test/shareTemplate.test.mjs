import test from "node:test";
import assert from "node:assert/strict";
import { renderNotFoundPage, renderSharePage } from "../src/shareTemplate.ts";
import { validateReport } from "../src/reports.ts";

function adherence(rule, untestedCount = 0) {
  return {
    v: 2,
    kind: "adherence",
    generatedAt: "2026-07-19T00:00:00Z",
    window: { since: "2026-06-22", until: "2026-07-19" },
    totals: { sessions: 1, commands: 1, edits: 1, errors: 0, sources: { claude: 1, codex: 0 } },
    repos: [{ name: "repo", untestedCount, files: [], rules: [rule] }],
  };
}

const baseRule = {
  id: "untested",
  kind: "command",
  quote: "Run the checks",
  born: "2026-01-01",
  applicable: 0,
  followed: 0,
  violated: 0,
  preRule: 0,
  inContext: { followed: 0, applicable: 0 },
  outOfContext: { followed: 0, applicable: 0 },
  verdict: "untested",
  receipts: [],
};

function drift(findings, score = 72) {
  return {
    v: 2,
    kind: "drift",
    generatedAt: "2026-09-19T00:00:00Z",
    totals: { repos: 1, files: 1, claims: 11, verified: 6, errors: 1, warnings: 1, infos: 0 },
    repos: [{
      name: "repo",
      score,
      files: [{ name: "CLAUDE.md", tokensEstimate: 100, claims: 11, verified: 6, findings: findings.length, lastCommit: "2026-08-01" }],
      findings,
      verified: { path: 4, script: 2 },
    }],
  };
}

const missingScript = {
  code: "missing-script",
  severity: "error",
  file: "CLAUDE.md",
  line: 19,
  subject: "typecheck",
  message: 'no package.json script named "typecheck"',
  context: "Always run `pnpm typecheck` before finishing.",
  actual: "available: dev, check, test",
  suggestion: 'did you mean "check"?',
};

test("untested adherence rules render with a muted dot", () => {
  const html = renderSharePage(adherence(baseRule));
  assert.match(html, /· UNTESTED/);
  assert.doesNotMatch(html, /✗ UNTESTED/);
});

test("adherence repo heading reports rules not exercised", () => {
  const html = renderSharePage(adherence({ ...baseRule, verdict: "works" }, 3));
  assert.match(html, /3 not exercised/);
});

test("drift page renders severity, location, fix and doc line", () => {
  const html = renderSharePage(drift([missingScript]));
  assert.match(html, /rulekeeper drift/);
  assert.match(html, /✗ ERROR/);
  assert.match(html, /CLAUDE\.md:19/);
  assert.match(html, /did you mean &quot;check&quot;\?/);
  assert.match(html, /truth score/);
});

test("a clean drift report states that nothing drifted", () => {
  const html = renderSharePage(drift([], 100));
  assert.match(html, /Every checkable claim still matches/);
});

test("finding text is HTML-escaped", () => {
  const html = renderSharePage(drift([{ ...missingScript, subject: "<img src=x onerror=alert(1)>" }]));
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});

test("validateReport accepts both v2 kinds and rejects v1", () => {
  assert.equal(validateReport(drift([missingScript])).ok, true);
  assert.equal(validateReport(adherence({ ...baseRule, verdict: "works" })).ok, true);
  assert.equal(validateReport({ ...drift([]), v: 1 }).ok, false);
  assert.equal(validateReport({ ...drift([]), kind: "nonsense" }).ok, false);
});

test("validateReport rejects a drift report leaking an absolute path", () => {
  const leaked = validateReport(drift([{ ...missingScript, context: "see /Users/alice/secret.ts" }]));
  assert.equal(leaked.ok, false);
  assert.match(leaked.errors.join(" "), /absolute/);
});

test("validateReport allows command text inside quoted doc lines", () => {
  assert.equal(validateReport(drift([missingScript])).ok, true);
});

test("not-found page renders in the shared shell", () => {
  const html = renderNotFoundPage();
  assert.match(html, /This report has expired/);
  assert.match(html, /rulekeeper/);
});
