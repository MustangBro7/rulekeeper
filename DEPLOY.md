# RuleKeeper — deploy runbook

## STATUS: DEPLOYED & VERIFIED IN PRODUCTION (2026-07-22)

**Live: https://rulekeeper.abhinavmohan12.workers.dev**
Version `d17e7ad8-de55-463e-b58f-70c6d66d68b9` · D1 `rulekeeper` migrated remotely.

Verified against production, not just locally:
- landing 200 · waitlist valid → `{"ok":true}` (row confirmed in remote D1) · invalid → 400
- `rulekeeper share` (baked-in prod URL) → live `/r/:id` renders 15 WORKS /
  10 NOT DELIVERED / 1 BROKEN, matching the CLI exactly
- delete: wrong secret → 404 (page survives); correct secret → 204 → page 404
- redaction spot-check on the live page: zero absolute paths, zero emails
- unknown routes → 404

### Launch polish — DONE 2026-07-22 (version b203b43e)
- Package renamed to **`rulekeeper-cli`** (`rulekeeper` was taken on npm);
  installed binary is still `rulekeeper`. Install command updated in all
  three landing spots + both READMEs; verified live.
- `/og.png` created (1200×630, matches the v1 terminal aesthetic) — 200.
- GitHub links now point at `github.com/MustangBro7/rulekeeper`.
- Repo initialized and committed (`e2f5d04`); no remote yet.

### Distribution: GitHub Release, NOT npm (decided 2026-07-22)

We deliberately do **not** publish to the npm registry — that would mean a
long-lived publish token living on the dev machine, which is the exact thing
npm's token-stealing worms target. The CLI has zero runtime dependencies, so
there is no inbound dependency risk either way; this only removes the
account-takeover path.

Install command (baked into the landing page and both READMEs):

```bash
npm i -g https://github.com/MustangBro7/rulekeeper/releases/latest/download/rulekeeper-cli.tgz
```

`releases/latest/download/` always resolves to the newest release, so the
published command never changes.

### Remaining before public launch
1. **Create the GitHub repo and push** — the site's github links and the
   install command both 404 until this exists.
   ```bash
   cd "/Volumes/X10 Pro/projects/empty_dir/rulekeeper"
   gh repo create MustangBro7/rulekeeper --public --source . --push
   ```
2. **Cut release v1.0.0 with the tarball attached under the exact filename
   `rulekeeper-cli.tgz`** (the install URL depends on that name):
   ```bash
   cd app/cli && npm pack --pack-destination /tmp
   cp /tmp/rulekeeper-cli-1.0.0.tgz /tmp/rulekeeper-cli.tgz
   gh release create v1.0.0 /tmp/rulekeeper-cli.tgz \
     --title "RuleKeeper v1.0.0" \
     --notes "Free local CLI: scan / demo / share. Zero runtime deps, Node >= 18."
   ```
   Then verify from a clean shell:
   `npm i -g https://github.com/MustangBro7/rulekeeper/releases/latest/download/rulekeeper-cli.tgz && rulekeeper demo`
3. Optional: custom domain (`rulekeeper.dev` is in the canonical/OG tags but
   the site serves from workers.dev — either buy it or update those tags).

For each future version: bump `cli/package.json`, re-pack, and attach the
tarball to a new release under the same `rulekeeper-cli.tgz` filename.

---

## Original runbook (for future redeploys)

## 1. Deploy the Worker (needs `wrangler login`)

Your Cloudflare OAuth token expired mid-build, and login requires an
interactive terminal. In your own terminal:

```bash
cd "/Volumes/X10 Pro/projects/empty_dir/rulekeeper/app/worker"
npx wrangler login                                   # opens browser
npx wrangler d1 migrations apply rulekeeper --remote  # creates the 2 tables
npm run deploy                                       # wrangler deploy
```

Alternatively, non-interactive:

```bash
export CLOUDFLARE_API_TOKEN=<token with Workers Scripts:Edit + D1:Edit>
npx wrangler d1 migrations apply rulekeeper --remote && npm run deploy
```

D1 database `rulekeeper` already exists:
`15310d36-2911-4098-bd1f-32f01d0db850` (created and migrated locally).

After deploy, wrangler prints the live URL (expected:
`https://rulekeeper.<your-subdomain>.workers.dev`). **If that subdomain
differs from `mustangbro7`,** update the one constant and rebuild so
`rulekeeper share` posts to the right host:

```bash
# app/cli/src/share.ts → const WORKER_URL = "https://rulekeeper.<sub>.workers.dev"
npm --prefix ../cli run build
```

Post-deploy smoke test (same checks I ran locally):

```bash
U=https://rulekeeper.<sub>.workers.dev
curl -s -o /dev/null -w "%{http_code}\n" $U/                                  # 200
curl -s -X POST $U/api/waitlist -H 'content-type: application/json' \
     -d '{"email":"you@example.com"}'                                         # {"ok":true}
curl -s -X POST $U/api/waitlist -H 'content-type: application/json' \
     -d '{"email":"bad"}'                                                     # 400
cd /tmp/rk-test && RULEKEEPER_WORKER_URL=$U node \
  "/Volumes/X10 Pro/projects/empty_dir/rulekeeper/app/cli/dist/cli.js" share --yes
# open the printed /r/<id> URL, then delete it with the printed command
```

## 2. Publish the CLI (needs `npm login`)

`npm whoami` fails on this machine. Packed tarball is ready at
`/tmp/rulekeeper-1.0.0.tgz` (27 KB).

```bash
npm login
cd "/Volumes/X10 Pro/projects/empty_dir/rulekeeper/app/cli"
npm publish --access public
```

Check the name is free first: `npm view rulekeeper`. If taken, rename in
`cli/package.json` (e.g. `@mustangbro7/rulekeeper`) and update the install
command shown on the landing page (`app/worker/public/index.html`, three
places: hero `<code>`, copy button `data-copy-command`, pricing CTA) and in
`app/README.md`, then redeploy the worker.

## What was verified locally (wrangler dev + real D1)

- Landing serves 200; waitlist form wired to `/api/waitlist`
- `POST /api/waitlist`: valid → `{"ok":true}`; invalid → 400
- `rulekeeper scan` on real logs: 66 sessions, matches `mine.py`
- `rulekeeper share`: 13,302-byte redacted payload → `/r/:id` renders 200
  with 15 WORKS, 10 NOT DELIVERED, 1 BROKEN — matching the CLI exactly
- Delete flow: wrong secret → 404, correct secret → 204, page then 404
- Unknown routes → 404; worker typechecks; 16 tests pass; dry-run bundles
  (81 KiB / 21 KiB gzip)
