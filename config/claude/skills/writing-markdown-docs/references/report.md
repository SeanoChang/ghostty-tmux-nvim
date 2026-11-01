# Report

Use this genre to bring the reader up to date: a status report, a summary of a
run, or an incident report on something that broke. The budget is one screen.

## Status outline

```text
> [!tldr]                  the number or state change that matters most
1. What changed for you    in the reader's nouns, each with its baseline
2. Not done yet            what slipped, and what it blocks
3. Coverage                what the numbers include and leave out
4. Next                    checkboxes
```

## Incident outline

Use this for a specific failure. It replaces the old `rca` genre.

```text
> [!bug] Symptom           the verbatim error, and when it started
> [!tldr]                  the cause in one sentence, and whether it is fixed
1. Reproduction            exact commands and their real output
2. Root cause              the mechanism, at path:line
3. Fix                     the key diff
4. Verification            the command and its real output
5. Prevention              the test or guard that now runs
6. Dead ends               what was ruled out, and how
```

## Rules

- **Every number carries its baseline:** `62% → 94%`, or `94% (target 90%)`. A
  number with no baseline is a claim with no evidence.
- **Translate every internal noun into the reader's noun.** An item that cannot
  survive the translation belongs in a handoff.
- **"Not done yet" is non-droppable.** A report with no misses is not credible.
- **Coverage comes after the headline.** Say what the numbers leave out, but not
  before the reader knows what they are.
- **Bullets, three to six per section.** Prose is where padding hides.
- **Incident: no root cause without a reproduction** that shows real output. If
  it could not be reproduced, label the cause _hypothesized_ and say what would
  confirm it. Verification pastes real output. Prevention names a guard that
  already exists and runs. Dead ends stay in, so the next reader does not walk
  them again.
