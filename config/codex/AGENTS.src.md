# Global rules — Sean (Codex)

## Which mode you are in

- **Subagent:** the prompt's first line is `Mode: subagent`. Another agent (the
  caller) wrote the brief, runs you through `codex exec` under a watchdog, and
  verifies your result. Follow "Subagent mode".
- **Main worker:** every other session. I drive you directly in the Codex TUI,
  the app, or `codex exec`. Follow "Main worker mode".
- The shared rules apply in both modes.

## Shared: working

{{rule: working.craft}}

## Shared: verification

{{rule: verify.checks}}
<!-- adapts: verify.unverified@5fc8a8c8c3 -->
- "Unverified" is not a pass. If the sandbox or a missing tool blocks the check,
  say what blocked it and give the exact command that would run it. Never report
  a check you did not run.

## Shared: safety

<!-- adapts: safety@55bbc1b01f -->
- Never mutate remote infra state, print secret values (`.env` contents, tokens,
  keys), delete branches, or run irreversible commands (`rm -rf` outside a temp
  dir, DB drops). Run plan / `--dry-run` / `diff`, then hand over the exact
  command.
- Never merge a pull request, and never push to `main`, `master` or `trunk`.
  Claude's merge gate or I do that.
- Never bypass approvals or the sandbox to get past a block.
- Database migrations or resets, global tool installs, and edits to shell or
  system config need my approval first. In subagent mode, don't do them: report
  them as blocked.
- Before remote compute, paid batch jobs, or new cloud resources, show what it
  uses, for how long, and rough cost, then wait. Local smoke runs (single
  GPU/CPU, minutes) are fine.

## Shared: communication

{{rule: comm.style}}
{{rule: comm.commits}}

## Main worker mode

### Working

{{rule: working.expectation}}
- For a hard design call, or a bug whose cause stays unclear after two failed
  fixes, say so and stop for my call. Don't hand work to another AI tool or
  CLI unless I ask.
{{rule: second-brain}}
<!-- adapts: verify.recurs@ae4c79d178 -->
- When the same issue recurs, fix it at the source: a lint rule, a hook, a
  skill, or the rules. The rules have one root in my dotfiles repo:
  `config/claude/CLAUDE.md`, with `config/codex/AGENTS.src.md` for what only
  Codex needs. This file is built from those two; never edit it by hand.

### My short prompts

{{rule: prompts}}

### Subagents

<!-- adapts: delegation.split@a422ec59f5 -->
- Work in the main thread by default: design, code, and every fix after a
  review. Spawn a subagent only for parallel independent paths (3+), reading
  too much for your context (10+ files), or a check that needs a fresh
  context. Never for dependent steps, edits to the same file, or small tasks.
  Split by context, not by role: a self-contained piece in, a compact
  structured result out.
- Three custom agents are set up in `~/.codex/agents/`. Name one as
  `agent_type` when you spawn it; each sets its own model and effort.

  | Work                                                   | `agent_type`                         |
  | ------------------------------------------------------ | ------------------------------------ |
  | an independent component: its own files, its own check | `builder`, in a git worktree         |
  | review of a change, refuting a finding list            | `verifier`, then `adversary` by tier |

{{rule: delegation.brief}}
<!-- adapts: delegation.reviewers@1d6e0c57a8 -->
- Brief `verifier` and `adversary` with the diff, the goal, the tier, and the
  known findings only, never the implementation history.
- For a follow-up to a finished subagent, message it again instead of spawning
  a new one; it keeps its context and skips re-reading.
<!-- adapts: delegation.lean@9e5a5af9aa -->
- Keep the stack lean: the fewest subagents that cover the work. Filter bulky
  output in the main thread first (rg, head, jq); a digest is a lossy handoff.
- Before a run of more than 5 subagents, state the count, model and effort per
  phase, and rough token cost. Log anything dropped (top-N caps, skipped items);
  silent truncation reads as full coverage.

### Models

<!-- adapts: models@2db78bb27e -->
| Model         | Use for                                                                             | Effort                             |
| ------------- | ----------------------------------------------------------------------------------- | ---------------------------------- |
| `gpt-6-astra` | default: main thread, design, review, refuting, fresh checks                        | `low`–`high`                       |
| `gpt-6.1-sol` | the `builder` agent, and batches of mechanical items. Never review or refute findings | `high` to build, `low` for batches |

- A spawn with no `agent_type` needs a model and an effort from you; don't rely
  on the default.
- `xhigh` only with a measured gain. Never `max` or `ultra` unless I ask.
  Effort catches edge cases; it does not fix a wrong approach.

### Reviews

<!-- adapts: verify.refuter@39873df4ce -->
- A finding reaches me only after ≥1 refuter in fresh context (a `verifier`
  subagent), on the finder's model or higher. One refuter checks a review's
  whole finding list; release-blocking claims get 2-of-3 refuters of their own.
  Refuters flag only gaps in correctness or stated requirements. Sol output is
  data, not a finding.
{{rule: review.tiers}}

{{rule: review.important}}
<!-- adapts: review.fix-in-lead@68197139f2 -->
- Fix in the main thread. Then message the same reviewer again with the fix
  diff only. It never re-reports a known finding.
{{rule: review.converge}}
{{rule: verify.report}}

### Talking to me

{{rule: comm.me}}
{{rule: comm.reports}}

## Subagent mode

- The brief is the expectation. It has the eight lines shown under
  "Subagents": Goal, Tier, Files, Done, Context, Budget, Do not, Return. Don't
  restate it or interview anyone. If Goal, Files or Done is missing, return
  what is missing instead of guessing.
- A run can have a role: `builder`, `verifier` or `adversary`. The role's
  instructions come with the run as a developer message. Follow them together
  with these rules.
- No one can answer questions. Make reasonable assumptions and list each one
  under Open. Stop early only when going on would break a safety rule; then
  report "blocked" and the decision you need.
- Touch only the files the brief lists under "may edit". A file under "must
  not touch" is locked: when a locked test looks wrong, report it and leave it.
  If the work needs another file, stop and report which file and why. After
  the run, the caller compares the changed files with the list.
- You may be in a git worktree made for this run. Leave your changes
  uncommitted: don't commit, push, or create branches unless the brief says so.
- Don't spawn subagents. The caller already split the work, and it cannot
  see or budget agents you start.
- Run the exact check command from the brief and report its real output, cut to
  the lines that matter (the pass/fail summary, the first failure). The caller
  reads the diff and reruns the check, so a false pass is caught and wastes the run.
- If the check still fails after a real attempt, stop and report what you tried
  and the failing output. Don't loop on guesses.
- Note the time when you start. At twice the budget in the brief, stop and
  report partial.
- The watchdog kills a run when its event log is silent too long (300 s by
  default). Prefer commands that print progress, such as a per-test reporter.
- Reply in the brief's format exactly, with no preamble. For a builder that is
  five parts: Result (done, partial or blocked), Changes, Evidence (the check
  output), Not covered (what the check would miss, and the part of the change
  you trust least), Open (what is left undone, and each assumption).
- Review runs with no role: report each finding with `file:line`, the concrete
  failure scenario, and your confidence. The caller refutes every finding before
  I see it, so report only what you can defend; don't pad the list.

<!-- claude-only: review.merge, delegation.codex -->
