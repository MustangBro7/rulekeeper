import test from "node:test";
import assert from "node:assert/strict";
import { buildSharePayload } from "../dist/share.js";

function rule(id, verdict = "works", evidenceSize = 0, receiptCount = 1) {
  return {
    id,
    kind: "command",
    quote: "Run the project checks",
    born: "2026-01-01",
    applicable: 1,
    followed: verdict === "works" ? 1 : 0,
    violated: verdict === "broken" ? 1 : 0,
    preRule: 0,
    inContext: { followed: 0, applicable: 0 },
    outOfContext: { followed: 0, applicable: 0 },
    verdict,
    receipts: Array.from({ length: receiptCount }, (_, index) => ({
      sessionId8: `session${index}`,
      date: "2026-07-01",
      evidence: "x".repeat(evidenceSize),
    })),
  };
}

function report(repos) {
  return {
    v: 1,
    generatedAt: "2026-07-19T00:00:00Z",
    window: { since: "2026-06-22", until: "2026-07-19" },
    totals: { sessions: 1, commands: 1, edits: 1, errors: 0, sources: { claude: 1, codex: 0 } },
    repos: repos.map(({ name, rules }) => ({ name, files: [], rules })),
  };
}

function assertSmall(result) {
  assert.ok(Buffer.byteLength(result.payload) < 60_000);
  assert.deepEqual(JSON.parse(result.payload), result.report);
}

test("share payload drops untested rules before other trimming", () => {
  const input = report([{ name: "repo", rules: [rule("works"), rule("untested", "untested")] }]);
  const result = buildSharePayload(input);
  assertSmall(result);
  assert.equal(result.report.trimmed, true);
  assert.equal(result.report.omittedRepos, 0);
  assert.equal(result.report.omittedRules, 1);
  assert.equal(result.report.repos[0].untestedCount, 1);
  assert.deepEqual(result.report.repos[0].rules.map(item => item.id), ["works"]);
});

test("share payload omits repos containing only untested rules", () => {
  const input = report([
    { name: "untested-only", rules: [rule("untested", "untested")] },
    { name: "tested", rules: [rule("works"), rule("another-untested", "untested")] },
  ]);
  const result = buildSharePayload(input);
  assertSmall(result);
  assert.equal(result.report.omittedRepos, 1);
  assert.equal(result.report.omittedRules, 2);
  assert.deepEqual(result.report.repos.map(repo => repo.name), ["tested"]);
  assert.equal(result.report.repos[0].untestedCount, 1);
});

test("share payload caps receipts at three before dropping rules", () => {
  const input = report([{ name: "repo", rules: Array.from({ length: 4 }, (_, i) => rule(`rule-${i}`, "works", 4_000, 4)) }]);
  const result = buildSharePayload(input);
  assertSmall(result);
  assert.equal(result.report.omittedRules, 0);
  assert.ok(result.report.repos[0].rules.every(item => item.receipts.length === 3));
});

test("share payload keeps the most interesting 25 rules per repo", () => {
  const works = Array.from({ length: 25 }, (_, i) => rule(`works-${i}`, "works", 2_000));
  const broken = Array.from({ length: 5 }, (_, i) => rule(`broken-${i}`, "broken", 2_000));
  const result = buildSharePayload(report([{ name: "repo", rules: [...works, ...broken] }]));
  assertSmall(result);
  assert.equal(result.report.omittedRules, 5);
  assert.equal(result.report.repos[0].rules.length, 25);
  assert.deepEqual(result.report.repos[0].rules.slice(0, 5).map(item => item.id), broken.map(item => item.id));
});

test("share payload drops repos with the fewest rules last", () => {
  const makeRules = (count, prefix) => Array.from({ length: count }, (_, i) => rule(`${prefix}-${i}`, "works", 2_000));
  const input = report([
    { name: "small", rules: makeRules(10, "small") },
    { name: "medium", rules: makeRules(20, "medium") },
    { name: "large", rules: makeRules(25, "large") },
  ]);
  const result = buildSharePayload(input);
  assertSmall(result);
  assert.equal(result.report.omittedRepos, 2);
  assert.equal(result.report.omittedRules, 30);
  assert.deepEqual(result.report.repos.map(repo => repo.name), ["large"]);
});
