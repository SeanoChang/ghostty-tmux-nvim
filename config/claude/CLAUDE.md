# Global rules — Sean (SWE · DevOps · ML)

## Decision-making
- When choosing between designs, don't overweight development cost. You build far faster than a human — never pick the lower-quality option because the better one "would take weeks."
- Bug fixes start with reproduction: reproduce end-to-end, as close to the real user/runtime experience as possible, before changing code. A unit test alone is not a reproduction.
- Done means demonstrated. Show the passing test output, build log, or actual command run. Never claim success without evidence.
- After two failed attempts at the same fix, stop patching: restate what's known, question the diagnosis, re-approach cleanly.

## Never (suggest the exact command for me instead)
- Never run a command that mutates remote infra state — `terraform|tofu apply|destroy`, `kubectl apply|delete|patch|edit|scale|rollout|drain`, `helm install|upgrade|uninstall|rollback`, any `aws`/`gcloud` write verb (create/update/delete/put/rm/sync --delete). Run plan / `--dry-run` / `diff`, then hand me the exact command.
- Never print secret values: no `kubectl get secret -o yaml|json`, no dumping `.env` contents, no echoing tokens or keys.
- Never delete branches or run destructive/irreversible commands (`git clean -fdx`, `rm -rf` on anything outside the scratchpad, DB drops). Ordinary git operations — rebase, amend, force-push to your own branch — are fine.

## Ask first
- Database migrations or resets.
- Submitting GPU/training jobs to any remote/cloud target — show estimated cost, hardware, and duration first. Local smoke runs (single GPU/CPU, minutes) don't need asking.
- Installing global tools or editing shell/system config files.

## Tooling
- Match the project's existing package/env manager (look for uv.lock, poetry.lock, environment.yml, pnpm-lock.yaml, etc.). Never introduce a different one.
- Prefer CLIs over MCP servers for the same job (`gh`, `aws`, `gcloud`) — fewer tokens, lower latency.
- Watching CI: use `gh run watch`. Never hand-write polling loops around `gh run view`.

## Subagents & workflows
Model routing — never let a subagent inherit Fable by omission; pick per task.
(per 1M in/out: Fable $10/$50 · Opus $5/$25 · Sonnet $3/$15 · Haiku $1/$5)
- **Fable** — hardest reasoning, ambiguous scope, long-horizon autonomous runs, final synthesis, adversarial verify of release-blocking claims. Never for bulk reading or mechanical work.
- **Opus** — default for subagents that write code or make design calls: implementation, refactors, code review, judge panels, design-alternative generation.
- **Sonnet** — reading-heavy and structured work: codebase explore/map, grep-and-summarize, doc/log extraction, first-pass review, test writing (run at effort xhigh for coding).
- **Haiku** — mechanical: classify, format, rename, one-file transforms, log scanning, status polls. Never for judgment calls.
- Effort: `low` mechanical · `high` default · `xhigh` coding/agentic · `max` only when correctness outweighs cost.
- Agent type: `Explore` for read-only search; `general-purpose` only when the subagent must write; `fork` only when it needs my conversation context.
- Before launching a workflow >5 agents, state agent count, model mix, and rough token cost. Log anything dropped (top-N caps, skipped items) — silent truncation reads as full coverage.

Verification standard
- A finding from any review/audit/research workflow reaches me only after an independent adversarial pass: ≥1 refuter in fresh context on a model ≥ the finder's tier (Sonnet finder → Opus verifier); ≥2-of-3 refuters for release-blocking claims. Anything unverified goes under an explicit "unverified" heading, never in the headline.

Report shape
- Confirmed findings first with `file:line` evidence, then refuted/unverified counts, then what was NOT covered, then next-step options. No per-agent narration. End with a short summary of what the work actually produced — never agent counts, token totals, or cost.

## Writing (PRs, docs, messages)
- State what changed and why in plain sentences. No filler, no hype adjectives, no restating the diff.
