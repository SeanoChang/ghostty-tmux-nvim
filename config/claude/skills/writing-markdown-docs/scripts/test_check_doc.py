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
type: learn
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
    doc = GOOD.replace("type: learn", "type: essay")
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
    doc = GOOD.replace("type: learn", "type: learn\nstatus: totally-made-up")
    msgs = [f.msg for f in check(doc) if f.code == "frontmatter"]
    assert any("totally-made-up" in m for m in msgs)


def test_handoff_without_status_is_error():
    doc = GOOD.replace("type: learn", "type: handoff")
    msgs = [f.msg for f in check(doc) if f.code == "frontmatter"]
    assert any("status" in m.lower() for m in msgs)


def test_rca_without_status_is_clean():
    doc = GOOD.replace("type: learn", "type: rca")
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
    for t in ("design", "runbook", "lookup", "plan", "task-card"):
        doc = GOOD.replace("type: learn", f"type: {t}\nstatus: current")
        assert "frontmatter" not in codes(doc), t


def test_new_genres_require_status():
    for t in ("design", "runbook", "lookup", "plan", "task-card"):
        doc = GOOD.replace("type: learn", f"type: {t}")
        msgs = [f.msg for f in check(doc) if f.code == "frontmatter"]
        assert any("requires a status" in m for m in msgs), t


def test_unknown_type_still_rejected():
    doc = GOOD.replace("type: learn", "type: essay")
    assert "frontmatter" in codes(doc)


# ── reader-load lints (2026-10-27 redesign) ──────────────────────────────────

def doc(body, type_="design", status="current"):
    st = f"status: {status}\n" if status else ""
    return f"---\ntitle: T\ndate: 2026-10-27\ntype: {type_}\n{st}---\n\n# T\n\n{body}\n"


def words(n, w="word"):
    return " ".join([w] * n)


def test_new_genres_are_valid_and_old_ones_warn():
    assert "frontmatter" not in codes(doc("x", "learn", None))
    assert "frontmatter" not in codes(doc("x", "plan"))
    assert "frontmatter" not in codes(doc("x", "task-card"))
    assert "legacy-type" in codes(doc("x", "teaching", None))
    assert "legacy-type" in codes(doc("x", "rca", None))


def test_a_long_tldr_warns():
    body = f"> [!tldr] Answer\n>\n> {words(70)}.\n"
    assert "lead-long" in codes(doc(body))


def test_a_tldr_within_budget_passes():
    body = f"> [!tldr] Answer\n>\n> {words(50)}.\n"
    assert "lead-long" not in codes(doc(body))


def test_a_long_first_paragraph_without_tldr_warns():
    body = "One idea here. Two ideas here. Three ideas here. Four ideas here.\n"
    assert "lead-long" in codes(doc(body))


def test_method_before_the_tldr_warns():
    body = f"{words(50, 'method')}.\n\n> [!tldr] Answer\n>\n> Short.\n"
    assert "lead-late" in codes(doc(body))


def test_a_short_line_before_the_tldr_passes():
    body = "Changed since 2026-10-20: one thing.\n\n> [!tldr] Answer\n>\n> Short.\n"
    assert "lead-late" not in codes(doc(body))


def test_many_undefined_ids_warn():
    body = "Read rows D112 to D128. D128 amends D122. Z2b and Z18 are open. E14 is done.\n"
    assert "undefined-id" in codes(doc(body))


def test_ids_inside_code_and_common_hardware_names_pass():
    body = "The `D112` row is in `E14`. An H100 has 80 GB; p99 is 4 ms on L2.\n"
    assert "undefined-id" not in codes(doc(body))


def test_writing_about_the_reader_in_third_person_warns():
    assert "reader-third" in codes(doc("The user decided to keep the queue.\n"))
    assert "reader-third" not in codes(doc('He wrote "the user decided" in a quote.\n'))
    assert "reader-third" not in codes(doc("The `the user` key holds the name.\n"))


def test_a_very_long_sentence_warns():
    assert "prose-long" in codes(doc(words(35) + ".\n"))
    assert "prose-long" not in codes(doc(words(20) + ". " + words(20) + ".\n"))


def test_sentences_wrapped_across_lines_are_joined_before_counting():
    body = words(12) + "\n" + words(12) + "\n" + words(12) + ".\n"
    assert "prose-long" in codes(doc(body))


def test_dense_parentheses_and_dashes_warn():
    body = " ".join(["The step (a read) is slow — the math (a sum) is not."] * 10) + "\n"
    found = codes(doc(body))
    assert "paren-dense" in found and "dash-dense" in found


def test_a_long_section_with_no_visual_warns():
    body = "## Part\n\n" + ". ".join([words(10)] * 30) + ".\n"
    assert "no-visual" in codes(doc(body))


def test_a_long_section_with_a_table_or_diagram_passes():
    table = "| a | b |\n| - | - |\n| 1 | 2 |\n"
    mermaid = f"{FENCE}mermaid\ngraph TD\n  a --> b\n{FENCE}\n"
    for v in (table, mermaid, "![The pipeline](assets/p.png)\n", "$$\nx = 1\n$$\n"):
        body = "## Part\n\n" + v + "\n" + ". ".join([words(10)] * 30) + ".\n"
        assert "no-visual" not in codes(doc(body)), v


def test_a_report_over_its_budget_warns():
    body = "## A\n\n| a |\n| - |\n\n" + ". ".join([words(10)] * 70) + ".\n"
    assert "too-long" in codes(doc(body, "report"))
    assert "too-long" not in codes(doc(body, "learn", None))


def test_uppercase_callouts_warn_and_lowercase_ones_still_get_the_collapse_check():
    assert "callout-case" in codes(doc("> [!TLDR] Short\n"))
    assert "callout-case" not in codes(doc("> [!tldr] Short\n"))
    assert "callout-collapsed" in codes(doc("> [!note] Title text\n> body on the next line\n"))


LEARN_OK = """## Worked example: one request

Text.

## Part one

Text.

> [!question] Check: which is it?
>
> - a. The first option, about this long.
> - b. The second option, about this long.
> - c. The third option, about this long.

> [!success]- Answer
>
> **b.** Because of the reason.

## Part two

Text.
"""


def test_a_learn_doc_must_open_with_its_worked_example():
    assert "example-late" not in codes(doc(LEARN_OK, "learn", None))
    assert "example-late" in codes(doc(LEARN_OK.replace("## Worked example: one request", "## Background"), "learn", None))


def test_a_learn_doc_without_checks_warns():
    no_checks = LEARN_OK.split("> [!question]")[0] + "## Part two\n\nText.\n"
    assert "no-check" in codes(doc(no_checks, "learn", None))
    assert "no-check" not in codes(doc(LEARN_OK, "learn", None))


def test_an_answer_that_is_not_folded_warns():
    assert "answer-visible" in codes(doc(LEARN_OK.replace("[!success]- Answer", "[!success] Answer"), "learn", None))
    assert "answer-visible" not in codes(doc(LEARN_OK, "learn", None))


def test_an_answer_option_much_longer_than_the_rest_warns():
    lop = LEARN_OK.replace("> - b. The second option, about this long.", "> - b. The second option, which is far longer than the others because it explains itself.")
    assert "options-uneven" in codes(doc(lop, "learn", None))
    assert "options-uneven" not in codes(doc(LEARN_OK, "learn", None))


def test_math_blocks_end_where_they_close():
    import check_doc as cd
    lines = "---\ntype: learn\n---\n\n$$\nx = 1\n$$\n\nAfter.\n\n$$y = 2$$\n\nLast.\n".split("\n")
    kinds = [(k, at) for k, at, _ in cd._blocks(lines, 2)]
    assert kinds == [("math", 5), ("para", 9), ("math", 11), ("para", 13)]


def test_the_tldr_title_does_not_count_toward_its_budget():
    body = f"> [!tldr] {words(12, 'title')}\n>\n> {words(55)}.\n"
    assert "lead-long" not in codes(doc(body))


def test_a_long_bulleted_list_is_structure_not_a_wall():
    body = "## Rules\n\n" + "\n".join(f"- **Rule {i}.** " + words(14) + "." for i in range(25)) + "\n"
    assert "no-visual" not in codes(doc(body))


# ── round 2, from the two proof rewrites ──────────────────────────────────────

def test_a_table_collapsed_into_a_paragraph_is_an_error():
    body = "| a | b | c | | - | - | - | - | | 1 | 2 | 3 |\n"
    assert "broken-table" in codes(doc(body))
    assert "broken-table" not in codes(doc("Use `a | b` to pipe, or x | y.\n"))


def test_display_math_is_not_held_to_the_prose_wrap():
    body = "$$\n" + "x + " * 30 + "y\n$$\n"
    assert "wrap" not in codes(doc(body))


def test_a_wide_table_is_reported_once():
    row = "| " + "x" * 60 + " | " + "y" * 60 + " |"
    body = "\n".join([row, "| - | - |", row, row, row]) + "\n"
    assert codes(doc(body)).count("table-width") == 1


def test_table_text_counts_toward_the_budget():
    table = "| a | b |\n| - | - |\n" + "\n".join(f"| {words(20)} | {words(20)} |" for _ in range(15)) + "\n"
    body = "## A\n\n" + table + "\n" + ". ".join([words(10)] * 10) + ".\n"
    assert "too-long" in codes(doc(body, "report"))


def test_learn_checks_and_rubrics_do_not_count_toward_the_budget():
    check = "> [!question] Check\n>\n> " + words(60) + "\n\n> [!success]- Answer\n>\n> " + words(100) + "\n\n"
    body = LEARN_OK + "\n" + check * 25
    assert "too-long" not in codes(doc(body, "learn", None))


def test_the_check_question_lives_in_the_body():
    lop = LEARN_OK.replace("> [!question] Check: which is it?\n>\n", "> [!question] Check\n>\n> Which is it, given the setup?\n>\n").replace(
        "> - b. The second option, about this long.", "> - b. The second option, which is far longer than the others because it explains itself.")
    assert "options-uneven" in codes(doc(lop, "learn", None))


# ── vault mode ────────────────────────────────────────────────────────────────
# Vault notes keep the vault's own frontmatter, links and line wrapping
# (references/vault/conventions.md); voice and reader-load rules still apply.

VAULT = """---
tags: [backpressure, streaming]
type: note
status: draft
---

# 03-04 Backpressure

> A consumer that cannot keep up must slow the producer, or the queue grows without bound.

## Worked example

A producer sends 1,000 messages a second. The consumer handles 800 a second, so the queue grows by 200 a second and runs out of memory in a long run. See [[03-03 Bounded Queues]] for the fix.

| Rate | Value |
|---|---|
| Producer | 1,000 msg/s |
| Consumer | 800 msg/s |
"""


def vcodes(text):
    return [f.code for f in check(text, vault=True)]


def test_vault_note_in_vault_conventions_is_clean():
    assert check(VAULT, vault=True) == []


def test_vault_note_fails_repo_rules_without_the_flag():
    # The same note breaks the repo dialect: no title/date, wide prose.
    assert {"frontmatter", "wrap"} <= set(codes(VAULT))


def test_vault_rejects_keys_the_vault_never_writes():
    for key, val in (("title", "Backpressure"), ("date", "2026-10-29"), ("estimated_hours", "3")):
        doc = VAULT.replace("type: note", f"type: note\n{key}: {val}")
        assert "vault-key" in vcodes(doc), key


def test_vault_type_and_status_use_vault_vocabulary():
    assert "frontmatter" in vcodes(VAULT.replace("type: note", "type: learn"))
    assert "frontmatter" in vcodes(VAULT.replace("status: draft", "status: current"))
    assert "frontmatter" not in vcodes(VAULT.replace("type: note", "type: sota"))


def test_vault_requires_tags_and_type():
    assert "frontmatter" in vcodes(VAULT.replace("tags: [backpressure, streaming]\n", ""))
    assert "frontmatter" in vcodes(VAULT.replace("type: note\n", ""))


def test_vault_list_keys_must_be_lists_and_dates_iso():
    assert "frontmatter" in vcodes(VAULT.replace("type: note", "type: note\ntrack: A"))
    assert "frontmatter" not in vcodes(VAULT.replace("type: note", "type: note\ntrack: [A]"))
    assert "frontmatter" in vcodes(VAULT.replace("type: note", "type: note\ncreated: Oct 29"))


def test_vault_relative_and_ambiguous_wikilinks_are_errors():
    rel = VAULT.replace("[[03-03 Bounded Queues]]", "[[../queues/03-03 Bounded Queues]]")
    amb = VAULT.replace("[[03-03 Bounded Queues]]", "[[README]]")
    assert "vault-link" in vcodes(rel)
    assert "vault-link" in vcodes(amb)


def test_vault_allows_br_inside_a_table_only():
    assert "raw-html" not in vcodes(VAULT.replace("| 1,000 msg/s |", "| 1,000<br>msg/s |"))
    assert "raw-html" in vcodes(VAULT.replace("See [[", "See <b>this</b> [["))


def test_vault_still_checks_voice():
    long = "This sentence " + "keeps going and going " * 8 + "without a stop."
    assert "prose-long" in vcodes(VAULT.replace("See [[03-03", long + " See [[03-03"))


def test_vault_blockquote_lede_counts_as_the_lead_and_is_capped():
    assert "lead-long" not in vcodes(VAULT)
    wordy = VAULT.replace("must slow the producer", "must slow the producer " + "and more " * 40)
    assert "lead-long" in vcodes(wordy)


def test_dash_cells_are_not_a_collapsed_separator():
    doc = GOOD + "\n| Metric | Value |\n| --- | --- |\n| Recent PRs | -- |\n| Dropped | - |\n| 多店管理 | -- | -- | ✅ |\n"
    assert "broken-table" not in codes(doc)
    assert "broken-table" in codes(GOOD + "\n| a | b | |---|---|\n")


def test_vault_callout_body_on_next_line_is_fine():
    # The vault is never rewrapped by prettier, so the body cannot be pulled into the title.
    doc = VAULT.replace("## Worked example", "> [!warning] One caveat\n> The rate varies.\n\n## Worked example")
    assert "callout-collapsed" not in vcodes(doc)
    assert "callout-collapsed" in codes(doc)


# ── vault mode: verifier round 1 ──────────────────────────────────────────────

def _fm(extra):
    return VAULT.replace("status: draft", "status: draft\n" + extra)


def test_vault_block_list_tags_warn_toward_inline_form():
    doc = VAULT.replace("tags: [backpressure, streaming]", "tags:\n  - backpressure\n  - streaming")
    found = [f for f in check(doc, vault=True) if f.code == "vault-tags-form"]
    assert found and found[0].level == "warning"


def test_vault_unknown_keys_are_errors_but_tool_config_keys_are_exempt():
    unknown = [f for f in check(_fm("foo: bar"), vault=True) if f.code == "vault-key"]
    assert unknown and unknown[0].level == "warning"
    banned = [f for f in check(_fm("date: 2026-10-29"), vault=True) if f.code == "vault-key"]
    assert banned and banned[0].level == "error"
    assert "vault-key" not in vcodes(_fm("model: opus\ntemperature: 0.2"))


def test_vault_ambiguous_link_with_heading_is_still_ambiguous():
    doc = VAULT.replace("[[03-03 Bounded Queues]]", "[[README#Setup]]")
    f = [x for x in check(doc, vault=True) if x.code == "vault-link"]
    assert f and "parent MOC" in f[0].msg


def test_vault_escaped_alias_and_md_suffix_are_resolved():
    tbl = VAULT.replace("| Producer | 1,000 msg/s |", "| [[README\\|Home]] | 1,000 msg/s |")
    assert "vault-link" in vcodes(tbl)
    assert "vault-link" in vcodes(VAULT.replace("[[03-03 Bounded Queues]]", "[[README.md]]"))
    rel = VAULT.replace("| Producer | 1,000 msg/s |", "| [[../x/y\\|Home]] | 1,000 msg/s |")
    assert any("[[../x/y]]" in f.msg for f in check(rel, vault=True) if f.code == "vault-link")


def test_vault_frontmatter_wikilinks_are_checked():
    assert "vault-link" in vcodes(_fm('prereqs: ["[[../x/05 Y]]"]'))
    assert "vault-link" in vcodes(_fm('prereqs: ["[[README]]"]'))
    assert "vault-link" not in vcodes(_fm('prereqs: ["[[03-03 Bounded Queues]]"]'))


def test_vault_quoted_and_commented_values_are_read_as_yaml():
    assert check(VAULT.replace("type: note", 'type: "note"'), vault=True) == []
    assert check(VAULT.replace("type: note", "type: note # kind"), vault=True) == []
    assert check(_fm("created: '2026-01-02'"), vault=True) == []


def test_vault_br_allowed_in_quoted_or_indented_tables():
    for row in ("> | 1<br>2 | 3 |", "  | 1<br>2 | 3 |"):
        assert "raw-html" not in vcodes(VAULT + "\n" + row + "\n"), row


def test_bom_before_frontmatter_is_ignored():
    assert check("﻿" + VAULT, vault=True) == []
    assert "frontmatter" not in codes("﻿" + GOOD)


def test_collapsed_table_detection_both_ways():
    assert "broken-table" not in codes(GOOD + "\n| a | - | - | |\n")
    assert "broken-table" in codes(GOOD + "\n| a | b || --- | --- || 1 | 2 |\n")
    assert "broken-table" in codes(GOOD + "\n| a | | - |\n")


def test_vault_vocabularies_for_track_difficulty_tags_and_dates():
    assert "frontmatter" in vcodes(_fm("track: [merge]"))
    assert "frontmatter" in vcodes(_fm("difficulty: hard"))
    assert "frontmatter" not in vcodes(_fm("difficulty: capstone"))
    assert "frontmatter" in vcodes(VAULT.replace("tags: [backpressure, streaming]", "tags:"))
    assert "frontmatter" in vcodes(_fm("created: 2026-13-45"))


# ── vault mode: verifier round 2 (block lists keep their items) ───────────────

def test_vault_block_list_items_are_read():
    for form in ("tags:\n  - a\n  - b", "tags:\n- a"):
        doc = VAULT.replace("tags: [backpressure, streaming]", form)
        assert "frontmatter" not in vcodes(doc), form
    merge = VAULT.replace("status: draft", "status: draft\ntrack:\n  - merge")
    assert "frontmatter" in vcodes(merge)


def test_frontmatter_comment_line_is_not_a_key():
    assert "vault-key" not in vcodes(VAULT.replace("type: note", "# kind: x\ntype: note"))


def test_row_after_a_separator_is_data_not_a_collapse():
    doc = GOOD + "\n| a | b | c |\n|---|---|---|\n| x | | - |\n"
    assert "broken-table" not in codes(doc)


def test_collapsed_table_in_a_callout_or_indent_is_caught():
    for row in ("> | a | b || --- | --- || 1 | 2 |", "  | a | b || --- | --- || 1 | 2 |"):
        assert "broken-table" in codes(GOOD + "\n" + row + "\n"), row


# ── sentence boundaries that are not full stops ───────────────────────────────
# A label line, an image line, a callout title and a list item each end a
# sentence, although none ends in a full stop. Found on 2026-11-10: 30 flagged
# sentences were read by hand and about 20 were two of these joined together.

def test_a_label_line_does_not_join_the_list_under_it():
    body = "Rules:\n" + "".join(f"- {words(8)}\n" for _ in range(5))
    assert "prose-long" not in codes(doc(body))


def test_list_items_under_a_paragraph_are_separate_sentences():
    body = words(10) + "\n" + "".join(f"- {words(9)}\n" for _ in range(4))
    assert "prose-long" not in codes(doc(body))


def test_an_image_line_does_not_join_its_caption():
    body = "![[23-08-fig-8-07.png]]\n" + words(28) + ".\n"
    assert "prose-long" not in codes(doc(body))
    body = "![what to notice](assets/a.png)\n" + words(28) + ".\n"
    assert "prose-long" not in codes(doc(body))


def test_a_callout_title_does_not_join_its_body():
    body = "> [!tip] " + words(6) + "\n>\n> " + words(27) + ".\n"
    assert "prose-long" not in codes(doc(body))


def test_separators_and_bare_marks_are_not_words():
    body = " · ".join(words(3) for _ in range(9)) + ".\n"     # 27 words, 8 middots
    assert "prose-long" not in codes(doc(body))


def test_a_long_list_item_is_still_flagged():
    assert "prose-long" in codes(doc("- " + words(35) + ".\n"))


def test_a_long_sentence_after_a_label_is_still_flagged():
    assert "prose-long" in codes(doc("Rules:\n" + words(35) + ".\n"))


def test_a_long_callout_body_is_still_flagged():
    assert "prose-long" in codes(doc("> [!note] Title\n>\n> " + words(35) + ".\n"))


def test_new_sentence_split_only_refines_the_old_one():
    """Against the old splitter on random documents: the new one may cut a
    sentence at a label, list, image or callout-title line, and it never makes a
    longer sentence or loses a word other than an image line."""
    import random
    import re
    from check_doc import IMAGE_LINE, _plain, _sentences

    def old(text):
        flat = " ".join(_plain(text).split())
        return [x for x in re.split(r"(?<=[.!?])\s+", flat) if x.strip()]

    def wordy(s):
        return [w for w in s.split() if re.search(r"\w", w)]

    rng = random.Random(20261110)
    starts = ["", "", "- ", "1. ", "> ", "> [!note] ", "> - "]
    ends = ["", "", ".", ":", "?", " ·", ";"]
    for _ in range(400):
        lines = []
        for _ in range(rng.randint(1, 9)):
            if rng.random() < 0.1:
                lines.append(rng.choice(["![[fig-1.png]]", "![alt text](a/b.png)", "> ![[x.png]]"]))
                continue
            n = rng.randint(1, 14)
            lines.append(rng.choice(starts) + " ".join(rng.choice(["alpha", "beta", "·", "x1", "—", "gamma"]) for _ in range(n)) + rng.choice(ends))
        text = "\n".join(lines)
        new_words = [w for s in _sentences(text) for w in wordy(s)]
        kept = "\n".join(ln for ln in lines if not IMAGE_LINE.fullmatch(ln))
        old_words = [w for s in old(kept) for w in wordy(s)]
        assert new_words == old_words, text
        longest_old = max((len(wordy(s)) for s in old(text)), default=0)
        assert all(len(wordy(s)) <= longest_old for s in _sentences(text)), text


# ── a cut happens only at a structural line ──────────────────────────────────
# Found by an adversary pass on 2026-11-10. The first version cut after every
# line that ended in a colon. The validator's own wrap rule breaks prose at 80
# columns, so a long sentence passed whenever a wrap fell after a colon.

COLON_WRAP = (
    "The plan has three parts that we agreed on last week, and in order of cost:\n"
    "the cache layer, the queue, and the retry loop that never stops running at\n"
    "night in the busy region.\n"
)


def test_a_wrap_after_a_colon_does_not_end_the_sentence():
    assert "prose-long" in codes(doc("Short lead.\n\n## S\n\n" + COLON_WRAP))


def test_a_wrap_after_a_colon_in_a_list_item_or_a_callout_does_not_end_the_sentence():
    item = "- " + words(17) + " cost:\n  " + words(16) + ".\n"
    assert "prose-long" in codes(doc("Short lead.\n\n## S\n\n" + item))
    callout = "> [!note] Title\n>\n> " + words(17) + " cost:\n> " + words(16) + ".\n"
    assert "prose-long" in codes(doc("Short lead.\n\n## S\n\n" + callout))


def test_inline_code_wrapped_after_a_colon_does_not_hide_the_next_sentence():
    body = "Set `retry:\nmax=3` in the file. " + words(33) + " `x` end.\n"
    assert "prose-long" in codes(doc("Short lead.\n\n## S\n\n" + body))


def test_a_wrapped_line_that_starts_with_a_year_is_not_a_list_item():
    # Only "1." can start a list inside a paragraph (CommonMark).
    # 19 words, a wrap, then 14: over the limit only when read as one sentence.
    body = words(18) + " in\n2019. " + words(14) + ".\n"
    assert "prose-long" in codes(doc("Short lead.\n\n## S\n\n" + body))
    # The same inside a callout, where the line continues the paragraph above it.
    body = "> [!note] Title\n>\n> " + words(18) + " in\n> 2019. " + words(14) + ".\n"
    assert "prose-long" in codes(doc("Short lead.\n\n## S\n\n" + body))


def test_a_callout_list_that_starts_past_one_is_still_cut_at_each_item():
    # No paragraph is open after the empty quote line, so "3." starts a list.
    body = "> [!note] Title\n>\n" + "".join(f"> {i}. {words(9)}\n" for i in range(3, 8))
    assert "prose-long" not in codes(doc("Short lead.\n\n## S\n\n" + body))


def test_a_numbered_list_under_a_paragraph_is_still_cut_at_each_item():
    body = words(10) + "\n" + "".join(f"{i}. {words(9)}\n" for i in range(1, 6))
    assert "prose-long" not in codes(doc("Short lead.\n\n## S\n\n" + body))


def test_a_callout_type_with_a_hyphen_does_not_join_its_body():
    body = "> [!my-type] " + words(6) + "\n>\n> " + words(27) + ".\n"
    assert "prose-long" not in codes(doc("Short lead.\n\n## S\n\n" + body))


def test_lead_long_counts_sentences_as_it_did_before_the_split_changed():
    # A label and its list under the H1 have no full stop: one sentence, as before.
    assert "lead-long" not in codes(doc("Key points:\n- alpha\n- beta\n- gamma\n"))
    # Three sentences, one of them wrapped after a colon.
    lead = "First one here. The second has parts:\nthe cache and the queue. Third one.\n"
    assert "lead-long" not in codes(doc(lead))
    assert "lead-long" in codes(doc("One. Two. Three. Four.\n"))


def _old_sentences(text):
    import re
    from check_doc import _plain
    flat = " ".join(_plain(text).split())
    return [x for x in re.split(r"(?<=[.!?])\s+", flat) if x.strip()]


def test_text_with_no_structural_line_splits_exactly_as_before():
    """Random wrapped prose with colons, inline code and years at line ends and
    starts, but no list, callout title or image line: nothing may be cut."""
    import random
    from check_doc import _sentences

    rng = random.Random(4522)
    vocab = ["alpha", "beta", "gamma", "x1", "`a b:`", "`retry:", "max=3`", "2019.", "(see", "it)"]
    ends = ["", "", "", "", ".", ":", "?", ";", ","]
    for _ in range(2000):
        lines = []
        for _ in range(rng.randint(1, 7)):
            toks = [rng.choice(vocab) + rng.choice(ends) for _ in range(rng.randint(1, 14))]
            if not lines and toks[0] == "2019.":
                toks[0] = "alpha"  # a number that opens the block does start a list
            lines.append(rng.choice(["", "", "> ", "  "]) + " ".join(toks))
        text = "\n".join(lines)
        assert _sentences(text) == _old_sentences(text), text


def test_cuts_match_a_reference_built_from_the_known_structure():
    """Random blocks made of units whose kind the generator knows. The expected
    result cuts before a list item, before and after a callout title, and at an
    image line, and nowhere else; each group is then split as plain prose."""
    import random
    from check_doc import _sentences

    rng = random.Random(20261110)
    ends = ["", "", "", ".", ":", "?", ";"]
    images = ["![[fig-1.png]]", "![alt text](a/b.png)", "> ![[x.png]]"]
    titles = ["> [!note] ", "> [!my-type]- ", "> [!tip]+ "]

    def tokens(n):
        return [rng.choice(["alpha", "beta", "gamma", "x1", "`k: v`"]) + rng.choice(ends) for _ in range(n)]

    def wrap(toks, first, rest, year_ok):
        """Break toks over one to three lines; a later line may start with a year."""
        out, cuts = [], sorted(rng.sample(range(1, len(toks)), min(len(toks) - 1, rng.randint(0, 2))))
        for a, b in zip([0] + cuts, cuts + [len(toks)]):
            part = toks[a:b]
            if out and year_ok and rng.random() < 0.3:
                part = ["2019."] + part
            out.append((rest if out else first) + " ".join(part))
        return out

    for _ in range(1500):
        groups, lines = [[]], []
        number, ordered_seen, prev = 0, False, None
        for _ in range(rng.randint(1, 8)):
            kind = rng.choice(["para", "para", "quote", "bullet", "ordered", "quote_bullet", "title", "image"])
            if kind == "image":
                lines.append(rng.choice(images))
                groups.append([])
            elif kind == "title":
                line = rng.choice(titles) + " ".join(tokens(rng.randint(0, 6)))
                lines.append(line)
                groups.extend([[line], []])
            else:
                number = number + 1 if kind == "ordered" and prev == "ordered" else 1
                first, rest, year_ok = {
                    "para": ("", "", not ordered_seen),
                    "quote": ("> ", "> ", True),
                    "bullet": ("- ", "  ", True),
                    "ordered": (f"{number}. ", "   ", True),
                    "quote_bullet": ("> - ", ">   ", True),
                }[kind]
                made = wrap(tokens(rng.randint(2, 14)), first, rest, year_ok)
                if kind in ("bullet", "ordered", "quote_bullet"):
                    groups.append([])
                ordered_seen = ordered_seen or kind == "ordered"
                lines.extend(made)
                groups[-1].extend(made)
            prev = kind
        expected = [s for g in groups if g for s in _old_sentences("\n".join(g))]
        text = "\n".join(lines)
        assert _sentences(text) == expected, text


# ── list state follows markdown's own open and close rules ───────────────────
# Second adversary pass, 2026-11-10: the splitter remembered an ordered list
# after the list had ended, and cut a later sentence at a wrapped "3)". A wrong
# cut hides a long sentence; a wrong join only shows a warning. So the splitter
# cuts where CommonMark certainly ends the paragraph, and forgets the list
# state whenever it is in doubt.

STALE_LIST = (
    "> [!note] How to roll back\n"
    "> 1) Stop the deploy.\n"
    "> 2) Revert the commit.\n"
    ">\n"
    "> If the revert fails, page the on-call engineer, who checks three things in\n"
    "> order before anyone retries the deploy by hand: 1) the queue depth, 2) the\n"
    "> error budget, and\n"
    "> 3) the replica lag on the primary database and on each of its read copies.\n"
)


def test_a_list_that_has_ended_does_not_cut_a_later_paragraph():
    assert "prose-long" in codes(doc("Short lead.\n\n## S\n\n" + STALE_LIST))


def test_an_empty_quote_line_ends_the_paragraph_above_it():
    body = "> [!note] Title\n>\n> " + words(20) + "\n>\n> " + words(20) + ".\n"
    assert "prose-long" not in codes(doc("Short lead.\n\n## S\n\n" + body))


def test_a_deeply_indented_dash_continues_the_paragraph():
    # Four or more spaces past the paragraph: markdown reads a continuation line.
    body = words(20) + "\n    - " + words(14) + ".\n"
    assert "prose-long" in codes(doc("Short lead.\n\n## S\n\n" + body))


def test_a_nested_list_in_a_callout_is_cut_at_each_item():
    body = "> [!note] Title\n>\n> - " + words(12) + "\n>     - " + words(12) + "\n>     - " + words(12) + "\n> - " + words(12) + "\n"
    assert "prose-long" not in codes(doc("Short lead.\n\n## S\n\n" + body))


def test_any_numbered_line_at_the_list_level_ends_the_item_above_it():
    body = words(6) + ":\n- " + words(16) + "\n8) " + words(16) + "\n"
    assert "prose-long" not in codes(doc("Short lead.\n\n## S\n\n" + body))


def test_no_long_sentence_is_lost_against_a_commonmark_parser():
    """Random hostile blocks, read by markdown-it-py. A sentence over 30 words
    in one of the parser's paragraphs must sit inside one sentence of the
    validator. Skipped where markdown-it-py is not installed."""
    import random
    import re
    import pytest
    markdown_it = pytest.importorskip("markdown_it")
    from check_doc import _plain, _sentences

    md = markdown_it.MarkdownIt("commonmark")

    def wordy(s):
        return [w for w in s.split() if re.search(r"\w", w)]

    def split(text):
        flat = " ".join(_plain(text).split())
        return [wordy(x) for x in re.split(r"(?<=[.!?])\s+", flat) if x.strip()]

    def inside(big, small):
        """small's words all appear in big, in order. Not required to be side
        by side: a marker inside a paragraph is a word to one reader and not
        to the other, which shifts a count by one without hiding anything."""
        rest = iter(big)
        return all(w in rest for w in small)

    vocab = ["alpha", "beta", "gamma", "delta", "the", "and", "of"] * 6 + ["cost:", "end.", "done?"]
    markers = [""] * 5 + ["- ", "* ", "+ ", "1. ", "1) ", "2. ", "3) ", "8) ", "2019. ", "7. ", "-  ", "1.   ",
                          "- - ", "+ 1. ", "1. - ", "-      "]
    # No line that is a bare marker ("+" or "1." alone): `_plain` then eats the
    # line break after it and reads the next marker as a word, in this reader
    # and not in the parser. That is a quirk of `_plain`, older than the split.
    whole = ["***", "- - -", "---", "===", "* * *", "_ _ _", "+ + +"]
    lost = []
    for seed in range(6000):
        rng = random.Random(seed)
        quoted = rng.random() < 0.6
        lines = []
        for _ in range(rng.randint(2, 11)):
            if quoted and lines and rng.random() < 0.15:
                lines.append(">")
                continue
            q = ("> " if rng.random() < 0.93 else ">> ") if quoted else ""
            pad = " " * rng.choice([0, 0, 0, 0, 1, 2, 2, 3, 3, 4, 4, 5, 6])
            if not lines and not quoted:
                pad = pad[:3]  # four spaces at the start of a block is code, not prose
            if lines and rng.random() < 0.04:
                lines.append(q + pad + rng.choice(whole))
                continue
            lines.append(q + pad + rng.choice(markers) + " ".join(rng.choice(vocab) for _ in range(rng.randint(2, 13))))
        body = [re.sub(r"^\s*> ?", "", ln, count=1) for ln in lines] if quoted else lines
        toks = md.parse("\n".join(body))
        ref = [s for i, t in enumerate(toks) if t.type == "inline" and toks[i - 1].type == "paragraph_open" for s in split(t.content)]
        got = [wordy(s) for s in _sentences("\n".join(lines))]
        if any(len(r) > 30 and not any(inside(g, r) for g in got) for r in ref):
            lost.append(seed)
    assert not lost, f"{len(lost)} of 6000 blocks lose a long sentence; first seeds {lost[:5]}"
