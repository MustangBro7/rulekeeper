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

### Open items before public launch
1. `npm publish` — **the name `rulekeeper` is TAKEN on npm** (v0.1.6 exists).
   Rename in `cli/package.json` (suggest `@mustangbro7/rulekeeper` or
   `rulekeeper-cli`) and update the install command in
   `app/worker/public/index.html` (hero `<code>`, `data-copy-command`,
   pricing CTA) + `app/README.md`, then redeploy the worker.
2. `/og.png` is referenced by the meta tags but returns 404 — add the image
   to `app/worker/public/` (1200×630) or drop the tags.
3. GitHub links are placeholders (`https://github.com/`) — point them at the
   real repo once it exists.
4. CLI is not in git yet — `git init` + commit `app/`, `mine.py`, the proof.

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
