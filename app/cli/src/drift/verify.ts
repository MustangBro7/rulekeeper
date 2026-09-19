import type { Claim, ClaimKind, Finding, Severity } from "./types.js";
import { commitsSince, pathExistsAnywhere, type PackageManager, type RepoFacts } from "./repo.js";

const SEVERITY: Record<string, Severity> = {
  "missing-path": "error",
  "missing-script": "error",
  "missing-target": "error",
  "missing-dependency": "warn",
  "unknown-env-var": "warn",
  "package-manager-mismatch": "warn",
  contradiction: "warn",
  "stale-section": "info",
  "undocumented-area": "info",
};

const DOC_ONLY_DIRS = new Set([".github", ".vscode", ".claude", ".husky", "public", "assets", "static", "docs", "examples", "scripts", "migrations", "test", "tests", "__tests__"]);

function distance(a: string, b: string): number {
  if (a === b) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_unused, index) => index);
  for (let row = 1; row < rows; row += 1) {
    const current = [row];
    for (let col = 1; col < cols; col += 1) {
      const substitution = (previous[col - 1] ?? 0) + (a[row - 1] === b[col - 1] ? 0 : 1);
      const insertion = (current[col - 1] ?? 0) + 1;
      const deletion = (previous[col] ?? 0) + 1;
      current[col] = Math.min(substitution, insertion, deletion);
    }
    previous = current;
  }
  return previous[cols - 1] ?? Math.max(a.length, b.length);
}

export function nearest(target: string, candidates: Iterable<string>): string | undefined {
  let best: string | undefined;
  let bestScore = Infinity;
  for (const candidate of candidates) {
    const score = distance(target.toLowerCase(), candidate.toLowerCase());
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  const limit = Math.max(2, Math.floor(target.length / 3));
  return best !== undefined && bestScore <= limit ? best : undefined;
}

function finding(
  code: keyof typeof SEVERITY,
  claim: Claim,
  message: string,
  extra: { actual?: string; suggestion?: string } = {},
): Finding {
  return {
    code: code as Finding["code"],
    severity: SEVERITY[code] ?? "warn",
    file: claim.file,
    line: claim.line,
    subject: claim.value,
    message,
    context: claim.context,
    ...(extra.actual !== undefined ? { actual: extra.actual } : {}),
    ...(extra.suggestion !== undefined ? { suggestion: extra.suggestion } : {}),
  };
}

function verifyPath(claim: Claim, facts: RepoFacts): Finding | undefined {
  const resolved = pathExistsAnywhere(facts, claim.value);
  if (resolved !== undefined) return undefined;
  const base = claim.value.split("/").pop() ?? claim.value;
  const sameName = [...facts.files].filter((file) => file.endsWith(`/${base}`) || file === base).slice(0, 1)[0];
  const suggestion = sameName ?? nearest(claim.value, [...facts.files].slice(0, 4_000));
  return finding("missing-path", claim, `${claim.value} does not exist in the repository`, {
    ...(suggestion !== undefined ? { suggestion: `did you mean ${suggestion}?` } : {}),
  });
}

function verifyScript(claim: Claim, facts: RepoFacts): Finding | undefined {
  if (facts.scripts.has(claim.value)) return undefined;
  if (facts.scripts.size === 0) return undefined;
  const suggestion = nearest(claim.value, facts.scripts.keys());
  return finding("missing-script", claim, `no package.json script named "${claim.value}"`, {
    actual: `available: ${[...facts.scripts.keys()].slice(0, 8).join(", ")}`,
    ...(suggestion !== undefined ? { suggestion: `did you mean "${suggestion}"?` } : {}),
  });
}

function verifyTarget(claim: Claim, facts: RepoFacts): Finding | undefined {
  const [tool, name = ""] = claim.value.split(":");
  if (tool === "make") {
    if (facts.makeTargets.size === 0 || facts.makeTargets.has(name)) return undefined;
    const suggestion = nearest(name, facts.makeTargets);
    return finding("missing-target", { ...claim, value: `make ${name}` }, `Makefile has no target "${name}"`, {
      actual: `available: ${[...facts.makeTargets].slice(0, 8).join(", ")}`,
      ...(suggestion !== undefined ? { suggestion: `did you mean "make ${suggestion}"?` } : {}),
    });
  }
  if (tool === "just") {
    if (facts.justTargets.size === 0 || facts.justTargets.has(name)) return undefined;
    const suggestion = nearest(name, facts.justTargets);
    return finding("missing-target", { ...claim, value: `just ${name}` }, `justfile has no recipe "${name}"`, {
      actual: `available: ${[...facts.justTargets].slice(0, 8).join(", ")}`,
      ...(suggestion !== undefined ? { suggestion: `did you mean "just ${suggestion}"?` } : {}),
    });
  }
  if (tool === "cargo") {
    if (!facts.hasCargo || facts.cargoAliases.has(name)) return undefined;
    return finding("missing-target", { ...claim, value: `cargo ${name}` }, `cargo has no alias or subcommand "${name}"`);
  }
  return undefined;
}

function verifyDependency(claim: Claim, facts: RepoFacts): Finding | undefined {
  if (facts.dependencies.size === 0 || facts.dependencies.has(claim.value)) return undefined;
  return finding("missing-dependency", claim, `${claim.value} is imported in an example but is not a dependency`, {
    actual: "not present in any package.json",
  });
}

function verifyEnvVar(claim: Claim, facts: RepoFacts): Finding | undefined {
  if (facts.envVars.size === 0 || facts.envVars.has(claim.value)) return undefined;
  const suggestion = nearest(claim.value, facts.envVars);
  return finding("unknown-env-var", claim, `${claim.value} is documented but never read by the code or declared in env files`, {
    ...(suggestion !== undefined ? { suggestion: `did you mean ${suggestion}?` } : {}),
  });
}

function verifyPackageManager(claim: Claim, facts: RepoFacts): Finding | undefined {
  const declared = claim.value as PackageManager;
  if (facts.declaredManager !== undefined) {
    return facts.declaredManager === declared
      ? undefined
      : finding("package-manager-mismatch", claim, `doc says ${declared} but package.json declares ${facts.declaredManager}`, {
          actual: `packageManager: ${facts.declaredManager}`,
        });
  }
  if (facts.lockfiles.size === 0 || facts.lockfiles.has(declared)) return undefined;
  return finding("package-manager-mismatch", claim, `doc says ${declared} but the repo has a ${[...facts.lockfiles].join(" + ")} lockfile`, {
    actual: `lockfile: ${[...facts.lockfiles].join(", ")}`,
  });
}

export function verifyClaim(claim: Claim, facts: RepoFacts): Finding | undefined {
  if (claim.kind === "path") return verifyPath(claim, facts);
  if (claim.kind === "script") return verifyScript(claim, facts);
  if (claim.kind === "target") return verifyTarget(claim, facts);
  if (claim.kind === "dependency") return verifyDependency(claim, facts);
  if (claim.kind === "env-var") return verifyEnvVar(claim, facts);
  return verifyPackageManager(claim, facts);
}

/** Two instruction files telling agents contradictory things about the same subject. */
export function findContradictions(claims: Claim[]): Finding[] {
  const findings: Finding[] = [];
  const byFile = new Map<string, Set<string>>();
  for (const claim of claims.filter((candidate) => candidate.kind === "package-manager")) {
    const current = byFile.get(claim.file) ?? new Set<string>();
    current.add(claim.value);
    byFile.set(claim.file, current);
  }
  const declarations = [...byFile]
    .filter(([, managers]) => managers.size === 1)
    .map(([file, managers]) => ({ file, manager: [...managers][0] ?? "" }));
  const managers = new Set(declarations.map((declaration) => declaration.manager));
  if (managers.size > 1) {
    for (const declaration of declarations.slice(1)) {
      const first = declarations[0];
      if (!first) continue;
      const claim = claims.find(
        (candidate) => candidate.kind === "package-manager" && candidate.file === declaration.file,
      );
      if (!claim) continue;
      findings.push(
        finding("contradiction", claim, `${declaration.file} says ${declaration.manager} but ${first.file} says ${first.manager}`, {
          actual: `conflicting instructions across ${declarations.length} files`,
        }),
      );
    }
  }
  return findings;
}

/** Areas the doc points at that have moved on a lot since the doc was last edited. */
export function findStaleness(claims: Claim[], facts: RepoFacts, docLastCommit: string, fileName: string): Finding[] {
  if (!docLastCommit) return [];
  const areas = new Map<string, Claim>();
  for (const claim of claims) {
    if (claim.kind !== "path" || claim.file !== fileName) continue;
    const top = claim.value.split("/")[0] ?? "";
    if (!top || top.includes(".")) continue;
    if (!areas.has(top)) areas.set(top, claim);
  }
  const findings: Finding[] = [];
  for (const [area, claim] of [...areas].slice(0, 12)) {
    const commits = commitsSince(facts.root, area, docLastCommit);
    if (commits < 15) continue;
    findings.push(
      finding("stale-section", claim, `${area}/ has changed in ${commits} commits since ${fileName} was last updated`, {
        actual: `${fileName} last touched ${docLastCommit}`,
        suggestion: `re-read ${area}/ and confirm the instructions still hold`,
      }),
    );
  }
  return findings;
}

/** Significant top-level source areas that no instruction file mentions at all. */
export function findUndocumented(claims: Claim[], facts: RepoFacts, primaryFile: string, instructionFiles: string[] = []): Finding[] {
  const mentioned = new Set<string>();
  for (const file of instructionFiles) {
    const top = file.split("/")[0];
    if (top && file.includes("/")) mentioned.add(top);
  }
  for (const claim of claims) {
    if (claim.kind !== "path") continue;
    const top = claim.value.split("/")[0];
    if (top) mentioned.add(top);
  }
  const findings: Finding[] = [];
  for (const dir of [...facts.dirs].filter((candidate) => !candidate.includes("/"))) {
    if (dir.startsWith(".") || mentioned.has(dir) || DOC_ONLY_DIRS.has(dir)) continue;
    const contents = [...facts.files].filter((file) => file.startsWith(`${dir}/`));
    const source = contents.filter((file) => /\.(?:ts|tsx|js|jsx|py|go|rs|rb|java|kt|swift)$/.test(file));
    if (source.length < 5) continue;
    findings.push({
      code: "undocumented-area",
      severity: "info",
      file: primaryFile,
      line: 0,
      subject: `${dir}/`,
      message: `${dir}/ holds ${source.length} source files but no instruction file mentions it`,
      context: "",
      suggestion: `document ${dir}/ or confirm agents never need to touch it`,
    });
  }
  return findings.slice(0, 6);
}

export const CLAIM_KINDS: ClaimKind[] = ["path", "script", "target", "dependency", "env-var", "package-manager"];
