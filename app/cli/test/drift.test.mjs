import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractClaims } from "../dist/drift/claims.js";
import { collectRepoFacts, stripJsonComments } from "../dist/drift/repo.js";
import { analyzeRepo } from "../dist/drift/pipeline.js";
import { findContradictions, nearest, verifyClaim } from "../dist/drift/verify.js";
import { validateRedaction } from "../dist/report/json.js";

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "rulekeeper-drift-"));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return root;
}

const claimsOf = (content) => extractClaims("CLAUDE.md", content);
const kinds = (content, kind) => claimsOf(content).filter((claim) => claim.kind === kind).map((claim) => claim.value);

test("extracts script claims from every package-manager spelling", () => {
  const values = kinds("Run `npm run check` then `pnpm verify` and `bun run build`.", "script");
  assert.deepEqual(values.sort(), ["build", "check", "verify"]);
});

test("ignores package-manager builtins that are not scripts", () => {
  assert.deepEqual(kinds("Install with `pnpm install` and `pnpm add hono`.", "script"), []);
});

test("extracts paths from backticks and from directory trees", () => {
  const content = "See `src/index.ts`.\n\n```\nsrc/\n  router.ts\n  db/\n```\n";
  const values = kinds(content, "path");
  assert.ok(values.includes("src/index.ts"));
  assert.ok(values.includes("src/router.ts"));
});

test("does not read Tailwind modifiers or prose slashes as paths", () => {
  const values = kinds("Use `border-border/70`, `bg-background/85`, `w-1/2` and TypeScript/JavaScript.", "path");
  assert.deepEqual(values, []);
});

test("skips filenames presented as illustrations", () => {
  assert.deepEqual(kinds("Migrations (`0002_description.sql`, …) are immutable.", "path"), []);
  assert.deepEqual(kinds("Edit `src/real.ts` directly.", "path"), ["src/real.ts"]);
});

test("reads dependencies from example imports but not from relative or builtin specifiers", () => {
  const content = '```ts\nimport { z } from "zod";\nimport { join } from "node:path";\nimport { local } from "./local.js";\n```\n';
  assert.deepEqual(kinds(content, "dependency"), ["zod"]);
});

test("reads env vars and package-manager policy", () => {
  assert.deepEqual(kinds("The worker reads `DATABASE_URL`.", "env-var"), ["DATABASE_URL"]);
  assert.deepEqual(kinds("Use pnpm as the package manager.", "package-manager"), ["pnpm"]);
});

test("stripJsonComments handles comments and trailing commas", () => {
  const parsed = JSON.parse(stripJsonComments('{\n // note\n "a": 1, /* block */\n "b": "http://x/y", \n}'));
  assert.deepEqual(parsed, { a: 1, b: "http://x/y" });
});

test("collects scripts, dependencies and lockfiles from the repository", () => {
  const root = fixture({
    "package.json": JSON.stringify({ scripts: { check: "tsc" }, dependencies: { hono: "^4" } }),
    "pnpm-lock.yaml": "",
    "src/index.ts": "export const x = 1;",
  });
  const facts = collectRepoFacts(root, "demo");
  assert.ok(facts.scripts.has("check"));
  assert.ok(facts.dependencies.has("hono"));
  assert.deepEqual([...facts.lockfiles], ["pnpm"]);
  assert.ok(facts.files.has("src/index.ts"));
});

test("flags a missing script and suggests the closest real one", () => {
  const root = fixture({ "package.json": JSON.stringify({ scripts: { check: "tsc" } }) });
  const facts = collectRepoFacts(root, "demo");
  const [claim] = claimsOf("Run `npm run chek` first.");
  const finding = verifyClaim(claim, facts);
  assert.equal(finding.code, "missing-script");
  assert.equal(finding.severity, "error");
  assert.match(finding.suggestion, /check/);
});

test("accepts a script that still exists", () => {
  const root = fixture({ "package.json": JSON.stringify({ scripts: { check: "tsc" } }) });
  const [claim] = claimsOf("Run `npm run check` first.");
  assert.equal(verifyClaim(claim, collectRepoFacts(root, "demo")), undefined);
});

test("flags a package manager that disagrees with the lockfile", () => {
  const root = fixture({ "package.json": "{}", "package-lock.json": "" });
  const [claim] = claimsOf("Use pnpm for everything.");
  const finding = verifyClaim(claim, collectRepoFacts(root, "demo"));
  assert.equal(finding.code, "package-manager-mismatch");
  assert.match(finding.actual, /npm/);
});

test("resolves paths written relative to a nested workspace", () => {
  const root = fixture({ "package.json": "{}", "app/worker/src/index.ts": "" });
  const [claim] = claimsOf("Entry point is `src/index.ts`.");
  assert.equal(verifyClaim(claim, collectRepoFacts(root, "demo")), undefined);
});

test("reports contradictory package managers across instruction files", () => {
  const findings = findContradictions([
    { kind: "package-manager", value: "pnpm", file: "CLAUDE.md", line: 1, context: "use pnpm" },
    { kind: "package-manager", value: "npm", file: "AGENTS.md", line: 1, context: "use npm" },
  ]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "contradiction");
});

test("nearest only suggests genuinely close candidates", () => {
  assert.equal(nearest("typechek", ["typecheck", "build"]), "typecheck");
  assert.equal(nearest("deploy", ["xyzzy"]), undefined);
});

test("analyzeRepo scores a drifted repository and stays shareable", () => {
  const root = fixture({
    "package.json": JSON.stringify({ scripts: { check: "tsc" }, dependencies: {} }),
    "package-lock.json": "",
    "src/index.ts": "export const x = 1;",
    "CLAUDE.md": [
      "# Playbook",
      "",
      "Use pnpm as the package manager.",
      "",
      "Run `npm run typecheck` before finishing.",
      "Entry point is `src/index.ts`; handlers live in `src/handlers.ts`.",
    ].join("\n"),
  });
  const repo = analyzeRepo(root, { noHistory: true });
  const codes = repo.findings.map((finding) => finding.code).sort();
  assert.deepEqual(codes, ["missing-path", "missing-script", "package-manager-mismatch"]);
  assert.ok(repo.score < 100);
  assert.deepEqual(validateRedaction({ v: 2, kind: "drift", repos: [repo] }), []);
});

test("a repository that matches its instructions reports no drift", () => {
  const root = fixture({
    "package.json": JSON.stringify({ scripts: { check: "tsc" } }),
    "src/index.ts": "export const x = 1;",
    "CLAUDE.md": "Run `npm run check`. Entry point is `src/index.ts`.",
  });
  const repo = analyzeRepo(root, { noHistory: true });
  assert.deepEqual(repo.findings, []);
  assert.equal(repo.score, 100);
});
