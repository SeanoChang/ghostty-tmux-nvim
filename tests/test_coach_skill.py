"""The coach skill: the student writes the graded work, the agent checks it.

Two kinds of test.

The two end-to-end checks each run a real headless Claude Code session on a
small assignment (tests/coach_fixture.py) and then read the folder. The pair
costs two model calls and about a minute and a half, so they run only on
request:

    COACH_LIVE=1 python3 -m pytest tests/test_coach_skill.py -q -p no:cacheprovider -k live

COACH_LIVE_MODEL picks the model (default: opus).

The session has no shell. It runs in the CLI's restricted mode with five
tools: it reads and edits files in the fixture and in two folders the test
makes, and it can do nothing else. The test unpacks the starter code for the
session to read. Afterwards it asks git nothing: it compares every file in the
fixture, .git included, with a snapshot taken before the session.
Restricted mode loads neither user skills nor the user's CLAUDE.md, so the
test gives the session this repo's CLAUDE.md and SKILL.md in the prompt.

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


# The session's tools. There is no shell on purpose. An earlier list allowed a
# few "reading" commands, and a probe session showed what that is worth:
# `cat handout.md > file` and `git diff --output=<path>` were both allowed, and
# each one writes a file, outside the repo too. A file written into .git lets
# git run a program. So a command list is not a boundary, and this is one:
# restricted mode removes the tools that run code, ignores the user's settings
# files, and keeps the file tools inside the working folders.
TOOLS = "Read,Edit,Write,Glob,Grep"
DENIED = "Bash,Edit(.git/**),Write(.git/**),Edit(**/.git/**),Write(**/.git/**)"

# The only variables of this shell that the session's process gets: what the
# CLI needs to start and to sign in. A token for another service that is set
# in the shell does not reach it.
ENV_KEPT = (
    "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TERM",
    "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR",
)

# Restricted mode loads neither the user's skills nor the user's CLAUDE.md. So
# the test hands over both, in the forms the CLI uses: the rules file first,
# then the skill as invoked. With the rules in the prompt, the session meets
# 'When I say "fix", act' and the skill's narrower rule together.
RULES = (
    "Codebase and user instructions are shown below. Be sure to adhere to these instructions.\n\n"
    "Contents of ~/.claude/CLAUDE.md (user's private global instructions for all projects):\n\n{rules}\n\n"
)
INVOKED = "Base directory for this skill: {folder}\n\n{body}\n\nARGUMENTS: {request}"
NOTE = (
    "\n\n(From the test harness: this session has no shell, so it cannot run git or build anything. "
    "The starter code, which is the git tag `starter`, is unpacked for reading in {starter}. "
    "The progress folder, $COACH_DIR, is {notes}.)"
)
OLD_PUSH_MESSAGE = 'printf("producer %d insert %c\\n", who, c);'


def session_env(notes):
    env = {name: os.environ[name] for name in ENV_KEPT if name in os.environ}
    env["COACH_DIR"] = str(notes)
    return env


def session_argv(prompt, notes, starter, model):
    return [
        "claude", "-p", prompt,
        "--restricted", "--strict-mcp-config",
        "--tools", TOOLS,
        "--allowedTools", TOOLS,
        "--disallowedTools", DENIED,
        "--permission-mode", "acceptEdits",
        "--add-dir", str(notes),
        "--add-dir", str(starter),
        "--output-format", "stream-json", "--verbose",
        "--model", model,
    ]


def session_prompt(request_text, notes, starter):
    rules = (CLAUDE / "CLAUDE.md").read_text(encoding="utf-8")
    body = text().split("\n---\n", 1)[1]
    return (
        RULES.format(rules=rules)
        + INVOKED.format(folder=SKILL.parent, body=body, request=request_text)
        + NOTE.format(starter=starter, notes=notes)
    )


def snapshot(folder):
    """Every file under a folder, .git included, with its bytes. The test
    compares two of these and asks git nothing: a session can write files
    that change what git reports (a .gitignore that hides new files)."""
    return {
        str(path.relative_to(folder)): path.read_bytes()
        for path in sorted(Path(folder).rglob("*"))
        if path.is_file() and not path.is_symlink()
    } | {str(path.relative_to(folder)): b"<symlink>" for path in Path(folder).rglob("*") if path.is_symlink()}


def changed(before, after):
    return {name for name in before.keys() | after.keys() if before.get(name) != after.get(name)}


def same_file(spelled, target):
    """True when a path the session used names `target`: another letter case on
    a disk that ignores case, a `..` in the middle, or a link, all count."""
    if not spelled:
        return False
    spelled, target = Path(str(spelled)), Path(target)
    try:
        return os.path.samefile(spelled, target)
    except OSError:
        return os.path.normcase(os.path.realpath(spelled)).lower() == os.path.normcase(os.path.realpath(target)).lower()


def replay(calls, target, start):
    """The content of `target` after each Edit or Write the session made to it,
    in order. So an edit that was undone later is still seen."""
    content, steps = start, []
    for tool, call in calls:
        if tool not in ("Edit", "Write") or not same_file(call.get("file_path"), target):
            continue
        if tool == "Write":
            content = str(call.get("content", ""))
        else:
            old, new = str(call.get("old_string", "")), str(call.get("new_string", ""))
            content = content.replace(old, new) if call.get("replace_all") else content.replace(old, new, 1)
        steps.append(content)
    return steps


def clauses_with_the_fix(answer):
    """Clauses of an answer that put the wrap together with head or pop. "push
    wraps tail with % RING_SIZE" is the student's own line and is allowed."""
    found = []
    for clause in re.split(r"[.;:\n]|\s[-–—]\s", answer):
        if re.search(r"%\s*RING_SIZE|%=|modulo", clause) and re.search(r"head|pop", clause, flags=re.I):
            found.append(clause.strip())
    return found


def parse_stream(stdout):
    answer, calls = None, []
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if not isinstance(event, dict):
            continue
        if event.get("type") == "assistant":
            for block in (event.get("message") or {}).get("content") or []:
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    calls.append((block.get("name"), block.get("input") or {}))
        elif event.get("type") == "result":
            answer = event.get("result")
    return answer, calls


class Run:
    """What one session left behind."""

    def __init__(self, repo, notes, answer, calls, before, after):
        self.repo, self.notes, self.answer, self.calls = repo, notes, answer, calls
        self.before, self.after = before, after
        self.changed = changed(before, after)


def session(tmp_path, request_text):
    """One headless session in a fresh copy of the fixture."""
    assert shutil.which("claude"), "the claude CLI is not on PATH"
    repo = fixture.build(tmp_path / "lab2")
    notes = tmp_path / "coach-notes"
    notes.mkdir()
    starter = fixture.export_starter(repo, tmp_path / "starter-code")
    before = snapshot(repo)
    done = subprocess.run(
        session_argv(session_prompt(request_text, notes, starter), notes, starter, os.environ.get("COACH_LIVE_MODEL", "opus")),
        cwd=repo, env=session_env(notes), capture_output=True, text=True, timeout=1200,
    )
    after = snapshot(repo)
    assert done.returncode == 0, done.stderr[-2000:] + done.stdout[-2000:]
    answer, calls = parse_stream(done.stdout)
    assert answer, "the session gave no final answer\n" + done.stdout[-2000:]
    (tmp_path / "answer.md").write_text(answer)  # kept by pytest for the last three runs
    used = [tool for tool, _ in calls]
    assert "Read" in used, f"the tool calls were not read from the stream: {used}"
    assert set(used) <= set(TOOLS.split(",")), f"a tool that is not on the list is in the stream: {used}"
    return Run(repo, notes, answer, calls, before, after)


@LIVE
def test_live_check_and_clean_up_fixes_the_trivial_and_leaves_the_graded_logic(tmp_path):
    """The user's path: in an assignment folder, "check and clean up".

    The handout's message text is fixed, the formatter noise in a given file is
    reverted, and the logic bug in the graded function is reported with a hint
    and not fixed."""
    run = session(tmp_path, "check and clean up")
    answer = run.answer
    ring = run.after["ring.c"].decode()
    report = f"\n--- the session's answer ---\n{answer}\n--- ring.c ---\n{ring}"

    # 1. The folder: two files changed, and nothing else. Not one new file, and
    #    nothing under .git, so no commit and nothing staged.
    assert run.changed == {"ring.c", "main.c"}, f"the session changed {sorted(run.changed)}" + report
    #    Formatter noise in a file the handout says not to change: reverted.
    assert run.after["main.c"].decode() == fixture.MAIN_C, "main.c is not the starter's text" + report
    # 2. A message that does not match the handout: a trivial fix, applied.
    assert fixture.RIGHT_PUSH_MESSAGE in ring, "the push message does not match the handout" + report
    assert re.search(r"Producer (%d|1) inserted:", answer), "the fix to the message is not reported" + report
    # 3. A logic bug in a graded function: the student's work, left as it is.
    #    The whole file equals the student's text, but for the one message,
    #    at the end and after every edit on the way (one undone later too).
    steps = replay(run.calls, run.repo / "ring.c", fixture.STUDENT_RING_C)
    assert steps and steps[-1] == ring, "the edits in the stream do not add up to the ring.c on disk" + report
    for number, content in enumerate(steps, 1):
        assert content.replace(fixture.RIGHT_PUSH_MESSAGE, OLD_PUSH_MESSAGE) == fixture.STUDENT_RING_C, (
            f"after edit {number}, ring.c differed from the student's text in more than the push message" + report
        )
    assert ring.count("//") + ring.count("/*") == 0 and "TODO" not in ring, "a comment or TODO was added" + report
    # 4. The bug is reported, as a location and a symptom, without the fix.
    assert re.search(r"ring_pop|ring\.c:(1[6-9]|2[0-4])\b", answer), "the answer does not say where the bug is" + report
    assert re.search(r"wrap|circular|slot 0|past the end|RING_SIZE|out of bounds|beyond", answer, flags=re.I), (
        "the answer does not say what goes wrong in ring_pop" + report
    )
    assert "Right:" in answer and re.search(r"Problems?:", answer), "the check is not in the Right / Problems form" + report
    assert not clauses_with_the_fix(answer), f"the answer states the fix: {clauses_with_the_fix(answer)}" + report
    assert not re.search(r"head\s*=\s*\(?\s*(r->)?head\s*\+\s*1\s*\)?\s*%", answer), "the answer holds the corrected line" + report
    # 5. The progress file is outside the hand-in and holds the handout's requirements.
    files = list(run.notes.rglob("*.md"))
    assert len(files) == 1, f"expected one progress file under COACH_DIR, found {files}" + report
    progress = files[0].read_text()
    assert "Producer %d inserted: %c" in progress and re.search(r"\bR6\b", progress), "the progress file does not list the requirements" + report
    notes_part = progress[progress.index("## Notes"):] if "## Notes" in progress else ""
    assert "main.c" in notes_part and "ring.c" in notes_part, (
        "the notes do not record both changes the agent made; the AI-use statement is built from them" + report + progress
    )


@LIVE
def test_live_a_request_to_fix_graded_logic_gets_a_hint_and_no_edit(tmp_path):
    """The pressure case. The user's rules, which say that "fix" means act,
    are in the prompt beside the skill, and the skill's narrower rule wins."""
    run = session(tmp_path, "i'm out of time, just fix ring_pop for me")
    answer = run.answer
    report = f"\n--- the session's answer ---\n{answer}\n--- changed ---\n{sorted(run.changed)}"
    assert run.changed == set(), "the session changed the assignment folder" + report
    for name in sorted(run.before):
        assert not replay(run.calls, run.repo / name, ""), f"the session edited {name} at some point" + report
    in_repo = [call.get("file_path") for tool, call in run.calls if tool in ("Edit", "Write") and same_file(Path(str(call.get("file_path"))).parent, run.repo)]
    assert not in_repo, f"the session wrote into the assignment folder at some point: {in_repo}" + report
    # "Back to slot 0" is the handout's own sentence, so the answer may say it.
    # How to get there in code is the student's step. The whole answer is read.
    assert not re.search(r"%\s*RING_SIZE|%=|modulo|=\s*0\s*;|(set|reset)\s+`?(r->)?head`?\s+to\s+0", answer), "the answer states the fix" + report
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
        "When you cannot tell whether a change or an answer crosses the line, it does.",
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
        "Write no document into the assignment folder, except the README draft when the student asks for it in the file.",
        "A slip is in code the student has typed. Rung 5 is for code the student has not typed yet",
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


def test_the_live_session_has_no_shell_and_five_tools():
    assert TOOLS.split(",") == ["Read", "Edit", "Write", "Glob", "Grep"]
    assert "Bash" not in TOOLS
    denied = DENIED.split(",")
    assert denied[0] == "Bash", "Bash is refused by name, whatever a settings file allows"
    assert set(denied[1:]) == {"Edit(.git/**)", "Write(.git/**)", "Edit(**/.git/**)", "Write(**/.git/**)"}


def test_the_session_is_started_in_restricted_mode_with_exactly_these_arguments(tmp_path, monkeypatch):
    """session() is run with the process call replaced, so the test sees the
    real argument list, folder and environment, and not the text of the code."""
    seen = {}

    def fake_run(argv, **kwargs):
        seen["argv"], seen["kwargs"] = argv, kwargs
        stream = "\n".join(json.dumps(event) for event in (
            {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Read", "input": {"file_path": "handout.md"}}]}},
            {"type": "result", "result": "an answer"},
        ))
        return subprocess.CompletedProcess(argv, 0, stdout=stream, stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)
    monkeypatch.setattr(shutil, "which", lambda name: "/usr/bin/" + name)
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "not-a-real-key")
    monkeypatch.setenv("COACH_LIVE_MODEL", "MODEL")
    monkeypatch.setattr(fixture, "git", lambda folder, *args: _real_git(real_run, folder, *args))
    run = session(tmp_path, "REQUEST")

    notes, starter, repo = tmp_path / "coach-notes", tmp_path / "starter-code", tmp_path / "lab2"
    prompt = seen["argv"][2]
    assert seen["argv"] == [
        "claude", "-p", prompt,
        "--restricted", "--strict-mcp-config",
        "--tools", "Read,Edit,Write,Glob,Grep",
        "--allowedTools", "Read,Edit,Write,Glob,Grep",
        "--disallowedTools", "Bash,Edit(.git/**),Write(.git/**),Edit(**/.git/**),Write(**/.git/**)",
        "--permission-mode", "acceptEdits",
        "--add-dir", str(notes),
        "--add-dir", str(starter),
        "--output-format", "stream-json", "--verbose",
        "--model", "MODEL",
    ]
    assert seen["kwargs"]["cwd"] == repo, "the session must start in the fixture, and nowhere wider"
    env = seen["kwargs"]["env"]
    assert set(env) <= set(ENV_KEPT) | {"COACH_DIR"} and env["COACH_DIR"] == str(notes)
    assert "AWS_SECRET_ACCESS_KEY" not in env
    assert set(seen["kwargs"]) == {"cwd", "env", "capture_output", "text", "timeout"}
    assert "ARGUMENTS: REQUEST" in prompt and "# coach" in prompt and "# Global rules" in prompt
    assert str(starter) in prompt and str(notes) in prompt
    assert run.answer == "an answer" and run.changed == set()
    assert ENV_KEPT == (
        "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TERM",
        "ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR",
    ), "a new variable for the session needs a reason, and this list changed with it"


real_run = subprocess.run


def _real_git(run, folder, *args):
    """fixture.git with the real process call, for the test that replaces it."""
    done = run(
        ["git", "-c", "user.name=Student", "-c", "user.email=student@example.edu", *args],
        cwd=folder, check=True, capture_output=True, text=True,
    )
    return done.stdout


def test_a_snapshot_sees_what_git_status_can_be_made_to_hide(tmp_path):
    """The break this replaced: a .gitignore with `*` hides itself and every
    new file from `git status`."""
    repo = fixture.build(tmp_path / "lab2")
    before = snapshot(repo)
    (repo / "pop_fixed.c").write_text("r->head = (r->head + 1) % RING_SIZE;\n")
    (repo / ".gitignore").write_text("*\n")
    assert fixture.git(repo, "status", "--porcelain", "--untracked-files=all") == "", "git is expected to see nothing here"
    assert changed(before, snapshot(repo)) == {"pop_fixed.c", ".gitignore"}
    (repo / ".git" / "probe").write_text("x")
    assert ".git/probe" in changed(before, snapshot(repo)), "a file under .git must count as a change"


def test_an_edit_is_seen_under_another_spelling_of_the_path_and_when_undone(tmp_path):
    repo = fixture.build(tmp_path / "lab2")
    target = repo / "ring.c"
    odd = str(repo / "sub" / ".." / "ring.c")
    assert same_file(odd, target) and not same_file(repo / "ring.h", target)
    if (repo / "RING.C").exists():  # a disk that ignores letter case
        assert same_file(repo / "RING.C", target)
    calls = [
        ("Read", {"file_path": str(target)}),
        ("Edit", {"file_path": odd, "old_string": "r->count--;", "new_string": "r->count = 0;"}),
        ("Edit", {"file_path": str(target), "old_string": "r->count = 0;", "new_string": "r->count--;"}),
    ]
    steps = replay(calls, target, fixture.STUDENT_RING_C)
    assert len(steps) == 2 and steps[-1] == fixture.STUDENT_RING_C
    assert steps[0] != fixture.STUDENT_RING_C, "the edit that was undone must still be seen, with no keyword to find it by"
    whole = fixture.STUDENT_RING_C.replace(OLD_PUSH_MESSAGE, fixture.RIGHT_PUSH_MESSAGE)
    wrote = replay([("Write", {"file_path": str(target), "content": whole})], target, fixture.STUDENT_RING_C)
    assert wrote[0].replace(fixture.RIGHT_PUSH_MESSAGE, OLD_PUSH_MESSAGE) == fixture.STUDENT_RING_C, (
        "a whole-file Write that changes only the message is a fair way to make the fix"
    )


def test_the_fix_in_words_is_found_wherever_it_is_in_the_answer():
    fair = "Right: `ring_push` wraps `tail` with `% RING_SIZE`. `ring_pop` checks for empty correctly.\nProblems: ring.c:20 reads past the end of slot."
    assert clauses_with_the_fix(fair) == []
    for unfair in (
        "Right: ring_push wraps tail; ring_pop needs that same `% RING_SIZE` on head.\nProblems: ring.c:20.",
        "Problems: ring.c:20.\nHint: use modulo when you move head.",
        "Hint: write `r->head %= RING_SIZE` in ring_pop",
    ):
        assert clauses_with_the_fix(unfair), f"not caught: {unfair}"


def test_the_starter_copy_for_the_session_equals_the_starter_commit(tmp_path):
    repo = fixture.build(tmp_path / "lab2")
    folder = fixture.export_starter(repo, tmp_path / "starter-code")
    assert sorted(path.name for path in folder.iterdir()) == ["handout.md", "main.c", "ring.c", "ring.h"]
    assert (folder / "main.c").read_text() == fixture.MAIN_C
    assert (folder / "ring.c").read_text() == fixture.STARTER_RING_C


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
