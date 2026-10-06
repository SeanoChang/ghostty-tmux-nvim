---
name: debugging
description: Use when a bug, a failing test or unexpected behaviour needs a fix. Reproduce it end to end first, find the root cause with evidence, then fix — and lay the diagnosis out in the Brief pane when it has more than one moving part.
---

# Debugging

Fixes that come before the cause is known tend to move the bug, not remove it.

## 1. Reproduce, as the user sees it

Run the real path — the CLI, the request, the page — as close to the user's runtime as you can. A unit test alone is not a reproduction. Write down the exact command and the exact wrong output. If you cannot reproduce it, say so and ask for what is missing; do not fix blind.

## 2. Find the cause

- Read the whole error and the stack. Check what changed recently (`git log`, the diff, dependency bumps).
- Trace the bad value back to where it first goes wrong. Instrument the boundary between components when the bug crosses one.
- Find a working case nearby and list every difference.
- State one hypothesis: "X is the cause because Y". Test it with the smallest change that could prove it wrong.

With a brief open and more than one candidate cause, show each hypothesis as a point with its evidence (`detail`, `code`, or a figure), and let the reader see which ones fell.

## 3. Fix

Write a failing test that captures the bug (see the test-first skill), fix the cause, run the reproduction again, and attach the before and after runs as evidence with `mcp__brief__status`.

## When fixes keep failing

After two fixes that did not hold, stop patching. Restate what is known, question the diagnosis, and look for a wrong assumption or an architectural cause before a third attempt.

_Adapted from obra/superpowers (MIT), systematic-debugging._
