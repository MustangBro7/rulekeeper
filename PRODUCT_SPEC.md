# RuleKeeper v1 — full product spec

**Goal: a deployed, working product.** Two deliverables in one repo:
1. `rulekeeper` — free npm CLI (TypeScript, Node ≥ 18, **zero runtime deps**)
   that generalizes the proven Python miner (`mine.py` in this directory —
   read it first; it is the reference implementation with real-world parser
   fixes baked in).
2. One Cloudflare Worker (Hono + D1) that serves the static landing page
   (`site/public`, already built), a waitlist API, and shareable report links.

No Clerk, no payments in v1 — paid tiers are waitlist-gated on the landing.

## Repository layout (create under `app/`)

```
app/
  package.json            # npm workspaces: ["cli", "worker"], scripts below
  README.md               # product readme: install, scan, share, deploy
  cli/
    package.json          # name "rulekeeper", bin { rulekeeper: "dist/cli.js" }
    tsconfig.json         # strict, ES2022, module nodenext, outDir dist
    src/
      cli.ts              # arg parsing (hand-rolled, no deps), command routing
      discover.ts         # find session logs + instruction files
      parse/claude.ts     # Claude Code JSONL parser  (port from mine.py)
      parse/codex.ts      # Codex rollout parser      (port from mine.py — keep
                          #   ALL the quirk handling: function_call exec_command,
                          #   custom_tool_call with cmd:"..." AND {"cmd":...},
                          #   apply_patch as custom_tool_call raw patch AND
                          #   escaped-\n form, added-lines-only patch content,
                          #   workdir extraction, exit-code join by call_id)
      rules.ts            # rule extraction + detectors (see below)
      score.ts            # delivery / adherence / dead-weight / receipts,
                          #   git birth dates (pickaxe), pre-rule quarantine
      report/terminal.ts  # ANSI report (mirror the landing hero aesthetic)
      report/markdown.ts  # report.md  (structure of rulekeeper/out/report.md)
      report/json.ts      # stable JSON schema (below) + redaction
      share.ts            # confirm + POST redacted JSON to the API
      demo.ts             # `rulekeeper demo` — run pipeline on bundled fixtures
    demo-fixtures/        # small synthetic Claude+Codex logs + fake repo with
                          #   a CLAUDE.md, crafted to produce a compelling
                          #   report (delivery gap + one works + one dead rule)
    test/                 # node:test; fixtures = small synthetic JSONL files
      fixtures/
  worker/
    package.json          # hono; scripts: dev, deploy, check (tsc), test
    tsconfig.json
    wrangler.jsonc        # name "rulekeeper", assets binding -> ./public,
                          #   D1 binding DB, compatibility_date today
    public/               # COPY of ../../site/public (landing); this is what
                          #   actually serves — site/ stays as design source
    migrations/0001_init.sql
    src/
      index.ts            # Hono app: routes below, central onError -> JSON
      reports.ts          # validation + redaction re-check + size caps
      shareTemplate.ts    # server-rendered /r/:id page (v1 terminal aesthetic)
    test/                 # vitest or node:test with miniflare not required —
                          #   plain unit tests for validation + template
```

## CLI behavior

### `rulekeeper scan [options]`

Options: `--since <e.g. 28d|2026-06-22>` `--until <date>` (default: last 28
days), `--dir <repo>` (limit to one repo), `--json/--md <path>` (default:
write both to `./rulekeeper-report/`), `--no-color`, `--quiet`.
(No HTML report output — the hosted share page is the visual artifact.)

Pipeline (mirror mine.py's proven behavior, generalized):
1. **Discover sources**: `~/.claude/projects/**/*.jsonl` (+ per-session
   `subagents/*.jsonl` merged into the parent) and
   `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. Missing dirs are fine —
   report which sources were found.
2. **Parse sessions** into the common Session shape (source, cwd, timestamps,
   commands[{ts,cmd,workdir,exitError}], edits[{ts,path,content,kind}],
   reads, userTurns, errors, rawText for marker search). Malformed lines are
   skipped, never fatal.
3. **Attribute repos**: collect the set of git repos touched (from cwd and
   absolute paths in commands/edits/reads). For each repo found on disk,
   discover instruction files: `CLAUDE.md`, `AGENTS.md`, and one level of
   nested `*/CLAUDE.md` / `*/AGENTS.md` (e.g. `frontend/CLAUDE.md`).
4. **Extract rules** from each instruction file (generic, not hardcoded):
   - **delivery** (always, per file): marker = the 3 most distinctive
     non-blank lines of the file (longest lines that are not markdown
     boilerplate); file counts as "in context" for a session when any marker
     appears in the session raw text.
   - **command rules**: backtick-quoted shell commands in the file
     (`npm run check`, `pnpm i`, `cargo test`, `wrangler ...` etc., filtered
     to plausible commands: starts with a known runner or contains a space
     and no URL). Rule = "sessions that edited code in this repo should have
     run this command". Adherence = command (normalized) found in session
     commands. Dead-weight signal = adherence ≈ 100% in sessions where the
     file was NOT in context too (agents do it anyway), or rule never
     applicable in the window.
   - **package-manager rule**: if the file names exactly one of
     npm/pnpm/yarn/bun as the manager (regex like `use pnpm`), violations =
     other managers' install/run invocations in that repo's sessions.
   - **custom rules** via optional `.rulekeeper.json` in the repo:
     `{ "rules": [{ "id", "description", "appliesTo": {"editsMatching":
     regex}, "requireCommand": regex } | { "id", "description",
     "forbidContent": regex, "inEditsMatching": regex }] }`.
5. **Score** (port from mine.py): per rule — applicable / followed /
   violated sessions; **git birth date** of the rule's file (first commit;
   `-S` pickaxe on the rule text when the file predates it) and quarantine
   sessions that ended before the rule existed (report separately, never as
   violations); in-context vs not split; receipts = session id + timestamp +
   the concrete evidence (paths, counts).
6. **Report**: terminal (default; ANSI, ✗/✓/△ verdict lines exactly in the
   style of the landing hero), plus `report.md`, `report.html`,
   `report.json` files.

### JSON schema (`report.json`, version field `"v": 1`)

```jsonc
{
  "v": 1, "generatedAt": iso, "window": {"since", "until"},
  "totals": {"sessions", "commands", "edits", "errors", "sources": {"claude": n, "codex": n}},
  "repos": [{ "name",                       // basename only — never the path
    "files": [{ "name", "tokensEstimate", "sessionsTouching", "sessionsInContext" }],
    "rules": [{ "id", "kind", "quote",      // quote max 140 chars
      "born", "applicable", "followed", "violated", "preRule",
      "inContext": {"followed","applicable"}, "outOfContext": {...},
      "verdict": "works"|"broken"|"dead-weight"|"not-delivered"|"untested",
      "receipts": [{ "sessionId8", "date", "evidence" }] }] }]
}
```

**Redaction invariant (hard requirement):** report.json and anything sent by
`share` contain NO absolute paths, NO file contents, NO command strings, NO
email/usernames — only repo basenames, file basenames, rule quotes (from the
user's own instruction file), counts, dates, and 8-char session id prefixes.
`share.ts` re-validates this before POSTing (walk all strings; reject `/` +
home-dir patterns). CLI never phones home except explicit `share`.

### `rulekeeper share [reportPath]`

Sharing is explicitly opt-in and privacy-first:
1. Reads report.json (default `./rulekeeper-report/report.json`),
   re-validates redaction (walk every string: reject absolute paths,
   home-dir patterns, `@` emails).
2. Prints a summary of EXACTLY what will be uploaded (repos, rule count,
   byte size) and requires interactive `y` confirmation (skippable with
   `--yes`; `--dry-run` prints the full payload and exits).
3. POSTs to `https://<WORKER_URL>/api/reports`; response `{id, url,
   deleteSecret}`. Print the URL, the delete command
   (`rulekeeper share --delete <id> --secret <secret>`), and note the link
   expires in 30 days.

### `rulekeeper demo`

Runs the full scan pipeline against the bundled `demo-fixtures/` (synthetic
logs + fake repo, no reading of the user's real logs) and prints the
terminal report — the zero-risk, zero-config first-run experience. Suggest
`rulekeeper scan` at the end.

### `rulekeeper --help` / `--version`

Hand-rolled, nicely formatted, mirrors the terminal aesthetic.

## Worker behavior

- `GET /*` → static assets (landing) via the assets binding.
- `POST /api/waitlist` `{email}` → validate format, insert-or-ignore into
  `waitlist(email TEXT PRIMARY KEY, created_at)`, 200 `{ok:true}`. 400 on
  bad email. Per-IP rate limit: max 5/min (in-memory Map is acceptable v1).
- `POST /api/reports` body = report JSON → checks: `v === 1`, byte size ≤
  64 KB, passes the same redaction validation (shared constant logic,
  duplicated in worker), rules count ≤ 200. Store raw JSON in
  `reports(id TEXT PRIMARY KEY, body TEXT, delete_secret TEXT, created_at)`
  with id = 8-char base36 and delete_secret = 24-char from crypto random.
  200 `{id, url, deleteSecret}`. Rate limit 3/min/IP.
- `DELETE /api/reports/:id` with `X-Delete-Secret` header → constant-time
  compare, delete row, 204.
- `GET /r/:id` → server-rendered HTML share page: dark v1 terminal
  aesthetic (reuse the landing's CSS custom properties inline), renders the
  report's headline stats + rule scoreboard + receipts, footer label
  "generated locally · selectively shared", links back to the landing +
  install command. Reports older than 30 days: treat as not found (and
  delete the row). 404 page in same style.
- Central `onError` mapping to JSON; CORS: same-origin only (the site is
  served by this worker — no cross-origin needed); `Cache-Control` for
  assets handled by platform defaults, `/r/:id` = `public, max-age=300`.
- Wire the landing form: set `data-waitlist-endpoint="/api/waitlist"` in
  `app/worker/public/index.html` (the copy — not `site/`).

## Root scripts (`app/package.json`)

- `check` — tsc both workspaces
- `test` — run both test suites
- `build` — build CLI to `cli/dist`
- `deploy` — `npm --prefix worker run deploy` (wrangler deploy)
- `verify` — check + test + build

## Quality bar / review criteria

- CLI runs on this machine against the real logs and its headline numbers
  for `--since 2026-06-22 --until 2026-07-19` are within ±2 sessions of the
  Python miner's (59 sessions; delivery 40% on the busiest repo) — small
  drift from generic (vs hand-tuned) rule extraction is acceptable and will
  be reviewed, but session ingestion counts must match exactly.
- Zero runtime deps in `cli` (`dependencies` empty; `devDependencies`:
  typescript, @types/node only). Worker deps: hono only (+ wrangler,
  typescript as dev).
- `node:test` suites pass; fixtures cover: claude session with tool_use/
  tool_result/is_error; codex with all three command encodings + both patch
  encodings; delivery marker matching; pre-rule quarantine; redaction
  validator (positive + negative).
- No secrets anywhere; no telemetry; `share` is the only network call in
  the CLI and is explicit.
- Style: match the conventions of this user's other repos (thin routes,
  logic in modules, raw SQL via prepared statements, numbered migrations).
