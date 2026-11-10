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
  is not visible to the hook.
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
- **The milestone rule still assumes `dev`.** "Open one PR from `dev` to main"
  has no reading in a repo with no `dev` branch. This is the second gap of one
  class: the rules assume `dev` and CI. It waits for Sean's decision on what
  such a repo should do.
- **No rule covers a task that depends on a blocked, unmerged task** (older
  than this change): build on its branch, or skip it.

## `config/claude/skills/brief-artifact`

Reviewed on 2026-11-10 at commit `65ac836`.

### By design

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

### Not tested

- The copy button in the Claude desktop viewer, Safari and Firefox. The tests
  run in Chromium. One test makes the page behave like an engine that
  replaces the text node on each write, for the select-the-reply fallback.
- Contrast of text on the semi-transparent inline-code background.
