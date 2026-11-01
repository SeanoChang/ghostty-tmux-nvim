# Lookup

This genre applies when the reader's job is to look something up: a config
schema, a data dictionary, an API surface, a table of error codes. The reader
arrives knowing what they want and leaves the moment they find it.

## Outline

```text
1. Scope           what's covered, and what deliberately isn't
2. Entries         one row or block per thing, all answering the same questions
3. Conventions     units, defaults, naming rules that apply across all entries
4. Gotchas         entries that behave unlike their neighbours
```

## Rules

- **Entries are a table** when they share fields, one row each. Use one `###`
  per entry only when an entry needs code or a diagram.

- Optimise for scanning, not reading. The reader is not starting at the top and
  will not finish it; every entry has to stand on its own.
- Every entry answers the same questions in the same order. One inconsistent
  entry costs more than a missing one — it teaches the reader they can't trust
  the shape of the rest.
- **Section 1 must say what is excluded.** A silent gap is worse than a visible
  one. A reader who does not find something stops looking; they do not check
  whether it was ever meant to be there.
- No narrative. If the material needs a story to make sense, it's a teaching
  document, not a lookup.
- **Section 4 is non-droppable when any entry has a surprise in it.** The
  exception nobody documented is exactly what the reader gets wrong.
