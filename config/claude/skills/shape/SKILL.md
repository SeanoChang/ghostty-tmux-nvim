---
name: shape
description: Run a time-boxed system design session with the user for something new (a project, a feature, a tool, a take-home), from a rough idea to a design doc that a fresh session can build from. Five clocked steps in system-design order — requirements, entities and scale, approaches, interfaces and decisions, scope and the doc. The user decides; the agent widens the options, then narrows the scope. Use when the user asks for a design session, with words such as "let's design", "design this", "system design approach", "scope this", "interview me", "brainstorm this with me", or a time for design ("design in 2h"). Not for a question or a thought said out loud (assess and stop), not for one decision that needs a page (brief-artifact), not for the task plan after the design (the plan genre of writing-markdown-docs, or the visual-artifacts Plan page), and not for explaining a system that already exists.
---

# shape

In a design session the agent widens: it shows approaches and cases the user
did not think of. The user narrows: one scope, small enough to build in the
time there is. Without a clock the widening wins. So the time is fixed and the
scope varies. The session ends on time with a design doc, and the doc lists
what was not decided.

## Which rule applies

Other files cover some of the same cases. For each, one rule applies:

- **The time box in CLAUDE.md.** This skill is how that rule runs for a design
  session. Its must-haves and its cut list are in "The clock". The cut list of
  the build is made in step 5.
- **A question, or a thought said out loud,** gets an assessment and a stop,
  as CLAUDE.md says. Start a session only when the user asks for one.
- **Pages.** In a session, "Pages" below replaces the `brief-artifact` skill's
  own rule for when to make a page.
- **The doc.** The design genre of `writing-markdown-docs` sets its outline,
  tables, word budget and path. Step 5 says only what goes into each section.
- **Task order and tiers.** The plan genre and CLAUDE.md set them, in the next
  session. Step 5 names milestones and deep dives, and orders no tasks.
- **Agents.** Step 5 starts one `verifier` in its refute mode. This skill
  starts no other agent.

## Before the first step

1. **Get the time box.** If the user gave none, ask once: 120 minutes for a
   project, 30 for a feature. A box of 60 minutes or less is a feature.
2. **Note the start** (`date`). Show the clock for the five steps, and the
   must-haves and the cut list from "The clock".
3. **Read the source** in full: the assignment, the ticket, the user's notes.
   Every requirement in the design is quoted from it.
4. **Ask before you write.** No doc is written before step 5. The only page
   before it is the decision page of step 4 (see "Pages").

## The five steps

| Step | Share | 120 min | It ends with |
| --- | --- | --- | --- |
| 1. Requirements | 15% | 18 | P0 and P1 lists the user agreed to |
| 2. Entities and scale | 10% | 12 | An entity sketch, and the terms settled |
| 3. Approaches | 15% | 18 | One approach picked, or a mix |
| 4. Interfaces and decisions | 30% | 36 | The contract, and the decision rows |
| 5. Scope and the doc | 30% | 36 | The design doc, its scope checked by a fresh reader |

### 1. Requirements

- Run the `premise-check` skill on the ask, with all its rules. Show the user
  its Parts table, its "Asked, and not in the idea" list and its call. Its
  sorting is the first draft.
- **Functional requirements,** numbered F1, F2 and so on. The list covers the
  whole source, not only the user's idea: each thing the source asks for is a
  row, with its quote and a P0 tag. A row with no quote is marked "not in the
  source" and keeps the sorting that `premise-check` gave it.
- **An open request in the source** ("add what makes sense") is one P0 row.
  The concrete extras that could answer it are P1, and the user picks.
- **Non-functional requirements,** N1 and so on, each with a number: users,
  records, requests per second, what must never happen. When the source gives
  no number, guess one and mark it as a guess.
- **Done when:** three to eight commands that the user will run, each with the
  result they should see. These become the end-to-end check.
- In one question, the user confirms the guessed numbers and moves items
  between P0, P1 and left out. Then the step ends.

### 2. Entities and scale

- The entities and how they relate, as one small diagram in the chat (Mermaid
  or text) and a line each, with the numbers that size the design.
- **Settle the terms** that step 1 marked. For each, give the meanings in two
  lines, with a comparison to a system the user knows, and ask which one this
  design uses. Log the answer as a decision row. It is not asked again in
  step 4.

### 3. Approaches

This is the brainstorm. It is about the whole system, not single decisions,
and it happens in the chat.

- Show **three approaches.** One of them is the smallest that meets every P0.
  Each gets one paragraph: what it is best at, what it costs, what it leaves
  out.
- When the user named a tool to copy, say what to take from it and what to
  leave, for this need.
- Give your pick and the reason in one line. The user picks one or mixes them.

### 4. Interfaces and decisions

1. Sketch **the contract:** the API and the CLI as signatures, and the data
   schema as tables and keys. Parallel builders will share it later, so it
   comes before any other detail.
2. Run **the interview** (rules below). Log each decision as a row the moment
   it is made, in the columns the design genre asks for:

   | ID | Decision | Chosen | Rejected | Why |
   | --- | --- | --- | --- | --- |

   Quote the user's own words in the Chosen cell when they gave any.
3. Rewrite the "Done when" commands with the names the contract uses.
4. Show the defaults table once. The user vetoes by row. Then the step ends.

### 5. Scope and the doc

In this order:

1. **Baseline, if time, left out on purpose.** Baseline is P0. "If time" is P1
   in build order. The build's **cut list** holds the "if time" items only, in
   cut order: the first item is the first to drop. Unless the user says
   otherwise, that is the reverse of build order. Each left-out item has one
   line on why.
2. **A fresh reader checks the scope.** Start it before you write, so the
   check always runs, and write the doc while it runs. Start one `verifier` in
   its refute mode. Brief it with
   the goal, the path of the source, the F list and the three scope lists, and
   none of the session's reasoning. Its finding list is three claims:
   - each baseline item traces to a requirement the source states;
   - each P0 requirement has a baseline item;
   - no baseline item goes beyond what the source asks.

   Apply what it refutes, in the scope lists and in the doc. Tell the user
   what you did not apply, and why.
3. **Write the design doc** with the `writing-markdown-docs` skill, design
   genre. This session's results go into the genre's sections:

   | Section of the genre | What goes in |
   | --- | --- |
   | Picture | The approach that was picked |
   | Problem and constraints | The need, the F and N lists, "Done when", and the non-goals: left out on purpose, each with its reason |
   | Components | Entities, the data model, the contract |
   | Data flow | The two or three flows that matter |
   | Decisions | The decision rows, then the defaults |
   | Failure modes | Start from the deep-dive parts |
   | Testing | The end-to-end check from "Done when" |

   After them, add two sections: Build order, and Open items.
4. **Build order** names two things, and plans neither:
   - **the milestones,** one line each. The first makes one "Done when"
     command pass end to end, as the plan's first task must;
   - **the deep dives,** two at most: parts where a mistake is costly (auth,
     crypto, data loss, concurrency). Each becomes a task of its own in the
     plan, at the tier CLAUDE.md gives it. It is not the plan's first task.
5. **Open items** are what the user must still decide: a default they vetoed
   with no choice yet, a claim the verifier refuted that you did not apply,
   the check itself when it has not returned, and each section the time did
   not reach.

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

  | Decision | Default | Instead of | How to change it later |
  | --- | --- | --- | --- |

- **Budget: ten questions** for a project, five for a feature.
  - These count: each term question in step 2, each interview question in
    step 4, and each decision on a page.
  - These do not count: the time-box question, the sorting question that ends
    step 1, the pick in step 3, and where the doc goes.
  - At the budget, each question left becomes a default marked "would have
    asked".
- **A concept question from the user** ("what is PKCE?") gets five lines or
  fewer, with a comparison to something they know. Add it to a "To learn
  after" list. The clock does not stop.
- **A new solution in the middle** ("make it like X") gets the short form of
  `premise-check` before it enters the design, in three lines: where it comes
  from, its sort, and what it costs.

## Pages

Questions go in the dialog, and the approaches of step 3 go in the chat. There
is one exception to "one question at a time": in step 4, when three or more
decisions each need a table or a diagram to judge, put them on one
`brief-artifact` page, and the user answers them in one reply. The page holds
only decisions that the interview rule allows.

## The clock

The time box covers all five steps. Step 5's share is reserved: no earlier
step may use it.

- **Must-haves:** the "Done when" commands, the fresh reader's check, and the
  doc with its Decisions, Failure modes and Open items. These are never
  dropped.
- **The session's cut list,** the first to drop at the top:
  1. answers to concept questions (the question goes to "To learn after");
  2. the third approach in step 3 (show two);
  3. interview questions past half the budget (each becomes a default marked
     "would have asked").
- **At the end of each step,** give one line: the step, the minutes used of
  the total, and "on plan" or how far behind. When behind, drop from the top
  of the session's cut list, and say what you dropped.
- **When a step's time is up,** open nothing new in it. A question already
  asked keeps the user's answer. Each thing not yet asked takes your
  recommended option and is logged as a default marked "would have asked".
  Step 4 still shows the defaults table. Then start the next step.
- **When the whole box is up,** which can only happen in step 5, write
  Decisions, Failure modes and Open items if they are not written, because the
  design genre does not allow a doc without the first two. Then stop. Any
  other section the time did not reach is listed under Open items.

## After the session

This skill writes no code and no task plan. The build starts in a fresh
session, from the design doc.
