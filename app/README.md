# RuleKeeper

Context health for coding agents. Two workspaces:

- **`cli/`** — `rulekeeper-cli`, the free local CLI (TypeScript, zero runtime
  deps, Node ≥ 18). Scans Claude Code + Codex transcripts against your
  `CLAUDE.md` / `AGENTS.md` and scores every rule. See [cli/README.md](cli/README.md).
- **`worker/`** — the Cloudflare Worker (Hono + D1) serving the landing page,
  the waitlist API, and hosted share links.
  Live: <https://rulekeeper.abhinavmohan12.workers.dev>

```sh
npm i -g https://github.com/MustangBro7/rulekeeper/releases/latest/download/rulekeeper-cli.tgz

rulekeeper demo
rulekeeper scan --since 28d
rulekeeper share
```

The validation that led to this product is in
[`../RULEKEEPER_PROOF.md`](../RULEKEEPER_PROOF.md); the original Python miner
it was ported from is [`../mine.py`](../mine.py) (still the ground-truth
reference for parser behavior).

## Development

```bash
npm install          # workspaces: cli, worker
npm run verify       # check + test + build, both workspaces
npm run build        # build the CLI to cli/dist
npm --prefix worker run dev    # wrangler dev (local D1)
npm run deploy       # wrangler deploy
```

Worker types are generated — after editing `worker/wrangler.jsonc`, run
`npx wrangler types` in `worker/` (do **not** add `@cloudflare/workers-types`;
the v4 line no longer resolves).

## API

| Route | Purpose |
| --- | --- |
| `GET /*` | Static landing assets |
| `POST /api/waitlist` | `{email}` → `{ok:true}`; 5/min/IP |
| `POST /api/reports` | Redacted report JSON (≤64 KB, ≤200 rules) → `{id, url, deleteSecret}`; 3/min/IP |
| `DELETE /api/reports/:id` | Requires `X-Delete-Secret`; constant-time compare |
| `GET /r/:id` | Server-rendered share page; 404s and self-deletes after 30 days |

## Release

Deploy steps, live-verification checklist, and open launch items are in
[`../DEPLOY.md`](../DEPLOY.md).
