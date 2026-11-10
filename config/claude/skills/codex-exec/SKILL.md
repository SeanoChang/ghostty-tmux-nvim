---
name: codex-exec
description: Delegate checkable execution work to OpenAI Codex through `codex exec` (gpt-6-astra, gpt-6.1-sol) to save Claude usage, or get a second-opinion code review from another model family. Use whenever a task has a precise spec and a command that proves it done — mechanical multi-file edits, codemods, dependency bumps, test or lint fixes, migrations, regenerating outputs, Dockerfiles, CI YAML, scripts, Terraform up to `plan`, frontend UI builds, long "make these tests pass" runs — or when the user says codex, astra, sol, or "offload this".
---

# codex-exec

Codex runs on the user's OpenAI plan, so work sent here uses no Claude usage.
Claude writes the spec and verifies the result; Codex runs the execution loop.

## Route

- **Send to Codex:** work a command can grade (tests, build, lint, a diff check).
- **Keep on Claude:** design calls, bugs with an unclear cause, refuting
  findings, research, writing in the user's style, anything that needs this
  conversation's context.
- **Too small for Codex:** a run costs about 8k tokens of fixed overhead. Do
  one-line fixes in the main loop.
- **Whole task is routine:** tell the user to run it in the Codex TUI
  themselves instead of driving it from Claude.

## Models

| Model | Tier | Use for |
|---|---|---|
| `gpt-6-astra` | below Opus 5.5, at or above Sonnet 5.5 (user's ranking) | default executor for everything in the description |
| `gpt-6.1-sol` | below Astra, about 8× cheaper | high-volume batches of low-risk mechanical items, at `low` |

Effort levels: `low · medium · high · xhigh · max · ultra`. Always pass one:
the user's `~/.codex/config.toml` defaults to `high`.
`low` mechanical · `medium` normal · `high` harder. `xhigh` only with a
measured gain; never `max` or `ultra` unless the user asks.

## Call

Always run Codex through the watchdog. It is an external process the harness
cannot see, so a stall would otherwise hang forever. (Claude subagents are
native: the harness tracks them, so they need no watchdog.)

```bash
~/.claude/skills/codex-exec/scripts/codex-run \
  --log <scratchpad>/codex-<task>.jsonl --idle 300 --max 1800 -- \
  -m gpt-6-astra -c model_reasoning_effort='"low"' \
  -s workspace-write -C <dir> --ephemeral \
  -o <scratchpad>/codex-<task>.md "<spec>"
```

- The watchdog kills the whole Codex process tree when the event log is
  silent for `--idle` seconds or the run passes `--max` seconds, and exits
  124 with the last events on stderr. Raise `--idle` when the spec runs a
  slow test suite that prints nothing to Codex for minutes.
- Run it with `run_in_background` when it runs beside other work; the harness
  notifies you when it exits. Never poll it with a sleep loop.
- On exit 124: read the last events, then retry once with a narrower spec or
  take the task back to Claude. A stall counts as a failed attempt.
- Use `-s read-only` for investigation.
- Add `--skip-git-repo-check` outside a git repo.
- Never pass `--dangerously-bypass-approvals-and-sandbox`.
- Give Codex files Claude is not editing at the same time.

## Spec

Every spec starts with the line `Mode: subagent`. It tells Codex to follow
the subagent rules in `~/.codex/AGENTS.md` instead of the main-worker rules.
Then comes the eight-line brief from CLAUDE.md (Delegation), with these
lines written for Codex:

```text
Mode: subagent
Goal:     one sentence, the outcome
Tier:     0 | 1 | 2
Files:    may edit ... · must not touch ...
Done:     the done criterion, and the exact check command to run
          (a bug: the failing test first)
Context:  what is decided, what is ruled out, paths to read
Budget:   expected minutes; at 2x, stop and report
Do not:   Make reasonable assumptions; do not ask questions. Do not start
          agents or run a command that needs approval; report it instead.
Return:   Reply in five short lines: Result, Changes, Evidence (the check
          output), Not covered, Open.
```

- Keep the "do not ask questions" sentence word for word. Astra stops to ask
  when an answer could change the outcome, and `exec` has no one to answer.
- Send tier 2 work to Codex only when a command fully grades it. The review
  for its tier still runs on Claude afterwards.

## Verify

- The reply is a claim, not evidence. Read the diff and rerun the check.
- If Codex fails the check twice, take the task back to Claude.
- Codex runs count toward the workflow agent count in CLAUDE.md.

## Second-opinion review

```bash
codex exec review --uncommitted        # or --base <branch>, --commit <sha>
```

Treat its output as extra findings from another model family. Each finding
goes through an Opus refuter before the user sees it.

## Evidence (2026-10-26)

- Smoke runs, `low` effort, planted one-line bug: Astra exit 0, check `ok`,
  7,974 tokens, 20 s; Sol exit 0, check `ok`, 8,889 tokens.
- Artificial Analysis Intelligence Index: Opus 5.5 58, Sonnet 5.5 56 (AA
  site); Astra 53 (secondary sources only); GPT-6.1 Sol (high) 50 vs Opus
  (xhigh) 56, $521 vs $4,057 to run the index.
- Terminal-Bench 4.0, independent runs, conflicting: Opus about 60%, Sonnet
  about 64%, Astra 58–60%, GPT-6.1 Sol (high) 52%.
- Re-check tiers with the `verify-current` skill when a new model ships.
