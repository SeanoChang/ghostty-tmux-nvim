# Learn

Use this genre when the reader needs to understand something new: a concept, a
system, a paper, a lecture, a codebase area. It replaces the old `teaching`
genre. The rules come from the visual-artifacts teaching pages, translated to
markdown.

## Mode, pacing and depth

- **Mode.** Learn is the default. Write a _quick review_ (the answer and the key
  figures first, one screen) or a _full review_ (every part and every check, for
  revision) only when the reader asks.
- **Pacing.** Assume basic knowledge of the field unless memory or the reader
  says otherwise. Run `sb find "<topic>"` (second-brain-obsidian) first: where
  the vault covers a concept, give a two-line recap and link the note; where it
  has a gap, build the idea slowly. A slow build reaches the same depth. When
  `sb` is not available, pace from memory and say so in one line under Sources.
- **Depth.** What the reader asks for. Unstated, academic and learning-tech
  topics go to research depth (an MIT or Stanford graduate course: mechanisms,
  the numbers, the trade-offs, the papers). Other topics stop at working depth.

## Outline

```text
# Title                    what the reader will be able to explain
> [!tldr]                   the whole idea in at most 60 words
## Worked example: …        one end-to-end case with real numbers
## <part>                   one idea each, in dependency order
   …                        a representation, a tie back to the example,
                            then a check question with a folded answer
## Trade-offs and failure   where it breaks, and what people get wrong
## Test yourself            2 or 3 open questions, each with a folded rubric
## Sources                  primary sources, and the vault notes it builds on
```

## Rules

- **The worked example comes first.** It is one concrete case, followed from
  start to end, with real numbers: one request through a server, one semaphore
  handing off between two threads, one gradient step. Every later part returns
  to it: "In the example, this is the 142 ms prefill." A reader who has seen the
  whole case once can place every part.
- **Payoff before notation.** Show what a symbol buys before you define it.
  Define each symbol in words on first use, next to the line that uses it.
- **One idea per part.** A part that needs two headings is two parts. Each part
  opens with its point in one sentence, then shows it.
- **Each part gets a representation.** Pick it from the table in SKILL.md: a
  Mermaid flow or state diagram, a table, a derivation, a rendered d2 diagram, a
  chart. A part that is only prose must justify itself by being short.
- **Derivations go step by step.** Number the steps. Each step is one sentence
  saying what happens, then one `$$` line. Plug the example's numbers into the
  last step.
- **Check after each part.** Use the format below. Distractors are plausible:
  each is a real misconception, the same length and shape as the answer. Vary
  the answer's position. The folded answer gives the reason in one sentence,
  then one line per wrong option. Keep it under about 60 words.
- **Open questions end the doc.** Two or three questions the reader answers in
  their own words, each with a folded rubric of about five points. The reader
  can paste a question, their answer and the rubric into Claude to be graded.
- **Where sources disagree,** add one `> [!warning]` line in the part, and put
  the detail under Sources.
- **Keep the reader's attention on the idea.** No history of the field unless it
  explains the design. No list of every feature: teach the few that carry the
  idea.

## Check format

```markdown
> [!question] Check
>
> R decodes alone at 10.5 ms per token. What limits one decode step?
>
> - a. Attention over the 2,000 cached tokens of the request.
> - b. Reading 35 GB of weights from memory on each GPU.
> - c. The all-reduce between the four GPUs after each layer.

> [!success]- Answer
>
> **b.** 35 GB at 3.35 TB/s is 10.4 ms; the math takes 0.07 ms. (a) is 0.05 ms
> for one 2k sequence. (c) adds about 1 ms, not 10.
```

Keep the marker line short (`Check`) and put the question in the body, so
prettier cannot wrap it out of the title. The question callout stays open; the
answer callout folds with `-`. The validator checks that the answer is folded
and that its option is not much longer than the others (`answer-visible`,
`options-uneven`).

## Open question format

```markdown
### 1 · Size the decode pool

Estimate the batch per instance under a 20 ms TPOT target. Show the steps.

> [!abstract]- Rubric · 5 points
>
> 1. Step time is the weight read plus the KV read per sequence.
> 2. Solves for the batch where the step meets 20 ms.
> 3. Checks the KV memory fits.
> 4. Converts to tokens per second.
> 5. Checks compute stays under the memory time.
```

## Quick review and full review

A quick review keeps the TLDR, replaces the worked example with a one-screen
summary table (idea, the one-line why, the key number), and keeps one figure per
major idea. A full review keeps every part and every check, and adds a "Common
mistakes" table. Both still define every term.
