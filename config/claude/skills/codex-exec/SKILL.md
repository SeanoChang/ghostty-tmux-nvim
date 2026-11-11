---
name: codex-exec
description: Delegate checkable execution work to OpenAI Codex through `codex exec` (gpt-6.1-sol, gpt-6-astra) to save Claude usage, or get a review or an adversary pass from another model family. Use whenever a task has a precise spec and a command that proves it done — mechanical multi-file edits, codemods, dependency bumps, test or lint fixes, migrations, regenerating outputs, Dockerfiles, CI YAML, scripts, Terraform up to `plan`, frontend UI builds, long "make these tests pass" runs — or when the user says codex, astra, sol, or "offload this".
---

# codex-exec

Codex runs on the user's OpenAI plan, so work sent here uses no Claude usage.
Claude leads: it writes the brief, reviews the result and commits. Codex
builds in its own git worktree, and sometimes gives a second review or an
adversary pass. Codex never merges and never commits.

## Route

- **Send to Codex:** work a command can grade (tests, build, lint, a diff check).
- **Keep on Claude:** design calls, shared contracts, bugs with an unclear
  cause, refuting findings, research, writing in the user's style, changes to
  the harness itself (`.claude/`, `.codex/`, hooks, CI), anything that needs
  this conversation's context.
- **Not ready for Codex:** a task whose Done line you cannot write yet.
- **Too small for Codex:** the smallest run below read 92,000 input tokens
  (most of them cached) and took 40 seconds. Do a few-line fix in the main
  loop.
- **Whole task is routine:** tell the user to run it in the Codex TUI
  themselves instead of driving it from Claude.

## Roles

A role is a Codex agent file in `~/.codex/agents/` (source:
`config/codex/agents/` in the dotfiles repo). `codex-run --role <name>` sends
the role's instructions with the run and sets its model and effort.

| Role        | Use for                                                        | Model, effort          | Where it runs                 |
| ----------- | -------------------------------------------------------------- | ---------------------- | ----------------------------- |
| `builder`   | the work in the description                                    | `gpt-6.1-sol`, `high`  | a new worktree (`--worktree`) |
| `verifier`  | a second review of a commit, from another model family         | `gpt-6-astra`, `high`  | a new worktree at that commit |
| `adversary` | a second attack on tier 2 work that Claude's adversary held    | `gpt-6-astra`, `high`  | a new worktree at that commit |

- To change a model or an effort for one run, pass `-m` or
  `-c model_reasoning_effort='"medium"'` in the codex args: it wins over the
  role's. When Sol fails the check twice, run the builder once with
  `-m gpt-6-astra -c model_reasoning_effort='"low"'`, then take the task back.
- Effort levels: `low · medium · high · xhigh · max · ultra`. `xhigh` only
  with a measured gain; never `max` or `ultra` unless the user asks.
- A Codex review never replaces the review for the tier. Claude's `verifier`
  and `adversary` write the lines the merge gate reads; the Codex roles are
  told not to. Each Codex finding goes through an Opus refuter before the
  user sees it.

## Call

Always run Codex through the watchdog. It is an external process the harness
cannot see, so a stall would otherwise hang forever. (Claude subagents are
native: the harness tracks them, so they need no watchdog.)

```bash
~/.claude/skills/codex-exec/scripts/codex-run \
  --log <scratchpad>/codex-<task>.jsonl --idle 300 --max 1800 \
  --role builder \
  --worktree <scratchpad>/wt-<task> --repo <repo> \
  --allow 'src/billing/*' --allow 'tests/test_billing.py' -- \
  -s workspace-write --ephemeral \
  -o <scratchpad>/codex-<task>.md "<brief>"
```

- `--worktree` makes a new git worktree from the HEAD of `--repo` and runs
  Codex there, so the lead's tree is never touched and several runs can go at
  one time. Give a path outside the repo (the scratchpad); a path inside it is
  refused. Uncommitted work is not in it: commit what the run needs first.
- `--allow` is the "may edit" list of the brief as path patterns (`*` also
  crosses `/`). After the run, a changed file that fits no pattern is listed
  and the exit code is 3. Leave a locked test out of the patterns. This check
  reads the worktree only; the sandbox is what keeps Codex inside it.
- The check is there to catch a run that strays from its files. It is not a
  wall against a run that tries to hide a change: the sandbox is, together
  with your review of the diff in your own tree.
- "Changed" is read from the disk, not from git: `codex-run` records every
  file before the run and compares after it. So a cache file, a file that git
  ignores, a build folder and a file the run committed all count.
- A Python check writes `__pycache__` and `.pytest_cache`. Write the Done
  command with `PYTHONDONTWRITEBYTECODE=1` and `-p no:cacheprovider`. When a
  run still ends with 3 and the list holds caches only, the run stayed in
  scope: read the list, then go on. Allow a build folder by pattern
  (`--allow 'target/*'`) only when the task must build. An allowed file is
  not checked at all.
- Exit 3 with "changed the worktree's .git entry" means git in that worktree
  cannot be trusted. Exit 3 with "could not be read" means part of the
  worktree was not checked. No pattern allows either. Do not take a change
  from such a worktree; remove it by hand and run again.
- Exit codes: Codex's own; 3 for a change outside `--allow`; 124 when the
  watchdog killed the run (the event log was silent for `--idle` seconds, or
  the run passed `--max` seconds; the last events are on stderr); 127 when
  `codex` is not on PATH or cannot be started (no worktree and no log are
  made when it is not on PATH); 2 for bad usage. Raise `--idle` when the
  brief runs a slow test suite that prints nothing for minutes.
- On exit 124: read the last events, then retry once with a narrower brief or
  take the task back to Claude. A stall counts as a failed attempt.
- Run it with `run_in_background` when it runs beside other work; the harness
  notifies you when it exits. Never poll it with a sleep loop.
- Outside a git repository there is no worktree: pass `-C <dir>` and
  `--skip-git-repo-check` in the codex args, and give Codex only files that
  Claude is not editing at the same time.
- Use `-s read-only` for investigation.
- Never pass `--dangerously-bypass-approvals-and-sandbox` or
  `--dangerously-bypass-hook-trust`.

## Brief

Every brief starts with the line `Mode: subagent`. It tells Codex to follow
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
- Codex reads its own `AGENTS.md` and the repo's, but not this conversation.
  Put every decision and constraint it needs under Context.
- Name the contract under Done when there is one (a docstring, a spec file):
  "the docstring contract holds; check: ...". In the runs below, both models
  then met the parts of the contract that the visible tests did not reach.
- For tier 2, write the tests first yourself and list them under "must not
  touch". Codex then cannot move the goal.
- For `verifier` and `adversary`, the brief is the one Claude's reviewers get:
  the commit or the diff, the goal, the tier, and the known findings only.
- Send tier 2 work to Codex only when a command fully grades it. The review
  for its tier still runs on Claude afterwards.

## Verify

- The reply is a claim, not evidence. Read the diff and rerun the check
  yourself, in the worktree:

  ```bash
  git -C <worktree> status --short
  git -C <worktree> diff
  ```

- "Not covered" in the reply names the part Codex trusts least. Read that part
  first.
- To take the change into the lead's tree:

  ```bash
  git -C <worktree> add -A
  git -C <worktree> diff --cached --binary HEAD | git -C <repo> apply --3way
  ```

  A file that git ignores stays behind in the worktree. Then review, run the
  full checks and commit in the lead's tree: that run is the last word, since
  an allowed or ignored file in the worktree can sway a check there. Remove
  the worktree with `git -C <repo> worktree remove --force <worktree>`.
- If Codex fails the check twice, take the task back to Claude.
- Codex runs count toward the workflow agent count in CLAUDE.md.

## Review of local changes

```bash
codex exec review --uncommitted        # or --base <branch>, --commit <sha>
```

This is Codex's built-in review, with no role. Use it for a quick second read
of changes that are not committed. Treat its output as extra findings from
another model family: each goes through an Opus refuter before the user sees
it.

## Evidence (2026-11-11)

Six small graded tasks, one run per model, through `codex-run`: write two
functions from a contract, fix three bugs of which one test shows one, a strict
parser, a rename across seven modules, a rate limiter, and git's ignore rules
checked against `git check-ignore`. Each was graded by tests the model never
saw.

| Arm                     | Tasks passed | Hidden tests | Time, six runs | List price, six runs |
| ----------------------- | ------------ | ------------ | -------------- | -------------------- |
| `gpt-6-astra` at `low`  | 6 of 6       | 197 of 197   | 422 s          | $2.04                |
| `gpt-6.1-sol` at `high` | 6 of 6       | 197 of 197   | 737 s          | $0.58                |

- Both models changed only the source files the brief allowed, and replied
  in the five-line form in every run. The bench's scope check read
  `git status` and left cache names out. All twelve runs left a
  `.pytest_cache` folder and ten left `__pycache__` files; today's
  `codex-run` check would list them. On the tier 2 task, both wrote their own
  random tests against git.
- So the builder runs on Sol at `high`: the same result at about 0.3 of the
  price and 1.75 times the wall time. Use Astra at `low` when the wait matters.
- What this does not show: which model is better on hard work. No task
  failed in either arm, and each ran once.
- A run read 92,000 to 340,000 input tokens (84 to 94% cached) and wrote
  1,300 to 10,600. The prices are OpenAI's API list prices on that day (Astra
  $10 / $50 per million input / output tokens, $1 cached; Sol $2 / $10,
  $0.10 cached); the user's plan is not billed that way.
- Re-check the roles' models with the `verify-current` skill when a new model
  ships.

Earlier (2026-10-26), for the ranking in CLAUDE.md:

- Artificial Analysis Intelligence Index: Opus 5.5 58, Sonnet 5.5 56 (AA
  site); Astra 53 (secondary sources only); GPT-6.1 Sol (high) 50 vs Opus
  (xhigh) 56, $521 vs $4,057 to run the index.
- Terminal-Bench 4.0, independent runs, conflicting: Opus about 60%, Sonnet
  about 64%, Astra 58–60%, GPT-6.1 Sol (high) 52%.
