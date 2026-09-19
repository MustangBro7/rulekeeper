import { fingerprint, newId, randomBase36, sha256Hex } from "./ids.ts";
import type { DriftReport, DriftFinding } from "./reports.ts";

export const MAX_PROJECTS_PER_USER = 20;
export const RUN_RETENTION = 100;

export interface Project {
  id: string;
  user_id: string;
  slug: string;
  name: string;
  default_branch: string;
  created_at: string;
}

export interface Run {
  id: string;
  project_id: string;
  kind: string;
  branch: string | null;
  commit_sha: string | null;
  pr_number: number | null;
  score: number;
  claims: number;
  verified: number;
  errors: number;
  warnings: number;
  infos: number;
  created_at: string;
}

export interface Mute {
  id: string;
  fingerprint: string;
  code: string;
  file: string;
  subject: string;
  reason: string | null;
  created_at: string;
}

export interface ProjectSummary extends Project {
  latest: Run | null;
  previous_score: number | null;
  run_count: number;
}

const SLUG_PATTERN = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?$/;

export function normalizeSlug(value: string): string | null {
  const slug = value.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  if (!slug || slug.length > 120 || !SLUG_PATTERN.test(slug)) return null;
  return slug;
}

export async function listProjects(db: D1Database, userId: string): Promise<ProjectSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT p.*,
              (SELECT COUNT(*) FROM runs r WHERE r.project_id = p.id) AS run_count
       FROM projects p WHERE p.user_id = ? ORDER BY p.created_at DESC`,
    )
    .bind(userId)
    .all<Project & { run_count: number }>();

  const summaries: ProjectSummary[] = [];
  for (const project of results ?? []) {
    const { results: recent } = await db
      .prepare(
        `SELECT * FROM runs WHERE project_id = ? AND (branch IS NULL OR branch = ?)
         ORDER BY created_at DESC LIMIT 2`,
      )
      .bind(project.id, project.default_branch)
      .all<Run>();
    const latest = recent?.[0] ?? null;
    summaries.push({
      ...project,
      latest,
      previous_score: recent?.[1]?.score ?? null,
      run_count: project.run_count,
    });
  }
  return summaries;
}

export async function getProject(db: D1Database, userId: string, projectId: string): Promise<Project | null> {
  return db
    .prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?")
    .bind(projectId, userId)
    .first<Project>();
}

export async function createProject(
  db: D1Database,
  userId: string,
  slug: string,
  defaultBranch: string,
): Promise<Project> {
  const id = newId("prj");
  const now = new Date().toISOString();
  const name = slug.includes("/") ? (slug.split("/").pop() as string) : slug;
  await db
    .prepare(
      `INSERT INTO projects (id, user_id, slug, name, default_branch, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, userId, slug, name, defaultBranch, now)
    .run();
  return { id, user_id: userId, slug, name, default_branch: defaultBranch, created_at: now };
}

export async function deleteProject(db: D1Database, userId: string, projectId: string): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM projects WHERE id = ? AND user_id = ?")
    .bind(projectId, userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function countProjects(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM projects WHERE user_id = ?")
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Creates a token and returns the plaintext exactly once. */
export async function createToken(
  db: D1Database,
  projectId: string,
  name: string,
): Promise<{ id: string; plaintext: string; prefix: string }> {
  const plaintext = `rk_${randomBase36(40)}`;
  const prefix = plaintext.slice(0, 11);
  const id = newId("tok");
  await db
    .prepare(
      `INSERT INTO project_tokens (id, project_id, token_hash, name, prefix, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, projectId, await sha256Hex(plaintext), name.slice(0, 60) || "ci", prefix, new Date().toISOString())
    .run();
  return { id, plaintext, prefix };
}

export async function listTokens(db: D1Database, projectId: string) {
  const { results } = await db
    .prepare("SELECT id, name, prefix, created_at, last_used_at FROM project_tokens WHERE project_id = ? ORDER BY created_at DESC")
    .bind(projectId)
    .all<{ id: string; name: string; prefix: string; created_at: string; last_used_at: string | null }>();
  return results ?? [];
}

export async function revokeToken(db: D1Database, projectId: string, tokenId: string): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM project_tokens WHERE id = ? AND project_id = ?")
    .bind(tokenId, projectId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function touchToken(db: D1Database, tokenId: string): Promise<void> {
  await db
    .prepare("UPDATE project_tokens SET last_used_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), tokenId)
    .run();
}

export interface RunMeta {
  branch?: string | undefined;
  commitSha?: string | undefined;
  prNumber?: number | undefined;
}

export async function recordRun(
  db: D1Database,
  projectId: string,
  report: DriftReport,
  meta: RunMeta,
  body: string,
): Promise<Run> {
  const id = newId("run");
  const now = new Date().toISOString();
  const score = report.repos[0]?.score ?? 0;
  await db
    .prepare(
      `INSERT INTO runs (id, project_id, kind, branch, commit_sha, pr_number, score, claims, verified, errors, warnings, infos, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      projectId,
      report.kind,
      meta.branch ?? null,
      meta.commitSha ?? null,
      meta.prNumber ?? null,
      score,
      report.totals.claims,
      report.totals.verified,
      report.totals.errors,
      report.totals.warnings,
      report.totals.infos,
      body,
      now,
    )
    .run();

  // Keep history bounded so a chatty CI pipeline cannot grow a project without limit.
  await db
    .prepare(
      `DELETE FROM runs WHERE project_id = ? AND id NOT IN (
         SELECT id FROM runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?
       )`,
    )
    .bind(projectId, projectId, RUN_RETENTION)
    .run();

  return {
    id,
    project_id: projectId,
    kind: report.kind,
    branch: meta.branch ?? null,
    commit_sha: meta.commitSha ?? null,
    pr_number: meta.prNumber ?? null,
    score,
    claims: report.totals.claims,
    verified: report.totals.verified,
    errors: report.totals.errors,
    warnings: report.totals.warnings,
    infos: report.totals.infos,
    created_at: now,
  };
}

export async function listRuns(db: D1Database, projectId: string, limit = 40): Promise<Run[]> {
  const { results } = await db
    .prepare("SELECT id, project_id, kind, branch, commit_sha, pr_number, score, claims, verified, errors, warnings, infos, created_at FROM runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?")
    .bind(projectId, limit)
    .all<Run>();
  return results ?? [];
}

export async function latestRunBody(
  db: D1Database,
  projectId: string,
  runId?: string,
): Promise<{ run: Run; report: DriftReport } | null> {
  const row = runId
    ? await db.prepare("SELECT * FROM runs WHERE id = ? AND project_id = ?").bind(runId, projectId).first<Run & { body: string }>()
    : await db.prepare("SELECT * FROM runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1").bind(projectId).first<Run & { body: string }>();
  if (!row) return null;
  try {
    return { run: row, report: JSON.parse(row.body) as DriftReport };
  } catch {
    return null;
  }
}

/** Fingerprints present in the most recent run before `beforeRunId`, for a new-vs-existing diff. */
export async function previousFingerprints(
  db: D1Database,
  projectId: string,
  beforeRunId: string,
  branch: string | null,
): Promise<Set<string> | null> {
  const row = branch
    ? await db.prepare("SELECT body FROM runs WHERE project_id = ? AND branch = ? AND id != ? ORDER BY created_at DESC LIMIT 1")
        .bind(projectId, branch, beforeRunId).first<{ body: string }>()
    : await db.prepare("SELECT body FROM runs WHERE project_id = ? AND id != ? ORDER BY created_at DESC LIMIT 1")
        .bind(projectId, beforeRunId).first<{ body: string }>();
  if (!row) return null;
  try {
    const report = JSON.parse(row.body) as DriftReport;
    const ids = await Promise.all(
      report.repos.flatMap((repo) => repo.findings).map((f) => fingerprint(f.code, f.file, f.subject)),
    );
    return new Set(ids);
  } catch {
    return null;
  }
}

export async function listMutes(db: D1Database, projectId: string): Promise<Mute[]> {
  const { results } = await db
    .prepare("SELECT id, fingerprint, code, file, subject, reason, created_at FROM mutes WHERE project_id = ? ORDER BY created_at DESC")
    .bind(projectId)
    .all<Mute>();
  return results ?? [];
}

export async function addMute(
  db: D1Database,
  projectId: string,
  finding: Pick<DriftFinding, "code" | "file" | "subject">,
  reason: string | null,
): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO mutes (id, project_id, fingerprint, code, file, subject, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId("mut"),
      projectId,
      await fingerprint(finding.code, finding.file, finding.subject),
      finding.code,
      finding.file,
      finding.subject,
      reason,
      new Date().toISOString(),
    )
    .run();
}

export async function removeMute(db: D1Database, projectId: string, muteId: string): Promise<boolean> {
  const result = await db
    .prepare("DELETE FROM mutes WHERE id = ? AND project_id = ?")
    .bind(muteId, projectId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Annotates findings with their fingerprint and whether the owner has muted them. */
export async function annotate(
  findings: DriftFinding[],
  mutes: Mute[],
): Promise<Array<DriftFinding & { fingerprint: string; muted: boolean }>> {
  const muted = new Set(mutes.map((mute) => mute.fingerprint));
  return Promise.all(
    findings.map(async (finding) => {
      const id = await fingerprint(finding.code, finding.file, finding.subject);
      return { ...finding, fingerprint: id, muted: muted.has(id) };
    }),
  );
}
