# Report

Use this outline when the reader's purpose is to get brought up to date: a
status report, a sprint summary, a progress update for an audience that wasn't
in the room.

## Outline

```text
0. Audience + period     who reads this, what window it covers
1. Headline              the number or state change they care most about
2. Coverage              what the numbers do and don't include
3. User-facing changes   framed in the reader's nouns
4. Architecture / infra  only if the audience is technical
5. Not yet done          what slipped and what it blocks
6. Wrap-up               liftable verbatim into a summary slide
```

## Rules

- Section 0 is written first and never shipped. Nail down the audience and the
  period before deciding what belongs in the headline, then delete section 0
  before the document goes out — it exists only to constrain sections 1 through
  6, not to be read by anyone.
- Every number carries its baseline: `62% → 94%`, or `94% (target 90%)`.
  Requiring the arrow makes activity-phrasing — "worked on ingest" —
  structurally impossible to write. A number with no baseline is a claim with no
  evidence.
- Translate every internal noun into the reader's noun. An item that can't
  survive that translation belongs in a handoff document, not a report.
- Section 2 states what the numbers exclude. A report that only reports what
  worked is advocacy, not a report.
- Section 5 is non-droppable. A status report with zero misses isn't credible,
  and the slip list is what sets expectations for the next period.
- Detail is excluded from the document, not from the work: no commit hashes, no
  line counts, no file-level detail. Every claim still had to be verified before
  it earned a place in the headline or the bullets — the verification happened,
  it just doesn't show up on the page.
- Budget is one screen. When it runs long, cut in this order: architecture and
  infra detail first, then feature detail, then bullet count. Never cut the
  headline. Never cut section 5.
- Bullets, three to six per section. Prose is where padding hides in a status
  report.

## Anti-patterns

- Activity lists in place of outcomes.
- Unlabeled numbers — a percentage or count with no baseline attached.
- Burying the headline under context.
- Internal service or system names instead of the reader's nouns.
- Reporting effort as if it were a result.
