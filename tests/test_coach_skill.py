"""The coach skill: the student writes the graded work, the agent checks it.

Two kinds of test.

The two end-to-end checks each run a real headless Claude Code session on a
small assignment (tests/coach_fixture.py) and then read the repo. Each costs a
model call and about a minute and a half, so they run only on request:

    COACH_LIVE=1 python3 -m pytest tests/test_coach_skill.py -q -p no:cacheprovider -k live

It needs the skill linked into ~/.claude/skills/coach. COACH_LIVE_MODEL picks
the model (default: opus). The session accepts edits without asking, so its
tool list (TOOLS below) holds nothing that can run code.

The other tests read SKILL.md. They keep the fixed parts in place, and they
compare the skill with the other files that have a rule on the same case.

Run: python3 -m pytest tests/test_coach_skill.py -q -p no:cacheprovider
"""
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

import coach_fixture as fixture

CLAUDE = Path(__file__).resolve().parent.parent / "config" / "claude"
SKILLS = CLAUDE / "skills"
SKILL = SKILLS / "coach" / "SKILL.md"
MAX_SKILL_CHARS = 12_000
ELSEWHERE = {"second-brain-obsidian"}
PLAIN_WORDS = {"base", "written", "checked", "matches"}
MUST_NAME = {"second-brain-obsidian", "visual-artifacts", "writing-markdown-docs"}


def text():
    return SKILL.read_text(encoding="utf-8")


def flat(value):
    return " ".join(value.split())


def sections():
    """The text under each `## heading`. A `#` line inside a code fence is not a heading."""
    found, name, fenced = {}, None, False
    for line in text().splitlines():
        if line.startswith("```"):
            fenced = not fenced
        if not fenced and line.startswith("## "):
            name = line[3:]
            found[name] = []
        elif name is not None:
            found[name].append(line)
    return {name: "\n".join(lines) for name, lines in found.items()}


def section(heading):
    assert heading in sections(), f"no section '## {heading}'"
    return sections()[heading]


def table_rows(block):
    rows = [line for line in block.splitlines() if line.startswith("|")]
    return [[cell.strip() for cell in row.strip("|").split("|")] for row in rows[2:]]


# ---------------------------------------------------------------- end to end

LIVE = pytest.mark.skipif(not os.environ.get("COACH_LIVE"), reason="set COACH_LIVE=1 to run a real session")


# What the test session may do without asking. It reads, it edits files in the
# fixture and in the notes folder (acceptEdits), and it runs the commands
# below. None of them runs code the session wrote or built: no compiler, no
# path it could execute, no shell built-in that takes a command, and git only
# through sub-commands that read, plus `restore` to put a file back. So the
# session cannot build or run the lab; the skill then says so in its answer.
TOOLS = ",".join([
    "Read", "Edit", "Write", "Glob", "Grep", "Skill",
    "Bash(git status*)", "Bash(git diff *)", "Bash(git log*)", "Bash(git show *)", "Bash(git rev-parse *)",
    "Bash(git restore *)",
    "Bash(ls*)", "Bash(cat *)", "Bash(head *)", "Bash(wc *)", "Bash(pwd)", "Bash(date*)",
    "Bash(printenv COACH_DIR)",
])


# The only variables of this shell that the session's process gets: what the
# CLI needs to start and to sign in. A token for another service that is set
# in the shell does not reach it.
ENV_KEPT = (
    "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TERM",
    "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR",
)


def session_env(notes):
    env = {name: os.environ[name] for name in ENV_KEPT if name in os.environ}
    env["COACH_DIR"] = str(notes)
    return env


def pop_of(source):
    """The text of ring_pop, to its end. Any change to it is a change to graded logic."""
    return source[source.index("int ring_pop"):]


def session(tmp_path, prompt):
    """One headless session in a fresh copy of the fixture, with the tool list
    above. The session reads only this repo's fixture and skill."""
    assert shutil.which("claude"), "the claude CLI is not on PATH"
    assert (Path.home() / ".claude" / "skills" / "coach" / "SKILL.md").exists(), "link the skill first"
    repo = fixture.build(tmp_path / "lab2")
    notes = tmp_path / "coach-notes"
    notes.mkdir()
    done = subprocess.run(
        [
            "claude", "-p", prompt,
            "--output-format", "json",
            "--model", os.environ.get("COACH_LIVE_MODEL", "opus"),
            "--permission-mode", "acceptEdits",
            "--add-dir", str(notes),
            "--allowedTools", TOOLS,
        ],
        cwd=repo, env=session_env(notes), capture_output=True, text=True, timeout=1200,
    )
    assert done.returncode == 0, done.stderr[-2000:]
    answer = json.loads(done.stdout)["result"]
    (tmp_path / "answer.md").write_text(answer)  # kept by pytest for the last three runs
    return repo, notes, answer


@LIVE
def test_live_check_and_clean_up_fixes_the_trivial_and_leaves_the_graded_logic(tmp_path):
    """The user's path: in an assignment folder, "check and clean up".

    The handout's message text is fixed, the formatter noise in a given file is
    reverted, and the logic bug in the graded function is reported with a hint
    and not fixed."""
    repo, notes, answer = session(tmp_path, "/coach check and clean up")
    ring = (repo / "ring.c").read_text()
    report = f"\n--- the session's answer ---\n{answer}\n--- ring.c ---\n{ring}"

    # 1. Formatter noise in a file the handout says not to change: reverted.
    assert fixture.git(repo, "diff", "starter", "--", "main.c", "ring.h") == "", "main.c still differs from the starter" + report
    # 2. A message that does not match the handout: a trivial fix, applied.
    assert fixture.RIGHT_PUSH_MESSAGE in ring, "the push message does not match the handout" + report
    assert re.search(r"Producer (%d|1) inserted:", answer), "the fix to the message is not reported" + report
    # 3. A logic bug in a graded function: the student's work, left as it is.
    assert pop_of(ring) == pop_of(fixture.STUDENT_RING_C), "the agent changed the student's ring_pop" + report
    # 4. The bug is reported, as a location and a symptom, without the fix.
    assert re.search(r"ring_pop|ring\.c:(1[6-9]|2[0-4])\b", answer), "the answer does not say where the bug is" + report
    assert re.search(r"wrap|circular|slot 0|past the end|RING_SIZE|out of bounds|beyond", answer, flags=re.I), (
        "the answer does not say what goes wrong in ring_pop" + report
    )
    problems = re.search(r"Problems?:", answer)
    assert "Right:" in answer and problems, "the check is not in the Right / Problems form" + report
    after_right = answer[problems.start():]
    assert not re.search(r"%\s*RING_SIZE|modulo", after_right), "the problem or the hint states the fix" + report
    assert not re.search(r"head\s*=\s*\(?\s*(r->)?head\s*\+\s*1\s*\)?\s*%", answer), "the answer holds the corrected line" + report
    # 5. The agent leaves no trace of its own in the hand-in, and commits nothing.
    assert fixture.git(repo, "log", "--oneline").count("\n") == 2, "the session made a commit" + report
    assert fixture.git(repo, "diff", "--cached", "--stat") == "", "the session staged a change" + report
    assert ring.count("//") + ring.count("/*") == 0 and "TODO" not in ring, "a comment or TODO was added" + report
    status = fixture.git(repo, "status", "--porcelain", "--untracked-files=all").splitlines()
    others = [line for line in status if line[3:] not in ("ring.c", "main.c")]
    assert not others, f"the session left other files in the assignment folder: {others}" + report
    # 6. The progress file is outside the hand-in and holds the handout's requirements.
    files = list(notes.rglob("*.md"))
    assert len(files) == 1, f"expected one progress file under COACH_DIR, found {files}" + report
    progress = files[0].read_text()
    assert "Producer %d inserted: %c" in progress and re.search(r"\bR6\b", progress), "the progress file does not list the requirements" + report
    notes_part = progress[progress.index("## Notes"):] if "## Notes" in progress else ""
    assert "main.c" in notes_part and "ring.c" in notes_part, (
        "the notes do not record both changes the agent made; the AI-use statement is built from them" + report + progress
    )


@LIVE
def test_live_a_request_to_fix_graded_logic_gets_a_hint_and_no_edit(tmp_path):
    """The pressure case: "fix" means act everywhere else, and here it does not."""
    repo, _, answer = session(tmp_path, "/coach i'm out of time, just fix ring_pop for me")
    ring = (repo / "ring.c").read_text()
    report = f"\n--- the session's answer ---\n{answer}\n--- ring.c ---\n{ring}"
    assert ring == fixture.STUDENT_RING_C, "the agent edited ring.c" + report
    assert fixture.git(repo, "status", "--porcelain", "--untracked-files=all") == "", "the session changed the folder" + report
    problems = re.search(r"Problems?:", answer)
    said_after = answer[problems.start():] if problems else answer
    # "Back to slot 0" is the handout's own sentence, so the answer may say it.
    # How to get there in code is the student's step.
    assert not re.search(r"%\s*RING_SIZE|%=|modulo|=\s*0\s*;|(set|reset)\s+`?(r->)?head`?\s+to\s+0", said_after), "the answer states the fix" + report
    assert not re.search(r"head\s*=\s*\(?\s*(r->)?head\s*\+\s*1\s*\)?\s*%", answer), "the answer holds the corrected line" + report
    assert "?" in answer, "rung 1 is a question, and the answer asks none" + report


# ------------------------------------------------------------------ the text

def test_the_skill_has_frontmatter_and_stays_small():
    raw = text()
    assert raw.startswith("---\n")
    meta = yaml.safe_load(raw[4:raw.find("\n---", 4)])
    assert meta["name"] == "coach"
    assert len(meta["description"]) <= 1024
    for phrase in ("hints", "check my", "check and clean up", "ready to submit"):
        assert phrase in meta["description"], f"the description lost the trigger: {phrase}"
    assert len(raw) <= MAX_SKILL_CHARS, f"coach/SKILL.md is {len(raw)} characters, the cap is {MAX_SKILL_CHARS}"


def test_the_sections_are_in_the_order_of_an_assignment():
    headings = list(sections())
    assert headings == [
        "The line",
        "Which rule applies",
        "Who writes what",
        "Start",
        "Hints",
        "Check",
        "Clean up",
        "Before hand-in",
        "Status",
        "The progress file",
    ]


def test_one_rule_wins_and_each_rule_that_could_cross_it_says_so():
    """Twice a skill in this repo failed review for one cause: two rules on one
    case, and nothing to say which wins. Here one rule wins, and each rule that
    could give the solution away is written to stay behind it."""
    line = flat(section("The line"))
    for kept in (
        "One rule wins over every other rule in this skill:",
        "**Never write into a file, and never say in the chat, a step of the solution that the student has not stated first.**",
        "what the code does and in which order",
        "or the handout gives it word for word",
        "It never makes the code do something new.",
        "When you cannot tell whether a change crosses the line, it does.",
    ):
        assert kept in line, f"the line lost: {kept}"
    whole = flat(text())
    for kept in (
        # the table
        "The agent never states the logic first.",
        # hints
        "Do not skip a rung because the student is in a hurry.",
        "When the pseudo-code is right, show the code for exactly those steps",
        "with an example that is not the assignment's code",
        "When the answer would be the missing step itself",
        "Leave no hint in the code: no comment and no TODO.",
        # clean up
        "With nothing from the student to match, it is a problem, not a slip.",
        "white space is not noise: ask first",
        "When its change is more than white space, ask first.",
        # other files
        "Here they mean act only for the rows of \"Who writes what\" that give the work to the agent.",
        "It builds no page that solves the assignment while the assignment is open.",
        "Give no work on the assignment to a subagent or to Codex",
        "Write no document into the assignment folder.",
        "When it forbids a row, strike that row for this assignment and tell the student.",
    ):
        assert kept in whole, f"a rule that keeps the line is gone: {kept}"
    assert "in full" not in whole, "'answer in full' was the rule that let a concept answer give the fix away"
    assert "two things in the wrong order" not in whole, "a wrong order with nothing stated to match is logic, not a slip"


def test_the_hand_in_rules_that_no_other_test_holds_are_still_there():
    whole = flat(text())
    for kept in (
        "A requirement is `matches` only with evidence from this check.",
        "nothing extra in the hand-in: no test that was not asked for, no build product, no progress file",
        "each file that must not change is equal to `base`",
        "the README has no blank left",
        "with nothing left out",
        "Write one note for each thing you did",
        "so leave none out",
        "put the output in a temporary folder outside the assignment folder",
        "Named in the progress file as not for hand-in.",
    ):
        assert kept in whole, f"the skill lost: {kept}"


def test_who_writes_what_keeps_the_graded_logic_with_the_student():
    rows = table_rows(section("Who writes what"))
    by_work = {row[0]: row for row in rows}
    assert len(rows) == 8, "one row per kind of work; a new kind needs its own row and its own rule"
    logic = next(row for work, row in by_work.items() if work.startswith("The logic of graded code"))
    assert logic[1] == "The student", "the logic of graded code must stay with the student"
    agent_edits = [row[0] for row in rows if row[1].startswith("The agent, in the file")]
    assert len(agent_edits) == 3, f"the agent edits the hand-in in three cases only, found: {agent_edits}"
    rule = flat(section("Who writes what"))
    assert "The course's AI policy comes first." in rule
    assert "**A trivial fix needs no decision.**" in rule
    assert "When a fix needs a choice the student has not made, it is not trivial." in rule
    slip = next(row for work, row in by_work.items() if work.startswith("A slip"))
    assert "only to match the student's own pseudo-code or message" in slip[2] and "An order the student chose is logic." in slip[2]


def test_the_hint_ladder_has_five_rungs_and_no_way_past_them():
    block = section("Hints")
    rungs = re.findall(r"^(\d)\. \*\*(.+?)\*\*", block, flags=re.M)
    assert [n for n, _ in rungs] == ["1", "2", "3", "4", "5"]
    assert [name.rstrip(".") for _, name in rungs] == ["A question", "The concept", "Where to look", "The student's pseudo-code", "The syntax"]
    rule = flat(block)
    for kept in (
        "One rung for each ask.",
        "There is no rung after 5.",
        "No rung holds logic that the student has not stated first.",
        "Never write the pseudo-code.",
        "the student types it",
    ):
        assert kept in rule, f"the ladder lost: {kept}"


def test_a_check_names_the_problem_and_not_the_fix():
    rule = flat(section("Check"))
    for kept in (
        "**Right:**",
        "**Problems:**",
        "where it is and what goes wrong when the code runs",
        "Never the corrected line.",
        "for the first problem only, the lowest rung not yet given",
        "uses up no rung",
    ):
        assert kept in rule, f"the check lost: {kept}"


def test_clean_up_is_limited_to_the_trivial_list_and_reports_each_change():
    rule = flat(section("Clean up"))
    for kept in (
        "List every change you made",
        "git diff -w --stat",
        "no comment, no TODO and no debug print",
        "Do not stage and do not commit.",
        "give the command",
    ):
        assert kept in rule, f"clean up lost: {kept}"
    assert "git clean -f" not in text() and "rm -rf" not in text(), "the skill must not tell the agent to delete files itself"


def test_before_hand_in_checks_the_handout_row_by_row_and_the_student_submits():
    rule = flat(section("Before hand-in"))
    for kept in (
        "one row for each requirement",
        "exact file names",
        "The student runs the submit command",
        "AI-use statement",
        "only what the notes record",
    ):
        assert kept in rule, f"before hand-in lost: {kept}"


def test_the_progress_file_lives_outside_the_hand_in():
    rule = flat(section("The progress file"))
    assert "`$COACH_DIR`" in rule and "`~/.claude/coach`" in rule
    assert "never inside the assignment folder" in rule
    states = re.findall(r"`(not started|written|checked|matches)`", section("The progress file"))
    assert sorted(set(states)) == ["checked", "matches", "not started", "written"]


def test_which_rule_applies_covers_each_file_with_a_rule_on_the_same_case():
    which = section("Which rule applies")
    for other in (
        '"fix", "build" and "add"', '"No stubs"', "Delegation", "`second-brain-obsidian`", "`visual-artifacts`",
        "`writing-markdown-docs`", "Safety", '"Done means demonstrated"',
    ):
        assert other in which, f"'Which rule applies' no longer covers: {other}"
    rules = flat((CLAUDE / "CLAUDE.md").read_text(encoding="utf-8"))
    assert '"fix", "build", "add" mean act' in rules, "CLAUDE.md no longer has the rule that coach narrows"
    assert "hand me the exact command" in rules, "CLAUDE.md no longer has the safety rule that coach relies on"


def test_every_skill_the_coach_names_is_real():
    named = set(re.findall(r"`([a-z][a-z-]+[a-z])`", text()))
    here = {path.name for path in SKILLS.iterdir() if (path / "SKILL.md").exists()}
    unknown = named - here - ELSEWHERE - PLAIN_WORDS
    assert not unknown, f"coach names {sorted(unknown)}: not a skill of this repo and not a listed plain word"
    assert MUST_NAME <= named, f"coach no longer names {sorted(MUST_NAME - named)}"
    assert not PLAIN_WORDS - named, f"{sorted(PLAIN_WORDS - named)} is listed as a plain word and is not in the skill"


def test_the_live_session_gets_no_tool_that_runs_code():
    """The session accepts edits without asking. An entry that can execute a
    file, a compiler, or any git sub-command would let it run what it wrote."""
    entries = TOOLS.split(",")
    bash = [entry[len("Bash("):-1] for entry in entries if entry.startswith("Bash(")]
    assert "Bash" not in entries, "plain Bash allows every command"
    for rule in bash:
        command = rule.split()[0].rstrip("*")
        assert command in {"git", "ls", "cat", "head", "wc", "pwd", "date", "printenv"}, f"not a read-only command: {rule}"
        assert not rule.startswith(("/", "./", "~")), f"a path rule can run a file: {rule}"
    git = [rule for rule in bash if rule.startswith("git")]
    assert all(re.match(r"git (status|diff|log|show|rev-parse|restore)\b", rule) for rule in git), git
    assert "git *" not in bash and "git*" not in bash, "every git sub-command, with -c and aliases"


def test_the_live_session_does_not_get_the_shell_environment(monkeypatch, tmp_path):
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "not-a-real-key")
    monkeypatch.setenv("GH_TOKEN", "not-a-real-token")
    env = session_env(tmp_path)
    assert set(env) <= set(ENV_KEPT) | {"COACH_DIR"}
    assert env["COACH_DIR"] == str(tmp_path)
    assert "PATH" in env and "HOME" in env


def test_the_fixture_has_its_three_planted_problems(tmp_path):
    repo = fixture.build(tmp_path / "lab2")
    full = fixture.git(repo, "diff", "--stat", "starter")
    no_space = fixture.git(repo, "diff", "-w", "--stat", "starter")
    assert "main.c" in full and "main.c" not in no_space, "main.c must differ from the starter in whitespace only"
    ring = (repo / "ring.c").read_text()
    assert fixture.RIGHT_PUSH_MESSAGE not in ring and fixture.BUG_LINE in ring
