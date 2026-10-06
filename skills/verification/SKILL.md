---
name: verification
description: Use before saying work is done, fixed, passing or ready — and before marking a brief point done. Done means demonstrated: run the check, read its output, and attach it as evidence.
---

# Verification

"It should work" is a prediction. Done is a demonstration.

## Before any claim of success

1. **Name the check** that proves the claim: the test command, the build, the request, the screenshot.
2. **Run it fresh,** in full. Not a cached result, not a run from before the last edit.
3. **Read the output** — the exit code, the count of failures, the actual response.
4. **Say what it shows,** with the output. If it falls short, say that, with the output.

## In the Brief pane

- Mark a point `done` with `mcp__brief__status` only with `evidence` attached: the passing run as `code`, a diff, or a figure (`image`).
- A subagent finishing is not evidence. A point it worked on sits at `review` until you have checked the result yourself.
- When a check fails, mark the point `failed` with the output, rather than leaving it `running`.

## Claims that need their own check

- Tests pass → the test run, with its counts.
- A bug is fixed → the original reproduction, now right.
- A build works → the build exiting 0.
- Requirements met → each one, ticked against the brief, with what proves it.

_Adapted from obra/superpowers (MIT), verification-before-completion._
