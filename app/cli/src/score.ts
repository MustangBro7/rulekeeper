import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join } from "node:path";
import type { ExtractedRule, Receipt, Report, RepoContext, ScoredRule, Session } from "./types.js";
import { dateOnly, normalizeCommand } from "./util.js";

const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".sql", ".css", ".scss", ".json", ".jsonc", ".toml", ".yaml", ".yml"]);
const birthCache = new Map<string, string>();

function parseIso(value: string): number | undefined { const ms = Date.parse(value); return Number.isNaN(ms) ? undefined : ms; }
function inRepo(path: string, repo: RepoContext, session: Session): boolean {
  if (isAbsolute(path)) return path === repo.root || path.startsWith(`${repo.root}/`);
  return session.cwd === repo.root || session.cwd.startsWith(`${repo.root}/`);
}
function repoEdits(session: Session, repo: RepoContext) { return session.edits.filter(edit => inRepo(edit.path, repo, session)); }
function codeEdits(session: Session, repo: RepoContext) { return repoEdits(session, repo).filter(edit => CODE_EXTENSIONS.has(extname(edit.path)) && !edit.path.includes("node_modules")); }
function inContext(session: Session, rule: ExtractedRule): boolean { return rule.file.markers.some(marker => session.rawText.includes(marker)); }

export function gitBirthDate(path: string, pickaxe?: string): string {
  const key = `${path}\0${pickaxe ?? ""}`; const cached = birthCache.get(key); if (cached !== undefined) return cached;
  let born = "";
  try {
    const args = ["-C", dirname(path), "log", "--reverse", "--format=%aI"];
    if (!pickaxe) args.splice(4, 0, "--follow"); else args.push("-S", pickaxe);
    args.push("--", basename(path));
    born = execFileSync("git", args, { encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/).find(Boolean) ?? "";
  } catch { /* fall back to mtime */ }
  if (!born && pickaxe) born = gitBirthDate(path);
  if (!born) try { born = statSync(path).mtime.toISOString(); } catch { /* missing instruction */ }
  birthCache.set(key, born); return born;
}

export type BirthProvider = (path: string, pickaxe?: string) => string;

function evaluate(rule: ExtractedRule, session: Session, repo: RepoContext): { applies: boolean; follows: boolean; evidence: string } {
  const edits = repoEdits(session, repo); const code = codeEdits(session, repo);
  if (rule.kind === "delivery") return { applies: true, follows: inContext(session, rule), evidence: inContext(session, rule) ? `${rule.file.name} marker observed` : `${rule.file.name} marker absent` };
  if (rule.kind === "gate") {
    const found = (rule.commands ?? []).some(command => {
      const wanted = normalizeCommand(command); return session.commands.some(candidate => normalizeCommand(candidate.cmd).includes(wanted));
    });
    return { applies: code.length > 0, follows: found, evidence: found ? `one of ${rule.commands?.length ?? 0} checks observed after ${code.length} code edit(s)` : `all ${rule.commands?.length ?? 0} checks absent after ${code.length} code edit(s)` };
  }
  if (rule.kind === "info") {
    const wanted = normalizeCommand(rule.command ?? ""); const found = session.commands.some(command => normalizeCommand(command.cmd).includes(wanted));
    return { applies: found, follows: found, evidence: found ? "informational command observed" : "informational command absent" };
  }
  if (rule.kind === "command") {
    const wanted = normalizeCommand(rule.command ?? ""); const found = session.commands.some(command => normalizeCommand(command.cmd).includes(wanted));
    return { applies: code.length > 0, follows: found, evidence: found ? `required command observed after ${code.length} code edit(s)` : `required command absent after ${code.length} code edit(s)` };
  }
  if (rule.kind === "package-manager") {
    const others = ["npm", "pnpm", "yarn", "bun"].filter(manager => manager !== rule.packageManager);
    const bad = session.commands.some(command => others.some(manager => new RegExp(`(?:^|[;&|]\\s*)${manager}\\s+(?:i|install|run|test)\\b`).test(command.cmd)));
    return { applies: code.length > 0, follows: !bad, evidence: bad ? "different package manager invocation observed" : `${rule.packageManager} policy respected` };
  }
  if (rule.kind === "custom-command") {
    const relevant = edits.filter(edit => rule.editsMatching?.test(edit.path)); const found = session.commands.some(command => rule.requireCommand?.test(command.cmd));
    const targets = [...new Set(relevant.map(edit => basename(edit.path)))].join(", ") || "matching files";
    return { applies: relevant.length > 0, follows: found, evidence: found ? `required after ${targets} edits and observed` : `required after ${targets} edits` };
  }
  const relevant = edits.filter(edit => rule.inEditsMatching?.test(edit.path)); const bad = relevant.some(edit => rule.forbidContent?.test(edit.content));
  return { applies: relevant.length > 0, follows: !bad, evidence: bad ? `forbidden content observed in ${basename(relevant.find(edit => rule.forbidContent?.test(edit.content))?.path ?? "edit")}` : `forbidden content absent from ${relevant.length} edit(s)` };
}

function verdict(rule: ExtractedRule, applicable: number, followed: number, violated: number, inCount: number, inFollowed: number, outCount: number, outFollowed: number): ScoredRule["verdict"] {
  if (rule.kind === "delivery") return applicable > 0 && followed < applicable ? "not-delivered" : applicable ? "works" : "untested";
  if (rule.kind === "info") return followed > 0 ? "works" : "untested";
  if (applicable === 0) return "untested";
  if (violated > 0) return "broken";
  if (followed >= 3 && followed === applicable && outFollowed > 0 && outFollowed === outCount && inFollowed === inCount) return "dead-weight";
  return followed === applicable ? "works" : "untested";
}

export function scoreRule(rule: ExtractedRule, repo: RepoContext, birthProvider: BirthProvider = gitBirthDate): ScoredRule {
  const pickaxe = rule.kind === "delivery" ? undefined : rule.command ?? rule.commands?.[0] ?? rule.quote;
  const born = birthProvider(rule.file.path, pickaxe);
  const bornMs = parseIso(born); let applicable = 0; let followed = 0; let violated = 0; let preRule = 0;
  let inApplicable = 0; let inFollowed = 0; let outApplicable = 0; let outFollowed = 0; const receipts: Receipt[] = [];
  for (const session of repo.sessions) {
    const result = evaluate(rule, session, repo); if (!result.applies) continue;
    const end = parseIso(session.lastTs); if (bornMs !== undefined && end !== undefined && end < bornMs) { preRule++; continue; }
    applicable++; const context = inContext(session, rule);
    if (context) inApplicable++; else outApplicable++;
    if (result.follows) { followed++; if (context) inFollowed++; else outFollowed++; }
    else if (rule.kind !== "info") violated++;
    if (!result.follows || rule.kind === "delivery") receipts.push({ sessionId8: session.source === "codex" ? session.id.slice(-8) : session.id.slice(0, 8), date: dateOnly(session.firstTs), evidence: result.evidence.slice(0, 180) });
  }
  return { id: rule.id, kind: rule.kind, quote: rule.quote.slice(0, 140), born, applicable, followed, violated, preRule, inContext: { followed: inFollowed, applicable: inApplicable }, outOfContext: { followed: outFollowed, applicable: outApplicable }, verdict: verdict(rule, applicable, followed, violated, inApplicable, inFollowed, outApplicable, outFollowed), receipts: receipts.slice(0, 10), ...(rule.kind === "info" ? { observation: `observed in ${followed} sessions` } : {}) };
}

export function buildReport(repos: RepoContext[], sessions: Session[], since: string, until: string, birthProvider: BirthProvider = gitBirthDate): Report {
  return {
    v: 1, generatedAt: new Date().toISOString(), window: { since, until },
    totals: { sessions: sessions.length, commands: sessions.reduce((n, s) => n + s.commands.length, 0), edits: sessions.reduce((n, s) => n + s.edits.length, 0), errors: sessions.reduce((n, s) => n + s.errors, 0), sources: { claude: sessions.filter(s => s.source === "claude").length, codex: sessions.filter(s => s.source === "codex").length } },
    repos: repos.map(repo => ({ name: repo.name, files: repo.files.map(file => ({ name: file.name, tokensEstimate: file.tokensEstimate, sessionsTouching: repo.sessions.length, sessionsInContext: repo.sessions.filter(session => file.markers.some(marker => session.rawText.includes(marker))).length })), rules: (awaitRules(repo)).map(rule => scoreRule(rule, repo, birthProvider)) }))
  };
}

function awaitRules(repo: RepoContext): ExtractedRule[] {
  // Kept as a small indirection so scoring remains the only report assembler.
  return extractRulesLocal(repo);
}

import { extractRules as extractRulesLocal } from "./rules.js";
