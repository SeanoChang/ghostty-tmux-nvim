# Plan

Use this genre when the reader will build something task by task: an
implementation plan for an approved design. If the design is not settled yet,
write a design doc first. For a plan with many linked tasks that the reader will
review visually, the visual-artifacts Plan page is the richer option.

## Outline

```text
> [!tldr]                  what will exist when the plan is done, and the check
1. Outcome and check       the behaviour the reader will see, and the command
                           that proves it
2. Clock and cut list      only for a time-boxed plan: a table of checkpoints
                           (clock time, what is done by then, its check), then
                           what to cut, in cut order
3. Task graph              a Mermaid flowchart of tasks and their dependencies
4. Tasks                   one ### per task, in dependency order
5. Risks                   a table: risk, sign, what to do
6. Out of scope
```

## Each task

```markdown
### 3 · Add the retry budget

- [ ] **Goal:** a failed fetch retries at most 3 times, with backoff.
- **Files:** `fetcher/retry.py` (new), `fetcher/client.py:40`
- **Failing test first:** `tests/test_retry.py::test_stops_after_three`
- **Verify:** `uv run pytest tests/test_retry.py -q`
- **Depends on:** task 2
```

## Rules

- **Every task names its failing test and its verify command.** A task that
  cannot be checked cannot be called done.
- **The first task makes one end-to-end check pass,** on the thinnest path
  through the system. Later tasks widen that path.
- **The shared contract is its own early task.** Tasks that run in parallel
  start after it: the API, the schema, and any type that two of them use.
- **A time-boxed plan carries its clock.** Each checkpoint has a clock time,
  so "behind" is a fact and not a feeling. The cut list is in cut order: the
  first item is the first to drop, and nothing on it is a must-have.
- **Each task is startable on its own** once its dependencies are done.
- **Show code only where it decides something,** per "Code changes" in SKILL.md.
  The plan is not the implementation.
- **Number tasks once and keep the numbers.** Refer to "task 3", and give it a
  name in its heading so the number is never opaque.
