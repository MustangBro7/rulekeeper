import test from "node:test";
import assert from "node:assert/strict";
import { detectCi, fingerprint } from "../dist/drift/upload.js";

test("fingerprint matches the server's identity scheme", () => {
  const value = fingerprint({ code: "missing-path", file: "CLAUDE.md", subject: "src/x.ts" });
  assert.equal(value.length, 32);
  assert.match(value, /^[0-9a-f]+$/);
  assert.equal(value, fingerprint({ code: "missing-path", file: "CLAUDE.md", subject: "src/x.ts" }));
  assert.notEqual(value, fingerprint({ code: "missing-path", file: "CLAUDE.md", subject: "src/y.ts" }));
});

test("detectCi reads GitHub Actions push context", () => {
  const ci = detectCi({ GITHUB_REF_NAME: "main", GITHUB_SHA: "abc123", GITHUB_REF: "refs/heads/main" });
  assert.deepEqual(ci, { branch: "main", commitSha: "abc123", prNumber: undefined });
});

test("detectCi prefers the head branch and finds the PR number on pull_request", () => {
  const ci = detectCi({
    GITHUB_REF: "refs/pull/42/merge",
    GITHUB_HEAD_REF: "feature/x",
    GITHUB_REF_NAME: "42/merge",
    GITHUB_SHA: "deadbeef",
  });
  assert.equal(ci.branch, "feature/x");
  assert.equal(ci.prNumber, 42);
});

test("detectCi understands GitLab and CircleCI", () => {
  assert.equal(detectCi({ CI_COMMIT_REF_NAME: "dev", CI_COMMIT_SHA: "g1" }).branch, "dev");
  assert.equal(detectCi({ CI_MERGE_REQUEST_IID: "7" }).prNumber, 7);
  assert.equal(detectCi({ CIRCLE_BRANCH: "trunk", CIRCLE_PULL_REQUEST: "https://github.com/a/b/pull/9" }).prNumber, 9);
});

test("detectCi strips refs/heads and ignores non-numeric PR ids", () => {
  assert.equal(detectCi({ GITHUB_REF: "refs/heads/release/1.x" }).branch, "release/1.x");
  assert.equal(detectCi({ CHANGE_ID: "not-a-number" }).prNumber, undefined);
});

test("detectCi returns nothing outside CI", () => {
  assert.deepEqual(detectCi({}), { branch: undefined, commitSha: undefined, prNumber: undefined });
});
