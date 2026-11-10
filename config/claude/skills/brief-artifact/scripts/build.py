#!/usr/bin/env python3
"""Build a brief page: one markdown file in, one self-contained HTML page out.

    python3 build.py brief.md            # writes brief.html beside it
    python3 build.py brief.md -o out.html

A brief is a short page Sean reads in the Artifact viewer: prose, tables and
code, plus zero or more decisions. He picks options, and "Copy response" puts a
plain-text answer on the clipboard for him to paste into the chat.

The markdown format (see ../SKILL.md):

    # Title of two to four words
    > One-line lead (optional).
    ## ? A question                  pick one
    - **Label** (recommended) — what it means
    - **Other label** — what it means
    ## ?+ A question                 pick any number
    ## ? A question with no list     free answer
    > [!warning] Optional title      a callout: note, tip, important, warning,
    > Text.                          caution, done

The script refuses a brief that cannot be answered (exit 1) and prints
warnings for one that is hard to answer. The page loads nothing from the
network: no font, script, stylesheet or image.
"""
from __future__ import annotations

import argparse
import dataclasses
import html
import re
import sys
from pathlib import Path

try:
    from markdown_it import MarkdownIt
except ImportError:  # pragma: no cover - environment problem, not logic
    sys.exit("brief: error: markdown-it-py is not installed (python3 -m pip install markdown-it-py)")

WORD_LIMIT = 900        # prose words; above this the page is a report, not a brief
DECISION_LIMIT = 6
KEYS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
# A link is kept only when it goes to the web, to mail, or to a place on the
# page. Everything else (data:, file:, blob:, a relative path) stays text.
ALLOWED_LINK = re.compile(r"(?:https?://|mailto:|#)", re.I)
# The deepest container (list item or quote) the script accepts: six lists or
# thirteen quotes. markdown-it stops parsing at its own limit of 20 and drops
# the rest of the file without an error, so this limit must stay below it.
MAX_LEVEL = 14
CALLOUTS = {"note": "Note", "tip": "Tip", "important": "Important",
            "warning": "Warning", "caution": "Caution", "done": "Done"}

# Colours read from claude.dev's stylesheet (2026-11-10), with two changes.
# Light `ink-3` is #676660: the site's caption ink (#6b6a64) gives 4.47:1 on
# `panel`, below the 4.5:1 that tests/test_page.py requires. The dark `line`
# and `tint` values are the light ones with the dark ink, not read from the
# site.
LIGHT = {
    "bg": "#faf9f5", "raised": "#f1efe8", "panel": "#ece9e0",
    "ink": "#141413", "ink-2": "#4c4b45", "ink-3": "#676660",
    "accent": "#c15f3c", "link": "#a94e2f",
    "line": "#14141338", "line-soft": "#1414131c", "tint": "#1414130d",
}
DARK = {
    "bg": "#141413", "raised": "#1a1a18", "panel": "#1e1d1b",
    "ink": "#faf9f5", "ink-2": "#b0aea5", "ink-3": "#87867f",
    "accent": "#d97757", "link": "#d97757",
    "line": "#faf9f538", "line-soft": "#faf9f51c", "tint": "#faf9f50f",
}


class BriefError(Exception):
    """The brief cannot be built into a page Sean can answer."""


@dataclasses.dataclass
class Result:
    title: str
    name: str           # the page name: the first four words of the title
    decisions: list     # [{"title", "kind": one|many|open, "options": [{"key", "label", "recommended"}]}]
    warnings: list
    html: str
    words: int


def esc(text):
    return html.escape(text, quote=True)


# ------------------------------------------------------------------ markdown

def _table_open(self, tokens, idx, options, env):
    return '<div class="table-wrap"><table>\n'


def _table_close(self, tokens, idx, options, env):
    return "</table></div>\n"


def _link_open(self, tokens, idx, options, env):
    href = tokens[idx].attrGet("href") or ""
    if not ALLOWED_LINK.match(href):
        # The second check, at the one place every link is written. It also
        # catches `[text]()`: an empty target would reload the page and lose
        # the answers. The text stays; it is not a link.
        tokens[idx].attrs = {}
    elif re.match(r"https?://", href, re.I):
        tokens[idx].attrSet("target", "_blank")
        tokens[idx].attrSet("rel", "noopener noreferrer")
    return self.renderToken(tokens, idx, options, env)


def make_parser():
    # html off: raw HTML in the source is shown as text. image off: the page
    # loads nothing. The link check is an allow-list: markdown-it's own check
    # is a deny-list, and it lets data:image/... through on purpose.
    md = MarkdownIt("commonmark", {"html": False}).enable(["table", "strikethrough"]).disable(["image"])
    md.validateLink = lambda url: bool(ALLOWED_LINK.match(url))
    md.add_render_rule("table_open", _table_open)
    md.add_render_rule("table_close", _table_close)
    md.add_render_rule("link_open", _link_open)
    return md


def split_blocks(tokens):
    """Group a token list into its outermost blocks (each a list of tokens)."""
    blocks, current, depth = [], [], 0
    for token in tokens:
        current.append(token)
        depth += token.nesting
        if depth == 0:
            blocks.append(current)
            current = []
    return blocks


def plain_text(children):
    parts = []
    for child in children or []:
        if child.type in ("softbreak", "hardbreak"):
            parts.append(" ")
        elif child.nesting == 0:
            parts.append(child.content)
    return re.sub(r"\s+", " ", "".join(parts)).strip()


def kids(inline):
    """An inline token's children without the empty text tokens the parser leaves at emphasis edges."""
    return [c for c in inline.children or [] if not (c.type == "text" and c.content == "")]


def heading_level(block):
    return int(block[0].tag[1]) if block[0].type == "heading_open" else 0


def line_of(token):
    return token.map[0] + 1 if token.map else 0


class Builder:
    def __init__(self, source):
        self.md = make_parser()
        self.env = {}
        tokens = self.md.parse(source, self.env)
        for token in tokens:
            if token.type in ("list_item_open", "blockquote_open") and token.level + 1 >= MAX_LEVEL:
                raise BriefError(f"line {line_of(token)}: nested too deep (the limit is six list levels or "
                                 "thirteen quote levels). Flatten it, or put a tree in a code block")
        self.blocks = split_blocks(tokens)
        self.warnings = []
        self.decisions = []
        self.sections = []   # (element id, plain title, decision number or None), in page order

    # -- small render helpers
    def inline(self, children):
        return self.md.renderer.renderInline(children, self.md.options, self.env).strip()

    def render(self, tokens):
        return self.md.renderer.render(tokens, self.md.options, self.env)

    def render_blocks(self, blocks):
        return "".join(self.callout(b) or self.render(b) for b in blocks)

    def callout(self, block):
        """`> [!kind] title` becomes a labelled callout; any other quote returns None."""
        if block[0].type != "blockquote_open" or len(block) < 4 or block[1].type != "paragraph_open":
            return None
        first = block[2]
        m = re.match(r"\[!([A-Za-z]+)\][ \t]*([^\n]*)(?:\n|$)", first.content)
        if not m:
            return None
        kind = m.group(1).lower()
        label = CALLOUTS.get(kind, kind.capitalize())
        style = kind if kind in CALLOUTS else "note"
        head = f'<span class="callout-kind">{esc(label)}</span>'
        if m.group(2).strip():
            name = self.md.parseInline(m.group(2).strip(), self.env)[0].children
            head += f'<span class="callout-name">{self.inline(name)}</span>'
        body = ""
        rest = first.content[m.end():]
        if rest.strip():
            body += f"<p>{self.inline(self.md.parseInline(rest, self.env)[0].children)}</p>\n"
        body += self.render_blocks(split_blocks(block[4:-1]))
        return f'<aside class="callout callout-{style}"><p class="callout-head">{head}</p>\n{body}</aside>\n'

    # -- decisions
    def decision_marker(self, block):
        """('one'|'many', title children) for a `## ?` heading, else None."""
        if heading_level(block) != 2:
            return None
        children = kids(block[1])
        if not children or children[0].type != "text":
            return None
        m = re.match(r"\?(\+?)(?:\s+|$)", children[0].content)
        if not m:
            return None
        rest = children[0].content[m.end():]
        title = ([dataclasses.replace(children[0], content=rest)] if rest else []) + list(children[1:])
        return ("many" if m.group(1) else "one"), title

    def parse_option(self, item, where):
        """One list item -> (label, recommended, description html), or None when it has no bold label."""
        content = item[1:-1]
        if len(content) < 3 or content[0].type != "paragraph_open":
            return None
        children = kids(content[1])
        if not children or children[0].type != "strong_open":
            return None
        depth, close = 0, None
        for i, child in enumerate(children):
            if child.type == "strong_open":
                depth += 1
            elif child.type == "strong_close":
                depth -= 1
                if depth == 0:
                    close = i
                    break
        if close is None:
            return None
        label = plain_text(children[1:close]).rstrip(":").strip()
        if not label:
            raise BriefError(f"{where}: an option has an empty label; write `- **Label** — what it means`")
        rest = children[close + 1:]
        recommended = False
        if rest and rest[0].type == "text":
            text = rest[0].content
            m = re.match(r"\s*\(recommended\)", text, re.I)
            if m:
                recommended = True
                text = text[m.end():]
            text = re.sub(r"^\s*(?:[—–:]|-{1,2})(?:\s+|$)", "", text).lstrip()
            rest = ([dataclasses.replace(rest[0], content=text)] if text else []) + rest[1:]
        while rest and rest[0].type in ("softbreak", "hardbreak"):
            rest = rest[1:]
        desc = self.inline(rest)
        more = self.render(content[3:])
        return label, recommended, desc, more

    def find_options(self, body, where):
        """Index of the options list in a decision body and its parsed options."""
        for index, block in enumerate(body):
            if block[0].type != "bullet_list_open":
                continue
            items = split_blocks(block[1:-1])
            parsed = [self.parse_option(item, where) for item in items]
            if not any(parsed):
                continue  # an ordinary list, not options
            if not all(parsed):
                raise BriefError(f"{where}: every option starts with a bold label: `- **Label** — what it means`")
            return index, parsed
        return None, []

    def decision(self, kind, title_children, heading, body):
        number = len(self.decisions) + 1
        title = plain_text(title_children)
        where = f"line {line_of(heading)}"
        if not title:
            raise BriefError(f"{where}: `## ?` needs the question after it")
        if any(d["title"] == title for d in self.decisions):
            raise BriefError(f'{where}: the question "{title}" appears twice; the answer could not tell them apart')
        index, parsed = self.find_options(body, f'{where}, "{title}"')
        if len(parsed) == 1:
            raise BriefError(f'{where}: "{title}" has one option; give two or more, or none for a free answer')
        if len(parsed) > len(KEYS):
            raise BriefError(f'{where}: "{title}" has {len(parsed)} options; the limit is {len(KEYS)}')
        labels = [p[0] for p in parsed]
        for label in labels:
            if labels.count(label) > 1:
                raise BriefError(f'{where}: "{title}" has the option label "{label}" twice')
        recommended = sum(1 for p in parsed if p[1])
        if not parsed:
            kind = "open"
        elif kind == "one" and recommended > 1:
            raise BriefError(f'{where}: "{title}" marks {recommended} options as recommended; a pick-one decision '
                             "takes one. Use `## ?+` when he can pick several")
        elif recommended == 0:
            self.warnings.append(f'"{title}" has no (recommended) option; say which one you recommend')
        self.decisions.append({
            "title": title, "kind": kind,
            "options": [{"key": KEYS[i], "label": p[0], "recommended": p[1]} for i, p in enumerate(parsed)],
        })

        did = f"d{number}"
        self.sections.append((did, title, number))
        hint = {"one": "pick one", "many": "pick any", "open": "your answer"}[kind]
        out = [f'<section class="decision" id="{did}" data-kind="{kind}" data-title="{esc(title)}">\n',
               f'<p class="kicker"><span class="num">{number}</span>Decision · {hint}</p>\n',
               f"<h2>{self.inline(title_children)}</h2>\n"]
        if parsed:
            out.append(self.render_blocks(body[:index]))
            control = "radio" if kind == "one" else "checkbox"
            out.append(f'<fieldset class="options"><legend class="sr">{esc(title)}</legend>\n')
            for i, (label, rec, desc, more) in enumerate(parsed):
                badge = '<span class="rec">Recommended</span>' if rec else ""
                desc_html = f'<span class="option-desc">{desc}</span>' if desc else ""
                more_html = f'<div class="option-more">{more}</div>' if more.strip() else ""
                out.append(
                    f'<label class="option"><input type="{control}" name="{did}" value="{KEYS[i]}" '
                    f'data-label="{esc(label)}"{" data-rec" if rec else ""}>'
                    f'<span class="key" aria-hidden="true">{KEYS[i]}</span>'
                    f'<span class="option-body"><span class="option-head">'
                    f'<span class="option-label">{esc(label)}</span>{badge}</span>{desc_html}{more_html}</span></label>\n')
            out.append("</fieldset>\n")
            out.append(self.render_blocks(body[index + 1:]))
            out.append(f'<label class="field"><span>Note (optional)</span>'
                       f'<textarea name="{did}-note" rows="1"></textarea></label>\n')
        else:
            out.append(self.render_blocks(body))
            out.append(f'<label class="field"><span>Your answer</span>'
                       f'<textarea name="{did}-note" rows="3"></textarea></label>\n')
        out.append("</section>\n")
        return "".join(out)

    # -- the section pane
    def section_heading(self, block):
        """A plain `## ` heading gets an id, so the pane can scroll to it."""
        children = block[1].children
        title = plain_text(children)
        if not title:
            return self.render(block)
        sid = f"s{sum(1 for s in self.sections if s[2] is None) + 1}"
        self.sections.append((sid, title, None))
        return f'<h2 id="{sid}">{self.inline(children)}</h2>\n'

    def pane(self):
        """The left pane: decisions and sections in page order. Empty for a page with one part."""
        entries = list(self.sections)
        if self.decisions:
            entries.append(("respond", "Your response", None))
        if len(entries) < 2:
            return ""
        items = []
        for sid, title, number in entries:
            chip = f'<span class="toc-num">{number}</span>' if number else ""
            items.append(f'<li><a href="#{sid}" data-target="{sid}">{chip}'
                         f'<span class="toc-text">{esc(title)}</span></a></li>\n')
        return ('<nav class="toc" aria-label="Sections"><p class="kicker">On this page</p>\n<ol>\n'
                + "".join(items) + "</ol></nav>\n")

    # -- the page
    def build(self):
        blocks = self.blocks
        titles = [b for b in blocks if heading_level(b) == 1]
        if len(titles) != 1:
            raise BriefError(f"a brief needs exactly one `# ` title; found {len(titles)}")
        if heading_level(blocks[0]) != 1:
            raise BriefError("the `# ` title must be the first thing in the brief")
        title = plain_text(blocks[0][1].children)
        if not title:
            raise BriefError("the `# ` title is empty")
        count = len(title.split())
        name = " ".join(title.split()[:4])
        if count > 4:
            self.warnings.append(f'the title has {count} words; the page name uses the first four ("{name}")')
        elif count < 2:
            self.warnings.append("the title has one word; a page name wants two to four")

        rest = blocks[1:]
        lead = ""
        if rest and rest[0][0].type == "blockquote_open" and len(rest[0]) == 5 \
                and rest[0][1].type == "paragraph_open" and not self.callout(rest[0]):
            lead = f'<p class="lead">{self.inline(rest[0][2].children)}</p>\n'
            rest = rest[1:]

        body, i = [], 0
        while i < len(rest):
            marker = self.decision_marker(rest[i])
            if not marker and heading_level(rest[i]) == 2:
                body.append(self.section_heading(rest[i]))
                i += 1
                continue
            if not marker:
                body.append(self.callout(rest[i]) or self.render(rest[i]))
                i += 1
                continue
            end = i + 1
            while end < len(rest) and heading_level(rest[end]) not in (1, 2):
                end += 1
            body.append(self.decision(marker[0], marker[1], rest[i][0], rest[i + 1:end]))
            i = end

        words = sum(len(plain_text(t.children).split()) for b in blocks for t in b if t.type == "inline")
        if words > WORD_LIMIT:
            self.warnings.append(f"{words} words; a brief is at most {WORD_LIMIT}. Cut it, or use a Guide page")
        n = len(self.decisions)
        if n > DECISION_LIMIT:
            self.warnings.append(f"{n} decisions; ask at most {DECISION_LIMIT} at one time")

        kicker = f"Brief · {n} decision{'' if n == 1 else 's'}" if n else "Brief"
        pane = self.pane()
        page = [f"<title>{esc(name)}</title>\n", f"<style>\n{css()}</style>\n",
                '<div class="page">\n', pane,
                f'<main class="brief" data-title="{esc(title)}">\n',
                f'<p class="kicker">{kicker}</p>\n',
                f"<h1>{self.inline(blocks[0][1].children)}</h1>\n", lead, *body]
        if n:
            has_rec = any(o["recommended"] for d in self.decisions for o in d["options"])
            accept = '<button type="button" id="accept">Use recommendations</button>' if has_rec else ""
            page.append(RESPOND)
            page.append(f'<div class="bar"><span id="status" role="status"></span>'
                        f'{accept}<button type="button" id="copy" class="primary">Copy response</button></div>\n')
        page.append("</main>\n</div>\n")
        page.append(f"<script>\n{SCRIPT}</script>\n")
        return Result(title, name, self.decisions, self.warnings, "".join(page), words)


def build(source):
    return Builder(source).build()


# ---------------------------------------------------------------- page parts

RESPOND = """<section id="respond" class="respond" aria-labelledby="respond-h">
<p class="kicker" id="respond-h">Your response</p>
<label class="field"><span>Comment (optional)</span><textarea id="comment" rows="2"></textarea></label>
<pre id="reply" class="reply" tabindex="0" aria-label="The response that Copy puts on the clipboard"></pre>
</section>
"""


def tokens(values):
    return "".join(f"--{k}:{v};" for k, v in values.items())


def css():
    return (CSS.replace("/*LIGHT*/", tokens(LIGHT)).replace("/*DARK*/", tokens(DARK)))


CSS = """:root{/*LIGHT*/color-scheme:light;
--sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
--mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){/*DARK*/color-scheme:dark}}
:root[data-theme="dark"]{/*DARK*/color-scheme:dark}
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:400 1rem/1.65 var(--sans);-webkit-text-size-adjust:100%;text-rendering:optimizeLegibility}
.page{max-width:732px;margin:0 auto;padding:0 16px}
.brief{min-width:0;padding:40px 0 48px;overflow-wrap:break-word}
.brief:has(>.bar){padding-bottom:0}
.toc{display:none}
h2,section{scroll-margin-top:24px}
@media (min-width:720px){.page{padding:0 24px}.brief{padding-top:64px}}
@media (min-width:900px){
.page{max-width:none;display:grid;grid-template-columns:200px minmax(0,732px);column-gap:48px;justify-content:center}
.toc{display:block;position:sticky;top:0;align-self:start;max-height:100vh;overflow-y:auto;padding:64px 0 24px}
}
.toc ol{list-style:none;margin:0;padding:0;border-left:1px solid var(--line-soft)}
.toc li{margin:0}
.toc a{display:flex;gap:.5rem;align-items:flex-start;margin-left:-1px;padding:.35rem 0 .35rem .875rem;border-left:1px solid transparent;color:var(--ink-2);font-size:.8125rem;line-height:1.4;text-decoration:none}
.toc a:hover{color:var(--ink)}
.toc a[aria-current="true"]{color:var(--ink);font-weight:600;border-left-color:var(--ink)}
.toc-num{flex:none;display:inline-grid;place-items:center;width:1.25rem;height:1.25rem;margin-top:-.05rem;font:500 .6875rem/1 var(--mono);color:var(--ink-2);border:1px solid var(--line);border-radius:50%}
.toc a[data-answered] .toc-num{color:var(--bg);background:var(--ink);border-color:var(--ink)}
.toc-text{min-width:0;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere}
.kicker{font:500 .75rem/1.5 var(--mono);letter-spacing:.03em;text-transform:uppercase;color:var(--ink-3);margin:0 0 .75rem}
h1{font-size:clamp(1.5rem,1.1rem + 1vw,2rem);line-height:1.2;font-weight:500;letter-spacing:-.01em;margin:0 0 1rem}
.lead{font-size:1.125rem;line-height:1.55;color:var(--ink-2);margin:0 0 2rem}
h2{font-size:1.25rem;line-height:1.3;font-weight:500;margin:2.5rem 0 .75rem}
h3{font-size:1rem;line-height:1.4;font-weight:600;margin:1.75rem 0 .5rem}
h4,h5,h6{font:500 .75rem/1.5 var(--mono);letter-spacing:.03em;text-transform:uppercase;color:var(--ink-2);margin:1.5rem 0 .5rem}
p{margin:0 0 1em}
ul,ol{margin:0 0 1em;padding-left:1.35rem}
li{margin:.25em 0}
li>p{margin:0 0 .5em}
a{color:var(--link);text-decoration:underline;text-underline-offset:2px;text-decoration-thickness:1px}
a:hover{text-decoration-thickness:2px}
strong{font-weight:600}
hr{border:0;border-top:1px solid var(--line-soft);margin:2.5rem 0}
code{font-family:var(--mono);font-size:.875em;background:var(--tint);border:1px solid var(--line-soft);padding:.0625em .25em;overflow-wrap:anywhere}
pre{font:400 .8125rem/1.65 var(--mono);background:var(--raised);border:1px solid var(--line-soft);padding:14px 16px;margin:1.5rem 0;overflow-x:auto;color:var(--ink-2)}
pre code{background:none;border:0;padding:0;font-size:inherit;overflow-wrap:normal}
blockquote{margin:1.75rem 0;padding-left:1.25rem;border-left:1px solid var(--line);color:var(--ink-2)}
blockquote>:last-child,.callout>:last-child,.option-more>:last-child{margin-bottom:0}
.table-wrap{overflow-x:auto;margin:1.5rem 0;border:1px solid var(--line-soft);background:var(--raised)}
table{border-collapse:collapse;width:100%;font-size:.875rem;line-height:1.5}
th{font:500 .75rem/1.4 var(--mono);letter-spacing:.02em;color:var(--ink-3);text-align:left;padding:10px 16px;border-bottom:1px solid var(--line-soft);white-space:nowrap}
td{padding:8px 16px;border-bottom:1px solid var(--line-soft);vertical-align:top;color:var(--ink-2)}
tr:last-child>td{border-bottom:0}
.callout{margin:1.5rem 0;padding:12px 16px;background:var(--raised);border-left:2px solid var(--ink-3)}
.callout-important,.callout-warning,.callout-caution{border-left-color:var(--accent)}
.callout-head{margin:0 0 .35rem;display:flex;flex-wrap:wrap;gap:.25rem .75rem;align-items:baseline}
.callout-kind{font:500 .75rem/1.5 var(--mono);letter-spacing:.03em;text-transform:uppercase;color:var(--ink-2)}
:is(.callout-important,.callout-warning,.callout-caution) .callout-kind{color:var(--link)}
.callout-name{font-weight:600}
.decision{margin-top:3rem;padding-top:1.25rem;border-top:1px solid var(--line)}
.decision>h2{margin-top:0}
.num{display:inline-block;min-width:1.5em;margin-right:.6em;padding:0 .35em;text-align:center;color:var(--bg);background:var(--ink)}
.options{border:0;margin:1.25rem 0;padding:0;min-width:0;display:grid;gap:10px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.option{position:relative;display:grid;grid-template-columns:auto minmax(0,1fr);gap:14px;align-items:start;padding:16px 18px;border:1px solid var(--line-soft);background:var(--raised);cursor:pointer;transition:border-color .12s ease,box-shadow .12s ease}
.option:hover{border-color:var(--ink-3)}
.option:has(input:checked){border-color:var(--ink);box-shadow:0 0 0 1px var(--ink)}
.option input{position:absolute;top:16px;left:18px;width:1.625rem;height:1.625rem;margin:0;opacity:0;cursor:pointer}
.key{display:inline-grid;place-items:center;width:1.625rem;height:1.625rem;font:500 .75rem/1 var(--mono);color:var(--ink-2);background:var(--bg);border:1px solid var(--line);border-radius:0;transition:background-color .12s ease,color .12s ease}
[data-kind="one"] .key{border-radius:50%}
.option:hover .key{border-color:var(--ink);color:var(--ink)}
.option input:checked+.key{color:var(--bg);background:var(--ink);border-color:var(--ink)}
.option input:focus-visible+.key{outline:2px solid var(--accent);outline-offset:2px}
@media (max-width:480px){.option{gap:12px;padding:14px}.option input{top:14px;left:14px}}
@media (prefers-reduced-motion:reduce){.option,.key{transition:none}}
.option-head{display:flex;flex-wrap:wrap;gap:.2rem .6rem;align-items:baseline}
.option-body{min-width:0}
.option-label{font-weight:600}
.option-label,.callout-name{min-width:0;overflow-wrap:anywhere}
.rec{font:500 .6875rem/1.5 var(--mono);letter-spacing:.03em;text-transform:uppercase;color:var(--link);border:1px solid currentColor;padding:0 .4em}
.option-desc{display:block;color:var(--ink-2);font-size:.9375rem;line-height:1.55;margin-top:.15rem}
.option-more{color:var(--ink-2);font-size:.9375rem;margin-top:.5rem}
.field{display:block;margin:1rem 0 0}
.field>span{display:block;font:500 .75rem/1.5 var(--mono);letter-spacing:.03em;text-transform:uppercase;color:var(--ink-3);margin-bottom:.35rem}
textarea{display:block;width:100%;min-height:2.6rem;resize:vertical;font:inherit;font-size:.9375rem;line-height:1.5;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:0;padding:8px 10px}
.respond{margin-top:3rem;padding-top:1.25rem;border-top:1px solid var(--ink)}
.reply{white-space:pre-wrap;overflow-wrap:anywhere;margin:1rem 0 0}
.bar{position:sticky;bottom:0;margin-top:3rem;padding:10px 0;background:var(--bg);border-top:1px solid var(--line);display:flex;flex-wrap:wrap;gap:8px;align-items:center}
#status{flex:1 1 12rem;font:500 .75rem/1.5 var(--mono);letter-spacing:.02em;color:var(--ink-2)}
button{font:500 .75rem/1 var(--mono);letter-spacing:.03em;text-transform:uppercase;min-height:40px;padding:0 14px;color:var(--ink);background:transparent;border:1px solid var(--line);border-radius:0;cursor:pointer}
button:hover{border-color:var(--ink)}
button.primary{color:var(--bg);background:var(--ink);border-color:var(--ink)}
button.primary:hover{opacity:.85}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.offscreen{position:fixed;left:-9999px;top:0;opacity:0}
@media print{.bar,.toc{display:none}}
"""

# The page script has two parts. The first handles every link to a place on
# the page, so that none of them navigates (a fragment link can move the
# viewer's frame), and it marks the part in view in the section pane. The
# second is the reply: plain text, built in the page from what he
# picked. Clipboard access can be blocked in the viewer, so copy falls back
# twice: the old execCommand path, then selecting the visible reply.
SCRIPT = r"""(() => {
  const all = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const one = id => document.getElementById(id);
  const title = document.querySelector('main').dataset.title;

  // ---- section pane
  const links = all('nav.toc a').filter(link => one(link.dataset.target));
  const targets = links.map(link => one(link.dataset.target));
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // After a click the clicked entry stays the current one, also when its part
  // cannot reach the top of the window. The scroll that the click started is
  // over when no scroll event came for 160 ms. A later move of the page is the
  // reader's own scroll, and it hands the choice back to the scroll position.
  let wanted = -1, restY = null, restTimer = 0;
  const rest = () => {
    clearTimeout(restTimer);
    restTimer = setTimeout(() => { restY = window.scrollY; }, 160);
  };

  function mark() {
    let current = 0;
    if (wanted >= 0) {
      current = wanted;
    } else {
      targets.forEach((target, i) => { if (target.getBoundingClientRect().top <= 120) current = i; });
      const root = document.documentElement;
      if (root.scrollHeight > window.innerHeight && window.innerHeight + window.scrollY >= root.scrollHeight - 2) {
        targets.forEach((target, i) => { if (target.getBoundingClientRect().top < window.innerHeight) current = Math.max(current, i); });
      }
    }
    links.forEach((link, i) => {
      if (i === current) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    });
  }

  // Every link to a place on this page is handled here, in the pane and in the
  // text. The browser's own fragment navigation must not run: in a srcdoc
  // frame it loads the viewer's page into the frame, and the answers are lost.
  document.addEventListener('click', event => {
    const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
    if (!link) return;
    event.preventDefault();
    let id = link.getAttribute('href').slice(1);
    try { id = decodeURIComponent(id); } catch (error) { /* keep the raw text */ }
    const target = id ? one(id) : null;
    if (!target) return;
    const entry = targets.indexOf(target);
    if (entry >= 0) {
      wanted = entry;
      restY = null;
      rest();
    }
    target.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
    if (entry >= 0) mark();
  });

  if (links.length) {
    let queued = false;
    window.addEventListener('scroll', () => {
      if (wanted >= 0 && restY === null) rest();
      else if (wanted >= 0 && Math.abs(window.scrollY - restY) > 4) wanted = -1;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; mark(); });
    }, { passive: true });
    window.addEventListener('resize', mark);
    mark();
  }

  // ---- reply
  const sections = all('section.decision');
  if (!sections.length) return;
  const reply = one('reply'), status = one('status'), comment = one('comment');
  const copyButton = one('copy'), acceptButton = one('accept');
  const indent = text => text.split('\n').join('\n   ');
  let flash = '';

  function compose() {
    const lines = ['Response to brief: ' + title];
    const done = [];
    sections.forEach((section, i) => {
      const picked = all('input:checked', section).map(input => input.value + '. ' + input.dataset.label);
      const note = section.querySelector('textarea').value.trim();
      done.push(picked.length > 0 || note !== '');
      lines.push('', (i + 1) + '. ' + section.dataset.title);
      if (section.dataset.kind === 'open') {
        lines.push('   → ' + (note ? indent(note) : '(no answer)'));
      } else {
        lines.push('   → ' + (picked.length ? picked.join('; ') : note ? '(none of the options)' : '(no answer)'));
        if (note) lines.push('   Note: ' + indent(note));
      }
    });
    const extra = comment.value.trim();
    if (extra) lines.push('', 'Comment: ' + indent(extra));
    return { text: lines.join('\n'), done, answered: done.filter(Boolean).length };
  }

  function update() {
    const state = compose();
    // Write only on a change: a write can replace the text node, and that
    // drops the selection the last copy fallback made.
    if (reply.textContent !== state.text) reply.textContent = state.text;
    status.textContent = flash || state.answered + ' of ' + sections.length + ' answered';
    sections.forEach((section, i) => {
      const link = links.find(candidate => candidate.dataset.target === section.id);
      if (link) link.toggleAttribute('data-answered', state.done[i]);
    });
    return state;
  }

  function say(message) {
    flash = message;
    update();
    clearTimeout(say.timer);
    say.timer = setTimeout(() => { flash = ''; update(); }, 6000);
  }

  async function copy() {
    const state = update();
    const open = sections.length - state.answered;
    const done = 'Copied' + (open ? ' with ' + open + ' unanswered' : '') + '. Paste it in the chat.';
    try {
      await navigator.clipboard.writeText(state.text);
      return say(done);
    } catch (error) { /* blocked or missing: try the next way */ }
    const box = document.createElement('textarea');
    box.value = state.text;
    box.setAttribute('readonly', '');
    box.className = 'offscreen';
    document.querySelector('main').appendChild(box);
    box.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (error) { ok = false; }
    box.remove();
    if (ok) return say(done);
    const range = document.createRange();
    range.selectNodeContents(reply);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    reply.scrollIntoView({ block: 'center' });
    say('Copy is blocked here. The response is selected: press Cmd+C or Ctrl+C.');
  }

  function accept() {
    sections.forEach(section => {
      const inputs = all('input', section);
      if (!inputs.some(input => input.hasAttribute('data-rec'))) return;
      inputs.forEach(input => { input.checked = input.hasAttribute('data-rec'); });
    });
    update();
  }

  document.addEventListener('input', () => { flash = ''; update(); });
  document.addEventListener('change', () => { flash = ''; update(); });
  copyButton.addEventListener('click', copy);
  if (acceptButton) acceptButton.addEventListener('click', accept);
  update();
})();
"""


# ------------------------------------------------------------------- command

def main(argv=None):
    parser = argparse.ArgumentParser(description="Build a brief page from a markdown file.")
    parser.add_argument("source", type=Path, help="the brief, in markdown")
    parser.add_argument("-o", "--output", type=Path, help="the page to write (default: source with .html)")
    args = parser.parse_args(argv)
    try:
        text = args.source.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as error:
        print(f"brief: error: cannot read {args.source}: {error}", file=sys.stderr)
        return 1
    try:
        result = build(text)
    except BriefError as error:
        print(f"brief: error: {error}", file=sys.stderr)
        return 1
    out = args.output or args.source.with_suffix(".html")
    try:
        out.write_text(result.html, encoding="utf-8")
    except OSError as error:
        print(f"brief: error: cannot write {out}: {error}", file=sys.stderr)
        return 1
    kinds = [d["kind"] for d in result.decisions]
    n = len(kinds)
    detail = (" (" + ", ".join(f"{kinds.count(k)} {w}" for k, w in
                                (("one", "pick one"), ("many", "pick any"), ("open", "free answer")) if k in kinds) + ")"
              if n else " (a report: no response bar)")
    print(f"page:  {out.resolve()}")
    print(f"title: {result.name}")
    print(f"{n} decision{'' if n == 1 else 's'}{detail} · {result.words} words · "
          f"{len(result.html.encode('utf-8')) / 1024:.1f} KB")
    for warning in result.warnings:
        print(f"warning: {warning}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
