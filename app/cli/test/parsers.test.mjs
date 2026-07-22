import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseClaudeText } from "../dist/parse/claude.js";
import { parseCodexText } from "../dist/parse/codex.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

test("Claude merges subagent JSONL and joins tool errors", () => {
  const main = readFileSync(join(fixtures, "claude-main.jsonl"), "utf8");
  const sub = readFileSync(join(fixtures, "claude-subagent.jsonl"), "utf8");
  const session = parseClaudeText([main, sub], "1234567890");
  assert.equal(session.userTurns, 1);
  assert.equal(session.commands.length, 1);
  assert.equal(session.commands[0].exitError, true);
  assert.equal(session.errors, 1);
  assert.equal(session.edits.length, 2);
  assert.equal(session.reads.length, 1);
  assert.match(session.rawText, /sub\.ts/);
});

test("Codex handles all command and patch encodings", () => {
  const session = parseCodexText(readFileSync(join(fixtures, "codex.jsonl"), "utf8"), "abcdefgh123");
  assert.deepEqual(session.commands.map(command => command.cmd), ["npm test", "pnpm run check", "cargo test"]);
  assert.deepEqual(session.commands.map(command => command.workdir), ["/tmp/example/pkg", "/tmp/example/web", "/tmp/example/rust"]);
  assert.equal(session.commands[0].exitError, true);
  assert.equal(session.errors, 1);
  assert.equal(session.edits.length, 2);
  assert.equal(session.edits[0].content, "new");
  assert.equal(session.edits[1].content, "added only");
  assert.match(session.edits[0].path, /src\/a\.ts$/);
});
