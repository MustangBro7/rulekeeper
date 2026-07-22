# rulekeeper-cli

**Does your CLAUDE.md actually work?**

Static linters check whether your instruction files reference real paths.
RuleKeeper answers the question that matters: *are these rules making your
agents better or worse?* — by joining what your `CLAUDE.md` / `AGENTS.md`
say with what your coding agents actually did, using the session transcripts
already sitting on your machine.

```bash
npx rulekeeper-cli demo    # zero-risk sample report, synthetic logs
npx rulekeeper-cli scan    # audit your own repos
```

## What it found on the author's machine

Across 59 real sessions in a 4-week window:

- **60%** of sessions touching the busiest repo never had the instruction
  file in context at all — the rules couldn't work because they were never
  delivered.
- A hard "verify UI in preview before done" rule: **78% → 93%** adherence
  after it was added, and **12/12** in sessions where the file was actually
  in context.
- An adjacent rule was already followed **9/9 before it existed** — dead
  weight.
- One rule broken with receipts: `wrangler.jsonc` edited 10×, `cf-typegen`
  never run.

## Commands

| Command | What it does |
| --- | --- |
| `rulekeeper scan` | Audit the last 28 days. `--since 2026-06-01 --until 2026-06-30`, `--dir <repo>`, `--no-color`, `--quiet`. Writes `rulekeeper-report/report.md` + `report.json`. |
| `rulekeeper demo` | Runs the full pipeline on bundled synthetic fixtures. Touches none of your logs. |
| `rulekeeper share` | Opt-in: publishes a redacted summary and prints a link + delete secret. `--dry-run`, `--yes`. |

Reads Claude Code sessions (`~/.claude/projects`) and Codex rollouts
(`~/.codex/sessions`). Missing sources are skipped, not fatal.

## What gets scored

- **Delivery** — per session, did the instruction file's content actually
  reach the agent's context?
- **Gates** — check/test/build/lint commands named in the file: did they run
  after code edits?
- **Verdicts** — `works`, `broken`, `dead-weight` (followed even where the
  file was absent), `not-delivered`, `untested`.
- Rules are dated by the git commit that introduced them, so sessions older
  than a rule are never counted as violations.

## Privacy

Local-first. The scan makes **no network calls at all**. `share` is the only
thing that uploads, it is explicit, and it sends a redacted summary —
no code, no file contents, no command strings, no absolute paths, no emails.
Only repo/file basenames, rule quotes from your own instruction files,
counts, dates, and 8-character session-id prefixes. You get a delete secret;
links expire after 30 days.

Hosted share service: <https://rulekeeper.abhinavmohan12.workers.dev>

MIT · zero runtime dependencies · Node ≥ 18
