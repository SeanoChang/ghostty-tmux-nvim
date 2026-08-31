import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from check_html import check  # noqa: E402

GOOD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>A page</title>
<style>
:root {
  --bg: #ffffff;
  --text: #1d1d1f;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --bg: #000000; --text: #f5f5f7; }
}
:root[data-theme="dark"] { --bg: #000000; --text: #f5f5f7; }
html { background: var(--bg); }
body { background: var(--bg); color: var(--text); }
</style>
</head>
<body><p>Hello</p></body>
</html>
"""


def codes(text, **kw):
    return [f.code for f in check(text, **kw)]


def test_clean_page_has_no_findings():
    assert check(GOOD) == []


def test_missing_title_is_error():
    assert "title" in codes(GOOD.replace("<title>A page</title>", ""))


def test_missing_viewport_is_error():
    bad = GOOD.replace(
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        "")
    assert "viewport" in codes(bad)


def test_external_script_is_error():
    bad = GOOD.replace("</head>",
                       '<script src="https://cdn.example.com/x.js"></script>'
                       "</head>")
    assert "external-ref" in codes(bad)


def test_protocol_relative_ref_is_error():
    bad = GOOD.replace("</head>",
                       '<link rel="stylesheet" href="//cdn.example.com/a.css">'
                       "</head>")
    assert "external-ref" in codes(bad)


def test_relative_asset_ref_is_error():
    bad = GOOD.replace("<p>Hello</p>", '<img src="chart.png" alt="c">')
    assert "external-ref" in codes(bad)


def test_data_uri_is_allowed():
    ok = GOOD.replace(
        "<p>Hello</p>",
        '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="c">')
    assert "external-ref" not in codes(ok)


def test_fragment_href_is_allowed():
    ok = GOOD.replace("<p>Hello</p>", '<a href="#s1">jump</a>')
    assert "external-ref" not in codes(ok)


def test_external_link_href_is_allowed():
    # A hyperlink the reader clicks is not a subresource; it does not break
    # self-containment the way a stylesheet or image does.
    ok = GOOD.replace("<p>Hello</p>", '<a href="https://example.com">ref</a>')
    assert "external-ref" not in codes(ok)


def test_missing_dark_media_block_is_error():
    bad = GOOD.replace("@media (prefers-color-scheme: dark) {", "@media print {")
    assert "theme-dark-media" in codes(bad)


def test_missing_data_theme_block_is_error():
    bad = GOOD.replace(':root[data-theme="dark"]', ":root.dark")
    assert "theme-data-attr" in codes(bad)


def test_missing_html_background_is_error():
    bad = GOOD.replace("html { background: var(--bg); }", "")
    msgs = [f.msg for f in check(bad) if f.code == "explicit-background"]
    assert any("html" in m for m in msgs)


def test_missing_body_background_is_error():
    bad = GOOD.replace("body { background: var(--bg); color: var(--text); }",
                       "body { color: var(--text); }")
    msgs = [f.msg for f in check(bad) if f.code == "explicit-background"]
    assert any("body" in m for m in msgs)


def test_undefined_token_is_error():
    bad = GOOD.replace("color: var(--text);", "color: var(--text-muted);")
    msgs = [f.msg for f in check(bad) if f.code == "undefined-token"]
    assert any("--text-muted" in m for m in msgs)


def test_var_fallback_does_not_count_as_definition():
    bad = GOOD.replace("color: var(--text);",
                       "color: var(--nope, var(--text));")
    assert "undefined-token" in codes(bad)


def test_hardcoded_color_outside_token_is_warning():
    bad = GOOD.replace("body { background: var(--bg);",
                       "body { background: #ff0000;")
    found = [f for f in check(bad) if f.code == "hardcoded-color"]
    assert found and found[0].level == "warning"


def test_token_definitions_are_not_hardcoded_colors():
    assert "hardcoded-color" not in codes(GOOD)


def test_svg_presentation_color_is_not_flagged():
    # Inline SVG carries fill/stroke as attributes, not CSS declarations.
    ok = GOOD.replace("<p>Hello</p>",
                      '<svg><rect fill="#4669b9" width="1" height="1"/></svg>')
    assert "hardcoded-color" not in codes(ok)


def test_print_block_colour_literals_are_not_flagged():
    # Print has no theme — paper is white. base.css ships exactly this block,
    # so flagging it would put a warning on every correct page and train the
    # reader to ignore warnings.
    ok = GOOD.replace(
        "</style>",
        "@media print { body { background: #fff; color: #000; } }\n</style>")
    assert "hardcoded-color" not in codes(ok)


def test_hardcoded_colour_after_a_print_block_is_still_flagged():
    # Skipping the print block must not swallow the rest of the stylesheet.
    bad = GOOD.replace(
        "</style>",
        "@media print { body { background: #fff; } }\n"
        ".x { color: #ff0000; }\n</style>")
    assert "hardcoded-color" in codes(bad)


def test_hex_inside_a_css_comment_is_not_flagged():
    # Every theme file this skill ships documents its palette in a comment,
    # so scanning comments would warn on every valid page.
    # The contrast ratios these comments quote contain colons, which is what
    # makes them look like declarations to a line-based scan.
    ok = GOOD.replace(
        "<style>",
        "<style>\n/* ground #131a1b, selection #588b8b — from the config.\n"
        "   #588b8b reaches 4.60:1 on #131a1b but only 3.68:1 on #f2fcff. */")
    assert "hardcoded-color" not in codes(ok)


def test_token_named_only_in_a_css_comment_is_not_a_definition():
    bad = GOOD.replace(
        "<style>", "<style>\n/* --text-muted: #888; not yet used */")
    bad = bad.replace("color: var(--text);", "color: var(--text-muted);")
    assert "undefined-token" in codes(bad)


def test_token_name_built_by_a_template_literal_is_not_flagged():
    # An explorable picks a series slot at runtime; the name is only complete
    # once the placeholder is substituted.
    ok = GOOD.replace(
        "<p>Hello</p>",
        "<script>el.setAttribute('fill', `var(--series-${i + 1})`)</script>")
    msgs = [f.msg for f in check(ok) if f.code == "undefined-token"]
    assert msgs == [], msgs


def test_oversize_page_is_error():
    big = GOOD + "<!--" + ("x" * 200) + "-->"
    assert "size" in codes(big, max_bytes=100)


def test_findings_carry_line_numbers():
    bad = GOOD.replace("<title>A page</title>", "")
    for f in check(bad):
        assert f.line >= 1


# --- visual-content heuristics ---------------------------------------------
# These two would have flagged the 2026-08-15 data-model page: eight h2
# sections, zero <svg>, and every "diagram" a row of styled divs.

SECTIONED = GOOD.replace(
    "<body><p>Hello</p></body>",
    "<body><h2>One</h2><p>a</p><h2>Two</h2><p>b</p></body>")


def test_sectioned_page_without_svg_is_warning():
    found = [f for f in check(SECTIONED) if f.code == "no-svg"]
    assert found and found[0].level == "warning"


def test_sectioned_page_with_svg_is_clean():
    ok = SECTIONED.replace("<p>a</p>",
                           '<p>a</p><figure><svg viewBox="0 0 10 10"></svg>'
                           "</figure>")
    assert "no-svg" not in codes(ok)


def test_single_section_page_without_svg_is_not_flagged():
    # A one-screen note is not a document; the heuristic keys on 2+ h2.
    one = GOOD.replace("<body><p>Hello</p></body>",
                       "<body><h2>One</h2><p>a</p></body>")
    assert "no-svg" not in codes(one)


def test_figure_built_from_divs_is_warning():
    bad = SECTIONED.replace(
        "<p>a</p>",
        '<p>a</p><figure><div class="flow"><div>Step 1</div>'
        "<div>Step 2</div></div><figcaption>x</figcaption></figure>")
    found = [f for f in check(bad) if f.code == "figure-no-graphic"]
    assert found and found[0].level == "warning"


def test_figure_with_svg_img_or_table_is_not_flagged():
    for inner in ('<svg viewBox="0 0 1 1"></svg>', '<img src="data:,x">',
                  "<table><tr><td>1</td></tr></table>", "<pre>x</pre>"):
        ok = SECTIONED.replace(
            "<p>a</p>", f"<p>a</p><figure>{inner}</figure>")
        assert "figure-no-graphic" not in codes(ok), inner


# --- assets/base.css -------------------------------------------------------

ASSETS = Path(__file__).resolve().parent.parent / "assets"

COLOR_TOKENS = [
    "--bg", "--bg-raised", "--bg-inset", "--border", "--border-strong",
    "--text", "--text-muted", "--text-faint", "--accent", "--ok", "--warn",
    "--bad", "--series-1", "--series-2", "--series-3", "--series-4",
    "--series-5", "--series-6", "--font-sans", "--font-mono",
    # Tints: the fill behind a highlighted block, callout, or diagram box.
    # A theme without them has no way to emphasise a region without painting
    # it in a full-strength hue.
    "--accent-soft", "--ok-soft", "--warn-soft", "--bad-soft",
]
SCALE_TOKENS = [
    "--step--1", "--step-0", "--step-1", "--step-2", "--step-3", "--step-4",
    "--space-1", "--space-2", "--space-3", "--space-4", "--space-5",
    "--space-6", "--space-7",
    # --container is the page column that figures, tables and grids fill;
    # --measure is the narrower cap on running prose inside it.
    "--container", "--measure", "--radius", "--radius-lg",
]

# Components a document-mode page composes from. Every one is exercised by
# references/document.md's section recipe, so a missing class silently
# degrades to unstyled markup.
BASE_COMPONENTS = [
    ".eyebrow", ".num", ".lede", ".big", ".toc", ".eq", ".callout",
    ".stat", ".stats", ".grid2", ".grid3", ".card", ".table-wrap",
    ".theme-toggle", ".lbl", ".lbl-s", ".lbl-xs", ".mono-s", ".mono-xs",
]


def _base_css():
    return (ASSETS / "base.css").read_text(encoding="utf-8")


def test_base_css_exists():
    assert (ASSETS / "base.css").is_file()


def test_base_css_defines_no_colour_tokens():
    defined = set(re.findall(r"(--[A-Za-z0-9_-]+)\s*:", _base_css()))
    leaked = sorted(set(COLOR_TOKENS) & defined)
    assert leaked == [], f"base.css must not define colour tokens: {leaked}"


def test_base_css_defines_every_scale_token():
    defined = set(re.findall(r"(--[A-Za-z0-9_-]+)\s*:", _base_css()))
    missing = sorted(set(SCALE_TOKENS) - defined)
    assert missing == [], f"base.css is missing scale tokens: {missing}"


def test_base_css_has_no_colour_literals():
    css = _base_css()
    # Print has no theme — paper is white — so the print block is the one
    # place a literal is correct. Drop it before scanning.
    css = re.sub(r"@media\s+print\s*{.*?}\s*}", "", css, flags=re.S)
    # Strip custom-property definitions; base.css defines no colour ones, so
    # anything left carrying a literal is a hardcoded colour.
    css = re.sub(r"--[A-Za-z0-9_-]+\s*:[^;}]*", "", css)
    hits = re.findall(r"#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(", css)
    assert hits == [], f"base.css must hold no colour literals: {hits}"


def test_base_css_references_every_colour_token():
    css = _base_css()
    missing = [t for t in COLOR_TOKENS if f"var({t})" not in css]
    assert missing == [], (
        f"base.css must reference every colour token so a theme that drops "
        f"one is caught: {missing}")


def test_base_css_sets_explicit_backgrounds():
    css = _base_css()
    assert re.search(r"\bhtml\b[^{]*{[^}]*background", css, re.S)
    assert re.search(r"\bbody\b[^{]*{[^}]*background", css, re.S)


def test_base_css_has_print_styles():
    assert "@media print" in _base_css()


def test_base_css_scrolls_wide_content_internally():
    # Wide tables and code must scroll in their own box; the page body must
    # never scroll horizontally.
    assert "overflow-x: auto" in _base_css()


def test_base_css_keeps_prose_measure_off_the_container():
    # The 2026-08-15 failure: `main { max-width: 68ch }` squeezed every
    # figure to paragraph width and clipped a six-step flow at step five.
    # The container takes --container; only prose elements take --measure.
    css = re.sub(r"/\*.*?\*/", "", _base_css(), flags=re.S)
    container_rules = re.findall(
        r"(?:^|[,\s}])(?:main|article|\.wrap)\s*(?:,[^{]*)?{([^}]*)}", css)
    assert container_rules, "base.css must style the page container"
    for body in container_rules:
        assert "var(--measure)" not in body, (
            "the container must not take the prose measure; figures inherit "
            "it and get squeezed")
    assert any("max-width: var(--container)" in b for b in container_rules)
    # Running prose is capped.
    assert re.search(r"\bp\b[^{]*{[^}]*max-width:\s*var\(--measure\)", css)
    # Figures fill the container.
    assert re.search(r"figure\s*>\s*svg[^{]*{[^}]*width:\s*100%", css)


def test_base_css_defines_every_component():
    css = re.sub(r"/\*.*?\*/", "", _base_css(), flags=re.S)
    missing = [c for c in BASE_COMPONENTS
               if not re.search(re.escape(c) + r"(?![\w-])", css)]
    assert missing == [], f"base.css is missing components: {missing}"


def test_base_css_heading_hierarchy_is_real():
    # Distinct sizes and weights per level, and h2 carries the section
    # spacing that separates one topic from the next.
    css = re.sub(r"/\*.*?\*/", "", _base_css(), flags=re.S)
    h1 = re.search(r"(?:^|[\s,}])h1\s*{([^}]*)}", css).group(1)
    h2 = re.search(r"(?:^|[\s,}])h2\s*{([^}]*)}", css).group(1)
    assert "var(--step-4)" in h1
    assert "var(--step-2)" in h2
    assert "var(--space-7)" in h2, "h2 needs a section-scale top margin"
    assert re.search(r"text-wrap:\s*balance", css)


# --- assets/themes/*.css ---------------------------------------------------

THEMES = ASSETS / "themes"
THEME_NAMES = ["tokyonight", "ghostty", "apple"]


def _theme_css(name):
    return (THEMES / f"{name}.css").read_text(encoding="utf-8")


def _defs_in(block):
    return set(re.findall(r"(--[A-Za-z0-9_-]+)\s*:", block))


def _root_block(css):
    """The bare :root block — the light palette."""
    m = re.search(r"(?<![\w\]\)-]):root\s*{(.*?)}", css, re.S)
    return m.group(1) if m else ""


def _dark_media_block(css):
    m = re.search(
        r"@media[^{]*prefers-color-scheme\s*:\s*dark[^{]*{(.*?)}\s*}", css,
        re.S)
    return m.group(1) if m else ""


def _dark_attr_block(css):
    m = re.search(r':root\[data-theme="dark"\]\s*{(.*?)}', css, re.S)
    return m.group(1) if m else ""


def test_every_theme_file_exists():
    missing = [n for n in THEME_NAMES if not (THEMES / f"{n}.css").is_file()]
    assert missing == []


def test_light_root_defines_every_colour_token():
    for name in THEME_NAMES:
        defined = _defs_in(_root_block(_theme_css(name)))
        missing = sorted(set(COLOR_TOKENS) - defined)
        assert missing == [], f"{name}: :root missing {missing}"


def test_dark_media_block_overrides_every_colour_token():
    for name in THEME_NAMES:
        block = _dark_media_block(_theme_css(name))
        defined = _defs_in(block)
        # Fonts do not change between modes; every other token must.
        expect = set(COLOR_TOKENS) - {"--font-sans", "--font-mono"}
        missing = sorted(expect - defined)
        assert missing == [], f"{name}: dark media block missing {missing}"


def test_dark_attr_block_matches_dark_media_block():
    for name in THEME_NAMES:
        css = _theme_css(name)
        media = _defs_in(_dark_media_block(css))
        attr = _defs_in(_dark_attr_block(css))
        assert media == attr, (
            f"{name}: [data-theme=dark] and the media query define different "
            f"tokens; symmetric difference {sorted(media ^ attr)}")


def test_dark_media_query_is_guarded_against_explicit_light():
    for name in THEME_NAMES:
        assert ':root:not([data-theme="light"])' in _theme_css(name), (
            f"{name}: the dark media block must be guarded so an explicit "
            f"light choice wins over the system preference")


def test_themes_agree_on_the_token_vocabulary():
    vocab = {n: _defs_in(_root_block(_theme_css(n))) for n in THEME_NAMES}
    first = vocab[THEME_NAMES[0]]
    for name in THEME_NAMES[1:]:
        assert vocab[name] == first, (
            f"{name} and {THEME_NAMES[0]} disagree: "
            f"{sorted(vocab[name] ^ first)}")


def test_theme_files_define_no_selectors_beyond_root():
    # Token blocks only. Structure lives in base.css; a theme that styles an
    # element makes the two files fight.
    for name in THEME_NAMES:
        css = re.sub(r"/\*.*?\*/", "", _theme_css(name), flags=re.S)
        css = re.sub(r"@media[^{]*{", "", css)
        selectors = re.findall(r"([^{}]+){", css)
        for sel in selectors:
            sel = sel.strip().rstrip(",")
            if not sel:
                continue
            assert sel.startswith(":root"), (
                f"{name}: unexpected selector {sel!r}; theme files carry "
                f"tokens only")


def test_base_and_themes_cover_the_same_token_set():
    # The contract between the two files: base.css uses exactly what the
    # themes define. Either side drifting is caught here.
    used = {t for t in COLOR_TOKENS if f"var({t})" in _base_css()}
    for name in THEME_NAMES:
        defined = _defs_in(_root_block(_theme_css(name)))
        assert used <= defined, (
            f"{name} does not define {sorted(used - defined)}, which "
            f"base.css uses")
