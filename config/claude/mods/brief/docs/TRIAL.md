# Trial: brief vs Superpowers

The question: does `brief` (pane + slim skills) replace Superpowers for real work?
Run each task once with each setup, on a fresh branch, and fill in the table.

## Setup

- **brief:** default install (`/brief auto on`). Superpowers not installed.
- **Superpowers:** `claude plugin install superpowers@claude-plugins-official`, and `/brief auto off` so the pane stays out of the way.
- Same model and effort for both. Same starting commit. Same first prompt, written before the run.

## Pick 2–3 tasks

1. A feature that touches 3+ files and has at least one real design fork.
2. A bug you can reproduce, with an unclear cause.
3. (Optional) A refactor with a behaviour contract.

## Score each run

| Measure | How |
|---|---|
| Time to a design you approved | wall clock from the first prompt to your approval |
| Questions you had to type | count of messages that only answered Claude |
| "What is it doing?" moments | count of times you had to ask or scroll to find out |
| Rework | commits or edits that undid earlier work |
| Done = demonstrated | share of finished tasks with evidence attached |
| Tokens | from `/cost` or ccdash at the end |
| Felt rigid (1–5) | your call, right after the run |
| Felt clear (1–5) | your call, right after the run |

## Decide

Switch if `brief` is no worse on rework and evidence, and better on two of: time, questions,
"what is it doing" moments, and felt clarity. Note anything Superpowers caught that `brief` missed;
that is the next thing to port.
