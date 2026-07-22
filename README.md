# rulekeeper miner (weekend-1 proof)

Joins instruction files (CLAUDE.md / AGENTS.md) with agent session behavior
mined from local Claude Code + Codex logs. See `../RULEKEEPER_PROOF.md` for
the 4-week backtest results.

## Run

```bash
python3 mine.py                                   # trailing 28 days
python3 mine.py --since 2026-06-22 --until 2026-07-19
```

Stdlib only, no deps. Reads `~/.claude/projects/**.jsonl` (incl. subagent
transcripts) and `~/.codex/sessions/**/rollout-*.jsonl`. Nothing leaves the
machine.

## Outputs (`out/`)

- `report.md` — scoreboard, violations with session receipts, weekly trend,
  in-context vs not cross-tab
- `evidence.json` — per-rule session ID lists (for pulling raw receipts)
- `sessions.csv` — one row per session: scopes touched, commands/edits/errors,
  which instruction files were in context, token usage

## Weekly cadence

Weeks are anchored to `--until`, so re-running every Sunday extends the trend
series. Rule birth dates come from git (pickaxe for rules whose file predates
the rule text), so sessions older than a rule are reported separately, never
as violations.

## Extending

- New repo: add an entry to `SCOPES` (roots, name tokens, instruction files)
  and a marker substring to `INSTRUCTION_MARKERS`.
- New rule: add a block in `eval_rules()` — applicability predicate +
  followed/violated detector over `commands` / `edits` / `reads`.

## Parser notes (hard-won)

- Codex logs shell commands three ways: `function_call` `exec_command`
  (JSON args), `custom_tool_call` JS with `cmd:"..."`, and the same with
  JSON-quoted keys `{"cmd":...}` — all handled, workdir extracted for scope
  attribution.
- Codex edits arrive as `apply_patch` custom_tool_calls; some rollouts embed
  the patch with escaped `\n`. Only **added** lines are scored against
  content rules (context/removed lines caused false violations).
- Claude Edit/Write inputs give exact written content; `is_error` on
  tool_results gives per-command failure.
- Instruction-in-context detection = distinctive marker substring present in
  the raw transcript (injection or agent read — both count as delivered).
