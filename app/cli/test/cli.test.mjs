import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const entry = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

function run(binary, args, options = {}) {
  return execFileSync(process.execPath, [binary, ...args], { encoding: "utf8", ...options });
}

/** npm links the bin into node_modules/.bin, so the CLI is always started through a symlink. */
function symlinkedEntry() {
  const dir = mkdtempSync(join(tmpdir(), "rulekeeper-bin-"));
  const link = join(dir, "rulekeeper");
  symlinkSync(entry, link);
  return link;
}

test("runs when invoked directly", () => {
  assert.equal(run(entry, ["--version"]).trim(), "2.0.0");
});

test("runs when invoked through a symlink, as a global install does", () => {
  assert.equal(run(symlinkedEntry(), ["--version"]).trim(), "2.0.0");
});

test("the demo produces output through a symlink", () => {
  const output = run(symlinkedEntry(), ["demo", "drift", "--no-color"]);
  assert.match(output, /rulekeeper drift/);
  assert.match(output, /truth score/);
});

test("help lists both checks", () => {
  const output = run(entry, ["--help"]);
  assert.match(output, /rulekeeper drift/);
  assert.match(output, /rulekeeper adherence/);
});

test("the removed scan command explains the split", () => {
  assert.throws(
    () => run(entry, ["scan"], { stdio: ["ignore", "pipe", "pipe"] }),
    (error) => /split into two commands/.test(String(error.stderr)),
  );
});

test("drift exits non-zero on a repository with errors", () => {
  const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "demo-fixtures", "drift-repo");
  const out = mkdtempSync(join(tmpdir(), "rulekeeper-out-"));
  assert.throws(
    () => run(entry, [
      "drift", "--dir", fixtures, "--no-history", "--quiet",
      "--json", join(out, "drift.json"), "--md", join(out, "drift.md"),
    ], { stdio: ["ignore", "pipe", "pipe"] }),
    (error) => error.status === 1,
  );
});

test("drift exits zero on a repository whose instructions are true", () => {
  const out = mkdtempSync(join(tmpdir(), "rulekeeper-out-"));
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  run(entry, [
    "drift", "--dir", repoRoot, "--quiet",
    "--json", join(out, "drift.json"), "--md", join(out, "drift.md"),
  ]);
});
