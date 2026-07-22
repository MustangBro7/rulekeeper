import { Hono } from "hono";
import { MAX_REPORT_BYTES, parseReportBody, validateReport } from "./reports.ts";
import { renderNotFoundPage, renderSharePage } from "./shareTemplate.ts";

const WAITLIST_BODY_BYTES = 4 * 1024;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_BUCKETS = new Map<string, number[]>();

interface ReportRow {
  id: string;
  body: string;
  delete_secret: string;
  created_at: string;
}

const app = new Hono<{ Bindings: Env }>();

function jsonError(c: Parameters<Parameters<typeof app.onError>[0]>[1], status: 400 | 404 | 413 | 429 | 500, error: string) {
  return c.json({ error }, status);
}

function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

function isRateLimited(key: string, limit: number, now = Date.now()): boolean {
  const cutoff = now - RATE_WINDOW_MS;
  const recent = (RATE_BUCKETS.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
  if (recent.length >= limit) {
    RATE_BUCKETS.set(key, recent);
    return true;
  }
  recent.push(now);
  RATE_BUCKETS.set(key, recent);

  if (RATE_BUCKETS.size > 5_000) {
    for (const [bucketKey, timestamps] of RATE_BUCKETS) {
      if (!timestamps.some((timestamp) => timestamp > cutoff)) RATE_BUCKETS.delete(bucketKey);
    }
  }
  return false;
}

async function readLimitedBody(request: Request, maxBytes: number): Promise<string | null> {
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null && Number(declaredLength) > maxBytes) return null;
  if (request.body === null) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(decoder.decode(value, { stream: true }));
  }
  chunks.push(decoder.decode());
  return chunks.join("");
}

function randomBase36(length: number): string {
  const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
  let result = "";
  while (result.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length - result.length));
    for (const byte of bytes) {
      if (byte >= 252) continue;
      result += alphabet[byte % alphabet.length];
      if (result.length === length) break;
    }
  }
  return result;
}

async function constantTimeEqual(provided: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

function htmlResponse(html: string, status = 200, cacheControl = "no-store"): Response {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

app.post("/api/waitlist", async (c) => {
  const ip = clientIp(c.req.raw);
  if (isRateLimited(`waitlist:${ip}`, 5)) return jsonError(c, 429, "Rate limit exceeded");

  const raw = await readLimitedBody(c.req.raw, WAITLIST_BODY_BYTES);
  if (raw === null) return jsonError(c, 413, "Request body too large");

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return jsonError(c, 400, "Invalid JSON");
  }
  const email = value !== null && typeof value === "object" && "email" in value && typeof value.email === "string"
    ? value.email.trim().toLowerCase()
    : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return jsonError(c, 400, "Invalid email address");

  await c.env.DB.prepare("INSERT OR IGNORE INTO waitlist (email, created_at) VALUES (?, ?)")
    .bind(email, new Date().toISOString())
    .run();
  return c.json({ ok: true });
});

app.post("/api/reports", async (c) => {
  const ip = clientIp(c.req.raw);
  if (isRateLimited(`reports:${ip}`, 3)) return jsonError(c, 429, "Rate limit exceeded");

  const raw = await readLimitedBody(c.req.raw, MAX_REPORT_BYTES);
  if (raw === null) return jsonError(c, 413, "Report exceeds 64 KB");
  const validation = parseReportBody(raw);
  if (!validation.ok) return c.json({ error: "Invalid report", details: validation.errors }, 400);

  const deleteSecret = randomBase36(24);
  const createdAt = new Date().toISOString();
  let id = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = randomBase36(8);
    const result = await c.env.DB.prepare(
      "INSERT OR IGNORE INTO reports (id, body, delete_secret, created_at) VALUES (?, ?, ?, ?)",
    ).bind(candidate, raw, deleteSecret, createdAt).run();
    if (result.meta.changes > 0) {
      id = candidate;
      break;
    }
  }
  if (!id) throw new Error("Unable to allocate report id");

  const url = new URL(`/r/${id}`, c.req.url).toString();
  return c.json({ id, url, deleteSecret });
});

app.delete("/api/reports/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT delete_secret FROM reports WHERE id = ?")
    .bind(id)
    .first<Pick<ReportRow, "delete_secret">>();
  const provided = c.req.header("X-Delete-Secret") ?? "";
  if (row === null || !(await constantTimeEqual(provided, row.delete_secret))) return jsonError(c, 404, "Report not found");

  await c.env.DB.prepare("DELETE FROM reports WHERE id = ?").bind(id).run();
  return c.body(null, 204);
});

app.get("/r/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT id, body, delete_secret, created_at FROM reports WHERE id = ?")
    .bind(id)
    .first<ReportRow>();
  if (row === null) return htmlResponse(renderNotFoundPage(), 404);

  const createdAt = Date.parse(row.created_at);
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > THIRTY_DAYS_MS) {
    await c.env.DB.prepare("DELETE FROM reports WHERE id = ?").bind(id).run();
    return htmlResponse(renderNotFoundPage(), 404);
  }

  let stored: unknown;
  try {
    stored = JSON.parse(row.body);
  } catch {
    stored = null;
  }
  const validation = validateReport(stored);
  if (!validation.ok) {
    console.error(JSON.stringify({ message: "invalid stored report", reportId: id }));
    return htmlResponse(renderNotFoundPage(), 404);
  }
  return htmlResponse(renderSharePage(validation.report), 200, "public, max-age=300");
});

app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((error, c) => {
  console.error(JSON.stringify({ message: "unhandled error", error: error.message, path: c.req.path }));
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
