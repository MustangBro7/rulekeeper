/** Static drift: does an instruction file still describe the repository that exists? */

export type ClaimKind =
  | "path"
  | "script"
  | "target"
  | "dependency"
  | "env-var"
  | "package-manager";

export interface Claim {
  kind: ClaimKind;
  /** The literal token asserted by the document (a path, script name, package name...). */
  value: string;
  /** Repo-relative path of the instruction file making the claim. */
  file: string;
  line: number;
  /** The document line the claim was read from, trimmed and capped. */
  context: string;
}

export type FindingCode =
  | "missing-path"
  | "missing-script"
  | "missing-target"
  | "missing-dependency"
  | "unknown-env-var"
  | "package-manager-mismatch"
  | "contradiction"
  | "stale-section"
  | "undocumented-area";

export type Severity = "error" | "warn" | "info";

export interface Finding {
  code: FindingCode;
  severity: Severity;
  /** Repo-relative instruction file the finding belongs to. */
  file: string;
  line: number;
  /** The token that does not check out. */
  subject: string;
  /** One-line statement of what is wrong. */
  message: string;
  /** What the repository actually looks like, when we can say. */
  actual?: string;
  /** The document line, for display. */
  context: string;
  /** Concrete remediation, when mechanically derivable. */
  suggestion?: string;
}

export interface DriftFile {
  name: string;
  tokensEstimate: number;
  claims: number;
  verified: number;
  findings: number;
  lastCommit: string;
}

export interface DriftRepo {
  name: string;
  files: DriftFile[];
  findings: Finding[];
  /** Claims that checked out, by kind — the evidence that the doc is still true. */
  verified: Record<ClaimKind, number>;
  score: number;
}

export interface DriftReport {
  v: 2;
  kind: "drift";
  generatedAt: string;
  totals: {
    repos: number;
    files: number;
    claims: number;
    verified: number;
    errors: number;
    warnings: number;
    infos: number;
  };
  repos: DriftRepo[];
}
