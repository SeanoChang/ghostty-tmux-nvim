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


# ── teaching-quality lints (2026-10-27 round) ────────────────────────────────

def test_plain_pre_outside_a_codeblock_warns():
    html = GOOD + "<pre><code>for {\n  run()\n  wait()\n}</code></pre>"
    assert "code-plain" in codes(html, "warn")


def test_pre_inside_a_codeblock_passes():
    html = GOOD + '<figure class="fig codeblock"><pre class="code-src" data-sketch><code class="language-go">for {\n  run()\n  wait()\n}</code></pre></figure>'
    assert "code-plain" not in codes(html)


def test_a_one_line_pre_is_not_code_to_colour():
    assert "code-plain" not in codes(GOOD + "<pre>pip install x</pre>")


def test_a_prose_only_go_deeper_block_warns():
    words = " ".join(["The client cancels the tool and still appends a result."] * 8)
    html = GOOD + f'<details class="deeper"><summary>Edge cases</summary><div class="deeper-body prose"><p>{words}</p></div></details>'
    assert "deeper-prose" in codes(html, "warn")


@pytest.mark.parametrize("inner", ['<div class="tex display">a^2</div>', "<svg></svg>", '<table class="table"></table>', '<figure class="fig"></figure>'])
def test_a_go_deeper_block_with_math_or_a_figure_passes(inner):
    words = " ".join(["The client cancels the tool and still appends a result."] * 8)
    html = GOOD + f'<details class="deeper"><summary>Edge cases</summary><div class="deeper-body prose"><p>{words}</p>{inner}</div></details>'
    assert "deeper-prose" not in codes(html)


def check_q(answer, opts):
    bs = "".join(f'<button data-choice="{c}">{t}</button>' for c, t in opts)
    return f'<div class="decide" data-answer="{answer}"><p class="decide-q">Q?</p><div class="decide-options">{bs}</div></div>'


def test_a_check_whose_answer_is_the_conspicuously_longest_option_warns():
    q = check_q("b", [("a", "Bigger queue."), ("b", "An idempotency key on the charge, so the payment service returns the first result on retry."), ("c", "More workers.")])
    assert "options-uneven" in codes(GOOD + q, "warn")


def test_a_check_with_balanced_options_passes():
    q = check_q("b", [("a", "A bigger queue, so the job waits longer before it is retried."), ("b", "An idempotency key, so the payment service returns the first result."), ("c", "More workers, so the retry lands on a different machine sooner.")])
    assert "options-uneven" not in codes(GOOD + q)


def test_the_same_answer_position_on_most_checks_warns():
    qs = "".join(check_q("a", [("a", "One option here."), ("b", "Two option here."), ("c", "Six option here.")]) for _ in range(5))
    assert "answer-position" in codes(GOOD + qs, "warn")


def test_varied_answer_positions_pass():
    qs = "".join(check_q(c, [("a", "One option here."), ("b", "Two option here."), ("c", "Six option here.")]) for c in "abcab")
    assert "answer-position" not in codes(GOOD + qs)


def test_a_guide_section_that_is_a_wall_of_text_warns():
    words = " ".join(["Each request resends the whole conversation to the stateless API."] * 30)
    html = GOOD + f"""<div class="docs"><main class="docs-main">
      <section class="doc-page" id="a" data-title="Overview"><figure class="fig"></figure></section>
      <section class="doc-page" id="b" data-title="Step"><div class="prose"><p>{words}</p></div><div class="decide" data-answer="a"></div></section></main></div>"""
    msgs = [i.message for i in rc.check_static(html) if i.code == "no-visual"]
    assert len(msgs) == 1 and "#b" in msgs[0]


def test_a_long_section_with_a_figure_passes():
    words = " ".join(["Each request resends the whole conversation to the stateless API."] * 30)
    html = GOOD + f"""<div class="docs"><main class="docs-main">
      <section class="doc-page" id="a" data-title="Overview"><figure class="fig"></figure></section>
      <section class="doc-page" id="b" data-title="Step"><figure class="fig"><svg></svg></figure><div class="prose"><p>{words}</p></div><div class="decide" data-answer="a"></div></section></main></div>"""
    assert "no-visual" not in codes(html)


def test_options_are_judged_per_question_not_across_the_page():
    fair = check_q("a", [("a", "A bigger queue, so the job waits longer."), ("b", "An idempotency key, so the retry is safe."), ("c", "More workers, so the retry lands sooner.")])
    lopsided = check_q("c", [("a", "Bigger queue."), ("b", "More workers."), ("c", "An idempotency key on the charge, so the payment service returns the first result.")])
    msgs = [i.message for i in rc.check_static(GOOD + fair.replace("Q?", "First?") + lopsided.replace("Q?", "Second?")) if i.code == "options-uneven"]
    assert len(msgs) == 1 and "Second?" in msgs[0]


def test_answer_positions_are_read_per_question():
    qs = "".join(check_q(c, [("a", "One option here."), ("b", "Two option here."), ("c", "Six option here.")]) for c in "cccca")
    assert "answer-position" in codes(GOOD + qs, "warn")


def test_a_lopsided_question_is_caught_even_when_a_later_one_reuses_its_letters():
    lopsided = check_q("c", [("a", "Bigger queue."), ("b", "More workers."), ("c", "An idempotency key on the charge, so the payment service returns the first result.")])
    fair = check_q("a", [("a", "A bigger queue, so the job waits longer."), ("b", "An idempotency key, so the retry is safe."), ("c", "More workers, so it lands sooner.")])
    msgs = [i.message for i in rc.check_static(GOOD + lopsided.replace("Q?", "First?") + fair.replace("Q?", "Second?")) if i.code == "options-uneven"]
    assert len(msgs) == 1 and "First?" in msgs[0]


# ── verifier round (2026-10-27): false alarms, crashes and misses in the teaching lints ──

def test_the_shipped_templates_pass_their_own_teaching_lints():
    for name in ("guide.src.html", "plan.src.html"):
        html = (HERE.parent / "templates" / name).read_text(encoding="utf-8")
        assert "code-plain" not in codes(html), name


def test_a_check_whose_options_share_one_value_does_not_crash():
    q = check_q("a", [("a", "One."), ("a", "Two."), ("a", "Three.")])
    rc.check_static(GOOD + q)


@pytest.mark.parametrize("visual", ['<ol class="derive"><li><div class="tex display">a</div></li></ol>', '<img src="x.png" alt="x">'])
def test_a_long_section_built_on_a_derivation_or_an_image_passes(visual):
    words = " ".join(["Each request resends the whole conversation to the stateless API."] * 30)
    html = GOOD + f"""<div class="docs"><main class="docs-main">
      <section class="doc-page" id="a" data-title="Overview"><figure class="fig"></figure></section>
      <section class="doc-page" id="b" data-title="Step">{visual}<div class="prose"><p>{words}</p></div><div class="decide" data-answer="a"></div></section></main></div>"""
    assert "no-visual" not in codes(html)


def test_a_caption_class_alone_is_not_a_visual():
    words = " ".join(["Each request resends the whole conversation to the stateless API."] * 30)
    html = GOOD + f"""<div class="docs"><main class="docs-main">
      <section class="doc-page" id="a" data-title="Overview"><figure class="fig"></figure></section>
      <section class="doc-page" id="b" data-title="Step"><p class="fig-note">see above</p><div class="prose"><p>{words}</p></div><div class="decide" data-answer="a"></div></section></main></div>"""
    assert "no-visual" in codes(html, "warn")


def test_a_go_deeper_block_with_a_nested_details_before_its_figure_passes():
    words = " ".join(["The client cancels the tool and still appends a result."] * 8)
    html = GOOD + f'<details class="deeper"><summary>Edge</summary><div class="deeper-body"><p>{words}</p><details><summary>a</summary>b</details><svg></svg></div></details>'
    assert "deeper-prose" not in codes(html)


def test_single_quoted_classes_are_linted_too():
    words = " ".join(["The client cancels the tool and still appends a result."] * 8)
    html = GOOD + f"<details class='deeper'><summary>Edge</summary><p>{words}</p></details>"
    assert "deeper-prose" in codes(html, "warn")
    q = check_q("b", [("a", "Bigger queue."), ("b", "An idempotency key on the charge, so the payment service returns the first result on retry."), ("c", "More workers.")])
    assert "options-uneven" in codes(GOOD + q.replace('class="decide"', "class='decide'"), "warn")


def test_a_check_on_a_section_element_is_judged_on_its_own():
    lopsided = check_q("c", [("a", "Bigger queue."), ("b", "More workers."), ("c", "An idempotency key on the charge, so the payment service returns the first result.")])
    lopsided = lopsided.replace("<div class=\"decide\"", "<section class=\"decide\"").replace("</div></div>", "</div></section>")
    fair = check_q("a", [("a", "A bigger queue, so the job waits longer."), ("b", "An idempotency key, so the retry is safe."), ("c", "More workers, so it lands sooner.")])
    msgs = [i.message for i in rc.check_static(GOOD + fair.replace("Q?", "First?") + lopsided.replace("Q?", "Second?")) if i.code == "options-uneven"]
    assert len(msgs) == 1 and "Second?" in msgs[0]


def test_two_option_checks_count_toward_answer_position():
    qs = "".join(check_q("a", [("a", "Yes, it holds."), ("b", "No, it fails.")]) for _ in range(5))
    assert "answer-position" in codes(GOOD + qs, "warn")


@pytest.mark.parametrize("name", ["guide.src.html", "plan.src.html"])
def test_the_assembled_templates_have_no_static_errors(name):
    spec = importlib.util.spec_from_file_location("assemble", HERE.parent / "scripts" / "assemble.py")
    asm = importlib.util.module_from_spec(spec); spec.loader.exec_module(asm)
    html = asm.assemble((HERE.parent / "templates" / name).read_text(encoding="utf-8"))
    assert [f"{i.code}: {i.message}" for i in rc.check_static(html) if i.level == "error"] == []


def test_dead_api_ignores_the_word_inside_a_string():
    html = GOOD + "<script>chart({ y: { label: 'TTFT of the 8k prompt (s)' }, note: \"say alert (now)\" });</script>"
    assert "dead-api" not in codes(html)


def test_dead_api_still_catches_a_real_call():
    assert "dead-api" in codes(GOOD + "<script>const name = prompt('Your name?');</script>", "error")


def test_an_open_questions_section_is_not_asked_for_a_figure():
    words = " ".join(["Explain how the scheduler protects decode latency under load."] * 30)
    html = GOOD + f"""<div class="docs"><main class="docs-main">
      <section class="doc-page" id="a" data-title="Overview"><figure class="fig"></figure></section>
      <section class="doc-page" id="t" data-title="Test yourself"><div class="openq"><p class="decide-q">{words}</p><textarea id="x"></textarea></div><div class="decide" data-answer="a"></div></section></main></div>"""
    assert "no-visual" not in codes(html)


# ── verifier round 2 (2026-10-27) ──

@pytest.mark.parametrize("js", [
    "el.innerHTML = `<p>Don't</p>`; if (!ok) alert('x'); const t = 'y';",
    "s.replace(/\"/g, ''); prompt('x'); s.replace(/\"/g, '');",
    "const a = `${alert('x')}`;",
    "// don't\nalert(1);",
    "const r = /'/; confirm('sure?'); const q = 'z';",
])
def test_dead_api_sees_calls_past_template_literals_regexes_and_comments(js):
    assert "dead-api" in codes(GOOD + f"<script>{js}</script>", "error")


@pytest.mark.parametrize("js", ["const s = `say alert(now)`;", "const r = /prompt\\(/;", "// call prompt() later\nconst x = 1;", "const d = a / b; const s = 'alert (soon)';"])
def test_dead_api_ignores_calls_written_inside_text(js):
    assert "dead-api" not in codes(GOOD + f"<script>{js}</script>")


def test_a_plan_task_with_single_quoted_rows_is_complete():
    html = GOOD + """<div data-plan><div class='blk' data-blk='gw'></div><ol><li class='task' data-task='1' data-touches='gw'>
      <dl class='task-spec'><dt>Test</dt><dd data-part='test'>t</dd><dt>Verify</dt><dd data-part='verify'>v</dd></dl></li></ol></div>"""
    assert "plan-task-incomplete" not in codes(html)


def test_dead_api_matches_a_reference_on_random_scripts():
    """Scripts built from parts whose truth is known: the lint must flag exactly those holding a real call."""
    import random
    rng = random.Random(20261027)
    decoy = ["alert(", "prompt (s)", "confirm(x)", "don't", 'say "hi"', "a/b", "}", "{", "`", "\\'"]
    def lit():
        t = rng.choice(decoy) + rng.choice(decoy)
        kind = rng.randrange(5)
        if kind == 0: return "'" + t.replace("\\", "\\\\").replace("'", "\\'").replace("\n", "") + "'"
        if kind == 1: return '"' + t.replace("\\", "\\\\").replace('"', '\\"') + '"'
        if kind == 2: return "`" + t.replace("\\", "\\\\").replace("`", "\\`").replace("${", "$ {") + "`"
        if kind == 3: return "/" + t.replace("\\", "\\\\").replace("/", "\\/").replace("[", "\\[").replace("]", "\\]").replace("\n", "") + "/g"
        return "/* " + t.replace("*/", "* /") + " */ 0"
    for _ in range(400):
        parts, real = [], False
        for _ in range(rng.randrange(1, 7)):
            r = rng.random()
            if r < 0.12:
                parts.append(f"{rng.choice(['alert', 'prompt', 'confirm'])}('q');"); real = True
            elif r < 0.2:
                inner = rng.choice(["alert('q')", "x + 1"]); real |= inner.startswith("alert")
                parts.append(f"const t = `{rng.choice(decoy).replace('`', '').replace(chr(92), '')}${{{inner}}}{rng.choice(decoy).replace('`', '').replace(chr(92), '')}`;")
            elif r < 0.3:
                parts.append(rng.choice(["const d = w / h / 2;", "x = a++ / 2;", "y = b-- / 3;", "function f(){ return /'\\x60/.test(s) }",
                                         "const k = typeof /\"/;", "const t = `${/'/.test(s)}`;", "if (a in /'/) {}"]))
            elif r < 0.4:
                parts.append("// " + rng.choice(decoy).replace("\n", "") + "\n")
            else:
                parts.append(f"const v = {lit()};")
        js = rng.choice([" ", "\n"]).join(parts)
        got = "dead-api" in codes(GOOD + f"<script>{js}</script>", "error")
        assert got == real, js


# ── verifier round 3 (2026-10-27): per-script scan, better regex guesses, no silent pass ──

def test_a_call_tree_with_a_glob_does_not_hide_a_later_call():
    html = GOOD + '<script type="text/plain">~ route()   @ handlers/*.go</script><script>alert(1)</script>'
    assert "dead-api" in codes(html, "error")


def test_a_markdown_script_with_a_lone_backtick_does_not_hide_a_later_call():
    assert "dead-api" in codes(GOOD + '<script type="text/markdown">Use the `x key</script><script>alert(1)</script>', "error")


def test_non_js_scripts_are_not_linted_as_code():
    assert "dead-api" not in codes(GOOD + '<script type="text/plain">ask prompt(msg) → answer</script>')


@pytest.mark.parametrize("js", [
    "function f(){ return /'/.test(s) } alert(1); const q='z';",
    "return/'/;alert(1);'q'",
    "x = a++ / 2; alert(1); y = b / 3;",
    "const t = `${/'/.test(s)}`; alert(1); 'q'",
])
def test_regex_and_division_guesses_that_used_to_hide_a_call(js):
    assert "dead-api" in codes(GOOD + f"<script>{js}</script>", "error")


def test_a_keyword_regex_holding_call_text_is_not_an_error():
    assert "dead-api" not in codes(GOOD + "<script>function f(){ return /alert(/.test(s) }</script>", "error")


def test_call_text_the_scanner_blanked_still_warns():
    # an object literal divided is read as a regex; the check must say something rather than pass silently
    html = GOOD + "<script>const v = {a:1} / 2; alert(1); const w = 3 / 4;</script>"
    assert "dead-api" in codes(html, "error") or "dead-api-text" in codes(html, "warn")


def test_prose_in_a_label_does_not_raise_the_text_warning():
    assert "dead-api-text" not in codes(GOOD + "<script>chart({ y: { label: 'TTFT of the 8k prompt (s)' } });</script>")


# ── formats: the request picks quick, guide or learn; the page must keep to it ──────────────────────

def fmt(name, body="", size=None):
    extra = f'<meta name="va:size" content="{size}">' if size else ""
    return GOOD + f'<meta name="va:format" content="{name}">{extra}' + body


QUESTION = '<div class="decide" data-answer="a"><p class="decide-q">Which?</p><button data-choice="a">A</button></div>'
FRAMES = '<figure class="fig"><div class="stepper-ctl"><button data-next></button></div>{}</figure>'
MATH = '<span class="tex">x = 1</span>'


@pytest.mark.parametrize("name", ["guide", "quick"])
@pytest.mark.parametrize("body", [
    QUESTION,
    '<div class="decide" data-gate></div>',
    '<div class="after-decide">x</div>',
    '<details class="check"><summary>Q</summary>x</details>',
    '<div class="openq"></div>',
    '<script>Kit.openQuestions(document.body)</script>',
    '<p>Try first: pick two edges.</p>',
    '<h2>Test yourself</h2>',
    '<p>Quick check: what is BC.</p>',
])
def test_guide_and_quick_refuse_every_kind_of_question(name, body):
    assert "format-question" in codes(fmt(name, body), "error")


def test_learn_keeps_its_questions():
    html = fmt("learn", QUESTION + '<div class="openq"></div><p>Try first: pick two edges.</p>')
    assert "format-question" not in codes(html)


def test_a_rhetorical_question_in_guide_prose_warns_and_a_correct_guide_does_not():
    assert "format-rhetorical" in codes(fmt("guide", '<div class="prose"><p>Why does this work?</p></div>'), "warn")
    assert "format-rhetorical" not in codes(fmt("guide", '<div class="prose"><p>This works because rows add.</p></div>'))


def test_words_inside_comments_are_not_questions():
    assert "format-question" not in codes(fmt("guide", "<!-- plan: no test yourself here -->"))


@pytest.mark.parametrize("name", ["guide", "quick", "learn", None])
@pytest.mark.parametrize("body", [
    '<div class="seg sm" id="depth"><button data-value="skim">Skim</button></div>',
    "<script>Kit.depth(Kit.$('#x'))</script>",
])
def test_depth_tabs_are_an_error_in_every_format(name, body):
    html = fmt(name, body) if name else GOOD + body
    assert "depth-tabs" in codes(html, "error")


@pytest.mark.parametrize("name", ["guide", "quick"])
def test_guide_and_quick_refuse_collapsed_content(name):
    assert "format-collapsed" in codes(fmt(name, "<details><summary>More</summary>x</details>"), "error")


def test_framed_math_is_an_error_in_a_guide_and_a_warning_in_learn():
    framed = FRAMES.format(MATH)
    assert "math-framed" in codes(fmt("guide", framed), "error")
    assert "math-framed" in codes(fmt("learn", framed), "warn")
    assert "math-framed" not in codes(fmt("guide", FRAMES.format("<svg></svg>")))


def test_a_collapsed_derivation_warns_in_learn():
    html = fmt("learn", f'<details class="deeper"><summary>Proof</summary><ol class="derive"><li>{MATH}</li></ol></details>')
    assert "math-collapsed" in codes(html, "warn")


def test_any_stepper_or_scenario_player_in_a_guide_is_an_error():
    assert "format-stepper" in codes(fmt("guide", FRAMES.format("<svg></svg>")), "error")
    assert "format-stepper" in codes(fmt("guide", '<div class="fig"><button data-play></button></div>'), "error")
    assert "format-stepper" in codes(fmt("guide", "<script>Kit.stepper(x)</script>"), "error")
    assert "format-stepper" in codes(fmt("guide", "<script>Kit.scenarios(x, {})</script>"), "error")


def test_guide_skips_the_check_question_lint_but_learn_and_unmarked_pages_keep_it():
    sections = """<div class="docs"><main class="docs-main">
      <section class="doc-page" id="a" data-title="One"><h1>A</h1></section>
      <section class="doc-page" id="b" data-title="Two"><h1>B</h1><p>text</p></section></main></div>"""
    assert "no-check" not in codes(fmt("guide", sections))
    assert "no-check" in codes(fmt("learn", sections), "warn")
    assert "no-check" in codes(GOOD + sections, "warn")


def test_a_page_with_no_format_warns_but_a_plan_does_not():
    assert "no-format" in codes(GOOD, "warn")
    assert "no-format" not in codes(GOOD + '<div data-plan></div>')
    assert "no-format" not in codes(fmt("guide"))


def test_an_unknown_format_is_an_error():
    assert "format-unknown" in codes(fmt("skim"), "error")


def test_code_without_its_state_warns_in_a_guide():
    code = '<figure class="fig codeblock"><pre class="code-src"><code>x</code></pre></figure>'
    assert "code-no-state" in codes(fmt("guide", code), "warn")
    assert "code-no-state" not in codes(fmt("guide", code + '<div class="trace"></div>'))
    assert "code-no-state" not in codes(fmt("learn", code))


@pytest.mark.parametrize("size,words,bad", [("concept", 150, False), ("concept", 151, True), ("landscape", 400, False), ("landscape", 401, True), (None, 151, True)])
def test_quick_word_limit_follows_its_size(size, words, bad):
    body = "<p>" + " ".join(["word"] * (words - 1)) + "</p>"  # GOOD already holds one word, "Hello"
    assert ("quick-long" in codes(fmt("quick", body, size), "error")) is bad


def test_an_unknown_quick_size_is_an_error():
    assert "format-unknown" in codes(fmt("quick", "", "huge"), "error")


@pytest.mark.parametrize("name", ["guide.src.html", "learn.src.html", "quick.src.html"])
def test_the_format_templates_declare_a_format_and_have_no_depth_tabs(name):
    html = (HERE.parent / "templates" / name).read_text(encoding="utf-8")
    assert f'content="{name.split(".")[0]}"' in html
    found = codes(html)
    assert "no-format" not in found and "depth-tabs" not in found


@pytest.mark.parametrize("name", ["learn.src.html", "quick.src.html"])
def test_the_new_templates_have_no_static_errors(name):
    spec = importlib.util.spec_from_file_location("assemble", HERE.parent / "scripts" / "assemble.py")
    asm = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(asm)
    html = asm.assemble((HERE.parent / "templates" / name).read_text(encoding="utf-8"))
    assert [i for i in rc.check_static(html) if i.level == "error"] == []


@pytest.mark.slow
@pytest.mark.parametrize("size,height,bad", [("concept", 500, False), ("concept", 1200, True), ("landscape", 2000, False), ("landscape", 3000, True)])
def test_render_enforces_the_quick_height_limit(tmp_path, size, height, bad):
    page = tmp_path / "q.html"
    page.write_text(fmt("quick", f'<div style="height:{height}px"></div>', size), encoding="utf-8")
    report = rc.render(page, out_dir=tmp_path / "o", widths=(1280,), schemes=("light",), wait_ms=50)
    assert any(i.code == "quick-tall" for i in report.issues) is bad


@pytest.mark.slow
def test_render_reports_math_that_failed_to_render(tmp_path):
    page = tmp_path / "m.html"
    page.write_text(fmt("guide", '<span class="tex tex-fallback">x = 1</span>'), encoding="utf-8")
    report = rc.render(page, out_dir=tmp_path / "o", widths=(1280,), schemes=("light",), wait_ms=50)
    assert any(i.code == "math-unrendered" and i.level == "error" for i in report.issues)


# ── verifier round 1 (2026-11-03): crashes, gaps and false errors in the format lints ─────────────────

@pytest.mark.parametrize("meta", ['<meta content="guide" name="va:format">', "<meta name=va:format content=guide>"])
def test_the_format_meta_is_read_in_any_attribute_order_or_quoting(meta):
    assert "format-collapsed" in codes(GOOD + meta + "<details><summary>x</summary></details>", "error")


@pytest.mark.parametrize("name", ["explorable", "prototype"])
def test_explorable_and_prototype_declare_a_format_and_skip_the_format_rules(name):
    found = codes(fmt(name, "<details><summary>x</summary></details>" + QUESTION))
    assert not found & {"no-format", "format-unknown", "format-question", "format-collapsed"}


@pytest.mark.parametrize("body", ["<p>Pause and think about it.</p>", "<h2>Drills</h2>"])
def test_unmistakable_drill_labels_are_refused_in_a_guide(body):
    assert "format-question" in codes(fmt("guide", body), "error")


@pytest.mark.parametrize("body", ["<p>Predict the output of this loop.</p>", "<h1>Exercise 3</h1>", "<li>Predict the next token.</li>", "<p>Before you read on, compute it.</p>", "<p>Now try this yourself: compute det A.</p>", "<p><strong>Exercise:</strong> compute det A.</p>"])
def test_wording_that_may_be_a_drill_warns_and_does_not_block(body):
    html = fmt("guide", body)
    assert "format-prompt" in codes(html, "warn")
    assert "format-question" not in codes(html)


@pytest.mark.parametrize("body", ["<td>Predict</td>", "<td>Drill</td>", "<svg><text>Predict</text></svg>"])
def test_a_table_word_is_not_a_drill(body):
    assert not codes(fmt("guide", body)) & {"format-question", "format-prompt"}


@pytest.mark.parametrize("body", ["<p>Wait before your call finishes.</p>", "<p>A quick check of the units shows metres.</p>", "<p>Predictors use the history.</p>"])
def test_ordinary_statements_are_not_taken_for_drills(body):
    assert "format-question" not in codes(fmt("guide", body))


@pytest.mark.parametrize("body", ["<h2>Why does this work?</h2>", "<li>Which one?</li>", "<td>Why?</td>", "<p>為什麼？</p>", '<p>"Why?" is common.</p>'])
def test_a_question_in_any_reader_text_warns(body):
    assert "format-rhetorical" in codes(fmt("guide", body), "warn")


def test_a_question_mark_in_code_or_math_is_not_a_question():
    assert "format-rhetorical" not in codes(fmt("guide", '<p>Use <code>x ? y : z</code> and <span class="tex">a ? b</span>.</p>'))


def test_an_ordinary_depth_id_is_fine_and_relabelled_tabs_are_not():
    assert "depth-tabs" not in codes(fmt("guide", '<td id="depth">3</td>'))
    tabs = '<div class="seg"><button data-value="a">Skim</button><button data-value="b">Read</button><button data-value="c">Deep</button></div>'
    assert "depth-tabs" in codes(fmt("guide", tabs), "error")


def test_math_in_a_div_figure_with_single_quotes_is_still_framed():
    html = fmt("guide", "<div class='fig'><button data-next></button><span class='tex'>x</span></div>")
    assert "math-framed" in codes(html, "error")


def test_quick_counts_cjk_text_as_words():
    assert "quick-long" in codes(fmt("quick", "<p>" + "字" * 3200 + "</p>"), "error")


def rendered(tmp_path, html, widths=(1280,)):
    page = tmp_path / "p.html"
    page.write_text(html, encoding="utf-8")
    return {i.code for i in rc.render(page, out_dir=tmp_path / "o", widths=widths, schemes=("light",), wait_ms=50).issues}


@pytest.mark.slow
@pytest.mark.parametrize("name", ["guide.src.html", "learn.src.html", "quick.src.html", "plan.src.html"])
def test_each_format_template_passes_the_browser_check_at_every_laptop_width(tmp_path, name):
    spec = importlib.util.spec_from_file_location("assemble", HERE.parent / "scripts" / "assemble.py")
    asm = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(asm)
    html = asm.assemble((HERE.parent / "templates" / name).read_text(encoding="utf-8"))
    page = tmp_path / "t.html"
    page.write_text(html, encoding="utf-8")
    report = rc.render(page, out_dir=tmp_path / "o", widths=(390, 1000, 1280, 1440), schemes=("light",), wait_ms=50)
    assert [str(i) for i in report.issues if i.level == "error"] == []


def test_the_default_widths_include_a_small_laptop():
    assert 1000 in rc.render.__defaults__[1]


@pytest.mark.slow
@pytest.mark.parametrize("name", ["guide", "quick"])
@pytest.mark.parametrize("script,code", [
    ("document.body.insertAdjacentHTML('beforeend','<details><summary>x</summary>y</details>')", "format-collapsed"),
    ("document.body.insertAdjacentHTML('beforeend','<div class=decide></div>')", "format-question"),
])
def test_content_built_by_script_is_checked_after_render(tmp_path, name, script, code):
    assert code in rendered(tmp_path, fmt(name, f"<script>{script}</script>"))


@pytest.mark.slow
@pytest.mark.parametrize("body", ['<div hidden>secret text</div>', '<div style="display:none">secret text</div>', "<dialog>secret text</dialog>"])
def test_hidden_text_in_a_guide_or_quick_page_is_an_error(tmp_path, body):
    assert "format-hidden" in rendered(tmp_path, fmt("guide", body))
    assert "format-hidden" in rendered(tmp_path, fmt("quick", body))


@pytest.mark.slow
def test_hidden_navigation_and_a_learn_page_are_not_flagged(tmp_path):
    assert "format-hidden" not in rendered(tmp_path, fmt("guide", '<nav hidden>menu</nav><aside class="docs-rail" style="display:none">rail</aside>'))
    assert "format-hidden" not in rendered(tmp_path, fmt("learn", "<div hidden>answer</div>"))


@pytest.mark.slow
def test_an_inner_scroller_cannot_hide_a_quick_page_from_the_height_limit(tmp_path):
    body = '<main style="max-height:500px;overflow:auto"><div style="height:3400px"></div></main>'
    assert "quick-tall" in rendered(tmp_path, fmt("quick", body))


# ── verifier round 2 (2026-11-03): structure is an error, a wording guess is a warning ──────────────

@pytest.mark.parametrize("body", ['<td>Skim</td>', '<p>Skim the table.</p>'])
def test_the_word_skim_in_content_is_not_a_depth_control(body):
    assert "depth-tabs" not in codes(fmt("guide", body))


@pytest.mark.parametrize("body", ['<a data-next-id="q2">x</a>', '<a data-play-speed="2">x</a>', "<p><code>data-play</code> and stepper-ctl are names.</p>"])
def test_only_a_real_control_counts_as_a_frame(body):
    assert "format-stepper" not in codes(fmt("guide", body))


def test_a_commented_out_format_is_ignored():
    html = GOOD + '<!-- <meta name="va:format" content="learn"> --><meta name="va:format" content="guide"><details><summary>x</summary></details>'
    assert "format-collapsed" in codes(html, "error")


@pytest.mark.slow
@pytest.mark.parametrize("style", ["max-height:0;overflow:hidden", "visibility:hidden", "opacity:0", "content-visibility:hidden"])
def test_every_way_of_collapsing_text_is_caught(tmp_path, style):
    assert "format-hidden" in rendered(tmp_path, fmt("guide", f'<div style="{style}">secret text</div>'))


@pytest.mark.slow
def test_normal_hidden_parts_are_not_flagged(tmp_path):
    body = '<button style="display:none">Menu</button><datalist id="d"><option>one</option></datalist><ruby>漢<rp>(</rp><rt>kan</rt><rp>)</rp></ruby>'
    assert "format-hidden" not in rendered(tmp_path, fmt("guide", body))


@pytest.mark.slow
def test_a_clipped_quick_page_is_too_tall(tmp_path):
    assert "quick-tall" in rendered(tmp_path, fmt("quick", '<main style="max-height:500px;overflow:hidden"><div style="height:3400px"></div></main>'))


@pytest.mark.slow
def test_rendered_math_does_not_inflate_the_quick_word_count(tmp_path):
    formulas = '<span class="katex"><span class="katex-mathml">' + "a b c d e " * 40 + "</span></span>"
    assert "quick-long" not in rendered(tmp_path, fmt("quick", "<p>Short.</p>" + formulas))


@pytest.mark.parametrize("body", ["<p>Your call returns at once, because the queue takes the job.</p>", "<p>With <code>await</code> your call returns later.</p>", "<p>Quick check of the units: L is a plain count.</p>", "<p>Practice problems are in chapter 3 of the text.</p>"])
def test_statements_that_open_like_a_label_do_not_block(body):
    assert "format-question" not in codes(fmt("guide", body))


def test_latex_source_does_not_count_toward_the_quick_word_limit():
    body = "<p>" + " ".join(["word"] * 140) + '</p><span class="tex display">' + " & ".join(["a"] * 60) + "</span>"
    assert "quick-long" not in codes(fmt("quick", body))


def test_an_explorable_with_reading_sections_warns():
    pages = '<div class="docs">' + "".join(f'<section class="doc-page" id="s{i}" data-title="S{i}"></section>' for i in range(3)) + "</div>"
    assert "format-mismatch" in codes(fmt("explorable", pages), "warn")


def test_no_position_lint_remains_now_the_strip_is_gone():
    assert "no-position" not in codes(fmt("guide", "<h2>A</h2><h2>B</h2><h2>C</h2>"))


def test_a_first_section_that_opens_with_a_trace_needs_no_separate_map():
    html = fmt("guide", '<div class="docs"><section class="doc-page" id="a" data-title="A"><div class="trace"></div></section></div>')
    assert "no-map" not in codes(html)


def test_a_trace_built_by_the_kit_is_not_a_forbidden_stepper():
    assert "format-stepper" not in codes(fmt("guide", "<script>Kit.trace(x, {})</script>"))


@pytest.mark.slow
def test_a_clipped_formula_warns_on_a_laptop(tmp_path):
    wide = '<div class="latex"><span class="tex display" style="display:block;overflow-x:auto;width:200px"><span style="display:inline-block;width:900px">x</span></span></div>'
    assert "math-clipped" in rendered(tmp_path, fmt("guide", wide))


@pytest.mark.slow
def test_render_reports_a_trace_whose_state_is_not_beside_its_code(tmp_path):
    body = '<div class="trace"><div class="trace-split" style="display:block"><figure class="trace-code">x</figure><div class="trace-state">y</div></div></div>'
    assert "trace-layout" in rendered(tmp_path, fmt("guide", body))


# a grid or flex row makes every loose text run and every inline tag its own cell, so the sentence splits
GRID_ROW = '<ol><li style="display:grid;grid-template-columns:22px 1fr">{}</li></ol>'


@pytest.mark.slow
@pytest.mark.parametrize("row", [
    GRID_ROW.format("A person runs <code>sm team</code> to list teams."),
    GRID_ROW.format("A person runs <code>sm team</code>"),
    GRID_ROW.format("<a href='#x'>Open</a> the plan"),
    '<p style="display:flex;gap:10px"><span class="claim-num">1</span> A key gets the budget <em>its</em> route sets.</p>',
    '<div style="display:inline-flex">Run <kbd>q</kbd> to quit</div>',
])
def test_render_reports_a_sentence_split_by_a_grid_or_flex_row(tmp_path, row):
    assert "split-text" in rendered(tmp_path, fmt("guide", row))


@pytest.mark.slow
@pytest.mark.parametrize("row", [
    GRID_ROW.format("<span>A person runs <code>sm team</code> to list teams.</span>"),
    '<button style="display:flex;gap:6px"><svg width="12" height="12"></svg>Copy</button>',
    '<p style="display:flex;gap:10px"><span class="claim-num">1</span> <span>A key gets the budget <em>its</em> route sets.</span></p>',
    '<span style="display:inline-flex;gap:6px"><b class="call-mark">+</b> new</span>',
    '<p style="display:block">A person runs <code>sm team</code> to list teams.</p>',
    '<pre style="display:grid">x = <code>1</code> + 2</pre>',
    # the CSS gives the note a row of its own on purpose (.ask > label > small)
    '<label style="display:flex;flex-wrap:wrap"><input type="radio"> Answer 503 <small style="order:2;flex-basis:100%">upstream stays safe</small></label>',
    GRID_ROW.format("Answer 503 <small style='grid-column:1/-1'>upstream stays safe</small>"),
])
def test_render_leaves_whole_sentences_and_icon_labels_alone(tmp_path, row):
    assert "split-text" not in rendered(tmp_path, fmt("guide", row))


@pytest.mark.slow
def test_a_page_with_no_math_never_asks_for_the_latex_face(tmp_path):
    css = (HERE.parent / "assets" / "claude.css").read_text(encoding="utf-8")
    page = tmp_path / "n.html"
    page.write_text(fmt("guide", f"<style>{css}</style><p>No math here.</p>"), encoding="utf-8")
    report = rc.render(page, out_dir=tmp_path / "o", widths=(1280,), schemes=("light",), wait_ms=50)
    assert not [i for i in report.issues if i.code == "font-fallback" and "KaTeX" in i.message]


# ── the lints follow what the docs teach ────

DISPLAY = '<div class="tex display">\\begin{bmatrix}' + " & ".join(["1"] * 200) + '\\end{bmatrix}</div>'


def test_math_in_a_display_div_does_not_count_as_quick_words():
    assert "quick-long" not in codes(fmt("quick", DISPLAY + DISPLAY), "error")


def test_a_question_mark_inside_display_math_is_not_a_rhetorical_question():
    assert "format-rhetorical" not in codes(fmt("guide", '<div class="tex display">x ? y </div>'), "warn")


def test_learn_warns_about_a_latex_block_in_a_collapsed_block():
    html = fmt("learn", '<details class="deeper"><summary>Proof</summary><div class="latex"><p>x</p></div></details>')
    assert "math-collapsed" in codes(html, "warn")


@pytest.mark.parametrize("name", ["guide", "quick"])
def test_guide_and_quick_refuse_the_numbered_derivation_list(name):
    assert "math-not-latex" in codes(fmt(name, '<ol class="derive"><li>x</li></ol>'), "error")


@pytest.mark.parametrize("body", [
    '<div class="seg"><button data-value="read">Read</button><button data-value="deep">Deep</button></div>',
    "<button><span>Skim</span></button>",
])
def test_depth_tabs_are_found_in_their_other_spellings(body):
    assert "depth-tabs" in codes(fmt("learn", body), "error")


def test_a_single_deep_value_is_not_a_depth_control():
    assert "depth-tabs" not in codes(fmt("learn", '<div class="seg"><button data-value="deep">Deep water</button><button data-value="shallow">Shallow</button></div>'), "error")


@pytest.mark.slow
def test_render_warns_when_a_guide_writes_many_equations_outside_latex(tmp_path):
    eq = '<span class="tex display">x = 1</span>'
    assert "math-not-latex" in rendered(tmp_path, fmt("guide", eq * 3))
    assert "math-not-latex" not in rendered(tmp_path, fmt("guide", eq))
    assert "math-not-latex" not in rendered(tmp_path, fmt("guide", f'<div class="latex">{eq * 3}</div>'))


@pytest.mark.parametrize("first", ['<div class="table-wrap"><table class="table"><tr><td>1</td></tr></table></div>', '<div class="latex"><p>x</p></div>'])
def test_no_map_accepts_what_its_message_offers(first):
    html = fmt("guide", f'<div class="docs"><section class="doc-page" id="a" data-title="A">{first}</section></div>')
    assert "no-map" not in codes(html, "warn")


def test_read_and_deep_in_separate_controls_are_not_depth_tabs():
    body = '<div class="seg"><button data-value="read">Read</button><button data-value="write">Write</button></div><div class="seg"><button data-value="shallow">Shallow</button><button data-value="deep">Deep</button></div>'
    assert "depth-tabs" not in codes(fmt("explorable", body), "error")


def test_code_no_state_is_not_offered_to_a_quick_page():
    code = '<figure class="fig codeblock"><pre class="code-src"><code>x = 1</code></pre></figure>'
    assert "code-no-state" not in codes(fmt("quick", code), "warn")
    assert "code-no-state" in codes(fmt("guide", code), "warn")


def test_learn_warns_about_an_open_derive_list():
    assert "math-not-latex" in codes(fmt("learn", '<ol class="derive"><li>x</li></ol>'), "warn")


@pytest.mark.slow
def test_formulas_in_figures_are_not_a_derivation(tmp_path):
    eq = '<figure class="fig"><span class="tex display">x = 1</span></figure>'
    assert "math-not-latex" not in rendered(tmp_path, fmt("guide", eq * 3))


MAT = '<span class="tex display">\\begin{vmatrix}1 & 2\\\\3 & 4\\end{vmatrix}</span>'


def test_a_matrix_redrawn_for_each_operation_gets_a_warning():
    three = fmt("guide", f'<div class="latex"><p>a</p>{MAT}<p>b</p>{MAT}<p>c</p>{MAT}</div>')
    assert "math-redraw" in codes(three, "warn")


def test_matrices_at_checkpoints_do_not_get_the_redraw_warning():
    row_op = '<span class="tex display">R_2 + 3R_1 = (0, 1)</span>'
    apart = fmt("guide", f'<div class="latex"><p>a</p>{MAT}<p>b</p>{MAT}<p>c</p>{row_op}<p>d</p>{MAT}</div>')
    assert "math-redraw" not in codes(apart, "warn")
    outside = fmt("guide", f'<div class="latex">{MAT}{MAT}</div><div class="latex">{MAT}</div>')
    assert "math-redraw" not in codes(outside, "warn")


def test_different_matrices_in_a_row_are_not_a_redraw():
    small = '<span class="tex display">C_{11} = \\begin{vmatrix}4 & 0\\\\0 & 5\\end{vmatrix}</span>'
    pair = '<span class="tex display">C = \\begin{pmatrix}1 & 2 & 3\\\\4 & 5 & 6\\\\7 & 8 & 9\\end{pmatrix}, C^T = \\begin{pmatrix}1 & 4 & 7\\\\2 & 5 & 8\\\\3 & 6 & 9\\end{pmatrix}</span>'
    big = '<span class="tex display">\\begin{pmatrix}1 & 2 & 3\\\\4 & 5 & 6\\\\7 & 8 & 9\\end{pmatrix}</span>'
    assert "math-redraw" not in codes(fmt("guide", f'<div class="latex">{small}{pair}{big}</div>'), "warn")
    assert "math-redraw" not in codes(fmt("guide", f'<div class="latex">{small}{big}{small}</div>'), "warn")


def _mats(*rows_list, kind="vmatrix"):
    return "".join(f'<span class="tex display">\\begin{{{kind}}}{rows}\\end{{{kind}}}</span>' for rows in rows_list)


@pytest.mark.parametrize("body", [
    _mats("a & 1\\\\b & 2", "a & 1\\\\c & 3", "e & 9\\\\c & 3"),
    _mats("1 & 2 & 3\\\\4 & 5 & 6", "1 & 2 & 3\\\\0 & 5 & 6", "1 & 2 & 3\\\\0 & 1 & 6", kind="bmatrix"),
    "".join(f'<span class="tex display">\\begin{{bmatrix}}x\\\\y\\end{{bmatrix}}\\to\\begin{{bmatrix}}1 & 2\\\\{i} & {i}\\end{{bmatrix}}</span>' for i in range(4)),
    "".join(f'<span class="tex display">\\begin{{array}}{{cc|c}}1 & 2 & 3\\\\{i} & {i} & {i}\\end{{array}}</span>' for i in range(4)),
])
def test_row_by_row_forms_get_the_redraw_warning(body):
    assert "math-redraw" in codes(fmt("guide", f'<div class="latex">{body}</div>'), "warn")


@pytest.mark.parametrize("body", [
    _mats("1 & 2\\\\3 & 4", "5 & 2\\\\6 & 4", "1 & 5\\\\3 & 6"),  # Cramer's A_x, A_y and another: no row in common
    _mats("a & b\\\\c & d", "e & f\\\\g & h", "i & j\\\\k & l"),
    _mats("1\\\\0\\\\0", "0\\\\1\\\\0", "0\\\\0\\\\1", kind="pmatrix"),  # separate vectors share entries by chance
])
def test_different_matrices_of_one_size_are_not_a_redraw(body):
    assert "math-redraw" not in codes(fmt("guide", f'<div class="latex">{body}</div>'), "warn")


@pytest.mark.slow
def test_a_formula_cut_off_at_the_top_of_its_box_is_reported(tmp_path):
    body = '<div class="latex"><div class="answer" id="a">x</div></div><style>.clipme{display:block;overflow:hidden;height:10px}</style><script>document.getElementById("a").innerHTML=\'<span class="tex display" style="height:10px;overflow:hidden;display:block" data-t><span style="display:block;height:40px">x</span></span>\';</script>'
    assert "math-clipped" in rendered(tmp_path, fmt("guide", body))


@pytest.mark.slow
def test_an_answer_box_that_hides_its_result_on_a_phone_is_reported(tmp_path):
    body = '<div class="latex"><div class="answer" id="a">x</div></div><script>document.getElementById("a").innerHTML=\'<span class="tex display" style="display:block;overflow-x:auto;width:100px"><span style="display:block;width:400px">x</span></span>\';</script>'
    assert "math-clipped" in rendered(tmp_path, fmt("guide", body), widths=(390,))
