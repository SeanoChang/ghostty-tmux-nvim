# Format reference

Syntax and failure modes for each representation. Organized by durability tier.

For `~/vaults/Seano` the capability facts are already recorded in `SKILL.md`; run `scripts/vault_probe.py` only when working in a different vault.

## Contents

- [Tier 1: native Markdown](#tier-1-native-markdown) — callouts, tables, links, embeds, block IDs, footnotes, comments
- [Tier 2: text-source renderers](#tier-2-text-source-renderers) — KaTeX, code blocks
- [Tier 3: open-spec files](#tier-3-open-spec-files) — Canvas, Bases
- [Tier 4: plugin-dependent](#tier-4-plugin-dependent) — Excalidraw, Dataview, other blocks
- [Accepted file types](#accepted-file-types)

---

## Tier 1: native Markdown

### Callouts

```markdown
> [!warning] Sync conflicts are silent
> Obsidian Sync resolves conflicts by last-write-wins on a per-file basis.
> Two devices editing the same note offline will lose one side's edits.
```

Syntax rules that break it:
- Type must be lowercase, inside `[!...]`, with no space after `[!`.
- **Every** line needs its own `>`. A missing `>` ends the callout; everything after becomes a plain paragraph, which looks almost right in Live Preview and wrong in Reading view.
- Title is optional. `> [!note]` alone uses the type name as the title.
- `> [!note]-` starts collapsed, `> [!note]+` starts expanded but foldable, bare `> [!note]` is not foldable.
- Callouts nest by adding `>>`, but nesting past two levels is unreadable — use a heading instead.

Native types (aliases in parentheses render identically, different icon/color per group):

`note` · `abstract` (`summary`, `tldr`) · `info` · `todo` · `tip` (`hint`, `important`) · `success` (`check`, `done`) · `question` (`help`, `faq`) · `warning` (`caution`, `attention`) · `failure` (`fail`, `missing`) · `danger` (`error`) · `bug` · `example` · `quote` (`cite`)

An unrecognized type renders as `note` rather than failing — so a typo is invisible.

**Choosing a type carries meaning.** Use `warning` for something that will bite the reader, `info` for context they may not have, `example` for a worked instance, `question` for an open problem the note hasn't resolved. Defaulting everything to `note` wastes the channel.

### Tables

```markdown
| Approach | Latency | Consistency |
|---|---|---|
| Two-phase commit | High | Strong |
| Saga | Low | Eventual |
```

- Alignment: `|:---|` left, `|:---:|` center, `|---:|` right.
- Cells hold inline content only — no lists, no fenced code, no paragraph breaks. `<br>` works for a forced line break, `` `code` `` works inline.
- A pipe inside a cell must be escaped `\|`.
- Rows do not need to align in the source. Aligning them is a courtesy to whoever edits the raw file.

If more than roughly a third of the cells would be empty or "N/A", the items don't share dimensions and this isn't a table — use a list of subsections, or a definition-style callout per item.

### Links and embeds

| Syntax | Result |
|---|---|
| `[[Note]]` | Link by note name, resolved vault-wide |
| `[[Note\|display text]]` | Link with alias |
| `[[Note#Heading]]` | Link to a section |
| `[[Note#^block-id]]` | Link to a specific block |
| `[[#Heading]]` | Link within the current note |
| `![[Note]]` | Embed the whole note inline |
| `![[Note#Heading]]` | Embed one section |
| `![[Note#^block-id]]` | Embed one block |
| `![[image.png]]` | Embed image |
| `![[image.png\|400]]` | Embed image at 400px wide |
| `![[image.png\|400x300]]` | Embed image at fixed dimensions |
| `![[doc.pdf#page=12]]` | Embed a PDF opened at a page |
| `![[Board.canvas]]` | Embed a canvas |
| `![[Projects.base]]` | Embed a base |
| `![[Projects.base#Active]]` | Embed one view of a base |

Notes:
- Links resolve by **name**, not path. Two notes named `Index.md` in different folders are ambiguous.
- Embedding a note that itself embeds the first one creates a render loop; Obsidian detects it but the output is unhelpful.
- Standard Markdown `[text](Note.md)` also works if the vault is configured for it. Match whatever the vault already uses.

### Block IDs

Append an ID to the end of a paragraph, list item, or table:

```markdown
Attention cost scales quadratically with sequence length, which is the constraint every long-context method attacks. ^quadratic-attention
```

Then reference it from anywhere: `[[Transformers#^quadratic-attention]]`.

IDs must be unique within the note and may contain letters, numbers, and hyphens. Use meaningful IDs — an auto-generated `^a3f9d1` is unreadable in the source and tells a future reader nothing.

### Footnotes

```markdown
The measured overhead was 4.2%.[^bench]

[^bench]: Measured on 8× A6000, batch size 32, averaged over 5 runs.
```

Inline form `^[note text here]` also works. Use footnotes for provenance and caveats that would interrupt the sentence — not for content the reader needs.

### Comments

`%%this is not rendered%%` — hidden in Reading view, visible in source. Useful for TODOs and drafting notes to self. Multi-line form:

```markdown
%%
Not sure this section belongs here.
Revisit after the ACSAC deadline.
%%
```

### Other inline syntax

`==highlight==` · `~~strikethrough~~` · `- [ ] task` / `- [x] done` · `> quote` · `---` horizontal rule

---

## Tier 2: text-source renderers

### KaTeX

Inline: `$O(n^2)$`. Block:

```markdown
$$
\text{Attention}(Q,K,V) = \operatorname{softmax}\!\left(\frac{QK^\top}{\sqrt{d_k}}\right)V
$$
```

Obsidian renders with **KaTeX**, which is a subset of LaTeX:

- Works: `align`, `aligned`, `array`, `cases`, `matrix`/`bmatrix`/`pmatrix`/`vmatrix`, `\text`, `\mathbb`, `\mathcal`, `\operatorname`, `\left…\right`, `\tag`, `\def`/`\newcommand`.
- Does not work: `\usepackage`, TikZ, `figure`/`table` environments, `\label` and `\ref` cross-referencing, `\includegraphics`, bibliography commands.
- Verify anything unusual against KaTeX's supported-functions list rather than assuming LaTeX parity.

Escaping traps:
- `_` and `*` inside math are safe; outside math they are Markdown emphasis.
- A literal dollar sign in prose near math can start an inline math span. Write `\$` when it's currency.
- Inside a table cell, use inline `$…$` only — `$$` blocks break the row.

An equation is a Tier 2 asset because the source is text: greppable, diffable, editable. Never paste a screenshot of an equation into a vault.

### Code blocks

Always tag the language — it drives syntax highlighting and, more importantly, tells a future reader what they're looking at:

````markdown
```go
func (s *Saga) Compensate(ctx context.Context) error {
    for i := len(s.completed) - 1; i >= 0; i-- {
        if err := s.steps[i].Undo(ctx); err != nil {
            return fmt.Errorf("compensation failed at step %d: %w", i, err)
        }
    }
    return nil
}
```
````

To show a fenced block *inside* a fenced block, use four backticks on the outer fence.

The language tag is also how plugins claim a block: ```` ```mermaid ````, ```` ```dataview ````, ```` ```base ````. An unrecognized tag renders as plain preformatted text — which is the graceful failure mode that makes Tier 2 safe.

---

## Tier 3: open-spec files

### Canvas (`.canvas`, JSON Canvas 1.0)

A canvas is a JSON object with `nodes` and `edges` arrays. There is no auto-layout — every position is explicit, in pixels, with `x` increasing right and `y` increasing **down**.

```json
{
  "nodes": [
    {
      "id": "a1b2c3d4e5f60718",
      "type": "text",
      "x": 0, "y": 0, "width": 400, "height": 180,
      "text": "# Inspection theater\n\nAgents read the manifest naming the trojan source but never open it.",
      "color": "1"
    },
    {
      "id": "b2c3d4e5f6071829",
      "type": "file",
      "x": 480, "y": 0, "width": 400, "height": 300,
      "file": "Research/Supply chain attack archetypes.md"
    },
    {
      "id": "c3d4e5f607182930",
      "type": "group",
      "x": -40, "y": -60, "width": 960, "height": 400,
      "label": "ACSAC submission"
    }
  ],
  "edges": [
    {
      "id": "e1f2g3h4i5j6k7l8",
      "fromNode": "a1b2c3d4e5f60718",
      "fromSide": "right",
      "toNode": "b2c3d4e5f6071829",
      "toSide": "left",
      "toEnd": "arrow",
      "label": "evidenced by"
    }
  ]
}
```

Node types and their required extra field:

| `type` | Extra required field | Notes |
|---|---|---|
| `text` | `text` — Markdown string | `\n` for line breaks. Wikilinks inside work |
| `file` | `file` — vault-relative path | Optional `subpath` for `#heading` or `#^block` |
| `link` | `url` | Renders a web preview |
| `group` | — | Optional `label`, `background`, `backgroundStyle` (`cover`/`ratio`/`repeat`) |

Rules:
- `id` is any unique string; 16 lowercase hex characters matches what Obsidian generates.
- Array order is z-index: earlier is further back. Put `group` nodes first so they sit behind their contents.
- `color` is `"1"`–`"6"` (theme presets) or a hex string like `"#FF6600"`. Prefer the numbers so the canvas follows the user's theme.
- Edge `fromSide`/`toSide`: `top` · `right` · `bottom` · `left`. `fromEnd`/`toEnd`: `none` · `arrow` (edges default to `toEnd: arrow`).
- Dangling edges — referencing a `fromNode` or `toNode` id that doesn't exist — do not error, they just vanish. Validate that every edge endpoint matches a node `id`.

Layout guidance when generating one: leave 60–100px gutters between nodes, align positions to multiples of 20, and size text nodes to their content (roughly 400×200 for a paragraph). A canvas with overlapping nodes is worse than no canvas.

### Bases (`.base`)

Bases is a **core** plugin: database-like table, card, and list views derived from note frontmatter. A `.base` file is YAML with up to five top-level keys: `filters`, `formulas`, `properties`, `summaries`, `views`.

```yaml
filters:
  and:
    - 'file.hasTag("paper")'
    - 'file.ext == "md"'

formulas:
  days_since_read: 'if(read_date, (today() - date(read_date)).days, "")'

properties:
  formula.days_since_read:
    displayName: "Days since read"

views:
  - type: table
    name: "To read"
    filters:
      and:
        - 'status == "unread"'
    order:
      - file.name
      - venue
      - year
    groupBy:
      property: venue
      direction: ASC
```

The essentials:
- Three property namespaces: bare or `note.x` (frontmatter), `file.x` (`name`, `basename`, `path`, `folder`, `ext`, `size`, `ctime`, `mtime`, `tags`, `links`, `backlinks`), and `formula.x` (defined in `formulas`).
- `filters` accepts a single expression string, or an object with exactly one of `and` / `or` / `not`, nestable.
- View types: `table`, `cards`, `list`, `map` (map requires the Maps plugin).
- Global `filters` and per-view `filters` are ANDed together. There is no `FROM` clause — filters *are* the dataset.
- Subtracting two dates yields a Duration, not a number. Access `.days` / `.hours` before applying `.round()`.
- Guard every formula that touches an optional property with `if(prop, …, "")`, or notes missing that property error out.
- Wrap formulas containing double quotes in single quotes.

For the full function library and more examples, `kepano/obsidian-skills` (`skills/obsidian-bases`) and `help.obsidian.md/bases/syntax` are authoritative.

**Bases versus a hand-written table:** if the rows are notes and the columns are their properties, use a Base — it stays correct as notes are added. Use a Markdown table only when the rows aren't notes, or when the comparison is a one-off argument inside a single note.

---

## Tier 4: plugin-dependent

### Excalidraw

Community plugin. Files are `.excalidraw.md` — a Markdown wrapper around Excalidraw's JSON, **compressed by default**.

**Do not generate or edit these files programmatically.** The compression means a hand-written file is almost certainly invalid, and a corrupted drawing is unrecoverable. (Users can enable "Decompress Excalidraw JSON in Markdown View" to edit by hand, but don't assume it.)

When Excalidraw is genuinely the right representation — a whiteboard being reconstructed, an annotated screenshot, hand-drawn geometry, spatial thinking that isn't a graph — say so and let the user draw it. Offer to produce an `.svg` instead if a generated artifact is needed.

Two facts worth telling users: drawings don't render in Obsidian Publish (the plugin can auto-export a PNG/SVG alongside), and the auto-export settings are also what makes drawings survive if the plugin is ever removed.

### Dataview and other plugin blocks

```` ```dataview ````, ```` ```tasks ````, ```` ```chart ```` and similar are hard dependencies on a community plugin. In a vault without it, the block renders as raw text.

For new work prefer Bases (core) over Dataview (community) where they overlap. Dataview still wins for inline fields (`key:: value` in the body rather than frontmatter) and for JS-driven views. If writing one, mention the dependency in the note.

---

## Accepted file types

Obsidian opens and embeds these natively; anything else appears in the file explorer but can't be previewed.

| Kind | Extensions |
|---|---|
| Markdown | `.md` |
| Bases | `.base` |
| Canvas | `.canvas` |
| Images | `.avif` `.bmp` `.gif` `.jpeg` `.jpg` `.png` `.svg` `.webp` |
| Audio | `.flac` `.m4a` `.mp3` `.ogg` `.wav` `.webm` `.3gp` |
| Video | `.mkv` `.mov` `.mp4` `.ogv` `.webm` |
| Documents | `.pdf` |

`.svg` being natively supported matters: a generated SVG diagram is embeddable, scalable, theme-neutral, and — unlike a PNG — still contains its text. When a diagram must be an image, make it an SVG.
