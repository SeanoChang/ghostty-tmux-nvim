"""The two design skills keep their shape: premise-check and shape.

These are procedures in prose, so most of their quality cannot be tested here.
What can be tested is the part a later edit would break without anyone seeing:

- the fixed parts of each skill's output and procedure are all still there;
- the clock in `shape` adds up, so a time box is fully spent and not overspent;
- every skill, agent and reference they send the reader to exists in this repo;
- each SKILL.md stays small enough to load on every use.

Run: python3 -m pytest tests/test_design_skills.py -q -p no:cacheprovider
"""
import re
from pathlib import Path

import pytest

CLAUDE = Path(__file__).resolve().parent.parent / "config" / "claude"
SKILLS = CLAUDE / "skills"
MAX_SKILL_CHARS = 9_000


def body(name):
    return (SKILLS / name / "SKILL.md").read_text(encoding="utf-8")


def flat(text):
    return " ".join(text.split())


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


def test_premise_check_asks_nothing_and_does_not_design():
    text = flat(body("premise-check"))
    assert "Ask no questions." in text
    assert "**Do not design.**" in text
    assert "Every `asked` part, and everything asked that the idea left out" in text, (
        "P0 must hold what the source asks for, in the idea or not"
    )
    assert "**Asked, and not in the idea:**" in text


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
        "**Budget: ten questions**",
        "The term questions of step 2 and the interview questions of step 4 both count.",
        "It is not asked again in step 4.",
        "The list covers the whole source, not only the user's idea",
        "the first item is the first to drop",
        "The clock does not stop.",
        "Never shorten the fresh reader's check",
        "When the time is up, stop and write the doc",
    ):
        assert rule in text, f"shape lost the rule: {rule}"


@pytest.mark.parametrize("skill", ["premise-check", "shape"])
def test_every_skill_and_agent_a_design_skill_names_is_real(skill):
    """build-scout and research-triage live in another repo, so they are not checked."""
    elsewhere = {"build-scout", "research-triage"}
    named = set(re.findall(r"`([a-z][a-z-]+[a-z])`", body(skill)))
    skills_here = {path.name for path in SKILLS.iterdir() if (path / "SKILL.md").exists()}
    agents_here = {path.stem for path in (CLAUDE / "agents").glob("*.md")}
    for name in sorted(named & (skills_here | agents_here | elsewhere)):
        assert name in skills_here | agents_here | elsewhere
    expected = {"premise-check": {"shape"}, "shape": {"premise-check", "brief-artifact", "writing-markdown-docs", "verifier"}}
    missing = expected[skill] - (skills_here | agents_here)
    assert not missing, f"{skill} sends the reader to {sorted(missing)}, which this repo does not have"
    assert expected[skill] <= named, f"{skill} no longer names {sorted(expected[skill] - named)}"


def test_the_plan_reference_has_the_clock_and_the_cut_list():
    plan = flat((SKILLS / "writing-markdown-docs" / "references" / "plan.md").read_text(encoding="utf-8"))
    assert "Clock and cut list" in plan
    assert "the first item is the first to drop" in plan
    assert "**The first task makes one end-to-end check pass,**" in plan
