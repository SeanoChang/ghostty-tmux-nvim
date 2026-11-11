"""The global rules file keeps its key rules and stays inside a size budget.

Two things went wrong with config/claude/CLAUDE.md before, both with no error:

- A rewrite on 2026-10-31 kept "pick the best design" and dropped the reason
  for it (build cost is low for an agent). Nobody saw the loss for ten days.
- The file loads into every session of every project, so each added line costs
  attention on every task. Nothing stopped it from growing.

So this file pins the rules that must survive a rewrite, by a short phrase
each, and caps the size. To add a rule when the cap is reached, cut another
line first, or raise the cap on purpose in the same commit.

Both checks read the text as a session gets it: Claude Code leaves HTML
comments out of the file when it loads it (seen in 2.1.319), so a comment
costs no attention, and a rule that sits only in a comment is not a rule.
A pin catches a deleted phrase. It does not catch a rule that was negated or
moved into another rule.

Run: python3 -m pytest tests/test_global_rules.py -q -p no:cacheprovider
"""
import re
from pathlib import Path

import pytest

RULES = Path(__file__).resolve().parent.parent / "config" / "claude" / "CLAUDE.md"

MAX_CHARS = 15_100
MAX_LINES = 220

# phrase -> what is lost when it goes missing
PINNED = {
    "you build far faster than a human": "why build cost must not pick the design",
    "take the smallest": "bold design still means the smallest one that meets the need",
    "from the outside in": "a feature starts with an end-to-end check, then unit tests",
    "before the first review": "the reference test comes before a reviewer, not after",
    "its own task": "a tier 2 change does not hold up lower-tier work",
    "Time box": "a time budget fixes the time and varies the scope",
    "cut list": "a time box names what to cut, in order, before work starts",
}

BRIEF_LINES = ["Goal:", "Tier:", "Files:", "Done:", "Context:", "Budget:", "Do not:", "Return:"]


def text():
    """The rules as a session loads them: the file without its HTML comments."""
    return re.sub(r"<!--.*?-->", "", RULES.read_text(encoding="utf-8"), flags=re.S)


def flat():
    """The text with each run of whitespace as one space, so a phrase that
    wraps over two lines is still found."""
    return " ".join(text().split())


def test_the_file_stays_inside_its_size_budget():
    body = text()
    assert len(body) <= MAX_CHARS, (
        f"CLAUDE.md is {len(body)} characters, over the cap of {MAX_CHARS}. "
        "It loads into every session: cut a line, or raise the cap on purpose."
    )
    lines = body.count("\n")
    assert lines <= MAX_LINES, f"CLAUDE.md is {lines} lines, over the cap of {MAX_LINES}"


@pytest.mark.parametrize("phrase", sorted(PINNED), ids=lambda p: p.replace(" ", "-"))
def test_a_pinned_rule_is_still_in_the_file(phrase):
    assert phrase in flat(), f"CLAUDE.md lost the rule: {PINNED[phrase]} ({phrase!r})"


def test_the_brief_keeps_all_eight_lines():
    body = text()
    missing = [name for name in BRIEF_LINES if f"  {name}" not in body]
    assert not missing, f"the builder brief in CLAUDE.md lost: {missing}"
