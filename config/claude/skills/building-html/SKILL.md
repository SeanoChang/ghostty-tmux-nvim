---
name: building-html
description:
  Use whenever building a standalone HTML page — a report whose payload is
  charts or plots, or an interactive tool the reader operates. Covers page
  composition, the three built-in themes, self-contained output, and which parts
  of artifact-design and dataviz to follow or skip. Use this even when the
  request only says "design an HTML", "make me a page", "build an interactive
  breakdown", "visualize this", or "a step-by-step walkthrough of X", and
  whenever a request asks for plots, charts, 3D, or something clickable. Applies
  whether the page is published as an Artifact or written as a local file, and
  applies even if artifact-design has already loaded. Does not apply to markdown
  documents — those go to writing-markdown-docs.
---

# Building HTML

## If artifact-design is already loaded

Expected, not a conflict. `artifact-design` is a delegate of this skill, and the
`Artifact` tool loads it before every publish. Nothing needs undoing —
resolution picks up at mode selection below, and the sibling overrides later in
this file say which of its defaults to skip.

## Trigger and boundary

Markdown is the default medium for a standalone document, and
`writing-markdown-docs` owns it. Come here when the request asks for plots,
charts, interactive output, or 3D, or when markdown demonstrably gives out — a
comparison too wide to read in a terminal.

Length, technical depth, and breadth are not reasons. Complexity alone never
justifies leaving markdown.

## Resolve four things

Every request resolves to a mode, a genre, a target, and a theme. Take the
closest match and say so in one line rather than asking; none of these is worth
blocking on.

## Mode

- **`document`** — the reader reads, and the visuals answer questions the prose
  poses. Open `references/document.md`.
- **`explorable`** — the reader operates the page, and the mechanism is the
  content. Open `references/explorable.md`.

Open the matching reference before writing. Mode is orthogonal to genre: a CPU
decomposition is `teaching` plus explorable; an interactive comparison matrix is
`analysis` plus explorable.

## Genre

Four genres have an HTML profile. Structure still comes from the genre reference
under `~/.claude/skills/writing-markdown-docs/references/` — open it and follow
it. This skill changes what a section can contain, never what sections exist.

- `teaching` — a mechanism explained, often the explorable case.
- `report` — a status or experiment write-up carrying real metrics.
- `analysis` — an open question settled, where the evidence is comparative.
- `design` — a proposal whose architecture wants a real diagram.

The other four stay in markdown. `handoff` is read by a future agent that needs
to grep and diff it, and `runbook` is executed under pressure beside a terminal
— HTML makes both worse. For `rca` and `lookup` markdown is the default too,
with a real exception each: a flame graph, or a table no terminal can render.

## Target

An **Artifact** when the page is going to other people or wants a link. A
**local file** when it belongs beside the work — then the destination follows
the markdown rule: project-scoped goes to the repo's `docs/`, general gets a
proposed path and a question.

## Theme

- **`apple`** — the default. Document-mode pages, anything going to other
  people, anything that will be read in daylight. Opens light.
- **`tokyonight`** — when the page sits beside terminal work or embeds mermaid
  rendered with the config at `~/.config/mermaid/`. Opens dark.
- **`ghostty`** — when maximum restraint is wanted. Opens dark.

Inline `assets/base.css` first, then `assets/themes/<name>.css`. Both go in one
`<style>` block. `base.css` holds structure and defines no colour; the theme
file holds tokens and defines no structure. Do not restate sizes, weights, or
widths from `base.css` in page-specific CSS — the scale is the hierarchy, and a
page that overrides it stops matching its own figures.

## Layout and type

`base.css` sets two widths: `--container` (920px) for the page column, and
`--measure` (42em) for running prose inside it. Figures, tables, grids and
cards fill the container; only paragraphs and lists take the measure. A figure
squeezed to paragraph width is the single most common way a page turns out
narrow and clipped.

The type hierarchy is in the classes — `.eyebrow`, `.num`, `.lede`, `.big`,
`.stat`, `.eq` — and in the h1–h3 sizes. Compose with them.
`references/document.md` gives the section recipe.

## Colour

Colour carries meaning or it does not appear.

One accent for structure emphasis: the section marker, links, the highlighted
block, the focal element in a figure. Its soft tint (`--accent-soft`) is the
fill for a region that needs to stand out without shouting. Semantic hues
(`--ok`, `--warn`, `--bad`, each with a `-soft` tint) for status and verdicts.
Series hues (`--series-1..6`) for data series only. Everything structural —
rules, borders, surfaces, secondary text — comes from the neutral ramp. A page
where three things are coloured for three different reasons has no emphasis
left.

Never introduce a colour the theme does not define, and never use a series
colour to distinguish non-data things (tiers, rings, steps). The series values
are not the theme's editor accents — they were re-derived for the chart
lightness band and validated against `dataviz`'s checks, so substituting a
prettier hex breaks colour-vision separation that was measured, not guessed.

## Delegation

- `dataviz` — chart form, colour, marks, interaction. Load it before writing the
  first line of chart code.
- `artifact-design` — page-level design fundamentals.
- `artifact-diagramming` — inline-SVG mechanism diagrams.

Each has defaults that are wrong for one mode. Overriding them is most of what
this skill is for:

- **`artifact-design`'s editorial branch** — aesthetic risk, hero-as-thesis,
  scroll-triggered motion. Skip it in both modes. A report is the utilitarian
  branch, and a tool is not a landing page.
- **`artifact-design`'s "when it's a UI, not a document"** — skip in `document`
  mode, where filter chips and state pills misdirect a report's structure. Use
  it in `explorable` mode; that is the case it was written for.
- **`dataviz`'s hover and tooltips** — in `document` mode keep them only if the
  page stays live rather than being exported, printed, or screenshotted. In
  `explorable` mode keep them: inspection is the point.

## Local-file delta

Everything not listed here defers to `artifact-design`.

- Nothing stamps `data-theme`, so the page owns its theme. Stamp the theme's
  opening mode on `<html>` (`light` for `apple`, `dark` for the other two) and
  carry the `.theme-toggle` from `base.css` so the reader can flip it.
- No CSP, so a system font stack is fine and no data-URI inlining is needed for
  fonts.
- Self-containment still holds — the file gets moved and emailed. No external
  `src` or `href`; charts are inline SVG.
- `html` and `body` need an explicit background. With no viewer painting a
  ground, the page flashes white and falls back to an OS default.
- Print styles matter more; a local report gets printed to PDF.

## Before you call it done

```bash
python3 ~/.claude/skills/building-html/scripts/check_html.py PATH
```

Fix every error and resolve every warning, or state why it doesn't apply. The
checks are self-containment, both theme blocks, an explicit background on `html`
and `body`, no undefined token, no hardcoded colour, a title, a viewport, size,
and two visual heuristics: a sectioned page with no inline `<svg>`, and a
`<figure>` built from styled divs instead of a graphic.

Then render it and look. Screenshot at 1440px and at 480px (Playwright or the
Chrome tools; a local file needs `python3 -m http.server` since `file:` is
blocked). Check, in order: no figure clips or scrolls sideways; the h1, lede,
section markers, and h2s read as four distinct levels; every h2 section has its
figure; both themes hold. The defects that matter most come from seeing the
page, not from reading its source — the 2026-08-15 data-model page passed the
checker and failed every one of these.
