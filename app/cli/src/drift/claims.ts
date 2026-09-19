import type { Claim, ClaimKind } from "./types.js";
import { redactAbsolute } from "../util.js";

const FENCE = /^\s*(?:```|~~~)(.*)$/;
const SHELL_LANGS = new Set(["", "sh", "bash", "zsh", "shell", "console", "shellsession", "terminal"]);
const TREE_CHARS = /[├└│┬─]/;

/** npm/pnpm/yarn/bun subcommands that are never repository scripts. */
const PM_BUILTINS = new Set([
  "install", "i", "ci", "add", "remove", "rm", "uninstall", "update", "up", "upgrade",
  "exec", "x", "dlx", "create", "init", "publish", "pack", "link", "unlink", "audit",
  "outdated", "why", "list", "ls", "view", "info", "login", "logout", "whoami", "config",
  "cache", "version", "run", "run-script", "help", "dedupe", "prune", "fund", "set", "get",
  "import", "store", "patch", "licenses", "rebuild", "root", "bin", "repo", "docs",
]);

const CARGO_BUILTINS = new Set([
  "build", "b", "check", "c", "test", "t", "run", "r", "bench", "clean", "doc", "d", "new",
  "init", "add", "remove", "update", "search", "publish", "install", "uninstall", "fmt",
  "clippy", "fix", "tree", "vendor", "metadata", "generate-lockfile", "package", "login",
  "verify-project", "locate-project", "report", "help", "version",
]);

const NODE_BUILTIN = /^(?:node:|assert|buffer|child_process|cluster|crypto|dns|events|fs|http|http2|https|module|net|os|path|perf_hooks|process|querystring|readline|stream|string_decoder|timers|tls|tty|url|util|v8|vm|worker_threads|zlib)(?:\/|$)/;

const FILE_EXTENSION = /\.(?:ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|mdx|py|go|rs|rb|java|kt|swift|c|h|cpp|sql|css|scss|html|yml|yaml|toml|lock|sh|env|txt|svg|png|ico|config|xml|gradle|properties|cfg|ini)$/i;

interface Line {
  text: string;
  number: number;
  fenceLang: string | null;
  isTree: boolean;
}

function readLines(content: string): Line[] {
  const raw = content.split(/\r?\n/);
  const lines: Line[] = [];
  let fenceLang: string | null = null;
  let fenceStart = -1;
  const treeRanges: Array<[number, number]> = [];
  for (let index = 0; index < raw.length; index += 1) {
    const text = raw[index] ?? "";
    const fence = FENCE.exec(text);
    if (fence) {
      if (fenceLang === null) {
        fenceLang = (fence[1] ?? "").trim().toLowerCase().split(/\s+/)[0] ?? "";
        fenceStart = index;
      } else {
        const block = raw.slice(fenceStart + 1, index);
        const treeish = block.filter((line) => TREE_CHARS.test(line) || /^\s*[\w.-]+\/\s*(?:#.*)?$/.test(line)).length;
        if (treeish >= 2) treeRanges.push([fenceStart, index]);
        fenceLang = null;
      }
      lines.push({ text, number: index + 1, fenceLang: null, isTree: false });
      continue;
    }
    lines.push({ text, number: index + 1, fenceLang, isTree: false });
  }
  for (const [start, end] of treeRanges) for (let index = start; index <= end && index < lines.length; index += 1) {
    const line = lines[index];
    if (line) line.isTree = true;
  }
  return lines;
}

function context(text: string): string {
  return redactAbsolute(text.trim().replace(/\s+/g, " ")).slice(0, 120);
}

function looksLikePath(token: string): boolean {
  const value = token.trim();
  if (!value || value.length > 120) return false;
  if (/\s/.test(value)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
  if (/^[/~]/.test(value)) return false;
  if (/[<>*?{}$!|"'()[\],;]/.test(value)) return false;
  if (value.includes("...") || value.includes("@")) return false;
  if (value.includes("node_modules")) return false;
  if (/^\d+(?:\.\d+)*$/.test(value)) return false;
  const hasSlash = value.includes("/");
  const hasExtension = FILE_EXTENSION.test(value);
  if (!hasSlash && !hasExtension) return false;
  const segments = value.replace(/\/$/, "").split("/");
  // Tailwind opacity and size modifiers: bg-background/85, border-border/70, w-1/2.
  if (segments.slice(1).some((segment) => /^\d+(?:-\d+)?$/.test(segment))) return false;
  // "and/or", "TypeScript/JavaScript" — prose slashes, not paths.
  if (hasSlash && !hasExtension && !value.endsWith("/") && /^[A-Za-z]+\/[A-Za-z]+$/.test(value)) return false;
  return true;
}

/** Lines that present a filename as an illustration rather than a claim about the repo. */
const ILLUSTRATIVE = /(?:\u2026|\.\.\.|\be\.g\.|\bi\.e\.|for example|such as|for instance)/i;

function packageNameFrom(specifier: string): string | undefined {
  const value = specifier.trim();
  if (!value || value.startsWith(".") || value.startsWith("/") || NODE_BUILTIN.test(value)) return undefined;
  const parts = value.split("/");
  const name = value.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
  return name && /^[@a-z0-9][\w@./-]*$/i.test(name) ? name : undefined;
}

function pushUnique(claims: Claim[], seen: Set<string>, claim: Claim): void {
  const key = `${claim.kind}\0${claim.value}`;
  if (seen.has(key)) return;
  seen.add(key);
  claims.push(claim);
}

function extractCommands(text: string, file: string, line: Line, claims: Claim[], seen: Set<string>): void {
  const add = (kind: ClaimKind, value: string) =>
    pushUnique(claims, seen, { kind, value, file, line: line.number, context: context(line.text) });

  for (const match of text.matchAll(/\b(npm|pnpm|yarn|bun)\s+run\s+([\w:.-]+)/g)) {
    if (match[2]) add("script", match[2]);
  }
  for (const match of text.matchAll(/\b(pnpm|yarn|bun)\s+([\w:.-]+)/g)) {
    const sub = match[2];
    if (sub && !PM_BUILTINS.has(sub) && !/^-/.test(sub)) add("script", sub);
  }
  for (const match of text.matchAll(/\bnpm\s+(?:--prefix\s+\S+\s+)?run\s+([\w:.-]+)/g)) {
    if (match[1]) add("script", match[1]);
  }
  for (const match of text.matchAll(/\bmake\s+([\w:.-]+)/g)) {
    if (match[1] && !/^-/.test(match[1])) add("target", `make:${match[1]}`);
  }
  for (const match of text.matchAll(/\bjust\s+([\w:.-]+)/g)) {
    if (match[1] && !/^-/.test(match[1])) add("target", `just:${match[1]}`);
  }
  for (const match of text.matchAll(/\bcargo\s+([\w-]+)/g)) {
    const sub = match[1];
    if (sub && !CARGO_BUILTINS.has(sub)) add("target", `cargo:${sub}`);
  }
}

function extractImports(text: string, file: string, line: Line, claims: Claim[], seen: Set<string>): void {
  const specifiers = [
    ...[...text.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((match) => match[1]),
    ...[...text.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map((match) => match[1]),
    ...[...text.matchAll(/\bimport\s+["']([^"']+)["']/g)].map((match) => match[1]),
  ];
  for (const specifier of specifiers) {
    const name = specifier ? packageNameFrom(specifier) : undefined;
    if (name) pushUnique(claims, seen, { kind: "dependency", value: name, file, line: line.number, context: context(line.text) });
  }
}

function extractTreePaths(lines: Line[], file: string, claims: Claim[], seen: Set<string>): void {
  const stack: string[] = [];
  for (const line of lines) {
    if (!line.isTree || FENCE.test(line.text)) continue;
    const stripped = line.text.replace(/[│├└]/g, " ").replace(/─/g, " ");
    const comment = stripped.indexOf("#");
    const body = (comment >= 0 ? stripped.slice(0, comment) : stripped);
    const name = body.trim();
    if (!name || name === "." || name.startsWith("..")) continue;
    const indent = body.length - body.trimStart().length;
    const depth = Math.max(0, Math.round(indent / 2));
    stack.length = Math.min(stack.length, depth);
    const bare = name.replace(/\/$/, "").trim();
    if (!bare || /\s/.test(bare) || /[<>*?{}$|"']/.test(bare)) continue;
    const full = [...stack.slice(0, depth), bare].join("/");
    if (name.endsWith("/")) stack[depth] = bare;
    if (!looksLikePath(full)) continue;
    pushUnique(claims, seen, { kind: "path", value: full, file, line: line.number, context: context(line.text) });
  }
}

export function extractClaims(fileName: string, content: string): Claim[] {
  const claims: Claim[] = [];
  const seen = new Set<string>();
  const lines = readLines(content);

  for (const line of lines) {
    if (FENCE.test(line.text)) continue;
    const inFence = line.fenceLang !== null;
    const shellFence = inFence && SHELL_LANGS.has(line.fenceLang ?? "");

    if (line.isTree) continue;

    if (shellFence) {
      extractCommands(line.text, fileName, line, claims, seen);
    } else if (inFence) {
      extractImports(line.text, fileName, line, claims, seen);
    }

    const spans = inFence ? [] : [...line.text.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? "");
    for (const span of spans) {
      const value = span.trim();
      if (!value) continue;
      extractCommands(value, fileName, line, claims, seen);
      if (looksLikePath(value) && !ILLUSTRATIVE.test(line.text)) {
        pushUnique(claims, seen, { kind: "path", value, file: fileName, line: line.number, context: context(line.text) });
      }
      if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(value) && value.length >= 5) {
        pushUnique(claims, seen, { kind: "env-var", value, file: fileName, line: line.number, context: context(line.text) });
      }
    }

    if (!inFence) {
      for (const match of line.text.matchAll(/\b(?:use|using|uses|prefer|run|via|with)\s+(npm|pnpm|yarn|bun)\b/gi)) {
        const manager = match[1]?.toLowerCase();
        if (manager) {
          pushUnique(claims, seen, { kind: "package-manager", value: manager, file: fileName, line: line.number, context: context(line.text) });
        }
      }
    }
  }

  extractTreePaths(lines, fileName, claims, seen);
  return claims;
}
