import test from "node:test";
import assert from "node:assert/strict";
import { validateRedaction } from "../dist/report/json.js";

const clean = { v: 1, generatedAt: "2026-07-19T00:00:00Z", window: { since: "2026-06-22", until: "2026-07-19" }, totals: { sessions: 1, commands: 1, edits: 1, errors: 0, sources: { claude: 1, codex: 0 } }, repos: [{ name: "repo", files: [{ name: "CLAUDE.md", tokensEstimate: 10, sessionsTouching: 1, sessionsInContext: 1 }], rules: [{ id: "test", kind: "command", quote: "Run npm test", born: "2026-01-01T00:00:00Z", applicable: 1, followed: 1, violated: 0, preRule: 0, inContext: { followed: 1, applicable: 1 }, outOfContext: { followed: 0, applicable: 0 }, verdict: "works", receipts: [{ sessionId8: "abcdefgh", date: "2026-07-01", evidence: "required command observed" }] }] }] };

test("accepts the stable redacted schema", () => assert.deepEqual(validateRedaction(clean), []));
test("rejects absolute paths", () => assert.ok(validateRedaction({ ...clean, leak: "/Users/alice/private.ts" }).length));
test("rejects home paths", () => assert.ok(validateRedaction({ ...clean, leak: "~/private.ts" }).length));
test("rejects emails", () => assert.ok(validateRedaction({ ...clean, leak: "alice@example.com" }).length));
test("rejects command strings outside rule quotes", () => assert.ok(validateRedaction({ ...clean, leak: "npm test" }).length));
