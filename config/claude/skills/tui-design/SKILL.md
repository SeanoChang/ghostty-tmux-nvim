---
name: tui-design
description: Design, build, and review terminal user interfaces — pane layout, keybinding grammar, color semantics, chart rendering, redraw discipline, and resize handling. Use this whenever the user is working on anything that draws a full-screen interface in a terminal, including work with Ratatui, Bubble Tea, Lip Gloss, Textual, Rich, tview/tcell, blessed, or ncurses. Trigger it even when the request sounds purely functional or cosmetic — "my dashboard looks off", "add a panel to this", "the bars are misaligned", "make this chart look better", "the layout breaks when I resize", "why does my TUI only fill half the window" — because the overwhelming majority of TUI defects are layout, redraw, and alignment bugs rather than logic bugs. Also use it when the user shares a screenshot of a terminal app and asks what is wrong with it, or asks how well-regarded TUIs (btop, lazygit, k9s, yazi, zellij) achieve their look.
---

# TUI design

## The core constraint

A TUI draws into a fixed grid of monospace cells. A maximized terminal at a typical font size is roughly 180 × 55 — about 10,000 cells, against millions of pixels in a GUI. Two properties of that grid generate almost every rule that follows:

- **Cells are scarce.** Anything permanently on screen has to earn its rows against the content it displaces.
- **Cells are discrete.** Alignment is integer arithmetic, so an off-by-one is not a subtle rendering artifact — it is visibly broken.

Good TUIs are not the ones with the most color. They are the ones that spend a small cell budget deliberately. Work through the laws below when building; use the review pass at the end when critiquing.

Read `references/layout.md` before deciding pane geometry or column widths, `references/rendering.md` before writing drawing code, and `references/frameworks.md` once the framework is known.

## Law 1 — Draw the frame before the content

Bordered, titled panes are not decoration. They are the reference edges that make alignment readable. A value two cells out of position inside a border reads as a bug instantly; the same value floating in open space reads as intentional, so misalignment hides and accumulates.

Draw the frame first, then fill it. When a layout "looks sloppy" and nobody can say why, missing frames is the usual cause.

Corollary: if a region has no content, it should not be an unbordered void. Either shrink the layout, merge the region into its neighbor, or give it a bordered empty state with a line explaining why it is empty.

## Law 2 — Persistent panes, master left, detail right

The dominant pattern across lazygit, lazydocker, k9s, rainfrog, and yazi: a column of selectable lists on the left, a detail region on the right that re-renders as the selection moves, and a status line pinned to the bottom. Nothing the user is working with scrolls out of view.

This works because a fixed frame builds spatial memory — after ten minutes the user reaches for a region rather than searching for it — and because only the detail pane needs repainting on navigation.

Deviate when the object count is genuinely small. oxker puts every container plus its logs and metrics on one screen precisely because there are rarely more than a dozen containers, and panel switching would be pure overhead. Choose master-detail when the list is unbounded; choose single-screen when it is not.

## Law 3 — Own the entire buffer, every frame

This is the law most often broken, and it produces four or five symptoms that look like unrelated bugs:

- Content occupying part of the window with the desktop or another app visible through a transparent background.
- Stale glyphs from an earlier frame surviving in regions that no longer have content.
- A status bar floating mid-screen instead of on the last row.
- Layout that was correct at launch and wrong after the window was resized.

All four have the same root cause: the app is drawing against a size it does not currently own. Fix the cause, not the symptoms.

- Enter the alternate screen buffer on start and restore on exit, including on panic or signal.
- Recompute `(cols, rows)` from the resize event or `SIGWINCH` on every frame. Never cache the value captured at startup.
- Pin the status bar to `rows - 1`, never to `content_end + 1`.
- Paint a background for every cell you own rather than relying on the terminal's. If the user runs a transparent terminal, unpainted cells are a hole in the app.

When reporting this class of bug, name the single root cause and list the symptoms under it. Enumerating five separate defects for one missing resize handler wastes the reader's attention.

## Law 4 — Noun, then verb

Select a row (the noun), then press a verb key that acts on it: logs, describe, delete, open, edit. Keep the verbs consistent across object types wherever they make sense.

The arithmetic is the whole argument. Forty object types and ten actions is fifty bindings to learn under this grammar and four hundred under per-screen bindings. It is also why vim users absorb these apps in minutes.

Inherit the shared vocabulary rather than inventing one: `j`/`k` move, `gg`/`G` jump to ends, `/` filters, `Tab` cycles panes, `Esc` pops one level, `q` quits, `?` shows help. Reserve `:` for a command prompt when the app has more addressable views than fit in a menu — this is k9s's central idea, where the resource type *is* the address.

Navigation should be a stack: `Enter` pushes, `Esc` pops, and a breadcrumb shows depth. A stack needs no synchronization and is always one key from unwinding, unlike a tree widget.

## Law 5 — Keep destructive context permanently on screen

k9s spends four rows of its header on cluster, context, user, and versions — deliberately. The cost of those rows is nothing against the cost of running a delete against production because the user forgot which context was active.

Identify the variable that determines blast radius or interpretation — environment, target host, active filter, date range, dry-run state — and give it a fixed block that never scrolls. A dim footnote at the bottom of the screen does not count; people do not read it.

## Law 6 — Color carries state before it decorates

Pick roughly six semantic roles and hold the line: normal, active/selected, success, warning, error, muted. Assign meaning first, then choose a palette that expresses it. A user should be able to read health from the color field before reading a single word.

- Never encode meaning in color alone. Pair it with a glyph or text so the interface survives colorblind users, monochrome terminals, and logs piped to a file.
- Externalize the palette into a theme file. You do not control the background you are drawn on, so theming is a correctness requirement rather than a vanity feature.
- Degrade explicitly: truecolor → 256 → 16 → none, and honor `NO_COLOR`.
- One decorative slot is fine if it doubles as a signal. k9s's logo changes color on error, so even the ornament carries a bit.

## Law 7 — Buy vertical resolution with sub-cell glyphs

This is the mechanism behind btop looking like a web dashboard. A Braille cell carries a 2 × 4 dot matrix, so one text row becomes eight vertical steps and a ten-row chart area goes from 10 usable levels to 80. Block elements give eight steps in a single row for sparklines.

Any chart drawn one glyph per cell is running at one-eighth of its available resolution. See `references/rendering.md` for the glyph tables and bit mapping.

Chart rules that matter as much as the glyphs:

- Derive the y-domain from the data (`[0, max * 1.05]` or a padded min/max), never from a constant. Clipped peaks are the most common chart bug.
- Label at least the axis extremes. An unlabeled chart shows shape but withholds magnitude, which is usually the thing being asked.
- Match the x-domain to the interesting window, not the full history. A series crammed into the right fifth of an empty canvas is a domain bug, not a data story.
- Draw the empty track behind every gauge and share one baseline column across all rows, so 15% and 55% are visually distinguishable and comparable.

## Law 8 — Every number on screen must reconcile

A dashboard that does not add up teaches the user to distrust all of it.

- Top-N lists get an explicit remainder row. If six projects sum to $1,512 under a $2,023 headline, show the $511 rather than leaving the reader to subtract.
- Put caveats next to the number they invalidate. A warning about unpriced models belongs in the header of the panel whose totals are wrong, not in a footer twenty rows away.
- Show the active state of every filter. A footer listing `[1]all [2]claude [3]codex [d]ay [w]eek [m]onth` with no indication of which is live makes every number on screen ambiguous.
- Keep timestamps and ranges unambiguous. `2025-09-24 → 08-16` drops the year and forces a guess.

## Default skeleton

Start here and cut rather than starting empty and adding:

```
┌─ identity ─────────────┬─ context-sensitive keys ──────┬─ status ─┐
│ what/where/which       │ only verbs valid right now    │ health   │
├────────────────────────┴───────────────────────────────┴──────────┤
│ breadcrumb / active filters (1 row, always visible)               │
├──────────────────┬────────────────────────────────────────────────┤
│ master list      │ detail pane                                    │
│ (selection)      │ (repaints on selection change)                 │
│                  │                                                │
├──────────────────┴────────────────────────────────────────────────┤
│ command / filter line · ? for help          (row = rows-1)        │
└───────────────────────────────────────────────────────────────────┘
```

## Review pass

When asked to critique an existing TUI — from source, from a running app, or from a screenshot — walk these in order and group findings by root cause rather than by symptom.

1. **Viewport.** Does content fill the window? Is the status bar on the last row? Any bleed-through, stale cells, or layout that changes on resize?
2. **Frame.** Are panes bordered and titled? Is there dead gutter that should be reclaimed?
3. **Alignment.** Do all rows in a column share one origin, including row 0? Do gauges share a baseline? Are numeric columns right-aligned and labels left-aligned?
4. **Charts.** Is the y-domain derived from the data? Are extremes labeled? Is anything clipped? Is the x-domain sensible?
5. **Semantics.** Does each color mean one thing? Is the active mode, filter, and selection visible without inference?
6. **Data integrity.** Do the parts sum to the headline? Are truncations disclosed? Are caveats adjacent to the affected numbers?
7. **Discoverability.** Is there a `?` overlay or a live hint line? Does the keymap follow the shared vocabulary?
8. **Degradation.** What happens at 80 × 24, in a 16-color terminal, over SSH, with CJK or emoji in the data?

Lead the report with the single change that fixes the most symptoms. For most broken TUIs that is Law 3.

## Reference files

- `references/layout.md` — size floors and breakpoints, pane arithmetic, column width and truncation algorithms, gauge math, display-width handling for CJK and emoji.
- `references/rendering.md` — Braille and block glyph tables with bit mapping, double-buffered diff rendering, alternate screen and terminal state restoration, color degradation, frame-rate policy.
- `references/frameworks.md` — which primitive implements which law in Ratatui, Bubble Tea + Lip Gloss, Textual, and tview/tcell, plus charting libraries per ecosystem.
