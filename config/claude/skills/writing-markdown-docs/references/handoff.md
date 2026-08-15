# Handoff

Use this genre when someone needs to resume the work with no memory of the
conversation that produced it: a session picking back up after a break, a
different person taking over, or the same person weeks later. The reader has
zero context, and every rule below follows from that one fact — the document has
to work as a complete substitute for what they don't remember.

## Outline

```text
0. Changed since <date>  one line, present only when this replaces
                        a prior version
1. Goal              one line
2. State now          works, half-done, or broken
3. Decisions made, and why
4. Rejected approaches, and why
5. Next actions        checklist, ordered, each independently startable
6. Environment         branch, exact commands, services, secrets named
7. Open questions
```

## Rules

- **The resumability test.** Before calling a draft finished, apply this test to
  it: could someone with zero context run the first next-action within a minute
  of opening the document, without asking anyone anything? If not, section 6
  (Environment) is incomplete — find the missing piece that blocks that first
  command and add it.

- **Section 4 is non-droppable.** Log every rejected approach and why it failed.
  Skip this and the next session re-walks the same dead ends that already got
  ruled out. It's the highest-value section in the document and the one most
  often left out, because the person writing it already knows why those
  approaches failed, so logging them feels redundant. It isn't redundant to the
  reader — they don't know yet.

- **Exact commands, not descriptions of commands.** Give the command the reader
  can paste and run, not a summary of what it does. "Run the backpressure test"
  is a description; `uv run pytest tests/test_ingest.py -k backpressure` is a
  command. Only the second one works without the missing context.

- **Absolute dates. Name secrets, never print their values.** Write
  `2026-07-30`, not "yesterday" or "last week" — a relative date reads
  differently depending on when the document gets opened. Refer to a secret by
  its name, such as `STRIPE_WEBHOOK_SECRET`, and let the reader retrieve the
  value themselves; never paste the value in.

- **Update semantics.** A handoff describes the present, not a history of the
  work, so a new version overwrites the old one rather than being appended to
  it. Open with one line stating what changed since the previous version, dated:
  "Changed since 2026-07-30: switched the queue backend from Redis to Postgres."
  Stale detail in a handoff doesn't sit there harmlessly — it actively misleads
  the next reader into trusting state that no longer holds.
