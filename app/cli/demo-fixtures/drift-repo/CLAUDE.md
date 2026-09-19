# Acme Dashboard — agent playbook

## Stack

Use pnpm as the package manager. The API is a Cloudflare Worker built with Hono.

## Layout

```
src/
  index.ts      # worker entry
  router.ts     # API routes
  handlers.ts   # request handlers
migrations/
```

## Before you finish

Always run `pnpm typecheck` and `pnpm test` before declaring work complete.
Deploy with `pnpm run deploy`.

## Validation

All request bodies are validated at the edge:

```ts
import { z } from "zod";
import { Hono } from "hono";

const Body = z.object({ email: z.string().email() });
```

## Configuration

Secrets live in `.env.example`. The worker reads `DATABASE_URL` and `API_TOKEN`
at startup — never hard-code them in `src/router.ts`.
