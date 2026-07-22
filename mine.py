#!/usr/bin/env python3
"""RuleKeeper weekend-1 proof: join instruction files with agent session behavior.

Ingests Claude Code session JSONLs (~/.claude/projects) and Codex rollouts
(~/.codex/sessions), attributes each session to the repos it touched, and
scores every machine-checkable rule in the instruction files against what the
agents actually did. Outputs a markdown report + JSON evidence + CSV inventory.

Usage:
  python3 mine.py                          # last 28 days
  python3 mine.py --since 2026-06-21 --until 2026-07-19
"""

import argparse
import csv
import json
import os
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

CLAUDE_DIR = Path.home() / ".claude" / "projects"
CODEX_DIR = Path.home() / ".codex" / "sessions"
PROJECTS = Path("/Volumes/X10 Pro/projects")

# ---------------------------------------------------------------- scopes ----

SCOPES = {
    "mcp-canary": {
        "roots": [str(PROJECTS / "empty_dir" / "mcp-canary")],
        "tokens": ["mcp-canary"],
        "family": "template",
        "instruction_files": [
            str(PROJECTS / "empty_dir" / "mcp-canary" / "CLAUDE.md"),
            str(PROJECTS / "empty_dir" / "mcp-canary" / "AGENTS.md"),
            str(PROJECTS / "empty_dir" / "mcp-canary" / "frontend" / "CLAUDE.md"),
        ],
    },
    "watchtower": {
        "roots": [str(PROJECTS / "empty_dir" / "watchtower")],
        "tokens": ["watchtower"],
        "family": "template",
        "instruction_files": [
            str(PROJECTS / "empty_dir" / "watchtower" / "CLAUDE.md"),
            str(PROJECTS / "empty_dir" / "watchtower" / "AGENTS.md"),
            str(PROJECTS / "empty_dir" / "watchtower" / "frontend" / "CLAUDE.md"),
        ],
    },
    "template": {
        "roots": [str(PROJECTS / "create-am-app" / "template")],
        "tokens": ["create-am-app"],
        "family": "template",
        "instruction_files": [
            str(PROJECTS / "create-am-app" / "template" / "CLAUDE.md"),
            str(PROJECTS / "create-am-app" / "template" / "AGENTS.md"),
            str(PROJECTS / "create-am-app" / "template" / "frontend" / "CLAUDE.md"),
        ],
    },
    "financial-dashboard": {
        "roots": [str(PROJECTS / "Gpay-Cost-Analyser" / "financial-dashboard")],
        "tokens": ["financial-dashboard"],
        "family": "findash",
        "instruction_files": [
            str(PROJECTS / "Gpay-Cost-Analyser" / "financial-dashboard" / "CLAUDE.md"),
        ],
    },
    "infra-cost-analyzer": {
        "roots": [str(PROJECTS / "Gpay-Cost-Analyser" / "infra-cost-analyzer")],
        "tokens": ["infra-cost-analyzer"],
        "family": "infra",
        "instruction_files": [
            str(PROJECTS / "Gpay-Cost-Analyser" / "infra-cost-analyzer" / "AGENTS.md"),
        ],
    },
}

# marker substring -> proves the file's content reached the agent's context
INSTRUCTION_MARKERS = {
    "playbook": "Project playbook (agents: read this first)",
    "infra-agents": "Verify UI/behavior changes in the running app",
    "findash-design": "Financial Dashboard — UI Design System",
    "mist-teal-frontend": "mist & teal",
    "mono-frontend": "Mono visual language",
}

CODE_EXT = (".ts", ".tsx", ".js", ".jsx", ".sql", ".jsonc", ".json", ".css", ".mjs")
UI_HINT = ("/src/app/", "/src/components/", ".tsx")


# --------------------------------------------------------------- session ----

@dataclass
class Session:
    source: str          # claude | codex
    sid: str
    path: str
    cwd: str = ""
    first_ts: str = ""
    last_ts: str = ""
    user_turns: int = 0
    assistant_msgs: int = 0
    interrupts: int = 0
    commands: list = field(default_factory=list)   # {ts, cmd, workdir, exit_error}
    edits: list = field(default_factory=list)      # {ts, path, content, kind: edit|write}
    reads: list = field(default_factory=list)      # {ts, path}
    errors: int = 0
    markers: set = field(default_factory=set)
    scopes: set = field(default_factory=set)
    tokens_out: int = 0
    context_peak: int = 0

    def day(self):
        return self.first_ts[:10]


def in_scope_path(p, scope):
    return any(p.startswith(r) for r in SCOPES[scope]["roots"])


def cmd_in_scope(c, scope):
    if c.get("workdir") and in_scope_path(c["workdir"], scope):
        return True
    return any(t in c["cmd"] for t in SCOPES[scope]["tokens"])


def attribute_scopes(s: Session):
    for scope, cfg in SCOPES.items():
        hit = False
        if s.cwd and any(s.cwd.startswith(r) for r in cfg["roots"]):
            hit = True
        if not hit:
            for e in s.edits + s.reads:
                if in_scope_path(e["path"], scope):
                    hit = True
                    break
        if not hit:
            for c in s.commands:
                if cmd_in_scope(c, scope):
                    hit = True
                    break
        if hit:
            s.scopes.add(scope)
    # sessions whose cwd is exactly a scope root parent but touched nothing: no scope


def scoped_edits(s, scope):
    root_ok = s.cwd and any(s.cwd.startswith(r) for r in SCOPES[scope]["roots"])
    return [e for e in s.edits if in_scope_path(e["path"], scope) or
            (root_ok and not os.path.isabs(e["path"]))]


def scoped_commands(s, scope):
    root_ok = s.cwd and any(s.cwd.startswith(r) for r in SCOPES[scope]["roots"])
    return [c for c in s.commands if cmd_in_scope(c, scope) or root_ok]


# ------------------------------------------------------- claude ingestion ---

def iter_claude_files():
    if not CLAUDE_DIR.exists():
        return
    for proj in CLAUDE_DIR.iterdir():
        if not proj.is_dir():
            continue
        for f in proj.glob("*.jsonl"):
            sub = list((proj / f.stem / "subagents").glob("*.jsonl")) \
                if (proj / f.stem / "subagents").exists() else []
            yield f, sub


def parse_claude_session(main: Path, subs):
    s = Session(source="claude", sid=main.stem, path=str(main))
    pending = {}  # tool_use id -> index into commands
    raw_markers = set()
    for fp in [main] + subs:
        try:
            text = fp.read_text(errors="replace")
        except OSError:
            continue
        for key, marker in INSTRUCTION_MARKERS.items():
            if marker in text:
                raw_markers.add(key)
        for line in text.splitlines():
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            ts = rec.get("timestamp") or ""
            if ts:
                if not s.first_ts or ts < s.first_ts:
                    s.first_ts = ts
                if ts > s.last_ts:
                    s.last_ts = ts
            if rec.get("cwd") and not s.cwd:
                s.cwd = rec["cwd"]
            t = rec.get("type")
            msg = rec.get("message") or {}
            content = msg.get("content")
            if t == "assistant":
                s.assistant_msgs += 1
                usage = msg.get("usage") or {}
                s.tokens_out += usage.get("output_tokens") or 0
                ctx = (usage.get("cache_read_input_tokens") or 0) + \
                      (usage.get("input_tokens") or 0) + \
                      (usage.get("cache_creation_input_tokens") or 0)
                s.context_peak = max(s.context_peak, ctx)
                if isinstance(content, list):
                    for b in content:
                        if not isinstance(b, dict) or b.get("type") != "tool_use":
                            continue
                        name, inp = b.get("name"), b.get("input") or {}
                        if name == "Bash" and inp.get("command"):
                            s.commands.append({"ts": ts, "cmd": inp["command"],
                                               "workdir": s.cwd, "exit_error": None})
                            pending[b.get("id")] = len(s.commands) - 1
                        elif name in ("Edit", "Write") and inp.get("file_path"):
                            s.edits.append({
                                "ts": ts, "path": inp["file_path"],
                                "content": inp.get("new_string") or inp.get("content") or "",
                                "kind": "edit" if name == "Edit" else "write"})
                        elif name == "Read" and inp.get("file_path"):
                            s.reads.append({"ts": ts, "path": inp["file_path"]})
            elif t == "user":
                if isinstance(content, list):
                    has_tool_result = False
                    for b in content:
                        if isinstance(b, dict) and b.get("type") == "tool_result":
                            has_tool_result = True
                            if b.get("is_error"):
                                s.errors += 1
                                idx = pending.get(b.get("tool_use_id"))
                                if idx is not None:
                                    s.commands[idx]["exit_error"] = True
                        elif isinstance(b, dict) and b.get("type") == "text":
                            if "[Request interrupted by user" in (b.get("text") or ""):
                                s.interrupts += 1
                    if not has_tool_result and not rec.get("isMeta"):
                        s.user_turns += 1
                elif isinstance(content, str):
                    if not rec.get("isMeta"):
                        s.user_turns += 1
                    if "[Request interrupted by user" in content:
                        s.interrupts += 1
    s.markers = raw_markers
    return s


# -------------------------------------------------------- codex ingestion ---

PATCH_FILE_RE = re.compile(r"\*\*\* (Add|Update|Delete) File: (.+)")
CMD_JS_RE = re.compile(r'["\']?cmd["\']?\s*:\s*"((?:[^"\\]|\\.)*)"')
WD_JS_RE = re.compile(r'["\']?workdir["\']?\s*:\s*"((?:[^"\\]|\\.)*)"')
EXIT_RE = re.compile(r"exited with code (\d+)")


def iter_codex_files(since, until):
    if not CODEX_DIR.exists():
        return
    for f in sorted(CODEX_DIR.rglob("rollout-*.jsonl")):
        m = re.search(r"rollout-(\d{4}-\d{2}-\d{2})T", f.name)
        if m and since[:10] <= m.group(1) <= until[:10]:
            yield f


def parse_codex_session(fp: Path):
    s = Session(source="codex", sid=fp.stem.split("rollout-")[-1], path=str(fp))
    call_map = {}
    try:
        text = fp.read_text(errors="replace")
    except OSError:
        return s
    for key, marker in INSTRUCTION_MARKERS.items():
        if marker in text:
            s.markers.add(key)
    for line in text.splitlines():
        if not line.strip():
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        ts = rec.get("timestamp") or ""
        if ts:
            if not s.first_ts or ts < s.first_ts:
                s.first_ts = ts
            if ts > s.last_ts:
                s.last_ts = ts
        t = rec.get("type")
        pl = rec.get("payload") or {}
        if t == "session_meta":
            s.cwd = pl.get("cwd") or ""
        elif t == "event_msg":
            pt = pl.get("type")
            if pt == "user_message":
                s.user_turns += 1
            elif pt == "agent_message":
                s.assistant_msgs += 1
        elif t == "response_item":
            pt = pl.get("type")
            if pt == "function_call":
                name = pl.get("name")
                args_raw = pl.get("arguments") or "{}"
                try:
                    args = json.loads(args_raw)
                except json.JSONDecodeError:
                    args = {}
                if name == "exec_command":
                    cmd = args.get("cmd") or ""
                    workdir = args.get("workdir") or s.cwd
                    record_codex_cmd(s, ts, cmd, workdir)
                    call_map[pl.get("call_id")] = len(s.commands) - 1 if s.commands else None
                elif name in ("take_screenshot", "navigate_page", "take_snapshot",
                              "evaluate_script", "new_page"):
                    s.commands.append({"ts": ts, "cmd": f"[browser:{name}]",
                                       "workdir": s.cwd, "exit_error": None})
            elif pt == "custom_tool_call":
                inp = pl.get("input") or ""
                if "*** Begin Patch" in inp:
                    record_codex_patch(s, ts, inp, s.cwd)
                else:
                    wds = WD_JS_RE.findall(inp)
                    wd = wds[0].encode().decode("unicode_escape", errors="replace") \
                        if len(wds) == 1 else s.cwd
                    for m in CMD_JS_RE.finditer(inp):
                        cmd = m.group(1).encode().decode("unicode_escape", errors="replace")
                        record_codex_cmd(s, ts, cmd, wd)
            elif pt == "function_call_output":
                out = pl.get("output")
                out_s = out if isinstance(out, str) else json.dumps(out or "")
                m = EXIT_RE.search(out_s)
                idx = call_map.get(pl.get("call_id"))
                if m and idx is not None and idx < len(s.commands):
                    code = int(m.group(1))
                    s.commands[idx]["exit_error"] = code != 0
                    if code != 0:
                        s.errors += 1
    return s


def record_codex_patch(s, ts, patch, workdir):
    # some rollouts embed the patch in a JS string with escaped newlines
    if "\n*** " not in patch and "\\n" in patch:
        patch = patch.replace("\\n", "\n")
    # split the patch into per-file chunks so content-based rules see only
    # the hunks that belong to that file
    matches = list(PATCH_FILE_RE.finditer(patch))
    for i, m in enumerate(matches):
        action, p = m.group(1), m.group(2).strip()
        if action == "Delete":
            continue
        if not os.path.isabs(p):
            p = os.path.join(workdir or s.cwd or "", p)
        end = matches[i + 1].start() if i + 1 < len(matches) else len(patch)
        added = "\n".join(l[1:] for l in patch[m.end():end].splitlines()
                          if l.startswith("+"))
        s.edits.append({"ts": ts, "path": p, "content": added,
                        "kind": "edit" if action == "Update" else "write"})


def record_codex_cmd(s, ts, cmd, workdir):
    if "apply_patch" in cmd and "*** Begin Patch" in cmd:
        record_codex_patch(s, ts, cmd, workdir)
    else:
        s.commands.append({"ts": ts, "cmd": cmd, "workdir": workdir, "exit_error": None})


# ------------------------------------------------------------ rule engine ---

@dataclass
class RuleResult:
    rule_id: str
    scope: str
    quote: str
    file: str = ""
    pickaxe: str = ""         # phrase whose introduction dates the rule
    born: str = ""            # ISO timestamp the rule first existed
    applicable: list = field(default_factory=list)
    followed: list = field(default_factory=list)
    violated: list = field(default_factory=list)
    pre_rule: list = field(default_factory=list)      # applicable before file existed
    pre_followed: list = field(default_factory=list)
    notes: list = field(default_factory=list)   # (sid, detail)


BIRTH_CACHE = {}


def file_birth(path, pickaxe=None):
    """Commit date the instruction (file, or a distinctive phrase in it via
    git pickaxe) first existed. Fallback: mtime."""
    key = (path, pickaxe)
    if key in BIRTH_CACHE:
        return BIRTH_CACHE[key]
    born = ""
    try:
        import subprocess
        cmd = ["git", "-C", os.path.dirname(path), "log", "--follow",
               "--reverse", "--format=%aI"]
        if pickaxe:
            cmd = ["git", "-C", os.path.dirname(path), "log", "--reverse",
                   "--format=%aI", "-S", pickaxe]
        out = subprocess.run(cmd + ["--", os.path.basename(path)],
                             capture_output=True, text=True, timeout=15)
        lines = [l for l in out.stdout.splitlines() if l.strip()]
        if lines:
            born = lines[0]
    except Exception:
        pass
    if not born:
        try:
            born = datetime.fromtimestamp(
                os.path.getmtime(path), tz=timezone.utc).isoformat()
        except OSError:
            born = ""
    BIRTH_CACHE[key] = born
    return born


def split_pre_rule(results, by_sid):
    """Sessions that ended before the instruction file existed can't be held
    to it — move them out of the scored lists."""
    for r in results:
        if not r.file:
            continue
        r.born = file_birth(r.file, r.pickaxe or None)
        if not r.born:
            continue
        born_utc = r.born
        try:
            born_utc = datetime.fromisoformat(r.born).astimezone(
                timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
        except ValueError:
            pass
        pre = [sid for sid in r.applicable
               if by_sid[sid].last_ts and by_sid[sid].last_ts[:19] < born_utc]
        r.pre_rule = pre
        r.pre_followed = [sid for sid in pre if sid in r.followed]
        r.applicable = [x for x in r.applicable if x not in pre]
        r.followed = [x for x in r.followed if x not in pre]
        r.violated = [x for x in r.violated if x not in pre]


def code_edits(s, scope):
    return [e for e in scoped_edits(s, scope) if e["path"].endswith(CODE_EXT)
            and "node_modules" not in e["path"]]


def ui_edits(s, scope):
    return [e for e in scoped_edits(s, scope)
            if any(h in e["path"] for h in UI_HINT) and "node_modules" not in e["path"]]


def cmds_matching(s, scope, pattern):
    rx = re.compile(pattern)
    return [c for c in scoped_commands(s, scope) if rx.search(c["cmd"])]


CHECK_RX = r"npm run (check|verify)\b|\btsc\b.*--noEmit|npm run lint\b"
PREVIEW_RX = r"dev:preview|AMBRIUM_DEV_PREVIEW|remote-debugging-port|localhost:3000|127\.0\.0\.1:3000|\[browser:"
STD_RX = r"npm (run )?(check|test|build|verify)\b|npm test\b|\btsc\b"
CLERK_IMPORT_RX = re.compile(
    r"import\s*\{[^}]*\b(useAuth|useUser)\b[^}]*\}\s*from\s*['\"]@clerk/nextjs")
HEX_RX = re.compile(r"(?:color|bg|background|border|fill|stroke|text)[^\n]{0,40}#[0-9a-fA-F]{3,8}\b|#[0-9a-fA-F]{6}\b")
OKLCH_RX = re.compile(r"oklch\(")
BAD_ICON_RX = re.compile(r"from\s*['\"](react-icons|@heroicons|@tabler/icons)")
DARK_SURFACE_RX = re.compile(r"dark:(bg|border)-(?!\w*-(300|400)\b)")
MONO_BAD_RX = re.compile(r"bg-gradient|backdrop-blur|shadow-(sm|md|lg|xl|2xl)|rounded-(lg|xl|2xl|3xl|\[)")


def eval_rules(sessions):
    results = []

    def new(rule_id, scope, quote, file=""):
        r = RuleResult(rule_id, scope, quote, file=file)
        results.append(r)
        return r

    tmpl_scopes = [k for k, v in SCOPES.items() if v["family"] == "template"]

    for scope in tmpl_scopes:
        root_doc = SCOPES[scope]["instruction_files"][0]
        r_check = new("run-check-before-done", scope,
                      "`npm run check` — run before declaring work done", root_doc)
        r_typegen = new("cf-typegen-after-wrangler-edit", scope,
                        "add a binding to wrangler.jsonc: update Env, run `npm run cf-typegen`", root_doc)
        r_secrets = new("secrets-never-in-wrangler-vars", scope,
                        "Secrets are never put in wrangler.jsonc vars", root_doc)
        r_clerk = new("no-direct-clerk-imports", scope,
                      "never import useAuth/useUser from @clerk/nextjs directly", root_doc)
        r_mig = new("never-edit-applied-migration", scope,
                    "Never edit an applied migration", root_doc)
        r_design = new("read-frontend-design-doc-before-ui", scope,
                       "All UI must follow frontend/CLAUDE.md — read it before writing any component", root_doc)

        for s in sessions:
            if scope not in s.scopes:
                continue
            ce = code_edits(s, scope)
            if ce:
                r_check.applicable.append(s.sid)
                checks = cmds_matching(s, scope, CHECK_RX)
                if checks:
                    last_edit = max(e["ts"] for e in ce)
                    after = [c for c in checks if c["ts"] > last_edit]
                    r_check.followed.append(s.sid)
                    if not after:
                        r_check.notes.append(
                            (s.sid, "check ran but NOT after the last edit"))
                else:
                    r_check.violated.append(s.sid)

            wr = [e for e in scoped_edits(s, scope) if "wrangler.jsonc" in e["path"]]
            if wr:
                r_typegen.applicable.append(s.sid)
                if cmds_matching(s, scope, r"cf-typegen"):
                    r_typegen.followed.append(s.sid)
                else:
                    r_typegen.violated.append(s.sid)
                r_secrets.applicable.append(s.sid)
                bad = [e for e in wr if re.search(
                    r"(SECRET|_KEY|TOKEN|PASSWORD)[\"']?\s*[:=]", e["content"])
                    and "vars" in e["content"]]
                if bad:
                    r_secrets.violated.append(s.sid)
                    r_secrets.notes.append((s.sid, bad[0]["path"]))
                else:
                    r_secrets.followed.append(s.sid)

            fe = [e for e in scoped_edits(s, scope)
                  if "/frontend/" in e["path"] and e["path"].endswith((".ts", ".tsx"))]
            if fe:
                r_clerk.applicable.append(s.sid)
                bad = [e for e in fe if CLERK_IMPORT_RX.search(e["content"])
                       and "/lib/auth" not in e["path"]]
                if bad:
                    r_clerk.violated.append(s.sid)
                    r_clerk.notes.append((s.sid, bad[0]["path"]))
                else:
                    r_clerk.followed.append(s.sid)

            mig = [e for e in scoped_edits(s, scope) if "/migrations/" in e["path"]]
            if mig:
                r_mig.applicable.append(s.sid)
                edited_existing = [e for e in mig if e["kind"] == "edit"]
                if edited_existing:
                    r_mig.violated.append(s.sid)
                    r_mig.notes.append((s.sid, edited_existing[0]["path"]))
                else:
                    r_mig.followed.append(s.sid)

            uie = [e for e in ui_edits(s, scope) if "/frontend/" in e["path"]]
            if uie:
                r_design.applicable.append(s.sid)
                first_ui = min(e["ts"] for e in uie)
                read_doc = [r for r in s.reads
                            if r["path"].endswith("frontend/CLAUDE.md")
                            and in_scope_path(r["path"], scope) and r["ts"] < first_ui]
                marker_ok = ("mist-teal-frontend" in s.markers or
                             "mono-frontend" in s.markers)
                if read_doc or marker_ok:
                    r_design.followed.append(s.sid)
                else:
                    r_design.violated.append(s.sid)

    # ---- infra-cost-analyzer AGENTS.md
    scope = "infra-cost-analyzer"
    r_preview = new("preview-verify-before-done", scope,
                    "HARD REQUIREMENT: do not mark a UI task done until you have run it "
                    "in preview mode and observed the result — not just tsc/build/tests",
                    SCOPES[scope]["instruction_files"][0])
    r_std = new("standard-checks", scope,
                "`npm run check` · `npm test` · `npm run build` (gate: `npm run verify`)",
                SCOPES[scope]["instruction_files"][0])
    for s in sessions:
        if scope not in s.scopes:
            continue
        uie = ui_edits(s, scope)
        if uie:
            r_preview.applicable.append(s.sid)
            ev = cmds_matching(s, scope, PREVIEW_RX)
            if ev:
                r_preview.followed.append(s.sid)
                r_preview.notes.append((s.sid, ev[0]["cmd"][:90]))
            else:
                r_preview.violated.append(s.sid)
        ce = code_edits(s, scope)
        if ce:
            r_std.applicable.append(s.sid)
            if cmds_matching(s, scope, STD_RX):
                r_std.followed.append(s.sid)
            else:
                r_std.violated.append(s.sid)

    # ---- financial-dashboard mist & teal
    scope = "financial-dashboard"
    r_hex = new("no-hardcoded-colors", scope,
                "Never hardcode hex/oklch values in components — semantic tokens only",
                SCOPES[scope]["instruction_files"][0])
    r_icons = new("lucide-only-icons", scope, "Icons: lucide-react only",
                  SCOPES[scope]["instruction_files"][0])
    for s in sessions:
        if scope not in s.scopes:
            continue
        tsx = [e for e in scoped_edits(s, scope) if e["path"].endswith(".tsx")
               and "globals.css" not in e["path"]]
        if tsx:
            r_hex.applicable.append(s.sid)
            bad = [e for e in tsx if HEX_RX.search(e["content"]) or OKLCH_RX.search(e["content"])]
            if bad:
                r_hex.violated.append(s.sid)
                r_hex.notes.append((s.sid, bad[0]["path"]))
            else:
                r_hex.followed.append(s.sid)
            r_icons.applicable.append(s.sid)
            badi = [e for e in tsx if BAD_ICON_RX.search(e["content"])]
            if badi:
                r_icons.violated.append(s.sid)
            else:
                r_icons.followed.append(s.sid)

    # ---- watchtower Mono design system
    scope = "watchtower"
    r_mono = new("mono-no-gradients-shadows-rounded", scope,
                 "Mono: no gradients, blur, rounded cards, drop shadows, or glass effects",
                 SCOPES[scope]["instruction_files"][2])
    r_mono.pickaxe = "Mono visual language"
    for s in sessions:
        if scope not in s.scopes:
            continue
        fe = [e for e in ui_edits(s, scope) if "/frontend/" in e["path"]]
        if fe:
            r_mono.applicable.append(s.sid)
            bad = [e for e in fe if MONO_BAD_RX.search(e["content"])]
            if bad:
                r_mono.violated.append(s.sid)
                r_mono.notes.append((s.sid, os.path.basename(bad[0]["path"])))
            else:
                r_mono.followed.append(s.sid)

    return results


# -------------------------------------------------------------- reporting ---

def week_bucket(day, until):
    # weeks are anchored to the END of the window so re-running weekly
    # extends the series naturally; W4 = the 7 days ending at --until
    d1 = datetime.strptime(until[:10], "%Y-%m-%d").date()
    d = datetime.strptime(day, "%Y-%m-%d").date()
    return max(1, 4 - (d1 - d).days // 7)


def est_tokens(path):
    try:
        return os.path.getsize(path) // 4
    except OSError:
        return 0


def main():
    ap = argparse.ArgumentParser()
    default_since = (datetime.now(timezone.utc) - timedelta(days=28)).strftime("%Y-%m-%d")
    ap.add_argument("--since", default=default_since)
    ap.add_argument("--until", default=datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    ap.add_argument("--out", default=str(Path(__file__).parent / "out"))
    args = ap.parse_args()
    since, until = args.since, args.until
    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)

    sessions = []
    for main_f, subs in iter_claude_files():
        s = parse_claude_session(main_f, subs)
        if s.first_ts and since <= s.first_ts[:10] <= until:
            sessions.append(s)
    for f in iter_codex_files(since, until):
        s = parse_codex_session(f)
        if s.first_ts and since <= s.first_ts[:10] <= until:
            sessions.append(s)

    for s in sessions:
        attribute_scopes(s)
    sessions.sort(key=lambda s: s.first_ts)

    results = eval_rules(sessions)
    by_sid = {s.sid: s for s in sessions}
    split_pre_rule(results, by_sid)

    # ---------- session CSV
    with open(outdir / "sessions.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["source", "session", "start", "week", "cwd", "scopes",
                    "user_turns", "commands", "edits", "errors", "interrupts",
                    "instr_markers", "tokens_out", "context_peak"])
        for s in sessions:
            w.writerow([s.source, s.sid[:12], s.first_ts[:16],
                        week_bucket(s.day(), until), s.cwd,
                        "|".join(sorted(s.scopes)), s.user_turns, len(s.commands),
                        len(s.edits), s.errors, s.interrupts,
                        "|".join(sorted(s.markers)), s.tokens_out, s.context_peak])

    # ---------- evidence JSON
    evidence = {
        "window": {"since": since, "until": until},
        "sessions_total": len(sessions),
        "rules": [{
            "rule": r.rule_id, "scope": r.scope, "quote": r.quote,
            "file": r.file, "born": r.born,
            "applicable": r.applicable, "followed": r.followed,
            "violated": r.violated, "pre_rule": r.pre_rule,
            "pre_followed": r.pre_followed, "notes": r.notes,
        } for r in results],
    }
    (outdir / "evidence.json").write_text(json.dumps(evidence, indent=2))

    # ---------- weekly table
    weeks = defaultdict(lambda: defaultdict(int))
    for s in sessions:
        wk = week_bucket(s.day(), until)
        weeks[wk]["sessions"] += 1
        weeks[wk]["commands"] += len(s.commands)
        weeks[wk]["edits"] += len(s.edits)
        weeks[wk]["errors"] += s.errors
        weeks[wk]["interrupts"] += s.interrupts

    # instruction-load stats per scope
    load_stats = {}
    for scope, cfg in SCOPES.items():
        touched = [s for s in sessions if scope in s.scopes]
        if cfg["family"] == "template":
            loaded = [s for s in touched if "playbook" in s.markers]
        elif cfg["family"] == "infra":
            loaded = [s for s in touched if "infra-agents" in s.markers]
        else:
            loaded = [s for s in touched if "findash-design" in s.markers]
        tok = sum(est_tokens(p) for p in cfg["instruction_files"])
        load_stats[scope] = (len(touched), len(loaded), tok)

    # ---------- markdown report
    L = []
    L.append(f"# RuleKeeper backtest — {since} → {until}")
    L.append("")
    total_cmds = sum(len(s.commands) for s in sessions)
    total_edits = sum(len(s.edits) for s in sessions)
    n_claude = sum(1 for s in sessions if s.source == "claude")
    n_codex = len(sessions) - n_claude
    L.append(f"**{len(sessions)} agent sessions** ({n_claude} Claude Code, {n_codex} Codex) · "
             f"{total_cmds} commands · {total_edits} file edits · "
             f"{sum(s.errors for s in sessions)} tool errors · "
             f"{sum(s.interrupts for s in sessions)} user interrupts")
    L.append("")

    L.append("## Instruction files: did they even reach the agent?")
    L.append("")
    L.append("| Scope | Sessions touching it | Sessions where instructions were in context | Instr. tokens/session |")
    L.append("|---|---|---|---|")
    for scope, (t, l, tok) in load_stats.items():
        if t == 0:
            continue
        L.append(f"| {scope} | {t} | {l} ({0 if t==0 else round(100*l/t)}%) | ~{tok:,} |")
    L.append("")

    L.append("## Rule scoreboard")
    L.append("")
    L.append("| Rule | Scope | Rule born | Applicable | Followed | Violated | Adherence | Pre-rule sessions |")
    L.append("|---|---|---|---|---|---|---|---|")
    for r in results:
        n = len(r.applicable)
        if n == 0 and not r.pre_rule:
            continue
        pct = f"{round(100 * len(r.followed) / n)}%" if n else "—"
        pre = f"{len(r.pre_followed)}/{len(r.pre_rule)} followed" if r.pre_rule else "—"
        L.append(f"| {r.rule_id} | {r.scope} | {r.born[:10]} | {n} | {len(r.followed)} | "
                 f"{len(r.violated)} | {pct} | {pre} |")
    L.append("")
    dead = [r for r in results if not r.applicable and not r.pre_rule]
    if dead:
        L.append("**Rules never exercised in the window (no applicable session):** " +
                 ", ".join(f"{r.rule_id} ({r.scope})" for r in dead))
        L.append("")

    L.append("## Violations with receipts")
    L.append("")
    for r in results:
        if not r.violated:
            continue
        L.append(f"### {r.rule_id} — {r.scope}")
        L.append(f"> {r.quote}")
        L.append("")
        for sid in r.violated[:10]:
            s = by_sid.get(sid)
            extra = next((d for x, d in r.notes if x == sid), "")
            L.append(f"- `{sid[:12]}` ({s.source}, {s.first_ts[:10]}, "
                     f"{len(s.edits)} edits){' — ' + extra if extra else ''}")
        L.append("")

    L.append("## Weekly trend (extend by re-running weekly)")
    L.append("")
    L.append("| Week | Sessions | Commands | Edits | Tool errors | Interrupts |")
    L.append("|---|---|---|---|---|---|")
    for wk in sorted(weeks):
        d = weeks[wk]
        L.append(f"| W{wk} | {d['sessions']} | {d['commands']} | {d['edits']} | "
                 f"{d['errors']} | {d['interrupts']} |")
    L.append("")

    # cross-tab: does having the instructions in context change adherence?
    scope_marker = {"template": "playbook", "infra": "infra-agents",
                    "findash": "findash-design"}
    L.append("## Adherence when instructions were in context vs. not")
    L.append("")
    L.append("For each exercised rule: of the sessions where the rule applied, how often")
    L.append("was it followed when the instruction file was demonstrably in the agent's")
    L.append("context, vs. when it never was?")
    L.append("")
    L.append("| Rule | Scope | In context: followed | Not in context: followed |")
    L.append("|---|---|---|---|")
    for r in results:
        if not r.applicable:
            continue
        marker = scope_marker[SCOPES[r.scope]["family"]]
        w_l = [x for x in r.applicable if marker in by_sid[x].markers]
        w_n = [x for x in r.applicable if marker not in by_sid[x].markers]
        fl = sum(1 for x in w_l if x in r.followed)
        fn = sum(1 for x in w_n if x in r.followed)
        cell_l = f"{fl}/{len(w_l)}" if w_l else "—"
        cell_n = f"{fn}/{len(w_n)}" if w_n else "—"
        L.append(f"| {r.rule_id} | {r.scope} | {cell_l} | {cell_n} |")
    L.append("")

    # correlation: key rule followed vs not — normalized friction rates
    L.append("## Does following the rules correlate with smoother sessions?")
    L.append("")
    for rid in ("run-check-before-done", "preview-verify-before-done", "standard-checks"):
        rs = [r for r in results if r.rule_id == rid and r.applicable]
        f_s = [by_sid[x] for r in rs for x in r.followed]
        v_s = [by_sid[x] for r in rs for x in r.violated]
        if not f_s or not v_s:
            continue
        def err_rate(lst):
            c = sum(len(s.commands) for s in lst)
            return 100 * sum(s.errors for s in lst) / c if c else 0.0
        def avg(lst, attr):
            return sum(getattr(s, attr) for s in lst) / len(lst)
        L.append(f"- **{rid}**: followed (n={len(f_s)}): "
                 f"{err_rate(f_s):.1f} errors/100 cmds, {avg(f_s,'user_turns'):.1f} user turns "
                 f"· violated (n={len(v_s)}): {err_rate(v_s):.1f} errors/100 cmds, "
                 f"{avg(v_s,'user_turns'):.1f} user turns")
    L.append("")

    (outdir / "report.md").write_text("\n".join(L))
    print(f"sessions={len(sessions)} rules={len(results)} -> {outdir}/report.md")
    for s in sessions:
        print(f"  {s.source:6} {s.sid[:14]} {s.first_ts[:10]} scopes={','.join(sorted(s.scopes)) or '-'} "
              f"cmds={len(s.commands)} edits={len(s.edits)} errs={s.errors} markers={','.join(sorted(s.markers)) or '-'}")


if __name__ == "__main__":
    main()
