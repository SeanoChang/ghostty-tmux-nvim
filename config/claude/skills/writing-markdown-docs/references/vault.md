# Vault notes

Use this reference for any note in the Obsidian vault at `~/vaults/Seano`. The
main rules in `SKILL.md` still apply: answer first, terms defined, one idea per
sentence, a picture where prose would be a wall. This file adds what the vault
needs on top of them.

## Who decides what

`second-brain-obsidian` decides **whether and where** a note is written: recall,
the dedupe verdict, the folder, the next free ID, the MOC line, and the git
mechanics. This skill governs **the file itself** once that decision is made.

`sb capture` takes a JSON payload (`title`, `subtitle`, `lede`, `sections`,
`tags`, `sources`). It renders the frame. You write each section body under the
main rules and this file.

When the two sets of rules disagree, use this table.

| Topic                                | The rule that wins                         |
| ------------------------------------ | ------------------------------------------ |
| Voice, sentences, lead, structure    | `SKILL.md` Non-negotiables                 |
| Frontmatter keys and values          | `vault/conventions.md` (committed key set) |
| Filenames, IDs, H1, MOCs, link form  | `vault/conventions.md`                     |
| Line wrapping and table width        | The vault: never hard-wrap, never prettier |
| Placement, dedupe, promote, git      | `second-brain-obsidian`                    |
| Genre budgets and learn-genre checks | Not applied: a vault `type` is a note kind |

## Validate

Do not run prettier on a vault note. Obsidian soft-wraps, and a rewrap turns a
one-line edit into a whole-file diff. Check the note in vault mode instead.

```bash
python3 ~/.claude/skills/writing-markdown-docs/scripts/check_doc.py --vault PATH
```

Vault mode checks the committed frontmatter, `type` and `status` values, keys
the vault never writes, relative and ambiguous wikilinks, and `<br>` (allowed
only inside a table). It keeps every voice and reader-load check. It skips line
wrap, table width, and the callout-body rule, which exist for prettier.

Fix every error in the lines you wrote. Older notes carry many findings. Fix
those only in the section you are editing; a sweep is a separate task.

## The lead

The vault's lead is a one-line `>` blockquote under the H1. It counts as the
answer-first lead, so do not add a `> [!tldr]` as well. Keep it under 60 words,
and make it the answer or the organising idea, not a definition.

## This vault

`~/vaults/Seano` held 1,915 notes when last probed (2026-10-29). Re-run
`scripts/vault_probe.py` when the vault may have changed a lot, or when working
in another vault.

**Structure is settled. Properties are not.** Match the folder scheme, ID
system, naming rule, title convention, and `←` and `→` footers exactly as found.
Write only the committed key set in `vault/conventions.md`. Never introduce a
new spelling of an existing key.

| Capability           | State                                                  |
| -------------------- | ------------------------------------------------------ |
| Bases, Canvas        | Core plugins on; 4 canvases and 1 base so far          |
| Mermaid              | Bundled copy only; the subset in `vault/mermaid.md`    |
| Excalidraw           | Installed; never hand-write `.excalidraw.md`           |
| Dataview             | Installed, 2 notes; prefer Bases for anything new      |
| Tasks, Kanban, Chart | Installed; their blocks are hard dependencies          |
| Links                | `[[wikilinks]]`, shortest form, links update on rename |
| iCloud folder        | A read-only mirror that lags behind; never write to it |

Tables, fenced code, callouts and KaTeX math are the established forms, each in
hundreds of notes. Mermaid is rare. Add a diagram before a table when the reader
needs the topology first. Never replace a working table with a diagram. Keep a
linear pipeline as ASCII with `->`, placed before its table. Use at most one
diagram per major section.

## Durability

Every form trades power against how long it survives. Prefer the lowest tier
that keeps the information.

| Tier | Forms                                       | Survives without Obsidian?      |
| ---- | ------------------------------------------- | ------------------------------- |
| 1    | Prose, lists, tables, callouts, footnotes   | Yes, in any editor              |
| 2    | Mermaid, KaTeX, fenced code, ASCII diagrams | Source is text; renders widely  |
| 3    | `.canvas`, `.base`                          | Open formats, need a viewer     |
| 4    | Excalidraw, `dataview`, `tasks`, `chart`    | Only with that plugin           |
| 5    | An embedded PNG or PDF of a diagram         | Renders, but cannot be searched |

A Tier 4 or 5 element gets a Tier 1 or 2 text version beside it.

## Forms the vault adds

These rows extend the representation table in `SKILL.md`.

| Shape of the idea                         | Form                                        |
| ----------------------------------------- | ------------------------------------------- |
| An aside, warning, prerequisite or source | A callout                                   |
| A relationship between two notes          | A wikilink inside a sentence                |
| A collection queried many ways            | Frontmatter plus a `.base`, once keys clean |
| Hierarchy or taxonomy                     | A nested list, or a Mermaid `mindmap`       |

## Voice

The `SKILL.md` rules govern voice here too. Older notes use long sentences
stacked with dashes; do not copy that. Keep these vault habits, which fit the
main rules:

- **Concrete numbers with units:** `~50–100 ns`, `p99 4.2 ms`. Never
  "significantly faster".
- **Bold the load-bearing noun,** not a whole clause.
- **End a comparison with a verdict:** a **Bottom line** that says what to pick.
- **Mark a claim's status** where it matters: **[verified]**, **[doc-stated]**,
  **[unverified]**.
- **Cross-reference** a section as `§7` or by its name.

## Before you write

1. **Derive the filename and ID** from `vault/conventions.md`. The rule differs
   by folder. Compute the next free `NN-NN` from the notes already there.
2. **Use the template** for the note kind in `vault/patterns.md`.
3. **Write only committed keys.** Check `vault/conventions.md` before any key.
4. **Link it in.** About one note in eight is an orphan. Add the inbound link
   from the folder's MOC, or from the `prereqs` of the next note, in the same
   edit.

## Silent failures

- **Mermaid lags upstream.** A diagram type that is too new renders as an error
  box. Use the subset in `vault/mermaid.md`.
- **Excalidraw files hold compressed JSON.** Writing one by hand corrupts it.
- **Canvas is a layout format.** Every node needs pixel `x`, `y`, `width` and
  `height`. It never replaces Mermaid.
- **KaTeX is not LaTeX.** No `\usepackage`, TikZ, `figure`, `\label` or `\ref`.
  `align`, `aligned`, `cases` and `matrix` work.
- **Callout types fall back silently.** An unknown type renders as `note`, so a
  typo goes unseen. Every callout line needs its own `>`.
- **Table cells hold no block content.** No lists, code blocks or paragraph
  breaks; `<br>` is the only line break.
- **Some basenames are shared.** `README`, `00 README`, `SKILL`, `00 HOME` and
  `00 STUDY PLAN` each name several notes. A heading does not make them unique;
  use a fuller path or link to the parent MOC.
- **Relative wikilinks never resolve.** `[[../x/05 Note]]` is broken. Link by
  note name.
- **A key spelled a new way is invisible** to every query on the old spelling.

## Bilingual notes

About 175 notes contain Traditional Chinese, mostly in `Ideas/` and `Projects/`.
Code-switching runs both ways and is correct here.

- **繁體中文 (zh-TW) only, never 簡體.** 寫得像講話，不要翻譯腔。
- **Technical terms stay English** inside Chinese prose: `saga`, `idempotency`,
  `backpressure`.
- **Domain terms stay Chinese** inside English prose: `上市`, `上櫃`, `興櫃`.
- **Frontmatter values are ASCII slugs,** except `aliases`, where a Chinese
  title goes.
- **Quote CJK labels in Mermaid:** `A["排程器"]`. Keep full-width punctuation
  out of filenames.

## Reference files

- `vault/conventions.md`: folder map, IDs, naming, filename and H1, the
  committed frontmatter, vocabularies, tags, links and MOCs, the iCloud mirror.
  Read it before creating or renaming a note.
- `vault/patterns.md`: the note templates and the type-word variants (`Paper`,
  `SOTA`, `Math`, `LAB`, `PROJECT`, `INTERVIEW`).
- `vault/hygiene.md`: the measured defects and the order to fix them in.
- `vault/mermaid.md`: the Mermaid subset that renders, with one pattern per
  diagram type.
- `vault/formats.md`: exact syntax for callouts, KaTeX, embeds, block
  references, Canvas and Bases.
- `scripts/vault_probe.py`: re-measure a vault.
