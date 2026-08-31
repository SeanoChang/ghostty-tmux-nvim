# Explorable mode

The reader operates the page. The mechanism is the content, and they learn by
driving it — a CPU pipeline they step through, a packet crossing a stack, a
component tree they open.

This mode has no outline, and that is deliberate. The shape of an interactive
decomposition comes from the mechanism being decomposed. A skeleton applied to
every mechanism produces the same tool for a pipeline and a packet walk, which
is exactly the failure the analysis genre was rebuilt twice to avoid.

## The one question that sets the shape

**What does the reader change, and what should they see change?**

The answer names the control and the display, and the rest follows from it.

| The reader varies      | The tool is     | The control           |
| ---------------------- | --------------- | --------------------- |
| Position in a sequence | A stepper       | Prev/next, a scrubber |
| A quantity             | A live model    | A slider, a field     |
| A branch or a case     | A comparison    | Toggles, a segment    |
| Depth in a hierarchy   | A decomposition | Expand and collapse   |
| A subset               | A filtered view | Chips, a search box   |

When two of these fit, the tool wants two views, not one control that does both.

## Invariants

These hold whatever shape the tool takes.

**State is visible.** The reader can always tell which step they are on, what
the current values are, and what changed since the last interaction. A tool
whose state lives only in the reader's head is a slideshow.

**Every control is reachable by keyboard.** Steppers bind arrow keys, toggles
are real `<button>` elements, and focus is visible — `base.css` gives every
focusable element a `--border-strong` ring. A stepper the reader cannot arrow
through is broken for the exact reader most likely to use it.

**The initial state teaches.** The page opens on a state that already shows the
mechanism, never on an empty frame waiting to be driven. First paint is the best
explanation the tool will ever give.

**Reversible, with no cost to exploring.** Any state is reachable from any
other. Nothing is destroyed by a click, and nothing needs a reload to recover.

**The mechanism is honest.** A decomposition that invents stages the real thing
does not have teaches something false. Where the model simplifies, say so on the
page.

**It degrades to prose.** Everything the tool demonstrates is also stated in
text somewhere on the page. Interaction is the fast path, not the only path.

## Where the siblings apply here, and where they do not

`artifact-design`'s "when it's a UI, not a document" branch applies in this mode
— this is the case it was written for. Its editorial branch does not: a tool is
not a landing page, and scroll-triggered motion fights a reader who is driving.

`dataviz`'s hover states and tooltips stay. Inspection is the point here, which
is the opposite of document mode.

`artifact-diagramming` owns the static mechanism drawing. An explorable is
frequently one of its diagrams with state added, so read it before inventing a
layout.

## Implementation constraints

Vanilla JavaScript, inline, no framework and no build step. State lives in one
plain object with one render function that reads it; a tool with state scattered
across the DOM stops being editable after the second feature.

Animate only transitions the reader initiated, and keep them under 200ms.
`base.css` already honours `prefers-reduced-motion: reduce` by collapsing every
transition, so do not reintroduce motion that ignores it.

Charts and diagrams inside the tool follow the same rules as document mode:
inline SVG, theme tokens for every colour, no external script.
