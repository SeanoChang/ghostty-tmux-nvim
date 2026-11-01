# Design

Use this genre when the reader must decide whether to build something: a
proposal, an architecture, a design for a system that does not exist yet. If the
system already runs and the reader needs to understand it, write a learn doc
instead.

## Outline

```text
> [!tldr]                  the design in one breath, and the decision asked for
1. Picture                 the component diagram, then one paragraph
2. Problem and constraints  including non-goals
3. Components              each: responsibility / interface / depends on
4. Data flow               a sequence diagram; skip it when the Picture
                           already shows the only path
5. Decisions               a table: decision, chosen, rejected, why
6. Failure modes           a table: what breaks, what happens, recovery
7. Testing
8. Rollout                 only when it replaces something that exists
```

## Rules

- **The picture comes first.** The reader sees the whole system before any
  component is named in prose. Use Mermaid for up to about ten boxes, a rendered
  d2 diagram past that.
- **Every component answers three questions:** what it does, how it is used,
  what it depends on. If one cannot be answered, the boundary is wrong; say so.
- **Interfaces are signatures** in the project's language. When none exist yet,
  give input → output pairs and say so. Where one piece of logic decides the
  design (a lock, a retry, an ordering), show it as a sketch of at most 30
  lines.
- **Non-goals are stated.** They stop scope creep after approval.
- **Sections 5 and 6 are non-droppable.** A design with no rejected alternatives
  presents its choice as inevitable. A design with no failure modes hides where
  the cost lives.
- **Decisions and failures are tables,** one row each. A paragraph per decision
  is where these docs grew past 1,000 lines. A row that needs a sentence gets a
  numbered "Why" list under the table, keyed by row.
