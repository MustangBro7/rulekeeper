import { readFileSync } from "node:fs";
import { emptySession, type Session } from "../types.js";
import { asRecord, asString, updateTimes } from "../util.js";

export function parseClaudeText(texts: string[], id = "claude-session", path = ""): Session {
  const session = emptySession("claude", id, path);
  session.rawText = texts.join("\n");
  const pending = new Map<string, number>();
  for (const text of texts) for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let record: Record<string, unknown>;
    try { record = asRecord(JSON.parse(line)); } catch { continue; }
    const ts = asString(record.timestamp); updateTimes(session, ts);
    if (!session.cwd) session.cwd = asString(record.cwd);
    const message = asRecord(record.message);
    const content = message.content;
    if (record.type === "assistant") {
      session.assistantMessages++;
      if (!Array.isArray(content)) continue;
      for (const rawBlock of content) {
        const block = asRecord(rawBlock);
        if (block.type !== "tool_use") continue;
        const input = asRecord(block.input); const name = asString(block.name);
        if (name === "Bash" && asString(input.command)) {
          session.commands.push({ ts, cmd: asString(input.command), workdir: session.cwd, exitError: null });
          pending.set(asString(block.id), session.commands.length - 1);
        } else if ((name === "Edit" || name === "Write") && asString(input.file_path)) {
          session.edits.push({ ts, path: asString(input.file_path), content: asString(input.new_string) || asString(input.content), kind: name === "Edit" ? "edit" : "write" });
        } else if (name === "Read" && asString(input.file_path)) {
          session.reads.push({ ts, path: asString(input.file_path) });
        }
      }
    } else if (record.type === "user") {
      if (Array.isArray(content)) {
        let hasToolResult = false;
        for (const rawBlock of content) {
          const block = asRecord(rawBlock);
          if (block.type === "tool_result") {
            hasToolResult = true;
            if (block.is_error === true) {
              session.errors++;
              const index = pending.get(asString(block.tool_use_id));
              if (index !== undefined) {
                const command = session.commands[index];
                if (command) command.exitError = true;
              }
            }
          } else if (block.type === "text" && asString(block.text).includes("[Request interrupted by user")) session.interrupts++;
        }
        if (!hasToolResult && record.isMeta !== true) session.userTurns++;
      } else if (typeof content === "string") {
        if (record.isMeta !== true) session.userTurns++;
        if (content.includes("[Request interrupted by user")) session.interrupts++;
      }
    }
  }
  return session;
}

export function parseClaudeSession(main: string, subagents: string[] = []): Session {
  const texts: string[] = [];
  for (const file of [main, ...subagents]) { try { texts.push(readFileSync(file, "utf8")); } catch { /* missing fragments are harmless */ } }
  return parseClaudeText(texts, main.split(/[\\/]/).pop()?.replace(/\.jsonl$/, "") ?? "claude-session", main);
}
