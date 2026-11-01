# Guide: a layered research guide or report, laid out like the Claude docs

The reader reads to understand, from the simple version to the deep one, and
then explains it to others. The page looks like the Claude docs
(platform.claude.com/docs) and reads like Optimizer Lab: **one continuous
page**. A grouped sidebar shows where you are and jumps within the page; an
"In this section" rail lists the current section's parts. Nothing makes the
reader hop between pages: Sean found paging and overview cards tiring
("too many navigations and pages that I need to hop around").

Start from `templates/guide.src.html`: a small, working guide with every
part below. Copy it, then replace the content.

## Shell

```html
<header class="topbar">
  <div class="wrap topbar-in">
    <button class="btn ghost icon menu-btn" data-docs-menu aria-label="Open sections"><span data-icon="layers"></span></button>
    <a class="brand" href="#overview"><span class="brand-mark" data-icon="book" data-size="14"></span>Quantization <span class="brand-sub">Guide</span></a>
    <span class="spacer"></span>
    <div class="seg sm" id="depth"><button data-value="skim">Skim</button><button data-value="read" aria-pressed="true">Read</button><button data-value="deep">Deep</button></div>
  </div>
</header>
<div class="docs">
  <aside class="docs-side" aria-label="Sections"></aside>          <!-- Kit.docs fills it -->
  <main class="docs-main">
    <section class="doc-page" id="overview" data-group="Start here" data-title="Overview">…</section>
    <section class="doc-page" id="idea" data-group="Start here" data-title="The idea">…</section>
    <section class="doc-page" id="methods" data-group="Mechanism" data-title="Methods">…</section>
    …
  </main>
  <aside class="docs-rail" aria-label="On this page"></aside>      <!-- Kit.docs fills it -->
</div>
<script>Kit.init(); Kit.depth(Kit.$('#depth')); /* figures… */ Kit.docs();</script>
```

`Kit.docs()` builds the sidebar from each section's `data-group` and
`data-title`, highlights the section in view as you scroll, fills the rail with
that section's `h2`, `h3`, figure and "Go deeper" titles, opens the sidebar as a
drawer on phones, and makes `#any-id` links scroll to the element (opening a
"Go deeper" block if needed). Section ids are plain tokens (letters, digits,
`-`), so deep links survive the viewer. Call it last, after the figures are set
up. (`Kit.docs({ mode: 'paged' })` exists for long reference material only;
never use it for a learning guide.)

## Sections, in order

The order follows the learn genre (`writing-markdown-docs`
`references/learn.md`): a worked example first, then the parts. The markup calls each section a
`.doc-page`, but they all sit on one page.

| # | Section | Sidebar group | Holds | Rung |
|---|---|---|---|---|
| 1 | **Worked example** (overview) | Start here | `.doc-head` (eyebrow, `h1`, two-sentence `.lede`, `.meta` with the assumed background), the one-line takeaway, then one real case played end to end (a stepper over a sequence or timeline, live counters for the page's key quantity, an "Inside …" pane for its biggest object). A topic with no natural case opens with the map figure instead. | 1 One line |
| 2 | **Problem** | Start here | the pain this exists to solve, before any API or method is named | 2 Why |
| 3 | **Mental model** | Start here | the core abstraction and its signature diagram; later sections point back to it | 3 Mechanism |
| 4 | **Under the hood** | Mechanism | the mechanics: where the seams and boundaries are | 3 Mechanism |
| 5 | **Feature by feature** | Mechanism | one `h2` per primitive, primitives before composition; each has its mechanics and a worked example (bold run-in labels, no deeper headings); systems primitives get a Go counterpart (`.pair`) | 3 Mechanism |
| 6 | **Capstone** (required) | Mechanism | one complete worked example, from scratch, traced step by step against the mental-model diagram from section 3 | 3 Mechanism |
| 7 | **Trade-offs and principle** | Trade-offs | the calls a senior engineer weighs, with real failure cases; then the general idea this is an instance of and where else it shows up in Sean's fields | 4, 5 |
| 8 | **Anti-patterns** (required) | Trade-offs | what mid-level engineers get wrong, as a list, each with why it fails | 4 Trade-off |
| 9 | **Test yourself** (required) | Review | the whole design or model on one screen (map with a side pane per part), then 2–3 open questions with rubrics (`Kit.openQuestions`) and one hard check | 4, 5 |
| 10 | **Notes and sources** | Review | "Your notes" (vault paths as text); numbered sources cited inline as [1] (`data-check="none"`); "Explain it to…" scripts only when asked | — |

Drop a section only when it does not apply, except the capstone and the
anti-patterns: a guide without a capstone has not proven its mental model, and
one without anti-patterns has taught only the happy path. Name nothing (an API,
a method, a paper) before the problem and the mental model.

**Every step has the same shape, in this order:**

1. `.doc-head`: an eyebrow naming the outline step and rung ("Mental model ·
   Rung 3") and an `h1`.
2. `.takeaway`: one line, always visible, even in Skim.
3. Optional **decision** before the explanation: `.decide data-kind="decide"
   data-gate` asks for a prediction, and the explanation that follows sits in
   `.after-decide` blocks that open once he has chosen.
4. The figure: a diagram, step-through, chart or mini-interactive, with a title,
   a "What to notice" caption, and a legend.
5. `.prose.d-read`: at most three short paragraphs. `details.deeper` holds only
   a derivation (numbered KaTeX steps) or a figure; edge cases become
   scenarios on the step's figure (`Kit.scenarios`). Put its content in one
   wrapper: `<details class="deeper"><summary>Go deeper: …</summary><div
   class="deeper-body prose">…</div></details>`.
6. **One check question** (`.decide` with `data-answer` and a `.decide-why` for
   each option). `render_check.py` warns about a step without one.

`Kit.docs()` turns the checks into the done / current / locked ladder in the
sidebar. Keep about 9 sections in at most 4 sidebar groups; fold related ideas
into one section with `h2` subsections, which show in the rail.

## Mini-interactives inside a guide

Each one teaches one idea, sits inside a `.fig`, and opens in a meaningful
state. A step-through whose first step is sparse opens complete
(`Kit.stepper(fig, { start: 'last' })`) and plays from step 1 on Play.

- **Calculator:** sliders or presets produce a number and a bar (for example
  KV-cache size against GPU memory with `Kit.stackBar`). Show the formula
  beside the result with the live values substituted in, rendered with
  `Kit.tex(el, latex)` on every change.
- **Step-through:** a process in three to seven steps (`Kit.stepper`).
- **Before/after toggle:** the same drawing under two policies, flipped by a
  segmented control.
- **Small simulation:** a timeline or queue that plays, with a policy switch.

## Writing

Follow "Writing" in SKILL.md (about 60% of ASD-STE100). For guides also:
- Every number carries its unit and its baseline ("128 KiB per token, versus
  512 KiB without grouped-query attention").
- Every claim has a source or a derivation the reader can check.
- Carry one worked example through the whole guide (one model, one GPU, one
  request) instead of many unrelated examples.

## Step-through variant

The page Sean gets after accepting an offer, when a chat explanation did not
land. Same shell and rules as a guide, smaller and stricter:

- **A different example** from the one that did not land in chat.
- **Map first**, then 4–7 steps, one idea each.
- **Every step opens with a decision** (`.decide data-kind="decide" data-gate`):
  he picks, and only then does the explanation (`.after-decide`) open. Then
  one check question on a fresh case closes the step.
- The sidebar ladder shows done / current / locked; "Open anyway" stays
  available.
- If he said he was lost, reset to zero: no jargon, anchor each idea on
  something he has done (Go, `go build`, running code), and name a term only
  after the idea lands.
- No "Explain it to…" scripts and no Skim/Read/Deep control; a step-through is
  short enough to read once.

## Report variant

When the content is findings (an experiment, a comparison, a study), the
Overview lede states the answer, followed by at most three stat tiles. The
pages present the evidence, then method, then limitations.

## Checklist

- [ ] The first screen shows the map (named blocks and wires, separate legend) and the ladder; no overview cards.
- [ ] Sections follow the teaching outline; the capstone traces the mental-model diagram; anti-patterns are present.
- [ ] Every step ends with one check question; key steps ask for a decision before explaining.
- [ ] The sidebar shows done / current / locked, and "Open anyway" works.
- [ ] Math is KaTeX; systems primitives have a Go counterpart; stylized figures carry a flag.
- [ ] Every page has a takeaway, a figure with a "What to notice" caption, and short prose.
- [ ] It is one continuous page; the sidebar follows the section in view and has about 8 entries.
- [ ] Rung links and in-text links scroll to the right place (deep links work).
- [ ] At least two figures are interactive.
- [ ] The page opens with one worked example, and later sections reuse its numbers.
- [ ] Each idea has a representation picked from SKILL.md section 2a; no section is mostly prose.
- [ ] Code is in `figure.codeblock`, tied to its figure; edge cases are scenarios.
- [ ] Check options are the same length and shape; answer positions vary.
- [ ] "Test yourself" has open questions with rubrics and the floating bar.
- [ ] At 390 px the sidebar opens from the menu button and nothing scrolls sideways.
