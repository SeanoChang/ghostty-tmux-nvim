"""Every skill and agent definition must have frontmatter that parses.

Claude Code lists a skill by the `description` in its frontmatter. When the YAML
does not parse, the list shows only the title and the skill loses its trigger
text, with no error anywhere. That happened to writing-markdown-docs: a plain
multi-line scalar that contained ": " ended the scalar early.

Run: python3 -m pytest tests/test_skill_frontmatter.py -q -p no:cacheprovider
"""
from pathlib import Path

import pytest
import yaml

CLAUDE = Path(__file__).resolve().parent.parent / "config" / "claude"
SKILLS = sorted(CLAUDE.glob("skills/*/SKILL.md"))
AGENTS = sorted(CLAUDE.glob("agents/*.md"))


def frontmatter(path):
    text = path.read_text(encoding="utf-8")
    assert text.startswith("---\n"), f"{path}: no frontmatter block at the top"
    end = text.find("\n---", 4)
    assert end != -1, f"{path}: frontmatter block is not closed"
    return yaml.safe_load(text[4:end])


def test_the_repo_has_skills_and_agents_to_check():
    assert len(SKILLS) >= 5 and len(AGENTS) >= 3


@pytest.mark.parametrize("path", SKILLS + AGENTS, ids=lambda p: f"{p.parent.name}/{p.name}")
def test_frontmatter_parses_and_carries_a_description(path):
    meta = frontmatter(path)
    assert isinstance(meta, dict), f"{path}: frontmatter is not a mapping"
    description = meta.get("description")
    assert isinstance(description, str), f"{path}: description is missing or not text"
    assert len(description.split()) >= 8, f"{path}: description is too short to trigger on"


@pytest.mark.parametrize("path", SKILLS, ids=lambda p: p.parent.name)
def test_skill_name_matches_its_folder(path):
    assert frontmatter(path).get("name") == path.parent.name


def test_a_colon_inside_a_plain_scalar_is_caught(tmp_path):
    """The exact shape that broke writing-markdown-docs must fail this check."""
    bad = tmp_path / "SKILL.md"
    bad.write_text("---\nname: x\ndescription:\n  Use for every note in the vault (Seano): writing and\n  updating notes.\n---\n\n# X\n")
    with pytest.raises(yaml.YAMLError):
        frontmatter(bad)
