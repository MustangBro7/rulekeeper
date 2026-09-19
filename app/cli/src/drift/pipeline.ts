import { basename, relative, resolve } from "node:path";
import { existsSync } from "node:fs";
import { discoverInstructionFiles, findGitRoot } from "../discover.js";
import { extractClaims } from "./claims.js";
import { collectRepoFacts, lastCommitDate } from "./repo.js";
import { CLAIM_KINDS, findContradictions, findStaleness, findUndocumented, verifyClaim } from "./verify.js";
import type { Claim, ClaimKind, DriftFile, DriftReport, DriftRepo, Finding } from "./types.js";

const SEVERITY_ORDER: Record<Finding["severity"], number> = { error: 0, warn: 1, info: 2 };
const MAX_FINDINGS_PER_REPO = 200;

export interface DriftOptions {
  dir?: string;
  /** Skip git-history-derived findings; keeps the run hermetic and fast. */
  noHistory?: boolean;
}

export function analyzeRepo(root: string, options: DriftOptions = {}): DriftRepo {
  const name = basename(root);
  const facts = collectRepoFacts(root, name);
  const instructionFiles = discoverInstructionFiles(root);
  const files: DriftFile[] = [];
  const findings: Finding[] = [];
  const allClaims: Claim[] = [];
  const verified = Object.fromEntries(CLAIM_KINDS.map((kind) => [kind, 0])) as Record<ClaimKind, number>;

  for (const file of instructionFiles) {
    const relativeName = relative(root, file.path).replaceAll("\\", "/") || file.name;
    const claims = extractClaims(relativeName, file.content);
    allClaims.push(...claims);
    const fileFindings: Finding[] = [];
    for (const claim of claims) {
      const result = verifyClaim(claim, facts);
      if (result) fileFindings.push(result);
      else verified[claim.kind] += 1;
    }
    const lastCommit = options.noHistory ? "" : lastCommitDate(root, relativeName);
    if (!options.noHistory) fileFindings.push(...findStaleness(claims, facts, lastCommit, relativeName));
    findings.push(...fileFindings);
    files.push({
      name: relativeName,
      tokensEstimate: file.tokensEstimate,
      claims: claims.length,
      verified: claims.length - fileFindings.filter((item) => item.severity !== "info").length,
      findings: fileFindings.length,
      lastCommit,
    });
  }

  findings.push(...findContradictions(allClaims));
  const primary = files[0]?.name;
  if (primary) findings.push(...findUndocumented(allClaims, facts, primary, files.map((file) => file.name)));

  findings.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.file.localeCompare(b.file) || a.line - b.line,
  );

  const checkable = allClaims.length;
  const failures = findings.filter((item) => item.severity !== "info").length;
  return {
    name,
    files,
    findings: findings.slice(0, MAX_FINDINGS_PER_REPO),
    verified,
    score: checkable === 0 ? 100 : Math.max(0, Math.round((100 * (checkable - failures)) / checkable)),
  };
}

export function runDrift(options: DriftOptions = {}): DriftReport {
  const requested = resolve(options.dir ?? process.cwd());
  if (!existsSync(requested)) throw new Error(`No such directory: ${requested}`);
  // An explicitly requested directory that carries its own instructions is the root;
  // otherwise the repository root is what agents actually see.
  const root = discoverInstructionFiles(requested).length > 0 ? requested : findGitRoot(requested) ?? requested;
  const repo = analyzeRepo(root, options);
  if (repo.files.length === 0) {
    throw new Error(
      `No instruction files found in ${basename(root)}. RuleKeeper reads CLAUDE.md and AGENTS.md at the repository root or one level down.`,
    );
  }
  const repos = [repo];
  return {
    v: 2,
    kind: "drift",
    generatedAt: new Date().toISOString(),
    totals: {
      repos: repos.length,
      files: repos.reduce((total, item) => total + item.files.length, 0),
      claims: repos.reduce((total, item) => total + item.files.reduce((sum, file) => sum + file.claims, 0), 0),
      verified: repos.reduce(
        (total, item) => total + Object.values(item.verified).reduce((sum, count) => sum + count, 0),
        0,
      ),
      errors: repos.reduce((total, item) => total + item.findings.filter((f) => f.severity === "error").length, 0),
      warnings: repos.reduce((total, item) => total + item.findings.filter((f) => f.severity === "warn").length, 0),
      infos: repos.reduce((total, item) => total + item.findings.filter((f) => f.severity === "info").length, 0),
    },
    repos,
  };
}
