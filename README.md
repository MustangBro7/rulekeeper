# ▚ rulekeeper

**Are your agent instructions still true — and did agents ever follow them?**

`CLAUDE.md` and `AGENTS.md` rot like any other code, except nothing compiles them, nothing tests
them, and nobody notices. RuleKeeper runs the two checks that catch it.

```bash
npm i -g https://github.com/MustangBro7/rulekeeper/releases/latest/download/rulekeeper-cli.tgz

rulekeeper demo drift        # see it work on a bundled fixture
rulekeeper drift             # check this repo's instruction files against the code
rulekeeper adherence         # check whether agents followed them
```

The CLI works standalone with no account. Sign in at the
[dashboard](https://rulekeeper.abhinavmohan12.workers.dev/app) to track a repository's
truth score over time and wire it into CI.

---

## 1 · `rulekeeper drift` — is the map still accurate?

A **static** check. Reads every claim your instruction files make about the repository and
verifies each one against the code that exists right now. No session logs, no network, safe in CI.
Exits non-zero when it finds errors.

| Code | Severity | What it means |
|---|---|---|
| `missing-path` | error | A file or directory the doc points at does not exist — including entries inside ASCII tree diagrams. |
| `missing-script` | error | `npm run typecheck` is documented but package.json has no `typecheck` script. Suggests the closest real one. |
| `missing-target` | error | A Make target, just recipe or cargo alias that no longer resolves. |
| `missing-dependency` | warn | A code example imports a package that is not in any package.json. |
| `unknown-env-var` | warn | A documented environment variable that no code reads and no env file declares. |
| `package-manager-mismatch` | warn | The doc mandates pnpm; the repo carries a package-lock.json. |
| `contradiction` | warn | Two instruction files give agents conflicting instructions. |
| `stale-section` | info | A directory the doc describes has moved on by many commits since the doc was last edited. |
| `undocumented-area` | info | A source directory no instruction file has ever mentioned. |

```
rulekeeper drift [--dir <repo>] [--strict] [--no-history] [--json <path>] [--md <path>]
```

`--strict` also fails on warnings. `--no-history` skips the git-history checks.

### In CI

```yaml
name: agent-instructions
on: [push, pull_request]
permissions:
  contents: read
  pull-requests: write
jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - uses: MustangBro7/rulekeeper@v2
        with:
          token: ${{ secrets.RULEKEEPER_TOKEN }}   # optional; omit to check without reporting
          strict: "false"
```

The Action installs the CLI, fails the build on errors, writes a job summary, and keeps a
single pull-request comment up to date with the score and what changed since the last run.
`token` is optional — without it the check still runs, it just does not report anywhere.

| Input | Default | Meaning |
|---|---|---|
| `token` | — | Ingest token from the dashboard. Omit to run without reporting. |
| `strict` | `false` | Also fail on warnings. |
| `working-directory` | `.` | Where the instruction files live. |
| `comment` | `true` | Maintain a PR comment (needs `pull-requests: write`). |
| `version` | `latest` | CLI release to install. |

Paths that git ignores (build output like `dist/`) are never reported as missing, so a doc
describing where artefacts go does not fail a clean checkout.

## The dashboard

Sign in with GitHub, add a repository, create an ingest token, and every CI run records:

- **Truth score over time** — a line trending down means a doc is drifting away from the code.
- **Findings triage** — filter by severity; each finding shows the doc line beside the repo's
  actual state, with a suggested fix where one is derivable.
- **Accepted findings** — some drift is intentional. Accept it once and CI stops failing on it
  for everyone, on every branch. CI fetches that baseline before deciding whether to fail, and
  falls back to failing on everything real if the dashboard is unreachable.
- **Run history** — branch, commit and score per run, so you can point at what broke it.

Reports are generated in your runner and contain repository-relative paths, counts and quotes
from your own docs. Your source never leaves your machine.

---

## 2 · `rulekeeper adherence` — did anyone follow the map?

A **behavioral** check. Joins your rules with what Claude Code and Codex actually did, mined from
local session transcripts (`~/.claude/projects/**.jsonl`, `~/.codex/sessions/**/rollout-*.jsonl`).

Each rule gets one of five verdicts:

- **works** — applicable, delivered, and followed.
- **broken** — applicable and violated, with a session receipt.
- **not-delivered** — the instruction file never reached the model's context.
- **dead-weight** — followed just as reliably when the rule was *not* in context. Your agents
  already did this; delete the line and reclaim the tokens.
- **untested** — never exercised in the window.

Rules are dated from the git commit that introduced them, so sessions that predate a rule are
reported separately and never counted as violations.

```
rulekeeper adherence [--since 28d|<date>] [--until <date>] [--dir <repo>] [--json <path>] [--md <path>]
```

Custom rules live in `.rulekeeper.json` at the repository root:

```json
{
  "rules": [
    { "id": "typegen-after-config",
      "description": "Regenerate types after editing wrangler config",
      "appliesTo": { "editsMatching": "wrangler\\.jsonc$" },
      "requireCommand": "cf-typegen" },
    { "id": "no-eval",
      "description": "Never use eval in worker modules",
      "inEditsMatching": "worker\\.ts$",
      "forbidContent": "eval\\(" }
  ]
}
```

---

## Privacy

Both checks run entirely on your machine. The CLI has **zero runtime dependencies** and makes no
network call except an explicit `rulekeeper share`.

Reports carry repository-relative paths, counts, and quotes from your own instruction files —
never absolute paths, file contents, command output, emails or usernames. This is enforced by an
assertion in the CLI (`assertRedacted`) and independently re-validated by the worker before a
shared report is stored.

```
rulekeeper share [reportPath] [--yes] [--dry-run]
rulekeeper share --delete <id> --secret <secret>
```

`share` prints exactly what will be uploaded and waits for confirmation. Links expire after 30 days
and come with a delete secret. `--dry-run` prints the full payload and exits.

---

## Development

```bash
cd app
npm run verify      # typecheck + test + build
npm run deploy      # wrangler deploy
```

- `app/cli` — the CLI (TypeScript, Node ≥ 18, zero runtime dependencies)
- `app/worker` — Cloudflare Worker (Hono + D1) serving the landing page and share links

See [CLAUDE.md](CLAUDE.md) for the agent playbook, and [DEPLOY.md](DEPLOY.md) for the release
runbook.

MIT.
