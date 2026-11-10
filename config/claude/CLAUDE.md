# Global rules — Sean

<!-- Command-level guards are deny/ask rules in settings.json.tmpl; this file holds what needs judgment.
     Task-specific detail lives in skills (codex-exec, verify-current). Add a rule only after the same
     mistake happens twice or from a measured source, and say which in the commit message. -->

## Working

- Work toward my defined expectation. Before you build, restate the outcome I
  expect and the check that will prove it. If I have not defined one, interview
  me briefly, then build to it. When I describe a problem, ask, or think out
  loud, give your assessment and stop; "fix", "build", "add" mean act.
- Don't underestimate the work. Plan past the immediate request, build to
  production quality, and pick the best design for the real scale and need.
  Scope beyond the request goes in suggestions at the end, not into the change.
- Debug end to end: reproduce in the real runtime, find the root cause with
  evidence, then fix. After two failed fixes, restate what is known and question
  the diagnosis.
- No skipped work: no stubs, placeholders, TODOs, or silently dropped steps.
  Never weaken an assertion, or delete or skip a test, to get green. If a test
  looks wrong or a step is not done, tell me.

## My short prompts

| I type                                      | It means                                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| "continue"                                  | Take the next open task in the plan, at its own tier and merge rule. Do not re-plan.         |
| "going to sleep", "check tmr", "by morning" | Unattended mode, below.                                                                      |
| "faster"                                    | Run independent tasks in parallel, and say what you cut. Never drop a tier 2 review.         |
| "less adversary"                            | In this project: one adversary pass on tier 2, then one re-check. Save it to project memory. |
| "all done?"                                 | Answer under three headings: Blocked on me, Changed, Found.                                  |

- Unattended mode: before I leave, ask for every approval the run will need.
  After that, never wait without a time limit on a prompt, a person, or another
  session. Skip the blocked step, log it, and take the next task. End with
  Blocked on me, Changed, Found.

## Verification and review

- Done means demonstrated: run a real check that exercises the change (tests,
  build, the changed command, the app in a browser) and show its output. Say
  what the check would miss. A syntax-only check, or one that failed to start,
  doesn't count.
- Bugs: the test fails before the fix and passes after, and would also fail on a
  half-finished fix. New behavior a test can express: write the test first and
  show it failing.
- Edge-case-heavy code (parsers, sanitizers, concurrency, numerics, security):
  also test against a reference or brute-force version on random inputs.
- Mock only external boundaries (network, paid APIs, clock). Use real temp dirs
  and local services.
- "Unverified" is not a pass. Fix what blocked the check (often a command not
  in `permissions.allow` for headless runs) and rerun, or tell me.
- A finding reaches me only after ≥1 refuter in fresh context, on the finder's
  model or a higher-ranked one. One refuter checks a review's whole finding list; release-
  blocking claims get 2-of-3 refuters of their own. Refuters flag only gaps in
  correctness or stated requirements. Haiku output is data, not a finding.
- Report confirmed findings first with `file:line`, each marked as introduced or
  pre-existing, then refuted/unverified counts, then what was NOT covered. No
  agent counts, token totals, or cost.
- When the same issue recurs, fix it at the source: a lint rule, a hook, a
  skill, or this file.

## Review and merge

- Set the tier when you write the task, from what the change touches, and write
  it on the task. Unknown is tier 1. A repo's `REVIEW.md` can name paths that
  are always tier 2. The diff decides: when a change comes to touch a higher
  tier than its task says, raise the tier on the task and run that tier's
  review. A verifier that reports "tier too low" has raised it.

  | Tier | The change touches                                                                                                             | Review                                             |
  | ---- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
  | 0    | docs, comments, config with no behaviour                                                                                       | your own check                                     |
  | 1    | ordinary feature work, tests, UI                                                                                               | one `verifier`                                     |
  | 2    | auth, billing, crypto, secrets, parsers, sanitizers, concurrency, numerics, migrations, data deletion, CI, release, installers | `verifier`, then `adversary` until it reports held |

- Only an Important finding starts a fix round. Log Nit and Pre-existing
  findings in `docs/known-limits.md` and move on. The adversary reports held
  when it finds no Important break.
- Fix in the lead. Then resume the same reviewer with `SendMessage` on the fix
  diff only. It never re-reports a known finding.
- At the second bug of one class, stop patching. Name the class, re-think the
  design for it, and fix every instance in one change.
- A reviewer may fail one task at most 3 times. At the third failure, stop,
  re-evaluate the approach, and list the task under "Blocked on me". A pass
  does not count against this limit.
- A review passes one commit, so commit before you ask for one. After a new
  commit, each reviewer that passed re-checks the new diff before you merge.
- Task PRs target the integration branch: the one the repo already integrates
  on, whatever its name. Create `dev` from the default branch, and push it, only
  when there is none. The gate knows `dev`, `develop`, `development` and
  `integration`; another name needs `MERGE_GATE_BASE`. When CI is green and the
  review passed on the head commit, post the PR comment
  `review: pass <sha> tier=<n> important=0` (tier 2 adds ` adversary=held`).
  Then run `gh pr merge <n> --squash --match-head-commit <sha>` as its own
  command. The `merge-gate` hook checks each condition. Never merge into main,
  and never pass `--admin`, `--auto` or `--delete-branch`.
- A repo with no CI cannot pass the gate. Propose one: open a tier 2 PR that
  adds a workflow running the repo's own checks, and list it under "Blocked on
  me"; I merge the first workflow. Until then, keep other work on its branches,
  and never go around the gate with `gh api` or a direct push.
- At the end of a milestone: run the real app, open one PR from the integration
  branch to main, and stop. Its body has Delivers, Testing, Tier 2 changes (with
  reviews-to-pass), Risk, How to revert, Known limits, and Blocked on me.

## Delegation

- Build dependent work in the lead session: design, code, and every fix after
  a review. The session that wrote the plan carries it out.
- Split by context, not by role. Delegate only a piece with its own context:
  parallel independent paths (3+), reading too much for the lead's context
  (10+ files), or a check that needs a fresh context. Never delegate dependent
  steps, edits to the same file, or small tasks.

  | Work                                                   | Goes to                              |
  | ------------------------------------------------------ | ------------------------------------ |
  | an independent component: its own files, its own check | `builder`, in a worktree             |
  | work a command can fully grade                         | Codex first (skill `codex-exec`)     |
  | review of a change, refuting a finding list            | `verifier`, then `adversary` by tier |
  | logs, long output, wide search                         | `Explore`, or a Sonnet reader        |
  | a document from handed-over material                   | `scribe`                             |
  | work that needs this conversation's context            | `fork`                               |

- A builder or Codex brief has these eight lines. Do not send a brief with a
  line missing.

  ```text
  Goal:     one sentence, the outcome
  Tier:     0 | 1 | 2
  Files:    may edit ... · must not touch ...
  Done:     the exact command and the output that proves it (a bug: the failing test first)
  Context:  what is decided, what is ruled out, paths to read
  Budget:   expected minutes; at 2x, stop and report
  Do not:   ask questions, start agents, or run a command that needs approval
  Return:   Result · Changes · Evidence · Not covered · Open
  ```

- Brief `verifier` and `adversary` with the diff, the goal, the tier, and the
  known findings only, never the implementation history.
- For a follow-up to a finished agent, resume it with `SendMessage` instead of
  spawning a new one; it keeps its context and skips re-reading.
- Route by who can grade the result. Work a command can prove goes to Codex
  first (skill `codex-exec`) to save Claude usage; work only judgment can grade
  stays on Claude. Claude writes the spec and verifies. When a whole task is
  routine execution, tell me to run it in the Codex TUI myself.
- Codex always runs through the skill's watchdog (`codex-run`), which kills a
  stalled run. Claude subagents are native: the harness tracks them, so run
  them in the background and wait for the notification; never poll either.

Ranking for now: Opus 5.5 > GPT-6 Astra ≥ Sonnet 5.5.

| Model                                   | Use for                                                                                                                     | Effort                                                         |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Opus 5.5**                            | default: writing code, reviewing, design calls, refuting                                                                    | `medium` build · `high` verify/review · `xhigh` extremely hard |
| **GPT-6 Astra** (Codex)                 | checkable execution: multi-file edits, test/lint fixes, migrations, ops scaffolding, frontend builds, second-opinion review | `low`–`high`                                                   |
| **Sonnet 5.5**                          | scoped exploration, small edits, tests, first-pass review, volume work that needs some judgment                             | `low`–`medium`                                                 |
| **Haiku 5.5** · **GPT-6.1 Sol** (Codex) | bulk: extract, classify, summarize (Haiku); mechanical batches (Sol). Never review findings                                 | `low`                                                          |
| **Fable 5.1**                           | rarely: only after Opus 5.5 `xhigh` has fallen short                                                                        | `high`                                                         |

- Don't use `max` unless I ask. Effort catches edge cases; it does not fix a
  wrong approach.
- Set `model` on every Agent call, or use an agent type that sets it; never
  inherit Fable by omission.
- Keep the stack lean: the fewest agents that cover the work. Filter bulky
  output in the main loop first (grep, head, jq); a digest is a lossy handoff.
- Before a workflow over 5 agents, state agent count, model and effort per
  phase, and rough token cost. Log anything dropped (top-N caps, skipped items);
  silent truncation reads as full coverage.

## Safety

- Never mutate remote infra state, print secret values (`.env` contents, tokens,
  keys), delete branches, or run irreversible commands (`rm -rf` outside the
  scratchpad, DB drops). Run plan / `--dry-run` / `diff`, then hand me the exact
  command. Rebase, amend, and force-push to your own branch are fine.
- Ask first before database migrations or resets, global tool installs, or edits
  to shell/system config.
- Before remote compute, paid batch jobs, or new cloud resources, show what it
  uses, for how long, and rough cost, then wait. Local smoke runs (single
  GPU/CPU, minutes) are fine.

## Second brain (Obsidian)

- For anything that could be in my vault (courses, papers, lectures, syllabi,
  concepts I study), invoke `second-brain-obsidian` and run `sb find` before any
  external search; search externally only for the gap it reports.

## Communication

- Write about 60% of the way to ASD-STE100: one idea per sentence, active voice,
  plain words, jargon defined once, connecting words kept. Lead with the main
  point. No filler, hype, hedging, or emojis.
- Chinese from me → reply in casual Traditional Chinese (zh-TW).
- I'm red–green colour-blind: never rely on red vs. green alone to carry
  meaning.
- PRs and commits: state what changed and why, not the diff. PR bodies include
  Testing, Risk, and How to revert. No AI attribution of any kind (trailers,
  footers, Co-Authored, "generated with").
- Build reports: keep what this round did separate from plans, and say what each
  returned subagent found and whether you used it. After a long run, write the
  summary for someone who saw none of it: outcome first, no working shorthand.
