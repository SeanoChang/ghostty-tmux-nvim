# Runbook

This genre applies when the reader's job is to execute a procedure. They want to
do the thing, not understand it, and they may be doing it under pressure at an
inconvenient hour.

## Outline

```text
1. When to run this        the trigger, and when NOT to
2. Preconditions           what must be true, and how to check each
3. Steps                   numbered; each an exact command plus expected output
4. Verification            how you know it worked
5. Rollback                how to undo, and the point of no return
6. When it goes wrong      known failure modes and what to do about each
```

## Rules

- Every step is a command that can be run exactly as written, never a
  description of one. A step the operator has to interpret gets done differently
  every time.
- Every step states what it should produce, so the operator knows whether to
  continue or stop. A step with no expected output can't be checked partway
  through — only at the end, where finding out it went wrong costs the most.
- **Section 5 is non-droppable, and it must name the point of no return** — the
  step after which rollback stops working. An operator who doesn't know where
  that line is will cross it without deciding to.
- Write for someone executing this under pressure. Prose the reader has to parse
  before acting is a defect here, even where it would be fine in other genres.
- Use absolute values, never relative ones: name the host, the environment, the
  version. "The current cluster" means something different next quarter, and by
  then this is still the document someone is following.
