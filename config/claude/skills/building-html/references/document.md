# Document mode

The reader reads. Visuals answer questions the prose has already posed, and the
page is finished when the questions are answered.

## What the genre still owns

Structure comes from the genre outline in
`~/.claude/skills/writing-markdown-docs/references/<genre>.md`. Open it and
follow it. HTML changes what a section can contain, never what sections there
are or what order they come in. A `report` in HTML is still a report: the
headline lands first, and the charts sit inside the sections the outline already
prescribes.

## The page

```
<main>
  <header>
    <p class="eyebrow">…context line…</p>
    <h1>…the finding, as a title…</h1>
    <p class="lede">…two or three sentences a reader could stop after…</p>
    <nav class="toc">…one row per h2, past five sections…</nav>
  </header>

  <h2 id="…"><span class="num">01 — Short label</span>Section title</h2>
  …section body (below)…

  <h2><span class="eyebrow">Summary</span>…</h2>
  <div class="card"><ol>…the chain of reasoning…</ol></div>
  <footer>…sources, date, provenance…</footer>
</main>
```

`main` is the 920px column. Prose inside it is capped at `--measure`; figures,
tables, grids and cards fill the column. Never put `max-width` on a figure.

`.num` numbers the sections. Numbering is information: use it when the sections
are a sequence the reader walks in order (a first-principles build-up, a
pipeline, a timeline). For sections that are merely a list, use
`<span class="eyebrow">` inside the h2 for the same visual slot without the
number.

## The section

Every h2 section has the same shape, and the shape is what makes the page read
as designed rather than typed:

1. **Marker + title** — `.num` or `.eyebrow`, then the h2 text.
2. **The claim** — one `.big` sentence when the section has a single point the
   reader must carry away; plain prose otherwise.
3. **Prose that poses the question** — one to three paragraphs. The reader
   should know what they are about to look at before they look at it.
4. **The figure that answers it** — inline SVG (below), a table, an `.eq`
   block, or a `.stats` row. Every h2 section carries one. A section with none
   is prose that has not found its picture yet: ask what you would sketch on a
   whiteboard to explain it, and draw that.
5. **The caption that states the finding** — "Sum distinguishes 4h from h;
   mean and max cannot" beats "Aggregator comparison".
6. **h3 subsections** for the parts, each with its own `.eq`, table, or short
   figure when it earns one.

Section spacing is already in `base.css` (`--space-7` above every h2). Do not
add rules or `<hr>` between sections; the marker and the gap are the divider.

## Choosing the form for a piece of content

| The content is                                     | It becomes                                                        |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| A mechanism, flow, pipeline, topology, lifecycle   | An SVG diagram: boxes, arrows, one highlighted path               |
| A comparison of shapes (before/after, A vs B, N ways) | An SVG with N panels side by side, or `.grid2`/`.grid3` of cards |
| A hierarchy or layering (rings, tiers, stack)      | An SVG of nested or stacked boxes, labelled                       |
| Entities and their relations (schema, ERD, joins)  | An SVG of entity boxes with typed edges                           |
| Raw → normalized, input → output                   | An SVG with two columns and mapped arrows, or a two-column table  |
| A trend, distribution, spread                      | A chart — `dataviz` owns it                                       |
| Values to look up or copy                          | A table                                                           |
| Two to five numbers that are the point             | A `.stats` row of `.card`s, each a `.stat` + `.stat-label`         |
| One number that is the point                       | A `.stat` inline                                                  |
| A definition, formula, schema fragment, key rule   | An `.eq` block; `.eq.hl` when it is the one to remember           |
| A claim, a caveat, a reason                        | Prose; a `.callout` when it must not be skimmed past              |

Rows one through five are where a document page most often falls short: the
content is a mechanism, and it gets rendered as a row of styled `<div>`s that
clip at the first width they were not designed for. Draw it.

## The figure

Every diagram is inline SVG, and every SVG follows one contract:

```html
<figure>
<svg viewBox="0 0 880 240" role="img" aria-label="Capture path from source to derived layer">
  <rect x="0" y="0" width="880" height="240" rx="16" fill="var(--bg-raised)" stroke="var(--border)"/>
  <text x="26" y="34" class="lbl" fill="var(--text-muted)">CAPTURE PATH · left of the archive is raw, right is rebuildable</text>

  <rect x="26"  y="80" width="150" height="64" rx="12" fill="var(--bg)" stroke="var(--border-strong)"/>
  <text x="101" y="106" text-anchor="middle" class="lbl-s" fill="var(--text)">Source endpoint</text>
  <text x="101" y="124" text-anchor="middle" class="lbl-xs" fill="var(--text-muted)">API · JSON-LD · feed</text>

  <path d="M176 112 H206" stroke="var(--text-faint)" stroke-width="1.6" marker-end="url(#a)"/>

  <rect x="210" y="80" width="150" height="64" rx="12" fill="var(--accent-soft)" stroke="var(--accent)"/>
  <text x="285" y="106" text-anchor="middle" class="lbl-s" fill="var(--text)">Raw archive</text>
  <text x="285" y="124" text-anchor="middle" class="lbl-xs" fill="var(--text-muted)">append-only, kept forever</text>

  <defs><marker id="a" markerWidth="7" markerHeight="7" refX="6" refY="3" orient="auto"><path d="M0 0 L6 3 L0 6 z" fill="var(--text-faint)"/></marker></defs>
</svg>
<figcaption>Everything right of the raw archive can be deleted and rebuilt; nothing left of it can.</figcaption>
</figure>
```

- **Width** — `viewBox="0 0 880 H"`, no `width`/`height` attributes; `base.css`
  makes it fill the column and scale down on a phone. Height budget 180–460.
- **Frame and title** — a rounded `--bg-raised` panel with a `--border` stroke,
  and a `.lbl` title in `--text-muted` at top-left saying what the reader is
  looking at. Sub-panels inside a comparison get their own frame.
- **Text** — `<text>` with `.lbl` / `.lbl-s` / `.lbl-xs` / `.mono-s` / `.mono-xs`
  from `base.css`, so every figure on the page shares one label scale. Two
  short lines beat one long line; wrap by hand.
- **Colour** — every `fill` and `stroke` is a `var(--token)`. `--accent` and
  `--accent-soft` mark the focal element (the one box the section is about);
  `--ok`/`--bad` and their `-soft` tints mark verdicts (distinguishable ✓ /
  identical ✗); `--series-n` only for data series; everything else `--bg`,
  `--bg-raised`, `--border`, `--border-strong`, `--text-*`. Filled circles for
  nodes may use `fill-opacity=".8"` on a token to soften without a new colour.
- **Arrows** — a `<marker>` per colour, defined once per SVG in `<defs>`; ids
  must be unique across the page (`#a`, `#b`, … or `#s3-arrow`).
- **Accessibility** — `role="img"` and an `aria-label` that names the figure.
- **Caption** — a `<figcaption>` stating the finding, not the title.

`artifact-diagramming` covers layout of mechanism drawings in depth; read it
before inventing a topology.

## Type

`base.css` carries the hierarchy: 17px body, h1 up to 52px, h2 29px with a
section-scale gap, `.lede` and `.big` at 21px, uppercase 12px eyebrows and
table headers, 14px captions. Use the classes and do not restate sizes; a page
that sets its own `font-size` on headings has left the scale and will not match
its figures' label scale.

## Colour on the page

One accent, and it carries structure: the `.num` marker, the highlighted `.eq`,
the focal box in each figure, links. Semantic `--ok`/`--warn`/`--bad` for
verdicts and status. `--series-n` for data series only — never as a border or
marker colour for non-data things like tiers or rings. Everything else neutral.

The soft tints (`--accent-soft`, `--ok-soft`, `--warn-soft`, `--bad-soft`) are
how a region gets emphasised without shouting: a `.callout-accent`, an
`.eq.hl`, a diagram box. A page with several full-strength coloured surfaces
has no emphasis left.

## Front-loading

HTML removes the one-screen pressure that disciplines a markdown report — there
is always more page. The budget is the reader's attention, not the viewport.

The answer goes in the `.lede`, above the first scroll, before any visual. A
reader who stops there should still have the finding.

## Navigation

Past five sections, add `nav.toc` in the header: one anchored row per h2, the
`.num` in a `<span>`. Skip sticky sidebars, progress rails, and scroll-spy: they
are chrome, and they read as an app rather than a document.

## Length

The markdown rule holds — delete any section you would have to pad. HTML makes
padding easier to hide behind layout, which is a reason to be stricter, not
looser.

## Charts

`dataviz` owns chart form, colour, marks, and interaction. Load it before
writing the first line of chart code. Two things it cannot know:

- Series colours come from `--series-1` through `--series-6` of the active
  theme. Never introduce a colour the theme does not define.
- Charts are inline SVG. No chart library, no canvas, no external script.

## Tables

Wrap every table in `<div class="table-wrap">` so a wide one scrolls inside its
own box. The page body must never scroll horizontally. Right-align numeric
columns with `class="num"`, which also sets tabular figures; use `class="m"` on
identifier or formula cells so they set in mono.

## Local file: the theme toggle

A local page owns its theme. Put `<button class="theme-toggle no-print"
id="themeToggle" aria-label="Toggle colour theme">theme</button>` first in
`<body>`, and flip `data-theme` on `<html>` between `dark` and `light` in a
five-line inline script. Open on `data-theme="light"` for `apple`; on `dark`
for `tokyonight` and `ghostty`.
