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
- **`main`, `master` and `trunk` are refused under any setting.** The hook
  denies these bases, in any letter case, even when `MERGE_GATE_BASE` names
  one. An agent that set the variable itself cannot open the gate to the
  release branch. A release branch with another name (`production`,
  `release`) is refused only because no setting names it.
- **A base name from the `gh` answer is shown in the deny reason as it is.**
  A branch named with odd characters (a no-break space, a backtick) can make
  the reason read like other text. The decision is still a deny, and only
  someone who can create a branch in the repo can choose the name.
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
  decision: the agent uses the repo's own integration branch and creates
  `dev` only when there is none. The rule lists the cases in order, and only
  Sean sets `MERGE_GATE_BASE` for a branch the gate does not know. The
  milestone PR goes from that branch to the release branch. For a repo with
  no CI, the agent opens a PR that adds a workflow, and Sean merges that first
  workflow himself.
- **The agent judges whether a repo "integrates on another branch".** When it
  cannot tell, the rule says not to create `dev` and to list the task under
  "Blocked on me". With `dev` and `develop` both present, the rule takes
  `dev`, which can be the stale one. The same holds for an abandoned `dev` in
  a repo that now integrates on a branch with another name: the rule picks
  `dev` by its name, and the gate accepts it. The work lands on a branch that
  is not a release branch, so it can be recovered.
- **Three cases in the no-CI rule are left to one sensible reading:** a PR
  that adds the first workflow can turn its own check green, and only "I
  merge the first workflow" stops the agent from merging it; a repo whose CI
  does not run on PRs into the integration branch reports "no checks" without
  being a repo with no CI; and a change to that trigger is not named as "the
  first workflow".
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

## Skills review fixes (2026-11-10)

Found by the reviewer of `claude/skills-review-fixes`, or known when the change
was made. None blocks the change.

### The sweep (`hooks/second-brain-sweep.sh`)

- **It reads every project's prompts into the calling session.** That is its
  job: a sweep across the week. The removed Stop hook listed one session only.
  A prompt that held a pasted secret is shown again, cut to 200 characters.
- **Only the first 400 characters of a prompt are read.** A concept phrase
  after that point is not seen, and two prompts that share their first 400
  characters count as one. Without the limit the sweep took 13 s on an 11 MB
  log; with it, 0.5 s.
- **The concept filter is a phrase list.** It over-matches ("what is the
  status") and misses a question with no such phrase. `--all` shows the rest.
- **The GNU `date -d` branch has no test.** Only BSD date runs on this machine.
- **No session learns of the sweep from this repo.** The second-brain-obsidian
  skill names it, and that skill lives in its own repository.
- **A one-word prompt path reads as a slash command.** A prompt that starts
  with `/etc` and a space is left out. A path with a second slash in its first
  word is kept.
- **A log file that is itself a symlink is not read.** The log folder may be a
  symlink; the logger writes plain files.
- **A sweep that runs while a session writes a large prompt** can meet a line
  that is half written. The line is counted as unreadable in the first line of
  the output. Not run as a test; inferred from how the logger writes.
- **A log file removed during a sweep stops it with exit 2.** The logger's
  30-day clean-up can do this. A second run works.
- **A read error prints two lines on stderr:** the tool's own message, then
  the sweep's.
- **A timestamp with a fraction, in the same second as the cutoff,** sorts as
  older and drops out of the window. The logger writes whole seconds.
- **A file with CR-only line ends is one unreadable line.** It is counted, not
  lost. The logger cannot write such a file.

### The validator (`writing-markdown-docs/scripts/check_doc.py`)

- **The splitter joins when it is in doubt.** A wrong cut hides a long
  sentence; a wrong join shows a warning. It forgets the open lists after a
  line that falls back to the left with no list marker, and at a change of
  quote depth, so a numbered item after such a line joins the text above it.
  Against markdown-it-py on 400,000 hostile random blocks it loses no long
  sentence and joins in 4% of blocks; the splitter before this change joined
  in 30%.
- **A list that starts past 1 right under a callout title, an image line or
  the first line of a block is joined.** The splitter takes a paragraph to be
  open unless the line above is empty or a thematic break, and only "1." may
  start a list in an open paragraph. A list that starts at 1, or sits under an
  empty quote line, is cut at each item.
- **Two cuts are the validator's own, not markdown's:** the title line of a
  callout, and an image on a line of its own. A sentence that runs across an
  image line is read as two. The parser comparison is told about both.
- **Only the first line of a callout block is a title.** Two callouts stacked
  with no empty line between them read as one, so the second title joins the
  first body.
- **The parser comparison is skipped where markdown-it-py is not installed.**
  It is installed for `python3` on this machine; nothing installs it for a
  fresh checkout.
- **A bare marker line (`+` or `1.` alone) above another marker line** makes
  `_plain` eat the line break and read the second marker as a word, which can
  end a sentence early. Pre-existing in `_plain`; the comparison with the
  parser leaves this shape out.

- **A label line and the prose on the next line are one sentence.** Markdown
  renders them as one paragraph, and a cut after a colon hid long sentences
  that were wrapped there (found by the adversary pass, fixed in the same
  change). A label over a list is still cut, at the list item.
- **Some image lines are not seen as images,** so a caption under one can
  still join it and give a false `prose-long`: a linked image, a URL with
  parentheses, alt text with brackets, a caption on the image's own line, and
  an HTML `img`. Same result as before the change.
- **No cut at a footnote definition, a `**Term**:` line, a bold label or a
  setext heading.** Same result as before the change.
- **A list block is split at every line that starts with a number,** by the
  block reader, even where markdown reads the line as a continuation.
  Pre-existing; the sentence splitter itself follows the markdown rule.
- **`_plain` takes quadratic time on a long run of `[` after `!`.** Pre-existing.
  A 32,000-character run takes over 20 s.
- **`reader-third` flags "the owner" and "the user" when they name a file
  owner or an operating-system user.** Pre-existing. Three of three such
  warnings on the OS lecture notes were false.
- **No check that an image has a `Diagram as text` block under it,** although
  SKILL.md requires one. Pre-existing. Seven of ten learning notes read on
  2026-11-10 had images with no text version.
- **A table inside a callout counts as prose.** Pre-existing.
- **Learn-genre checks do not run on vault notes.** Pre-existing and by
  design in `references/vault.md`; the 2026-11-10 diagnosis of the lecture
  notes questions that design.

### Skill and agent text

- **The writing-markdown-docs description is 1,039 characters.** The Agent
  Skills limit is 1,024. Claude Code 2.1.319 lists it in full. The
  visual-artifacts description is 1,565 and the list cuts its last line.
- **The builder rule to load the markdown skill is text only.** Nothing checks
  that a subagent ran `check_doc.py`. A hook that runs it after each write was
  offered on 2026-11-10 and declined.

## Global rules additions (2026-11-10)

Minor findings from the review of the design, time-box, outside-in and tier 2
lines in `config/claude/CLAUDE.md`. None is fixed.

- **"At each milestone" in the time box reuses a defined word.** Elsewhere in
  the file a milestone ends with the PR to the release branch. A short time box
  has no such milestones, and the rule does not ask for timed checkpoints in
  the plan, so "the clock against the plan" has little to measure against.
- **The time box does not say what happens when the must-haves alone run
  over:** run past the time, or drop a must-have.
- **"First one end-to-end check" has two readings:** before the feature code,
  or first among the tests. The reason for the rule is the first reading.
- **"Keep such checks few" can read as few checks of any kind.** It means few
  end-to-end checks.
- **"Run in CI" has a side effect.** Adding the check to a workflow is a CI
  change, so it is tier 2 and its own PR. A repo with no CI cannot meet the
  rule until its first workflow is merged.
- **"Take the smallest" does not say smallest in what.** It means the fewest
  parts, not the least build effort.
- **The time-box trigger phrases can fire by accident** ("the cron runs in
  2h"), and the row does not say whether "in 3h" counts. The "faster" and
  "continue" rows have the same weakness.
- **`tests/test_global_rules.py` catches a deleted phrase only.** It misses a
  negated rule, a phrase moved into another rule, and the parts it does not
  pin (the table row, the clock report, "run in CI"). The repo has no CI, so
  the test runs only when someone runs it.
- **The size cap counts the file without its HTML comments.** Claude Code
  2.1.319 leaves them out when it loads the file. If a later version loads
  them, the cap undercounts by the size of the comment (302 characters today).

## Worker definitions (`config/claude/agents/`, 2026-11-10)

- **The cast is checked against its source only on request.** The seven role
  names and jobs are copied into `tests/test_worker_roles.py`. The test that
  compares them with the source file runs only when `WORKER_CAST_SOURCE` is
  set; without it, a change in the source goes unseen here.
- **`manifest.txt` has no line for `config/claude/agents`.** Pre-existing: the
  six definitions are linked into `~/.claude/agents` by hand, one file each,
  so a fresh install gets none of them.
- **The planner's model and effort are a choice, not a measurement:** Opus at
  medium effort, because a wrong step costs a builder round.
- **The planner is limited to a task that a builder or Codex will take.** The
  rules keep design and dependent work in the lead, so a planner for every
  task would give them two readings. A wider planner needs that rule changed
  first.
- **The two new definitions are linked into `~/.claude/agents` by hand on this
  machine** (2026-11-10), like the other four. A session loads agent types
  when it starts.
- **`tests/test_worker_roles.py` matches the job sentence as a phrase.** A
  definition that quotes the job and then states another one still passes.
- **The scout's vault rule is one line of text.** It cannot load the
  `second-brain-obsidian` skill, so it knows only `sb find`.
- **"Read-only" for the verifier, adversary, planner and scout is a rule in
  their text.** They have no Edit or Write tool, but Bash can still write.
- **`planner.md` uses "cut" in two senses:** where a task could be split, and
  a step to drop under a time budget.
- **"When the brief gives a time budget" in `planner.md` can also mean the
  `Budget` line** that every brief has. On that reading every plan marks its
  steps as must-have or cut, which is harmless.
- **The builder has no "no second end-to-end check" line.** The planner has
  one. A builder that reads the Features rule literally can add an end-to-end
  check for its own piece: an extra check, not a wrong one.
- **The planner test pins the limit, not the exclusions.** The description's
  "not for a task the lead builds itself, not for a small task" can be removed
  with no failing test.
- **Bash is on every reporting worker's tool list, with no scope.** The
  verifier and the adversary run tests and probes with it. A list of allowed
  Bash commands per worker was suggested by the automated security check on
  2026-11-10 and not built: it belongs in `settings.json.tmpl`, which is a
  change of its own.
- **The scout's WebFetch has no domain list.** It is the one worker that
  reaches the web, and it runs as the user.
- **The builder and the scribe keep every tool except Agent.** They write
  files, so a list of allowed tools would have to name each one they may need.

## Design skills (`premise-check`, `shape`, 2026-11-10)

- **`shape` was checked by a dry run, not by a real session.** A fresh agent
  followed steps 1 to 4 on a past assignment, with its own recommended option
  in place of each answer. The clock, the dialog and the user's vetoes were not
  exercised. The dry run read the first text of the skill. It asked 14
  questions against a budget of ten, because that text did not say which
  questions count. The rules that came after it have not been run at all:
  which questions count, what happens when a step's time or the whole box is
  up, and the session's cut list.
- **The first review failed `shape` for one cause, three times over:** a rule
  in the skill met a rule in another file (the time box in CLAUDE.md, the
  first task in the plan genre, the fresh reader against "stop when the time
  is up") with nothing to say which applied. The skill now has a "Which rule
  applies" section, and `tests/test_design_skills.py` compares the two sides
  for the cut direction, the decision columns, the doc sections and the first
  task. A new rule in another file on one of these cases is not seen by the
  tests.
- **The size cap for the two skills was raised from 9,000 to 12,000
  characters** to hold that section and the clock rules. `shape` is about 11,600.
- **The session's cut list has three items.** When all three are dropped and
  the session is still behind, only the step rule is left: a step closes when
  its time is up, and what was not asked becomes a default.
- **The fresh reader's check has no time limit of its own.** It starts before
  the doc is written. When the box ends first, the check is listed under Open
  items and its result arrives after the session.
- **"Which rule applies" names the other files by their rule, not by line.**
  A reader must find "the time box" in CLAUDE.md by its name.
- **The tests for the two skills are pinned phrases, plus four comparisons
  with other files.** A rule that is reworded with the same meaning fails a
  test; a rule that is negated in other words passes.

Minor findings from the re-check of the fix (commit `2d7f2c0`, pass). The
first three are more cases of the cause named above, and each fails safe:

- **"Step 5 says only what goes into each section" is not exact.** Step 5
  also adds two sections that the design genre's outline does not have: Build
  order and Open items.
- **"Never dropped" does not say that the two stop rules give way to it.** A
  step that runs out of time "opens nothing new", and step 1 can run out
  before the "Done when" commands are written. The whole box can end in step
  5 before the fresh reader's check is started.
- **A doc written when the whole box is up has no `> [!tldr]`.** The genre
  puts it first, and the skill writes only Decisions, Failure modes and Open
  items at that point. The missing summary is listed under Open items.
- **"The third approach" is not defined.** When the session cut list drops
  one approach of three, nothing says that the smallest one that meets every
  P0 is kept.
- **Three changes pass the tests:** "the reverse of build order" turned into
  "build order"; "start it before you write" turned into "after the doc is
  written"; and "this skill starts no other agent" replaced by a line that
  allows one.
- **`premise-check` was checked on one past case** whose outcome was known.
- **The trigger words overlap.** "System design" also starts
  `second-brain-obsidian` (recall), and "design doc" starts `visual-artifacts`
  or `writing-markdown-docs`. `shape` is for the session with the user; the
  others are for the document or for recall.
- **The visual-artifacts Plan page has no clock or cut-list field.** Only the
  markdown plan reference got them.
- **Neither skill is in `manifest.txt` as its own line.** `merge
  config/claude/skills` links new skill folders on install; on this machine
  they are linked by hand.

## Codex harness (`config/codex/`, `codex-exec`, 2026-11-11)

Three changes: `config/codex/AGENTS.md` is built from `config/claude/CLAUDE.md`
and `config/codex/AGENTS.src.md`; Codex has a builder, a verifier and an
adversary agent; and `codex-run` takes a role, a worktree and a list of files
the run may change.

### By design

- **`CLAUDE.md` is the root, and `AGENTS.md` is never edited by hand.** A hand
  edit fails `tests/test_codex_rules.py`. What is only for Codex goes in
  `AGENTS.src.md`.
- **The rule names in `CLAUDE.md` are HTML comments.** Claude Code leaves HTML
  comments out when it loads the file (seen in 2.1.319; see
  `tests/test_global_rules.py`), so the names cost a session nothing. The size
  test leaves a name line out whole, line end included.
- **Codex never merges.** `AGENTS.md` says so, and on this machine
  `~/.codex/rules/default.rules` forbids `gh pr merge`. That rules file is not
  tracked here.
- **The Codex reviewers never write the merge gate's lines.** A Codex review is
  a second opinion. The review for the tier runs on Claude.
- **The builder runs on GPT-6.1 Sol at `high`.** The numbers are in the
  `codex-exec` skill, under Evidence.

### Not enforced

- **Nothing runs the build or the tests by itself.** The repo has no CI and no
  git hook. A change to `CLAUDE.md` that is committed without a build leaves
  `AGENTS.md` stale until someone runs the tests.
- **A hash forces a look, not agreement.** When a rule that Codex has in its
  own wording changes in the root, the build stops and prints the new hash.
  Setting the hash without reading both texts gets past it. The same holds for
  the three agent files.
- **`--allow` is checked after the run, and only on the worktree.** It does
  not see a write outside the worktree; the sandbox (`-s workspace-write`) is
  what keeps Codex inside. A process the run left behind can still write
  after the check.
- **The check reads the disk, not git.** `codex-run` records each file's kind,
  size and content hash before Codex starts, keeps the record in its own
  memory, and compares after the run. Two earlier versions asked git, and git
  reads what the run can write. The first left out four cache folder names
  (found by the automated security check on `f9adeb2`). The second trusted
  ignore rules, so a run could add an ignore file and hide what it made
  (the same check, on `bd5bf1f`), and a run that committed its change showed
  "0 file(s) changed" (the verifier, on `bd5bf1f`). What the compare does not
  count: a new folder with no file in it, and a change of mode other than the
  executable bit.
- **An allowed file is not checked, and an ignored file stays in the
  worktree.** `git add -A` in the take-in step leaves an ignored file behind.
  Such a file can still sway a check that is rerun in the worktree, so the
  full check in the lead's tree is the last word.
- **A Python run leaves cache files, and they count.** A builder that runs
  `pytest` without `PYTHONDONTWRITEBYTECODE=1` and `-p no:cacheprovider` ends
  with exit 3 and a list of cache files. The lead reads the list.
- **The record costs time on a large repository.** Every file of the new
  worktree is hashed once before the run. After the run, a file is hashed
  only when it was there before with the same size. Not measured on a
  repository over 1,000 files.
- **The merge rule sees the command words only.** `codex execpolicy check`
  gives `forbidden` for `gh pr merge ...` and for `/opt/homebrew/bin/gh pr
  merge ...`. It finds no rule for `env X=1 gh pr merge ...` and for `bash -lc
  "gh pr merge ..."`. The Codex docs say the runtime splits a simple `bash
  -lc` script; that was not tested. Branch protection on GitHub is the hard
  stop.
- **A Codex agent has the permissions of its session.** "Report, do not fix" is
  an instruction to the Codex verifier and adversary, not a limit on them.
  `codex-run --worktree` gives them a tree of their own.
- **A worktree starts from HEAD.** Work that is not committed is not in it.
- **`codex-run --role` needs `python3` 3.11 or later** on PATH, to read the
  agent file. `--worktree` needs `python3` too (3.9 was tested).
- **A word in the prompt can drop the role's effort.** `codex-run` looks for
  `model_reasoning_effort` in every codex argument, the prompt included. A
  brief that only names that word makes the role's effort go unsent, with no
  message (`codex-run`, the `has_effort` line; found by the verifier, a nit).
- **Text after a comment's end, on the same line, is not a rule.** In
  `CLAUDE.md`, outside a rule, `<!-- note --> - some rule` is loaded by Claude
  Code, but the build drops the text and asks for no decision
  (`build_agents_md.py`, the comment branch of `rules`; found by the verifier,
  a nit). No such line is in the file today.

### Tested (2026-11-11, codex-cli 0.167.0)

- The suite passes at each commit of the branch; the commit messages give the
  counts. Four tests are skipped by default. Three of them ask the real
  `codex` program to render a prompt; with `CODEX_PROMPT=1` they pass.
- Deliberate breaks of `build_agents_md.py` and `codex-run`, one at a time:
  the tests failed for each (the last commit message gives the count). The
  script that makes the breaks is not in the repo.
- The `--worktree` tests also pass under macOS `/bin/bash` 3.2 with
  `python3` 3.9.
- Three live runs through `codex-run` as it was at `f9adeb2`, which asked git
  and left cache folders out, with the built rules in place as
  `~/.codex/AGENTS.override.md` for the time of the runs. They were not run
  again with the check that reads the disk:
  - `--role builder --worktree --allow` on a cache with three bugs, of which
    the given test shows one: the reply was "done", one source file changed
    in the worktree, the lead's tree stayed clean, and all hidden tests
    passed.
  - A task whose fix sits in a file under "must not touch": the reply was
    "blocked" and named the file; no source file changed. The run's `pytest`
    left nine `__pycache__` files, which today's check would list (exit 3).
  - `--role verifier` on a commit that passes its test and breaks its
    contract: verdict fail, one Important finding with the line and the
    sequence that shows it, "tier too low" raised, no file changed, and no
    `review: pass` line.
- Twelve graded runs for the choice of the builder's model: see the skill.

### Not tested

- **Codex spawning one of the agents itself** (`agent_type`) in a live
  session. The prompt test shows only that Codex offers the three.
- **The adversary role** in a live run.
- **Main worker mode under the new rules:** the short prompts, the tiers, the
  time box. Only the subagent path ran live.
- **Several `codex-run` worktrees at one time.**
- **Which model is better on hard work.** No graded task failed in either arm.
- **The install step.** `./install.sh --dry-run --only codex` lists the three
  agent links; the real run waits for the merge.
