"""Tests for scripts/render_check.py.

Static checks run in-process. The render test drives real headless Chromium
(Playwright) against a tiny page, so it is the one slow test.
"""

import importlib.util
import pathlib
import sys

import pytest

HERE = pathlib.Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("render_check", HERE.parent / "scripts" / "render_check.py")
rc = importlib.util.module_from_spec(SPEC)
sys.modules["render_check"] = rc
SPEC.loader.exec_module(rc)

GOOD = """<title>Optimizer Lab</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader&display=swap">
<style>
:root { --bg: #FAF9F5; --ink: #141413; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #262624; --ink: #F5F4EE; color-scheme: dark; } }
:root[data-theme="dark"] { --bg: #262624; --ink: #F5F4EE; color-scheme: dark; }
body { background: var(--bg); color: var(--ink); }
.wrap { padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }
</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script type="importmap">{"imports": {"three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js"}}</script>
<div class="wrap"><h1>Hello</h1><input id="lr" type="range"></div>
<script>document.querySelector('h1').textContent = 'Hello';</script>
"""


def codes(html, level=None):
    return {i.code for i in rc.check_static(html) if level is None or i.level == level}


def test_good_page_has_no_errors():
    assert codes(GOOD, "error") == set()


def test_wrapper_tags_are_errors():
    assert "wrapper-tags" in codes("<!doctype html><html><head></head><body>" + GOOD + "</body></html>", "error")


def test_missing_title_is_error():
    assert "no-title" in codes(GOOD.replace("<title>Optimizer Lab</title>", ""), "error")


def test_title_with_explainer_is_warning():
    assert "title-shape" in codes(GOOD.replace("Optimizer Lab", "Optimizer Lab: an interactive explainer"), "warn")


def test_unpinned_script_is_error():
    html = GOOD.replace("three.js/r128/three.min.js", "three.js/three.min.js")
    assert "script-unpinned" in codes(html, "error")


def test_script_from_blocked_host_is_error():
    html = GOOD + '<script type="module">import * as T from "https://esm.sh/three@0.170.0";</script>'
    assert "script-host" in codes(html, "error")


def test_importmap_entries_are_checked():
    html = GOOD.replace("three@0.170.0", "three")
    assert "script-unpinned" in codes(html, "error")


def test_stylesheet_from_other_host_is_error():
    html = GOOD + '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">'
    assert "style-host" in codes(html, "error")


@pytest.mark.parametrize("call", ["alert('x')", "confirm('sure?')", "prompt('name')", "window.print()"])
def test_dead_dialogs_are_errors(call):
    assert "dead-api" in codes(GOOD + f"<script>{call}</script>", "error")


def test_missing_dark_mode_is_error():
    html = GOOD.replace("prefers-color-scheme: dark", "min-width: 1px").replace(':root[data-theme="dark"]', ".x")
    assert "theme-blocks" in codes(html, "error")


def test_sides_meta_without_max_padding_is_error():
    html = GOOD.replace("max(16px, env(safe-area-inset-left, 0px))", "16px")
    assert "viewport-sides" in codes(html, "error")


def test_literal_colour_outside_tokens_is_warning():
    html = GOOD.replace("body { background: var(--bg);", "body { background: var(--bg); border-color: #ff0000;")
    assert "literal-color" in codes(html, "warn")


def test_literal_colour_inside_token_blocks_is_fine():
    assert "literal-color" not in codes(GOOD)


def test_control_without_id_is_warning():
    assert "control-id" in codes(GOOD.replace('<input id="lr" type="range">', '<input type="range">'), "warn")


def test_controls_named_in_css_comments_are_not_controls():
    html = GOOD.replace("</style>", '/* <input type="range" class="range"> */</style>')
    assert "control-id" not in codes(html)


def test_download_link_is_error():
    assert "dead-api" in codes(GOOD + '<a download href="data:text/plain,hi">Save</a>', "error")


def test_external_fetch_is_error():
    assert "external-fetch" in codes(GOOD + "<script>fetch('https://api.example.com/x')</script>", "error")


LONG = "<div class='prose'><p>" + " ".join(
    "This sentence keeps going and going with clause after clause because the writer never stops to breathe or split the idea into parts." for _ in range(4)
) + "</p></div>"


def test_long_sentences_warn():
    assert "prose-long" in codes(GOOD + LONG, "warn")


def test_short_sentences_pass():
    short = "<div class='prose'><p>" + " ".join("The worker saves a checkpoint after each step." for _ in range(12)) + "</p></div>"
    assert "prose-long" not in codes(GOOD + short)


def test_hype_word_warns():
    assert "hype" in codes(GOOD + "<div class='prose'><p>This is a powerful and seamless design.</p></div>", "warn")


def test_tex_without_katex_is_error():
    assert "katex-missing" in codes(GOOD + '<span class="tex">x^2</span>', "error")


def test_tex_with_katex_passes():
    html = GOOD + '<style data-va="katex.css"></style><script src="https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.js"></script><span class="tex">x^2</span>'
    assert "katex-missing" not in codes(html)


def test_guide_section_without_check_question_warns():
    html = GOOD + """<div class="docs"><main class="docs-main">
      <section class="doc-page" id="a" data-title="Overview"><h1>A</h1></section>
      <section class="doc-page" id="b" data-title="Step"><h1>B</h1><p>no check here</p></section>
      <section class="doc-page" id="c" data-title="Step 2"><h1>C</h1><div class="decide" data-answer="a"></div></section></main></div>"""
    msgs = [i.message for i in rc.check_static(html) if i.code == "no-check"]
    assert len(msgs) == 1 and "#b" in msgs[0]


def test_simplified_chinese_on_a_chinese_page_warns():
    zh = "<div class='prose'><p>這個系統會把工作放進佇列。我们说这个设计让发送者不用等待。</p></div>"
    assert "zh-simplified" in codes(GOOD + zh, "warn")


def test_traditional_chinese_passes():
    zh = "<div class='prose'><p>這個系統會把工作放進佇列。發送者不用等待，所以呼叫不會卡住。</p></div>"
    assert "zh-simplified" not in codes(GOOD + zh)


def test_hand_set_math_warns():
    assert "hand-math" in codes(GOOD + '<p class="prose">Rate <span class="math"><var>λ</var></span></p>', "warn")


def test_guide_without_a_map_figure_warns():
    html = GOOD + """<div class="docs"><main class="docs-main">
      <section class="doc-page" id="a" data-title="Overview"><h1>A</h1><ol class="ladder"></ol></section>
      <section class="doc-page" id="b" data-title="Step"><h1>B</h1><div class="decide" data-answer="a"></div></section></main></div>"""
    assert "no-map" in codes(html, "warn")


def plan_html(tasks, files='<li class="file" data-blk="cli" data-change="new"><code>cmd/a.go</code></li>'):
    return GOOD + f"""<div class="docs" data-plan><main class="docs-main">
      <section class="doc-page" id="overview" data-title="Overview"><figure class="fig plan-map"><svg>
        <g class="blk" data-blk="cli" data-name="CLI"><rect/></g><g class="blk" data-blk="store" data-name="Store"><rect/></g></svg></figure></section>
      <section class="doc-page" id="files" data-title="Files"><ul class="file-map">{files}</ul></section>
      <section class="doc-page" id="tasks" data-title="Tasks"><ol class="plan-tasks">{tasks}</ol></section></main></div>"""


def plan_task(n, touches="cli", deps="", with_test=True, with_verify=True):
    d = f' data-deps="{deps}"' if deps else ""
    t = f'<dt>Test first</dt><dd data-part="test">T{n}</dd>' if with_test else ""
    v = f'<dt>Verify</dt><dd data-part="verify"><code>go test</code></dd>' if with_verify else ""
    return f'<li class="task" data-task="{n}"{d} data-touches="{touches}"><h3 class="task-title">Task {n}</h3><dl class="task-spec">{t}{v}</dl></li>'


PLAN_CODES = {"plan-dangling", "plan-cycle", "plan-task-incomplete", "plan-task-code", "plan-task-code-long", "plan-code-ref"}


def test_clean_plan_passes_and_skips_check_questions():
    found = codes(plan_html(plan_task(1) + plan_task(2, "cli,store", deps="1")))
    assert not found & PLAN_CODES
    assert "no-check" not in found, "a plan is not a lesson: no check question per section"
    assert "no-map" not in found


def test_plan_task_touching_an_unknown_block_is_error():
    assert "plan-dangling" in codes(plan_html(plan_task(1, "cli,queue")), "error")


def test_plan_task_depending_on_an_unknown_task_is_error():
    assert "plan-dangling" in codes(plan_html(plan_task(1) + plan_task(2, deps="7")), "error")


def test_plan_file_on_an_unknown_block_is_error():
    assert "plan-dangling" in codes(plan_html(plan_task(1), files='<li class="file" data-blk="db"><code>db.go</code></li>'), "error")


def test_plan_dependency_cycle_is_error():
    assert "plan-cycle" in codes(plan_html(plan_task(1, deps="2") + plan_task(2, deps="1")), "error")


def test_plan_task_without_test_or_verify_warns():
    msgs = [i.message for i in rc.check_static(plan_html(plan_task(1) + plan_task(2, with_verify=False))) if i.code == "plan-task-incomplete"]
    assert len(msgs) == 1 and "task 2" in msgs[0]


# ── plan pages under review: claims, decisions, call trees, code ───────────
def review_html(body):
    return plan_html(plan_task(1)).replace('<section class="doc-page" id="files"', f'<section class="doc-page" id="design" data-title="Design">{body}</section><section class="doc-page" id="files"')


FIG = '<figure class="fig"><div class="fig-body">x</div></figure>'


def claim(text, inner=FIG, deeper=""):
    fold = f'<details class="deeper"><summary>How</summary><div class="deeper-body">{deeper}</div></details>' if deeper else ""
    return f'<article class="claim"><p class="claim-text">{text}</p>{inner}{fold}</article>'


def ask(name, checked=True, qid=None):
    c = " checked" * checked
    return (f'<div class="ask" data-ask="{qid or name.upper()}"><p class="ask-q">Which one?</p>'
            f'<label><input type="radio" id="{name}-a" name="{name}" value="a"{c}> A</label>'
            f'<label><input type="radio" id="{name}-b" name="{name}" value="b"> B</label></div>')


REVIEW_CODES = {"plan-claim-sentence", "plan-claim-exhibit", "plan-claim-shape", "plan-ask-default", "plan-ask-name", "plan-ask-many",
                "plan-code-empty", "plan-code-unmarked", "plan-code-file", "plan-pin-line", "plan-calls-mark", "plan-calls-place"}


def review_codes(body):
    return {i.code for i in rc.check_static(review_html(body))} & REVIEW_CODES


def test_a_clean_review_page_passes():
    body = (claim("A key gets at most its route budget.", deeper=claim("The middleware asks the limiter first.",
            deeper='<article class="claim" data-at="gateway/router.go:31"><p class="claim-text"><code>router.go:31</code> · Use</p>'
                   '<figure class="fig codeblock"><pre class="code-src" data-sketch data-start="30"><code>a\nb</code></pre>'
                   '<ol class="code-pins"><li data-line="31">pin</li></ol></figure></article>'))
            + ask("d1") + '<figure class="fig calls"><script type="text/plain">\n~ a()   @ x.go:1\n+   **b**()   @ x.go:9   -- new\n    c()\n</script></figure>')
    assert review_codes(body) == set()


@pytest.mark.parametrize("text", ["Message limit", "A user can hold fifty scheduled messages at most and the worker sends each one at its time."])
def test_a_claim_that_is_not_a_short_sentence_warns(text):
    assert review_codes(claim(text)) == {"plan-claim-sentence"}


def test_a_place_claim_is_not_held_to_the_sentence_rule():
    body = claim("A key gets at most its route budget.", deeper=claim("The middleware asks the limiter first.",
           deeper=f'<article class="claim" data-at="a.go:3"><p class="claim-text"><code>a.go:3</code> · Take</p>{FIG}</article>'))
    assert review_codes(body) == set()


@pytest.mark.parametrize("inner", ["", FIG + FIG])
def test_a_claim_needs_exactly_one_exhibit(inner):
    assert review_codes(claim("A key gets at most its budget.", inner=inner)) == {"plan-claim-exhibit"}


def test_claims_deeper_than_three_levels_warn():
    four = claim("One is here.", deeper=claim("Two is here.", deeper=claim("Three is here.", deeper=claim("Four is here."))))
    assert review_codes(four) == {"plan-claim-shape"}


def test_more_than_five_child_claims_warn():
    assert review_codes(claim("One is here.", deeper="".join(claim(f"Child {i} is here.") for i in range(6)))) == {"plan-claim-shape"}


def test_a_decision_without_a_suggested_option_is_error():
    assert "plan-ask-default" in codes(review_html(ask("d1", checked=False)), "error")


def test_two_decisions_sharing_a_control_name_is_error():
    assert "plan-ask-name" in codes(review_html(ask("d1") + ask("d1", qid="D2")), "error")


def test_more_than_five_open_decisions_warn():
    assert review_codes("".join(ask(f"d{i}") for i in range(6))) == {"plan-ask-many"}


def test_cited_code_that_was_never_filled_is_error():
    assert "plan-code-empty" in codes(review_html('<pre class="code-src" data-src="a.go" data-lines="1-3"><code></code></pre>'), "error")


def test_code_that_is_neither_cited_nor_a_sketch_nor_a_diff_warns():
    assert review_codes('<pre class="code-src"><code>x := 1</code></pre>') == {"plan-code-unmarked"}


def test_code_for_a_file_missing_from_the_file_map_warns():
    pre = '<pre class="code-src" data-sketch data-file="{}"><code>x</code></pre>'
    assert review_codes(pre.format("cmd/b.go")) == {"plan-code-file"}
    assert review_codes(pre.format("cmd/a.go")) == set()
    assert review_codes('<pre class="code-src" data-src="cmd/a.go" data-lines="1"><code>x</code></pre>') == set()
    msg = next(i.message for i in rc.check_static(review_html(pre.format("cmd/b.go"))) if i.code == "plan-code-file")
    assert "cmd/b.go" in msg


def test_code_on_a_page_without_a_file_map_does_not_warn():
    html = review_html('<pre class="code-src" data-sketch data-file="cmd/b.go"><code>x</code></pre>')
    html = html.replace('<li class="file" data-blk="cli" data-change="new"><code>cmd/a.go</code></li>', "")
    assert "plan-code-file" not in codes(html)


def code_task(files=("cmd/a.go",), key=None, ref=""):
    """A task that lists files and, when key is given, a Key change row holding that markup (ref: data-code ids)."""
    fs = "".join(f"<li><code>{f}</code></li>" for f in files)
    row = f'<dt>Key change</dt><dd data-part="code"{f' data-code="{ref}"' if ref else ""}>{key or ""}</dd>' if key is not None or ref else ""
    return (f'<li class="task" data-task="1" data-touches="cli"><h3 class="task-title">Task 1</h3><dl class="task-spec">'
            f'<dt>Files</dt><dd data-part="files"><ul>{fs}</ul></dd><dt>Test first</dt><dd data-part="test">T</dd>'
            f'<dt>Verify</dt><dd data-part="verify"><code>go test</code></dd>{row}</dl></li>')


def sketch(lines, fid="code-a", path="cmd/a.go"):
    body = "\n".join(f"x{k} := {k}" for k in range(lines))
    return f'<figure class="fig codeblock" id="{fid}"><pre class="code-src" data-sketch data-file="{path}"><code>{body}</code></pre></figure>'


def task_codes(tasks, files='<li class="file" data-blk="cli" data-change="new"><code>cmd/a.go</code></li>', extra=""):
    html = plan_html(tasks, files).replace('<section class="doc-page" id="files"', f'<section class="doc-page" id="design" data-title="Design">{extra}</section><section class="doc-page" id="files"')
    return {i.code: i for i in rc.check_static(html) if i.code in PLAN_CODES}


def test_a_task_that_adds_or_changes_a_file_without_a_key_change_warns():
    found = task_codes(code_task())
    assert set(found) == {"plan-task-code"}
    assert found["plan-task-code"].level == "warn" and "task 1" in found["plan-task-code"].message
    assert task_codes(code_task(key=sketch(5))) == {}


def test_a_task_that_only_removes_files_needs_no_key_change():
    assert task_codes(code_task(), files='<li class="file" data-blk="cli" data-change="removed"><code>cmd/a.go</code></li>') == {}


def test_a_key_change_may_point_at_code_on_a_claim():
    assert task_codes(code_task(ref="code-a"), extra=sketch(5)) == {}


@pytest.mark.parametrize("extra", ["", '<figure class="fig" id="code-a"><div class="fig-body">x</div></figure>'])
def test_a_key_change_pointing_at_no_code_block_is_error(extra):
    found = task_codes(code_task(ref="code-a"), extra=extra)
    assert set(found) == {"plan-code-ref"}
    assert found["plan-code-ref"].level == "error" and "code-a" in found["plan-code-ref"].message


def test_a_key_change_past_30_lines_warns():
    assert task_codes(code_task(key=sketch(10), ref="code-b"), extra=sketch(20, "code-b")) == {}
    found = task_codes(code_task(key=sketch(11), ref="code-b"), extra=sketch(20, "code-b"))
    assert set(found) == {"plan-task-code-long"}
    assert "31" in found["plan-task-code-long"].message


@pytest.mark.parametrize("pre,pin", [
    ('<pre class="code-src" data-sketch data-start="30"><code>a\nb</code></pre>', 'data-line="33"'),
    ('<pre class="code-src" data-diff><code>@@ -10,2 +10,2 @@\n a\n-b\n+c</code></pre>', 'data-old="12"'),
])
def test_a_pin_on_a_line_the_block_does_not_show_is_error(pre, pin):
    assert "plan-pin-line" in codes(review_html(f'<figure class="fig codeblock">{pre}<ol class="code-pins"><li {pin}>x</li></ol></figure>'), "error")


def test_a_diff_pin_on_a_shown_old_line_passes():
    pre = '<pre class="code-src" data-diff><code>@@ -10,2 +10,2 @@\n a\n-b\n+c</code></pre>'
    assert review_codes(f'<figure class="fig codeblock">{pre}<ol class="code-pins"><li data-old="11">x</li><li data-line="11">y</li></ol></figure>') == set()


def test_a_call_row_with_an_unknown_mark_is_error():
    assert "plan-calls-mark" in codes(review_html('<figure class="fig calls"><script type="text/plain">\n* a()   @ x.go:1\n</script></figure>'), "error")


def test_a_marked_call_row_without_a_place_warns():
    assert review_codes('<figure class="fig calls"><script type="text/plain">\n+ a()\n</script></figure>') == {"plan-calls-place"}


@pytest.mark.slow
def test_render_catches_errors_and_overflow(tmp_path):
    page = tmp_path / "bad.html"
    page.write_text(GOOD + '<div style="width:2000px;height:10px"></div><script>undefinedFn()</script>')
    report = rc.render(page, out_dir=tmp_path / "shots", widths=(390,), schemes=("light",))
    kinds = {i.code for i in report.issues}
    assert "page-error" in kinds
    assert "h-overflow" in kinds
    assert list((tmp_path / "shots").glob("*.png")), "a screenshot was written"


@pytest.mark.slow
def test_render_warns_when_a_named_font_is_never_loaded(tmp_path):
    page = tmp_path / "font.html"
    page.write_text(GOOD.replace("</style>", "h1 { font-family: 'Albert Sans', system-ui, sans-serif; }</style>"))
    report = rc.render(page, out_dir=tmp_path / "shots", widths=(1440,), schemes=("light",))
    assert any(i.code == "font-fallback" and "Albert Sans" in i.message for i in report.issues)


@pytest.mark.slow
def test_render_accepts_a_loaded_symbol_only_font_face(tmp_path):
    import base64
    woff2 = (HERE.parent / "assets" / "katex" / "fonts" / "KaTeX_Size1-Regular.woff2").read_bytes()
    face = "@font-face{font-family:SymFont;src:url(data:font/woff2;base64," + base64.b64encode(woff2).decode() + ") format('woff2')}"
    page = tmp_path / "sym.html"
    page.write_text(GOOD.replace("</style>", face + " .x{font: normal 1.2em / 1.2 SymFont, serif}</style>") + '<span class="x">(</span>')
    report = rc.render(page, out_dir=tmp_path / "shots", widths=(1440,), schemes=("light",))
    assert [i.message for i in report.issues if i.code == "font-fallback"] == []


@pytest.mark.slow
def test_render_clean_page_passes(tmp_path):
    page = tmp_path / "good.html"
    page.write_text(GOOD)
    report = rc.render(page, out_dir=tmp_path / "shots", widths=(390, 1440), schemes=("light", "dark"))
    assert [i for i in report.issues if i.level == "error"] == []
    assert len(list((tmp_path / "shots").glob("*.png"))) == 8, "a first-screen shot and a full-page shot per run"
