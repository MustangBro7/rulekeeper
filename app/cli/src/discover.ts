import { existsSync, readFileSync, readdirSync, realpathSync, statSync, type Dirent } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { parseClaudeSession } from "./parse/claude.js";
import { parseCodexSession } from "./parse/codex.js";
import type { InstructionFile, RepoContext, Session } from "./types.js";
import { sessionInWindow } from "./util.js";

function walk(root: string, accept: (path: string) => boolean): string[] {
  if (!existsSync(root)) return [];
  const output: string[] = []; const stack = [root];
  while (stack.length) {
    const dir = stack.pop(); if (!dir) continue;
    let entries: Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(path); else if (entry.isFile() && accept(path)) output.push(path);
    }
  }
  return output.sort();
}

export interface DiscoveryResult { sessions: Session[]; found: { claude: number; codex: number } }

export function discoverSessions(since: string, until: string, home = homedir()): DiscoveryResult {
  const sessions: Session[] = []; let claude = 0; let codex = 0;
  const claudeRoot = join(home, ".claude", "projects");
  for (const main of walk(claudeRoot, path => path.endsWith(".jsonl")).filter(path => dirname(path).split(/[\\/]/).pop() !== "subagents")) {
    const stem = basename(main, ".jsonl"); const subRoot = join(dirname(main), stem, "subagents");
    const subs = walk(subRoot, path => path.endsWith(".jsonl"));
    const session = parseClaudeSession(main, subs);
    if (sessionInWindow(session.firstTs, since, until)) { sessions.push(session); claude++; }
  }
  const codexRoot = join(home, ".codex", "sessions");
  for (const file of walk(codexRoot, path => /rollout-.*\.jsonl$/.test(basename(path)))) {
    const session = parseCodexSession(file);
    if (sessionInWindow(session.firstTs, since, until)) { sessions.push(session); codex++; }
  }
  sessions.sort((a, b) => a.firstTs.localeCompare(b.firstTs));
  return { sessions, found: { claude, codex } };
}

/**
 * Package managers and toolchains ship their own CLAUDE.md / AGENTS.md. Touching one during a
 * session does not make it your repository, and reporting it only produces noise.
 */
const VENDOR_ROOTS = [
  "/opt/homebrew", "/usr/local/Homebrew", "/home/linuxbrew",
  "/usr/lib", "/usr/share", "/Library", "/System", "/Applications", "/nix", "/snap",
];
const VENDOR_SEGMENTS = [
  "node_modules", "site-packages", "vendor/bundle", ".cargo/registry", ".rustup",
  ".nvm", ".pyenv", ".rbenv", ".bun/install", ".deno", ".gradle", ".m2",
];

export function isVendorRoot(root: string, home = homedir()): boolean {
  if (VENDOR_ROOTS.some(prefix => root === prefix || root.startsWith(`${prefix}/`))) return true;
  if (VENDOR_SEGMENTS.some(segment => root.includes(`/${segment}/`) || root.endsWith(`/${segment}`))) return true;
  return ["go/pkg", ".local/share/pnpm", ".npm", ".cache"].some(
    segment => root === join(home, segment) || root.startsWith(`${join(home, segment)}/`),
  );
}

export function findGitRoot(candidate: string): string | undefined {
  let start = candidate;
  try { if (existsSync(start) && !statSync(start).isDirectory()) start = dirname(start); } catch { return undefined; }
  if (!existsSync(start)) return undefined;
  try { return realpathSync(execFileSync("git", ["-C", start, "rev-parse", "--show-toplevel"], { encoding: "utf8", timeout: 5_000, stdio: ["ignore", "pipe", "ignore"] }).trim()); }
  catch { return undefined; }
}

function candidatePaths(session: Session): string[] {
  const values = [session.cwd, ...session.commands.map(c => c.workdir), ...session.edits.map(e => e.path), ...session.reads.map(r => r.path)];
  const commandPaths = session.commands.flatMap(command => command.cmd.match(/(?:\/[^\s'";|]+)/g) ?? []);
  return [...values, ...commandPaths].filter(isAbsolute);
}

export function discoverInstructionFiles(root: string): InstructionFile[] {
  const paths = [join(root, "CLAUDE.md"), join(root, "AGENTS.md")];
  let children: Dirent[] = [];
  try { children = readdirSync(root, { withFileTypes: true }); } catch { /* inaccessible repo */ }
  for (const child of children) if (child.isDirectory() && child.name !== "node_modules" && child.name !== ".git") {
    paths.push(join(root, child.name, "CLAUDE.md"), join(root, child.name, "AGENTS.md"));
  }
  return paths.filter(existsSync).map(path => {
    const content = readFileSync(path, "utf8");
    return { path, name: basename(path), content, markers: distinctiveMarkers(content), tokensEstimate: Math.floor(Buffer.byteLength(content) / 4) };
  });
}

export function distinctiveMarkers(content: string): string[] {
  const boilerplate = /^(?:```|~~~|---+$|___+$|\*\*\*+$|\|?[\s:|-]+\|?)$/;
  return content.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => !/^#{1,6}\s/.test(line))
    .map(line => line.replace(/^(?:[-*+]\s+|\d+[.)]\s+|>\s*)/, "").trim())
    .filter(line => line.length >= 12 && !boilerplate.test(line))
    .sort((a, b) => b.length - a.length || a.localeCompare(b)).slice(0, 3);
}

export function attributeRepos(sessions: Session[], onlyDir?: string): RepoContext[] {
  const roots = new Map<string, Session[]>();
  const fixed = onlyDir ? findGitRoot(resolve(onlyDir)) ?? resolve(onlyDir) : undefined;
  for (const session of sessions) {
    const touched = new Set<string>();
    for (const candidate of candidatePaths(session)) {
      const root = findGitRoot(candidate); if (root && (!fixed || root === fixed || root.startsWith(`${fixed}/`))) touched.add(root);
    }
    if (fixed && candidatePaths(session).some(path => path === fixed || path.startsWith(`${fixed}/`))) touched.add(fixed);
    for (const root of touched) { const current = roots.get(root) ?? []; current.push(session); roots.set(root, current); }
  }
  if (fixed && !roots.has(fixed) && existsSync(fixed)) roots.set(fixed, []);
  return [...roots]
    .filter(([root]) => fixed !== undefined || !isVendorRoot(root))
    .map(([root, touched]) => ({ root, name: basename(root), sessions: touched, files: discoverInstructionFiles(root) }))
    .filter(repo => repo.files.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}
