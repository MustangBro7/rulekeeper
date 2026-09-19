import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from "node:fs";
import { join, relative } from "node:path";

const SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "out", "target", "vendor", "coverage",
  ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", ".venv", "venv", "__pycache__",
  ".wrangler", ".vercel", ".idea", ".gradle", ".terraform",
]);
const MAX_ENTRIES = 40_000;
const MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
export type PackageManager = (typeof MANAGERS)[number];

export interface RepoFacts {
  root: string;
  name: string;
  /** Repo-relative paths, POSIX separators, of every tracked-ish file. */
  files: Set<string>;
  dirs: Set<string>;
  /** Script names available from any package.json, plus which file defined them. */
  scripts: Map<string, string>;
  dependencies: Set<string>;
  makeTargets: Set<string>;
  justTargets: Set<string>;
  cargoAliases: Set<string>;
  hasCargo: boolean;
  hasPython: boolean;
  envVars: Set<string>;
  lockfiles: Set<PackageManager>;
  declaredManager?: PackageManager;
}

function walk(root: string): { files: Set<string>; dirs: Set<string> } {
  const files = new Set<string>();
  const dirs = new Set<string>();
  const stack: string[] = [root];
  let seen = 0;
  while (stack.length && seen < MAX_ENTRIES) {
    const dir = stack.pop();
    if (dir === undefined) continue;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      seen += 1;
      const absolute = join(dir, entry.name);
      const rel = relative(root, absolute).replaceAll("\\", "/");
      if (entry.isDirectory()) {
        dirs.add(rel);
        if (!SKIP_DIRS.has(entry.name)) stack.push(absolute);
      } else if (entry.isFile()) {
        files.add(rel);
      }
    }
  }
  return { files, dirs };
}

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(stripJsonComments(readFileSync(path, "utf8")));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** wrangler.jsonc and tsconfig.json allow comments and trailing commas. */
export function stripJsonComments(source: string): string {
  let output = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (inLine) {
      if (char === "\n") { inLine = false; output += char; }
      continue;
    }
    if (inBlock) {
      if (char === "*" && next === "/") { inBlock = false; index += 1; }
      continue;
    }
    if (inString) {
      output += char;
      if (char === "\\") { output += next; index += 1; continue; }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; output += char; continue; }
    if (char === "/" && next === "/") { inLine = true; index += 1; continue; }
    if (char === "/" && next === "*") { inBlock = true; index += 1; continue; }
    output += char;
  }
  return output.replace(/,(\s*[}\]])/g, "$1");
}

function collectPackageJson(root: string, files: Set<string>, facts: RepoFacts): void {
  const manifests = [...files].filter(
    (file) => file === "package.json" || (file.endsWith("/package.json") && file.split("/").length <= 4),
  );
  for (const manifest of manifests) {
    const parsed = readJson(join(root, manifest));
    if (!parsed) continue;
    const scripts = parsed.scripts;
    if (scripts !== null && typeof scripts === "object") {
      for (const name of Object.keys(scripts)) if (!facts.scripts.has(name)) facts.scripts.set(name, manifest);
    }
    for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      const block = parsed[field];
      if (block !== null && typeof block === "object") for (const name of Object.keys(block)) facts.dependencies.add(name);
    }
    if (manifest === "package.json" && typeof parsed.packageManager === "string") {
      const declared = MANAGERS.find((manager) => (parsed.packageManager as string).startsWith(manager));
      if (declared) facts.declaredManager = declared;
    }
  }
}

function collectMakeTargets(root: string, files: Set<string>): Set<string> {
  const targets = new Set<string>();
  for (const name of ["Makefile", "makefile", "GNUmakefile"]) {
    if (!files.has(name)) continue;
    try {
      for (const line of readFileSync(join(root, name), "utf8").split(/\r?\n/)) {
        const match = /^([A-Za-z0-9][A-Za-z0-9_.-]*)\s*:(?!=)/.exec(line);
        if (match?.[1]) targets.add(match[1]);
      }
    } catch { /* unreadable makefile leaves targets unknown */ }
  }
  return targets;
}

function collectJustTargets(root: string, files: Set<string>): Set<string> {
  const targets = new Set<string>();
  for (const name of ["justfile", "Justfile", ".justfile"]) {
    if (!files.has(name)) continue;
    try {
      for (const line of readFileSync(join(root, name), "utf8").split(/\r?\n/)) {
        const match = /^([A-Za-z0-9][A-Za-z0-9_-]*)(?:\s+[A-Za-z0-9_+=*"'-]+)*\s*:(?!=)/.exec(line);
        if (match?.[1]) targets.add(match[1]);
      }
    } catch { /* unreadable justfile leaves targets unknown */ }
  }
  return targets;
}

function collectCargoAliases(root: string, files: Set<string>): Set<string> {
  const aliases = new Set<string>();
  for (const name of [".cargo/config.toml", ".cargo/config"]) {
    if (!files.has(name)) continue;
    try {
      const content = readFileSync(join(root, name), "utf8");
      const section = /\[alias\]([\s\S]*?)(?:\n\[|$)/.exec(content);
      for (const line of (section?.[1] ?? "").split(/\r?\n/)) {
        const match = /^\s*([A-Za-z0-9_-]+)\s*=/.exec(line);
        if (match?.[1]) aliases.add(match[1]);
      }
    } catch { /* unreadable cargo config leaves aliases unknown */ }
  }
  return aliases;
}

const ENV_SOURCE_FILES = [
  ".env.example", ".env.sample", ".env.template", ".env", ".env.local",
  ".dev.vars.example", ".dev.vars", "wrangler.jsonc", "wrangler.json", "wrangler.toml",
  "docker-compose.yml", "docker-compose.yaml", "fly.toml", "vercel.json",
];

function collectEnvVars(root: string, files: Set<string>): Set<string> {
  const vars = new Set<string>();
  for (const name of ENV_SOURCE_FILES) {
    if (!files.has(name)) continue;
    try {
      const content = readFileSync(join(root, name), "utf8");
      for (const match of content.matchAll(/\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)\b/g)) if (match[1]) vars.add(match[1]);
    } catch { /* unreadable env source contributes nothing */ }
  }
  const code = [...files].filter(
    (file) => /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|sh)$/.test(file) && file.split("/").length <= 5,
  ).slice(0, 400);
  for (const file of code) {
    try {
      const content = readFileSync(join(root, file), "utf8");
      const patterns = [
        /process\.env\.([A-Z][A-Z0-9_]*)/g,
        /process\.env\[["'`]([A-Z][A-Z0-9_]*)["'`]\]/g,
        /env\.([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)/g,
        /(?:os\.environ(?:\.get)?\[?|getenv)\(?["']([A-Z][A-Z0-9_]*)["']/g,
      ];
      for (const pattern of patterns) for (const match of content.matchAll(pattern)) if (match[1]) vars.add(match[1]);
    } catch { /* unreadable source contributes nothing */ }
  }
  return vars;
}

export function lastCommitDate(root: string, file: string): string {
  try {
    return execFileSync("git", ["-C", root, "log", "-1", "--format=%aI", "--", file], {
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim().slice(0, 10);
  } catch {
    try {
      return statSync(join(root, file)).mtime.toISOString().slice(0, 10);
    } catch {
      return "";
    }
  }
}

/** Number of commits touching `area` since `since` (ISO date), capped for speed. */
export function commitsSince(root: string, area: string, since: string): number {
  if (!since) return 0;
  try {
    const output = execFileSync(
      "git",
      ["-C", root, "rev-list", "--count", `--since=${since}`, "HEAD", "--", area],
      { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const count = Number(output);
    return Number.isFinite(count) ? count : 0;
  } catch {
    return 0;
  }
}

export function collectRepoFacts(root: string, name: string): RepoFacts {
  const { files, dirs } = walk(root);
  const facts: RepoFacts = {
    root,
    name,
    files,
    dirs,
    scripts: new Map(),
    dependencies: new Set(),
    makeTargets: collectMakeTargets(root, files),
    justTargets: collectJustTargets(root, files),
    cargoAliases: collectCargoAliases(root, files),
    hasCargo: files.has("Cargo.toml"),
    hasPython: files.has("pyproject.toml") || files.has("setup.py") || files.has("requirements.txt"),
    envVars: collectEnvVars(root, files),
    lockfiles: new Set(),
  };
  collectPackageJson(root, files, facts);
  if (files.has("package-lock.json")) facts.lockfiles.add("npm");
  if (files.has("pnpm-lock.yaml")) facts.lockfiles.add("pnpm");
  if (files.has("yarn.lock")) facts.lockfiles.add("yarn");
  if (files.has("bun.lockb") || files.has("bun.lock")) facts.lockfiles.add("bun");
  return facts;
}

export function pathExists(facts: RepoFacts, candidate: string): boolean {
  const clean = candidate.replace(/^\.\//, "").replace(/\/$/, "");
  if (!clean) return false;
  if (facts.files.has(clean) || facts.dirs.has(clean)) return true;
  // Paths written relative to a nested package (e.g. `src/index.ts` inside app/worker/).
  return existsSync(join(facts.root, clean));
}

/** Resolves a doc path that may be written relative to a nested workspace directory. */
export function pathExistsAnywhere(facts: RepoFacts, candidate: string): string | undefined {
  const clean = candidate.replace(/^\.\//, "").replace(/\/$/, "");
  if (!clean) return undefined;
  if (pathExists(facts, clean)) return clean;
  const suffix = `/${clean}`;
  for (const known of facts.files) if (known.endsWith(suffix)) return known;
  for (const known of facts.dirs) if (known.endsWith(suffix)) return known;
  return undefined;
}
