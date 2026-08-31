# Note patterns

The vault has **no templates folder** — `.obsidian/templates.json` does not exist and the core Templates plugin is unconfigured. The templates below were reconstructed from the two largest exact frontmatter-plus-heading signatures (265 and 219 notes, together 484 of the 1,049 notes with frontmatter). They are the real convention.

Frontmatter shown here is already normalized to the committed key set in `references/conventions.md` — it is **not** verbatim what older notes carry.

## Contents

- [Template A — study note](#template-a--study-note) — the default
- [Scaffolds](#scaffolds) — and why not to create more
- [Type-word variants](#type-word-variants) — Paper, SOTA, Math, LAB, PROJECT, INTERVIEW
- [MOC](#moc)
- [Decision note](#decision-note)
- [Spec note](#spec-note)

---

## Template A — study note

The default shape for any curriculum note. 265 notes match its signature; the `Prerequisites`/`Next` footer recurs in 133 and the `←`/`→` nav in 400.

````markdown
---
tags: [<topic>, <topic>, <course-code>]
type: note
track: [A]
difficulty: intermediate
domain: <domain>
course: [ECE-437, ECE-565]
prereqs: ["[[<prior note>]]"]
estimated-hours: 3
status: draft
---

# <Title — Subtitle>

> <one-line framing abstract>

## <Concept section 1>
### <sub-heading>

## <Concept section 2>

## <Concept section 3>

---

## System-Level Thinking

---

## Practice Problems (5)

---

## Prerequisites
← [[<prior note>]]

## Next
→ [[<next note>]]
````

**`## System-Level Thinking` is the section that carries the most value and is most often left thin.** It is where the mechanism gets connected to a real system under real constraints — the part that can't be reconstructed from a textbook. Write it before padding the concept sections.

Open the first concept section with a model or a stated failure, never a definition. See the Voice section in `SKILL.md`.

## Scaffolds

Template B is Template A minus `course`, with the body never filled:

```markdown
# <Title — Subtitle>

> <one-line framing callout>

<!-- Content to be generated -->

---

← [[<prior note>]]
→ [[<next note>]]
```

**143 notes — 10.5% of the vault — carry that marker.** They clear both stub thresholds (enough words, has links), so they are invisible to a stub count while being the actual unwritten backlog, eight times larger than the 18 true stubs.

**Do not create more of them.** When asked to plan a curriculum section, produce the MOC with the planned note titles listed as text, not 20 empty files. A planned title in a MOC costs nothing; an empty note pollutes search, inflates counts, and creates a broken forward link.

When asked to fill one, replace the marker entirely — never leave it alongside new content, or the backlog count stops being trustworthy.

## Type-word variants

Each reserved type-word in the filename maps to a `type:` value and a body shape. Everything else follows Template A.

### `Paper —`

`M1-08 Paper — RAG for Knowledge-Intensive NLP Tasks (Lewis et al. 2020).md`, `type: paper`

```markdown
## Claim
What this asserts that wasn't known before. One sentence.

## Method
How they establish it, in enough detail to judge whether it holds.

## Evidence
The numbers that matter — a table.

## Limits
Where it doesn't apply. Threats to validity the authors downplayed.

## Why it matters here
Connection to the track. Links out.
```

Keep `## Claim` and `## Why it matters here` strictly separate. Merging what the paper says with what you think about it makes the summary untrustworthy later.

### `SOTA —`

`α2-05a SOTA — SDK Comparison: Claude Agent SDK vs OpenAI Agents SDK vs LangGraph.md`, `type: sota`

A landscape survey. Almost always a suffixed side-note (`-05a`) hanging off the concept note it elaborates.

```markdown
## <N> — The <year> Landscape
The organizing axis. What the space has bifurcated along.

## Contenders
One `###` each: what it bets on, what it costs.

## Comparison
A table across shared dimensions.

## Bottom line
The verdict, plus a blunt imperative. Never end a comparison without one.
```

The axis paragraph is the point. A SOTA note that lists options without naming the axis they differ on is a link dump.

### `Math —`

`β1-04 Math — FLOPS Calculation, Bandwidth Utilization, Optimal Tile Size Derivation.md`, `type: math`

```markdown
## Setup
Symbols and units, defined once.

## Derivation
KaTeX display blocks with prose between steps. Never a wall of equations.

## Result
$$ ... $$

## Sanity check
Plug in real numbers with units. The step that catches sign and unit errors.

## Where it breaks
The regime where the assumption fails.
```

`## Sanity check` is the section that distinguishes a usable derivation from a copied one.

### `LAB —` and `PROJECT —`

`type: lab` / `type: project`. Hands-on work.

```markdown
## Goal
What works at the end, stated as an observable.

## Setup
Environment, versions, hardware. Fenced blocks.

## Steps
Numbered. Commands in fenced blocks with the language tagged.

## Verification
How you know it worked. Expected output.

## Gotchas
> [!warning]
> What bit, and why it wasn't obvious.
```

`## Gotchas` is the reason the note exists a year later. Write it while it still hurts.

### `INTERVIEW —`

`type: interview`. Prep material.

```markdown
## The question
As actually asked.

## The answer
Structured for speaking aloud, not reading.

## Follow-ups
What they ask next, and the answer to each.

## What they're testing
The signal behind the question.
```

## MOC

One per topic folder: `NN-00 MOC — Topic.md`, `type: moc`, `tags: [MOC, …]`. H1 keeps a shortened ID: `# 04 — Distributed Systems Fundamentals`.

```markdown
# NN — <Topic>

> <one line on what this folder covers and in what order>

## Order
1. [[NN-01 …]] — one clause on why it's first
2. [[NN-02 …]] — …

## Side notes
- [[NN-03a Paper — …]] — hangs off NN-03
- [[NN-05a SOTA — …]] — …

## Planned
- Topic — subtitle
- Topic — subtitle
```

**Annotated, not enumerated.** Each link gets a clause saying why it's there; the ordering is the contribution. A bare bullet list of links is worse than search.

**`## Planned` holds unwritten notes as plain text, not wikilinks.** This is how a curriculum gets planned without creating 20 scaffolds or 20 broken forward links.

Once properties are normalized, the `## Order` list can be replaced by an embedded Base filtered on folder — see `references/hygiene.md`. Keep `## Planned` hand-written either way.

## Decision note

For a technical choice with alternatives. Lives in `Projects/<Project>/` as `Technical Decisions.md` or a dated spec.

```markdown
## D<NN> — <Decision, imperative>

**Context.** The constraint that forced a choice — load, latency budget, compliance,
existing infrastructure. Specific enough that a reader can tell whether it still holds.

**Options.**

| Option | Buys | Costs |
|---|---|---|

**Decision.** The trade, stated as a trade, then adjudicated.

**Consequences.** What is now true that wasn't — including the new failure modes.

> [!warning] Reversal cost
> What undoing this in six months would take.
```

The `D<NN>` numbering is established in `Projects/Taiwan Stock Monitor/01 Data Pipeline/Technical Decisions.md` — continue it rather than starting fresh. Rejected options are the only part that can't be reconstructed from the code later, so never cut that table.

## Spec note

`Projects/<Project>/Specs/YYYY-MM-DD-<slug>.md`, `type: spec`, ISO-date prefix.

Follows the source-research shape already in the vault, including its provenance discipline:

```markdown
# <Title>

Researched <date> (<conditions that limit what could be measured>).
Raw record: `raw/<file>.json`.

> **Adversarial verification pass, <date>.** Every load-bearing number below was
> re-checked against primary sources. Corrections marked **[corrected]**; things that
> still cannot be confirmed tagged **[unverified]**. Full ledger in §N.
```

That verification-pass blockquote is a real convention and worth keeping — it is what makes an old spec trustworthy. Tag claims inline as **[corrected]**, **[unverified]**, **[doc-stated]** rather than silently fixing them.
