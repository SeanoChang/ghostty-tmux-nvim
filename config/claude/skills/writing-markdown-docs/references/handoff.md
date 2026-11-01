# Handoff

Use this genre when someone must resume the work with no memory of the
conversation: a later session, another person, or the same person weeks later.
The reader has zero context, so the document replaces what they do not remember.

## Outline

```text
Changed since <date>: …    one line, only when this replaces a prior version
> [!tldr]                  the goal, and where it stands, in two sentences
1. Next actions            checkboxes, ordered, each startable on its own
2. State now               works / half-done / broken, with evidence
3. Environment             branch, exact commands, services, secret names
4. Decisions, and why      a table
5. Rejected approaches     a table: tried, why it failed
6. Open questions
```

## Rules

- **Next actions come first.** The reader opened this to start working.
- **The resumability test.** Could someone with zero context run the first next
  action within a minute, without asking anyone? If not, section 3 is missing
  something. Find it and add it.
- **Rejected approaches are non-droppable.** Without them the next session walks
  the same dead ends.
- **Half-done code shows its key diff,** per "Code changes" in SKILL.md, with
  the line where the work stopped marked.
- **Exact commands,** not descriptions:
  `uv run pytest tests/test_ingest.py -k backpressure`, not "run the
  backpressure test".
- **Name secrets, never print them.** Write `STRIPE_WEBHOOK_SECRET`.
- **Overwrite, do not append.** A handoff describes the present. Stale detail
  misleads the next reader. Keep the `Changed since` line to one line.
