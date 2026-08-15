---
name: writing-markdown-docs
description:
  Use whenever writing a standalone markdown document — research findings,
  teaching guides, status reports, decision analyses, session handoff notes, or
  debug postmortems. Covers which outline the document takes, where the file
  goes, and formatting that renders correctly in a terminal markdown viewer. Use
  this even when the user only says "write this up", "document what we found",
  "save your notes", "summarize where we are", or "make me a doc" without naming
  a format. Does not apply to README, CLAUDE.md, CONTRIBUTING, changelogs, or PR
  bodies.
---

# Writing Markdown Docs

## Medium routing

Markdown is the default for any standalone document. Write in markdown unless
the user explicitly asks for plots, charts, interactive elements, or 3D output —
those are the only reasons to switch to the `html-reports` skill instead. A
document being long, technical, or covering a lot of ground is not one of those
reasons: complexity alone never justifies leaving markdown. Markdown is the
medium for understanding — it reads in a terminal, diffs cleanly, and keeps the
reader's attention on the content instead of the presentation.

## Destination

Where the file goes depends on what the document is about, not on convenience.

Project-scoped documents — how this codebase does something, a design for this
repo, a root-cause analysis for a bug that lives here — go to `docs/` inside the
repo. If the repo already has its own docs convention (a different directory, a
subfolder scheme, a naming pattern), use that instead of imposing this skill's
default.

General documents — how something works in the abstract, methodology notes,
research on a library or technique that isn't tied to one codebase — don't get a
location invented for them. Propose a path and ask; a document with no clear
home shouldn't be silently filed somewhere the user didn't choose.

Filenames are kebab-case. The date belongs in frontmatter, not the filename — a
document renamed every time its status changes is harder to link to and harder
to grep for.

## Genre routing

One question decides the genre: what does the reader do with this document?
Route by that, not by the document's length or subject matter.

| Reader's purpose                     | Reference                |
| ------------------------------------ | ------------------------ |
| Understand something they don't yet  | `references/teaching.md` |
| Get brought up to date               | `references/report.md`   |
| Settle an open question              | `references/analysis.md` |
| Resume this work with no context     | `references/handoff.md`  |
| Understand a specific failure        | `references/rca.md`      |
| Evaluate something before it's built | `references/design.md`   |
| Execute a procedure                  | `references/runbook.md`  |
| Look something up                    | `references/lookup.md`   |

Open the matching reference before writing. If a request doesn't map cleanly
onto one row, take the closest match and add a one-line note explaining the
choice — don't block on a clarifying question for something this low-stakes.

## Frontmatter

Every document carries this four-key schema:

```yaml
---
title: descriptive title of the document
date: 2026-08-10
type: teaching | report | analysis | handoff | rca | design | runbook | lookup
status: draft | current | superseded
---
```

`type` is always one of the eight genre names — it's what lets a reader, or a
script, find every RCA or every handoff note without opening each file. `status`
follows a fixed default per genre, not an open-ended judgment call: include it
for `handoff` (each new version overwrites the last, so `current` versus
`superseded` is real information), `report` (next period's report supersedes
this one), `analysis` (decisions get revisited, and a superseded analysis that
still looks current is actively misleading), `design` (a superseded design that
still reads as current is how someone builds the wrong thing), `runbook` (a
stale procedure is worse than a missing one, because it will be followed), and
`lookup` (schemas and interfaces change, and a reference with no status can't
tell you whether it's still true). Omit it for `rca` (an incident write-up is a
historical record — it ages, it doesn't get superseded). The default for
`teaching` is also omit, with one named exception: a document that tracks
something that moves, like a library version or an evolving API, includes it.

## Governing rule

Every genre reference elaborates on this rule:

> The abstraction or headline lands first, details are gated behind it, anything
> the reader doesn't need gets cut — no internal noise, no API tour before the
> mental model.

## Render constraints

These follow from how the document actually renders, not from a style preference
— each carries its reason so it generalizes past the cases listed here.

- **Prose wraps at 80 columns, but you don't count them.** Write naturally, then
  run `prettier --write` at the end. Hand-wrapped text gets rewritten on the
  first format pass and never matches exactly, so counting columns while
  drafting is wasted effort.
- **Never break inside inline code, a URL, or a `path:line` reference.** These
  are tokens the reader copies whole; splitting one across a line break makes it
  uncopyable and unclickable in a terminal.
- **Table rows stay under roughly 100 characters of rendered width.** Column
  count is a proxy, width is the constraint — five narrow columns can fit where
  two wide ones can't. A sentence-length cell isn't table content: if a cell
  needs a full sentence, that sentence belongs in prose outside the table, not
  in a row inside it.
- **Every code fence carries a language tag**, such as `bash`, `yaml`, or `text`
  for plain illustrative examples, even when the fence is never meant to be run.
  An untagged fence renders as an undifferentiated gray block and fails
  validation — the tag is what tells both the renderer and the reader what
  they're looking at.
- **Headings stop at H3.** Deeper nesting is hard to track without a rendered
  table of contents, and the validator rejects H4 and below outright — a
  document that wants a fourth level needs a flatter outline.
- **No raw HTML outside backticks.** markview doesn't render HTML tags; a stray
  tag shows up as literal text instead of doing anything.
- **Never let a hyphenated compound split across a line break.** A soft break
  renders with a space in the middle, so `load-bearing` becomes `load- bearing`.
  Prettier cannot repair this — it sees two separate words and reports the file
  as already formatted — so the `hyphen-split` warning is the only thing that
  catches it. Reword so the compound sits away from the boundary.

## Mermaid, math, callouts, checkboxes

Four affordances beyond plain prose, each with its own discipline:

- **Mermaid, used liberally.** Mermaid fences render inline via `snacks.image`
  with the TokyoNight config at `~/.config/mermaid/`. Sequence diagrams for call
  chains, `flowchart` for control flow, `erDiagram` for schemas,
  `stateDiagram-v2` for state machines. Two constraints follow from
  rendering-as-image: keep node labels short, because one long label scales the
  whole diagram down until nothing is legible, and prefer `graph TD` over `LR`
  past roughly four nodes, since vertical suits a terminal's aspect ratio.
- **Math.** `$inline$` and `$$block$$` typeset as real images. Use for actual
  math — loss functions, complexity bounds — not for bare variable names, or you
  get an image where a word would do.
- **Callouts, semantically.** markview implements the full Obsidian set, not
  just GitHub's five. Two or three per document, or they stop being emphasis:

  | Callout         | Used for                               |
  | --------------- | -------------------------------------- |
  | `> [!TLDR]`     | The front-loaded answer                |
  | `> [!BUG]`      | Observed symptom in an RCA             |
  | `> [!QUESTION]` | Open threads, unresolved               |
  | `> [!WARNING]`  | Things that will bite the reader       |
  | `> [!CITE]`     | A source worth pulling out of the list |

  Prettier reflows a lone marker line down onto the next line's text, and in
  Obsidian syntax — which markview implements — whatever text shares the
  marker's line becomes the callout's title. Write a callout with a real body as
  two blockquote paragraphs, title then a blank quoted line then body, so
  there's nothing for the reflow to pull down:

  ```text
  > [!TLDR] Short title
  >
  > Body paragraph, which prettier wraps normally and leaves in the body.
  ```

  A genuinely one-line callout can just be written as
  `> [!NOTE] the whole thing` — the collapse only matters when a body was
  intended.

- **Checkboxes.** `- [ ]` renders as a real checkbox, so next-action lists are
  tickable in-buffer.

## Prose rules

Where a genre reference and these general rules disagree, the reference governs
— it knows its reader.

1. Every factual claim carries evidence — a URL, `file.py:42`, or the actual
   command and its output.
2. Mark confidence. Separate _verified_, _documented_, and _inferred_. Write "I
   couldn't determine X" rather than smoothing over the gap.
3. Length follows content: delete any section you'd have to pad, and let three
   paragraphs be a complete document when the answer is three paragraphs long.
4. Absolute dates, never "yesterday" or "recently" — documents are read out of
   time.

## Standing rules

Write only what you verified. A document that asserts a result, a state, or an
outcome you haven't actually confirmed is worse than one that says less — the
reader trusts it and acts on it.

Update semantics differ by genre. Handoff docs are overwritten, not appended to:
replace the file and lead with a `changed since <date>` line noting what's
different from the version being replaced, because a handoff is a snapshot for
the next session and stale detail actively misleads whoever reads it next. Every
other genre is edited in place — update the existing file rather than replacing
it, so history and unrelated sections survive the edit.

## Before you call it done

Format, then validate, then resolve everything it reports, in that order,
because each step catches what the previous one can't: fix every error, and
resolve every warning too, unless you can state why it doesn't apply here — a
legitimate `pre-` line ending, a hype word inside a quotation.

```bash
# If the repo has its own prettier config, run plain `prettier --write` and
# respect it. Otherwise:
prettier --parser markdown --prose-wrap always --print-width 80 --write PATH
python3 ~/.claude/skills/writing-markdown-docs/scripts/check_doc.py PATH
```

Prettier owns wrapping, so hand-wrapping prose while drafting is wasted effort
that gets overwritten on the first format pass anyway — write naturally and let
the tool do it. The validator then catches what prettier can't fix: table width,
fences missing a language tag, heading depth past H3, and leftover placeholder
tokens. All of these are easy to state as rules and hard to catch by eye, and
unformatted or unvalidated output is the most common way these documents fail to
render correctly.

### Mention vs. use

Naming a word is not the same as using it. The validator strips inline-code
spans before it scans a line, so a word inside backticks is quoted, not used,
and won't trip a check built to catch that word in running prose.

This is why the placeholder tokens `TBD`, `TODO`, `FIXME`, and `XXX` appear in
backticks throughout this skill, and why the hype words to avoid — `robust`,
`seamless`, `powerful`, `comprehensive`, `leverage`, `delve`, `crucial`,
`vital`, `elevate`, `unlock`, `cutting-edge`, `game-changing`, and `effortless`
— are backticked wherever this file lists them. Do the same in any document: to
talk about a placeholder marker, or to name a word you're avoiding, put it in
backticks instead of leaving it bare.
