"""Tests for build.py: markdown in, one self-contained brief page out.

Run: python3 -m pytest ~/.claude/skills/brief-artifact/tests -q
The browser tests (marked slow) drive headless Chromium through Playwright.
"""
import importlib.util
import random
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "build.py"


def load():
    spec = importlib.util.spec_from_file_location("brief_build", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module  # dataclasses looks the module up by name
    spec.loader.exec_module(module)
    return module


build = load()

DECISIONS = """# Merge gate approach

> Two choices before I wire the hook.

The hook failed review three times on one bug class.

## ? How should the hook treat a merge inside a larger command?

It needs a full model of bash to do this well.

- **Gate plain merges only** (recommended) — closes the class. `cd x && gh pr merge` prompts.
- **Narrow the separators** — a fourth patch of the same kind.
- **No hook** — you keep approving each merge.

Cost of the first: a prompt can stall an unattended run.

## ?+ Which skills fixes do I apply?

- **Task card** — add Tier, Files and Budget.
- **Plan brief** (recommended) — the copied brief gets all eight lines.
- **Model on spawns** (recommended)

## ? Anything else before I start?

## Evidence

| Check | Result |
| --- | --- |
| tests | 241 pass |
"""


def test_title_lead_and_decisions_are_read_from_the_markdown():
    r = build.build(DECISIONS)
    assert r.title == "Merge gate approach"
    assert [d["title"] for d in r.decisions] == [
        "How should the hook treat a merge inside a larger command?",
        "Which skills fixes do I apply?",
        "Anything else before I start?",
    ]
    assert [d["kind"] for d in r.decisions] == ["one", "many", "open"]
    first = r.decisions[0]["options"]
    assert [(o["key"], o["label"], o["recommended"]) for o in first] == [
        ("A", "Gate plain merges only", True),
        ("B", "Narrow the separators", False),
        ("C", "No hook", False),
    ]
    assert [o["recommended"] for o in r.decisions[1]["options"]] == [False, True, True]
    assert r.decisions[2]["options"] == []
    assert r.warnings == []


def test_the_page_follows_the_artifact_contract():
    html = build.build(DECISIONS).html
    assert html.lstrip().startswith("<title>Merge gate approach</title>")
    for banned in ("<!doctype", "<html", "<head", "<body"):
        assert banned not in html.lower()
    # One theme, with tokens on :root and both dark-mode forms.
    assert ":root{" in html.replace(" ", "")
    assert "@media (prefers-color-scheme: dark)" in html
    assert ':root:not([data-theme="light"])' in html
    assert ':root[data-theme="dark"]' in html
    # Nothing is fetched: no external script, stylesheet, font or image.
    assert not re.search(r'(src|href)="https?://', html.split("<main")[0])
    assert "<script src" not in html and "<link" not in html and "@import" not in html


def test_markdown_is_rendered_and_decision_parts_keep_their_order():
    html = build.build(DECISIONS).html
    assert "<h1" in html and "Merge gate approach</h1>" in html
    assert '<p class="lead">Two choices before I wire the hook.</p>' in html
    assert "<table>" in html and "<td>241 pass</td>" in html
    assert "<code>cd x &amp;&amp; gh pr merge</code>" in html
    before = html.index("It needs a full model of bash")
    options = html.index('name="d1"')
    after = html.index("Cost of the first")
    assert before < options < after
    assert html.count('type="radio"') == 3 and html.count('type="checkbox"') == 3
    assert html.count("<textarea") == 4  # one note per decision, one overall comment
    assert "(recommended)" not in html and html.count("Recommended") >= 3


def test_a_page_without_decisions_has_no_response_bar():
    r = build.build("# Build review\n\nAll green.\n\n## Findings\n\n- one\n- two\n")
    assert r.decisions == []
    assert 'id="respond"' not in r.html and "<textarea" not in r.html
    assert "<li>one</li>" in r.html


def test_callouts_carry_a_word_not_only_a_colour():
    r = build.build("# T\n\n> [!warning]\n> Not tested on zsh.\n\n> [!done] Shipped\n> ok\n\n> plain quote\n")
    assert 'class="callout callout-warning"' in r.html and ">Warning<" in r.html
    assert 'class="callout callout-done"' in r.html and ">Done<" in r.html and "Shipped" in r.html
    assert "[!warning]" not in r.html and "[!done]" not in r.html
    assert "<blockquote>" in r.html and "plain quote" in r.html


def test_raw_html_in_the_source_is_shown_as_text():
    r = build.build('# T\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))\n')
    body = r.html.split("<main", 1)[1].rsplit("</main>", 1)[0]
    assert "<script" not in body and "<img" not in body
    assert "&lt;script&gt;" in body
    assert 'href="javascript:' not in body


def test_text_from_the_source_is_escaped_in_attributes():
    r = build.build('# T\n\n## ? Pick "one" <now> & go\n\n- **A "b" <c>** — x\n- **D & e** — y\n')
    assert r.decisions[0]["title"] == 'Pick "one" <now> & go'
    assert 'data-title="Pick &quot;one&quot; &lt;now&gt; &amp; go"' in r.html
    assert 'data-label="A &quot;b&quot; &lt;c&gt;"' in r.html


@pytest.mark.parametrize("source,needle", [
    ("no title here\n", "title"),
    ("# T\n\n## ? Q\n\n- **Only one** — x\n", "one option"),
    ("# T\n\n## ? Q\n\n- **A** (recommended)\n- **B** (recommended)\n", "recommended"),
    ("# T\n\n## ? Q\n\n- **A**\n- **B**\n\n## ? Q\n\n- **A**\n- **B**\n", "twice"),
    ("# T\n\n## ? Q\n\n- ****\n- **B**\n", "label"),
    ("# T\n\n# U\n", "one `# ` title"),
    ("# T\n\n## ?\n\n- **A**\n- **B**\n", "question"),
    ("intro\n\n# Two words\n", "first"),
])
def test_a_brief_that_cannot_be_answered_is_an_error(source, needle):
    with pytest.raises(build.BriefError) as err:
        build.build(source)
    assert needle in str(err.value)


def test_warnings_for_a_brief_that_is_too_long_or_has_no_recommendation():
    long = "# T\n\n" + ("word " * 1300) + "\n"
    assert any("words" in w for w in build.build(long).warnings)
    r = build.build("# T\n\n## ? Q\n\n- **A**\n- **B**\n")
    assert any("recommend" in w for w in r.warnings)
    r = build.build("# One two three four five six seven\n\ntext\n")
    assert r.name == "One two three four"
    assert any("7 words" in w for w in r.warnings)
    assert any("one word" in w for w in build.build("# One\n\ntext\n").warnings)
    assert build.build("# Two words\n\ntext\n").warnings == []
    seven = "# Two words\n\n" + "".join(f"## ? Question {i}\n\n" for i in range(7))
    assert any("7 decisions" in w for w in build.build(seven).warnings)
    six = "# Two words\n\n" + "".join(f"## ? Question {i}\n\n" for i in range(6))
    assert build.build(six).warnings == []


def test_a_question_mark_heading_inside_a_code_block_is_not_a_decision():
    r = build.build("# T\n\n```md\n## ? Not a decision\n- **A**\n- **B**\n```\n\n    ## ? Nor this\n")
    assert r.decisions == []


def test_only_level_two_headings_start_a_decision_and_the_next_heading_ends_it():
    r = build.build("# T\n\n### ? Not one\n\n## ? Real\n\n- **A**\n- **B**\n\n### Detail\n\nstays inside\n\n## After\n\noutside\n")
    assert [d["title"] for d in r.decisions] == ["Real"]
    section = r.html.split('<section class="decision"', 1)[1].split("</section>", 1)[0]
    assert "stays inside" in section and "outside" not in section


def test_the_command_writes_the_page_and_reports(tmp_path):
    src = tmp_path / "b.md"
    src.write_text(DECISIONS)
    proc = subprocess.run([sys.executable, str(SCRIPT), str(src)], capture_output=True, text=True)
    assert proc.returncode == 0, proc.stderr
    out = tmp_path / "b.html"
    assert out.read_text() == build.build(DECISIONS).html
    assert "3 decisions" in proc.stdout and str(out) in proc.stdout
    bad = tmp_path / "bad.md"
    bad.write_text("# T\n\n## ? Q\n\n- **Only**\n")
    proc = subprocess.run([sys.executable, str(SCRIPT), str(bad)], capture_output=True, text=True)
    assert proc.returncode == 1 and "one option" in proc.stderr
    assert not (tmp_path / "bad.html").exists()
    # A page that cannot be written is one clean error line, not a traceback.
    target = tmp_path / "no" / "such" / "dir" / "out.html"
    proc = subprocess.run([sys.executable, str(SCRIPT), str(src), "-o", str(target)], capture_output=True, text=True)
    assert proc.returncode == 1 and "cannot write" in proc.stderr
    assert "Traceback" not in proc.stderr and proc.stdout == ""


# ------------------------------------------------ random input, two references

WORDS = ["alpha", "beta", "## ? Pick", "## ?+ Many", "## Plain", "# Title", "- **A** — x", "- **B** (recommended)",
         "- **C**", "```", "> [!note]", "> quote", "<script>x</script>", "<b onclick=x>", "| a | b |", "| - | - |",
         "text & more", '"quoted"', "    indented", "1. one", "---", "[l](http://e.com)", "[j](javascript:x)", ""]


def decision_headings(source):
    """Reference: `## ?` lines that are not inside a fenced or indented code block."""
    found, fence = [], False
    for line in source.split("\n"):
        if line.startswith("```"):
            fence = not fence
        elif not fence and re.match(r"## \?\+? ?\S", line):
            found.append(line)
    return found


def test_random_sources_never_crash_and_never_leak_markup():
    rng = random.Random(41)
    built = refused = 0
    for _ in range(1500):
        lines = ["# Title"] + [rng.choice(WORDS) for _ in range(rng.randint(0, 14))]
        source = "\n".join(lines) + "\n"
        try:
            r = build.build(source)
        except build.BriefError:
            refused += 1
            continue
        built += 1
        body = r.html.split("<main", 1)[1].rsplit("</main>", 1)[0]
        assert "<script" not in body and "onclick" not in body.replace("&lt;b onclick", ""), source
        assert 'href="javascript:' not in body, source
        # Never more decisions than the reference finds (a list item or a quote can hide a heading).
        assert len(r.decisions) <= len(decision_headings(source)), source
        for d in r.decisions:
            assert d["kind"] in ("one", "many", "open")
            assert len(d["options"]) != 1
    assert built > 300 and refused > 100, (built, refused)
