---
name: premise-check
description: Check the premise of an idea before any design or build. Takes an idea, a feature request or a ready-made solution, traces each part of it back to who asked for it, states the need under it, and sorts the parts into P0, P1 and left out, with the one fact that would change the sorting. One pass with no questions. Use at the start of a design, when the user arrives with a solution in hand ("let's build X", "we need a Y", "like Z but for W"), when asked "is this worth building", "do we need this" or "triage my ideas", and on a list of ideas to sort. Not for an ML research idea (research-triage), not for finding what already exists (build-scout), and not for a bug, which already states its need.
---

# premise-check

An agent builds in hours what once took weeks, so a wrong idea no longer fails
at the build. It fails later, after the design, the review and the tests were
spent on it. The cheap moment to catch it is before the design starts.

An idea usually arrives as a solution. Some of its parts answer a real need.
Other parts came along because the user liked them in another tool. This
skill separates the two, with proof for each, in the words the design will
use afterwards: P0, P1, and left out on purpose.

## Input

- **The idea,** in the user's own words.
- **The source:** the text that says what is wanted. An assignment, a ticket,
  a spec, the user's notes or earlier messages. Read all of it first.

Ask no questions. Where you must guess, guess, and mark it as a guess.

## Output

Five parts, in this order, under these headings with their numbers. Part 3
is left out when it is empty.

### 1. Parts

Split the idea into three to seven parts, each one a thing that would be
built. Trace every part to where it comes from. A part has one source: when
half of it is asked and half is borrowed, split it in two.

| Part | Comes from | Proof |
| --- | --- | --- |

| Comes from | Meaning | Proof to give |
| --- | --- | --- |
| `asked` | The source asks for it | The quote, and where it is |
| `seen` | A record shows the need: a log, a metric, an incident, a benchmark | The record |
| `wanted` | The user wants it, and nothing records a need | The user's words |
| `borrowed` | It comes from the design of another tool | The tool, and what the user liked in it |

A hint in the source is not a record. A part that the source only hints at is
`wanted`, with the hint quoted.

Then one more list, **Asked, and not in the idea:** each thing the source asks
for that no part covers, with its quote. An idea often leaves out a whole
requirement, and this is the only place that shows it.

### 2. Need

One sentence with no solution in it: who must be able to do what, and what
stops them today. Then one line on what they do today without this.

### 3. Terms to settle

The words in the idea that the source uses in another way, or does not use
("user" against "login", "project" against "team"). One line each: the two
meanings, and why the design depends on the choice.

### 4. P0, P1, left out

Sort every part. The sorting follows the trace, and the user can move any
part.

| Sort | Holds | Rule |
| --- | --- | --- |
| **P0** | What must be built | Every `asked` part, and everything asked that the idea left out |
| **P1** | Built if time allows, in this order | `seen` and `wanted` parts, the cheapest first by your estimate |
| **Left out on purpose** | Not built now | `borrowed` parts, until a fact moves them |

For each P1 or left-out part, give one line: what it adds, and what it costs
(the new cases to design, test and explain). For the three that would change
the build the most, give the **deciding fact**: the one fact that would move
the part up, and the fastest way to get it. That is a line to read, a number
to count, a ten-minute spike, or a question to a named person.

### 5. Call

One of these, with one sentence of reason:

- **Build as given.** Every part is P0, and the idea leaves out nothing that
  the source asks for.
- **Build P0, keep P1 in order.**
- **Hold.** Nothing shows the need yet. Name what would show it.

The call does not repeat the sorting. Keep the text outside the tables under
350 words.

## Rules

- **Quote it, or it is not asked.** A requirement you cannot quote is `wanted`
  or `borrowed`. Say "the source does not ask for this" when it does not.
- **Look before you mark.** When the user's notes or the repo could hold the
  proof, look there first. For the vault, that is the `second-brain-obsidian`
  skill and its `sb find`. When you cannot look, say so in the Proof cell.
- **`borrowed` is not wrong.** Say what the user liked in the other tool, and
  whether the need here calls for that.
- **Do not design.** Name the parts in the user's words. No components, no
  data model, no libraries.
- **The call rests on the trace, not on taste.** Do not argue that a part is a
  bad idea. Show where it comes from and what it costs.
- **Left out is not a rejection.** A part comes back when its deciding fact
  arrives.

## A list of ideas

For more than three ideas, give one row each, and expand only the ideas whose
call is not "hold".

| Idea | Need, in twelve words or fewer | Comes from | Call |
| --- | --- | --- | --- |

## What comes next

- The idea goes ahead and needs a design: the `shape` skill.
- The question is whether it already exists: the `build-scout` skill.
- The call is "hold": stop, and say what would change it.
