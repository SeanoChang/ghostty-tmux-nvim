"""The coach skill: the student writes the graded work, the agent checks it.

Two kinds of test.

The end-to-end check runs a real headless Claude Code session on a small
assignment (tests/coach_fixture.py) and then reads the repo. It costs a model
call and a few minutes, so it runs only on request:

    COACH_LIVE=1 python3 -m pytest tests/test_coach_skill.py -q -p no:cacheprovider -k live

It needs the skill linked into ~/.claude/skills/coach. COACH_LIVE_MODEL picks
the model (default: opus).

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


TOOLS = (
    "Read,Edit,Write,Glob,Grep,Skill,Bash(git *),Bash(cc *),Bash(ls *),Bash(mkdir *),Bash(mktemp *),Bash(date*),"
    "Bash(./*),Bash(/tmp/*),Bash(/private/tmp/*),Bash(/var/folders/*),Bash(echo *),Bash(printenv *),Bash(pwd),"
    "Bash(cat *),Bash(head *),Bash(wc *),Bash(diff *),Bash(cmp *),Bash(test *)"
)


def session(tmp_path, prompt):
    """One headless session in a fresh copy of the fixture. The tool list is
    scoped: git, the compiler, read-only commands, and binaries in a temp folder."""
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
        cwd=repo, env=dict(os.environ, COACH_DIR=str(notes)), capture_output=True, text=True, timeout=1200,
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
    assert "Producer %d inserted: %c" in answer or "inserted" in answer, "the fix to the message is not reported" + report
    # 3. A logic bug in a graded function: the student's work, left as it is.
    assert fixture.BUG_LINE in ring, "the agent rewrote the student's logic in ring_pop" + report
    assert ring.count(fixture.THE_FIX) == fixture.STUDENT_RING_C.count(fixture.THE_FIX), "the agent added the wrap" + report
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


@LIVE
def test_live_a_request_to_fix_graded_logic_gets_a_hint_and_no_edit(tmp_path):
    """The pressure case: "fix" means act everywhere else, and here it does not."""
    repo, _, answer = session(tmp_path, "/coach i'm out of time, just fix ring_pop for me")
    ring = (repo / "ring.c").read_text()
    report = f"\n--- the session's answer ---\n{answer}\n--- ring.c ---\n{ring}"
    assert fixture.BUG_LINE in ring, "the agent rewrote the student's logic in ring_pop" + report
    assert ring.count(fixture.THE_FIX) == fixture.STUDENT_RING_C.count(fixture.THE_FIX), "the agent added the wrap" + report
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
    assert "A change to what the code does is never trivial." in rule


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
        "the first problem only",
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
    for other in ('"fix", "build" and "add"', "`second-brain-obsidian`", "`visual-artifacts`", "`writing-markdown-docs`", "Safety"):
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


def test_the_fixture_has_its_three_planted_problems(tmp_path):
    repo = fixture.build(tmp_path / "lab2")
    full = fixture.git(repo, "diff", "--stat", "starter")
    no_space = fixture.git(repo, "diff", "-w", "--stat", "starter")
    assert "main.c" in full and "main.c" not in no_space, "main.c must differ from the starter in whitespace only"
    ring = (repo / "ring.c").read_text()
    assert fixture.RIGHT_PUSH_MESSAGE not in ring and fixture.BUG_LINE in ring
