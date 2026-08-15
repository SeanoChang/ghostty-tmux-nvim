# Design

This genre applies when the reader's job is to evaluate something before it gets
built: a proposal, an architecture document, a design for a system that does not
exist yet. If the system already exists and the reader needs to understand how
it works, that's a teaching document, not this one.

## Outline

```text
1. Problem and constraints    including non-goals
2. Proposed design            one paragraph, then a component diagram
3. Components                 each: responsibility / interface / dependencies
4. Data flow                  the primary path, end to end
5. Decisions and trade-offs   with the alternatives rejected and why
6. Failure modes              what breaks, what happens, how it recovers
7. Testing strategy
8. Rollout or migration       only when replacing something that exists
```

## Rules

- Every component answers three questions: what it does, how it is used, and
  what it depends on. If any of the three can't be answered, the boundary is
  wrong — that's a finding about the design, not a gap in the document.
- Non-goals do more work than goals. They are what stops scope creep once the
  document is approved, so state them in section 1 instead of leaving them
  implied by omission.
- **Section 5 is non-droppable.** A design that lists no rejected alternatives
  presents its decision as an inevitability, and the reader has no way to tell
  whether the alternatives were considered or never occurred to anyone.
- **Section 6 is non-droppable.** A design that shows only the happy path hides
  where the cost actually lives; the unhappy path is where a reviewer finds the
  objections that matter.
- This genre is for a system that does not exist yet. Write for a reader
  deciding whether to build it — a reader who needs to understand something that
  already runs wants a teaching document instead.
