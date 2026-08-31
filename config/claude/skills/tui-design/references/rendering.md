# Rendering reference

Contents: Braille dot mapping · block element ramps · choosing a glyph strategy · double-buffered diff rendering · alternate screen and state restoration · resize handling · color degradation · frame-rate policy.

## Braille: 2 × 4 dots per cell

Braille Patterns occupy `U+2800`–`U+28FF`. The code point is `0x2800 + bitmask`, where each dot maps to one bit:

```
dot layout        bit values
 (1) (4)          0x01  0x08
 (2) (5)          0x02  0x10
 (3) (6)          0x04  0x20
 (7) (8)          0x40  0x80
```

Note the irregularity: dots 7 and 8 (the bottom row) are `0x40`/`0x80`, not the values the visual order suggests. Getting this wrong produces charts that look almost right, with the bottom row of every cell misplaced.

```python
DOT = [[0x01, 0x08],   # row 0: left, right
       [0x02, 0x10],   # row 1
       [0x04, 0x20],   # row 2
       [0x40, 0x80]]   # row 3

def plot(cells, x, y):          # x,y in dot space
    cx, cy = x // 2, y // 4
    cells[cy][cx] |= DOT[y % 4][x % 2]

def render(cell): return chr(0x2800 + cell)
```

A chart region of `w × h` cells therefore addresses `2w × 4h` dots — an 8× gain in vertical resolution over one glyph per cell. Note that `U+2800` (blank Braille) renders as a space but is not a space; use an actual space for untouched cells so selection and copy behave sanely.

Caveat: Braille cells cannot carry per-dot color, only per-cell. If a chart needs multiple colored series in the same region, either separate them into rows, accept cell-granular color, or use block elements instead.

## Block elements

Eight-step ramps, one glyph per cell. Coarser than Braille but individually colorable, which makes them the right choice for bars, gauges, and stacked series.

```
vertical (bar charts, sparkline columns, gauge partials)
  ▁ U+2581  ▂ U+2582  ▃ U+2583  ▄ U+2584
  ▅ U+2585  ▆ U+2586  ▇ U+2587  █ U+2588

horizontal (progress bars, horizontal gauges)
  ▏ U+258F  ▎ U+258E  ▍ U+258D  ▌ U+258C
  ▋ U+258B  ▊ U+258A  ▉ U+2589  █ U+2588

half blocks (2× vertical resolution with full color control)
  ▀ U+2580  ▄ U+2584   — set fg and bg independently for two colored half-rows
```

Partial-cell gauge fill:

```
total_eighths = round(fraction * track_w * 8)
full_cells    = total_eighths // 8
remainder     = total_eighths % 8
# draw `full_cells` of █, then HORIZONTAL_RAMP[remainder-1] if remainder > 0
```

The half-block trick doubles vertical resolution *and* keeps color: set the foreground for the upper half and the background for the lower half of the same cell. btop-style graphs use this for colored gradients that Braille cannot express.

## Choosing a glyph strategy

| Need | Use |
|---|---|
| Dense line series, one color | Braille |
| Multiple colored series in one region | Half blocks, or Braille split by row |
| Bar chart, gauge, progress | Block ramps |
| Sparkline in a single row | Vertical ramp |
| Heatmap | Full block `█` with per-cell background color |
| Must work on a 16-color or legacy terminal | Block ramps + ASCII fallback (`#`, `=`, `.`) |

Always keep an ASCII fallback path. Fonts without Braille coverage render tofu boxes, which is worse than a coarse chart.

## Double-buffered diff rendering

Maintain two cell buffers. Draw into the back buffer, diff against the front, and emit only changed cells. This is what every mature framework does internally, and it is why they do not flicker.

```
for each changed cell, grouped into runs on the same row:
    move cursor once per run
    emit SGR only when the style differs from the previous cell in the run
    write the run's text
swap(front, back)
```

Rules that matter:

- **One write syscall per frame.** Buffer the whole frame into a single string and flush once. Many small writes cause visible tearing.
- **Clear the back buffer at the start of every frame.** Skipping this is exactly how stale glyphs from a previous frame survive into the current one.
- **Emit style changes lazily**, only on transition. Re-emitting SGR per cell can triple frame size and become the bottleneck over SSH.
- **Never assume the terminal preserved anything.** If a cell is inside your layout, write it every frame the diff says it changed and never depend on what happened to be there.

## Alternate screen and state restoration

Enter on start, restore on every exit path:

```
enter: \x1b[?1049h   (alt screen)   \x1b[?25l  (hide cursor)
exit:  \x1b[?25h     (show cursor)  \x1b[?1049l (leave alt screen)
mouse: \x1b[?1000h / \x1b[?1006h  … and the matching `l` sequences on exit
```

The alternate screen is what keeps the app from scribbling on the user's scrollback and restores their shell intact on quit. Skipping it also means there is no full-screen surface to clear, which is a common cause of "the app only fills part of the window."

Register restoration on **all** exit paths: normal quit, `SIGINT`/`SIGTERM`, and panic or unhandled exception. A panic that leaves the cursor hidden and mouse mode on forces the user to run `reset`, and it is the single worst first impression a TUI can make. In Rust use a panic hook plus a Drop guard; in Go a `defer` in `main` plus signal handling; in Python a `try/finally` around the event loop.

## Resize handling

- Subscribe to the resize event (`SIGWINCH`, or the framework's window-size message) and treat it as an input event that invalidates the layout.
- Re-query size at the top of each frame rather than trusting a cached value, so a missed signal degrades to one stale frame instead of a permanently wrong layout.
- On resize, discard the front buffer entirely and force a full repaint. Diffing against a buffer of different dimensions produces garbage.
- Debounce roughly 16–50 ms during drag-resize so a continuous drag does not trigger a relayout per pixel.
- Test by resizing while the app runs, not only by launching at different sizes. Launch-time correctness hides exactly this bug.

## Color degradation

Detect once at startup and store a capability level:

```
truecolor  if COLORTERM in (truecolor, 24bit)      → \x1b[38;2;R;G;Bm
256        if TERM contains 256color                → \x1b[38;5;Nm
16         otherwise                                → \x1b[3Nm / \x1b[9Nm
none       if NO_COLOR is set, or output is not a TTY
```

Define the palette once per level and map semantic roles onto it — do not scatter literal escapes through drawing code. Honor `NO_COLOR` unconditionally; at that level every state distinction must survive as a glyph or word, which is the practical reason Law 6 forbids color-only encoding.

Do not assume the terminal background is dark, or that it is opaque. Both assumptions break, and the second one is why unpainted cells become a transparent hole in the app.

## Frame-rate policy

- **Event-driven by default.** Repaint on input, on data change, or on resize. An idle TUI should use no CPU.
- **Live data**: cap at 4–10 fps. Faster is imperceptible for numbers and burns battery; slower feels laggy.
- **Animations** (spinners, transitions): 10–30 fps while active, then stop. A spinner that runs forever after its task finished is a bug users notice.
- Decouple polling from rendering. Sample the data source on its own interval and render from the latest snapshot, so a slow collector never stalls input handling.
- Never block the render loop on I/O. Move file, network, and subprocess work to a worker and render a pending state — yazi's async file operations and k9s's watch streams are what make both feel responsive regardless of what the backend is doing.
