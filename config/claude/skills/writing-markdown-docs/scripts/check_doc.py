#!/usr/bin/env python3
"""Validate a markdown document against the writing-markdown-docs rules.

Usage:
    python3 check_doc.py PATH [PATH ...] [--no-frontmatter] [--vault] [--strict]

--vault checks an Obsidian vault note: the vault's frontmatter, links and
unwrapped lines (references/vault/conventions.md) replace the repo dialect's;
voice and reader-load checks still apply.

Exit 0 when clean, 1 when any error is found (or any warning with --strict).
"""
import argparse
import re
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path

MAX_PROSE = 80
MAX_TABLE = 100
VALID_TYPES = ("analysis", "design", "handoff", "learn", "lookup", "plan",
               "report", "runbook", "task-card")
# Renamed in the 2026-10-27 redesign: still accepted, with a warning.
LEGACY_TYPES = {"teaching": "learn", "rca": "report"}
STATUS_REQUIRED = ("handoff", "report", "analysis", "design", "runbook",
                   "lookup", "plan", "task-card")
TLDR_WORDS = 60
# Rough word budgets per genre (prose only; code, tables and diagrams are free).
BUDGET = {"report": 450, "handoff": 700, "task-card": 500, "runbook": 900,
          "analysis": 1500, "design": 2500, "plan": 3000, "learn": 3500}
HYPE = (
    "robust", "seamless", "powerful", "comprehensive", "leverage",
    "delve", "crucial", "vital", "elevate", "unlock", "cutting-edge",
    "game-changing", "effortless",
)
PLACEHOLDER = re.compile(r"\b(TBD|TODO|FIXME|XXX)\b")
INLINE_CODE = re.compile(r"`[^`]*`")
HTML_TAG = re.compile(r"</?[a-zA-Z][a-zA-Z0-9-]*(\s[^>]*)?/?>")
FENCE = re.compile(r"^[\s>]*(`{3,}|~{3,})(.*)$")
HEADING = re.compile(r"^(#{1,6})\s")
DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
# A line ending in a word character plus a hyphen, when the next line starts
# with a word character, is a word split across a soft break. CommonMark
# joins soft breaks with a space, so it renders with a space in the middle.
# Requiring \w before the hyphen keeps thematic breaks (---) and em-dashes
# (--) from matching.
# One table cell that is only a separator: dashes with optional colons.
DASH_CELL = re.compile(r":?-+:?")
CELL_SPLIT = re.compile(r"(?<!\\)\|")
SEP_ROW = re.compile(r"^\s*\|(\s*:?-+:?\s*\|)+\s*$")
HYPHEN_SPLIT = re.compile(r"\w-$")
CALLOUT = re.compile(r"^\s*>\s*\[!([A-Za-z]+)\][+-]?\s+\S")
CALLOUT_HEAD = re.compile(r"^\s*>\s*\[!([A-Za-z-]+)\]([+-]?)(.*)$")
# Opaque IDs like D112, Z2b or E14: fine once defined, a wall when many are not.
OPAQUE_ID = re.compile(r"\b[A-Z]{1,2}\d{1,4}[a-z]?\b")
COMMON_ID = re.compile(r"^(?:[ABHL]\d{2,3}|[HL][1-6]|P\d{2}|Q[1-4]|M[1-5]|S3|EC2|K8s|X86|MP3|MP4|V\d|G\d|IPv\d|UTF8|ES\d{1,4}|C\d{1,2})$")
THIRD_PERSON = re.compile(r"\bthe (user|owner|assistant)('s)?\b", re.I)
QUOTED = re.compile(r'"[^"\n]*"|\u201c[^\u201d\n]*\u201d')

# Vault mode: the committed frontmatter in references/vault/conventions.md.
VAULT_TYPES = ("note", "moc", "paper", "sota", "math", "lab", "project", "spec",
               "interview", "home", "plan")
VAULT_STATUS = ("scaffold", "draft", "done")
VAULT_LIST_KEYS = ("tags", "track", "course", "prereqs", "sources", "aliases")
VAULT_DATE_KEYS = ("created", "due")
VAULT_DIFFICULTY = ("foundation", "intermediate", "advanced", "capstone")
# The committed key set (second-brain-obsidian's schema.COMMITTED), plus keys
# that configure a tool rather than describe the note and are left alone.
VAULT_KEYS = {"tags", "type", "track", "difficulty", "domain", "course",
              "prereqs", "estimated-hours", "status", "created", "project",
              "sources", "source_key", "aliases", "due"}
VAULT_TOOL_KEYS = {"mode", "model", "temperature", "permission"}
VAULT_BANNED = {
    "title": "drop it, or move a different-language title to aliases",
    "date": "use created", "estimated_hours": "use estimated-hours",
    "hours": "use estimated-hours", "prerequisites": "use prereqs",
    "source": "use sources", "category": "use type", "classification": "use type",
    "level": "split into difficulty and domain",
}
VAULT_BANNED.update(dict.fromkeys((
    "folder", "module", "layer", "scope", "name", "week", "professor", "exam",
    "syllabus", "market", "parent", "key", "hidden", "verified", "description",
    "author", "authors", "last-updated", "methodology", "semester",
    "supersedes", "version", "audience"), "not in the committed key set"))
# Basenames shared by several vault notes: a bare [[name]] picks one at random.
VAULT_AMBIGUOUS = {"readme", "00 readme", "skill", "00 home", "00 study plan",
                   "week 16 - capstone"}
WIKILINK = re.compile(r"\[\[([^\]|#^]+)")
TABLE_BR = re.compile(r"<br\s*/?>", re.I)


@dataclass
class Finding:
    code: str
    line: int
    msg: str
    level: str


def _frontmatter_bounds(lines):
    """Return the 0-based index of the closing '---', or 0 if absent."""
    if not lines or lines[0].strip() != "---":
        return 0
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return i
    return 0


def _check_frontmatter(lines, end):
    out = []
    if not end:
        out.append(Finding("frontmatter", 1, "missing YAML frontmatter",
                           "error"))
        return out
    keys = {}
    for line in lines[1:end]:
        if ":" in line:
            k, v = line.split(":", 1)
            keys[k.strip()] = v.strip()
    for req in ("title", "date", "type"):
        if req not in keys:
            out.append(Finding("frontmatter", 1,
                               f"frontmatter missing {req!r}", "error"))
    if "date" in keys and not DATE.fullmatch(keys["date"]):
        out.append(Finding("frontmatter", 1,
                           f"date must be YYYY-MM-DD, got {keys['date']!r}",
                           "error"))
    if keys.get("type") in LEGACY_TYPES:
        out.append(Finding("legacy-type", 1,
                           f"type {keys['type']!r} is now "
                           f"{LEGACY_TYPES[keys['type']]!r}", "warning"))
    elif "type" in keys and keys["type"] not in VALID_TYPES:
        out.append(Finding("frontmatter", 1,
                           f"type must be one of {list(VALID_TYPES)}, "
                           f"got {keys['type']!r}", "error"))
    VALID_STATUS = ("current", "draft", "superseded")
    if "status" in keys and keys["status"] not in VALID_STATUS:
        out.append(Finding("frontmatter", 1,
                           f"status must be one of {list(VALID_STATUS)}, "
                           f"got {keys['status']!r}", "error"))
    if keys.get("type") in STATUS_REQUIRED and "status" not in keys:
        out.append(Finding("frontmatter", 1,
                           f"type {keys['type']!r} requires a status field",
                           "error"))
    return out


def _yaml_scalar(v):
    """A plain YAML value as read: no trailing comment, no surrounding quotes."""
    v = v.strip()
    if v[:1] in ("'", '"'):
        end = v.find(v[0], 1)
        return v[1:end] if end > 0 else v
    return re.sub(r"\s+#.*$", "", v)


def _frontmatter_keys(lines, end):
    """Top-level keys to values, and the keys written as block lists.
    A block list (key: then '- x' lines) reads as '[x]'."""
    keys, block, last = {}, {}, None
    for line in lines[1:end]:
        item = re.match(r"\s*-\s+(.*)$", line)
        if last and item and (last in block or not keys[last]):
            block.setdefault(last, []).append(_yaml_scalar(item.group(1)))
            keys[last] = "[" + ", ".join(block[last]) + "]"
            continue
        if line.lstrip().startswith("#"):  # a YAML comment line
            continue
        if ":" in line and not line.startswith((" ", "\t")):
            k, v = line.split(":", 1)
            last = k.strip()
            keys[last] = _yaml_scalar(v)
    return keys, block


def _iso_date(v):
    try:
        return bool(DATE.fullmatch(v)) and bool(date.fromisoformat(v))
    except ValueError:
        return False


def _check_vault_frontmatter(lines, end):
    if not end:
        return [Finding("frontmatter", 1, "missing YAML frontmatter", "error")]
    out = []
    keys, block = _frontmatter_keys(lines, end)
    for req in ("tags", "type"):
        if not keys.get(req, "").strip("[] "):
            out.append(Finding("frontmatter", 1, f"frontmatter missing {req!r}", "error"))
    if "tags" in block:
        out.append(Finding("vault-tags-form", 1, "write tags inline: tags: [a, b]", "warning"))
    if "difficulty" in keys and keys["difficulty"] not in VAULT_DIFFICULTY:
        out.append(Finding("frontmatter", 1, f"difficulty must be one of {list(VAULT_DIFFICULTY)}, got {keys['difficulty']!r}", "error"))
    if "merge" in re.split(r"[\[\],\s]+", keys.get("track", "")):
        out.append(Finding("frontmatter", 1, "track 'merge' is written [M]", "error"))
    if "type" in keys and keys["type"] not in VAULT_TYPES:
        out.append(Finding("frontmatter", 1, f"type must be one of {list(VAULT_TYPES)}, got {keys['type']!r}", "error"))
    if "status" in keys and keys["status"] not in VAULT_STATUS:
        out.append(Finding("frontmatter", 1, f"status must be one of {list(VAULT_STATUS)}, got {keys['status']!r}", "error"))
    for k in VAULT_LIST_KEYS:
        if keys.get(k) and not keys[k].startswith("["):
            out.append(Finding("frontmatter", 1, f"{k} is always a list: {k}: [{keys[k]}]", "error"))
    for k in VAULT_DATE_KEYS:
        if k in keys and not _iso_date(keys[k]):
            out.append(Finding("frontmatter", 1, f"{k} must be YYYY-MM-DD, got {keys[k]!r}", "error"))
    for k in keys:
        if k in VAULT_BANNED:
            out.append(Finding("vault-key", 1, f"the vault never writes {k!r}: {VAULT_BANNED[k]}", "error"))
        elif k not in VAULT_KEYS | VAULT_TOOL_KEYS:
            # A warning: some folders carry a deliberate schema of their own
            # (job applications, story banks); drift spellings above are errors.
            out.append(Finding("vault-key", 1, f"{k!r} is not in the committed key set (references/vault/conventions.md); keep it only if this folder's notes share it on purpose", "warning"))
    for n, line in enumerate(lines[1:end], 2):
        out.extend(_vault_links(line, n))
    return out


def _vault_links(text, n):
    out = []
    for target in WIKILINK.findall(text):
        # "\|" is Obsidian's alias escape inside a table; ".md" is optional.
        target = target.strip().rstrip("\\").strip()
        name = target[:-3] if target.lower().endswith(".md") else target
        if target.startswith(("../", "./")):
            out.append(Finding("vault-link", n, f"relative wikilink [[{target}]] never resolves; link by note name", "error"))
        elif name.lower() in VAULT_AMBIGUOUS:
            out.append(Finding("vault-link", n, f"[[{target}]] matches several notes, even with a heading; use a fuller path or link to the parent MOC", "error"))
    return out


def _collapsed_table(line):
    """A row that swallowed the separator row: an empty cell (the join between
    two rows) followed by a dash cell. Dash cells on their own are data."""
    cells = [c.strip() for c in CELL_SPLIT.split(line.strip().strip("|"))]
    return any(not a and DASH_CELL.fullmatch(b) for a, b in zip(cells, cells[1:]))


def check(text, no_frontmatter=False, vault=False):
    lines = text.removeprefix("\ufeff").split("\n")
    fm_end = _frontmatter_bounds(lines)
    findings = []
    if not no_frontmatter:
        findings.extend(_check_vault_frontmatter(lines, fm_end) if vault
                        else _check_frontmatter(lines, fm_end))

    in_fence = False
    in_math = False
    wide_table = False  # one table-width error per table, not one per row
    table_sep = False  # the current table already has its separator row
    marker = ""
    for n, raw in enumerate(lines, 1):
        if fm_end and n <= fm_end + 1:
            continue
        line = raw.rstrip()

        m = FENCE.match(line)
        if m:
            run, info = m.group(1), m.group(2).strip()
            if not in_fence:
                in_fence, marker = True, run
                if not info:
                    findings.append(Finding("fence-lang", n,
                                            "code fence has no language tag",
                                            "error"))
            elif run[0] == marker[0] and len(run) >= len(marker) and not info:
                # CommonMark: a closing fence uses the same character, is at
                # least as long as the opener, and carries no info string.
                # A shorter run inside a longer fence is content, not a close.
                in_fence = False
            continue
        if in_fence:
            continue
        st = line.strip()
        # Display math is one unbreakable formula: no wrap or table checks.
        if in_math:
            in_math = not st.endswith("$$")
            continue
        if st.startswith("$$"):
            in_math = not (len(st) > 2 and st.endswith("$$"))
            continue

        row = line.lstrip(" \t>").lstrip()  # a table may sit in a callout or an indent
        if not row.startswith("|"):
            wide_table = table_sep = False
        elif SEP_ROW.match(row):
            table_sep = True
        if row.startswith("|") and not table_sep and _collapsed_table(row):
            findings.append(Finding(
                "broken-table", n,
                "a table has collapsed into one line; check the separator row "
                "has one cell per column", "error"))
        elif line.startswith("|"):
            # Obsidian soft-wraps; width limits serve the terminal only.
            if len(line) > MAX_TABLE and not wide_table and not vault:
                wide_table = True
                findings.append(Finding(
                    "table-width", n,
                    f"table rows are {len(line)} chars (max {MAX_TABLE}); "
                    "shorten the widest cell, since prettier pads every row to it",
                    "error"))
        elif len(line) > MAX_PROSE and not vault:
            # Exempt only lines that cannot be wrapped shorter — a single
            # token that would overflow even alone on its own indented line.
            indent = len(line) - len(line.lstrip())
            # An inline-code span cannot be broken, so its whole length is
            # one unbreakable token — measuring its words separately would
            # flag a line that no amount of wrapping could shorten.
            spans = [len(m.group(0)) for m in INLINE_CODE.finditer(line)]
            words = [len(t) for t in INLINE_CODE.sub(" ", line).split()]
            longest = max(spans + words + [0])
            if longest + indent < MAX_PROSE:
                findings.append(Finding(
                    "wrap", n,
                    f"prose line is {len(line)} chars (max {MAX_PROSE})",
                    "error"))

        h = HEADING.match(line)
        if h and len(h.group(1)) > 3:
            findings.append(Finding(
                "heading-depth", n,
                f"heading is H{len(h.group(1))}; max is H3", "error"))

        # A word inside backticks is being named, not used. Strip inline
        # code so "don't write `TODO`" isn't itself flagged as a TODO.
        scan = INLINE_CODE.sub(" ", line)

        # A vault table cell cannot hold a paragraph break; <br> is the one tag allowed.
        if vault and line.lstrip(" \t>").startswith("|"):
            scan = TABLE_BR.sub(" ", scan)
        if HTML_TAG.search(scan):
            findings.append(Finding("raw-html", n, "raw HTML tag", "error"))

        if vault:
            findings.extend(_vault_links(scan, n))

        if PLACEHOLDER.search(scan):
            findings.append(Finding("placeholder", n, "placeholder text",
                                    "error"))

        if HYPHEN_SPLIT.search(line) and n < len(lines):
            nxt = lines[n].lstrip().lstrip(">").lstrip()
            if nxt and nxt[0].isalnum():
                findings.append(Finding(
                    "hyphen-split", n,
                    f"line ends mid-word at a hyphen; renders as "
                    f"'{line.split()[-1]} {nxt.split()[0]}' with a space",
                    "warning"))

        head = CALLOUT_HEAD.match(line)
        if head and any(c.isupper() for c in head.group(1)):
            findings.append(Finding(
                "callout-case", n,
                f"write the callout type in lowercase ([!{head.group(1).lower()}]) "
                "so markview and Obsidian read it the same way", "warning"))

        # The vault is never rewrapped, so its body-on-next-line callouts stay intact.
        if CALLOUT.match(line) and n < len(lines) and not vault:
            nxt = lines[n].strip()
            if nxt.startswith(">") and nxt.lstrip(">").strip():
                findings.append(Finding(
                    "callout-collapsed", n,
                    "text shares the callout marker's line and becomes its "
                    "title; put a short title here and the body after a "
                    "blank quote line",
                    "warning"))

        low = scan.lower()
        for word in HYPE:
            if re.search(rf"\b{re.escape(word)}\b", low):
                findings.append(Finding("hype", n, f"hype word {word!r}",
                                        "warning"))
    # Vault types are note kinds, not genres: no genre budget or learn checks.
    dtype = "" if vault else _doc_type(lines, fm_end)
    findings.extend(_check_reader_load(lines, fm_end, dtype, vault))
    return findings


# ── reader load ───────────────────────────────────────────────────────────────
# Rendering rules say whether a document displays; these say whether it can be
# read: a short answer first, terms defined, one idea per sentence, a picture
# where prose would be a wall, and a length that fits the genre.

def _doc_type(lines, fm_end):
    for line in lines[1:fm_end]:
        if line.startswith("type:"):
            t = line.split(":", 1)[1].strip()
            return LEGACY_TYPES.get(t, t)
    return ""


def _blocks(lines, fm_end):
    """Yield (kind, first line number, [lines]) outside frontmatter:
    kind is fence, table, heading, callout, list, para or blank."""
    i = fm_end + 1 if fm_end else 0
    n = len(lines)
    while i < n:
        line = lines[i]
        m = FENCE.match(line)
        if m:
            run, start = m.group(1), i
            i += 1
            while i < n:
                c = FENCE.match(lines[i])
                if c and c.group(1)[0] == run[0] and len(c.group(1)) >= len(run) and not c.group(2).strip():
                    break
                i += 1
            yield "fence", start + 1, lines[start:i + 1]
            i += 1
            continue
        st = line.strip()
        if not st:
            i += 1
            continue
        if HEADING.match(line):
            yield "heading", i + 1, [line]
            i += 1
            continue
        kind = ("table" if st.startswith("|") else "callout" if st.startswith(">")
                else "list" if re.match(r"([-*+]|\d+[.)])\s", st) else
                "math" if st.startswith("$$") else "para")
        start, buf = i, [line]
        i += 1
        if kind == "math":
            one_line = st.endswith("$$") and len(st) > 4  # $$x = 1$$
            while not one_line and i < n:
                buf.append(lines[i]); i += 1
                if lines[i - 1].strip().endswith("$$"):
                    break
            yield kind, start + 1, buf
            continue
        while i < n and lines[i].strip() and not HEADING.match(lines[i]) and not FENCE.match(lines[i]):
            nxt = lines[i].strip()
            if kind == "callout" and not nxt.startswith(">"):
                break
            if kind != "callout" and nxt.startswith(">"):
                break
            if kind == "list" and re.match(r"([-*+]|\d+[.)])\s", nxt):
                yield kind, start + 1, buf
                start, buf = i, []
            buf.append(lines[i]); i += 1
        yield kind, start + 1, buf


def _plain(text):
    """Prose as read: no inline code, link targets, math, emphasis or markers."""
    text = INLINE_CODE.sub(" ", text)
    text = re.sub(r"\$[^$\n]+\$", " x ", text)
    text = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\[\[([^\]|]*\|)?([^\]]*)\]\]", r"\2", text)
    text = re.sub(r"^\s*(>\s*)+", "", text, flags=re.M)
    text = re.sub(r"^\s*([-*+]|\d+[.)])\s+", "", text, flags=re.M)
    return re.sub(r"[*_]{1,3}", "", text)


_QUOTE = r"\s*(?:>\s*)*"
CALLOUT_TITLE = re.compile(r"\s*(?:>\s*)+\[![A-Za-z-]+\][-+]?")
IMAGE_LINE = re.compile(_QUOTE + r"!(?:\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\))\s*")
QUOTE_ONLY = re.compile(r"\s*(?:>\s*)*")
# A line's quote marks (each takes one space after it), then its indent.
QUOTE_LEAD = re.compile(r"((?: {0,3}> ?)*)( *)")
# A list marker with text after it: a bullet, or up to nine digits and . or ).
LIST_MARKER = re.compile(r"(?:[-*+]|(\d{1,9})[.)])( +)(?=\S)")
THEMATIC_BREAK = re.compile(r"([-*_])(?: *\1){2,} *")


def _units(text):
    """Cut prose where markdown ends a paragraph without a full stop: before a
    list item, at an empty quote line, after a callout title, and around an
    image line. Image lines and empty lines hold no prose and are dropped.

    The two ways to be wrong are not equal. A wrong join gives a warning the
    writer can read and dismiss. A wrong cut hides a long sentence. So a cut is
    made only where CommonMark certainly ends the paragraph, and never from how
    a line ends: prose is wrapped at 80 columns, so a line end says nothing.

    `items` holds the list items that are open, as (marker indent, content
    indent). With `blk` the content indent of the innermost one (0 for none):

    - a line indented 4 or more past `blk` continues the paragraph;
    - a line inside the item starts a list only with a bullet or with "1"
      (CommonMark: only "1." may interrupt a paragraph);
    - a line to the left of `blk` ends the item with any marker, any number,
      unless it is 4 or more past the item that holds the list;
    - after an empty line no paragraph is open, so any marker starts an item.

    Whenever the state is in doubt (a line that falls back to the left with no
    marker, a change of quote depth), `items` is emptied. An empty state can
    only join; it never cuts where markdown continues."""
    unit = []
    items = []  # open list items, outermost first: (marker indent, content indent)
    depth = None  # quote depth of the line above
    opened = False  # a paragraph is open: the line above is prose
    for line in text.split("\n"):
        image = IMAGE_LINE.fullmatch(line)
        title = CALLOUT_TITLE.match(line)
        quote, pad = QUOTE_LEAD.match(line).groups()
        rest = line[len(quote) + len(pad):]
        # A row of ---, *** or ___ ends a paragraph only when it is indented less
        # than 4; further in, markdown may read it as text. Either way it is
        # never a list item, and what it does to the open items is in doubt.
        rule = THEMATIC_BREAK.fullmatch(rest)
        if rule and len(pad) >= 4:
            items, rule = [], None
            rest = ""
        if image or title or rule or QUOTE_ONLY.fullmatch(line):
            if unit:
                yield "\n".join(unit)
                unit = []
            if title:
                yield line
            if title or rule:
                items = []
            opened = False
            continue
        indent = len(pad)
        if depth is not None and quote.count(">") != depth:
            items = []
        depth = quote.count(">")
        marker = LIST_MARKER.match(rest)
        if marker:
            gap = len(marker.group(2))
            content = indent + marker.end() - gap + (gap if gap <= 4 else 1)
            first = marker.group(1) is None or int(marker.group(1)) == 1
        cut = False
        blk = items[-1][1] if items else 0  # content indent of the innermost item
        outer = items[-2][1] if len(items) > 1 else 0  # and of the item its list sits in
        if not opened:
            while items and items[-1][1] > indent:
                items.pop()
            if marker and indent - (items[-1][1] if items else 0) < 4:
                items.append((indent, content))
        elif indent >= blk:
            if marker and first and indent - blk < 4:
                cut = True
                items.append((indent, content))
        elif marker and indent - outer < 4:
            cut = True
            while items and items[-1][1] > indent:
                items.pop()
            if indent - (items[-1][1] if items else 0) < 4:
                items.append((indent, content))
            else:
                items = []
        else:
            items = []
        if cut and unit:
            yield "\n".join(unit)
            unit = []
        unit.append(line)
        opened = True
    if unit:
        yield "\n".join(unit)


def _sentences(text, cut=True):
    """Sentences as read. With cut=False the text is one run of prose, split
    at full stops only: the count that `lead-long` has always used."""
    out = []
    for unit in _units(text) if cut else [text]:
        flat = " ".join(_plain(unit).split())
        out.extend(x for x in re.split(r"(?<=[.!?])\s+", flat) if x.strip())
    return out


def _words(sentence):
    """Words as read: a bare dash, middot or bullet is a separator, not a word."""
    return [w for w in sentence.split() if re.search(r"\w", w)]


def _wc(text):
    return len([w for w in _plain(text).split() if re.search(r"\w", w)])


def _check_reader_load(lines, fm_end, dtype, vault=False):
    out = []
    blocks = list(_blocks(lines, fm_end))
    prose = [(k, at, b) for k, at, b in blocks if k in ("para", "list", "callout")]

    # The lead: what sits between the H1 and the first H2.
    h1 = next((j for j, (k, _, b) in enumerate(blocks) if k == "heading" and b[0].startswith("# ")), None)
    if h1 is not None:
        lead = []
        for k, at, b in blocks[h1 + 1:]:
            if k == "heading":
                break
            lead.append((k, at, b))
        tl = next((j for j, (k, _, b) in enumerate(lead) if k == "callout" and re.match(r"\s*>\s*\[!tldr\]", b[0], re.I)), None)
        # The vault's established lead is a plain one-line blockquote under the H1.
        lede = None if tl is not None or not vault else next(
            (j for j, (k, _, b) in enumerate(lead) if k == "callout" and not re.match(r"\s*>\s*\[!", b[0])), None)
        if tl is not None or lede is not None:
            k, at, b = lead[tl if tl is not None else lede]
            # A callout's marker line is its title; a plain blockquote is all body.
            body_words = _wc("\n".join(b[1:] if tl is not None else b))
            tl = tl if tl is not None else lede
            if body_words > TLDR_WORDS:
                out.append(Finding("lead-long", at, f"the TLDR is {body_words} words (max {TLDR_WORDS}); say the answer, move the rest below", "warning"))
            before = sum(_wc("\n".join(x)) for kk, _, x in lead[:tl] if kk in ("para", "list"))
            if before > 40:
                out.append(Finding("lead-late", lead[0][1], f"{before} words come before the TLDR; put the answer first and method, sources or caveats after it", "warning"))
        else:
            first = next(((at, b) for k, at, b in lead if k == "para"), None)
            if first and len(_sentences("\n".join(first[1]), cut=False)) > 3:
                out.append(Finding("lead-long", first[0], "the opening paragraph has more than 3 sentences; open with a short answer (a [!tldr] callout of at most 60 words)", "warning"))

    # Opaque IDs, third person, sentence length, density.
    text = "\n".join("\n".join(b) for k, _, b in prose)
    plain = _plain(text)
    ids = sorted({m for m in OPAQUE_ID.findall(plain) if not COMMON_ID.match(m)})
    if len(ids) >= 5:
        out.append(Finding("undefined-id", 1, f"{len(ids)} opaque IDs ({', '.join(ids[:8])}{'…' if len(ids) > 8 else ''}); give each a name, or define it once where it first appears", "warning"))
    for k, at, b in prose:
        if THIRD_PERSON.search(QUOTED.sub(" ", INLINE_CODE.sub(" ", "\n".join(b)))):
            out.append(Finding("reader-third", at, "writes about the reader as 'the user' or 'the owner'; write to them, and leave out how the work was done", "warning"))
            break
    long_ones = [(at, len(_words(x))) for k, at, b in prose for x in _sentences("\n".join(b)) if len(_words(x)) > 30]
    for at, n_words in long_ones[:5]:
        out.append(Finding("prose-long", at, f"a {n_words}-word sentence; split it, one idea per sentence", "warning"))
    total = _wc(text)
    if total >= 100:
        raw = INLINE_CODE.sub(" ", text)
        parens, dashes = raw.count("("), raw.count("\u2014") + len(re.findall(r"\s--\s", raw))
        if parens * 1000 / total > 25:
            out.append(Finding("paren-dense", 1, f"{parens} parentheses in {total} words; move asides into their own sentences", "warning"))
        if dashes * 1000 / total > 10:
            out.append(Finding("dash-dense", 1, f"{dashes} dashes in {total} words; end the sentence instead", "warning"))
    practice = re.compile(r"\s*>\s*\[!(question|success|abstract)\]", re.I)
    read = sum(_wc("\n".join(b)) for k, _, b in prose
               if not (dtype == "learn" and k == "callout" and practice.match(b[0])))
    read += sum(_wc(" ".join(x for x in b if not re.match(r"^\s*\|[\s:|-]+\|\s*$", x)).replace("|", " "))
                for k, _, b in blocks if k == "table")
    if dtype in BUDGET and read > BUDGET[dtype]:
        out.append(Finding("too-long", 1, f"{read} words to read (prose and tables); a {dtype} fits in about {BUDGET[dtype]}. Cut, or move detail to a linked doc", "warning"))

    # Sections that are walls of text.
    sections, cur = [], None
    for k, at, b in blocks:
        if k == "heading" and b[0].startswith("## "):
            cur = [b[0][3:].strip(), at, 0, False]
            sections.append(cur)
        elif cur is not None:
            if k in ("para", "list", "callout"):
                if k == "para":  # a list is already structure; walls are paragraphs
                    cur[2] += _wc("\n".join(b))
                if any(re.search(r"!\[[^\]]*\]\(|!\[\[", x) for x in b):
                    cur[3] = True
            elif k in ("fence", "table", "math"):
                cur[3] = True
    for name, at, wc, visual in sections:
        if wc > 250 and not visual:
            out.append(Finding("no-visual", at, f"section '{name}' is {wc} words with no table, diagram, math or image; pick a representation for its main idea", "warning"))

    if dtype == "learn":
        out.extend(_check_learn(blocks, sections))
    return out


def _check_learn(blocks, sections):
    out = []
    if sections and not re.match(r"worked example", sections[0][0], re.I):
        out.append(Finding("example-late", sections[0][1], "a learn doc opens with '## Worked example: …', one end-to-end case with real numbers, before the parts", "warning"))
    callouts = [(at, b) for k, at, b in blocks if k == "callout"]
    questions = [j for j, (at, b) in enumerate(callouts) if re.match(r"\s*>\s*\[!question\]", b[0], re.I)]
    if len(sections) >= 3 and not questions:
        out.append(Finding("no-check", sections[-1][1], "no check question; end each part with a > [!question] and a folded > [!success]- answer", "warning"))
    for j in questions:
        at, b = callouts[j]
        ans = callouts[j + 1] if j + 1 < len(callouts) else None
        if ans is None or not re.match(r"\s*>\s*\[!success\]", ans[1][0], re.I):
            continue
        head = CALLOUT_HEAD.match(ans[1][0])
        if head and head.group(2) != "-":
            out.append(Finding("answer-visible", ans[0], "the answer shows before the reader tries; fold it with > [!success]-", "warning"))
        opts = {}
        for x in b:
            m = re.match(r"\s*>\s*[-*]\s+(?:\*\*)?([a-e])[.)](?:\*\*)?\s+(.*)$", x)
            if m:
                opts[m.group(1)] = len(_plain(m.group(2)).strip())
        letter = re.search(r"\*\*([a-e])[.)]?\*\*", "\n".join(ans[1]))
        if letter and letter.group(1) in opts and len(opts) >= 3:
            a = letter.group(1)
            others = [v for k, v in opts.items() if k != a]
            if opts[a] > 1.35 * max(others):
                out.append(Finding("options-uneven", at, "the answer is much longer than the other options; make them the same length and shape", "warning"))
    return out


def main():
    ap = argparse.ArgumentParser(description="Validate markdown documents.")
    ap.add_argument("paths", nargs="+", type=Path)
    ap.add_argument("--no-frontmatter", action="store_true",
                    help="skip document frontmatter checks (skill files)")
    ap.add_argument("--vault", action="store_true",
                    help="check an Obsidian vault note against the vault conventions")
    ap.add_argument("--strict", action="store_true",
                    help="treat warnings as errors")
    args = ap.parse_args()

    failed = False
    for path in args.paths:
        text = path.read_text(encoding="utf-8")
        for f in check(text, no_frontmatter=args.no_frontmatter, vault=args.vault):
            print(f"{path}:{f.line}: [{f.level}] {f.code}: {f.msg}")
            if f.level == "error" or args.strict:
                failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
