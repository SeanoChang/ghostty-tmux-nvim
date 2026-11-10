#!/usr/bin/env python3
"""Render check for visual-artifacts pages.

Two passes over one Artifact page (the file you will publish, with no
<html>/<head>/<body> of its own):

1. static  - the Artifact page contract: title, pinned CDN scripts from allowed
             hosts, Google-Fonts-only stylesheets, both theme blocks, the side
             gutter promise, APIs the viewer refuses (alert/confirm/print/
             download links), external fetches, literal colours outside tokens.
2. render  - wraps the page in the publish skeleton plus an approximation of
             the viewer's CSP, serves it locally, and drives headless Chromium
             at each width x colour scheme. Reports console errors, uncaught
             exceptions, CSP blocks, failed loads, horizontal overflow (with
             the widest offenders) and fonts that silently fell back. Writes a
             full-page screenshot for each run; LOOK at them.

Usage:
  render_check.py PAGE.html [--out DIR] [--widths 390,1000,1440] [--schemes light,dark]
                  [--step "label::js"]... [--wait MS] [--static-only]

  --step runs JavaScript in the page after load, waits, and screenshots again,
  e.g. --step "playing::document.querySelector('[data-play]').click()".

Exit status: 0 when no errors (warnings allowed), 1 otherwise.
"""

from __future__ import annotations

import argparse
import functools
import http.server
import json
import pathlib
import re
import socketserver
import sys
import tempfile
import threading
from dataclasses import dataclass, field
from urllib.parse import urlparse

SCRIPT_HOSTS = {"cdnjs.cloudflare.com", "cdn.jsdelivr.net", "unpkg.com", "cdn.tailwindcss.com", "code.jquery.com"}
STYLE_HOSTS = {"fonts.googleapis.com"}
MAX_BYTES = 16 * 1024 * 1024

CSP = (
    "default-src 'none'; "
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: " + " ".join(f"https://{h}" for h in sorted(SCRIPT_HOSTS)) + "; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src https://fonts.gstatic.com data:; "
    "img-src 'self' data: blob:; media-src 'self' data: blob:; "
    "connect-src 'self' data: blob:; worker-src 'self' blob:; frame-src 'none'"
)

# The publish skeleton, as the Artifact tool describes it.
SKELETON_HEAD = (
    '<!doctype html><html lang="en"{theme}><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
    '<meta http-equiv="Content-Security-Policy" content="{csp}">'
    "<style>:root{{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}}"
    "body{{margin:0;font:14px system-ui,-apple-system,sans-serif}}img{{max-width:100%}}[hidden]{{display:none!important}}</style>"
    "</head><body>"
)


@dataclass
class Issue:
    level: str  # "error" | "warn" | "info"
    code: str
    message: str

    def __str__(self) -> str:
        return f"[{self.level.upper():5}] {self.code}: {self.message}"


@dataclass
class Report:
    issues: list[Issue] = field(default_factory=list)
    shots: list[pathlib.Path] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not any(i.level == "error" for i in self.issues)


# ── static ──────────────────────────────────────────────────────────────────

_PINNED = re.compile(r"@\d+\.\d+\.\d+(?:[-+][\w.]+)?(?:/|$)|/(?:v?\d+\.\d+\.\d+|r\d{2,3})(?:/|$)")


def _check_url(url: str, kind: str, out: list[Issue]) -> None:
    u = urlparse(url)
    if u.scheme not in ("http", "https"):
        return  # relative file published alongside the page, data:, blob:
    if u.hostname not in SCRIPT_HOSTS:
        out.append(Issue("error", "script-host", f"{kind} {url} is not on an allowed CDN host ({', '.join(sorted(SCRIPT_HOSTS))})"))
        return
    if u.hostname == "cdn.tailwindcss.com":
        if not re.match(r"^/\d+\.\d+\.\d+", u.path):
            out.append(Issue("error", "script-unpinned", f"{kind} {url} must pin an exact version, e.g. cdn.tailwindcss.com/3.4.17"))
        return
    if not _PINNED.search(u.path):
        out.append(Issue("error", "script-unpinned", f"{kind} {url} must pin an exact version (name@x.y.z or /x.y.z/)"))


def _strip_token_blocks(css: str) -> str:
    """Drop :root token blocks (also inside @media) so any literal colour left is in a real rule."""
    out, i = [], 0
    while i < len(css):
        j = css.find("{", i)
        if j < 0:
            out.append(css[i:])
            break
        selector = css[i:j]
        depth, k = 1, j + 1
        while k < len(css) and depth:
            depth += {"{": 1, "}": -1}.get(css[k], 0)
            k += 1
        body = css[j + 1 : k - 1]
        if ":root" in selector or "@font-face" in selector:
            pass
        elif selector.strip().startswith("@"):
            out.append(_strip_token_blocks(body))
        else:
            out.append(selector + "{" + body + "}")
        i = k
    return "".join(out)


def check_static(html: str) -> list[Issue]:
    issues: list[Issue] = []

    def add(level: str, code: str, msg: str) -> None:
        issues.append(Issue(level, code, msg))

    if len(html.encode()) > MAX_BYTES:
        add("error", "size", f"page is {len(html.encode()) / 1e6:.1f} MB; the limit is 16 MB")

    if re.search(r"<!doctype|<html[\s>]|<head[\s>]|<body[\s>]", html, re.I):
        add("error", "wrapper-tags", "remove <!doctype>/<html>/<head>/<body>: the publish skeleton supplies them")

    m = re.search(r"<title>(.*?)</title>", html[:8192], re.I | re.S)
    if not m or not m.group(1).strip():
        add("error", "no-title", "put a <title> in the first 8 KB: it names the artifact in the gallery")
    elif re.search(r":\s|\s[—–-]\s", m.group(1)):
        add("warn", "title-shape", f"title '{m.group(1).strip()}' carries an explainer; use a name only and put the explainer in the publish description")

    for src in re.findall(r"<script[^>]*\ssrc=[\"']([^\"']+)", html, re.I):
        _check_url(src, "script", issues)
    for body in re.findall(r"<script[^>]*type=[\"']importmap[\"'][^>]*>(.*?)</script>", html, re.I | re.S):
        try:
            imports = json.loads(body).get("imports", {})
        except json.JSONDecodeError as e:
            add("error", "importmap", f"import map is not valid JSON: {e}")
            imports = {}
        for url in imports.values():
            _check_url(url, "import map entry", issues)
    for body in re.findall(r"<script[^>]*type=[\"']module[\"'][^>]*>(.*?)</script>", html, re.I | re.S):
        for url in re.findall(r"(?:from\s*|import\s*\(\s*|import\s+)[\"'](https?://[^\"']+)", body):
            _check_url(url, "module import", issues)

    for tag in re.findall(r"<link[^>]+>", html, re.I):
        if re.search(r"rel=[\"']?stylesheet", tag, re.I):
            href = re.search(r"href=[\"']([^\"']+)", tag)
            if href and urlparse(href.group(1)).scheme in ("http", "https") and urlparse(href.group(1)).hostname not in STYLE_HOSTS:
                add("error", "style-host", f"stylesheet {href.group(1)} is blocked; only Google Fonts may be linked, inline other CSS")

    if "single-theme" not in html:
        if not re.search(r"prefers-color-scheme:\s*dark", html) or not re.search(r":root\[data-theme=[\"']?dark", html):
            add("error", "theme-blocks", "define dark tokens under @media (prefers-color-scheme: dark) :root:not([data-theme=light]) AND :root[data-theme=dark], or mark the page /* single-theme */")
    if not re.search(r"body\s*\{[^}]*background", html):
        add("error", "body-bg", "body needs an explicit token background; the viewer paints its own ground behind the page")

    has_sides = 'name="claude:viewport-fit-sides"' in html
    has_max = re.search(r"padding-left:\s*max\(\s*\d+px,\s*env\(safe-area-inset-left", html) and re.search(r"padding-right:\s*max\(\s*\d+px,\s*env\(safe-area-inset-right", html)
    if has_sides and not has_max:
        add("error", "viewport-sides", "the viewport-fit-sides meta promises max(16px, env(safe-area-inset-*)) side paddings; add both or drop the meta")
    if not has_sides:
        add("warn", "viewport-sides", 'add <meta name="claude:viewport-fit-sides" content="cover"> together with the max() side paddings')

    scripts = "\n".join(re.findall(r"<script[^>]*>(.*?)</script>", html, re.I | re.S))
    js = [body for attrs, body in re.findall(r"<script([^>]*)>(.*?)</script>", html, re.I | re.S)
          if not re.search(r"\btype=", attrs) or re.search(r"\btype=[\"']?(module|text/javascript|application/javascript)\b", attrs)]
    raw_js = "\n".join(js)
    code_only = "\n".join(_js_code_only(b) for b in js)  # each script alone, so one odd quote cannot hide the next; 'the 8k prompt (s)' is a label
    for pat, what in ((r"(?<![\w.])(?:window\.)?alert\s*\(", "alert()"), (r"(?<![\w.])(?:window\.)?confirm\s*\(", "confirm()"),
                      (r"(?<![\w.])(?:window\.)?prompt\s*\(", "prompt()"), (r"window\.print\s*\(", "window.print()")):
        if re.search(pat, code_only):
            add("error", "dead-api", f"{what} never shows in the viewer; build the step into the page")
        elif re.search(pat.replace(r"\s*\(", r"\("), raw_js):  # the scanner's guess may be wrong: say so instead of passing silently (prose has "prompt (s)")
            add("warn", "dead-api-text", f"{what} appears only inside a string, regex or comment; if it is a real call, it never shows in the viewer")
    if re.search(r"<a[^>]*\sdownload[\s>=]", html, re.I):
        add("error", "dead-api", "<a download> is inert for viewers; offer the content as copyable text instead")
    if re.search(r"<form[^>]*action=[\"']https?:", html, re.I):
        add("error", "dead-api", "a form action to another site has nowhere to go; handle submit in script")
    if re.search(r"window\.open\s*\(", scripts):
        add("warn", "window-open", "window.open returns null for most viewers; use a real <a href> link")
    if re.search(r"href=[\"'](?:mailto|tel|sms):", html, re.I):
        add("warn", "custom-scheme", "mailto:/tel: links often do nothing in an artifact; show the address as selectable text too")
    for url in re.findall(r"(?:fetch|EventSource|WebSocket)\s*\(\s*[\"'`](\w+://[^\"'`]+)", scripts):
        add("error", "external-fetch", f"{url}: the CSP blocks network calls to other hosts; embed the data")
    if re.search(r"<pre[^>]*class=[\"'][^\"']*mermaid", html):
        add("info", "mermaid", "mermaid blocks render only in the viewer, not in this local check")

    styles = "\n".join(re.findall(r"<style[^>]*>(.*?)</style>", html, re.I | re.S))
    rules = _strip_token_blocks(re.sub(r"/\*.*?\*/", "", styles, flags=re.S))
    lits = sorted(set(re.findall(r"#[0-9a-fA-F]{3,8}\b(?![\w-])", rules)))
    if lits:
        add("warn", "literal-color", f"literal colours in rules ({', '.join(lits[:6])}{'…' if len(lits) > 6 else ''}); use tokens so light and dark both hold")

    markup = re.sub(r"<(style|script)[^>]*>.*?</\1>", "", html, flags=re.I | re.S)
    issues += _check_prose(markup)
    if re.search(r'class="[^"]*\btex\b', markup) and not (re.search(r"katex(\.min)?\.js", html) and 'data-va="katex.css"' in html):
        add("error", "katex-missing", 'math uses .tex but the page lacks katex.min.js (cdnjs, pinned) or <style data-va="katex.css">')
    if re.search(r'class="[^"]*\b(math|eq)\b', markup):
        add("warn", "hand-math", 'math is hand-set (.math / .eq); write LaTeX in .tex and render it with KaTeX')
    is_plan = bool(re.search(r"<[^>]+\sdata-plan[\s>]", markup))
    issues += _check_teaching(markup)
    fmt = _page_format(markup)
    # kit.js names these calls in its own comments, so the format lints read only the page's scripts
    without_kit = re.sub(r"<script[^>]*\bdata-va\b[^>]*>.*?</script>", "", html, flags=re.I | re.S)
    own_scripts = "\n".join(re.findall(r"<script[^>]*>(.*?)</script>", without_kit, re.I | re.S))
    issues += _check_format(markup, own_scripts, fmt, is_plan)
    if is_plan:
        issues += _check_plan(markup) + _check_review(markup, html) + _check_task_code(markup)
    if 'class="docs' in markup:
        parts = re.split(r'(?=<section[^>]*class="[^"]*\bdoc-page\b)', markup)[1:]
        if parts and not re.search(r'class="[^"]*\b(fig|trace|latex|table|table-wrap)\b', parts[0]):
            add("warn", "no-map", "the first section has no figure; open with a map of the whole, or with a worked example, a table or the answers")
        for k, part in enumerate(parts):
            head = re.match(r"<section[^>]*>", part).group(0)
            sid = (re.search(r'\bid="([^"]+)"', head) or [None, "?"])[1]
            title = (re.search(r'data-title="([^"]+)"', head) or [None, sid])[1]
            if is_plan or k == 0 or 'data-check="none"' in head or re.search(r"source|reference|notes", title, re.I):
                continue
            if fmt[0] not in ("guide", "quick") and not re.search(r'class="[^"]*\bdecide\b|<details[^>]*class="[^"]*\bcheck\b', part):
                add("warn", "no-check", f"section #{sid} ({title}) ends without a check question; add a .decide (or mark data-check=\"none\")")
            if _words(part) > 220 and not _tags_with(part, "openq") and not re.search(r'<(svg|canvas|table|img)\b', part) and not any(
                    _tags_with(part, c) for c in ("fig", "codeblock", "pane-fig", "derive", "tex")):
                add("warn", "no-visual", f"section #{sid} ({title}) is {_words(part)} words with no figure, chart or table; pick a representation for its main idea")
    for tag in re.findall(r"<(?:input|select|textarea)\b[^>]*>", markup, re.I):
        if not re.search(r"\sid=", tag) and 'type="hidden"' not in tag:
            add("warn", "control-id", "give every form control a stable id (the platform restores values across republish)")
            break
    return issues


def _js_code_only(src: str) -> str:
    """The script with strings, template text, regex literals and comments blanked; ${...} inside templates stays code."""
    out, i, n, stack = [], 0, len(src), []  # stack: brace depth at each open ${
    prev = ""  # last significant code character, to tell a regex from a division
    while i < n:
        c = src[i]
        if stack and c == "}" and stack[-1] == 0:
            stack.pop(); i += 1; i = _skip_template(src, i, out, stack); prev = "{" if out[-1].endswith("${") else "'"; continue
        if c in "'\"":
            j = i + 1
            while j < n and src[j] != c and src[j] != "\n":
                j += 2 if src[j] == "\\" else 1
            out.append("''"); i = j + 1; prev = "'"; continue
        if c == "`":
            i = _skip_template(src, i + 1, out, stack); prev = "{" if out[-1].endswith("${") else "'"; continue
        if src.startswith("//", i):
            j = src.find("\n", i); i = n if j < 0 else j; continue
        if src.startswith("/*", i):
            j = src.find("*/", i + 2); i = n if j < 0 else j + 2; continue
        if c == "/" and _regex_may_start(out, prev):
            j, cls = i + 1, False
            while j < n and src[j] != "\n" and (src[j] != "/" or cls):
                if src[j] == "\\": j += 1
                elif src[j] == "[": cls = True
                elif src[j] == "]": cls = False
                j += 1
            out.append("/r/"); i = j + 1; prev = "/"; continue
        if stack:
            if c == "{": stack[-1] += 1
            elif c == "}": stack[-1] -= 1
        out.append(c)
        if not c.isspace(): prev = c if not (c.isalnum() or c in "_$") else "a"
        i += 1
    return "".join(out)


_REGEX_AFTER = {"return", "typeof", "void", "case", "await", "in", "of", "delete", "instanceof", "new", "throw", "yield", "do", "else"}


def _regex_may_start(out: list, prev: str) -> bool:
    """A / starts a regex after an operator, an opening bracket or a keyword; after a value it divides."""
    tail = "".join(out[-24:]).rstrip()
    if tail.endswith(("++", "--")):
        return False
    if prev == "a":
        m = re.search(r"[A-Za-z_$][\w$]*$", tail)
        return bool(m) and m.group(0) in _REGEX_AFTER
    return prev == "" or prev in "(,=:[!&|?{};+-*%<>~^"


def _skip_template(src: str, i: int, out: list, stack: list) -> int:
    """Skip template text from i up to the closing backtick or the next ${, which opens code."""
    n = len(src)
    while i < n:
        if src[i] == "\\": i += 2; continue
        if src[i] == "`": out.append("``"); return i + 1
        if src.startswith("${", i): stack.append(0); out.append("`${"); return i + 2
        i += 1
    return n


def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", fragment)).strip()


def _words(fragment: str) -> int:
    return len(_text(fragment).split())


def _class_tags(markup: str, cls: str, tag: str = r"\w+"):
    """Yield (start offset, attributes) for every <tag> whose class list holds cls; either quote style."""
    for m in re.finditer(rf"<({tag})\b([^>]*)>", markup, re.I):
        attrs = {k: v1 or v2 for k, v1, v2 in re.findall(r"""([\w:-]+)=(?:"([^"]*)"|'([^']*)')""", m.group(2))}
        if cls in attrs.get("class", "").split():
            yield m.start(), attrs


def _tags_with(markup: str, cls: str) -> bool:
    return next(_class_tags(markup, cls), None) is not None


def _element_body(markup: str, at: int, tag: str) -> str:
    """The inside of the <tag> opening at offset at, counting nested tags of the same name."""
    start = markup.index(">", at) + 1
    depth = 1
    for m in re.compile(rf"<(/?){tag}\b[^>]*>", re.I).finditer(markup, start):
        depth += -1 if m.group(1) else 1
        if depth == 0:
            return markup[start:m.start()]
    return markup[start:]


def _check_teaching(markup: str) -> list[Issue]:
    """Lints from Sean's 2026-10-27 review: code without colour, prose-only 'Go deeper' blocks, check questions
    whose answer is easy to spot by length or position."""
    out: list[Issue] = []
    for m in re.finditer(r"<pre\b([^>]*)>(.*?)</pre>", markup, re.I | re.S):
        attrs, inner = m.group(1), m.group(2)
        if "code-src" in attrs or "mermaid" in attrs:
            continue
        if inner.strip().count("\n") >= 2:
            out.append(Issue("warn", "code-plain", "code in a plain <pre> gets no syntax colour or line numbers; put it in figure.codeblock > pre.code-src"))
            break
    for at, _ in _class_tags(markup, "deeper", tag="details"):
        body = _element_body(markup, at, "details")
        if _words(body) > 50 and not re.search(r'<(svg|canvas|table|figure)\b|class="[^"]*\btex\b', body):
            summ = _text((re.search(r"<summary[^>]*>(.*?)</summary>", body, re.S) or [None, "?"])[1])[:60]
            out.append(Issue("warn", "deeper-prose", f"'Go deeper' block '{summ}' is prose only; turn its cases into scenarios on the figure, or give it a diagram"))
    positions = []
    heads = list(_class_tags(markup, "decide"))
    for k, (at, attrs) in enumerate(heads):
        block = markup[at: heads[k + 1][0] if k + 1 < len(heads) else len(markup)]
        opts = re.findall(r'<button[^>]*data-choice=["\']([^"\']+)["\'][^>]*>(.*?)</button>', block, re.S)
        a = attrs.get("data-answer")
        if not a or len(opts) < 2:
            continue
        lens = {c: len(_text(t)) for c, t in opts}
        if a in lens:
            positions.append([c for c, _ in opts].index(a))
            others = [v for c, v in lens.items() if c != a]
            if len(opts) >= 3 and others and lens[a] > 1.35 * max(others):
                q = _text((re.search(r'class=["\']decide-q["\'][^>]*>(.*?)</p>', block, re.S) or [None, "?"])[1])[:60]
                out.append(Issue("warn", "options-uneven", f"the answer to '{q}' is much longer than every other option; make the options the same length and shape"))
    if len(positions) >= 4:
        top = max(positions.count(k) for k in set(positions))
        if top / len(positions) >= 0.6:
            out.append(Issue("warn", "answer-position", f"{top} of {len(positions)} check questions put the answer in the same position; vary it"))
    return out


FORMATS = ("quick", "guide", "learn", "explorable", "prototype")
QUICK_LIMITS = {"concept": (150, 1), "landscape": (400, 3)}  # words, screens
QUICK_SCREEN = 900  # px: the height render() gives a page at laptop width
# A structural fact (a control, hidden text) is an error. A wording guess only warns: "Exercise 3" is a homework
# label and "Predict the next token" is a statement, so wording must never block a page.
_PROMPTS = re.compile(r">\s*(try first|try it yourself|quick check\s*:|check question|check yourself|test yourself|your call\s*:|what do you think|make a prediction|pause and think)|<h[1-6]\b[^>]*>\s*(drills?\b)", re.I)
_MAYBE_PROMPT = re.compile(r"\bpredict (?:the|what|which|how)\b|\bexercise\s*(?:\d+|:)|\bbefore you read on\b|\btry this yourself\b|\bpractice (?:problems?|questions?)\b", re.I)
_FRAME_CONTROL = re.compile(r"""<[a-z][^>]*(?:class=["'][^"']*\bstepper-ctl\b|\sdata-(?:next|prev|play)(?=[\s=>/]))""", re.I)
_RENDER_CODES = {"format-question", "format-collapsed", "quick-long"}  # what a page's script can add after load


def _meta(markup: str, name: str) -> str | None:
    for tag in re.findall(r"<meta\b[^>]*>", re.sub(r"<!--.*?-->", "", markup, flags=re.S), re.I):
        attrs = {k.lower(): v1 or v2 or v3 for k, v1, v2, v3 in re.findall(r"""([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""", tag)}
        if attrs.get("name") == f"va:{name}":
            return attrs.get("content")
    return None


def _page_format(markup: str) -> tuple[str | None, str | None]:
    return _meta(markup, "format"), _meta(markup, "size")


def _framed_figures(markup: str) -> list[str]:
    """The inside of each figure, <figure> or .fig, that holds a frame control."""
    bodies = []
    for at, _ in _class_tags(markup, "fig", tag="figure|div"):
        body = _element_body(markup, at, re.match(r"<(\w+)", markup[at:]).group(1))
        if _FRAME_CONTROL.search(body):
            bodies.append(body)
    for m in re.finditer(r"<figure\b", markup, re.I):
        body = _element_body(markup, m.start(), "figure")
        if _FRAME_CONTROL.search(body):
            bodies.append(body)
    return bodies


def _count_words(text: str) -> int:
    """Latin words, plus two CJK characters as one word, so a Chinese page has the same limit."""
    cjk = len(re.findall(r"[㐀-鿿豈-﫿]", text))
    return len(re.sub(r"[㐀-鿿豈-﫿]", " ", text).split()) + cjk // 2


def _no_math(html: str) -> str:
    """Drop LaTeX source, in either element the docs teach (span or div)."""
    return re.sub(r"""<(span|div)\b[^>]*class=["'][^"']*\btex\b[^"']*["'][^>]*>.*?</\1>""", " ", html, flags=re.I | re.S)


def _reader_text(visible: str) -> str:
    """Words written for the reader: no code, math or diagram text."""
    return _text(_no_math(re.sub(r"<(pre|code|svg)\b.*?</\1>", " ", visible, flags=re.I | re.S)))


def _redrawn_matrix(visible: str) -> bool:
    """Three display equations in a row that repeat most of one matrix: the page redraws instead of calculating.

    A row operation leaves other rows alone, so a redraw shares rows with the display before it. Different
    matrices of one size (Cramer's A_x and A_y, separate minors) do not.
    """
    for at, _ in _class_tags(visible, "latex", tag="div"):
        run, last = 0, None
        for eq in re.findall(r"""class=["']tex display["'][^>]*>(.*?)</(?:span|div)>""", _element_body(visible, at, "div"), re.S):
            bodies = re.findall(r"\\begin\{(?:[vbpV]matrix|array)\}(?:\{[^}]*\})?(.*?)\\end\{(?:[vbpV]matrix|array)\}", eq, re.S)
            rows = [re.sub(r"\s+", "", r) for r in bodies[-1].split("\\\\")] if bodies else None
            if not rows or "&" not in rows[0]:
                run, last = 0, None
                continue
            shared = last is not None and len(last) == len(rows) and 2 * sum(x == y for x, y in zip(last, rows)) >= len(rows)
            run, last = (run + 1 if shared else 1), rows
            if run >= 3:
                return True
    return False


def _check_format(markup: str, scripts: str, fmt: tuple[str | None, str | None], is_plan: bool) -> list[Issue]:
    """The request picks the format, and the page keeps to it: a guide or quick page only tells; only learn asks."""
    out: list[Issue] = []
    name, size = fmt
    visible = re.sub(r"<!--.*?-->|<title[^>]*>.*?</title>", "", markup, flags=re.S | re.I)
    if (re.search(r"""data-value=["']skim["']|<button\b[^>]*>(?:\s|<[^>]+>)*Skim(?:\s|<[^>]+>)*</button>""", visible, re.I)
            or re.search(r"""data-value=["'](read|deep)["'](?:(?!</div>|</nav>).){0,400}?data-value=["'](?!\1)(read|deep)["']""", visible, re.I | re.S)) or re.search(r"\bKit\.depth\s*\(", scripts):
        out.append(Issue("error", "depth-tabs", "remove the Skim / Read / Deep control; the request picks the depth before the page is built"))
    if name is None:
        if not is_plan:
            out.append(Issue("warn", "no-format", 'declare the format the request asked for: <meta name="va:format" content="quick|guide|learn|explorable|prototype">'))
        return out
    if name not in FORMATS:
        out.append(Issue("error", "format-unknown", f"va:format is '{name}'; use one of {', '.join(FORMATS)}"))
        return out
    sections = sum(1 for _ in _class_tags(visible, "doc-page"))
    if name in ("explorable", "prototype"):
        if sections >= 3:
            out.append(Issue("warn", "format-mismatch", f"a page with {sections} reading sections is a guide or a lesson; declare guide or learn, not {name}"))
        return out
    framed = [f for f in _framed_figures(visible) if _tags_with(f, "tex")]
    if name in ("guide", "learn") and _redrawn_matrix(visible):
        out.append(Issue("warn", "math-redraw", "a matrix is redrawn for each operation; write the operation as one line of working, and redraw only at checkpoints"))
    if name == "learn":
        if framed:
            out.append(Issue("warn", "math-framed", "math sits in a stepper; write every step open in a .latex block"))
        if _tags_with(visible, "derive"):
            out.append(Issue("warn", "math-not-latex", "math reads like a paper in every format; replace the numbered .derive list with a .latex block"))
        for at, _ in _class_tags(visible, "deeper", tag="details"):
            body = _element_body(visible, at, "details")
            if _tags_with(body, "derive") or _tags_with(body, "latex"):
                out.append(Issue("warn", "math-collapsed", "a derivation sits in a collapsed block; write it open in a .latex block"))
                break
        return out
    prompt = _PROMPTS.search(visible)
    if (_tags_with(visible, "decide") or _tags_with(visible, "after-decide") or _tags_with(visible, "openq")
            or re.search(r"""<details[^>]*class=["'][^"']*\bcheck\b|\bdata-gate\b""", visible) or re.search(r"\bKit\.openQuestions\s*\(", scripts) or prompt):
        what = f"'{prompt.group(1) or prompt.group(2)}'" if prompt else "a question, gate or open question"
        out.append(Issue("error", "format-question", f"a {name} page only tells, and it holds {what}; move drills to a learn page"))
    if _MAYBE_PROMPT.search(_reader_text(visible)):
        out.append(Issue("warn", "format-prompt", f"this wording may ask the reader to do something; a {name} page only tells"))
    if re.search(r"""[?？]["'”’)]*(\s|$)""", _reader_text(visible)):
        out.append(Issue("warn", "format-rhetorical", f"a {name} page states things; rewrite questions as statements"))
    if "<details" in visible:
        out.append(Issue("error", "format-collapsed", f"a {name} page keeps all of its content open; remove <details>"))
    if _tags_with(visible, "derive"):
        out.append(Issue("error", "math-not-latex", f"a {name} page writes math like a paper; replace the numbered .derive list with a .latex block"))
    if framed:
        out.append(Issue("error", "math-framed", "math sits in a stepper; write every step open in a .latex block"))
    elif _FRAME_CONTROL.search(visible) or re.search(r"\bKit\.(?:stepper|scenarios)\s*\(", scripts):
        out.append(Issue("error", "format-stepper", f"a {name} page shows every state open; remove the frames. Only code may play, in Kit.trace"))
    if name == "guide" and _tags_with(visible, "codeblock") and not _tags_with(visible, "trace"):
        out.append(Issue("warn", "code-no-state", "if this code runs an algorithm, play it beside the example's real state with Kit.trace; a config or API block can stay"))
    if name == "quick":
        limit = QUICK_LIMITS.get(size or "concept")
        words = _count_words(_text(_no_math(visible)))
        if limit is None:
            out.append(Issue("error", "format-unknown", f"va:size is '{size}'; use one of {', '.join(QUICK_LIMITS)}"))
        elif words > limit[0]:
            out.append(Issue("error", "quick-long", f"a quick {size or 'concept'} page has {words} words; the limit is {limit[0]}"))
    return out


def _tags(markup: str, cls: str):
    """Yield (start offset, attributes) for every tag whose class list holds cls."""
    return _class_tags(markup, cls)


def _check_plan(markup: str) -> list[Issue]:
    """Plan pages link tasks, map blocks and files by id. A dangling id or a cycle breaks the links silently."""
    out: list[Issue] = []
    blocks = {a["data-blk"] for _, a in _tags(markup, "blk") if "data-blk" in a}
    tasks = [(at, a) for at, a in _tags(markup, "task") if "data-task" in a]
    ids = {a["data-task"] for _, a in tasks}
    split = lambda v: [x.strip() for x in v.split(",") if x.strip()]
    deps = {a["data-task"]: split(a.get("data-deps", "")) for _, a in tasks}
    for k, (at, a) in enumerate(tasks):
        n = a["data-task"]
        for b in split(a.get("data-touches", "")):
            if b not in blocks:
                out.append(Issue("error", "plan-dangling", f"task {n} touches '{b}', but no .blk on the map has data-blk=\"{b}\""))
        for d in deps[n]:
            if d not in ids:
                out.append(Issue("error", "plan-dangling", f"task {n} depends on task {d}, which does not exist"))
        body = markup[at : tasks[k + 1][0] if k + 1 < len(tasks) else len(markup)]
        missing = [p for p in ("test", "verify") if not re.search(rf'data-part=["\']{p}["\']', body)]
        if missing:
            out.append(Issue("warn", "plan-task-incomplete", f"task {n} has no {' and no '.join(missing)} row; each task names its failing test and its verify command"))
    for _, a in _tags(markup, "file"):
        if a.get("data-blk") and a["data-blk"] not in blocks:
            out.append(Issue("error", "plan-dangling", f"file row points at block '{a['data-blk']}', which is not on the map"))
    state: dict[str, int] = {}

    def cyclic(n: str) -> bool:
        if state.get(n) == 1:
            return True
        if state.get(n) == 2 or n not in deps:
            return False
        state[n] = 1
        hit = any(cyclic(d) for d in deps[n])
        state[n] = 2
        return hit

    loops = sorted(n for n in deps if (state.clear() or cyclic(n)))
    if loops:
        out.append(Issue("error", "plan-cycle", f"task dependencies form a cycle (through tasks {', '.join(loops)}); a plan must be orderable"))
    return out



class _Node:
    __slots__ = ("tag", "attrs", "kids", "up")

    def __init__(self, tag, attrs, up):
        self.tag, self.attrs, self.kids, self.up = tag, attrs, [], up

    @property
    def cls(self) -> list[str]:
        return (self.attrs.get("class") or "").split()

    def text(self) -> str:
        return "".join(k if isinstance(k, str) else k.text() for k in self.kids)

    def walk(self):
        for k in self.kids:
            if isinstance(k, _Node):
                yield k
                yield from k.walk()

    def find(self, cls: str):
        return [n for n in self.walk() if cls in n.cls]


VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}


def _dom(markup: str) -> _Node:
    """A forgiving tree of the markup: enough to ask which claim holds which exhibit."""
    from html.parser import HTMLParser

    root = _Node("#root", {}, None)

    class Build(HTMLParser):
        cur = root

        def handle_starttag(self, tag, attrs):
            n = _Node(tag, {k: v or "" for k, v in attrs}, self.cur)
            self.cur.kids.append(n)
            if tag not in VOID:
                self.cur = n

        def handle_startendtag(self, tag, attrs):
            self.cur.kids.append(_Node(tag, {k: v or "" for k, v in attrs}, self.cur))

        def handle_endtag(self, tag):
            n = self.cur
            while n is not root and n.tag != tag:
                n = n.up
            if n is not root:
                self.cur = n.up

        def handle_data(self, data):
            self.cur.kids.append(data)

    Build(convert_charrefs=True).feed(markup)
    return root


EXHIBIT = {"fig", "table-wrap", "code-src"}


def _shown_lines(pre: _Node) -> tuple[set[int], set[int]]:
    """(new or plain line numbers, old line numbers) that a code block shows."""
    lines = pre.text().rstrip("\n").split("\n")
    first = int(pre.attrs.get("data-start") or (re.match(r"\d+", pre.attrs.get("data-lines", "")) or [1])[0])
    if "data-diff" not in pre.attrs:
        return set(range(first, first + len(lines))), set()
    new, old, o, n = set(), set(), first, first
    for t in lines:
        h = re.match(r"@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@", t)
        if h:
            o, n = int(h.group(1)), int(h.group(2))
        elif t.startswith("+"):
            new.add(n); n += 1
        elif t.startswith("-"):
            old.add(o); o += 1
        else:
            new.add(n); old.add(o); n += 1; o += 1
    return new, old


def _check_review(markup: str, html: str) -> list[Issue]:
    """Claims, open decisions, code blocks and call trees: the shape html-plan enforces, in our markup."""
    out: list[Issue] = []
    root = _dom(markup)
    claims = root.find("claim")
    parent = {id(c): next((a for a in _ups(c, None) if "claim" in a.cls), None) for c in claims}
    level = {}
    for c in claims:
        p = parent[id(c)]
        level[id(c)] = level.get(id(p), 0) + 1 if p else 1
    for c in claims:
        head = next((n for n in c.walk() if "claim-text" in n.cls), None)
        text = re.sub(r"\s+", " ", head.text()).strip() if head else ""
        name = f"claim “{text[:48]}”"
        if "data-at" not in c.attrs and (not re.search(r"[.!?]$", text) or len(text.split()) > 14):
            out.append(Issue("warn", "plan-claim-sentence", f"{name} must be one sentence that can be true or false, 14 words at most, ending with a full stop"))

        def own(n):  # direct content of this claim, not inside its fold or child claims
            for k in n.kids:
                if isinstance(k, _Node) and not ({"claim", "deeper"} & set(k.cls)) and k.tag != "details":
                    yield k
                    yield from own(k)

        exhibits = [n for n in own(c) if EXHIBIT & set(n.cls) and not any(EXHIBIT & set(a.cls) for a in _ups(n, c))]
        if len(exhibits) != 1:
            out.append(Issue("warn", "plan-claim-exhibit", f"{name} has {len(exhibits)} exhibits; give each claim exactly one (a second exhibit is a second claim)"))
        kids = [k for k in claims if parent[id(k)] is c]
        if len(kids) > 5:
            out.append(Issue("warn", "plan-claim-shape", f"{name} has {len(kids)} child claims; keep it to 5"))
        if level[id(c)] == 4:
            out.append(Issue("warn", "plan-claim-shape", f"{name} sits at level 4; claims go 3 levels deep at most (what, how, where)"))

    asks = root.find("ask")
    if len(asks) > 5:
        out.append(Issue("warn", "plan-ask-many", f"{len(asks)} open decisions; ask only about forks that change what you build (2 to 5)"))
    owner: dict[str, str] = {}
    for a in asks:
        qid = a.attrs.get("data-ask") or "?"
        inputs = [n for n in a.walk() if n.tag == "input" and n.attrs.get("type") in ("radio", "checkbox")]
        if inputs and not any("checked" in n.attrs for n in inputs):
            out.append(Issue("error", "plan-ask-default", f"decision {qid} has no suggested option; mark your pick with checked"))
        for name in {n.attrs.get("name", "") for n in inputs}:
            if name in owner and owner[name] != qid:
                out.append(Issue("error", "plan-ask-name", f"decisions {owner[name]} and {qid} share the control name '{name}'; names must be unique"))
            owner.setdefault(name, qid)

    mapped = {next((n for n in f.walk() if n.tag == "code"), f).text().strip() for f in root.find("file")}
    for pre in root.find("code-src"):
        a = pre.attrs
        path = a.get("data-src") or a.get("data-file")
        if mapped and path and path not in mapped:
            out.append(Issue("warn", "plan-code-file", f"code for {path} names a file the file map does not list, so the Files page cannot show it; add a .file row or fix the path"))
        if "data-src" in a and not pre.text().strip():
            out.append(Issue("error", "plan-code-empty", f"code from {a['data-src']} was never filled; run assemble.py --root <repo>"))
        if not ({"data-src", "data-sketch", "data-diff"} & set(a)):
            out.append(Issue("warn", "plan-code-unmarked", "a code block is neither cited (data-src + data-lines), a sketch (data-sketch) nor a diff (data-diff)"))
    for fig in root.find("codeblock"):
        pre = next(iter(fig.find("code-src")), None)
        if pre is None or not pre.text().strip():
            continue
        new, old = _shown_lines(pre)
        for li in fig.find("code-pins"):
            for pin in (k for k in li.kids if isinstance(k, _Node) and k.tag == "li"):
                if "data-old" in pin.attrs and int(pin.attrs["data-old"] or 0) not in old:
                    out.append(Issue("error", "plan-pin-line", f"a pin points at old line {pin.attrs['data-old']}, which the block does not show"))
                elif "data-line" in pin.attrs and int(pin.attrs["data-line"] or 0) not in new:
                    out.append(Issue("error", "plan-pin-line", f"a pin points at line {pin.attrs['data-line']}, which the block does not show"))

    for body in re.findall(r'<figure[^>]*class="[^"]*\bcalls\b[^"]*"[^>]*>\s*<script type="text/plain"[^>]*>(.*?)</script>', html, re.S):
        for line in body.split("\n"):
            if not line.strip():
                continue
            if line[0] not in "+-~? ":
                out.append(Issue("error", "plan-calls-mark", f"call row '{line.strip()[:48]}' starts with '{line[0]}'; column 0 is + - ~ ? or a space"))
            elif line[0] != " " and not re.search(r"\s@\s*\S+:\d+", line):
                out.append(Issue("warn", "plan-calls-place", f"call row '{line.strip()[:48]}' has no @ path:line; every marked row names its place"))
    return out


TASK_CODE_MAX = 30  # lines in one task's Key change: the important sections, not whole files


def _check_task_code(markup: str) -> list[Issue]:
    """A task's Key change row: present when the task adds or changes a file, short, and naming only real code blocks."""
    out: list[Issue] = []
    root = _dom(markup)
    kind = {next((n for n in f.walk() if n.tag == "code"), f).text().strip(): f.attrs.get("data-change", "") for f in root.find("file")}
    by_id = {n.attrs["id"]: n for n in root.walk() if n.attrs.get("id")}
    for t in root.find("task"):
        n = t.attrs.get("data-task")
        if n is None:
            continue
        dds = [d for d in t.walk() if d.tag == "dd"]
        files = [c.text().strip() for d in dds if d.attrs.get("data-part") == "files" for c in d.walk() if c.tag == "code"]
        key = next((d for d in dds if d.attrs.get("data-part") == "code"), None)
        refs = [x.strip() for x in (key.attrs.get("data-code", "") if key else "").split(",") if x.strip()]
        figs = key.find("codeblock") if key else []
        if not figs and not refs:
            touched = [f for f in files if kind.get(f) in ("new", "changed")]
            if touched:
                out.append(Issue("warn", "plan-task-code", f"task {n} adds or changes {touched[0]} but shows no Key change; add a dd[data-part=\"code\"] row with the sections that carry the change"))
            continue
        for ref in refs:
            fig = by_id.get(ref)
            if fig is None or "codeblock" not in fig.cls:
                out.append(Issue("error", "plan-code-ref", f"task {n}'s Key change names '{ref}', which is not the id of a code block (figure.fig.codeblock)"))
            else:
                figs.append(fig)
        lines = sum(len(p.text().strip("\n").split("\n")) for f in figs for p in f.find("code-src"))
        if lines > TASK_CODE_MAX:
            out.append(Issue("warn", "plan-task-code-long", f"task {n}'s Key change shows {lines} lines; keep the important sections, {TASK_CODE_MAX} lines at most, not whole files"))
    return out


def _ups(n: _Node, stop: _Node):
    a = n.up
    while a is not None and a is not stop:
        yield a
        a = a.up

HYPE = ("robust", "seamless", "powerful", "comprehensive", "leverage", "delve", "crucial", "vital", "elevate", "unlock",
        "cutting-edge", "game-changing", "effortless")
# Characters that exist only in Simplified Chinese (their Traditional forms differ), common in technical prose.
SIMPLIFIED_ONLY = "们这说为会对发进过实现种么样还与关门问题应该让给习学书页图数据线网络设计统项处运测试错误输开环变调类参结构层级节点时间东车长马见风飞吗两从个来"
_PROSE_CLASS = re.compile(r'class="[^"]*\b(prose|takeaway|lede|fig-cap|rung-text|script|callout|tour-text|qa|decide-q|decide-why|claim-text|ask-q)\b')


def _prose_text(markup: str) -> str:
    """Text of the reader-facing prose blocks, one block per line."""
    from html.parser import HTMLParser

    class Grab(HTMLParser):
        def __init__(self):
            super().__init__()
            self.stack, self.out = [], []

        def handle_starttag(self, tag, attrs):
            if tag in ("br", "img", "input", "meta", "link", "hr", "wbr"):
                return
            cls = dict(attrs).get("class") or ""
            self.stack.append(bool(_PROSE_CLASS.search(f'class="{cls}"')))

        def handle_endtag(self, tag):
            if tag in ("br", "img", "input", "meta", "link", "hr", "wbr"):
                return
            if self.stack:
                self.stack.pop()
            if tag in ("p", "li", "div", "figcaption") and self.out and not self.out[-1].endswith("\n"):
                self.out.append("\n")

        def handle_data(self, data):
            if any(self.stack):
                self.out.append(data)

    g = Grab()
    g.feed(markup)
    return re.sub(r"[ \t]+", " ", "".join(g.out))


def _check_prose(markup: str) -> list[Issue]:
    """About 60% of ASD-STE100: short sentences, one idea each, no hype words."""
    out: list[Issue] = []
    text = _prose_text(markup)
    hype = sorted({w for w in HYPE if re.search(rf"\b{re.escape(w)}\b", text, re.I)})
    if hype:
        out.append(Issue("warn", "hype", f"hype words in prose: {', '.join(hype)}"))
    letters = re.findall(r"\w", text)
    if letters and len(re.findall(r"[㐀-鿿]", text)) / len(letters) > 0.3:
        found = sorted(set(re.findall(f"[{SIMPLIFIED_ONLY}]", text)))
        if len(found) >= 2:
            out.append(Issue("warn", "zh-simplified", f"Simplified Chinese characters ({''.join(found[:12])}); write Traditional Chinese (zh-TW)"))
        return out  # Chinese prose: sentence length in words does not apply
    if not letters:
        return out
    sents = [s.strip() for line in text.split("\n") for s in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"(“])", line) if len(s.split()) >= 3]
    if len(sents) < 3:
        return out
    long20 = [s for s in sents if len(s.split()) > 20]
    worst = max(sents, key=lambda s: len(s.split()))
    if len(long20) / len(sents) > 0.15 or len(worst.split()) > 32:
        out.append(Issue("warn", "prose-long", f"{len(long20)}/{len(sents)} sentences run past 20 words (STE target: most ≤ 20, none past 25–30); "
                                               f"longest ({len(worst.split())} words): {worst[:140]}…"))
    chained = [s for s in sents if ";" in s or " — " in s]
    if len(chained) / len(sents) > 0.15:
        out.append(Issue("warn", "prose-chained", f"{len(chained)}/{len(sents)} sentences chain clauses with ';' or '—'; split them, one idea per sentence"))
    return out


# ── render ──────────────────────────────────────────────────────────────────

_PROBE = r"""
async () => {
  const vw = window.innerWidth;
  const doc = document.documentElement;
  const overflow = doc.scrollWidth - vw;
  const off = [];
  if (overflow > 1) {
    const clipped = el => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) return true; } return false; };
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > vw + 1 && !clipped(el)) {
        const id = el.id ? '#' + el.id : '';
        const cls = el.classList.length ? '.' + Array.from(el.classList).slice(0, 2).join('.') : '';
        off.push(`${el.tagName.toLowerCase()}${id}${cls} (right ${Math.round(r.right)}px)`);
        if (off.length >= 5) break;
      }
    }
  }
  // The first family of every font stack is the face the design asked for. fonts.check() says true for
  // a family with no @font-face at all, so measure instead: a face that renders exactly like both
  // monospace and serif fallbacks is not there.
  const firsts = new Set();
  const first = v => v && firsts.add(v.split(',')[0].trim().replace(/^["']|["']$/g, ''));
  for (const sheet of Array.from(document.styleSheets)) {
    let rules; try { rules = sheet.cssRules; } catch (e) { continue; }
    const walk = list => { for (const r of Array.from(list || [])) {
      if (r.cssRules) walk(r.cssRules);
      if (!r.style || r.type === 5) continue; // skip @font-face descriptors
      first(r.style.getPropertyValue('font-family'));
      const fv = r.style.getPropertyValue('font'); if (fv && !fv.includes('var(')) first(fv.replace(/^.*?\d[\d.]*(px|rem|em|%)(\s*\/\s*[\d.]+[a-z%]*)?\s+/, ''));
      for (let k = 0; k < r.style.length; k++) { const n = r.style[k]; if (n.startsWith('--font')) first(r.style.getPropertyValue(n)); }
    } };
    walk(rules);
  }
  const generic = /^(serif|sans-serif|monospace|system-ui|cursive|fantasy|emoji|math|ui-[a-z-]+|-apple-system|inherit|initial|unset|var\(.*|)$/i;
  const wanted = [...firsts].filter(f => !generic.test(f));
  await document.fonts.ready;
  await Promise.all(wanted.map(f => document.fonts.load(`16px "${f}"`).catch(() => null)));
  const ctx = document.createElement('canvas').getContext('2d');
  const w = font => { ctx.font = font; return ctx.measureText('mmmmmmmmmmlli1WQ@#&Rg').width; };
  // A family declared with @font-face counts as present once a face has loaded (symbol-only fonts such as
  // KaTeX_Size1 have no letters to measure). A family with no @font-face is measured against the fallbacks.
  const faces = fam => [...document.fonts].filter(ff => ff.family.replace(/^["']|["']$/g, '') === fam);
  const missing = wanted.filter(f => {
    const ff = faces(f);
    if (ff.length) return !ff.some(x => x.status === 'loaded');
    return w(`16px "${f}", monospace`) === w('16px monospace') && w(`16px "${f}", serif`) === w('16px serif');
  });
  return { overflow, off, missing, title: document.title };
}
"""


_HIDDEN_TEXT = """() => [...document.body.querySelectorAll('*')].filter(e => {
  if (e.closest('nav, .docs-side, .docs-rail, button, label, select, datalist, rp, script, style, template, title, noscript, svg, .katex, .code-pins, .popover, .scrim')) return false;
  if (!e.textContent.trim() || e.parentElement.closest('[hidden]')) return false;
  const c = getComputedStyle(e);
  return c.display === 'none' || c.visibility === 'hidden' || +c.opacity === 0 || c.contentVisibility === 'hidden'
    || (c.display !== 'inline' && c.overflowY !== 'visible' && e.clientHeight === 0);
}).map(e => e.textContent.trim().slice(0, 40))"""
_TALLEST = """() => Math.max(document.documentElement.scrollHeight, ...[...document.body.querySelectorAll('*')]
  .filter(e => getComputedStyle(e).overflowY !== 'visible' && e.scrollHeight > e.clientHeight + 1).map(e => e.scrollHeight))"""
_NO_MATH_DOM = """() => { const c = document.body.cloneNode(true); c.querySelectorAll('.katex, style, script').forEach(e => e.remove()); return c.innerHTML; }"""
_CLIPPED_MATH = """() => [...document.querySelectorAll('.latex .tex.display')].filter(e => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1).length"""
_CLIPPED_ANSWER = """() => [...document.querySelectorAll('.latex .answer .tex.display')].filter(e => e.scrollWidth > e.clientWidth + 1).length"""
_TRACE_SPLIT = """() => [...document.querySelectorAll('.trace-split')].some(r => {
  const c = r.querySelector('.trace-code'), s = r.querySelector('.trace-state');
  if (!c || !s) return true;
  const a = c.getBoundingClientRect(), b = s.getBoundingClientRect();
  return !(a.top < b.bottom && b.top < a.bottom && a.right <= b.left + 1);
})"""
# A grid or flex container makes each loose text run and each child its own item, so a sentence written
# straight into it ("runs <code>sm team</code> to …") splits into cells: the code lands in the number
# column and breaks one word per line. Flag a container that holds both loose text and classless inline
# markup. A classed child is a badge or an icon (.claim-num, .call-mark) and an svg is an icon; both are fine.
# So is a child the CSS places on purpose (order, flex-basis, a grid line), like .ask > label > small.
_SPLIT_TEXT = """() => {
  const INLINE = new Set(['A', 'ABBR', 'B', 'CITE', 'CODE', 'DATA', 'DFN', 'EM', 'I', 'KBD', 'MARK', 'Q', 'S', 'SAMP', 'SMALL', 'STRONG', 'SUB', 'SUP', 'TIME', 'U', 'VAR']);
  const placed = n => { const c = getComputedStyle(n);
    return c.order !== '0' || c.flexBasis !== 'auto' || c.gridColumnStart !== 'auto' || c.gridColumnEnd !== 'auto' || c.gridRowStart !== 'auto'; };
  const out = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (el.closest('svg, pre, .katex, script, style, template')) continue;
    if (!/(grid|flex)$/.test(getComputedStyle(el).display)) continue;
    const kids = [...el.childNodes];
    const text = kids.find(n => n.nodeType === 3 && n.textContent.trim());
    const tag = text && kids.find(n => n.nodeType === 1 && INLINE.has(n.tagName) && !n.hasAttribute('class') && !placed(n));
    if (!tag) continue;
    const cls = el.classList.length ? '.' + [...el.classList].slice(0, 2).join('.') : '';
    out.push(`${el.tagName.toLowerCase()}${cls} splits '${el.textContent.replace(/\\s+/g, ' ').trim().slice(0, 50)}' at its <${tag.tagName.toLowerCase()}>`);
    if (out.length >= 3) break;
  }
  return out;
}"""


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def guess_type(self, path):
        t = super().guess_type(path)
        return t + "; charset=utf-8" if t.startswith("text/") or t.endswith("javascript") else t


def _wrap(html: str, theme: str | None) -> str:
    attr = f' data-theme="{theme}"' if theme else ""
    return SKELETON_HEAD.format(theme=attr, csp=CSP) + html + "</body></html>"


SUPPORT = {".js", ".mjs", ".css", ".json", ".csv", ".png", ".jpg", ".jpeg", ".svg", ".webp", ".glb", ".gltf", ".bin", ".woff2", ".txt", ".wasm"}


def render(path, out_dir=None, widths=(390, 1000, 1440), schemes=("light", "dark"), steps=(), wait_ms=900, explicit_theme=False) -> Report:
    from playwright.sync_api import sync_playwright

    path = pathlib.Path(path).resolve()
    out = pathlib.Path(out_dir) if out_dir else path.parent / ".va-render" / path.stem
    out.mkdir(parents=True, exist_ok=True)
    html = path.read_text(encoding="utf-8")
    report = Report()
    lint_rendered = False
    fmt_name, fmt_size = _page_format(re.sub(r"<(style|script)[^>]*>.*?</\1>", "", html, flags=re.I | re.S))

    with tempfile.TemporaryDirectory() as tmp:
        root = pathlib.Path(tmp)
        # serve the page beside its supporting files, as a published artifact would be
        for f in path.parent.iterdir():
            if f.is_file() and f != path and f.suffix.lower() in SUPPORT:
                (root / f.name).symlink_to(f)
        runs = [(s, None) for s in schemes]
        if explicit_theme:
            runs += [("dark", "light"), ("light", "dark")]
        for scheme, theme in runs:
            (root / f"index-{scheme}-{theme or 'auto'}.html").write_text(_wrap(html, theme), encoding="utf-8")

        handler = functools.partial(_Quiet, directory=str(root))
        with socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler) as srv:
            srv.daemon_threads = True
            threading.Thread(target=srv.serve_forever, daemon=True).start()
            base = f"http://127.0.0.1:{srv.server_address[1]}"
            with sync_playwright() as p:
                # a full-page capture of a tall page can lose the WebGL context; without the last flag Chrome
                # then blocks WebGL for the origin and every later run silently shows the 2D fallback
                browser = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
                                                  "--disable-domain-blocking-for-3d-apis"])
                for width in widths:
                    for scheme, theme in runs:
                        tag = f"{width}-{scheme}" + (f"-attr{theme}" if theme else "")
                        ctx = browser.new_context(viewport={"width": width, "height": 900 if width >= 700 else 844},
                                                  device_scale_factor=2 if width < 700 else 1, color_scheme=scheme)
                        page = ctx.new_page()
                        seen: set[str] = set()

                        def note(level, code, msg, tag=tag, seen=seen):
                            if code + msg not in seen:
                                seen.add(code + msg)
                                report.issues.append(Issue(level, code, f"{msg} [{tag}]"))

                        page.on("console", lambda m, note=note: m.type == "error" and note("error", "console", m.text[:300]))
                        page.on("pageerror", lambda e, note=note: note("error", "page-error", str(e)[:300]))
                        page.on("requestfailed", lambda r, note=note: note("error", "load-failed", f"{r.url[:160]} ({r.failure})"))
                        page.add_init_script("document.addEventListener('securitypolicyviolation', e => console.error('CSP blocked ' + e.blockedURI + ' (' + e.violatedDirective + ')'))")
                        page.goto(f"{base}/index-{scheme}-{theme or 'auto'}.html", wait_until="networkidle")
                        page.wait_for_timeout(wait_ms)
                        probe = page.evaluate(_PROBE)
                        if probe["overflow"] > 1:
                            note("error", "h-overflow", f"page scrolls sideways by {probe['overflow']}px; widest: {', '.join(probe['off']) or 'n/a'}")
                        if fmt_name in ("guide", "quick"):
                            for hidden in page.evaluate(_HIDDEN_TEXT)[:3]:
                                note("error", "format-hidden", f"a {fmt_name} page keeps its content open, and this text is hidden: '{hidden}'")
                            if not lint_rendered:
                                lint_rendered = True
                                for issue in _check_format(page.evaluate(_NO_MATH_DOM), "", (fmt_name, fmt_size), False):
                                    if issue.code in _RENDER_CODES and not any(i.code == issue.code for i in report.issues):
                                        note(issue.level, issue.code, issue.message + " (after the page's scripts ran)")
                        if fmt_name in ("guide", "quick") and width >= 800:
                            clipped = page.evaluate(_CLIPPED_MATH)
                            if clipped:
                                note("warn", "math-clipped", f"{clipped} formulas are cut off at this width; break each long line inside an aligned block")
                        if fmt_name in ("guide", "quick", "learn") and width < 800 and page.evaluate(_CLIPPED_ANSWER):
                            note("warn", "math-clipped", "an answer box hides part of its result at this width; break it inside an aligned block")
                        unrendered = page.evaluate("document.querySelectorAll('.tex-fallback').length")
                        if unrendered:
                            note("error", "math-unrendered", f"{unrendered} formulas show as LaTeX source; KaTeX failed to load or refused the page")
                        if fmt_name == "guide" and page.evaluate("document.querySelectorAll('.tex.display:not(.latex .tex):not(.fig .tex)').length") >= 3:
                            note("warn", "math-not-latex", "display equations sit outside a .latex block; write a derivation as a sentence and an equation in .latex")
                        if fmt_name == "quick" and width >= 700:
                            limit_px = QUICK_LIMITS.get(fmt_size or "concept", QUICK_LIMITS["concept"])[1] * QUICK_SCREEN
                            tall = page.evaluate(_TALLEST)
                            if tall > limit_px:
                                note("error", "quick-tall", f"a quick {fmt_size or 'concept'} page is {tall}px tall at this width; the limit is {limit_px}px")
                        if width >= 1000 and page.evaluate(_TRACE_SPLIT):
                            note("error", "trace-layout", "a code player does not show its state to the right of its code at this width")
                        for split in page.evaluate(_SPLIT_TEXT):
                            note("error", "split-text", f"a grid or flex row {split}; wrap the sentence in one <span>, or give the row display: block and place the marker with position: absolute")
                        for fam in probe["missing"]:
                            note("warn", "font-fallback", f"'{fam}' did not load; text fell back to the next face")
                        top = out / f"{tag}-top.png"  # the first screen, taken before the full page so WebGL is still live
                        page.screenshot(path=str(top))
                        shot = out / f"{tag}.png"
                        page.screenshot(path=str(shot), full_page=True)
                        report.shots += [top, shot]
                        for k, step in enumerate(steps):
                            label, _, js = step.partition("::")
                            try:
                                page.evaluate(f"async () => {{ {js} }}")
                            except Exception as e:  # noqa: BLE001 - report, keep going
                                note("error", "step-failed", f"step '{label}': {str(e)[:200]}")
                            page.wait_for_timeout(wait_ms)
                            probe = page.evaluate(_PROBE)
                            if probe["overflow"] > 1:
                                note("error", "h-overflow", f"after step '{label}' the page scrolls sideways by {probe['overflow']}px; widest: {', '.join(probe['off']) or 'n/a'}")
                            slug = re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-") or "step"
                            view = out / f"{tag}-step{k + 1}-{slug}-view.png"  # what the reader sees: sticky nav, current section
                            page.screenshot(path=str(view))
                            shot = out / f"{tag}-step{k + 1}-{slug}.png"
                            page.screenshot(path=str(shot), full_page=True)
                            report.shots += [view, shot]
                        ctx.close()
                browser.close()
            srv.shutdown()
    return report


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("page")
    ap.add_argument("--out")
    ap.add_argument("--widths", default="390,1000,1440")
    ap.add_argument("--schemes", default="light,dark")
    ap.add_argument("--step", action="append", default=[], help='"label::javascript" run after load, then screenshot')
    ap.add_argument("--wait", type=int, default=900, help="ms to wait after load and after each step")
    ap.add_argument("--explicit-theme", action="store_true", help="also run with data-theme set against the OS scheme")
    ap.add_argument("--static-only", action="store_true")
    a = ap.parse_args(argv)

    page = pathlib.Path(a.page)
    report = Report(issues=check_static(page.read_text(encoding="utf-8")))
    if not a.static_only:
        r = render(page, a.out, tuple(int(w) for w in a.widths.split(",")), tuple(a.schemes.split(",")), a.step, a.wait, a.explicit_theme)
        report.issues += r.issues
        report.shots = r.shots
    order = {"error": 0, "warn": 1, "info": 2}
    for i in sorted(report.issues, key=lambda i: order[i.level]):
        print(i)
    errors = sum(i.level == "error" for i in report.issues)
    warns = sum(i.level == "warn" for i in report.issues)
    print(f"\n{errors} error(s), {warns} warning(s)")
    if report.shots:
        print("screenshots (look at them):")
        for s in report.shots:
            print(f"  {s}")
    return 0 if report.ok else 1


if __name__ == "__main__":
    sys.exit(main())
