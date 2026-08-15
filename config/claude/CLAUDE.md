# Global rules — Sean (SWE · DevOps · ML)

## Decision-making
- When choosing between designs, don't overweight development cost. You build far faster than a human — never pick the lower-quality option because the better one "would take weeks."
- Bug fixes start with reproduction: reproduce end-to-end, as close to the real user/runtime experience as possible, before changing code. A unit test alone is not a reproduction.
- Done means demonstrated. Show the passing test output, build log, or actual command run. Never claim success without evidence.
- After two failed attempts at the same fix, stop patching: restate what's known, question the diagnosis, re-approach cleanly.

## Never (suggest the exact command for me instead)
- Never run mutating infra commands: `terraform|tofu apply/destroy`, `kubectl apply/delete`, `helm upgrade/uninstall`, or `aws`/`gcloud` create/update/delete. Run plan/dry-run, then hand me the command.
- Never print secret values: no `kubectl get secret -o yaml|json`, no dumping `.env` contents, no echoing tokens or keys.
- Never force-push or delete branches.

## Ask first
- Database migrations or resets.
- Submitting GPU/training jobs — show estimated cost, hardware, and duration first.
- Installing global tools or editing shell/system config files.

## Tooling
- Match the project's existing package/env manager (look for uv.lock, poetry.lock, environment.yml, pnpm-lock.yaml, etc.). Never introduce a different one.
- Prefer CLIs over MCP servers for the same job (`gh`, `aws`, `gcloud`) — fewer tokens, lower latency.
- Watching CI: use `gh run watch`. Never hand-write polling loops around `gh run view`.

## Writing (PRs, docs, messages)
- State what changed and why in plain sentences. No filler, no hype adjectives, no restating the diff.
