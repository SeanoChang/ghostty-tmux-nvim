# RCA

This genre applies when the reader needs to understand a specific failure: what
broke, why it broke, and how the fix was confirmed to close the gap. If the
failure can be reproduced, use this genre; if there's no single reproducible
failure, the question is an analysis instead.

## Outline

```text
symptom            verbatim error, when it started (as a callout)
1. Reproduction    exact commands, minimal case
2. Investigation   what was checked, what it ruled out, dead ends included
3. Root cause      the mechanism, at file:line
4. Fix
5. Verification    command plus real pasted output
6. Prevention      the specific test or guard added
```

## Symptom

State the verbatim error text and when it started. Set it apart as a callout, or
whatever the medium offers for a highlighted block, so a reader can find it
without reading the narrative first. It comes before the numbered sections, not
inside them.

## 1. Reproduction

Give the exact commands and the smallest case that produces the failure. This
section is not optional and not decoration — everything after it depends on what
it establishes.

A list of commands without their observed output is not a reproduction; it is a
claim that one exists. Paste what running them actually produced — the failure
itself, not a description of it.

If the failure could not be reproduced, or the commands were never actually run,
say so here, plainly, instead of moving on to a cause. Whatever section 3 states
later has to trace back to what this section actually reproduced, or it has no
reproduction to trace back to.

A cross-reference to the symptom block does not satisfy this section. The
symptom is what the reader saw; this section is what you did to make it happen
again — the commands and their observed output have to appear here, not just be
pointed at.

## 2. Investigation

List what was checked, in the order it was checked, and what each check ruled
out. Include the dead ends: the paths that looked promising and turned out not
to be the cause. Removing a dead end from the document does not stop the next
person from walking that same path again — it only means they walk it without
knowing someone already ruled it out. Leaving it in is what saves them the time.

## 3. Root cause

Name the mechanism, and point at the exact file and line where it lives. This
section carries the rule the genre exists to enforce:

No root cause section without a reproduction section. A cause is a conclusion
drawn from a reproduction; without one there is nothing to draw it from. If the
failure could not be reproduced, or the commands in section 1 were never
actually run, this section can still exist, but the cause it states is not
established fact — it is a theory. Label it explicitly as hypothesized, and say
what evidence would confirm or rule it out.

## 4. Fix

Describe the change that addresses the cause named above. If that cause was
labeled hypothesized rather than confirmed, say whether the fix was checked
against the real failure or only against the theory.

## 5. Verification

Show the command that was run and its actual output, pasted in full or in the
relevant part. A line stating that tests pass is not verification; it is a
claim. The pasted output is what lets someone who wasn't there confirm the fix
actually closes the gap the reproduction opened.

## 6. Prevention

Name the specific test or guard that was added so this failure cannot come back
unnoticed. A general statement of intent to be more careful is not prevention.
Neither is a `FIXME` comment promising a test later; the guard has to already
exist and already run.

## Rules

- No root cause section without a reproduction section that shows real, observed
  output. A cause that cannot be traced to a reproduction that was actually run
  — because it failed, or because it was never attempted — is not established;
  it is hypothesized, and the document should say so.
- Dead ends stay in the document. They are what stops the next reader from
  walking the same path again.
- Verification pastes real output. A statement that something passed is not
  verification on its own.
