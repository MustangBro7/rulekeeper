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
  v: 1;
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

export type ReportValidation =
  | { ok: true; report: SharedReport; ruleCount: number }
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

function hasReportShape(value: unknown): value is SharedReport {
  if (!isRecord(value) || value.v !== 1 || !isString(value.generatedAt)) return false;
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
      if (/^(?:cd\s+)?(?:npm|npx|pnpm|yarn|bun|cargo|git|go|python|wrangler)\s+\S+/i.test(current) && !trail.endsWith("quote")) {
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
  if (!hasReportShape(value)) errors.unshift("report: invalid RuleKeeper v1 schema");
  if (errors.length > 0 || !hasReportShape(value)) return { ok: false, errors };

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
