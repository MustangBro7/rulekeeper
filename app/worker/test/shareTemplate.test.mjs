import test from "node:test";
import assert from "node:assert/strict";
import { renderSharePage } from "../src/shareTemplate.ts";

function report(rule, untestedCount = 0) {
  return {
    v: 1,
    generatedAt: "2026-07-19T00:00:00Z",
    window: { since: "2026-06-22", until: "2026-07-19" },
    totals: { sessions: 1, commands: 1, edits: 1, errors: 0, sources: { claude: 1, codex: 0 } },
    repos: [{ name: "repo", untestedCount, files: [], rules: [rule] }],
  };
}

const untestedRule = {
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

test("untested rules render with a muted dot", () => {
  const html = renderSharePage(report(untestedRule));
  assert.match(html, /class="verdict muted">· UNTESTED/);
  assert.doesNotMatch(html, /✗ UNTESTED/);
});

test("repo headings mention rules not exercised in the window", () => {
  const html = renderSharePage(report({ ...untestedRule, verdict: "works" }, 3));
  assert.match(html, /class="meta">\+3 rules not exercised in this window<\/p>/);
});
