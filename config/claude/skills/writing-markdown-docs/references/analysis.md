# Analysis

Use this genre when the reader must settle an open question and the facts do not
answer it yet. The answer may be a choice, a cause, a threshold, a
characterization or a ranking. A specific, reproducible failure is an incident
report instead.

## Lead

The finished document opens with a `> [!tldr]`. It gives the answer, its
confidence, and what would change it, in at most 60 words. Then comes the
structure that produced the answer, usually a table. Then the evidence. Method
and caveats come after the answer.

## The loop

The loop is the order you think in, not the order you write in.

```text
1. Sharpen the question until it is answerable; name the form of the answer.
2. Name the evidence that would settle it, before gathering any.
3. Commit to a structure for that evidence: a matrix, competing hypotheses.
4. Gather. Record evidence that does not fit; do not drop it.
5. Answer, with confidence and its disconfirmer.
6. State the limits, including where the structure strained.
```

Step 2 comes before any evidence on purpose. It decides what counts as an answer
before results can bias the choice. Step 3 commits the structure before step 4
can fill it.

## What the body must do

| The answer is           | So the body must                                   |
| ----------------------- | -------------------------------------------------- |
| A choice                | make options comparable on axes that could flip it |
| A cause                 | separate hypotheses by what each uniquely predicts |
| A quantity or threshold | show the relationship, and where it breaks         |
| A yes/no with a price   | put required against available, and price the gap  |
| A characterization      | name the dimensions and place each subject         |
| A ranking               | fix the ordering criterion before ordering         |

These forms combine. A real question is often a choice with a price, or a
ranking with a threshold inside it. When none fits, invent the structure, and
declare it at step 3.

## Rules

- **Structure before conclusion.** Build the comparison before the rubric. Axes
  chosen after the answer is known only justify it.
- **Do not inherit a template.** The structure comes from what step 2 named as
  decisive for this question.
- **Findings are specific and falsifiable.** A claim no evidence could
  contradict is not a finding.
- **Name the disconfirmer** up front: what would have changed the answer.
- **Effort scales with stakes.** A reversible choice gets a quick pass. A
  one-way decision gets the full step 4.
- **Keep misfit evidence.** Say where the structure strained.
- **Answer the question asked.** A characterization question gets a
  characterization, not a verdict.
- **A table too wide to read** means the medium is wrong. Stop reformatting and
  ask about a different medium.

## Two runs of the loop

| Step | Which of three tools fits?       | Why did the job get slower?         |
| ---- | -------------------------------- | ----------------------------------- |
| 1    | Which wins on deciding axes      | Which stage adds the most time      |
| 2    | Cost, latency, migration pain    | Hypotheses with distinct signatures |
| 3    | Matrix: options × axes, one unit | Lock wait; time ∝ input; cold cache |
| 4    | Fill cells; keep an odd licence  | Measure each predicted signature    |
| 5    | Weighted rubric; name the flip   | The signature that shows names it   |
| 6    | The licence fits no column       | What would point at another stage   |
