"""The worker definitions cover one fixed cast of roles, each with one job.

The cast has seven roles. Six are workers, each with a definition file in
config/claude/agents/. The seventh, the lead, is the main session: it has no
file, and CLAUDE.md speaks to it directly.

The same cast is used outside this repo to show which kind of agent is at work.
The names and jobs here are that cast's own words, so the two stay one list.
To check them against the source, point WORKER_CAST_SOURCE at the file that
defines the cast (lines of the form `builder: { name: 'Builder', job: '...'`):

    WORKER_CAST_SOURCE=/path/to/roles.ts python3 -m pytest tests/test_worker_roles.py -q

Without the variable that one test is skipped, and the rest still run.

Run: python3 -m pytest tests/test_worker_roles.py -q -p no:cacheprovider
"""
import os
import re
from pathlib import Path

import pytest
import yaml

CLAUDE = Path(__file__).resolve().parent.parent / "config" / "claude"
AGENTS = CLAUDE / "agents"

CAST = {
    "builder": "Writes and fixes code",
    "verifier": "Runs tests and checks, reads the diff",
    "adversary": "Tries to break the work",
    "planner": "Designs the change and splits the work",
    "scout": "Reads code, searches docs and the web",
    "scribe": "Writes docs, notes and summaries",
    "lead": "Runs other agents, merges results",
}
WORKERS = [role for role in CAST if role != "lead"]

# Workers that report and never change the project tree.
READ_ONLY = ["verifier", "adversary", "planner", "scout"]
MODELS = {"opus", "sonnet", "haiku"}


def parts(role):
    text = (AGENTS / f"{role}.md").read_text(encoding="utf-8")
    assert text.startswith("---\n"), f"{role}.md: no frontmatter block at the top"
    end = text.find("\n---", 4)
    assert end != -1, f"{role}.md: frontmatter block is not closed"
    return yaml.safe_load(text[4:end]), text[end + 4:]


def flat(text):
    return " ".join(text.split()).lower()


def test_the_agents_folder_holds_the_six_workers_and_nothing_else():
    found = sorted(path.stem for path in AGENTS.glob("*.md"))
    assert found == sorted(WORKERS)


@pytest.mark.parametrize("role", WORKERS)
def test_a_worker_is_named_for_its_role_and_states_the_cast_job(role):
    meta, body = parts(role)
    assert meta["name"] == role
    opening = flat(body.split("\n\n", 2)[1] if body.startswith("\n") else body.split("\n\n", 1)[0])
    assert f"you are the {role}" in opening, f"{role}.md does not open by naming its role"
    assert CAST[role].lower() in opening, (
        f"{role}.md: the opening paragraph does not state the job {CAST[role]!r}"
    )


@pytest.mark.parametrize("role", WORKERS)
def test_a_worker_sets_its_model_so_it_never_inherits_one(role):
    meta, _ = parts(role)
    assert meta.get("model") in MODELS, f"{role}.md: model is {meta.get('model')!r}"


@pytest.mark.parametrize("role", READ_ONLY)
def test_a_reporting_worker_has_no_edit_tool(role):
    meta, _ = parts(role)
    tools = [name.strip() for name in str(meta.get("tools", "")).split(",")]
    assert tools != [""], f"{role}.md: no tools list, so it inherits every tool"
    assert not {"Edit", "Write", "NotebookEdit", "Agent"} & set(tools), f"{role}.md: {tools}"


def test_the_rules_file_routes_work_to_every_worker_and_names_the_lead():
    rules = (CLAUDE / "CLAUDE.md").read_text(encoding="utf-8")
    table = [line for line in rules.splitlines() if line.lstrip().startswith("|")]
    for role in WORKERS:
        assert any(f"`{role}`" in line for line in table), f"no delegation row sends work to `{role}`"
    assert "lead" in rules


def test_the_cast_matches_its_source_when_one_is_given():
    source = os.environ.get("WORKER_CAST_SOURCE")
    if not source:
        pytest.skip("WORKER_CAST_SOURCE is not set")
    text = Path(source).read_text(encoding="utf-8")
    jobs = dict(re.findall(r"^\s*(\w+): \{ name: '[^']*', job: '([^']*)'", text, flags=re.M))
    for role, job in CAST.items():
        assert jobs.get(role) == job, f"{role}: here {job!r}, in the source {jobs.get(role)!r}"
    extra = set(jobs) - set(CAST) - {"default", "psi"}
    assert not extra, f"the source has roles this repo does not: {sorted(extra)}"
