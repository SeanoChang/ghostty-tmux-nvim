# Known limits

Findings from reviews that were real but minor, so they were logged and not
fixed. Each entry says what happens and why it was accepted.

## `config/claude/hooks/merge-gate.py`

Reviewed on 2026-11-10 at sha1 `9443fb995e1be73846dbd741a4d54f649e0e8375`.

### By design

- **A merge that does not begin the command gets no decision.** This covers
  `cd x && gh pr merge …`, an env prefix, a wrapper such as `timeout`, a path
  such as `/opt/homebrew/bin/gh`, a quoted or escaped spelling, and a leading
  comment line. The normal permission flow handles these. The hook does not
  look for a merge inside a larger command, because that needs a full model
  of bash.
- **The hook is not a security boundary.** `gh api`, `git push` to the
  integration branch, a script, and a forged review comment all go past it.
  The review comment is written by the same account by design.
- **A repo with no CI can never pass.** A check that has not registered yet
  is not visible to the hook. The rules tell the agent to propose a workflow
  in a PR; Sean merges the first one.
- **A branch with another name gets only the hook's deny reason.** The rules
  do not repeat it: the reason tells the agent to leave the PR open and
  report it under "Blocked on me", until `MERGE_GATE_BASE` is set.
- **The integration branch is known by its name.** The hook accepts `dev`,
  `develop`, `development` and `integration`. It does not ask GitHub which
  branch is the default, so a repo whose default branch has one of these
  names lets an agent merge into it. In a git-flow repo that is the intent:
  `develop` is the default branch and the integration branch. A branch with
  any other name needs `MERGE_GATE_BASE`, and then only that branch is
  accepted. `staging` is not on the list, because a merge into it often
  starts a deploy.
- **Argument errors are reported before the lookup.** A command with a bad
  flag gets only the flag errors, not the PR conditions as well.
- **A help request must be in plain words.** `gh pr merge --help | cat`, or
  help with a quote, a brace or a glob, is denied.
- **`~`, a glob or a brace in a text flag value is passed literally.** The
  rebuilt command quotes every value, so bash does not expand it.

### Minor, not fixed

- **A payload Python cannot parse gets no decision.** Examples: an integer
  of more than 4,300 digits, or nesting about 100,000 deep. The hook cannot
  read the command, and the normal permission flow applies. Claude Code does
  not send such payloads.
- **More than 1,024 inherited file descriptors make every merge a deny.**
  The reader uses `select`, which cannot take a descriptor above 1,023. It
  fails closed. `selectors.DefaultSelector` would remove the limit.
- **A valid answer close to 16 MB can use about 450 MB of memory.** The byte
  cap bounds the text, but `json.loads` builds objects about 30 times larger
  for an answer made of millions of empty objects. Real `gh` does not print
  that shape.
- **A child that `gh` leaves behind after a successful lookup keeps
  running.** The hook kills the process group only when the lookup fails.
  Real `gh` leaves no such child.
- **The hook's own stdout closed or broken gives a non-zero exit.** The
  harness could not read an answer in that case anyway.

### Tested in a real session (2026-11-10, Claude Code 2.1.319)

Headless `claude -p` runs with a fake `gh` first on PATH, in a folder that is
not a git repo:

- A valid merge written as `--match-head-commit <sha>` ran without a prompt,
  and `gh` received the rebuilt `--match-head-commit=<sha>`. So Claude Code
  applies `updatedInput` together with an allow.
- A merge without the sha, with `--admin`, or with `--delete-branch` was
  refused with the hook's reason, and `gh` was not called.
- `gh pr checks 12` and `cd . && gh pr merge …` got no decision from the hook
  and were stopped by the normal approval.

### Not tested

- A real merge on GitHub. The first one is the remaining check.
- Shell state that Claude Code adds: an alias or function named `gh`, or
  `GH_REPO` / `GH_HOST` set in the shell but not in the hook's environment.
- Whether the payload's `cwd` follows an earlier `cd` in the Bash tool. If it
  does not, a merge with no selector could look up another branch.
- Commands run under zsh. The tokenizer was compared with macOS `/bin/bash`
  3.2 only. The rebuilt command and plain-words help are safe under zsh by
  reasoning, not by test.
- `gh` versions other than 2.103.3, and real GitHub answers for edge cases
  (more than 100 checks, comment paging, stale check runs).

## Review rules (`config/claude/CLAUDE.md`, `config/claude/agents/`)

Reviewed on 2026-11-10 at commit `0a4b43a`. One review read the rules for
gaps, contradictions and loops, and a second one in fresh context checked its
list. Three Important gaps were fixed: a reviewer could run a command that
needs approval, a diff could outgrow its task's tier, and no rule covered a
repo with no `dev` branch or no CI.

### Minor, not fixed

- **"Less adversary" has no rule for a re-check that reports broken.** It
  allows one adversary pass and one re-check. A broken re-check is the second
  failure, and the third round never comes. The merge gate still needs
  ` adversary=held`, so the merge is denied: it fails safe.
- **No rule says a branch must be up to date with `dev` before the squash.**
  Two PRs, each reviewed against an older `dev`, can merge into a combination
  that no reviewer saw. CI on each head commit limits this.
- **The verifier's "uncommitted changes" rule does not name untracked or
  unrelated files.** One verifier leaves the review line out for an untracked
  file that is not part of the change; another keeps it.
- **A fix round can start on a finding that no refuter checked.** The refuter
  rule covers findings that reach Sean, not findings that start a fix. A false
  Important then costs one round and counts toward the limit of three.
  "Release-blocking" is not defined.
- **The Plan page example drifts from the eight-line brief.** In
  `visual-artifacts/references/plan.md` the task's Files row lists one file
  and its copied brief lists two, and the copied Files line has no "must not
  touch" part. `builder.md` ("Touch only the files in your brief") still
  bounds the edit.

### Minor, from the re-check of the fixes (not checked by a second reviewer)

- **An adversary that skips an attack because it needs approval can still
  report held.** The verifier's version of the rule forces "unverified". The
  adversary's version only moves the attack to Not tried.
- **"Tier too low" reads the tier 2 list, not `REVIEW.md`.** The verifier
  checks the diff against the list in its own step 4. A path that a repo's
  `REVIEW.md` names as always tier 2 may not raise the tier.
- **The milestone rule assumed `dev`.** Closed on 2026-11-10 by Sean's
  decision: the agent uses the branch the repo already integrates on,
  whatever its name, and creates `dev` only when there is none. The milestone
  PR goes from that branch to main. For a repo with no CI, the agent opens a
  PR that adds a workflow, and Sean merges that first workflow himself.
- **No rule covers a task that depends on a blocked, unmerged task** (older
  than this change): build on its branch, or skip it.

## `config/claude/skills/brief-artifact`

Reviewed on 2026-11-10: verifier pass and adversary held at commit `f6a135e`
(option cards and the section pane), and before that at `c210cd4`.
The first verifier pass was at `65ac836`. The adversary then found two
Important breaks, both fixed: a `data:image` link passed the parser's own link
check, and nesting past the parser's limit of 20 dropped the rest of the file
without an error.

### By design

- **A link target that is not `http`, `https`, `mailto:` or `#` stays as
  text.** This includes relative paths. `[text]()` keeps its text and is not
  a link.
- **Nesting deeper than six lists or thirteen quotes is an error.**
- **Answers are not kept across a reload**, and the page sends nothing back.
- **No images, math, charts or raw HTML.** Raw HTML is shown as text.
- **A callout inside a list item, and a lead of more than one paragraph, are
  plain quotes.**

### Minor, not fixed

- **A `## ?` decision whose list has no bold label becomes a free answer with
  no warning.** The build summary still says "free answer" for it. A list in
  a decision body can be ordinary context, so the script cannot refuse it.
- **An h2 that starts with `?` is always a decision.** `## \? Text` is one
  too, because the parser joins the escaped character back into the text.
- **No space is needed after the `?`.** `## ?**Bold** text` is a decision.
- **A build that fails leaves an earlier page at the output path.** The exit
  code is 1 and nothing new is written, but the old file can still be
  published by mistake.
- **A pick-one answer cannot be cleared.** After a click, or after "Use
  recommendations", a radio group has no way back to "(no answer)". The
  reader can pick another option or write a note.
- **A file that starts with a byte-order mark is refused with "found 0
  titles".** It fails safe, but the message does not name the cause.
- **A callout kind of 40 or more letters scrolls the page sideways at
  320 px.** The six known kinds are short.
- **`PYTHONIOENCODING=ascii` with a non-ASCII title ends in a traceback**
  after the page is written. The default environment prints UTF-8.
- **An unclosed code fence takes every decision after it.** A pasted markdown
  file with its own fences can close the outer fence early and open one that
  runs to the end of the file. The text stays on the page as code, and the
  build summary shows the lower decision count. This is how CommonMark reads
  the file.
- **`[text]()` is drawn like a link but does nothing.** The empty target is
  removed, and the link colour and underline stay.
- **The nesting limit counts a list as two levels and a quote as one,**
  against 14. SKILL.md gives only the pure cases (six lists, thirteen quotes).
- **A pane entry used from the keyboard scrolls to its part but keeps the
  focus.** The next Tab continues through the pane, not into the part. A
  mouse or touch reader is not affected.
- **No test needs the rule "a clicked pane entry stays current until the
  reader scrolls".** The rule works (a reviewer probed it with short last
  parts), but removing it leaves the suite green. This is the second rule
  that was found with no test of its own.

### Not tested

- The copy button in the Claude desktop viewer, Safari and Firefox. The tests
  run in Chromium. One test makes the page behave like an engine that
  replaces the text node on each write, for the select-the-reply fallback.
- Contrast of text on the semi-transparent inline-code background.
