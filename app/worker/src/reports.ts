export const MAX_REPORT_BYTES = 64 * 1024;
export const MAX_REPORT_RULES = 200;

export type Verdict = "works" | "broken" | "dead-weight" | "not-delivered" | "untested";

export interface Receipt {
  sessionId8: string;
  date: string;
  evidence: string;
}

export interface SharedRule {
  id: string;
  kind: string;
  quote: string;
  born: string;
  applicable: number;
  followed: number;
  violated: number;
  preRule: number;
  inContext: { followed: number; applicable: number };
  outOfContext: { followed: number; applicable: number };
  verdict: Verdict;
  receipts: Receipt[];
  observation?: string;
}

export interface SharedReport {
  v: 2;
  kind: "adherence";
  generatedAt: string;
  window: { since: string; until: string };
  totals: {
    sessions: number;
    commands: number;
    edits: number;
    errors: number;
    sources: { claude: number; codex: number };
  };
  repos: Array<{
    name: string;
    untestedCount?: number;
    files: Array<{
      name: string;
      tokensEstimate: number;
      sessionsTouching: number;
      sessionsInContext: number;
    }>;
    rules: SharedRule[];
  }>;
}

export type Severity = "error" | "warn" | "info";

export interface DriftFinding {
  code: string;
  severity: Severity;
  file: string;
  line: number;
  subject: string;
  message: string;
  context: string;
  actual?: string;
  suggestion?: string;
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
  repos: Array<{
    name: string;
    score: number;
    files: Array<{ name: string; tokensEstimate: number; claims: number; verified: number; findings: number; lastCommit: string }>;
    findings: DriftFinding[];
    verified: Record<string, number>;
  }>;
}

export type AnyReport = SharedReport | DriftReport;

export type ReportValidation =
  | { ok: true; report: AnyReport; ruleCount: number }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0;
}

function isPair(value: unknown): boolean {
  return isRecord(value) && isCount(value.followed) && isCount(value.applicable);
}

function isReceipt(value: unknown): value is Receipt {
  return isRecord(value)
    && isString(value.sessionId8)
    && /^[A-Za-z0-9_-]{8}$/.test(value.sessionId8)
    && isString(value.date)
    && isString(value.evidence);
}

const VERDICTS = new Set<Verdict>(["works", "broken", "dead-weight", "not-delivered", "untested"]);

function isRule(value: unknown): value is SharedRule {
  return isRecord(value)
    && isString(value.id)
    && isString(value.kind)
    && isString(value.quote)
    && value.quote.length <= 140
    && isString(value.born)
    && isCount(value.applicable)
    && isCount(value.followed)
    && isCount(value.violated)
    && isCount(value.preRule)
    && isPair(value.inContext)
    && isPair(value.outOfContext)
    && isString(value.verdict)
    && VERDICTS.has(value.verdict as Verdict)
    && Array.isArray(value.receipts)
    && value.receipts.every(isReceipt)
    && (value.observation === undefined || isString(value.observation));
}

function isFile(value: unknown): boolean {
  return isRecord(value)
    && isString(value.name)
    && isCount(value.tokensEstimate)
    && isCount(value.sessionsTouching)
    && isCount(value.sessionsInContext);
}

function isRepo(value: unknown): value is SharedReport["repos"][number] {
  return isRecord(value)
    && isString(value.name)
    && (value.untestedCount === undefined || isCount(value.untestedCount))
    && Array.isArray(value.files)
    && value.files.every(isFile)
    && Array.isArray(value.rules)
    && value.rules.every(isRule);
}

const SEVERITIES = new Set<Severity>(["error", "warn", "info"]);

function isFinding(value: unknown): value is DriftFinding {
  return isRecord(value)
    && isString(value.code)
    && value.code.length <= 40
    && isString(value.severity)
    && SEVERITIES.has(value.severity as Severity)
    && isString(value.file)
    && value.file.length <= 200
    && isCount(value.line)
    && isString(value.subject)
    && value.subject.length <= 200
    && isString(value.message)
    && value.message.length <= 300
    && isString(value.context)
    && value.context.length <= 200
    && (value.actual === undefined || (isString(value.actual) && value.actual.length <= 300))
    && (value.suggestion === undefined || (isString(value.suggestion) && value.suggestion.length <= 300));
}

function isDriftFile(value: unknown): boolean {
  return isRecord(value)
    && isString(value.name)
    && isCount(value.tokensEstimate)
    && isCount(value.claims)
    && isCount(value.verified)
    && isCount(value.findings)
    && isString(value.lastCommit);
}

function isDriftRepo(value: unknown): boolean {
  return isRecord(value)
    && isString(value.name)
    && isCount(value.score)
    && value.score <= 100
    && Array.isArray(value.files)
    && value.files.every(isDriftFile)
    && Array.isArray(value.findings)
    && value.findings.every(isFinding)
    && isRecord(value.verified);
}

function hasDriftShape(value: unknown): value is DriftReport {
  if (!isRecord(value) || value.v !== 2 || value.kind !== "drift" || !isString(value.generatedAt)) return false;
  const totals = value.totals;
  if (!isRecord(totals)) return false;
  for (const key of ["repos", "files", "claims", "verified", "errors", "warnings", "infos"]) {
    if (!isCount(totals[key])) return false;
  }
  return Array.isArray(value.repos) && value.repos.every(isDriftRepo);
}

function hasReportShape(value: unknown): value is SharedReport {
  if (!isRecord(value) || value.v !== 2 || value.kind !== "adherence" || !isString(value.generatedAt)) return false;
  if (!isRecord(value.window) || !isString(value.window.since) || !isString(value.window.until)) return false;
  if (!isRecord(value.totals)
    || !isCount(value.totals.sessions)
    || !isCount(value.totals.commands)
    || !isCount(value.totals.edits)
    || !isCount(value.totals.errors)
    || !isRecord(value.totals.sources)
    || !isCount(value.totals.sources.claude)
    || !isCount(value.totals.sources.codex)) return false;
  return Array.isArray(value.repos) && value.repos.every(isRepo);
}

/** Leaf keys quoted from the user's own instruction files; command-shaped text is expected there. */
const AUTHORED_TRAILS = ["quote", "context", "message", "suggestion", "actual", "subject", "evidence"];

/** Mirrors the CLI's recursive redaction validator. */
export function validateRedaction(value: unknown): string[] {
  const errors: string[] = [];

  function visit(current: unknown, trail: string): void {
    if (typeof current === "string") {
      const isAbsolute = current.startsWith("/")
        || /^[A-Za-z]:[\\/]/.test(current)
        || /(?:^|\s)~[\\/]/.test(current)
        || /(?:^|\s)\/(?:Users|home|Volumes|private|tmp|var)\//.test(current);
      if (isAbsolute) errors.push(`${trail}: absolute or home-relative path`);
      if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(current)) errors.push(`${trail}: email address`);
      if (/^(?:cd\s+)?(?:npm|npx|pnpm|yarn|bun|cargo|git|go|python|wrangler)\s+\S+/i.test(current) && !AUTHORED_TRAILS.some((key) => trail.endsWith(key))) {
        errors.push(`${trail}: command string`);
      }
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${trail}[${index}]`));
      return;
    }
    if (isRecord(current)) {
      for (const [key, item] of Object.entries(current)) visit(item, trail ? `${trail}.${key}` : key);
    }
  }

  visit(value, "report");
  return errors;
}

export function validateReport(value: unknown): ReportValidation {
  const errors = validateRedaction(value);
  const drift = hasDriftShape(value);
  const adherence = hasReportShape(value);
  if (!drift && !adherence) errors.unshift("report: invalid RuleKeeper v2 schema");
  if (errors.length > 0) return { ok: false, errors };

  if (drift) {
    const findingCount = value.repos.reduce((total, repo) => total + repo.findings.length, 0);
    if (findingCount > MAX_REPORT_RULES) return { ok: false, errors: [`report: exceeds ${MAX_REPORT_RULES} findings`] };
    return { ok: true, report: value, ruleCount: findingCount };
  }
  if (!adherence) return { ok: false, errors: ["report: invalid RuleKeeper v2 schema"] };
  const ruleCount = value.repos.reduce((total, repo) => total + repo.rules.length, 0);
  if (ruleCount > MAX_REPORT_RULES) return { ok: false, errors: [`report: exceeds ${MAX_REPORT_RULES} rules`] };
  return { ok: true, report: value, ruleCount };
}

export function parseReportBody(raw: string): ReportValidation {
  if (new TextEncoder().encode(raw).byteLength > MAX_REPORT_BYTES) {
    return { ok: false, errors: [`report: exceeds ${MAX_REPORT_BYTES} bytes`] };
  }

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ["report: invalid JSON"] };
  }
  return validateReport(value);
}
