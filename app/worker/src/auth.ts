import type { Context } from "hono";
import { newId, randomBase36, sha256Hex } from "./ids.ts";

const SESSION_COOKIE = "rk_session";
const STATE_COOKIE = "rk_oauth_state";
const SESSION_DAYS = 30;

export interface User {
  id: string;
  github_id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

export interface GitHubProfile {
  id: number;
  login: string;
  name?: string | null;
  avatar_url?: string | null;
}

function cookie(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  const parts = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("Cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

function isSecure(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

export function setSessionCookie(request: Request, sessionId: string): string {
  return cookie(SESSION_COOKIE, sessionId, SESSION_DAYS * 24 * 60 * 60, isSecure(request));
}

export function clearSessionCookie(request: Request): string {
  return cookie(SESSION_COOKIE, "", 0, isSecure(request));
}

export function setStateCookie(request: Request, state: string): string {
  return cookie(STATE_COOKIE, state, 600, isSecure(request));
}

export function readStateCookie(request: Request): string | undefined {
  return readCookie(request, STATE_COOKIE);
}

export async function createSession(db: D1Database, userId: string): Promise<string> {
  const id = newId("ses");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db
    .prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(id, userId, now.toISOString(), expires.toISOString())
    .run();
  return id;
}

export async function destroySession(db: D1Database, sessionId: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
}

export async function currentUser(db: D1Database, request: Request): Promise<User | null> {
  const sessionId = readCookie(request, SESSION_COOKIE);
  if (!sessionId) return null;
  const row = await db
    .prepare(
      `SELECT u.id, u.github_id, u.login, u.name, u.avatar_url, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`,
    )
    .bind(sessionId)
    .first<User & { expires_at: string }>();
  if (!row) return null;
  if (Date.parse(row.expires_at) < Date.now()) {
    await destroySession(db, sessionId);
    return null;
  }
  return { id: row.id, github_id: row.github_id, login: row.login, name: row.name, avatar_url: row.avatar_url };
}

export async function upsertUser(db: D1Database, profile: GitHubProfile): Promise<User> {
  const now = new Date().toISOString();
  const existing = await db
    .prepare("SELECT id FROM users WHERE github_id = ?")
    .bind(profile.id)
    .first<{ id: string }>();

  const id = existing?.id ?? newId("usr");
  if (existing) {
    await db
      .prepare("UPDATE users SET login = ?, name = ?, avatar_url = ?, last_seen_at = ? WHERE id = ?")
      .bind(profile.login, profile.name ?? null, profile.avatar_url ?? null, now, id)
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO users (id, github_id, login, name, avatar_url, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, profile.id, profile.login, profile.name ?? null, profile.avatar_url ?? null, now, now)
      .run();
  }
  return {
    id,
    github_id: profile.id,
    login: profile.login,
    name: profile.name ?? null,
    avatar_url: profile.avatar_url ?? null,
  };
}

export function oauthState(): string {
  return randomBase36(32);
}

export function authorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<string> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri }),
  });
  if (!response.ok) throw new Error(`GitHub token exchange failed (${response.status})`);
  const body = (await response.json()) as { access_token?: string; error_description?: string };
  if (!body.access_token) throw new Error(body.error_description ?? "GitHub did not return an access token");
  return body.access_token;
}

export async function fetchProfile(accessToken: string): Promise<GitHubProfile> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/vnd.github+json",
      "user-agent": "rulekeeper",
    },
  });
  if (!response.ok) throw new Error(`GitHub profile fetch failed (${response.status})`);
  const body = (await response.json()) as GitHubProfile;
  if (typeof body.id !== "number" || typeof body.login !== "string") throw new Error("Unexpected GitHub profile");
  return body;
}

/** Resolves the ingest token on a request, returning the project it belongs to. */
export async function projectFromToken(
  db: D1Database,
  request: Request,
): Promise<{ projectId: string; tokenId: string } | null> {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match?.[1]) return null;
  const row = await db
    .prepare("SELECT id, project_id FROM project_tokens WHERE token_hash = ?")
    .bind(await sha256Hex(match[1]))
    .first<{ id: string; project_id: string }>();
  if (!row) return null;
  return { projectId: row.project_id, tokenId: row.id };
}

export type AppContext = Context<{ Bindings: Env; Variables: { user: User } }>;
