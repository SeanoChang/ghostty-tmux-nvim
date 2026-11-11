"""The two design skills keep their shape: premise-check and shape.

These are procedures in prose, so most of their quality cannot be tested here.
What can be tested is the part a later edit would break without anyone seeing:

- the fixed parts of each skill's output and procedure are all still there;
- the clock in `shape` adds up, and says what happens when time runs out;
- where `shape` meets a rule in another file, the two still say the same thing
  (the cut direction, the decision columns, the first task of a plan);
- every skill, agent and reference they send the reader to exists in this repo;
- each SKILL.md stays small enough to read in one go.

Run: python3 -m pytest tests/test_design_skills.py -q -p no:cacheprovider
"""
import re
from pathlib import Path

import pytest

CLAUDE = Path(__file__).resolve().parent.parent / "config" / "claude"
SKILLS = CLAUDE / "skills"
REFERENCES = SKILLS / "writing-markdown-docs" / "references"
# Raised from 9,000 on purpose when `shape` got "Which rule applies" and the
# full clock rules. A skill loads only when it is used, not in every session.
MAX_SKILL_CHARS = 12_000

# Skills that live in other repositories, so this repo cannot check them.
ELSEWHERE = {"build-scout", "research-triage", "second-brain-obsidian"}
# Backticked words in each skill that are not the name of a skill or an agent.
PLAIN_WORDS = {
    "premise-check": {"asked", "seen", "wanted", "borrowed"},
    "shape": {"date"},
}
MUST_NAME = {
    "premise-check": {"shape", "second-brain-obsidian", "build-scout"},
    "shape": {"premise-check", "brief-artifact", "writing-markdown-docs", "verifier"},
}


def body(name):
    return (SKILLS / name / "SKILL.md").read_text(encoding="utf-8")


def flat(text):
    return " ".join(text.split())


def section(text, heading):
    """The text under a `## heading`, up to the next `## `."""
    match = re.search(rf"^## {re.escape(heading)}\n(.*?)(?=^## |\Z)", text, flags=re.M | re.S)
    assert match, f"no section '## {heading}'"
    return flat(match.group(1))


@pytest.mark.parametrize("name", ["premise-check", "shape"])
def test_a_design_skill_stays_small(name):
    size = len(body(name))
    assert size <= MAX_SKILL_CHARS, f"{name}/SKILL.md is {size} characters, the cap is {MAX_SKILL_CHARS}"


def test_premise_check_keeps_its_five_parts_in_order():
    text = body("premise-check")
    headings = re.findall(r"^### (\d)\. (.+)$", text, flags=re.M)
    assert headings == [
        ("1", "Parts"),
        ("2", "Need"),
        ("3", "Terms to settle"),
        ("4", "P0, P1, left out"),
        ("5", "Call"),
    ]


@pytest.mark.parametrize("tag", ["asked", "seen", "wanted", "borrowed"])
def test_premise_check_defines_each_source_of_a_part(tag):
    rows = [line for line in body("premise-check").splitlines() if line.startswith(f"| `{tag}` |")]
    assert len(rows) == 1, f"`{tag}` must have exactly one row that defines it"
    assert len([cell for cell in rows[0].split("|") if cell.strip()]) == 3


def test_premise_check_traces_each_part_and_sorts_by_the_trace():
    text = body("premise-check")
    assert "| Part | Comes from | Proof |" in text, "the Parts table lost a column"
    assert "| Idea | Need, in twelve words or fewer | Comes from | Call |" in text
    for sort, source in (("P0", "`asked`"), ("P1", "`seen` and `wanted`"), ("Left out on purpose", "`borrowed`")):
        rows = [line for line in text.splitlines() if line.startswith(f"| **{sort}** |")]
        assert len(rows) == 1 and source in rows[0], f"the {sort} row no longer sorts {source} parts"


def test_premise_check_asks_nothing_and_does_not_design():
    text = flat(body("premise-check"))
    assert "Ask no questions." in text
    assert "**Do not design.**" in text
    assert "Every `asked` part, and everything asked that the idea left out" in text, (
        "P0 must hold what the source asks for, in the idea or not"
    )
    assert "**Asked, and not in the idea:**" in text


def test_premise_check_cannot_call_build_as_given_over_a_missing_requirement():
    text = flat(body("premise-check"))
    assert "**Build as given.** Every part is P0, and the idea leaves out nothing that the source asks for." in text


def shape_steps():
    rows = re.findall(r"^\| (\d)\. ([^|]+?) +\| (\d+)% +\| (\d+) +\|", body("shape"), flags=re.M)
    return [(int(n), title, int(share), int(minutes)) for n, title, share, minutes in rows]


def test_shape_has_five_steps_and_each_has_its_section():
    steps = shape_steps()
    assert [n for n, *_ in steps] == [1, 2, 3, 4, 5]
    text = body("shape")
    for n, title, _, _ in steps:
        assert f"### {n}. {title}" in text, f"step {n} ({title}) is in the table but has no section"


def test_the_clock_in_shape_adds_up():
    steps = shape_steps()
    assert sum(share for *_, share, _ in steps) == 100
    assert sum(minutes for *_, minutes in steps) == 120
    for _, title, share, minutes in steps:
        assert minutes == round(120 * share / 100), f"{title}: {share}% of 120 is not {minutes}"


def test_shape_keeps_the_rules_that_hold_the_scope():
    text = flat(body("shape"))
    for rule in (
        "**One question at a time,**",
        "**Ask only about a decision that is hard to reverse**",
        "**Take a default for everything else,**",
        "**Budget: ten questions** for a project, five for a feature.",
        "These count: each term question in step 2, each interview question in step 4, and each decision on a page.",
        "These do not count: the time-box question, the sorting question that ends step 1, the pick in step 3, and where the doc goes.",
        "A box of 60 minutes or less is a feature.",
        "It is not asked again in step 4.",
        "The list covers the whole source, not only the user's idea",
        "The clock does not stop.",
        "when three or more decisions each need a table or a diagram to judge",
    ):
        assert rule in text, f"shape lost the rule: {rule}"


def test_shape_says_what_happens_when_the_time_runs_out():
    """One rule per level: a step, and the whole box. The earlier text had one
    line, "when the time is up, stop and write the doc", and it met three other
    rules of the skill with nothing to say which applied."""
    clock = section(body("shape"), "The clock")
    for rule in (
        "Step 5's share is reserved: no earlier step may use it.",
        "These are never dropped.",
        "**When a step's time is up,** open nothing new in it.",
        "A question already asked keeps the user's answer.",
        'is logged as a default marked "would have asked"',
        "Step 4 still shows the defaults table.",
        "**When the whole box is up,** which can only happen in step 5",
    ):
        assert rule in clock, f"the clock lost the rule: {rule}"
    must = clock[clock.index("**Must-haves:**"):clock.index("These are never dropped.")]
    for kept in ('"Done when" commands', "the fresh reader's check", "Decisions, Failure modes and Open items"):
        assert kept in must, f"{kept} is no longer a must-have of the session"
    assert "stop and write the doc" not in flat(body("shape"))


def test_shape_names_the_rule_that_applies_where_another_file_has_one():
    which = section(body("shape"), "Which rule applies")
    for other in ("The time box in CLAUDE.md", "as CLAUDE.md says", "`brief-artifact`", "`writing-markdown-docs`", "The plan genre and CLAUDE.md", "`verifier`"):
        assert other in which, f"'Which rule applies' no longer covers: {other}"
    before = section(body("shape"), "Before the first step")
    assert "the must-haves and the cut list" in before, "the time box rule wants both shown before the work starts"


def test_the_cut_direction_is_the_same_in_every_file_that_has_a_cut_list():
    """A cut list is read from the top: the first item is the first to drop."""
    rules = flat((CLAUDE / "CLAUDE.md").read_text(encoding="utf-8"))
    assert "a cut list, the first to drop at the top" in rules
    assert "When behind, cut from the top" in rules
    plan = flat((REFERENCES / "plan.md").read_text(encoding="utf-8"))
    assert "the first item is the first to drop" in plan
    shape = flat(body("shape"))
    assert "in cut order: the first item is the first to drop" in shape
    assert "**The session's cut list,** the first to drop at the top" in shape
    assert "drop from the top of the session's cut list" in shape
    planner = flat((CLAUDE / "agents" / "planner.md").read_text(encoding="utf-8"))
    assert "number the cuts in the order to drop them" in planner
    for name, text in (("CLAUDE.md", rules), ("plan.md", plan), ("shape", shape), ("planner.md", planner)):
        assert not re.search(r"from the bottom|last (item )?(is the )?first to drop", text), f"{name} reverses the cut order"


def test_the_decision_rows_of_shape_have_the_columns_the_design_genre_asks_for():
    design = (REFERENCES / "design.md").read_text(encoding="utf-8")
    asked = re.search(r"^5\. Decisions +a table: (.+)$", design, flags=re.M)
    assert asked, "the design genre no longer lists the columns of its Decisions table"
    columns = [name.strip().capitalize() for name in asked.group(1).split(",")]
    header = "| ID | " + " | ".join(columns) + " |"
    assert header in body("shape"), f"shape logs decisions without the genre's columns: {header}"
    assert "| Decision | Default | Instead of | How to change it later |" in body("shape")


def test_the_doc_sections_in_shape_are_sections_of_the_design_genre():
    design = (REFERENCES / "design.md").read_text(encoding="utf-8")
    outline = re.findall(r"^\d\. (.+?)(?:  +.*)?$", design[design.index("```text"):design.index("```", design.index("```text") + 7)], flags=re.M)
    table = re.search(r"\| Section of the genre \| What goes in \|\n.*?\n((?: *\|.*\n)+)", body("shape"))
    assert table, "shape lost the table that maps its results to the genre's sections"
    used = [row.split("|")[1].strip() for row in table.group(1).splitlines()]
    assert used == [name for name in outline if name in used], "the sections are out of the genre's order"
    assert set(used) <= set(outline), f"not sections of the design genre: {sorted(set(used) - set(outline))}"
    for required in ("Decisions", "Failure modes"):
        assert required in used, f"the genre does not allow a design without {required}"


def test_the_first_task_of_a_build_is_the_end_to_end_check_in_shape_and_in_the_plan():
    plan = flat((REFERENCES / "plan.md").read_text(encoding="utf-8"))
    assert "**The first task makes one end-to-end check pass,**" in plan
    assert "**The shared contract is its own early task.**" in plan
    shape = flat(body("shape"))
    assert 'The first makes one "Done when" command pass end to end, as the plan\'s first task must' in shape
    assert "It is not the plan's first task." in shape
    assert "first tasks of the build" not in shape, "a deep dive must not be given the first place again"


def test_the_fresh_reader_in_shape_is_a_verifier_that_refutes_claims():
    shape = flat(body("shape"))
    assert "Start one `verifier` in its refute mode." in shape
    assert "none of the session's reasoning" in shape
    verifier = (CLAUDE / "agents" / "verifier.md").read_text(encoding="utf-8")
    assert "## Refute findings" in verifier, "the verifier lost the mode that shape uses"


@pytest.mark.parametrize("skill", ["premise-check", "shape"])
def test_every_skill_and_agent_a_design_skill_names_is_real(skill):
    """A backticked lower-case word is a skill, an agent, or one of a few plain
    words listed above. So a name that does not exist fails here."""
    named = set(re.findall(r"`([a-z][a-z-]+[a-z])`", body(skill)))
    skills_here = {path.name for path in SKILLS.iterdir() if (path / "SKILL.md").exists()}
    agents_here = {path.stem for path in (CLAUDE / "agents").glob("*.md")}
    known = skills_here | agents_here | ELSEWHERE
    unknown = named - known - PLAIN_WORDS[skill]
    assert not unknown, f"{skill} names {sorted(unknown)}: not a skill or an agent of this repo, and not a listed plain word"
    assert MUST_NAME[skill] <= named, f"{skill} no longer names {sorted(MUST_NAME[skill] - named)}"
    missing = MUST_NAME[skill] - known
    assert not missing, f"{skill} sends the reader to {sorted(missing)}, which no repo has"
    unused = PLAIN_WORDS[skill] - named
    assert not unused, f"{sorted(unused)} is listed as a plain word of {skill} and is not in it"


def test_the_plan_reference_has_the_clock_and_the_cut_list():
    plan = flat((REFERENCES / "plan.md").read_text(encoding="utf-8"))
    assert "Clock and cut list" in plan
    assert "nothing on it is a must-have" in plan
