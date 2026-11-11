---
name: shape
description: Run a time-boxed system design session with the user for something new (a project, a feature, a tool, a take-home), from a rough idea to a design doc that a fresh session can build from. Five clocked steps in system-design order — requirements, entities and scale, approaches, interfaces and decisions, scope and the doc. The user decides; the agent widens the options, then narrows the scope. Use when the user says "let's design", "design this", "system design approach", "brainstorm", "scope this", "interview me", "help me think this through", or gives a time for design ("design in 2h"). Not for one decision that needs a page (brief-artifact), not for the task plan after the design (the plan genre of writing-markdown-docs, or the visual-artifacts Plan page), and not for explaining a system that already exists.
---

# shape

A design session has two jobs that pull against each other. The agent widens:
it shows approaches and cases the user did not think of. The user narrows: one
scope, decided, small enough to build in the time there is. Without a clock the
widening wins, and the session opens every decision it can find.

So the time is fixed and the scope varies. The session ends on time with a
design doc, and what was not decided is listed in it.

## Before the first step

1. **Get the time box.** If the user gave none, ask once. Offer 120 minutes
   for a project of a few days, and 30 for a feature.
2. **Note the start** (`date`), and show the clock for the five steps below.
3. **Read the source** in full: the assignment, the ticket, the user's notes.
   Every requirement in the design is quoted from it.
4. **Ask before you write.** No doc and no page is written before step 5,
   except one decision page in step 4 (see "Pages").

## The five steps

| Step | Share | 120 min | It ends with |
| --- | --- | --- | --- |
| 1. Requirements | 15% | 18 | P0 and P1 lists the user agreed to |
| 2. Entities and scale | 10% | 12 | An entity sketch, and the terms settled |
| 3. Approaches | 15% | 18 | One approach picked, or a mix |
| 4. Interfaces and decisions | 30% | 36 | The contract, and the decision rows |
| 5. Scope and the doc | 30% | 36 | The design doc, checked by a fresh reader |

### 1. Requirements

- Run the `premise-check` skill on the ask, with all its rules. Show the user
  its Parts table, its "Asked, and not in the idea" list and its call. Its
  sorting is the first draft.
- **Functional requirements,** numbered F1, F2 and so on. The list covers the
  whole source, not only the user's idea: each thing the source asks for is a
  row, with its quote and a P0 tag. A row with no quote is marked "not in the
  source" and keeps the sorting that `premise-check` gave it (P1 or left out).
- **An open request in the source** ("add what makes sense") is one P0 row.
  The concrete extras that could answer it are P1, and the user picks.
- **Non-functional requirements,** N1 and so on, each with a number: users,
  records, requests per second, time to first result, what must never happen.
  When the source gives no number, guess one and mark it as a guess.
- **Done when:** three to eight commands that the user will run, each with the
  result they should see. These become the end-to-end check.
- In one question, the user confirms the guessed numbers and moves items
  between P0, P1 and left out. Then the step ends.

### 2. Entities and scale

- The entities and how they relate, as one small diagram in the chat (Mermaid
  or text) and a line each.
- The numbers that size the design, from the non-functional requirements.
- **Settle the terms** that step 1 marked. For each, give the meanings in two
  lines, with a comparison to a system the user knows, and ask which one this
  design uses. Log the answer as a decision row. It is not asked again in
  step 4.

### 3. Approaches

This is the brainstorm, and it is about the whole system, not single
decisions.

- Show **three approaches.** One of them is the smallest that meets every P0.
  Each gets one paragraph, what it is best at, what it costs, and what it
  leaves out.
- When the user named a tool to copy, say what to take from it and what to
  leave, for this need.
- Give your pick and the reason in one line. The user picks one or mixes them.

### 4. Interfaces and decisions

- Sketch **the contract** first: the API and the CLI as signatures, and the
  data schema as tables and keys. The contract is what parallel builders will
  share later, so it comes before any other detail.
- Then run **the interview** (rules below).
- Then rewrite the "Done when" commands with the names the contract uses.
- Log each decision as a row the moment it is made:

  | ID | Question | Decision | Why | Date |
  | --- | --- | --- | --- | --- |

  Quote the user's own words in the Decision cell when they gave any.

### 5. Scope and the doc

- **Baseline, if time, left out on purpose.** Baseline is P0. "If time" is P1
  in build order. The **cut list** is the same items in cut order: the first
  item is the first to drop. Each left-out item has one line on why.
- **A fresh reader checks the scope** before the doc is final. Start one
  `verifier`, brief it with the source and the scope only, and ask three
  things: which baseline item traces to no requirement, which P0 requirement
  has no baseline item, and what a strict reviewer would cut. Apply what
  holds, and tell the user what you did not apply.
- **Write the design doc** with the `writing-markdown-docs` skill, design
  genre. That genre's outline, rules and word budget apply. This session's
  results go into its sections:

  | Section of the genre | What goes in |
  | --- | --- |
  | Picture | The approach that was picked |
  | Problem and constraints | The need, F and N lists, "Done when", and the non-goals: left out on purpose, each with its reason |
  | Components | Entities, the data model, the contract |
  | Data flow | The two or three flows that matter |
  | Decisions | The decision rows, then the defaults |
  | Failure modes | Required by the genre: start from the deep-dive parts |
  | Testing | The end-to-end check from "Done when" |

  After them, add Build order (the deep dives and milestones below) and Open
  items.
- **Name the deep dives, do not do them.** At most two, each a part where a
  mistake is costly (auth, crypto, data loss, concurrency). They are the first
  tasks of the build, at tier 2.
- **Name the milestones** in build order, one line each. The first milestone
  makes one "Done when" command pass end to end. The task plan is the next
  session's work.

## The interview

- **One question at a time,** with the AskUserQuestion tool when the session
  has it, and as one chat message otherwise. Two to four options, each with
  what it gives and what it costs. Put your recommended option first and say
  why. The user decides.
- **Ask only about a decision that is hard to reverse** and whose options
  lead to different builds: the data model, the access model, the public
  contract, storage and encryption, an outside dependency, and any gap in the
  source that changes the scope.
- **Take a default for everything else,** and log it:

  | Decision | Default | Why | How to change it later |
  | --- | --- | --- | --- |

  Show this table once, at the end of step 4. The user vetoes by row.
- **Budget: ten questions** for a project, five for a feature. The term
  questions of step 2 and the interview questions of step 4 both count. The
  one sorting question that ends step 1 does not. At the budget, each question
  left becomes a default marked "would have asked".
- **A concept question from the user** ("what is PKCE?") gets five lines or
  fewer, with a comparison to something they know. Add it to a "To learn
  after" list. The clock does not stop.
- **A new solution in the middle** ("make it like X") gets a three-line
  `premise-check` before it enters the design.

## Pages

Questions go in the dialog, not on a page. There is one exception to "one
question at a time": in step 4, when three or more decisions each need a
table or a diagram to judge, put them on one `brief-artifact` page, and the
user answers them in one reply. The page holds only decisions the interview
rule allows, and each one counts toward the budget.

## The clock

- At the end of each step, give one line: the step, the minutes used of the
  total, and "on plan" or how far behind.
- When behind, shorten the next step's options. Never shorten the fresh
  reader's check in step 5. Then cut from the top of the cut list.
- When the time is up, stop and write the doc with what is decided. Put the
  rest under Open items.

## After the session

This skill writes no code and no task plan. The build starts in a fresh
session, from the design doc.
