# Framework reference

Which primitive implements which law, per ecosystem. Read the section matching the project's framework; skim the others only when choosing one.

## Choosing

| Framework | Language | Strengths | Notable users |
|---|---|---|---|
| Ratatui | Rust | Immediate-mode, explicit constraints, Canvas with Braille built in | gitui, rainfrog, bottom, oxker |
| Bubble Tea + Lip Gloss | Go | Elm architecture, best-in-class styling and text layout | lazygit-adjacent tooling, gum, glow, soft-serve |
| Textual | Python | CSS-like styling, widget library, dev tooling, web export | posting, harlequin |
| tview / tcell | Go | Batteries-included widgets, mature, lower ceremony | k9s |

Immediate-mode (Ratatui) redraws the full widget tree each frame from state, which makes Law 3 nearly automatic but puts layout arithmetic in your hands. Retained-widget frameworks (Textual, tview) manage the tree for you but make it easier to leave a stale widget on screen.

## Ratatui (Rust)

- **Frames (Law 1):** `Block::default().borders(Borders::ALL).title(...)`. Use `.inner(area)` to get the content rect — this is the guard against text overrunning the border.
- **Layout (Law 2, layout.md):** `Layout::vertical([...])` / `Layout::horizontal([...])` with `Constraint::Length`, `Min`, `Max`, `Percentage`, `Fill`. `Min` is the pane's floor; `Fill` shares the remainder. Ratatui distributes remainder cells for you.
- **Buffer ownership (Law 3):** `terminal.draw(|f| ...)` diffs and repaints for you. Use `ratatui::init()` / `restore()` (or `crossterm` `EnterAlternateScreen` + a panic hook) so a panic cannot leave the terminal wrecked. Resize is handled by `draw` re-querying size — do not cache `f.area()` across frames.
- **Charts (Law 7):** `Sparkline` for one-row series, `BarChart` for categories, `Chart` with `Dataset` for line series, and `Canvas` with `Marker::Braille` for full 2×4 resolution. `Gauge` and `LineGauge` for progress; set `.use_unicode(true)` for partial-cell fill.
- **Color (Law 6):** `Style`/`Color::Rgb` for truecolor, `Color::Indexed` for 256. Define a theme struct of semantic fields and pass it down; avoid literal colors in widget code.
- **Width (layout.md):** add `unicode-width` and use `UnicodeWidthStr::width` for all padding and truncation. `Line`/`Span` do not solve CJK width for you.

## Bubble Tea + Lip Gloss (Go)

- **Frames (Law 1):** `lipgloss.NewStyle().Border(lipgloss.RoundedBorder())`. Remember `Width()` sets content width; borders and padding add on top unless you use `.MaxWidth()`.
- **Layout (Law 2):** `lipgloss.JoinHorizontal` / `JoinVertical` for panes, `Place` for alignment within a region. There is no constraint solver — compute widths yourself and distribute the remainder (see layout.md).
- **Buffer ownership (Law 3):** handle `tea.WindowSizeMsg` and store `width`/`height` in your model; every `View()` must render against those values. This is the single most commonly skipped step in Bubble Tea apps and produces exactly the half-filled-window symptom. Start with `tea.WithAltScreen()`.
- **Components:** the `bubbles` package provides `list`, `table`, `viewport`, `textinput`, `spinner`, `help`, `key`. `help` + `key.Binding` gives you the context-sensitive hint line from Law 4 for free — define bindings with `WithHelp` and render `help.View(keymap)`.
- **Charts (Law 7):** not built in. Use `ntcharts` (Braille line/scatter/bar plots designed for Bubble Tea) or draw block ramps directly.
- **Width:** `github.com/mattn/go-runewidth`, or `lipgloss.Width` for styled strings.
- **Async (Law 3, rendering.md):** return `tea.Cmd` for I/O and update on the resulting message. Never block in `Update` or `View`.

## Textual (Python)

- **Frames (Law 1):** widget `border` in CSS, with `border-title`. Textual's box model follows CSS, so padding and border are outside the content box.
- **Layout (Law 2):** CSS `layout: horizontal | vertical | grid`, with `fr` units, `min-width`, `max-width`. `Horizontal`/`Vertical`/`Grid` containers in compose. Breakpoints via `App.CSS` classes toggled on resize.
- **Buffer ownership (Law 3):** the framework owns the alt screen and repaint. The failure mode here is not stale cells but stale *widgets* — remove or `display = False` regions that no longer apply rather than leaving empty bordered voids.
- **Reactivity:** `reactive` attributes trigger re-render on change, which keeps you event-driven per rendering.md.
- **Keys (Law 4):** `BINDINGS` with description strings feed the built-in `Footer`, giving a live hint line. `Header` gives the identity block for Law 5. `App.action_*` methods for the verb half of noun-then-verb.
- **Charts (Law 7):** `textual-plotext` for plots, `Sparkline` widget for one-row series, `ProgressBar` for gauges. Rich's `Table` and `Panel` render inside Textual widgets when you need static composition.
- **Width:** Rich handles East Asian width in its own renderables; use `rich.cells.cell_len` when doing manual padding.

## tview / tcell (Go)

- **Frames (Law 1):** `Box.SetBorder(true).SetTitle(...)` — every primitive embeds `Box`.
- **Layout (Law 2):** `Flex` with `AddItem(item, fixedSize, proportion, focus)`; `fixedSize = 0` means proportional. `Pages` gives the stack navigation from Law 4 (k9s builds its whole drill-down on `Pages`).
- **Buffer ownership (Law 3):** `Application.Draw()` and the screen abstraction handle repaint and resize. Restore with `defer app.Stop()` plus a recover, and be careful with goroutines calling `Draw` — use `QueueUpdateDraw`.
- **Tables:** `Table` with `SetFixed` for frozen headers, `SetSelectable`, and per-cell `tcell.Style` — enough for sortable status-colored lists without extra work.
- **Charts:** none built in. Draw into a custom primitive's `Draw(screen tcell.Screen)` using the glyph tables in rendering.md.
- **Width:** `go-runewidth`; tcell exposes rune width when placing content.

## Cross-cutting checks regardless of framework

1. Is there a resize path, and does the layout recompute from it every frame?
2. Is terminal state restored on panic as well as on normal exit?
3. Is the palette a named semantic set with a degradation ladder, or literal colors inline?
4. Does the chart y-domain come from the data on every frame?
5. Does any padding or truncation call use byte or rune length instead of display width?
6. Does the status line land on `rows - 1` at every window size you tested?
