import { Hono } from "hono";

export const router = new Hono();
router.get("/health", (c) => c.json({ ok: true, token: process.env.API_TOKEN ? "set" : "unset" }));
