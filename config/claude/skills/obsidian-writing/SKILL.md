---
name: obsidian-writing
description: Use when writing or updating any note in the Seano Obsidian vault — normally after second-brain-obsidian has decided whether and where to write; when a note would record new knowledge (a concept, design decision, paper summary, or course note), invoke second-brain-obsidian first. Use when the user mentions Obsidian, vaults, .md notes, Canvas, Bases, callouts, wikilinks, backlinks, MOCs, or frontmatter; converts papers, transcripts, code, DDL, or RFCs into vault notes; asks "how should I capture this"; or reorganizes, splits, links, or normalizes existing notes.
---

# Obsidian writing

## Mental model

**A note is a durable artifact, not a message.** It will be re-read by someone who has lost the context that made it obvious. Optimize for re-entry, not first transmission.

**Every representation trades expressiveness against durability.** Plain text survives editor changes, plugin abandonment, and grep. A compressed JSON blob inside a plugin-specific file survives exactly as long as that plugin does.

**Structure is discovered, not imposed.** Information has a shape — sequence, hierarchy, comparison, relation, quantity, derivation. Name the shape, then pick the representation that matches. Choosing a format first and stuffing content into it produces flowcharts of things that aren't processes and tables of things that don't share dimensions.

The rule that falls out: **use the cheapest representation that captures the shape, and escalate only when the cheaper one loses information.**

## Where this fits

`second-brain-obsidian` owns the **decision**: recall, dedupe verdict, placement, and whether this is a new
note, an extension of an existing one, or a new series. **This skill takes over the moment that decision is
to write or update** — it governs the craft of the file itself.

The seam is concrete. `sb capture` takes a JSON payload — `title`, `subtitle`, `lede`, `sections[].heading`,
`sections[].body`, `tags`, `sources`. That skill renders structure, filename, and the MOC line. It does not
decide whether a section body is a wall of prose, a table, or a diagram, and it does not enforce a property
schema. That is this skill's job, and it is why captured notes read as machine output rather than as notes a
human wants to re-enter.

| Owned by `second-brain-obsidian` | Owned by this skill |
|---|---|
| Dedupe verdict, placement, folder routing | Representation choice for each section |
| Filename, next free index, the MOC line | Voice and register |
| Staging, `promote`, git mechanics | A framing sentence around every non-prose element |
| `due:` on SOTA notes it writes itself | The committed frontmatter key set and value types |

**On conflict: this skill wins on properties and representation; `second-brain-obsidian` wins on placement
and mechanics.** That is the standing instruction — conservative about structure, opinionated about properties.

## This vault

`~/vaults/Seano` — 1,364 notes. These facts are measured, not assumed. Re-run `scripts/vault_probe.py` if the vault may have changed materially, or when working in a different vault.

**Structure is settled. Properties are not.** The standing instruction is: **conservative about structure, opinionated about properties.** Match the folder scheme, ID system, naming rule, title convention, and `←`/`→` footers exactly as found. Do not reproduce the 48-key frontmatter sprawl — write only the committed key set in `references/conventions.md`, and never introduce a new spelling of an existing key.

**Capability:**

| | |
|---|---|
| Bases, Canvas | Core plugins enabled, **zero files of either exist**. Tier 3 is greenfield — usable, but nothing to match |
| Mermaid | Bundled copy only. Conservative subset; no `-beta` types. **3 notes use it** |
| Excalidraw | v2.22.1 installed. Never hand-author `.excalidraw.md` — hand the drawing back or emit `.svg` |
| Dataview | v0.5.68 installed, 2 notes. Prefer Bases for anything new |
| Tasks, Kanban, Charts | Installed; their blocks are hard dependencies |
| Links | `[[wikilinks]]`, `newLinkFormat: shortest`, `alwaysUpdateLinks: true` |
| Git | `.obsidian/` tracked, `workspace.json` correctly ignored. No workspace-churn concern here |
| iCloud vault | A **mirror** via remotely-save, ~161 notes behind. Not a second vault — never write to it |

**Representation habits — match these, they're established:**

| Representation | Notes | Verdict |
|---|---:|---|
| Tables | 806 | Dominant. Usually the right call — do not replace a working table with a diagram |
| Fenced code | 739 | Established |
| Callouts | 321 | Established |
| Display math (KaTeX) | 156 | Established |
| Mermaid | 3 | **Greenfield.** Introduce deliberately, per below |
| Embeds, footnotes, Dataview, block IDs, Bases | 0–5 | Greenfield |

**On diagrams.** The stated wish is more diagrams for concepts, and the vault has almost none — but the table-first instinct is usually correct, so this is a targeted upgrade, not a campaign:

- The existing habit is an **ASCII pipeline diagram with `->` arrows, placed before a table**. Keep that placement. Upgrade the ASCII to Mermaid only when the shape has branching, cycles, actors, or state — things ASCII genuinely can't hold.
- A linear pipeline stays ASCII. It reads fine, diffs cleanly, and needs no renderer.
- Never replace a table with a diagram. Add a diagram *before* it when the reader needs the topology before the details.
- Cap at one diagram per major section.

## The durability ladder

| Tier | Representations | Survives without Obsidian? |
|---|---|---|
| 1 | Prose, lists, tables, callouts, footnotes | Yes — any text editor, any Markdown renderer |
| 2 | Mermaid, KaTeX, fenced code, ASCII diagrams | Source is text; renders in GitHub, VS Code, Pandoc |
| 3 | `.canvas`, `.base` | Open specs, human-readable, need a compatible app |
| 4 | Excalidraw, `dataview` / `tasks` / `chart` blocks | Only with that plugin; otherwise dead text |
| 5 | Embedded PNG/PDF of a diagram | Renders anywhere, but opaque: not searchable, diffable, or editable |

When a Tier 4 or 5 artifact is unavoidable, keep a Tier 1–2 textual summary beside it so the information survives the artifact.

## Shape → representation

| Shape of the information | Use |
|---|---|
| Argument, explanation, narrative | Prose with `##` headings |
| Comparison across shared dimensions | Table — the default here, and usually right |
| Ordered steps a human follows | Numbered list |
| Linear data or request pipeline | ASCII with `->`, placed before the table |
| Branching process, decision logic | Mermaid `flowchart` |
| Time-ordered exchange between actors | Mermaid `sequenceDiagram` |
| Lifecycle, modes, valid transitions | Mermaid `stateDiagram-v2` |
| Data model, tables and relations | Mermaid `erDiagram` |
| Schedule with durations | Mermaid `gantt` |
| Aside, warning, prerequisite, provenance | Callout |
| Math, derivation, complexity | KaTeX |
| Code, config, commands | Fenced block with a language tag |
| Collection queried many ways | Frontmatter + `.base` — **only after properties are normalized** |
| Hierarchy or taxonomy | Nested list |
| A relationship between two notes | A wikilink inside a sentence |

## Decision procedure

1. **Name the shape** before writing. If it can't be named, the content isn't understood — write prose and find out.
2. **Start at Tier 1.** Prose, table, list, or callout usually captures it.
3. **Escalate only on a concrete loss.** "A table can't show that step 3 loops back to step 1" is concrete. "A diagram would look nicer" is not.
4. **Derive the filename and ID** per `references/conventions.md` — the rule differs by folder, and the next free `NN-NN` must be computed from what's already there.
5. **Write only committed frontmatter keys.** Check the key set before inventing anything.
6. **Frame every non-prose element.** One sentence before saying what to look for, one after saying what it implies.
7. **Link it in.** 12.4% of notes are orphans. A new note that nothing links to is a new orphan — add the incoming link from the folder's MOC or a `prereqs` chain in the same edit.

## Constraints that fail silently

**Mermaid lags upstream.** Too-new diagram types render as an error box while looking valid in source. Use the subset in `references/mermaid.md`.

**Excalidraw cannot be hand-authored.** `.excalidraw.md` stores compressed JSON; writing one corrupts it unrecoverably.

**Canvas is a layout format.** Every node needs explicit pixel `x`/`y`/`width`/`height`. Never a substitute for Mermaid.

**KaTeX, not LaTeX.** No `\usepackage`, TikZ, `figure`, `\label`/`\ref`. `align`, `aligned`, `cases`, `matrix` work.

**Callout syntax is exact.** `> [!note]` — lowercase, no space after `[!`, every line needs its own `>`. Unrecognized types fall back to `note` rather than erroring, so typos are invisible.

**Tables can't hold block content.** No lists, no code blocks, no paragraph breaks. `<br>` only.

**`[[README]]` is ambiguous** — 16 notes share that basename, plus `00 README` ×7, `SKILL` ×4, `00 HOME` ×3, `00 STUDY PLAN` ×3. Never link to a duplicated basename by bare name; use a path or a heading anchor.

**Relative-path wikilinks never resolve.** `[[../concurrency/05 Virtual Threads]]` is broken, not a style choice — part of 1,026 broken refs (16.3%). Never write one; fix on sight.

**A property spelled a new way is invisible.** `estimated_hours` and `hours` already split `estimated-hours` three ways because two folders were authored in different sessions. Check `references/conventions.md` before writing any key.

## Voice

Match the vault's own register — measured from finished notes, not imposed.

- **Open with a model or a stated failure, never a definition.** An organizing axis ("bifurcated along a fundamental axis") or a problem ("Why traditional network I/O doesn't scale"), then the mechanism.
- **One-line `>` blockquote abstract directly under the H1.** Established convention; keep it.
- **Alternate rhythms.** Long, clause-stacked, em-dash-heavy paragraphs punctuated by two- or three-word declaratives used as a hammer. *Processors are fast. Memory is slow.*
- **Bold the load-bearing noun**, not whole clauses.
- **Numbers concrete and unit-tagged** — `~50–100ns`, `13,358 file downloads`, `p99 4.2ms`. Never "significantly faster".
- **Adjudicate trade-offs.** State the trade, then close with a **Bottom line** or **Verdict** and a blunt imperative. A comparison that ends without a verdict is unfinished.
- **"Not X — it is Y" reframings** appear throughout. Use them where they sharpen.
- **Second person only inside a mechanism walkthrough** ("you hand it tools, it decides the plan"), never as instruction to the reader.
- **Cross-reference as `§7` or `— Section Name`.**
- **Inline provenance tags** where a claim's status matters: **[corrected]**, **[unverified]**, **[doc-stated]**.
- Terse. No hedging, no filler, no flattery, no emoji.

## Bilingual notes

175 notes contain Traditional Chinese — concentrated in `Ideas/` (82) and `Projects/` (81). Code-switching runs both directions and is correct here.

- **繁體中文 (zh-TW) only, never 簡體.** 寫得像講話，不要翻譯腔。
- **Technical terms stay English** inside Chinese prose — `saga`, `idempotency`, `backpressure`, `throughput`. Mixed-script sentences are the established pattern.
- **Domain terms stay Chinese** inside English prose — `上市`, `上櫃`, `興櫃`. Do not translate them into approximations.
- **Frontmatter values are ASCII slugs — with exactly one exception.** `tags`, `type`, `status`, `track`, `domain`, `project` are always ASCII. `title:` (and `aliases:`) may be Chinese, and often is. That is the only field where a skill assuming ASCII frontmatter breaks.
- **Quote CJK labels in Mermaid** — `A["排程器"]` — and avoid full-width punctuation (`：｜／＃`) in filenames.

## Reference files

- **`references/conventions.md`** — folder map, ID derivation, per-folder naming rules, filename-vs-H1, the committed frontmatter key set, controlled vocabularies, tag policy, linking and MOC rules, the iCloud mirror. **Read before creating or renaming any note.**
- **`references/patterns.md`** — the vault's two de facto templates and the reserved type-word variants (`Paper —`, `SOTA —`, `Math —`, `LAB —`, `PROJECT —`, `INTERVIEW —`), plus decision and spec notes.
- **`references/hygiene.md`** — the twelve measured defects, the normalization map, the order they must be fixed in, and the Bases worth building once properties are clean.
- **`references/mermaid.md`** — Obsidian-safe subset, one worked pattern per diagram type, failure modes. Read before writing any Mermaid block.
- **`references/formats.md`** — exact syntax for callouts, KaTeX, embeds, block refs, Canvas JSON, Bases YAML.
- **`scripts/vault_probe.py`** — re-probe a vault. Run when working somewhere other than `~/vaults/Seano`.

For exhaustive `.base` and JSON Canvas syntax, `kepano/obsidian-skills` is authoritative.
