# RuleKeeper — agent playbook

RuleKeeper runs two independent checks on the instruction files that steer coding agents.
Keep the two halves separate; they share only the report envelope, redaction and share plumbing.

## Layout

```
app/
  cli/
    src/
      cli.ts
      drift/
      parse/
      report/
    test/
    demo-fixtures/
  worker/
    src/
    public/
    migrations/
```

- `app/cli/src/drift/` — the static check. Extracts claims from markdown, verifies them against
  repository facts. Reads no session logs and makes no network calls.
- `app/cli/src/discover.ts`, `app/cli/src/rules.ts`, `app/cli/src/score.ts` — the adherence check.
  Parses Claude Code and Codex transcripts and scores rules against observed behaviour.
- `app/worker/` — Hono worker on Cloudflare. Serves the landing page, the waitlist API and
  shareable report links backed by D1.

## Commands

Use npm. Run from `app/`:

- `npm run check` — typecheck both workspaces
- `npm test` — run both test suites
- `npm run build` — compile the CLI to `app/cli/dist`
- `npm run verify` — check, test and build together
- `npm run deploy` — deploy the worker with wrangler

Run `npm run verify` before declaring any change complete.

## Conventions

- The CLI has zero runtime dependencies. Do not add any.
- Reports must satisfy the redaction invariant: no absolute paths, file contents, emails or
  usernames. `assertRedacted` in `app/cli/src/report/json.ts` enforces this and the worker
  re-validates independently in `app/worker/src/reports.ts`.
- New drift checks go in `app/cli/src/drift/verify.ts` with a claim extractor in
  `app/cli/src/drift/claims.ts`. Prefer a false negative over a false positive — a linter that
  cries wolf gets turned off.
- Worker routes stay thin; logic lives in modules. Use prepared statements and numbered migrations.
