# Teaching

This genre applies when the reader needs to understand something they don't yet:
a technical guide, a framework explainer, a codebase walkthrough, course
material. Use the eight-section outline below, in order.

```text
1. Problem / Why        the pain this exists to solve, one paragraph,
                        before any API or feature is named
2. Mental model         the core abstraction and its signature diagram
3. Under the hood       mechanics and internals; serialization boundaries,
                        payload formats, where the seams are
4. Feature-by-feature   primitives first, then composition;
                        each with mechanics plus a worked example
5. Capstone             complete from-scratch example exposing every moving
                        part, traced back against the diagram from §2
6. Engineering tradeoffs  the calls a senior actually weighs,
                          with real-world failure cases
7. Anti-patterns        explicit list of what mid-level engineers get wrong
8. References           primary sources only, caveats flagged honestly
```

Five rules govern how to use the outline:

- §1 comes before §2, and both come before anything is named. Naming an API
  before the mental model is the most common way these fail.
- §4 gives each feature its own third-level heading. Mechanics and the worked
  example inside it are told apart with bold run-in labels, not a fourth heading
  level.
- §5 and §7 are non-droppable; every other section can be cut when it doesn't
  apply. A guide without a capstone hasn't proven that its mental model is
  load-bearing, and one without anti-patterns has taught only the happy path.
- §5 traces explicitly against §2's diagram. That closes the loop rather than
  appending an unrelated example.
- Density mode: a slide-widget variant compresses each topic to three beats —
  Why, What, How (mental model / structure and math / worked walkthrough). Same
  ordering discipline, tighter budget.

Section 2's diagram is whatever visual best carries the core abstraction for the
medium in use — describe it as a diagram, not as a specific notation or file
format.
