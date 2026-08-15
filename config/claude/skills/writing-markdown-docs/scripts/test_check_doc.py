import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from check_doc import check  # noqa: E402

# Built rather than written literally: a bare triple-backtick in this file
# would close the surrounding markdown fence in the plan document.
FENCE = "`" * 3

GOOD = """---
title: Test doc
date: 2026-08-10
type: teaching
---

# Test doc

A short line of prose.
"""


def codes(text, **kw):
    return [f.code for f in check(text, **kw)]


def test_clean_doc_has_no_findings():
    assert check(GOOD) == []


def test_missing_frontmatter_is_error():
    assert "frontmatter" in codes("# Title\n\nprose\n")


def test_bad_type_is_error():
    doc = GOOD.replace("type: teaching", "type: essay")
    msgs = [f.msg for f in check(doc) if f.code == "frontmatter"]
    assert any("essay" in m for m in msgs)


def test_bad_date_is_error():
    doc = GOOD.replace("date: 2026-08-10", "date: Aug 10 2026")
    msgs = [f.msg for f in check(doc) if f.code == "frontmatter"]
    assert any("YYYY-MM-DD" in m for m in msgs)


def test_long_prose_line_flagged():
    assert "wrap" in codes(GOOD + "\n" + ("word " * 30).strip() + "\n")


def test_long_url_line_not_flagged():
    doc = GOOD + "\nSee https://example.com/" + "a" * 90 + "\n"
    assert "wrap" not in codes(doc)


def test_wide_table_row_flagged():
    row = "| " + "x" * 60 + " | " + "y" * 60 + " |"
    assert "table-width" in codes(GOOD + "\n" + row + "\n")


def test_narrow_table_row_not_flagged():
    assert "table-width" not in codes(GOOD + "\n| a | b |\n")


def test_untagged_fence_flagged():
    doc = GOOD + "\n" + FENCE + "\nsome code\n" + FENCE + "\n"
    assert "fence-lang" in codes(doc)


def test_tagged_fence_not_flagged():
    doc = GOOD + "\n" + FENCE + "python\nx = 1\n" + FENCE + "\n"
    assert "fence-lang" not in codes(doc)


def test_long_line_inside_fence_not_flagged():
    doc = GOOD + "\n" + FENCE + "python\n# " + "z" * 120 + "\n" + FENCE + "\n"
    assert "wrap" not in codes(doc)


def test_h4_flagged():
    assert "heading-depth" in codes(GOOD + "\n#### Too deep\n")


def test_h3_not_flagged():
    assert "heading-depth" not in codes(GOOD + "\n### Fine\n")


def test_raw_html_flagged():
    assert "raw-html" in codes(GOOD + "\n<div>hi</div>\n")


def test_html_in_backticks_not_flagged():
    assert "raw-html" not in codes(GOOD + "\nUse the `<div>` element.\n")


def test_mermaid_br_tag_not_flagged():
    doc = (GOOD + "\n" + FENCE + "mermaid\nflowchart TD\n"
           "  A[a<br/>b] --> B[c]\n" + FENCE + "\n")
    assert "raw-html" not in codes(doc)


def test_placeholder_flagged():
    assert "placeholder" in codes(GOOD + "\nTODO: finish this\n")


def test_hype_is_warning_not_error():
    found = [f for f in check(GOOD + "\nA robust solution.\n")
             if f.code == "hype"]
    assert found and all(f.level == "warning" for f in found)


def test_no_frontmatter_mode_skips_frontmatter_checks():
    doc = "---\nname: x\ndescription: y\n---\n\n# Skill\n"
    assert "frontmatter" not in codes(doc, no_frontmatter=True)


def test_callout_not_treated_as_html():
    assert "raw-html" not in codes(GOOD + "\n> [!NOTE]\n> Something.\n")


def test_hype_word_in_backticks_is_mention_not_use():
    assert "hype" not in codes(GOOD + "\nAvoid `robust` and `seamless`.\n")


def test_placeholder_in_backticks_is_mention_not_use():
    assert "placeholder" not in codes(GOOD + "\nNever write `TODO` here.\n")


def test_short_fence_inside_long_fence_is_content_not_close():
    # A 3-backtick line inside a 4-backtick fence must not close it. If it
    # did, everything after the block would silently go unscanned.
    doc = (GOOD + "\n" + FENCE + "`python\ncode\n" + FENCE + "\n"
           + FENCE + "`\n\nTODO: after the fence\n")
    assert "placeholder" in codes(doc)


def test_matched_long_fence_closes():
    doc = (GOOD + "\n" + FENCE + "`python\ncode\n" + FENCE + "`\n"
           + "#### After\n")
    assert "heading-depth" in codes(doc)


def test_other_fence_char_inside_fence_is_content():
    doc = (GOOD + "\n" + FENCE + "python\n~~~\ncode\n" + FENCE + "\n"
           + "#### After\n")
    assert "heading-depth" in codes(doc)


def test_long_token_in_wrappable_prose_still_flagged():
    line = ("This is ordinary prose that should wrap but contains "
            + "x" * 35 + " in the middle.")
    assert "wrap" in codes(GOOD + "\n" + line + "\n")


def test_hyphen_split_word_is_warned():
    doc = GOOD + "\nits mental model was load-\nbearing, and that matters.\n"
    found = [f for f in check(doc) if f.code == "hyphen-split"]
    assert found and all(f.level == "warning" for f in found)


def test_hyphen_split_message_shows_the_rendered_form():
    doc = GOOD + "\nits mental model was load-\nbearing, and that matters.\n"
    msg = [f.msg for f in check(doc) if f.code == "hyphen-split"][0]
    assert "load- bearing" in msg


def test_thematic_break_is_not_a_hyphen_split():
    assert "hyphen-split" not in codes(GOOD + "\nbefore\n\n---\n\nafter\n")


def test_hyphen_at_line_end_inside_fence_is_ignored():
    doc = GOOD + "\n" + FENCE + "text\nload-\nbearing\n" + FENCE + "\n"
    assert "hyphen-split" not in codes(doc)


def test_fence_inside_blockquote_is_tracked():
    doc = (GOOD + "\n> [!BUG]\n> Trace:\n>\n> " + FENCE + "text\n"
           "> the worker acquired the lock and then waited on the same "
           "connection pool it already held\n> " + FENCE + "\n")
    assert "wrap" not in codes(doc)


def test_long_inline_code_span_is_one_atomic_token():
    span = ("`SELECT id, name, created_at, updated_at FROM ingest_jobs "
            "WHERE state = 1 ORDER BY id`")
    assert "wrap" not in codes(GOOD + "\nRun\n" + span + "\nto list them.\n")


def test_ordinary_long_prose_is_still_flagged():
    assert "wrap" in codes(GOOD + "\n" + ("word " * 30).strip() + "\n")


def test_hyphen_split_in_blockquote_is_warned():
    doc = GOOD + "\n> the write-\n> ahead log\n"
    found = [f for f in check(doc) if f.code == "hyphen-split"]
    assert found and all(f.level == "warning" for f in found)


def test_collapsed_callout_is_warned():
    doc = GOOD + "\n> [!TLDR] body text\n> more content\n"
    found = [f for f in check(doc) if f.code == "callout-collapsed"]
    assert found and all(f.level == "warning" for f in found)


def test_genuine_oneline_callout_is_not_warned():
    doc = GOOD + "\n> [!NOTE] This is a note.\n"
    assert "callout-collapsed" not in codes(doc)


def test_bad_status_is_error():
    doc = GOOD.replace("type: teaching", "type: teaching\nstatus: totally-made-up")
    msgs = [f.msg for f in check(doc) if f.code == "frontmatter"]
    assert any("totally-made-up" in m for m in msgs)


def test_handoff_without_status_is_error():
    doc = GOOD.replace("type: teaching", "type: handoff")
    msgs = [f.msg for f in check(doc) if f.code == "frontmatter"]
    assert any("status" in m.lower() for m in msgs)


def test_rca_without_status_is_clean():
    doc = GOOD.replace("type: teaching", "type: rca")
    assert "frontmatter" not in codes(doc)


def test_longer_closing_fence_closes():
    doc = (GOOD + "\n" + FENCE + "python\nx = 1\n" + FENCE + "``\n"
           + "#### After\n")
    assert "heading-depth" in codes(doc)


def test_closing_fence_with_info_string_does_not_close():
    doc = (GOOD + "\n" + FENCE + "python\nx = 1\n" + FENCE + "python\n"
           + "#### Still inside\n")
    assert "heading-depth" not in codes(doc)


def test_unterminated_fence_at_eof_does_not_crash():
    assert isinstance(codes(GOOD + "\n" + FENCE + "python\nx = 1\n"), list)


def test_new_genre_types_are_valid():
    for t in ("design", "runbook", "lookup"):
        doc = GOOD.replace("type: teaching", f"type: {t}\nstatus: current")
        assert "frontmatter" not in codes(doc), t


def test_new_genres_require_status():
    for t in ("design", "runbook", "lookup"):
        doc = GOOD.replace("type: teaching", f"type: {t}")
        msgs = [f.msg for f in check(doc) if f.code == "frontmatter"]
        assert any("requires a status" in m for m in msgs), t


def test_unknown_type_still_rejected():
    doc = GOOD.replace("type: teaching", "type: essay")
    assert "frontmatter" in codes(doc)
