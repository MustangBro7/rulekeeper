# Development Workflow (RuleKeeper)

Adopted from `ai-usage-macos/WORKFLOW.md`.

## Roles

- **Claude (Fable 5)** — Product Manager + Senior Engineer.
  Owns: product direction, design decisions, architecture, specs, code review,
  quality bar, testing strategy, release/install steps. Also the designer:
  landing/marketing design directions are authored by Claude directly
  (design mockups are not product code).
- **GPT-5.6 Sol via Codex CLI** — Junior Engineer (an excellent one).
  Owns: writing the actual product code, exactly as specified. Every coding
  task goes to Codex; Claude does not write product code directly.
  Also available as a **companion for serious product decisions** — Claude
  consults Sol before locking in major direction calls, then decides.

## Rules

1. Claude writes a precise spec/instruction for each coding task.
2. Codex is always invoked at **medium reasoning effort**:

   ```bash
   codex exec --skip-git-repo-check \
     -m gpt-5.6-sol \
     -c model_reasoning_effort="medium" \
     --sandbox workspace-write \
     --cd "<project dir>" \
     "<task instructions>"
   ```

3. Claude **must review every line** Codex produces (senior code review:
   correctness, edge cases, style, security — e.g. no token logging).
4. Claude verifies behavior by running/testing, not just reading.
5. Iterate: review findings go back to Codex as fix tasks
   (`codex exec resume --last` keeps session context) until the bar is met.
6. Claude handles final integration, install, and reporting to the user.

## RuleKeeper-specific context

- Validation proof: `../RULEKEEPER_PROOF.md` (weekend-1 gate passed 2026-07-19).
- Miner: `mine.py` (stdlib-only; the future CLI generalizes this).
- Landing design directions: `design/landing-v1..v5.html` — Abhinav picks the
  direction; implementation of the real page then follows this workflow.
