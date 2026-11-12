---
name: writing-markdown-docs
description: >-
  Use whenever writing a standalone markdown document or a note in the Obsidian
  vault, even when the user only says "write this up", "document what we found",
  "save your notes", "summarize where we are", "explain X in a doc" or "make me
  a doc". Covers a learning doc, a design, an implementation plan, a task card
  for an agent, a status or incident report, a decision analysis, a handoff, a
  runbook and a reference. Covers every note in the Obsidian vault too: writing,
  updating, splitting or normalising notes, frontmatter, wikilinks, MOCs,
  callouts, Canvas or Bases, after second-brain-obsidian has decided whether and
  where to write. Sets the genre and outline, readable prose (answer first,
  terms defined, one idea per sentence, a picture where prose would be a wall),
  where the file goes, and one dialect that renders the same in the terminal
  (markview) and in Obsidian. Interactive pages, simulations, 3D and prototypes
  go to visual-artifacts. Does not apply to README, CLAUDE.md, CONTRIBUTING,
  changelogs or PR bodies.
---

# Writing Markdown Docs

A document is read by someone who was not there. Every rule here serves that
reader: they get the answer first, they never meet an undefined term, and they
see a picture where prose would be a wall.

## Non-negotiables

1. **Answer first.** Open with a `> [!tldr]` of at most 60 words, or an opening
   paragraph of at most three sentences. Nothing comes before it except a
   one-line `Changed since <date>:` in a handoff. Method, sources and caveats go
   after the answer (`lead-long`, `lead-late`).
2. **Write to the reader.** Say "you", not "the user" or "the owner". Leave out
   the story of how the work was done (agents, panels, rounds) unless the reader
   asked for it (`reader-third`).
3. **Define every term and ID once,** in the reader's words, where it first
   appears. Prefer a name to an ID: "the retry fix", not "D128". A project's own
   numbering pairs with a name on first use: "L0 normalize" (`undefined-id`).
4. **One idea per sentence.** Write about 60% of the way to ASD-STE100: active
   voice and plain words. Aim for 15 to 20 words a sentence, never over 30. An
   aside gets a sentence of its own (`prose-long`, `paren-dense`, `dash-dense`).
5. **Pick a representation for each idea** from the table below. A section of
   more than about 250 words with no table, diagram, math or image is a wall
   (`no-visual`).
6. **Fit the genre's budget, and cut.** The budget counts what the reader reads:
   prose and tables. Every sentence must change what the reader knows or does;
   cut the rest. A rewrite comes out shorter than its source (`too-long`).
7. **Teach with an example first.** A learn doc opens with one worked example
   with real numbers, then builds the parts on it, and checks the reader after
   each part (`example-late`, `no-check`).
8. **Write only what you verified.** A caveat sits next to the claim it limits,
   never in front of the answer.

## Markdown or an HTML page

Markdown is the default for documents that live beside the work or in the vault.
They read in a terminal and in Obsidian, diff cleanly, and stay greppable. This
includes learning docs: the learn genre teaches in markdown with Mermaid,
tables, step-by-step math and rendered diagrams.

A learning request that names no medium goes to `visual-artifacts`; "a doc",
"markdown", "notes", a file in the repo or a vault note comes here. Switch to
`visual-artifacts` also when the idea needs interaction: a simulation, a slider,
a step-through animation, 3D, a prototype to click, or a Plan page with linked
tasks. Being long or technical is not, on its own, a reason to leave markdown.

## Vault notes

A note in the Obsidian vault is markdown too. `second-brain-obsidian` decides
whether and where it goes. Then read `references/vault.md` before writing: it
sets the vault's frontmatter, filenames, links and lead, and says which rule
wins when the vault and this file disagree. In short, this file wins on voice
and structure; the vault wins on properties, names, links and wrapping. Never
run prettier on a vault note; validate with `check_doc.py --vault`.

## Genres

One question decides the genre: what does the reader do with this document?

| The reader wants to              | Genre       | Reference                 | Budget |
| -------------------------------- | ----------- | ------------------------- | ------ |
| Understand something new         | `learn`     | `references/learn.md`     | 3,500  |
| Decide whether to build a design | `design`    | `references/design.md`    | 2,500  |
| Build it, task by task           | `plan`      | `references/plan.md`      | 3,000  |
| Hand one task to an agent        | `task-card` | `references/task-card.md` | 500    |
| Catch up, or learn what broke    | `report`    | `references/report.md`    | 450    |
| Settle an open question          | `analysis`  | `references/analysis.md`  | 1,500  |
| Resume this work with no context | `handoff`   | `references/handoff.md`   | 700    |
| Run a procedure                  | `runbook`   | `references/runbook.md`   | 900    |
| Look something up                | `lookup`    | `references/lookup.md`    | none   |

Budgets count words of prose and tables. Code, diagrams and math are free, and
so are a learn doc's checks and rubrics. Open the matching reference before
writing. If a request fits no row, take the closest and say why in one line. A
doc that mixes genres takes the genre of its main purpose: a design with one
embedded choice stays a design, with the choice in its Decisions section.

## Frontmatter

```yaml
---
title: what the document answers, in plain words
date: 2026-10-27
type:
  learn | design | plan | task-card | report | analysis | handoff | runbook |
  lookup
status: draft | current | superseded
---
```

`status` is required for every genre except `learn`. A learn doc about something
that moves, like a library version, carries it too. The old types `teaching` and
`rca` still pass with a `legacy-type` warning; use `learn` and `report`.

## Destination

Project documents go to `docs/` in the repo, or to the repo's own docs
convention when it has one. General documents get no invented home: propose a
path and ask. Outside the vault, filenames are kebab-case, and the date lives in
frontmatter, not the filename. Vault notes go where `second-brain-obsidian`
places them, and keep the vault's own names (`NN-NN Topic — Subtitle.md`) from
`references/vault/conventions.md`.

## Pick the representation

Name the shape of each idea first, then choose its form. Start with the cheapest
form that keeps the information, and move up only when it loses something.

| Shape of the idea                   | Form                                                    |
| ----------------------------------- | ------------------------------------------------------- |
| A linear pipeline                   | ASCII with `->`, before the table that details it       |
| Comparison across shared dimensions | Table, rows under about 100 characters                  |
| Branching, a loop, actors over time | Mermaid `flowchart`, `sequenceDiagram`                  |
| Lifecycle, modes, valid transitions | Mermaid `stateDiagram-v2`                               |
| Data model                          | Mermaid `erDiagram`                                     |
| Layout too big for Mermaid          | A d2 diagram rendered to PNG, with a text alternative   |
| A derivation or an estimate         | Numbered steps, one sentence and one `$$` line each     |
| A data series                       | A matplotlib PNG, axes labelled, plus the key numbers   |
| Code, config, commands              | A fenced block with a language tag, 30 lines at most    |
| Hierarchy or taxonomy               | A nested list, or a Mermaid `mindmap` in the vault only |

After a table or diagram whose point is not obvious from its heading, add one
line that starts **What to notice:**. Do not restate what it shows.

## Dialect: one source for markview and Obsidian

Write only what renders the same in both.

- **Callouts are lowercase:** `> [!tldr]`, `[!note]`, `[!warning]`,
  `[!question]`, `[!success]`, `[!bug]`, `[!cite]`, `[!abstract]`. A trailing
  `-` folds the callout: `> [!success]- Answer`. Put a short title on the marker
  line, then a blank `>` line, then the body, so prettier cannot pull the body
  into the title (`callout-case`, `callout-collapsed`).
- **Mermaid** stays in the subset both draw: `flowchart`/`graph`,
  `sequenceDiagram`, `stateDiagram-v2`, `erDiagram`, `gantt`. Keep node labels
  short, and use `TD` past about four nodes. Quote labels with CJK or
  punctuation: `A["排程器"]`. A semicolon inside a `sequenceDiagram` message
  ends the statement; leave it out.
- **Math:** `$…$` inline and `$$…$$` on their own lines. Use it for real math,
  not for a variable name in prose.
- **Images:** `![what to notice](assets/name.png)`, a relative path. Render d2
  with `d2png file.d2` or
  `d2 --pad 24 in.d2 out.svg && rsvg-convert -w 900 out.svg -o out.png`, never
  ImageMagick (it drops SVG text). Under every image, add
  `> [!abstract]- Diagram as text` with its content as a table or list, so it
  survives search and a missing file.
- **Links:** `[text](path)` in repos; `[[wikilinks]]` in vault notes.
- **Never:** raw HTML, headings past H3, an untagged code fence, a colour that
  carries meaning alone (the reader is red–green colour-blind).

## Render constraints

- Prose wraps at 80 columns: write naturally, then run prettier.
- Never break inside inline code, a URL, or a `path:line` reference.
- Table rows stay under about 100 characters. A cell that needs a sentence
  belongs in prose.
- Never let a hyphenated compound split across a line break: it renders with a
  space (`hyphen-split`). Prettier cannot repair this; reword instead.
- Checkboxes `- [ ]` render as real checkboxes; use them for next actions.

## Code changes

When a document describes a change to code, show the key sections, not whole
files and not prose alone.

- At most 30 lines per change, one to three sections: the hunk that changes
  behaviour, the core of a new function, or the failing test that proves it.
- Name the file above the fence: `path:line` for code that exists, "sketch" for
  code that does not.
- Diffs use a `diff` fence and keep their `@@` headers. The `+` and `-` signs
  carry the change, so it survives any colour scheme.
- Notes go right under the fence, keyed by line:
  `- Line 30: after auth, so the key is known.`
- Show each piece of code once, and point to it from elsewhere.

## Evidence and dates

Every factual claim carries evidence: a URL, `file.py:42`, or the command and
its real output. Mark what is _verified_, _documented_ and _inferred_. Name a
gap instead of smoothing over it: "Not measured: the resync time under load." A
rewrite keeps the source's evidence and marks the rest "per the source". Use
absolute dates.

Handoffs are overwritten, with a `Changed since <date>:` line. Every other genre
is edited in place.

## Before you call it done

Format, validate, then resolve everything it reports. Fix every error. Resolve
every warning, unless you can say why it does not apply here.

```bash
# Use the repo's own prettier config when it has one. Otherwise:
prettier --parser markdown --prose-wrap always --print-width 80 --write PATH
python3 ~/.claude/skills/writing-markdown-docs/scripts/check_doc.py PATH
# A vault note: no prettier, and the vault's own rules.
python3 ~/.claude/skills/writing-markdown-docs/scripts/check_doc.py --vault PATH
```

The validator checks two things. Rendering: wrap, table width, fence tags,
heading depth, raw HTML, placeholders and callout form. Reader load: the lead,
opaque IDs, third person, long sentences, dense asides, walls of prose and the
genre budget. For learn docs it also checks the worked example, the checks,
folded answers and option lengths. Then read the first screen as the reader
would: does it give the answer, in their words, before anything else?

Words inside backticks are quoted, not used, so the validator skips them. That
is how this file can name `TODO` or `leverage` without tripping its own checks.
