# Guide: a direct explanation, fully open

Sean asked for a guide, a walkthrough or a report, so the page only tells. It
holds no question, prediction, gate, lock, drill, rubric or collapsed block. He
reads from the top to the bottom. For
drills and review, use a Learn page (`references/learn.md`).

Start from `templates/guide.src.html`: a small, working guide with every part
below. Copy it, then replace the content.

## Shell

Declare `<meta name="va:format" content="guide">`. Use the docs shell: a top bar
with no controls, `.docs`, `.docs-side`, `.docs-main` with one `.doc-page` per
section, and `.docs-rail`. `Kit.docs()` builds the sidebar and rail. Each section needs an `id`, `data-group` and `data-title`, and the title
is what the sidebar shows, so name the real stage ("Implementation tools").

## Sections

1. **Map and answer.** `.doc-head`, a lede that states the answer, then the map or
   the worked example. No ladder card.
2. **One section per part of the map, in the map's order.** Each has a one-line
   `.takeaway`, one representation from SKILL.md section 2a, then at most three
   short paragraphs. When the page covers a pipeline, the sections follow its
   stages, and each stage opens with `Kit.stageMap`.
3. **Limits and anti-patterns** as statements, when they apply.
4. **Notes and sources.** Numbered, and cited inline as [1].

Write statements. "The determinant is 0 when two columns match" is right; "Why
is the determinant 0 here?" is not (`format-rhetorical`).

## Math

Math reads like a LaTeX paper. For homework and derivations, each problem is one
section: the statement, named steps, then the answer box. Model it on a typeset solution
set, not on a slide per operation. Show every operation, and keep routine arithmetic
inline, in one line of working.

```html
<div class="latex">
  <div class="statement"><b>Statement</b><p>Compute <span class="tex">\begin{vmatrix}1 & 2\\3 & 4\end{vmatrix}</span>.</p></div>
  <p><b>Step 1: row operation.</b> Adding a multiple of a row leaves det unchanged.</p>
  <span class="tex display">R_2 - 3R_1 = (3-3,\ 4-6) = (0, -2)</span>
  <p><b>Step 2: triangular form.</b> The determinant is the product of the diagonal.</p>
  <span class="tex display">\det = \begin{vmatrix}1 & 2\\0 & -2\end{vmatrix} = 1 \cdot (-2)</span>
  <div class="answer"><span class="tex display">\det = -2</span></div>
</div>
```

- Each step is a run-in bold label, `<b>Step N: what it does.</b>`, with a short reason.
- **Not row by row.** Write a row operation as one line of working, `R_2 + 3R_1 = (…)`.
  Group the operations that belong together in one `aligned` block. Redraw the matrix
  only at a checkpoint, such as after a column is cleared (`math-redraw` warns on three
  displays in a row that repeat most of one matrix).
- Say which entry drives an expansion and its sign. Add a cross-check when one is cheap.
- `.slip` holds a common mistake, as a statement. `.answer` holds the result.
- A set of problems opens with the tools it uses and ends with a summary table: problem,
  answer, key move.
- Break a long line inside an `aligned` block, not into extra steps (`math-clipped` warns at laptop widths, and on an answer box at phone widths).
- Never use side columns, number circles, a stepper, a Next button, `details`
  or "Try first". Verify every result by computing it before publishing.

## Code

Use `Kit.trace` for an algorithm or data structure. Show the full code once. Run one
concrete example through it and give one step per executed line, so Play lights each
line as it runs. The right side shows the example's own data: the same names and
values as the code, its locals, and its array, table or tree. Compute each state in
the page by running the logic. Give each operation an `op`, so he can jump to it. A
call may run as one step on the calling line, so the walk stays followable.

## Pipelines

When sections or cards walk through stages, open each stage with `Kit.stageMap`. Put
what goes in and out in words. Never draw a local input → step → output diagram.

## Report variant

When the content is findings (an experiment, a comparison, a study), the lede
states the answer, followed by at most three stat tiles. The sections present the
evidence, then method, then limitations.

## Writing

Follow "Writing" in SKILL.md. Every number carries its unit and baseline, and
every claim has a source or a derivation.

## Checklist

- [ ] `render_check.py` reports no `format-*`, `math-*` or `depth-tabs` issue.
- [ ] All math steps are visible without a click, and they read like a paper.
- [ ] Code plays, the running line lights up, and the right side matches that line.
- [ ] Each pipeline stage shows its place among all stages.
- [ ] At 390 px nothing scrolls sideways.
