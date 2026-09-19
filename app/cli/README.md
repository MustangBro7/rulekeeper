# rulekeeper

Two checks for the files that steer your coding agents.

```bash
npm i -g https://github.com/MustangBro7/rulekeeper/releases/latest/download/rulekeeper-cli.tgz
```

## drift — is `CLAUDE.md` still true about this repo?

Static. Verifies every claim the doc makes — paths, scripts, Make/just/cargo targets, example
imports, env vars, package manager — against the code that exists now. Reads no session logs,
makes no network calls, exits non-zero on errors. Safe in CI.

```bash
rulekeeper drift                  # current repository
rulekeeper drift --dir ../other   # a different one
rulekeeper drift --strict         # fail on warnings too
rulekeeper drift --no-history     # skip git-history staleness checks
```

## adherence — did agents actually follow it?

Behavioral. Replays local Claude Code and Codex transcripts and scores each rule as works, broken,
not-delivered, dead-weight or untested, with session receipts.

```bash
rulekeeper adherence              # trailing 28 days
rulekeeper adherence --since 4w
rulekeeper adherence --dir ~/code/myrepo
```

## Everything else

```bash
rulekeeper demo drift             # bundled fixtures, no real data read
rulekeeper demo adherence
rulekeeper share                  # publish a redacted report link (opt-in)
rulekeeper --help
```

Reports are written to `./rulekeeper-report/` as JSON and Markdown.

Zero runtime dependencies. Nothing leaves your machine unless you run `share`, which prints the
exact payload and waits for confirmation. MIT.
