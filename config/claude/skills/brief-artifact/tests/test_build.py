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


# ------------------------------------------------------ links and deep nesting

from html.parser import HTMLParser  # noqa: E402

ALLOWED_HREF = re.compile(r"(https?://|mailto:|#)", re.I)


def hrefs(page_html):
    found = []

    class Links(HTMLParser):
        def handle_starttag(self, tag, attrs):
            found.extend(value or "" for name, value in attrs if name == "href")

    Links().feed(page_html)
    return found


@pytest.mark.parametrize("source", [
    "![i](data:image/png;base64,AAAA)",
    "[a](data:image/webp;base64,AA)",
    "<DATA:image/png;base64,AA>",
    "[a][r]\n\n[r]: data:image/gif;base64,R0",
    "> [!note] [t](data:image/png;base64,AA)\n> body",
    "[a](data:text/html,<b>x</b>)",
    "[a](JaVaScRiPt:alert(1))",
    "[a](vbscript:x)",
    "[a](file:///etc/passwd)",
    "<ftp://example.com/x>",
    "[a](blob:https://example.com/1)",
    "[a](docs/relative.md)",
    "[a](//example.com/x)",
    "[a]()",
    "[a](<>)",
])
def test_a_link_that_is_not_web_mail_or_a_fragment_is_not_a_link(source):
    page = build.build("# Two words\n\n" + source + "\n").html
    assert hrefs(page) == [], source


def test_web_mail_and_fragment_links_stay_links():
    page = build.build("# Two words\n\n[a](https://example.com/x) <http://example.com> "
                       "[m](mailto:a@example.com) [s](#part)\n").html
    assert hrefs(page) == ["https://example.com/x", "http://example.com", "mailto:a@example.com", "#part"]
    assert page.count('target="_blank"') == 2 and page.count('rel="noopener noreferrer"') == 2


def test_random_link_targets_never_give_a_link_outside_the_allowed_kinds():
    rng = random.Random(11)
    schemes = ["data:image/png;base64,", "data:image/gif;base64,", "DATA:image/jpeg;base64,", "data:text/html,",
               "javascript:", "JAVASCRIPT:", "vbscript:", "file:///", "blob:", "ftp://", "tel:", "sms:", "about:",
               "chrome://", "view-source:", "ws://", "intent://", "https://", "http://", "mailto:", "#", "", "//",
               "&#106;avascript:", "java\tscript:", "%6Aavascript:", " data:image/png;base64,", "x-custom:"]
    rest = ["AAAA", "x.y/z", "alert(1)", "a@b.c", "R0lGOD", "", "a b", "a\"b", "a<b>", "a)b"]
    shapes = ["[t]({u})", "<{u}>", "[t][r]\n\n[r]: {u}", "> [!note] [t]({u})\n> body", "![i]({u})",
              "- **A** — [t]({u})\n- **B** — x", "| a |\n| - |\n| [t]({u}) |", "[t]({u} \"title\")", "## [t]({u})"]
    links = 0
    for _ in range(3000):
        url = rng.choice(schemes) + rng.choice(rest)
        source = "# Two words\n\n## ? Question\n\n" + rng.choice(shapes).format(u=url) + "\n"
        try:
            page = build.build(source).html
        except build.BriefError:
            continue
        for href in hrefs(page):
            links += 1
            assert ALLOWED_HREF.match(href), (url, href)
    assert links > 200


TAIL = "\n## ? Tail question\n\n- **Yes** (recommended) — go\n- **No** — stop\n\nsentinel-after\n"


def nested(kinds):
    """One line per level; each level sits inside all the levels before it."""
    lines, prefix = [], ""
    for i, kind in enumerate(kinds):
        lines.append(prefix + ("- " if kind == "list" else "> ") + f"word{i}x")
        prefix += "  " if kind == "list" else "> "
    return "# Two words\n\n" + "\n".join(lines) + "\n" + TAIL


def test_nesting_past_the_limit_is_an_error_and_never_a_silent_cut():
    # The adversary's case: a pasted tree ten lists deep dropped the decision after it.
    with pytest.raises(build.BriefError) as err:
        build.build(nested(["list"] * 10))
    assert "nested" in str(err.value) and "line" in str(err.value)
    for kinds in (["list"] * 6, ["quote"] * 13):
        r = build.build(nested(kinds))
        assert f"word{len(kinds) - 1}x" in r.html and len(r.decisions) == 1
    for kinds in (["list"] * 7, ["quote"] * 14, ["quote"] * 30, ["list"] * 40):
        with pytest.raises(build.BriefError):
            build.build(nested(kinds))
    # The script's own limit must sit below the parser's, where the parser cuts silently.
    assert build.MAX_LEVEL < build.make_parser().options["maxNesting"]


def test_random_nesting_either_keeps_every_word_or_is_refused():
    rng = random.Random(23)
    built = refused = 0
    for _ in range(600):
        kinds = [rng.choice(["list", "quote"]) for _ in range(rng.randint(1, 26))]
        try:
            r = build.build(nested(kinds))
        except build.BriefError:
            refused += 1
            continue
        built += 1
        for i in range(len(kinds)):
            assert f"word{i}x" in r.html, kinds
        assert "sentinel-after" in r.html and [d["title"] for d in r.decisions] == ["Tail question"], kinds
    assert built > 100 and refused > 100, (built, refused)


# ------------------------------------------------------------- section pane

def test_the_section_pane_lists_decisions_and_sections_in_page_order():
    r = build.build(DECISIONS + "\n## Not tested\n\ntext\n")
    nav = r.html.split('<nav class="toc"', 1)[1].split("</nav>", 1)[0]
    targets = re.findall(r'data-target="([^"]+)"', nav)
    assert targets == ["d1", "d2", "d3", "s1", "s2", "respond"]
    assert re.findall(r'href="([^"]+)"', nav) == ["#" + t for t in targets]
    for text in ("How should the hook treat a merge inside a larger command?", "Evidence", "Not tested", "Your response"):
        assert text in nav
    assert re.findall(r'<span class="toc-num">(\d)</span>', nav) == ["1", "2", "3"]
    # Every target is an element on the page, and the pane comes before the text column.
    for target in targets:
        assert r.html.count(f' id="{target}"') == 1, target
    assert '<h2 id="s1">Evidence</h2>' in r.html
    assert r.html.index('<nav class="toc"') < r.html.index("<main")


def test_a_report_gets_a_section_pane_and_a_one_part_page_gets_none():
    r = build.build("# Build review\n\nAll green.\n\n## Findings\n\n- one\n\n## Not covered\n\ntext\n")
    nav = r.html.split('<nav class="toc"', 1)[1].split("</nav>", 1)[0]
    assert re.findall(r'data-target="([^"]+)"', nav) == ["s1", "s2"]
    assert 'id="respond"' not in r.html and "<textarea" not in r.html
    assert "<nav" not in build.build("# Build review\n\nAll green.\n\n## Findings\n\n- one\n").html
    assert "<nav" not in build.build("# Two words\n\njust text\n").html


def test_text_in_the_section_pane_is_escaped():
    r = build.build('# Two words\n\n## ? Pick "one" <now> & go\n\n## A <b>bold</b> `code` & more\n\ntext\n')
    nav = r.html.split('<nav class="toc"', 1)[1].split("</nav>", 1)[0]
    assert "Pick &quot;one&quot; &lt;now&gt; &amp; go" in nav
    assert "A &lt;b&gt;bold&lt;/b&gt; code &amp; more" in nav
    assert "<b>" not in nav and "<code>" not in nav
