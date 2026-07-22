import test from "node:test";
import assert from "node:assert/strict";
import { distinctiveMarkers } from "../dist/discover.js";
import { scoreRule } from "../dist/score.js";

const content = `# Rules\nShort\nThis unusually specific instruction must be visible to every coding agent session.\nAnother distinctive instruction about running checks before delivery.\nThird distinctive sentence about keeping local evidence private.`;
const file = { path: "/tmp/repo/CLAUDE.md", name: "CLAUDE.md", content, markers: distinctiveMarkers(content), tokensEstimate: 10 };

function session(id, lastTs, rawText) {
  return { source: "codex", id, path: "", cwd: "/tmp/repo", firstTs: lastTs, lastTs, commands: [], edits: [], reads: [], userTurns: 1, assistantMessages: 1, errors: 0, interrupts: 0, rawText };
}

test("delivery uses the three distinctive markers", () => {
  assert.equal(file.markers.length, 3);
  const rule = { id: "delivery", kind: "delivery", quote: "Deliver CLAUDE.md", file };
  const repo = { root: "/tmp/repo", name: "repo", files: [file], sessions: [session("aaaaaaaa1", "2026-07-02T00:00:00Z", file.markers[1]), session("bbbbbbbb2", "2026-07-03T00:00:00Z", "no instructions here")] };
  const result = scoreRule(rule, repo, () => "2026-01-01T00:00:00Z");
  assert.equal(result.applicable, 2);
  assert.equal(result.followed, 1);
  assert.equal(result.verdict, "not-delivered");
});

test("sessions ending before rule birth are quarantined", () => {
  const rule = { id: "delivery", kind: "delivery", quote: "Deliver CLAUDE.md", file };
  const repo = { root: "/tmp/repo", name: "repo", files: [file], sessions: [session("preprepre", "2026-01-01T00:00:00Z", ""), session("postpost", "2026-07-03T00:00:00Z", "")] };
  const result = scoreRule(rule, repo, () => "2026-06-01T00:00:00Z");
  assert.equal(result.preRule, 1);
  assert.equal(result.applicable, 1);
  assert.equal(result.violated, 1);
});
