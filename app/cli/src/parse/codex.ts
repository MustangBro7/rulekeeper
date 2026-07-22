import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { emptySession, type Session } from "../types.js";
import { asRecord, asString, updateTimes } from "../util.js";

const PATCH_FILE_RE = /\*\*\* (Add|Update|Delete) File: (.+)/g;
const CMD_RE = /["']?cmd["']?\s*:\s*"((?:[^"\\]|\\.)*)"/g;
const WORKDIR_RE = /["']?workdir["']?\s*:\s*"((?:[^"\\]|\\.)*)"/;
const EXIT_RE = /(?:exited with code\s*|exit(?:ed)?(?:_code| code)?["']?\s*[:=]\s*)(\d+)/i;

function decodeEscaped(value: string): string {
  try { return JSON.parse(`"${value.replace(/"/g, '\\"')}"`) as string; }
  catch { return value.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\"); }
}

export function recordCodexPatch(session: Session, ts: string, rawPatch: string, workdir: string): void {
  let patch = rawPatch;
  if (!patch.includes("\n*** ") && patch.includes("\\n")) patch = patch.replace(/\\n/g, "\n");
  const matches = [...patch.matchAll(PATCH_FILE_RE)];
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index]; if (!match) continue;
    const action = match[1]; let file = (match[2] ?? "").trim();
    if (action === "Delete" || !file) continue;
    if (!isAbsolute(file)) file = join(workdir || session.cwd || "", file);
    const start = (match.index ?? 0) + match[0].length;
    const end = matches[index + 1]?.index ?? patch.length;
    const content = patch.slice(start, end).split(/\r?\n/).filter(line => line.startsWith("+") && !line.startsWith("+++")) .map(line => line.slice(1)).join("\n");
    session.edits.push({ ts, path: file, content, kind: action === "Update" ? "edit" : "write" });
  }
}

function recordCommand(session: Session, ts: string, cmd: string, workdir: string): number | undefined {
  if (!cmd) return undefined;
  if (cmd.includes("apply_patch") && cmd.includes("*** Begin Patch")) { recordCodexPatch(session, ts, cmd, workdir); return undefined; }
  session.commands.push({ ts, cmd, workdir, exitError: null }); return session.commands.length - 1;
}

function customInput(input: unknown): { commands: string[]; workdir?: string; patch?: string } {
  if (typeof input === "object" && input !== null) {
    const obj = asRecord(input); const cmd = asString(obj.cmd);
    return { commands: cmd ? [cmd] : [], workdir: asString(obj.workdir), patch: asString(obj.patch) || asString(obj.input) };
  }
  const raw = asString(input);
  try {
    const obj = asRecord(JSON.parse(raw));
    if (Object.keys(obj).length) {
      const cmd = asString(obj.cmd);
      return { commands: cmd ? [cmd] : [], workdir: asString(obj.workdir), patch: asString(obj.patch) };
    }
  } catch { /* JavaScript-like serialization is handled below */ }
  const wd = WORKDIR_RE.exec(raw)?.[1];
  const commands = [...raw.matchAll(CMD_RE)].map(match => decodeEscaped(match[1] ?? ""));
  return { commands, workdir: wd ? decodeEscaped(wd) : "", patch: raw };
}

function exitCode(output: unknown): number | undefined {
  if (typeof output === "object" && output !== null) {
    const value = asRecord(output).exit_code; if (typeof value === "number") return value;
  }
  const text = typeof output === "string" ? output : JSON.stringify(output ?? "");
  try { const parsed = asRecord(JSON.parse(text)); if (typeof parsed.exit_code === "number") return parsed.exit_code; } catch { /* plain output */ }
  const match = EXIT_RE.exec(text); return match ? Number(match[1]) : undefined;
}

export function parseCodexText(text: string, id = "codex-session", path = ""): Session {
  const session = emptySession("codex", id, path); session.rawText = text;
  const calls = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let record: Record<string, unknown>;
    try { record = asRecord(JSON.parse(line)); } catch { continue; }
    const ts = asString(record.timestamp); updateTimes(session, ts);
    const payload = asRecord(record.payload);
    if (record.type === "session_meta") session.cwd = asString(payload.cwd);
    else if (record.type === "event_msg") {
      if (payload.type === "user_message") session.userTurns++;
      else if (payload.type === "agent_message") session.assistantMessages++;
    } else if (record.type === "response_item") {
      const type = payload.type;
      if (type === "function_call") {
        let args: Record<string, unknown> = {};
        try { args = asRecord(JSON.parse(asString(payload.arguments) || "{}")); } catch { /* malformed arguments */ }
        if (payload.name === "exec_command") {
          const index = recordCommand(session, ts, asString(args.cmd), asString(args.workdir) || session.cwd);
          if (index !== undefined) calls.set(asString(payload.call_id), index);
        } else if (["take_screenshot", "navigate_page", "take_snapshot", "evaluate_script", "new_page"].includes(asString(payload.name))) {
          recordCommand(session, ts, `[browser:${asString(payload.name)}]`, session.cwd);
        }
      } else if (type === "custom_tool_call") {
        const parsed = customInput(payload.input);
        const wd = parsed.workdir || session.cwd;
        if ((parsed.patch ?? "").includes("*** Begin Patch")) recordCodexPatch(session, ts, parsed.patch ?? "", wd);
        else {
          for (const command of parsed.commands) {
            const index = recordCommand(session, ts, command, wd);
            if (index !== undefined && asString(payload.call_id)) calls.set(asString(payload.call_id), index);
          }
        }
      } else if (type === "function_call_output" || type === "custom_tool_call_output") {
        const code = exitCode(payload.output); const index = calls.get(asString(payload.call_id));
        const command = index === undefined ? undefined : session.commands[index];
        if (code !== undefined && command) { command.exitError = code !== 0; if (code !== 0) session.errors++; }
      }
    }
  }
  return session;
}

export function parseCodexSession(file: string): Session {
  let text = ""; try { text = readFileSync(file, "utf8"); } catch { /* return an empty session */ }
  const name = file.split(/[\\/]/).pop() ?? "codex-session";
  return parseCodexText(text, name.replace(/^rollout-/, "").replace(/\.jsonl$/, ""), file);
}
