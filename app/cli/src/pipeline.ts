import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { attributeRepos, discoverSessions } from "./discover.js";
import { buildReport } from "./score.js";
import { writeJson } from "./report/json.js";
import { writeMarkdown } from "./report/markdown.js";
import type { Report } from "./types.js";

export interface ScanOptions { since: string; until: string; dir?: string; jsonPath: string; markdownPath: string; home?: string }
export function scan(options: ScanOptions): Report {
  const discovered = discoverSessions(options.since, options.until, options.home);
  const repos = attributeRepos(discovered.sessions, options.dir);
  const sessions = options.dir ? [...new Map(repos.flatMap(repo => repo.sessions).map(session => [session.id, session])).values()] : discovered.sessions;
  const report = buildReport(repos, sessions, options.since, options.until);
  for (const path of [options.jsonPath, options.markdownPath]) mkdirSync(dirname(resolve(path)), { recursive: true });
  writeJson(report, options.jsonPath); writeMarkdown(report, options.markdownPath); return report;
}
