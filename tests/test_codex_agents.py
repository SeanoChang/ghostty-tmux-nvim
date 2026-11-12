"""The Codex agents are the Codex form of three of Claude's workers, and stay so.

config/codex/agents/ has one TOML file each for builder, verifier and
adversary. Codex offers each as an `agent_type` when it spawns a subagent, and
Claude runs each through `codex-run --role <name>`.

Each file was written from the Claude worker of the same name
(config/claude/agents/<name>.md). Its first line holds the hash of that
worker's text at the time. When the Claude worker changes, the hash no longer
fits and the test below fails until someone has read both texts and set it.

What this does not hold: that the two texts say the same. The hash forces a
look; the pinned phrases catch a lost rule, not a changed one.

Run: python3 -m pytest tests/test_codex_agents.py -q -p no:cacheprovider
"""
import hashlib
import re
import tomllib
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
CODEX = REPO / "config" / "codex"
CLAUDE_AGENTS = REPO / "config" / "claude" / "agents"

ROLES = ["builder", "verifier", "adversary"]
MODELS = {"gpt-6-astra", "gpt-6.1-sol"}
EFFORTS = {"low", "medium", "high"}

# role -> phrases its instructions must keep
PINNED = {
    "builder": [
        "Touch only the files in your brief", "is locked", "Leave your changes uncommitted",
        "Write the failing test first", "Do not ask questions", "At twice the budget",
        "**Result:**", "**Changes:**", "**Evidence:**", "**Not covered:**", "**Open:**",
        "the part of the change you trust least", "each assumption",
    ],
    "verifier": [
        "Report, do not fix", "never modify the project tree", "confirm the new test fails without the fix",
        "tier too low:", "**Important:**", "**Nit:**", "**Pre-existing:**", "second bug of this class",
        "**confirmed**", "**refuted**", "**unverified**", "**Verdict:** pass, fail, or unverified",
        "Never end with a `review: pass` line",
    ],
    "adversary": [
        "you do not fix them", "Never modify the project tree", "Run every probe for real",
        "Do not stop at the first break", "second bug of this class", "**Out of scope:**",
        "**Verdict:** broken, held, or inconclusive", "**Not tried:**",
        "Never end with an `adversary: held` line",
    ],
}


def agent(role):
    return tomllib.loads((CODEX / "agents" / f"{role}.toml").read_text(encoding="utf-8"))


def claude_body(role):
    """The Claude worker's text below its frontmatter."""
    text = (CLAUDE_AGENTS / f"{role}.md").read_text(encoding="utf-8")
    return text[text.find("\n---", 4) + 4:].strip("\n")


def flat(text):
    return " ".join(text.split())


def test_the_agent_folder_holds_these_three_and_nothing_else():
    assert sorted(p.name for p in (CODEX / "agents").iterdir()) == sorted(f"{r}.toml" for r in ROLES)


@pytest.mark.parametrize("role", ROLES)
def test_an_agent_file_has_what_codex_needs(role):
    a = agent(role)
    assert a["name"] == role
    assert 40 <= len(a["description"]) <= 400, "the description is shown with every spawn: keep it short"
    assert a["model"] in MODELS and a["model_reasoning_effort"] in EFFORTS
    assert len(a["developer_instructions"].strip()) > 400
    assert set(a) == {"name", "description", "model", "model_reasoning_effort", "developer_instructions"}


@pytest.mark.parametrize("role", ROLES)
def test_an_agent_file_was_read_against_the_claude_worker_as_it_is_now(role):
    first = (CODEX / "agents" / f"{role}.toml").read_text(encoding="utf-8").splitlines()[0]
    match = re.fullmatch(rf"# adapts: config/claude/agents/{role}\.md@([0-9a-f]{{10}})", first)
    assert match, f"{role}.toml: the first line must name the Claude worker and its hash, got {first!r}"
    now = hashlib.sha256(claude_body(role).encode("utf-8")).hexdigest()[:10]
    assert match.group(1) == now, (
        f"config/claude/agents/{role}.md changed since config/codex/agents/{role}.toml was written. "
        f"Read both, update the Codex text when it needs it, then set the hash to {now}."
    )


@pytest.mark.parametrize("role, phrase", [(r, p) for r in ROLES for p in PINNED[r]],
                         ids=lambda v: v.replace(" ", "-")[:40])
def test_a_pinned_rule_is_in_the_agent(role, phrase):
    assert phrase in flat(agent(role)["developer_instructions"]), f"{role}.toml lost: {phrase!r}"


@pytest.mark.parametrize("role", ["verifier", "adversary"])
def test_a_reviewer_reports_and_never_writes_the_merge_gates_line(role):
    """The lines `review: pass <sha> ...` and `adversary: held <sha>` open the
    merge gate. Only Claude's reviewers write them, so the Codex text must not
    ask for one."""
    text = agent(role)["developer_instructions"]
    assert "<sha>" not in text and "git rev-parse HEAD" not in text


def test_the_reviewers_run_on_the_strongest_codex_model():
    for role in ("verifier", "adversary"):
        assert agent(role)["model"] == "gpt-6-astra" and agent(role)["model_reasoning_effort"] == "high"


def test_the_rules_file_names_exactly_these_agents():
    rules = (CODEX / "AGENTS.md").read_text(encoding="utf-8")
    table = rules[rules.index("| `agent_type`"):rules.index("- A builder or Codex brief")]
    assert set(re.findall(r"`(builder|verifier|adversary|[a-z]+er)`", table)) == set(ROLES)


def test_the_install_manifest_links_the_agents():
    manifest = (REPO / "manifest.txt").read_text(encoding="utf-8")
    assert re.search(r"^merge\s+config/codex/agents\s+~/\.codex/agents$", manifest, re.M)
