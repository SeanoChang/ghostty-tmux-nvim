---
name: review
description: Use when reviewing a change, a plan or a design before it is accepted — your own work at a milestone, or someone else's. Findings go onto the brief point they concern, and each one is checked by a fresh reviewer before it reaches the user.
---

# Review

## What to look at

- **Correctness first:** does the change do what its brief point claims? Read the diff against the claim, not in isolation.
- **What it breaks:** callers, edge cases, error paths, concurrency, data written to disk or a database.
- **What it misses:** a requirement in the brief with no code, a decision answered one way but built the other.
- Skip style and taste unless the user asked for them.

## How to report

- With a brief open, put each finding on the point it concerns with `mcp__brief__note`: the claim, `file:line`, and the concrete failure ("given X, it does Y").
- Before a finding reaches the user, have a reviewer in fresh context, on a model at least as strong as the finder, try to refute it. Report what survives first; list refuted and unverified counts after.
- Say what the review did not cover.

## Asking for a review

Give the reviewer the brief (or its points), the diff range, and what "correct" means here. Ask for findings with evidence, ranked by severity, not a summary.

_Adapted from obra/superpowers (MIT), requesting-code-review and receiving-code-review._
