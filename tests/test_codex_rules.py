"""The rules Codex loads are built from the rules Claude loads, and stay built.

config/claude/CLAUDE.md is the root: each rule is written once, under a name.
config/codex/AGENTS.src.md says what Codex gets for every name. The build
(config/codex/build_agents_md.py) writes config/codex/AGENTS.md from the two.

Before this, the files were kept in step by a comment that said so. CLAUDE.md
then changed in twelve commits and AGENTS.md in none.

What these tests hold:
  - AGENTS.md in the repo is exactly what a build gives now.
  - Every rule in the root has one decision for Codex: placed word for word,
    adapted (with the hash of the root text it was adapted from), or
    claude-only. A new or changed rule fails here until someone decides.
  - The rules that came across on 2026-11-11 are still in the built file.

What they do not hold: that an adapted wording says the same as the root. The
hash only forces a person or an agent to read both when the root changes.

Run: python3 -m pytest tests/test_codex_rules.py -q -p no:cacheprovider
"""
import importlib.util
import random
import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
SCRIPT = REPO / "config" / "codex" / "build_agents_md.py"

spec = importlib.util.spec_from_file_location("build_agents_md", SCRIPT)
bam = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bam)

# Codex reads at most 32 KiB of AGENTS.md files, global and project together
# (`project_doc_max_bytes`). The global file takes less than half of that.
MAX_BYTES = 16_000

# phrase -> what is lost when it goes missing from the Codex file
PINNED = {
    "you build far faster than a human": "why build cost must not pick the design",
    "take the smallest": "the smallest design that fully meets the need",
    "from the outside in": "a feature starts with an end-to-end check",
    "before the first review": "the reference test comes before a reviewer",
    "Time box": "a time budget fixes the time and varies the scope",
    "Unattended mode": "what to do when Sean leaves",
    "Blocked on me, Changed, Found": "the report form for 'all done?'",
    "its own task": "a tier 2 change does not hold up lower-tier work",
    "Only an Important finding starts a fix round": "what starts a fix round",
    "At the second bug of one class, stop patching": "when to stop patching",
    "A review passes one commit": "commit before a review",
    "Never merge a pull request": "Codex never merges; Claude's gate or Sean does",
    "`agent_type`": "how Codex picks the builder, verifier or adversary agent",
    "list each one under Open": "where a subagent puts its assumptions",
    "the part of the change you trust least": "what a builder points the reviewer at",
}


def flat(text):
    return " ".join(text.split())


def root(*blocks):
    """A small root file: each block is (name, text) or a plain line."""
    out = ["# Rules", ""]
    for block in blocks:
        if isinstance(block, tuple):
            out += [f"<!-- rule: {block[0]} -->", block[1]]
        else:
            out.append(block)
    return "\n".join(out) + "\n"


def hash_of(text):
    return bam.digest(text)


# ── the real files ───────────────────────────────────────────────────────────

def test_the_built_file_is_current():
    want = bam.build(bam.ROOT.read_text(encoding="utf-8"), bam.FRAME.read_text(encoding="utf-8"))
    assert bam.BUILT.read_text(encoding="utf-8") == want, (
        "config/codex/AGENTS.md is stale or was edited by hand: run config/codex/build_agents_md.py"
    )


def test_the_check_mode_agrees(tmp_path, monkeypatch):
    assert bam.main(["--check"]) == 0
    stale = tmp_path / "AGENTS.md"
    stale.write_text(bam.BUILT.read_text(encoding="utf-8") + "- one more rule\n", encoding="utf-8")
    monkeypatch.setattr(bam, "BUILT", stale)
    assert bam.main(["--check"]) == 1


def test_the_built_file_has_no_comment_but_its_first():
    lines = bam.BUILT.read_text(encoding="utf-8").splitlines()
    assert lines[0].startswith("# ") and lines[2] == bam.BANNER
    rest = "\n".join(lines[3:])
    assert "<!--" not in rest and "-->" not in rest and "{{" not in rest


def test_the_built_file_stays_inside_its_size_budget():
    size = len(bam.BUILT.read_bytes())
    assert size <= MAX_BYTES, f"AGENTS.md is {size} bytes, over the budget of {MAX_BYTES}"


@pytest.mark.parametrize("phrase", sorted(PINNED), ids=lambda p: p.replace(" ", "-"))
def test_a_pinned_rule_is_in_the_codex_file(phrase):
    assert phrase in flat(bam.BUILT.read_text(encoding="utf-8")), f"AGENTS.md lost: {PINNED[phrase]}"


def test_every_rule_in_the_root_has_a_name():
    found = bam.rules(bam.ROOT.read_text(encoding="utf-8"))
    assert len(found) >= 25
    body = flat("\n".join(found.values()))
    for phrase in ("Work toward my defined expectation", "Never mutate remote infra state", "Build reports:"):
        assert phrase in body


# ── the build, on small inputs ───────────────────────────────────────────────

def test_a_placed_rule_comes_out_word_for_word():
    src = root(("a.one", "- first rule\n  second line"), "", "## Next", "", ("b", "- other"))
    out = bam.build(src, "# Codex\n\n## Shared\n\n{{rule: a.one}}\n{{rule: b}}\n")
    assert out == f"# Codex\n\n{bam.BANNER}\n\n## Shared\n\n- first rule\n  second line\n- other\n"


def test_a_placed_rule_keeps_the_indent_of_its_first_line():
    src = root(("a", "  | an indented table row |\n  | second row |"))
    out = bam.build(src, "# Codex\n\n{{rule: a}}\n")
    assert out == f"# Codex\n\n{bam.BANNER}\n\n  | an indented table row |\n  | second row |\n"


def test_a_rule_ends_at_the_next_name_the_next_heading_or_the_end():
    src = root(("a", "- one\n"), ("b", "- two\n\n  | t |\n"), "", "## Heading", "", ("c", "- three\n\n"))
    assert bam.rules(src) == {"a": "- one", "b": "- two\n\n  | t |", "c": "- three"}


def test_a_comment_that_is_not_a_rule_name_is_skipped_outside_rules():
    src = "# Rules\n\n<!-- a note\n     over two lines -->\n\n<!-- rule: a -->\n- one\n"
    assert bam.rules(src) == {"a": "- one"}


@pytest.mark.parametrize("src, word", [
    ("# R\n\n- a rule with no name\n", "outside a named rule"),
    ("# R\n\n## H\n\nplain text\n", "outside a named rule"),
    ("# R\n<!-- rule: a -->\n- x\n<!-- rule: a -->\n- y\n", "used twice"),
    ("# R\n<!-- rule: a -->\n<!-- rule: b -->\n- y\n", "has no text"),
    ("# R\n<!-- rule: a -->\n\n## H\n", "has no text"),
    ("# R\n<!-- rule: Bad Name -->\n- x\n", "not a rule name line"),
    ("# R\n<!-- rule: a -->\n- x\n<!-- rule:b -->\n- y\n", "not a rule name line"),
    ("# R\n<!-- rule: a --> and more\n- x\n", "not a rule name line"),
    ("# R\n  <!-- rule: a -->\n- x\n", "not a rule name line"),
    ("# R\n<!-- rule: a -->\n- x\ntext <!-- rule: b -->\n- y\n", "comment inside the rule"),
    ("# R\n<!-- rule: a -->\n- x\n<!-- a note -->\n", "comment inside the rule"),
    # Claude Code takes these lines as text, not as a heading: one to six # and then a blank make a heading.
    ("# R\n\n## Safety\n#1 rule: never push with force.\n", "not a heading"),
    ("# R\n<!-- rule: a -->\n- x\n#Also: never print a secret.\n\n## Next\n", "not a heading"),
    ("# R\n\n## Safety\n####### Never delete a branch.\n", "not a heading"),
    ("# R\n\n#\tA tab is not a blank\n", "not a heading"),
    # A comment must end, and end its line.
    ("# R\n<!-- rule: a -->\n- x\n\n## Extra\n<!-- TODO: decide\nNever merge on Fridays.\n", "never closed"),
    ("# R\n\n<!-- note --> - Always push to main.\n", "after the end of a comment"),
    ("# R\n\n<!-- a note\nover two lines --> - Always push to main.\n", "after the end of a comment"),
    ("# R\n\n<!-- a --> b -->\n", "after the end of a comment"),
    ("# R\n\n<!--> - a rule after the shortest comment\n", "after the end of a comment"),
    ("# R\n\n<!---> - a rule after the next shortest\n", "after the end of a comment"),
])
def test_a_root_the_build_cannot_trust_is_refused(src, word):
    with pytest.raises(bam.BuildError, match=word):
        bam.rules(src)


def test_an_adapted_rule_keeps_the_codex_wording_and_drops_the_marker():
    src = root(("a", "- claude wording"))
    frame = f"# Codex\n\n<!-- adapts: a@{hash_of('- claude wording')} -->\n- codex wording\n"
    assert bam.build(src, frame) == f"# Codex\n\n{bam.BANNER}\n\n- codex wording\n"


def test_a_changed_root_rule_stops_the_build_until_the_hash_is_set():
    frame = f"# Codex\n\n<!-- adapts: a@{hash_of('- old wording')} -->\n- codex wording\n"
    with pytest.raises(bam.BuildError, match=r"'a' changed in CLAUDE.md.*" + hash_of("- new wording")):
        bam.build(root(("a", "- new wording")), frame)


def test_a_rule_with_no_decision_stops_the_build():
    src = root(("a", "- one"), ("b", "- two"))
    with pytest.raises(bam.BuildError, match="'b' in CLAUDE.md has no decision"):
        bam.build(src, "# Codex\n\n{{rule: a}}\n")


def test_claude_only_is_a_decision():
    src = root(("a", "- one"), ("b", "- two"), ("c", "- three"))
    out = bam.build(src, "# Codex\n\n{{rule: a}}\n\n<!-- claude-only: b, c -->\n")
    assert out == f"# Codex\n\n{bam.BANNER}\n\n- one\n"


def test_a_dropped_marker_leaves_no_run_of_blank_lines():
    src = root(("a", "- one"), ("b", "- two"))
    frame = "# Codex\n\n{{rule: a}}\n\n<!-- claude-only: b -->\n\n## Next\n\ntext\n\n\n"
    assert bam.build(src, frame) == f"# Codex\n\n{bam.BANNER}\n\n- one\n\n## Next\n\ntext\n"


@pytest.mark.parametrize("frame, word", [
    ("# Codex\n\n{{rule: nope}}\n", "no rule named 'nope'"),
    ("# Codex\n\n{{rule: a}}\n{{rule: a}}\n", "already decided"),
    ("# Codex\n\n{{rule: a}}\n<!-- claude-only: a -->\n", "already decided"),
    ("# Codex\n\n{{rule: a}}\n<!-- a stray comment -->\n", "not a line this build knows"),
    ("# Codex\n\n{{rule: a}}\n- text with {{rule: a}} inside\n", "not a line this build knows"),
    ("# Codex\n\n  {{rule: a}}\n", "not a line this build knows"),
    ("# Codex\n\n<!-- adapts: a -->\n- x\n", "not a line this build knows"),
    ("{{rule: a}}\n", "first line must be"),
])
def test_a_frame_the_build_cannot_trust_is_refused(frame, word):
    with pytest.raises(bam.BuildError, match=word):
        bam.build(root(("a", "- one")), frame)


def test_all_problems_are_reported_in_one_run():
    src = root(("a", "- one"), ("b", "- two"))
    with pytest.raises(bam.BuildError) as err:
        bam.build(src, "# Codex\n\n{{rule: nope}}\n<!-- adapts: a@0000000000 -->\n- x\n")
    text = str(err.value)
    assert "no rule named 'nope'" in text and "'a' changed" in text and "'b' in CLAUDE.md has no decision" in text


# ── what a Claude session is left with, against what the build carries ───────

# The comment regex of Claude Code 2.1.319, without its last branch ("or the
# end of the text"): here a comment that never ends is kept as text, so the
# build must account for it or stop.
A_COMMENT = re.compile(r"<!--(?:-?>|[\s\S]*?-->)")
A_HEADING = re.compile(r"#{1,6}(?: .*)?")

HOSTILE = ["#1 rule: never push with force", "#Also: x", "####### seven", "#\ttab", "#", "###### six", "# a real heading",
           "<!-- open", "<!-- a --> - tail", "<!-->", "<!---> x", "<!---->", "--> stray", "  <!-- indented -->",
           " ## indented heading", "plain text", "<!-- a --> <!-- b -->", "<!-- rule: zz --> tail", "```", "<!-- fine -->",
           "- one more line", "<!-- two", "lines -->", "lines --> and a tail", "<!--", "-->"]


def left_for_claude(text):
    """The lines of a root file that are neither blank, nor a heading, nor in
    a comment. This shares no code with the build: one regex takes the
    comments out of the whole text, one decides what a heading is."""
    return [line for line in A_COMMENT.sub("", text).splitlines() if line.strip() and not A_HEADING.fullmatch(line)]


def test_every_line_a_session_is_left_with_is_in_a_rule_or_the_build_stops():
    """Random root files with hostile lines put in at random places. When the
    build takes a file, the lines its rules hold must be exactly the lines a
    session is left with: no line may fall between the two readings."""
    rng = random.Random(20261112)
    taken = stopped = 0
    for _ in range(3000):
        lines = ["# Title", ""]
        for n in range(rng.randint(1, 4)):
            if rng.random() < 0.4:
                lines += [rng.choice(["## Section", "### Sub"]), ""]
            lines += [f"<!-- rule: r{n} -->"] + [rng.choice(["- a rule", "  more of it", "| a | b |"]) for _ in range(rng.randint(1, 3))]
            lines += [""] * rng.randint(0, 2)
        for _ in range(rng.randint(0, 3)):
            lines.insert(rng.randint(1, len(lines)), rng.choice(HOSTILE))
        text = "\n".join(lines) + "\n"
        try:
            found = bam.rules(text)
        except bam.BuildError:
            stopped += 1
            continue
        taken += 1
        carried = [line for rule in found.values() for line in rule.splitlines() if line.strip()]
        assert carried == left_for_claude(text), lines
    assert taken > 300 and stopped > 300, (taken, stopped)


def test_the_real_root_is_read_the_same_way():
    text = bam.ROOT.read_text(encoding="utf-8")
    carried = [line for rule in bam.rules(text).values() for line in rule.splitlines() if line.strip()]
    assert carried == left_for_claude(text)


# ── random roots against what was put into them ──────────────────────────────

def test_random_roots_give_back_the_rules_that_were_put_in():
    """Build a root file from random pieces and keep a record of the rules in
    it. rules() must return exactly that record."""
    rng = random.Random(20261111)
    words = ["- a rule", "  more of it", "| a | table |", "text with `code`", "    deep indent", "1. numbered"]
    for _ in range(400):
        lines, want, used, in_rule = ["# Title", ""], {}, 0, False
        for _ in range(rng.randint(1, 6)):
            kind = rng.random()
            if kind < 0.25:
                lines += [rng.choice(["## Section", "### Sub", "# Top"]), ""]
                in_rule = False
            elif kind < 0.45 and not in_rule:      # a note may stand only where no rule is open
                lines += rng.choice([["<!-- a note -->"], ["<!-- a note that", "     runs on -->"]]) + [""]
            else:
                used += 1
                name = f"r{used}" + rng.choice(["", ".x", "-y", ".a-b"])
                body = [rng.choice(words) for _ in range(rng.randint(1, 4))]
                for _ in range(rng.randint(0, 2)):          # blank lines inside the rule
                    body.insert(rng.randint(1, len(body)), "")
                while not body[-1].strip():
                    body.pop()
                want[name] = "\n".join(body)
                lines += [f"<!-- rule: {name} -->"] + body + [""] * rng.randint(0, 2)
                in_rule = True
        assert bam.rules("\n".join(lines) + "\n") == want, lines
