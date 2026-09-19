export type Source = "claude" | "codex";

export interface SessionCommand {
  ts: string;
  cmd: string;
  workdir: string;
  exitError: boolean | null;
}

export interface SessionEdit {
  ts: string;
  path: string;
  content: string;
  kind: "edit" | "write";
}

export interface SessionRead { ts: string; path: string }

export interface Session {
  source: Source;
  id: string;
  path: string;
  cwd: string;
  firstTs: string;
  lastTs: string;
  commands: SessionCommand[];
  edits: SessionEdit[];
  reads: SessionRead[];
  userTurns: number;
  assistantMessages: number;
  errors: number;
  interrupts: number;
  rawText: string;
}

export interface InstructionFile {
  path: string;
  name: string;
  content: string;
  markers: string[];
  tokensEstimate: number;
}

export interface RepoContext {
  root: string;
  name: string;
  sessions: Session[];
  files: InstructionFile[];
}

export type RuleKind = "delivery" | "gate" | "info" | "command" | "package-manager" | "custom-command" | "custom-content";

export interface ExtractedRule {
  id: string;
  kind: RuleKind;
  quote: string;
  file: InstructionFile;
  command?: string;
  commands?: string[];
  packageManager?: "npm" | "pnpm" | "yarn" | "bun";
  editsMatching?: RegExp;
  requireCommand?: RegExp;
  forbidContent?: RegExp;
  inEditsMatching?: RegExp;
}

export type Verdict = "works" | "broken" | "dead-weight" | "not-delivered" | "untested";
export interface Receipt { sessionId8: string; date: string; evidence: string }
export interface ScoredRule {
  id: string;
  kind: RuleKind;
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

export interface Report {
  v: 2;
  kind: "adherence";
  generatedAt: string;
  window: { since: string; until: string };
  totals: {
    sessions: number; commands: number; edits: number; errors: number;
    sources: { claude: number; codex: number };
  };
  repos: Array<{
    name: string;
    files: Array<{ name: string; tokensEstimate: number; sessionsTouching: number; sessionsInContext: number }>;
    rules: ScoredRule[];
  }>;
}

export type SharedRepo = Report["repos"][number] & { untestedCount: number };

export type { Claim, ClaimKind, DriftFile, DriftReport, DriftRepo, Finding, FindingCode, Severity } from "./drift/types.js";

export interface SharePayload extends Omit<Report, "repos"> {
  repos: SharedRepo[];
  trimmed?: true;
  omittedRepos?: number;
  omittedRules?: number;
}

export function emptySession(source: Source, id: string, path: string): Session {
  return { source, id, path, cwd: "", firstTs: "", lastTs: "", commands: [], edits: [], reads: [], userTurns: 0, assistantMessages: 0, errors: 0, interrupts: 0, rawText: "" };
}
