# Layout reference

Contents: size floors · pane arithmetic · column widths · truncation · numeric alignment · gauge math · chart domains · display width for CJK and emoji · reserved rows.

## Size floors and breakpoints

Design for three sizes and pick the behavior at each explicitly. Guessing produces a layout that only works on the author's monitor.

| Size | Treat as | Behavior |
|---|---|---|
| 80 × 24 | Floor. Assume it will happen (SSH, split panes, CI logs) | Single column. Master list *or* detail, toggled by a key. Header collapses to one row. |
| 120 × 30 | Common working size | Two columns. Full header. Charts get real height. |
| 180 × 50+ | Maximized | Two or three columns. Consider a third pane rather than stretching two. |

Below the floor, print a single line stating the minimum size instead of drawing a broken layout. Never scale a chart into two rows.

Breakpoints belong in one function that maps `(cols, rows)` to a layout enum. Scattering `if cols > 100` checks through drawing code makes the layout impossible to reason about.

## Pane arithmetic

Integer division loses cells. Distribute the remainder rather than dropping it, or a column of gaps appears at one edge.

```
# splitting `total` cells across n panes with weights
base   = total / n            # integer division
rem    = total % n
widths = [base + (1 if i < rem else 0) for i in range(n)]
```

Constraints to specify per pane, in priority order:

1. **Minimum** — below this the pane is useless; drop it or switch layout instead of squeezing.
2. **Maximum** — a detail pane wider than ~120 cells hurts readability; cap it and leave gutter, or add a third pane.
3. **Weight** — how leftover space is shared once minimums are satisfied.

Reserve rows before dividing the remainder, not after:

```
usable_rows = rows - header_rows - breadcrumb_rows - status_rows
```

Borders consume cells. A bordered pane of width `w` has `w - 2` cells of content and `h - 2` rows. Forgetting this is the classic source of text touching or overrunning the frame.

## Column widths

Compute label width once across **every** row, then apply it to every row uniformly. Computing it from the first row, or padding row 0 differently from the rest, produces the single most common visible defect: a top row indented several cells further than its neighbors.

```
label_w = max(display_width(row.label) for row in all_rows)
label_w = min(label_w, max_label_budget)     # cap before it starves the value column
```

Order of operations for a row: `[label: label_w][gap: 1][bar: bar_w][gap: 1][value: value_w]`. Every row uses the same widths in the same order. If a row has an annotation the others lack (a marker, a flag), give the annotation its own fixed-width column that is blank on other rows — never inject it inline, which shifts every column after it on that row only.

## Truncation

- Truncate paths on separator boundaries, not on character boundaries. `…/twn/data-cloud` identifies a project; `…ading/stocks/twn/data-cloud` does not, and two different paths can truncate to near-identical strings.
- Prefer dropping middle segments to dropping the head: `~/dev/…/data-cloud` beats `…/data-cloud` because the leading context is often what disambiguates.
- Put the ellipsis where the information was lost, and use a single `…` (one cell) rather than three periods (three cells).
- When several rows truncate to the same string, extend the budget or add a disambiguating column instead of shipping ambiguous labels.

## Numeric alignment

- Right-align numbers, left-align labels, and align on the decimal point. Currency and units go in the column header, not repeated per row, unless the units vary by row.
- Format at fixed precision so column width is stable across frames. A value that changes width causes the whole column to jump on refresh, which reads as flicker.
- Use consistent magnitude suffixes (`k`, `M`, `B`) with a fixed number of significant figures, and keep the suffix inside the same column width.

## Gauge and bar math

```
track_w   = allotted_width
fill_cells = round(fraction * track_w)
```

- Always draw the empty track. Without it, 15% and 16% are indistinguishable and the reader cannot see the scale the fill is measured against.
- Share one baseline column across every row in the panel. A gauge that starts at a different origin than its neighbors is uncomparable, and the error is usually the same row-0 padding bug described above.
- For sub-cell precision, use the partial block ramp on the final cell (see `rendering.md`), which turns a 20-cell track into 160 steps.
- Clamp to `[0, track_w]` and decide explicitly what over-100% looks like — an over-limit gauge that silently saturates hides the condition you most want to surface.

## Chart domains

- **y-domain**: derive from data every frame — `[0, max * 1.05]` for counts and costs, `[min - pad, max + pad]` for series that do not start at zero. A constant ceiling clips exactly when the data becomes interesting.
- **x-domain**: default to the window the user is looking at, not the full retained history. Offer keys to widen it. A series occupying the right fifth of an empty canvas is a domain bug.
- Label the extremes at minimum: y-max, y-min, x-first, x-last. Four labels cost two rows and one column and convert a shape into a measurement.
- Mark "no data" regions distinctly from "zero". An empty left half of a chart should not look like a flat zero line.

## Display width for CJK and emoji

`len()` is not display width. This bites any app whose data includes Chinese, Japanese, Korean, or emoji — and it corrupts every column in the row, not just the offending cell.

- East Asian Wide and Fullwidth characters occupy 2 cells. Most CJK ideographs and fullwidth punctuation (`，` `。` `：`) are wide.
- Combining marks occupy 0. Emoji are generally 2 but ZWJ sequences and variation selectors are inconsistent across terminals.
- Use a width-aware function — `unicode-width` (Rust), `go-runewidth` (Go), `wcwidth`/`rich.cells` (Python) — for every padding, truncation, and centering calculation.
- Truncating a wide character in half emits a broken cell. Truncate to a width budget by accumulating widths, and pad with a space if the last character would overflow by one.
- Test with a fixture row containing mixed ASCII, CJK, and emoji. Column drift is immediately visible and otherwise easy to miss.

## Reserved rows checklist

Before laying out content, subtract: header block, breadcrumb or filter row, status/command line, and any borders. Then verify the status line lands on `rows - 1`. If it lands anywhere else, the layout is computing against a size the app does not own — see Law 3 in SKILL.md.
