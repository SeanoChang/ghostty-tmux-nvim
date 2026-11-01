# Task card

Use this genre to hand one task to an agent (Codex, a subagent) or to a person
who will do it without asking questions. The reader has no conversation context
and will do exactly what the card says.

## Outline

```text
> [!tldr]                  the task in one sentence, and how done is judged
1. Done when               the command or observation that proves it
2. Context                 the files to read, and the one fact they need
3. Constraints             what must not change; commands that are forbidden
4. Steps                   only when the order matters
5. Out of scope
6. Report back             what to return: diff, output, open questions
```

## Rules

- **Done when comes first,** as a command with its expected output. An agent
  given only a goal optimises for looking finished.
- **Point at files, do not paste them.** Give `path:line` and the one fact the
  reader needs from each.
- **Name every ID.** "Rows D112–D128" means nothing to a fresh reader; "the
  retry rows in the decision log (`docs/decisions.md:112-128`)" does.
- **Constraints are explicit:** files that must not change, no new dependencies,
  no network, no commits.
- **At most 500 words.** A longer card is two tasks, or a plan.
