#!/usr/bin/env python3
"""Validate a rendered HTML page against the building-html rules.

Usage:
    python3 check_html.py PATH [PATH ...] [--strict]

Exit 0 when clean, 1 when any error is found (or any warning with --strict).
"""
import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

ARTIFACT_MAX_BYTES = 16_000_000

TITLE = re.compile(r"<title[^>]*>\s*\S", re.I)
VIEWPORT = re.compile(r'<meta[^>]+name=["\']viewport["\']', re.I)
# Subresources the browser fetches on its own. A plain <a href> is a
# hyperlink the reader chooses to follow, not a fetch, so it is excluded.
SUBRESOURCE = re.compile(
    r"<(?:script|img|source|track|embed|iframe|video|audio)\b[^>]*?"
    r"\bsrc\s*=\s*[\"']([^\"']*)[\"']", re.I)
LINK_HREF = re.compile(r"<link\b[^>]*?\bhref\s*=\s*[\"']([^\"']*)[\"']", re.I)
CSS_URL = re.compile(r"url\(\s*[\"']?([^\"')]+)[\"']?\s*\)", re.I)
DARK_MEDIA = re.compile(r"@media[^{]*prefers-color-scheme\s*:\s*dark", re.I)
DATA_THEME_DARK = re.compile(r"\[data-theme\s*=\s*[\"']?dark[\"']?\]", re.I)
CSS_COMMENT = re.compile(r"/\*.*?\*/", re.S)
# The trailing group catches a template placeholder: an explorable picks a
# series slot at runtime with `var(--series-${i})`, and the name is only
# complete once the placeholder is substituted.
VAR_USE = re.compile(r"var\(\s*(--[A-Za-z0-9_-]+)(\$\{|\{)?")
VAR_DEF = re.compile(r"(--[A-Za-z0-9_-]+)\s*:")
# A colour literal inside a declaration. Custom-property definitions are
# where colour is supposed to live, so they are stripped before this runs.
COLOR_LIT = re.compile(
    r":\s*[^;{}]*?(#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab)\()")
STYLE_BLOCK = re.compile(r"<style[^>]*>(.*?)</style>", re.I | re.S)


@dataclass
class Finding:
    code: str
    line: int
    msg: str
    level: str


def _line_of(text, idx):
    return text.count("\n", 0, idx) + 1


def _is_external(url):
    u = url.strip()
    if not u:
        return False
    low = u.lower()
    if low.startswith(("data:", "#", "about:blank")):
        return False
    if low.startswith(("http://", "https://", "//", "ftp:", "file:")):
        return True
    # Anything else is a relative path: a file that must travel with the
    # page and will not.
    return True


def _check_refs(text):
    out = []
    for rx in (SUBRESOURCE, LINK_HREF, CSS_URL):
        for m in rx.finditer(text):
            if _is_external(m.group(1)):
                out.append(Finding(
                    "external-ref", _line_of(text, m.start()),
                    f"external reference {m.group(1)!r}; inline it or use a "
                    f"data: URI", "error"))
    return out


def _check_themes(text):
    out = []
    if not DARK_MEDIA.search(text):
        out.append(Finding(
            "theme-dark-media", 1,
            "no @media (prefers-color-scheme: dark) block; the page cannot "
            "follow a viewer set to system", "error"))
    if not DATA_THEME_DARK.search(text):
        out.append(Finding(
            "theme-data-attr", 1,
            'no [data-theme="dark"] rule; an explicit viewer theme will not '
            "win over the media query", "error"))
    return out


def _check_backgrounds(css):
    out = []
    for sel in ("html", "body"):
        rx = re.compile(
            rf"(^|[,}}])\s*{sel}\s*(,[^{{}}]*)?{{[^}}]*?\bbackground(-color)?\s*:",
            re.I | re.S | re.M)
        if not rx.search(css):
            out.append(Finding(
                "explicit-background", 1,
                f"no explicit background on {sel}; with no viewer painting a "
                f"ground the page falls back to an OS default", "error"))
    return out


def _check_tokens(text, css):
    out = []
    defined = set(VAR_DEF.findall(css))
    seen = set()
    for m in VAR_USE.finditer(text):
        name = m.group(1)
        if m.group(2):
            continue
        if name in defined or name in seen:
            continue
        seen.add(name)
        out.append(Finding(
            "undefined-token", _line_of(text, m.start()),
            f"var({name}) is used but never defined", "error"))
    return out


def _blank_css_comments(css):
    """Blank /* */ comments, keeping line numbers intact.

    Theme files document their palette in comments, and those comments quote
    contrast ratios like `4.60:1 on #131a1b`. The colon makes the line look
    like a declaration, so without this every valid page carries a warning.
    """
    return CSS_COMMENT.sub(lambda m: "\n" * m.group(0).count("\n"), css)


PRINT_AT = re.compile(r"@media[^{]*\bprint\b[^{]*{", re.I)


def _blank_print_blocks(css):
    """Replace @media print bodies with blank lines, keeping line numbers.

    Print has no theme — paper is white — so a colour literal there is
    correct. base.css ships one, and flagging it would put a warning on every
    valid page.
    """
    out = css
    while True:
        m = PRINT_AT.search(out)
        if not m:
            return out
        depth, i = 1, m.end()
        while i < len(out) and depth:
            if out[i] == "{":
                depth += 1
            elif out[i] == "}":
                depth -= 1
            i += 1
        span = out[m.start():i]
        out = out[:m.start()] + "\n" * span.count("\n") + out[i:]


def _check_hardcoded(css, css_start):
    out = []
    css = _blank_print_blocks(css)
    for raw_line_no, line in enumerate(css.split("\n"), 1):
        # Drop every custom-property declaration on the line, not just one
        # starting it — a token block is routinely written inline as
        # `:root[data-theme="dark"] { --bg: #000; --text: #fff; }`.
        stripped = re.sub(r"--[A-Za-z0-9_-]+\s*:[^;}]*", "", line)
        if COLOR_LIT.search(stripped):
            out.append(Finding(
                "hardcoded-color", css_start + raw_line_no - 1,
                "colour literal outside a custom property; define it as a "
                "token so both themes can override it", "warning"))
    return out


H2 = re.compile(r"<h2\b", re.I)
SVG = re.compile(r"<svg\b", re.I)
FIGURE = re.compile(r"<figure\b[^>]*>(.*?)</figure>", re.I | re.S)
GRAPHIC = re.compile(r"<(?:svg|img|canvas|table|pre|video)\b", re.I)


def _check_visuals(text):
    """Heuristics for the failure the checker cannot see by rendering.

    A sectioned page — two or more <h2> — with no inline SVG has answered
    none of its questions with a picture. A <figure> whose contents are
    styled divs is a diagram drawn in CSS boxes, which clips at the first
    width it was not designed for; the recipe is inline SVG.
    """
    out = []
    if len(H2.findall(text)) >= 2 and not SVG.search(text):
        out.append(Finding(
            "no-svg", 1,
            "sectioned page with no inline <svg>; document mode wants one "
            "figure per section, drawn as SVG (see references/document.md)",
            "warning"))
    for m in FIGURE.finditer(text):
        if not GRAPHIC.search(m.group(1)):
            out.append(Finding(
                "figure-no-graphic", _line_of(text, m.start()),
                "<figure> holds no svg/img/table/pre — a diagram built from "
                "styled divs; draw it as inline SVG so it scales with the "
                "container instead of clipping", "warning"))
    return out


def check(text, max_bytes=ARTIFACT_MAX_BYTES):
    findings = []
    if not TITLE.search(text):
        findings.append(Finding("title", 1, "no non-empty <title>", "error"))
    if not VIEWPORT.search(text):
        findings.append(Finding(
            "viewport", 1,
            "no viewport meta; the page will not lay out on a phone", "error"))

    findings.extend(_check_refs(text))
    findings.extend(_check_themes(text))
    findings.extend(_check_visuals(text))

    css_parts = []
    for m in STYLE_BLOCK.finditer(text):
        css_parts.append((_blank_css_comments(m.group(1)),
                          _line_of(text, m.start(1))))
    css = "\n".join(part for part, _ in css_parts)
    # Token *uses* are scanned over the whole document — inline style
    # attributes and scripts set them too — but not over CSS comments, where a
    # name is being discussed rather than used.
    text = STYLE_BLOCK.sub(
        lambda m: m.group(0).replace(m.group(1),
                                     _blank_css_comments(m.group(1))), text)

    findings.extend(_check_backgrounds(css))
    findings.extend(_check_tokens(text, css))
    for part, start in css_parts:
        findings.extend(_check_hardcoded(part, start))

    size = len(text.encode("utf-8"))
    if size > max_bytes:
        findings.append(Finding(
            "size", 1,
            f"page is {size} bytes (max {max_bytes})", "error"))
    return findings


def main():
    ap = argparse.ArgumentParser(description="Validate HTML pages.")
    ap.add_argument("paths", nargs="+", type=Path)
    ap.add_argument("--strict", action="store_true",
                    help="treat warnings as errors")
    args = ap.parse_args()

    failed = False
    for path in args.paths:
        text = path.read_text(encoding="utf-8")
        for f in check(text):
            print(f"{path}:{f.line}: [{f.level}] {f.code}: {f.msg}")
            if f.level == "error" or args.strict:
                failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
