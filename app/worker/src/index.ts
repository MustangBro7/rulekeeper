import { Hono } from "hono";
import { MAX_REPORT_BYTES, parseReportBody, validateReport, type DriftReport } from "./reports.ts";
import { renderNotFoundPage, renderSharePage } from "./shareTemplate.ts";
import {
  authorizeUrl,
  clearSessionCookie,
  createSession,
  currentUser,
  destroySession,
  exchangeCode,
  fetchProfile,
  fetchRepos,
  oauthState,
  projectFromToken,
  readCookie,
  readStateCookie,
  setSessionCookie,
  setStateCookie,
  upsertUser,
  type User,
} from "./auth.ts";
import {
  addMute,
  annotate,
  countProjects,
  createProject,
  createToken,
  deleteProject,
  getProject,
  listMutes,
  listProjects,
  listRuns,
  listTokens,
  listUserRepos,
  latestRunBody,
  MAX_PROJECTS_PER_USER,
  previousFingerprints,
  normalizeSlug,
  recordRun,
  removeMute,
  replaceUserRepos,
  revokeToken,
  touchToken,
} from "./projects.ts";
import { docsPage, errorPage, loginPage, projectsPage, projectPage, settingsPage } from "./pages.ts";
import { constantTimeEqual, fingerprint, randomBase36 } from "./ids.ts";

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

type Env2 = Env & {
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  DEV_LOGIN?: string;
};

const app = new Hono<{ Bindings: Env2; Variables: { user: User } }>();

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

function htmlResponse(html: string, status = 200, cacheControl = "no-store"): Response {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=UTF-8",
      "Cache-Control": cacheControl,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
    },
  });
}

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ Location: location, "Cache-Control": "no-store" });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}

function origin(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

/* ── Marketing + anonymous share (unchanged surface) ───────── */

app.post("/api/waitlist", async (c) => {
  if (isRateLimited(`waitlist:${clientIp(c.req.raw)}`, 5)) return c.json({ error: "Rate limit exceeded" }, 429);
  const raw = await readLimitedBody(c.req.raw, WAITLIST_BODY_BYTES);
  if (raw === null) return c.json({ error: "Request body too large" }, 413);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const email = value !== null && typeof value === "object" && "email" in value && typeof value.email === "string"
    ? value.email.trim().toLowerCase()
    : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return c.json({ error: "Invalid email address" }, 400);
  await c.env.DB.prepare("INSERT OR IGNORE INTO waitlist (email, created_at) VALUES (?, ?)")
    .bind(email, new Date().toISOString())
    .run();
  return c.json({ ok: true });
});

app.post("/api/reports", async (c) => {
  if (isRateLimited(`reports:${clientIp(c.req.raw)}`, 3)) return c.json({ error: "Rate limit exceeded" }, 429);
  const raw = await readLimitedBody(c.req.raw, MAX_REPORT_BYTES);
  if (raw === null) return c.json({ error: "Report exceeds 64 KB" }, 413);
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
    if ((result.meta.changes ?? 0) > 0) {
      id = candidate;
      break;
    }
  }
  if (!id) throw new Error("Unable to allocate report id");
  return c.json({ id, url: new URL(`/r/${id}`, c.req.url).toString(), deleteSecret });
});

app.delete("/api/reports/:id", async (c) => {
  const id = c.req.param("id");
  const row = await c.env.DB.prepare("SELECT delete_secret FROM reports WHERE id = ?")
    .bind(id)
    .first<Pick<ReportRow, "delete_secret">>();
  const provided = c.req.header("X-Delete-Secret") ?? "";
  if (row === null || !(await constantTimeEqual(provided, row.delete_secret))) return c.json({ error: "Report not found" }, 404);
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

/* ── Auth ──────────────────────────────────────────────────── */

app.get("/auth/github", (c) => {
  const clientId = c.env.GITHUB_CLIENT_ID;
  if (!clientId) return htmlResponse(loginPage("GitHub sign-in is not configured on this deployment."), 503);
  const state = oauthState();
  return redirect(
    authorizeUrl(clientId, `${origin(c.req.raw)}/auth/github/callback`, state),
    setStateCookie(c.req.raw, state),
  );
});

app.get("/auth/github/callback", async (c) => {
  const { GITHUB_CLIENT_ID: clientId, GITHUB_CLIENT_SECRET: clientSecret } = c.env;
  if (!clientId || !clientSecret) return htmlResponse(loginPage("GitHub sign-in is not configured."), 503);

  const code = c.req.query("code");
  const state = c.req.query("state");
  const expected = readStateCookie(c.req.raw);
  if (!code || !state || !expected || state !== expected) {
    return htmlResponse(loginPage("Sign-in request expired or was tampered with. Please try again."), 400);
  }
  try {
    const accessToken = await exchangeCode(clientId, clientSecret, code, `${origin(c.req.raw)}/auth/github/callback`);
    const user = await upsertUser(c.env.DB, await fetchProfile(accessToken));
    const session = await createSession(c.env.DB, user.id);
    // Cache the repo list while we still hold the token; the token itself is never stored.
    try {
      await replaceUserRepos(c.env.DB, user.id, await fetchRepos(accessToken));
    } catch (error) {
      console.error(JSON.stringify({ message: "repo cache failed", error: String(error) }));
    }
    return redirect("/app", setSessionCookie(c.req.raw, session));
  } catch (error) {
    console.error(JSON.stringify({ message: "oauth failed", error: String(error) }));
    return htmlResponse(loginPage("GitHub sign-in failed. Please try again."), 502);
  }
});

/** Local development only; never enabled on a deployed environment. */
app.get("/auth/dev", async (c) => {
  if (c.env.DEV_LOGIN !== "1") return c.notFound();
  const login = c.req.query("login") ?? "devuser";
  const user = await upsertUser(c.env.DB, { id: 999000, login, name: "Dev User", avatar_url: null });
  return redirect("/app", setSessionCookie(c.req.raw, await createSession(c.env.DB, user.id)));
});

app.post("/auth/logout", async (c) => {
  const sessionId = readCookie(c.req.raw, "rk_session");
  if (sessionId) await destroySession(c.env.DB, sessionId);
  return redirect("/", clearSessionCookie(c.req.raw));
});

/* ── Dashboard ─────────────────────────────────────────────── */

app.use("/app/*", async (c, next) => {
  const user = await currentUser(c.env.DB, c.req.raw);
  if (!user) return htmlResponse(loginPage(), 401);
  c.set("user", user);
  await next();
});

app.get("/app", async (c) => {
  const user = c.get("user");
  const [projects, repos] = await Promise.all([
    listProjects(c.env.DB, user.id),
    listUserRepos(c.env.DB, user.id),
  ]);
  return htmlResponse(
    projectsPage(user, projects, repos, c.req.query("ok") ?? undefined, c.req.query("err") ?? undefined),
  );
});

app.get("/app/docs", (c) => htmlResponse(docsPage(c.get("user"), origin(c.req.raw))));

app.post("/app/projects", async (c) => {
  const user = c.get("user");
  const form = await c.req.formData();
  const slug = normalizeSlug(String(form.get("slug") ?? ""));
  const branch = String(form.get("default_branch") ?? "main").trim().slice(0, 100) || "main";
  if (!slug) return redirect("/app?err=" + encodeURIComponent("That does not look like a repository name. Try owner/repo."));
  if ((await countProjects(c.env.DB, user.id)) >= MAX_PROJECTS_PER_USER) {
    return redirect("/app?err=" + encodeURIComponent(`Project limit reached (${MAX_PROJECTS_PER_USER}).`));
  }
  const existing = await c.env.DB.prepare("SELECT id FROM projects WHERE user_id = ? AND slug = ?")
    .bind(user.id, slug)
    .first<{ id: string }>();
  if (existing) return redirect(`/app/p/${existing.id}`);
  const project = await createProject(c.env.DB, user.id, slug, branch);
  return redirect(`/app/p/${project.id}/settings?ok=` + encodeURIComponent("Project created. Create a token to connect CI."));
});

app.get("/app/p/:id", async (c) => {
  const user = c.get("user");
  const project = await getProject(c.env.DB, user.id, c.req.param("id"));
  if (!project) return htmlResponse(errorPage(404, "Project not found", "It may have been deleted.", user), 404);

  const [runs, latest, mutes] = await Promise.all([
    listRuns(c.env.DB, project.id),
    latestRunBody(c.env.DB, project.id),
    listMutes(c.env.DB, project.id),
  ]);
  const findings = latest ? await annotate(latest.report.repos.flatMap((repo) => repo.findings), mutes) : [];
  const filter = c.req.query("filter") ?? "open";

  return htmlResponse(
    projectPage(user, {
      project,
      runs,
      latest,
      findings,
      filter,
      flash: c.req.query("ok") ?? undefined,
    }),
  );
});

app.get("/app/p/:id/settings", async (c) => {
  const user = c.get("user");
  const project = await getProject(c.env.DB, user.id, c.req.param("id"));
  if (!project) return htmlResponse(errorPage(404, "Project not found", "It may have been deleted.", user), 404);
  const [tokens, mutes] = await Promise.all([listTokens(c.env.DB, project.id), listMutes(c.env.DB, project.id)]);
  return htmlResponse(
    settingsPage(
      user,
      project,
      tokens,
      mutes,
      origin(c.req.raw),
      c.req.query("token") ?? undefined,
      c.req.query("ok") ?? undefined,
    ),
  );
});

app.post("/app/p/:id/tokens", async (c) => {
  const user = c.get("user");
  const project = await getProject(c.env.DB, user.id, c.req.param("id"));
  if (!project) return c.notFound();
  const form = await c.req.formData();
  const token = await createToken(c.env.DB, project.id, String(form.get("name") ?? "ci"));
  return redirect(`/app/p/${project.id}/settings?token=${encodeURIComponent(token.plaintext)}`);
});

app.post("/app/p/:id/tokens/:tokenId/revoke", async (c) => {
  const user = c.get("user");
  const project = await getProject(c.env.DB, user.id, c.req.param("id"));
  if (!project) return c.notFound();
  await revokeToken(c.env.DB, project.id, c.req.param("tokenId"));
  return redirect(`/app/p/${project.id}/settings?ok=` + encodeURIComponent("Token revoked."));
});

app.post("/app/p/:id/mute", async (c) => {
  const user = c.get("user");
  const project = await getProject(c.env.DB, user.id, c.req.param("id"));
  if (!project) return c.notFound();
  const form = await c.req.formData();
  await addMute(
    c.env.DB,
    project.id,
    {
      code: String(form.get("code") ?? "").slice(0, 40),
      file: String(form.get("file") ?? "").slice(0, 200),
      subject: String(form.get("subject") ?? "").slice(0, 200),
    },
    null,
  );
  return redirect(`/app/p/${project.id}?ok=` + encodeURIComponent("Finding accepted; it no longer fails the build."));
});

app.post("/app/p/:id/unmute", async (c) => {
  const user = c.get("user");
  const project = await getProject(c.env.DB, user.id, c.req.param("id"));
  if (!project) return c.notFound();
  const form = await c.req.formData();
  const target = String(form.get("fingerprint") ?? "");
  const mutes = await listMutes(c.env.DB, project.id);
  const match = mutes.find((mute) => mute.fingerprint === target);
  if (match) await removeMute(c.env.DB, project.id, match.id);
  return redirect(`/app/p/${project.id}?ok=` + encodeURIComponent("Finding reopened."));
});

app.post("/app/p/:id/delete", async (c) => {
  const user = c.get("user");
  const removed = await deleteProject(c.env.DB, user.id, c.req.param("id"));
  return redirect("/app?" + (removed ? "ok=" + encodeURIComponent("Project deleted.") : "err=" + encodeURIComponent("Project not found.")));
});

/* ── Ingest API ────────────────────────────────────────────── */

app.post("/api/v1/reports", async (c) => {
  if (isRateLimited(`ingest:${clientIp(c.req.raw)}`, 30)) return c.json({ error: "Rate limit exceeded" }, 429);

  const auth = await projectFromToken(c.env.DB, c.req.raw);
  if (!auth) return c.json({ error: "Invalid or missing ingest token" }, 401);

  const raw = await readLimitedBody(c.req.raw, MAX_REPORT_BYTES);
  if (raw === null) return c.json({ error: "Report exceeds 64 KB" }, 413);
  const validation = parseReportBody(raw);
  if (!validation.ok) return c.json({ error: "Invalid report", details: validation.errors }, 400);
  if (validation.report.kind !== "drift") {
    return c.json({ error: "Only drift reports can be tracked over time" }, 400);
  }

  const meta = {
    branch: c.req.header("X-RuleKeeper-Branch")?.slice(0, 200) || undefined,
    commitSha: c.req.header("X-RuleKeeper-Commit")?.slice(0, 64) || undefined,
    prNumber: Number(c.req.header("X-RuleKeeper-PR")) || undefined,
  };

  const report = validation.report as DriftReport;
  const run = await recordRun(c.env.DB, auth.projectId, report, meta, raw);
  await touchToken(c.env.DB, auth.tokenId);

  // Tell CI which findings the owner has already accepted, so it can pass on them.
  const [mutes, previous] = await Promise.all([
    listMutes(c.env.DB, auth.projectId),
    previousFingerprints(c.env.DB, auth.projectId, run.id, run.branch),
  ]);
  const muted = new Set(mutes.map((mute) => mute.fingerprint));
  const findings = report.repos.flatMap((repo) => repo.findings);
  let openErrors = 0;
  let openWarnings = 0;
  let accepted = 0;
  let introduced = 0;
  const current = new Set<string>();
  for (const finding of findings) {
    const id = await fingerprint(finding.code, finding.file, finding.subject);
    current.add(id);
    // Counted against the previous run regardless of acceptance, so that resolved
    // and introduced stay symmetric and a finding coming back is always visible.
    if (previous && !previous.has(id)) introduced += 1;
    if (muted.has(id)) {
      accepted += 1;
      continue;
    }
    if (finding.severity === "error") openErrors += 1;
    if (finding.severity === "warn") openWarnings += 1;
  }
  const resolved = previous ? [...previous].filter((id) => !current.has(id)).length : 0;

  return c.json({
    ok: true,
    runId: run.id,
    score: run.score,
    url: `${origin(c.req.raw)}/app/p/${auth.projectId}`,
    open: { errors: openErrors, warnings: openWarnings },
    accepted,
    introduced,
    resolved,
    firstRun: previous === null,
  });
});

/** Lets CI learn what is already accepted before it decides to fail. */
app.get("/api/v1/baseline", async (c) => {
  const auth = await projectFromToken(c.env.DB, c.req.raw);
  if (!auth) return c.json({ error: "Invalid or missing ingest token" }, 401);
  const mutes = await listMutes(c.env.DB, auth.projectId);
  return c.json({ accepted: mutes.map((mute) => mute.fingerprint) });
});

/* ── Fallthrough ───────────────────────────────────────────── */

app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

app.notFound((c) =>
  c.req.path.startsWith("/api/")
    ? c.json({ error: "Not found" }, 404)
    : htmlResponse(errorPage(404, "Page not found", "That page does not exist."), 404),
);

app.onError((error, c) => {
  console.error(JSON.stringify({ message: "unhandled error", error: error.message, path: c.req.path }));
  return c.req.path.startsWith("/api/")
    ? c.json({ error: "Internal server error" }, 500)
    : htmlResponse(errorPage(500, "Something went wrong", "The error has been logged."), 500);
});

export default app;
