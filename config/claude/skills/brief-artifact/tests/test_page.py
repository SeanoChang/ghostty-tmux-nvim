"""Browser tests for the built page: the reply text, copy and its fallbacks,
width, themes, and that the page loads nothing. Headless Chromium (Playwright).

The reply is checked against `expected_reply`, a second version written in
Python, on random briefs and random answers.
"""
import random
import re

import pytest

pytest.importorskip("playwright.sync_api")
from playwright.sync_api import sync_playwright  # noqa: E402

from test_build import DECISIONS, build  # noqa: E402

ORIGIN = "https://brief.test"


def wrap(page_html):
    """What the Artifact publish step does: it supplies the document around the page."""
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1"></head>'
            f"<body>{page_html}</body></html>")


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


def open_page(browser, page_html, width=1100, height=900, scheme="light", clipboard=True):
    # Reduced motion makes the pane's scroll instant, so the tests need no waits.
    context = browser.new_context(viewport={"width": width, "height": height}, color_scheme=scheme,
                                  reduced_motion="reduce")
    if clipboard:
        context.grant_permissions(["clipboard-read", "clipboard-write"], origin=ORIGIN)
    page = context.new_page()
    page.problems = []
    page.requests = []
    page.on("console", lambda m: page.problems.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: page.problems.append(str(e)))
    page.on("request", lambda r: page.requests.append(r.url))
    page.route(ORIGIN + "/**", lambda route: route.fulfill(body=wrap(page_html), content_type="text/html; charset=utf-8"))
    page.goto(ORIGIN + "/")
    return page


def indent(text):
    return text.replace("\n", "\n   ")


def expected_reply(title, decisions, answers, comment):
    """Reference for the page's compose(): answers is [{"keys": set, "note": str}] per decision."""
    lines, answered = ["Response to brief: " + title], 0
    for i, (d, a) in enumerate(zip(decisions, answers), 1):
        picked = [f'{o["key"]}. {o["label"]}' for o in d["options"] if o["key"] in a["keys"]]
        note = a["note"].strip()
        answered += bool(picked or note)
        lines += ["", f'{i}. {d["title"]}']
        if d["kind"] == "open":
            lines.append("   → " + (indent(note) if note else "(no answer)"))
        else:
            lines.append("   → " + ("; ".join(picked) if picked else "(none of the options)" if note else "(no answer)"))
            if note:
                lines.append("   Note: " + indent(note))
    if comment.strip():
        lines += ["", "Comment: " + indent(comment.strip())]
    return "\n".join(lines), answered


def fill(page, decisions, answers, comment):
    for i, (d, a) in enumerate(zip(decisions, answers), 1):
        for key in sorted(a["keys"]):
            page.check(f'#d{i} input[value="{key}"]')
        if a["note"]:
            page.fill(f"#d{i} textarea", a["note"])
    if comment:
        page.fill("#comment", comment)


def test_copy_puts_the_answers_on_the_clipboard(browser):
    r = build.build(DECISIONS)
    page = open_page(browser, r.html)
    assert page.inner_text("#status") == "0 of 3 answered"
    answers = [{"keys": {"B"}, "note": "only for this repo"}, {"keys": {"A", "C"}, "note": ""},
               {"keys": set(), "note": "Check zsh too.\nThen merge."}]
    fill(page, r.decisions, answers, "Go ahead.")
    assert page.inner_text("#status") == "3 of 3 answered"
    page.click("#copy")
    page.wait_for_function("document.getElementById('status').textContent.startsWith('Copied')")
    copied = page.evaluate("navigator.clipboard.readText()")
    assert copied == (
        "Response to brief: Merge gate approach\n"
        "\n"
        "1. How should the hook treat a merge inside a larger command?\n"
        "   → B. Narrow the separators\n"
        "   Note: only for this repo\n"
        "\n"
        "2. Which skills fixes do I apply?\n"
        "   → A. Task card; C. Model on spawns\n"
        "\n"
        "3. Anything else before I start?\n"
        "   → Check zsh too.\n"
        "   Then merge.\n"
        "\n"
        "Comment: Go ahead."
    )
    assert copied == expected_reply(r.title, r.decisions, answers, "Go ahead.")[0]
    assert page.inner_text("#status") == "Copied. Paste it in the chat."
    assert page.problems == []


def test_an_unanswered_decision_is_named_in_the_reply_and_the_status(browser):
    r = build.build(DECISIONS)
    page = open_page(browser, r.html)
    page.check('#d1 input[value="A"]')
    page.click("#copy")
    page.wait_for_function("document.getElementById('status').textContent.startsWith('Copied')")
    assert page.inner_text("#status") == "Copied with 2 unanswered. Paste it in the chat."
    copied = page.evaluate("navigator.clipboard.readText()")
    assert copied.count("(no answer)") == 2 and "→ A. Gate plain merges only" in copied
    # A later edit removes the message and shows the count again.
    page.check('#d2 input[value="B"]')
    assert page.inner_text("#status") == "2 of 3 answered"


def test_pick_one_keeps_one_answer_and_use_recommendations_sets_them(browser):
    r = build.build(DECISIONS)
    page = open_page(browser, r.html)
    page.check('#d1 input[value="C"]')
    page.check('#d1 input[value="B"]')
    page.check('#d2 input[value="A"]')
    assert page.eval_on_selector_all("#d1 input:checked", "els => els.map(e => e.value)") == ["B"]
    page.click("#accept")
    assert page.eval_on_selector_all("#d1 input:checked", "els => els.map(e => e.value)") == ["A"]
    assert page.eval_on_selector_all("#d2 input:checked", "els => els.map(e => e.value)") == ["B", "C"]
    assert page.inner_text("#status") == "2 of 3 answered"
    assert "→ A. Gate plain merges only" in page.inner_text("#reply")
    # No recommendation anywhere: the button is not on the page.
    plain = build.build("# Two words\n\n## ? Q\n\n- **A**\n- **B**\n")
    assert 'id="accept"' not in plain.html


def test_copy_falls_back_when_the_clipboard_is_blocked(browser):
    r = build.build(DECISIONS)
    # Step 1 blocked, step 2 works: the old command copies.
    page = open_page(browser, r.html)
    page.evaluate("""() => {
      Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('blocked')) } });
      window.seen = null;
      document.execCommand = () => { window.seen = document.activeElement.value; return true; };
    }""")
    page.check('#d1 input[value="A"]')
    page.click("#copy")
    page.wait_for_function("document.getElementById('status').textContent.startsWith('Copied')")
    assert page.evaluate("window.seen") == page.inner_text("#reply")
    assert page.locator("main textarea.offscreen").count() == 0

    # Both blocked: the reply is selected on the page and the status says what to press.
    # Some engines replace the text node on every write to textContent, which
    # drops a selection inside it. The page here is made to do the same, so the
    # test fails if the reply is written again after it was selected.
    page = open_page(browser, r.html, clipboard=False)
    page.evaluate("""() => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined });
      document.execCommand = () => false;
      const reply = document.getElementById('reply');
      const native = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
      Object.defineProperty(reply, 'textContent', {
        get() { return native.get.call(this); },
        set(value) { this.replaceChildren(document.createTextNode(value)); },
      });
    }""")
    page.check('#d1 input[value="A"]')
    page.click("#copy")
    page.wait_for_function("document.getElementById('status').textContent.startsWith('Copy is blocked')")
    assert page.inner_text("#status") == "Copy is blocked here. The response is selected: press Cmd+C or Ctrl+C."
    assert page.evaluate("window.getSelection().toString()") == page.evaluate("document.getElementById('reply').textContent")
    assert page.problems == []


SAFE = "abc XYZ 019 \"'<>&;:=/()é中→.,!?%#"


def random_brief(rng):
    def text(prefix):
        return prefix + "".join(rng.choice(SAFE) for _ in range(rng.randint(0, 18)))
    lines = ["# Random brief", ""]
    for d in range(rng.randint(1, 5)):
        kind = rng.choice(["one", "many", "open"])
        lines += [f'## {"?+" if kind == "many" else "?"} {text(f"Q{d} ")}', ""]
        if kind != "open":
            count = rng.randint(2, 5)
            rec = rng.randrange(count) if rng.random() < 0.7 else -1
            for o in range(count):
                mark = " (recommended)" if o == rec else ""
                lines.append(f'- **{text(f"L{o} ").strip()}**{mark} — {text("d ")}')
            lines.append("")
    return "\n".join(lines) + "\n"


def test_the_reply_matches_a_second_version_on_random_briefs_and_answers(browser):
    rng = random.Random(7)
    notes = ["", "", "ok", "  two words  ", "line one\nline two", 'a "quote" <tag> & more', "→ arrow é 中"]
    checked = 0
    context = browser.new_context(viewport={"width": 900, "height": 800})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    current = {"html": ""}
    page.route(ORIGIN + "/**", lambda route: route.fulfill(body=wrap(current["html"]), content_type="text/html; charset=utf-8"))
    for _ in range(40):
        try:
            r = build.build(random_brief(rng))
        except build.BriefError:
            continue
        current["html"] = r.html
        page.goto(ORIGIN + "/")
        answers = []
        for d in r.decisions:
            keys = [o["key"] for o in d["options"]]
            if d["kind"] == "one":
                picked = set(rng.sample(keys, rng.choice([0, 1])))
            elif d["kind"] == "many":
                picked = set(rng.sample(keys, rng.randint(0, len(keys))))
            else:
                picked = set()
            answers.append({"keys": picked, "note": rng.choice(notes)})
        comment = rng.choice(notes)
        fill(page, r.decisions, answers, comment)
        text, answered = expected_reply(r.title, r.decisions, answers, comment)
        assert page.evaluate("document.getElementById('reply').textContent") == text
        assert page.inner_text("#status") == f"{answered} of {len(r.decisions)} answered"
        checked += 1
    assert checked >= 30 and errors == []


WIDE = """# Width check page

> A lead with averyveryveryveryveryveryveryveryveryveryveryveryverylongwordthatcannotbreakanywhereelse in it.

Text with `a_very_long_inline_code_span_that_has_no_break_points_at_all_in_it_0123456789_0123456789` and
https://example.com/a/very/long/url/that/has/no/spaces/and/keeps/going/and/going/and/going/and/going.

| Column one | Column two | Column three | Column four | Column five | Column six |
| --- | --- | --- | --- | --- | --- |
| a_long_cell_value_without_breaks | another_long_cell_value | third_long_cell_value | fourth | fifth_long_cell_value | sixth |

```bash
python3 -m pytest tests/test_merge_gate.py -q -p no:cacheprovider --some-very-long-flag=with_a_very_long_value_that_goes_on
```

## ? Averyveryveryveryveryveryverylongquestionwordwithoutanybreaks, how wide can it get?

- **Averyveryveryveryveryveryveryverylonglabelwithoutanybreakpoints** (recommended) — `and_a_long_code_span_inside_the_option_text_0123456789_0123456789`
- **Short** — fine.

> [!warning] Averyveryveryveryveryveryveryveryverylongcallouttitlewithoutbreaks
> Body.
"""


@pytest.mark.parametrize("width", [320, 360, 768, 899, 900, 1040, 1280, 1920])
def test_the_page_never_scrolls_sideways(browser, width):
    page = open_page(browser, build.build(WIDE).html, width=width, height=800)
    sizes = page.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
    assert sizes[0] <= sizes[1], sizes
    # The text column keeps a gutter of at least 16px on a phone.
    left = page.evaluate("document.querySelector('h1').getBoundingClientRect().left")
    assert left >= 16
    # The action bar stays on screen with both buttons inside the window.
    for button in ("#accept", "#copy"):
        box = page.locator(button).bounding_box()
        assert box["x"] >= 0 and box["x"] + box["width"] <= width and box["height"] >= 40
    assert page.problems == []


def test_the_page_loads_nothing_from_the_network(browser):
    page = open_page(browser, build.build(DECISIONS + "\n![an image](https://example.com/x.png)\n").html)
    page.wait_for_load_state("networkidle")
    assert page.requests == [ORIGIN + "/"]
    assert page.locator("img").count() == 0


def rgb(hex_colour):
    return "rgb({}, {}, {})".format(*(int(hex_colour[i:i + 2], 16) for i in (1, 3, 5)))


def test_dark_and_light_follow_the_system_and_the_viewer_setting(browser):
    html = build.build(DECISIONS).html
    background = "getComputedStyle(document.body).backgroundColor"
    light = open_page(browser, html, scheme="light")
    assert light.evaluate(background) == rgb(build.LIGHT["bg"])
    dark = open_page(browser, html, scheme="dark")
    assert dark.evaluate(background) == rgb(build.DARK["bg"])
    assert dark.evaluate("getComputedStyle(document.querySelector('h1')).color") == rgb(build.DARK["ink"])
    # The viewer's own switch wins over the system setting, both ways.
    dark.evaluate("document.documentElement.dataset.theme = 'light'")
    assert dark.evaluate(background) == rgb(build.LIGHT["bg"])
    light.evaluate("document.documentElement.dataset.theme = 'dark'")
    assert light.evaluate(background) == rgb(build.DARK["bg"])


def luminance(hex_colour):
    def channel(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (int(hex_colour[i:i + 2], 16) for i in (1, 3, 5))
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def contrast(a, b):
    hi, lo = sorted((luminance(a), luminance(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


@pytest.mark.parametrize("name", ["LIGHT", "DARK"])
def test_every_text_colour_passes_4_5_to_1_on_every_surface_it_sits_on(name):
    theme = getattr(build, name)
    for ink in ("ink", "ink-2", "ink-3", "link"):
        for surface in ("bg", "raised", "panel"):
            ratio = contrast(theme[ink], theme[surface])
            assert ratio >= 4.5, (name, ink, surface, round(ratio, 2))
    # The primary button is the inverse pair.
    assert contrast(theme["bg"], theme["ink"]) >= 7


def rgb_hex(css):
    r, g, b = (int(v) for v in re.findall(r"\d+", css)[:3])
    return f"#{r:02x}{g:02x}{b:02x}"


@pytest.mark.parametrize("scheme", ["light", "dark"])
def test_a_selected_option_has_a_filled_key_that_does_not_depend_on_hue(browser, scheme):
    """The reader is red-green colour-blind: selected against not selected is light against dark."""
    page = open_page(browser, build.build(DECISIONS).html, scheme=scheme)
    theme = build.LIGHT if scheme == "light" else build.DARK
    option = page.locator("#d1 label.option").nth(1)
    key = option.locator(".key")
    assert key.inner_text() == "B"
    assert rgb_hex(key.evaluate("e => getComputedStyle(e).backgroundColor")) != theme["ink"]
    option.click()
    assert page.locator('#d1 input[value="B"]').is_checked()
    filled = rgb_hex(key.evaluate("e => getComputedStyle(e).backgroundColor"))
    letter = rgb_hex(key.evaluate("e => getComputedStyle(e).color"))
    assert filled == theme["ink"] and contrast(filled, theme["bg"]) >= 7 and contrast(letter, filled) >= 7
    # The other keys stay empty. Every option is a card with a border on all four
    # sides, and the picked card has an ink border and an ink ring around it.
    other = page.locator("#d1 label.option").nth(0)
    assert rgb_hex(other.locator(".key").evaluate("e => getComputedStyle(e).backgroundColor")) != theme["ink"]
    for card in (option, other):
        for side in ("Top", "Right", "Bottom", "Left"):
            assert card.evaluate(f"e => getComputedStyle(e).border{side}Width") == "1px"
    solid_ink = rgb(theme["ink"])  # the full colour, with no transparency
    assert option.evaluate("e => getComputedStyle(e).borderTopColor") == solid_ink
    ring = option.evaluate("e => getComputedStyle(e).boxShadow")
    assert ring.startswith(solid_ink) and "inset" not in ring
    assert other.evaluate("e => getComputedStyle(e).boxShadow") == "none"
    assert other.evaluate("e => getComputedStyle(e).borderTopColor") != solid_ink
    # Cards do not touch: there is a gap between them.
    first, second = other.bounding_box(), option.bounding_box()
    assert second["y"] - (first["y"] + first["height"]) >= 8
    # Pick-one keys are round and pick-any keys are square.
    assert key.evaluate("e => getComputedStyle(e).borderTopLeftRadius") == "50%"
    assert page.locator("#d2 .key").first.evaluate("e => getComputedStyle(e).borderTopLeftRadius") == "0px"


def test_options_work_from_the_keyboard(browser):
    page = open_page(browser, build.build(DECISIONS).html)
    page.focus('#d1 input[value="A"]')
    page.keyboard.press("Space")
    assert page.locator('#d1 input[value="A"]').is_checked()
    page.keyboard.press("ArrowDown")
    assert page.locator('#d1 input[value="B"]').is_checked()
    outline = page.locator('#d1 label.option').nth(1).locator(".key").evaluate("e => getComputedStyle(e).outlineStyle")
    assert outline == "solid"


LONG = DECISIONS + "\n" + "\n".join(f"## Part {i}\n\n" + "Filler text. " * 60 + "\n" for i in range(4))


def test_the_section_pane_sits_left_of_the_text_on_a_wide_window_only(browser):
    html = build.build(LONG).html
    wide = open_page(browser, html, width=1280, height=800)
    nav, main = wide.locator("nav.toc").bounding_box(), wide.locator("main").bounding_box()
    assert nav["x"] >= 16 and nav["x"] + nav["width"] <= main["x"]
    assert main["width"] <= 732
    # It stays in view while the page scrolls.
    wide.evaluate("window.scrollTo(0, 2000)")
    assert wide.evaluate("window.scrollY") == 2000
    assert abs(wide.evaluate("document.querySelector('nav.toc').getBoundingClientRect().top")) <= 1
    for width in (899, 600, 360):
        narrow = open_page(browser, html, width=width, height=800)
        assert not narrow.locator("nav.toc").is_visible()
    assert wide.problems == []


def test_a_pane_link_scrolls_to_its_section_and_does_not_navigate(browser):
    page = open_page(browser, build.build(LONG).html, width=1280, height=800)
    before = page.url
    page.click('nav.toc a[data-target="s3"]')
    top = page.evaluate("document.getElementById('s3').getBoundingClientRect().top")
    assert 0 <= top <= 120, top
    assert page.url == before  # no fragment navigation inside the viewer's frame
    assert page.get_attribute('nav.toc a[data-target="s3"]', "aria-current") == "true"
    assert page.locator('nav.toc a[aria-current="true"]').count() == 1
    page.click('nav.toc a[data-target="d2"]')
    assert page.get_attribute('nav.toc a[data-target="d2"]', "aria-current") == "true"
    assert page.locator('nav.toc a[aria-current="true"]').count() == 1
    # The reader's own scroll, after the click's scroll came to rest, hands the
    # choice back to the scroll position.
    page.wait_for_timeout(400)
    page.mouse.move(640, 400)
    page.mouse.wheel(0, -30000)
    page.wait_for_function("document.querySelector('nav.toc a[data-target=\"d1\"]').getAttribute('aria-current') === 'true'")
    assert page.problems == []


def test_the_pane_shows_which_decisions_are_answered(browser):
    page = open_page(browser, build.build(LONG).html, width=1280, height=800)
    answered = "els => els.map(e => e.dataset.target)"
    assert page.eval_on_selector_all("nav.toc a[data-answered]", answered) == []
    page.check('#d2 input[value="B"]')
    page.fill("#d3 textarea", "yes")
    assert page.eval_on_selector_all("nav.toc a[data-answered]", answered) == ["d2", "d3"]
    chip = page.locator('nav.toc a[data-target="d2"] .toc-num')
    assert rgb_hex(chip.evaluate("e => getComputedStyle(e).backgroundColor")) == build.LIGHT["ink"]
    page.uncheck('#d2 input[value="B"]')
    assert page.eval_on_selector_all("nav.toc a[data-answered]", answered) == ["d3"]


def test_a_report_with_no_decision_still_has_a_working_pane(browser):
    report = "# Build review\n\nAll green.\n\n" + "\n".join(f"## Part {i}\n\n" + "Filler text. " * 80 + "\n" for i in range(4))
    page = open_page(browser, build.build(report).html, width=1280, height=800)
    page.click('nav.toc a[data-target="s4"]')
    assert page.get_attribute('nav.toc a[data-target="s4"]', "aria-current") == "true"
    assert page.locator("#copy").count() == 0 and page.problems == []


@pytest.mark.parametrize("kinds", [["quote"] * 13, ["list"] * 6, ["list", "quote"] * 4 + ["quote"]])
def test_the_deepest_nesting_the_script_accepts_fits_a_320px_page(browser, kinds):
    from test_build import nested
    page = open_page(browser, build.build(nested(kinds)).html, width=320, height=700)
    sizes = page.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
    assert sizes[0] <= sizes[1], (kinds, sizes)


def test_at_the_end_of_the_page_the_last_part_in_view_is_the_current_one(browser):
    page = open_page(browser, build.build(LONG).html, width=1280, height=800)
    page.mouse.move(640, 400)
    page.mouse.wheel(0, 60000)
    page.wait_for_function("document.querySelector('nav.toc a[data-target=\"respond\"]').getAttribute('aria-current') === 'true'")
    assert page.locator('nav.toc a[aria-current="true"]').count() == 1
    # A click on a part that cannot reach the top keeps that part as the current one.
    page.click('nav.toc a[data-target="s5"]')
    assert page.get_attribute('nav.toc a[data-target="s5"]', "aria-current") == "true"
    page.wait_for_timeout(400)
    assert page.get_attribute('nav.toc a[data-target="s5"]', "aria-current") == "true"


def test_a_fragment_link_in_the_text_scrolls_and_never_moves_the_viewer_frame(browser):
    """In a srcdoc frame a plain `#id` link loads the parent page into the frame, and the answers are lost."""
    import html as html_lib
    source = LONG.replace("The hook failed review three times on one bug class.",
                          "See [the second decision](#d2), [part three](#s3) and [nothing](#nowhere).")
    doc = wrap(build.build(source).html)
    viewer = ('<!doctype html><html><body><h1>VIEWER</h1>'
              f'<iframe id="frame" style="width:1280px;height:800px;border:0" srcdoc="{html_lib.escape(doc)}"></iframe>'
              '</body></html>')
    context = browser.new_context(viewport={"width": 1300, "height": 900}, reduced_motion="reduce")
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.route(ORIGIN + "/**", lambda route: route.fulfill(body=viewer, content_type="text/html; charset=utf-8"))
    page.goto(ORIGIN + "/viewer")
    frame = page.frame_locator("#frame")
    frame.locator('#d1 input[value="A"]').check()
    for target in ("d2", "s3", "nowhere"):
        frame.locator(f'main a[href="#{target}"]').click()
        page.wait_for_timeout(100)
        # The frame still shows the brief, with the answer in place.
        assert frame.locator("main.brief").count() == 1 and frame.locator("h1", has_text="VIEWER").count() == 0
        assert frame.locator('#d1 input[value="A"]').is_checked()
        assert page.frames[1].url == "about:srcdoc"
        if target != "nowhere":
            top = frame.locator(f"#{target}").evaluate("e => e.getBoundingClientRect().top")
            assert 0 <= top <= 120, (target, top)
            assert frame.locator(f'nav.toc a[data-target="{target}"]').get_attribute("aria-current") == "true"
    assert errors == []
    # A report with one part has no pane, and its fragment links must behave the same way.
    one = wrap(build.build("# Two words\n\n[top](#) and [gone](#nowhere)\n").html)
    page.route(ORIGIN + "/**", lambda route: route.fulfill(
        body=viewer.split('srcdoc="')[0] + f'srcdoc="{html_lib.escape(one)}"></iframe></body></html>',
        content_type="text/html; charset=utf-8"))
    page.goto(ORIGIN + "/viewer2")
    frame = page.frame_locator("#frame")
    for href in ("#", "#nowhere"):
        frame.locator(f'main a[href="{href}"]').click()
        page.wait_for_timeout(100)
        assert frame.locator("main.brief").count() == 1 and page.frames[1].url == "about:srcdoc"
    assert errors == []
