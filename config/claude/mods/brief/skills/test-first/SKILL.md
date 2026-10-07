---
name: test-first
description: Use when building or changing behaviour that a test can pin down — a feature, a bug fix, a refactor with a contract. Write the failing test first, make it pass, then show both runs as evidence on the brief point.
---

# Test first

A test written after the code tells you the code does what the code does. A test that failed first tells you the code does what you meant.

## The loop

1. **Name the behaviour** in one sentence. If a brief is open, it is usually a point's claim.
2. **Write the smallest test** that would fail today. Run it. Watch it fail for the reason you expect, not for a typo or an import error.
3. **Write the least code** that makes it pass. Run it again.
4. **Tidy** the code and the test while they are green. Run again.
5. **Prove it:** with a brief open, call `mcp__brief__status` on the point with `state: "done"` and the passing run as `evidence.code` (the red run as a second update when it helps the reader).

## When to bend it

- Exploratory spikes: skip the test, but say the code is a spike and do not mark the point done.
- Pure wiring, config or copy changes with no behaviour: one check that it runs is enough.
- No test harness yet: the first task is the harness. Say so in the brief instead of skipping tests silently.

## Signs it went wrong

- The test passed on its first run: it does not test the new behaviour.
- You changed the test to make it pass: you changed the requirement. Ask first.
- Several behaviours in one test: split it, so a failure names one thing.

_Adapted from obra/superpowers (MIT), test-driven-development._
