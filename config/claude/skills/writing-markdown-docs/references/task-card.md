# Task card

Use this genre to hand one task to an agent (Codex, a subagent) or to a person
who will do it without asking questions. The reader has no conversation context
and will do exactly what the card says.

## Outline

```text
> [!tldr]                  the task in one sentence, and how done is judged
1. Done when               the exact command and the output that proves it
                           (a bug: the failing test first)
2. Tier                    0, 1 or 2, from what the change touches
3. Files                   may edit ...; must not touch ...
4. Context                 what is decided, what is ruled out, the files to
                           read and the one fact they need from each
5. Constraints             what must not change; commands that are forbidden
6. Budget                  expected minutes; at twice that, stop and report
7. Steps                   only when the order matters
8. Out of scope
9. Report back             five lines: Result, Changes, Evidence, Not covered,
                           Open
```

A card for an agent is the long form of the eight-line brief in the global
rules (CLAUDE.md, Delegation): the callout is Goal, "Done when" is Done,
Constraints is Do not, and "Report back" is Return. Keep all eight; a builder
returns a card that lacks Goal, Files or Done.

## Rules

- **Done when comes first,** as a command with its expected output. An agent
  given only a goal optimises for looking finished.
- **Point at files, do not paste them.** Give `path:line` and the one fact the
  reader needs from each.
- **Name every ID.** "Rows D112–D128" means nothing to a fresh reader; "the
  retry rows in the decision log (`docs/decisions.md:112-128`)" does.
- **Constraints are explicit:** files that must not change, no new dependencies,
  no network, no commits. For an agent, always add: no questions, no agents of
  its own, and no command that needs approval; it reports those instead.
- **Report back has a fixed shape,** so the lead can check it: Result,
  Changes, Evidence (the check output), Not covered, Open.
- **At most 500 words.** A longer card is two tasks, or a plan.
