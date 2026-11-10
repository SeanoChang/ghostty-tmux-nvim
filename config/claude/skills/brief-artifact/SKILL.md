---
name: brief-artifact
description: Put a decision, or a short build or review report, in front of Sean as a clean article-style page with a "Copy response" button. Write a short markdown file, run one script, publish the page as an Artifact; he picks options and pastes the reply into the chat. Use when a question has options whose trade-offs need a table, code or a few paragraphs to judge, when two or more decisions are open at one time, when he says "brief", "brief me", "decision page", "quick question page", or "put the choices on a page", or for an end-of-build or review report of under 900 words that he should read outside the terminal. Not for a yes/no or one-line question (ask in chat), not for learning pages, guides, prototypes or Plan pages (visual-artifacts), and not for documents kept in a repo or vault (writing-markdown-docs).
---

# brief-artifact

A brief is one short page: what Sean must decide, the options, and the evidence.
He reads it in the Artifact viewer, picks options, and presses **Copy
response**. The reply is plain text that he pastes into the chat.

You write markdown. `scripts/build.py` makes the page, so do not write HTML or
CSS, and do not load `artifact-design` or `visual-artifacts` for a brief. The
script carries the page contract, and it loads nothing from the network.

## Steps

1. Write `brief.md` in the scratchpad, in the format below.
2. Build it:

   ```bash
   python3 ~/.claude/skills/brief-artifact/scripts/build.py <scratchpad>/brief.md
   ```

   An error (exit 1) means he could not answer the page: fix the markdown. Fix
   each `warning:` line too, or be ready to say why it stands.
3. Publish `brief.html` with the Artifact tool: `file_path`, an `icon` such as
   `question` or `report`, and a one-sentence `description`. Do not call
   `quickstart`. To change a published brief, edit the markdown, build again and
   publish the same path.
4. In chat, give the link and one line that says what he has to answer. Do not
   repeat the page.
5. His reply starts with `Response to brief:`. It is his answer: act on it.
   - `→ B. Label` picks the option with that letter in your markdown.
   - `→ (no answer)` is not a yes. Do not read it as the recommended option.
     If the work needs that decision, ask once more in chat.
   - `→ (none of the options)` comes with a `Note:` that says what he wants.
   - `Note:` and `Comment:` are instructions from him.

## The markdown

```markdown
# Merge gate approach

> Two choices before I wire the hook.

The hook failed review three times on one bug class.

## ? How should the hook treat a merge inside a larger command?

One or two sentences he needs before he can choose.

- **Gate plain merges only** (recommended) — Closes the class. `cd x && gh pr merge` prompts.
- **Narrow the separators** — A fourth patch of the same kind.
- **No hook** — You keep approving each merge.

Text here shows under the options: the cost of the recommended one.

## ?+ Which fixes do I apply?

- **Task card** (recommended) — Add Tier, Files and Budget.
- **Plan brief** (recommended) — The copied brief gets all eight lines.

## ? Anything else before I start?

## Evidence

> [!warning] Not tested on zsh
> The tokenizer was compared with bash 3.2 only.

| Check | Result |
| --- | --- |
| `pytest tests/test_merge_gate.py` | 241 pass |
```

| Markdown | On the page |
| --- | --- |
| `# Title` | The title. Exactly one, first in the file, two to four words. |
| `> text` directly under the title | The lead: one line that says what he must decide. |
| `## ? Question` with a list | Pick one. Each item is `- **Label** — what it means`. |
| `## ?+ Question` with a list | Pick any number. |
| `## ? Question` with no list | A free answer. |
| `(recommended)` after a label | The Recommended mark. One per pick-one decision. |
| `> [!note]`, `tip`, `important`, `warning`, `caution`, `done` | A callout with that word. A title can follow on the same line. |
| Anything else | Normal markdown: headings, lists, tables, code, links, quotes. |

A decision runs from its `## ?` heading to the next `##` heading. Text before
the list shows above the options, and text after it shows below them. Every
decision gets a note box, and the page ends with one comment box. When any
option is recommended, a "Use recommendations" button sets each decision that
has a recommendation to its recommended options, and clears his other picks
there.

Options are cards with a letter key: round for pick one, square for pick any.
A picked card gets an ink outline and a filled key. On a window 900 px or wider, a left
pane lists the decisions and every `## ` section in page order, marks the part
in view, and fills a decision's number when it is answered. Give each section
a short `## ` heading, because the pane shows two lines of it at most.

Not supported: images, raw HTML (it is shown as text), math and charts. A page
that needs those is a visual-artifacts page.

Two limits protect the page from pasted material:

- A link works only when its target starts with `http://`, `https://`,
  `mailto:` or `#`. Any other target, a relative path included, stays as text.
- Lists nest to six levels and quotes to thirteen. Deeper nesting is an error,
  because the parser would drop the rest of the file. Put a pasted tree in a
  code block.

## Writing a brief

- **Decisions first, evidence after.** He opens the page to answer. Put only
  what he needs to choose above each question.
- **One recommendation per decision, and say why** in a sentence near the
  options. The script warns when a decision has none.
- **Labels are two to five words. The text after the dash is one or two
  sentences**: what happens, and what it costs.
- **Ask only what is his to decide.** A choice with a conventional default is
  not a decision: pick it and say so in the evidence.
- **A report with no decision is fine.** Leave out every `## ?` heading, and
  the page has no response bar. Report confirmed findings first with
  `file:line`, each marked introduced or pre-existing, then the refuted and
  unverified counts, then what was not covered.
- Write as the global rules say: one idea per sentence, plain words, the main
  point first.
- Limits: 900 words and six decisions. The script warns above either. A longer
  page is a Guide (visual-artifacts) or a document.

## What the page does not do

- It sends nothing back. He must paste the reply.
- It does not keep answers across a reload.
- "Copy response" tries the clipboard, then the older copy command. When the
  viewer blocks both, it selects the reply text and tells him to press Cmd+C.

## Tests

```bash
python3 -m pytest ~/.claude/skills/brief-artifact/tests -q -p no:cacheprovider
```

`test_build.py` covers the markdown rules and the page contract.
`test_page.py` drives the page in headless Chromium: the reply text against a
second version on random briefs, both copy fallbacks, no sideways scroll from
320 px, both themes, text contrast, the option keys, the section pane, and
that the page makes no request.
