# Analysis

Use this genre when the reader needs to settle an open question, and the answer
isn't obvious yet from the facts as they stand — whether that answer is a
choice, a cause, a threshold, a characterization, or a ranking.

If the question is a specific, reproducible failure, that's an RCA; use this
genre when there's no single failure to reproduce.

This is a framework, not a skeleton. There's no fixed set of sections to fill
in, because the structure that makes the answer legible depends on what kind of
answer the question calls for — that's the thing this genre works out, not
something it starts from. The loop is the order you think in, not the order you
write in: the finished document leads with the answer, then shows the structure
and the evidence that produced it.

## The loop

```text
1. Sharpen the question until it's answerable.
   Ask what form the answer takes. That form drives everything after.
2. Name what would settle it — the evidence that distinguishes between
   possible answers. If nothing could distinguish them, the question
   isn't answerable yet; go back to 1.
3. Commit to a structure that organizes that evidence — before gathering it.
4. Gather. Record evidence that doesn't fit rather than dropping it —
   misfit evidence means the structure was wrong, and saying so is the
   finding.
5. Answer, with confidence and with its disconfirmer.
6. State limits, including where the structure strained.
```

Step 2 sits before any evidence is gathered, on purpose: it decides what would
even count as an answer before results exist to bias that decision. Step 3 is
the commitment point — the structure is chosen and written down before step 4
has anything to put in it.

## What the body has to accomplish

This says what the body has to accomplish for each form of answer, not what the
body has to look like:

| The answer is           | So the body has to                                    |
| ----------------------- | ----------------------------------------------------- |
| A choice                | make options commensurable on axes that could flip it |
| A cause                 | separate hypotheses by what each uniquely predicts    |
| A quantity or threshold | show the relationship, and where it breaks            |
| A yes/no with a price   | put required against available, price the gap         |
| A characterization      | name the dimensions and place each subject            |
| A ranking               | fix the ordering criterion before ordering            |

These six forms compose, and they're not exhaustive: a real question is often a
choice with a price attached, or a ranking with a threshold buried inside it.
When none fit, invent the structure that would settle the question — the
framework only asks that the structure get declared at step 3, before the
evidence, not assembled afterward to justify a conclusion already reached. A row
here isn't an option on a menu; it's a description of what the body has to
accomplish once the question has been sharpened.

## Invariants

- **Structure before conclusion.** This generalizes a narrower rule: write the
  comparison matrix before the decision rubric, never after. If the answer is
  already known when the matrix gets built, the axes get chosen to justify it,
  and commensurability becomes theater instead of a real constraint. Committing
  to structure at step 3, before step 4 supplies the evidence, is what keeps the
  axes honest. Retrofitting structure onto a conclusion already reached is the
  failure mode this genre exists to prevent. This governs when you commit to a
  structure while working the loop, not where the answer sits in the finished
  document — the two are independent, and the document still leads with the
  answer.
- **Don't inherit a template.** The structure comes from what step 2 named as
  decisive for this question, not from whatever shape the last analysis happened
  to use. A structure that fit a different question is itself a piece of
  evidence that doesn't fit — treat it that way.
- **Findings falsifiable and specific.** A claim that no evidence could have
  contradicted, or that's too vague to be checked against the evidence gathered,
  isn't a finding.
- **Name your disconfirmer.** State up front what would have changed the answer.
  If nothing would have, the confidence attached to it isn't earned.
- **Effort scales with stakes and irreversibility.** A reversible, low-stakes
  choice earns a quick pass through the loop. A one-way decision earns the full
  weight of step 4.
- **Don't quietly drop misfit evidence.** Say where the structure strained
  instead — that's what steps 4 and 6 are for.
- **Don't force a recommendation the question didn't ask for.** If the question
  was to characterize something, answer with a characterization, not a verdict
  it never asked to reach.
- **A table too wide to read cleanly is a signal the medium is wrong, not the
  content.** That's the point to stop reformatting the table and ask about
  switching medium instead.

## The loop running

These aren't two more rows to add to the table above — they're the same six
steps, run against two different questions, ending in two different shapes.

**A tool-selection question.** "Which of these three fits" sharpens to "which
one wins on the axes that could actually change the outcome" — cost, latency
under real load, and how painful migration would be. Those axes are what would
settle it, so step 3 commits to a matrix: one row per option, one column per
axis, entries in comparable units. Gathering fills the cells; one option turns
out to carry a licensing term that doesn't match any column, so it gets recorded
rather than dropped. The matrix, once filled, doesn't decide anything by itself
— a rubric derived from it (weighting the axes, or a threshold on the worst one)
turns the matrix into a choice, with the axis that would flip that choice named
as the disconfirmer.

**A why-is-it-slow question.** "It got slower" sharpens to "which stage of the
job accounts for most of the added time." What would settle it is a set of
hypotheses that each predict something different: lock contention would predict
wait time clustered on one resource, an oversized batch would predict time
scaling with input size, a cold cache would predict the slowdown disappearing on
a second run. Step 3 commits to structuring the evidence around those competing
predictions rather than around the stages of the pipeline. Measurements get
gathered against each prediction, one hypothesis gets attributed as the cause
because its predicted signature is the one that actually shows up, and the
answer states what measurement would have pointed to a different stage instead.
