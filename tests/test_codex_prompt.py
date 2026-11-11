"""What Codex itself puts in front of the model, with this repo's files installed.

`codex debug prompt-input` prints the prompt a session would start with. It
calls no model and needs no login. The test gives it a scratch CODEX_HOME that
links this repo's files the way install.sh would, and reads the result.

It needs the `codex` program, so it runs only when asked:

    CODEX_PROMPT=1 python3 -m pytest tests/test_codex_prompt.py -q -p no:cacheprovider

What it holds: the built rules reach the model whole, Codex offers the three
agents by name with their models, and the instructions `codex-run --role`
sends arrive as a developer message. What it does not hold: what a model then
does with them.
"""
import json
import os
import shutil
import subprocess
import tomllib
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
CODEX = REPO / "config" / "codex"

pytestmark = pytest.mark.skipif(
    os.environ.get("CODEX_PROMPT") != "1" or not shutil.which("codex"),
    reason="set CODEX_PROMPT=1 on a machine with the codex program",
)


def prompt(tmp_path, *args):
    home = tmp_path / "codex-home"
    if not home.exists():
        (home / "agents").mkdir(parents=True)
        (home / "config.toml").write_text('model = "gpt-6-astra"\n')
        (home / "AGENTS.md").symlink_to(CODEX / "AGENTS.md")
        for agent in (CODEX / "agents").glob("*.toml"):
            (home / "agents" / agent.name).symlink_to(agent)
    work = tmp_path / "work"
    work.mkdir(exist_ok=True)
    done = subprocess.run(["codex", "debug", "prompt-input", *args, "hello"], cwd=work, capture_output=True, text=True,
                          env=dict(os.environ, CODEX_HOME=str(home)), stdin=subprocess.DEVNULL, timeout=120)
    assert done.returncode == 0, done.stderr[-500:]
    return json.loads(done.stdout)


def texts(items, role=None):
    out = []
    for item in items:
        if isinstance(item, dict) and isinstance(item.get("content"), list) and role in (None, item.get("role")):
            out += [part.get("text", "") for part in item["content"] if isinstance(part, dict)]
    return out


def test_the_built_rules_reach_the_model_whole(tmp_path):
    built = (CODEX / "AGENTS.md").read_text(encoding="utf-8").strip()
    assert any(built in text for text in texts(prompt(tmp_path))), "AGENTS.md is not in the prompt as it is on disk"


def test_codex_offers_the_three_agents_with_their_models(tmp_path):
    items = prompt(tmp_path)
    spawn = [tool for group in items[0]["tools"] for tool in group.get("tools", []) if tool.get("name") == "spawn_agent"]
    assert spawn, "no spawn_agent tool in the prompt"
    offered = spawn[0]["parameters"]["properties"]["agent_type"]["description"]
    for path in sorted((CODEX / "agents").glob("*.toml")):
        agent = tomllib.loads(path.read_text(encoding="utf-8"))
        assert f"{agent['name']}: {{" in offered and agent["description"] in offered
        block = offered[offered.index(f"{agent['name']}: {{"):]
        block = block[:block.index("}")]
        assert f"`{agent['model']}`" in block and f"`{agent['model_reasoning_effort']}`" in block


def test_a_roles_instructions_arrive_as_a_developer_message(tmp_path):
    text = tomllib.loads((CODEX / "agents" / "verifier.toml").read_text(encoding="utf-8"))["developer_instructions"].strip("\n")
    items = prompt(tmp_path, "-c", "developer_instructions=" + json.dumps(text, ensure_ascii=False))
    assert text in texts(items, role="developer")
