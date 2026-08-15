#!/usr/bin/env python3
"""Validate a markdown document against the writing-markdown-docs rules.

Usage:
    python3 check_doc.py PATH [PATH ...] [--no-frontmatter] [--strict]

Exit 0 when clean, 1 when any error is found (or any warning with --strict).
"""
import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

MAX_PROSE = 80
MAX_TABLE = 100
VALID_TYPES = ("analysis", "design", "handoff", "lookup", "rca", "report",
               "runbook", "teaching")
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
HYPHEN_SPLIT = re.compile(r"\w-$")
CALLOUT = re.compile(r"^\s*>\s*\[!([A-Z]+)\]\s+\S")


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
    if "type" in keys and keys["type"] not in VALID_TYPES:
        out.append(Finding("frontmatter", 1,
                           f"type must be one of {list(VALID_TYPES)}, "
                           f"got {keys['type']!r}", "error"))
    VALID_STATUS = ("current", "draft", "superseded")
    if "status" in keys and keys["status"] not in VALID_STATUS:
        out.append(Finding("frontmatter", 1,
                           f"status must be one of {list(VALID_STATUS)}, "
                           f"got {keys['status']!r}", "error"))
    if keys.get("type") in ("handoff", "report", "analysis", "design",
                             "runbook", "lookup") and "status" not in keys:
        out.append(Finding("frontmatter", 1,
                           f"type {keys['type']!r} requires a status field",
                           "error"))
    return out


def check(text, no_frontmatter=False):
    lines = text.split("\n")
    fm_end = _frontmatter_bounds(lines)
    findings = []
    if not no_frontmatter:
        findings.extend(_check_frontmatter(lines, fm_end))

    in_fence = False
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

        if line.startswith("|"):
            if len(line) > MAX_TABLE:
                findings.append(Finding(
                    "table-width", n,
                    f"table row is {len(line)} chars (max {MAX_TABLE})",
                    "error"))
        elif len(line) > MAX_PROSE:
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

        if HTML_TAG.search(scan):
            findings.append(Finding("raw-html", n, "raw HTML tag", "error"))

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

        if CALLOUT.match(line) and n < len(lines):
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
    return findings


def main():
    ap = argparse.ArgumentParser(description="Validate markdown documents.")
    ap.add_argument("paths", nargs="+", type=Path)
    ap.add_argument("--no-frontmatter", action="store_true",
                    help="skip document frontmatter checks (skill files)")
    ap.add_argument("--strict", action="store_true",
                    help="treat warnings as errors")
    args = ap.parse_args()

    failed = False
    for path in args.paths:
        text = path.read_text(encoding="utf-8")
        for f in check(text, no_frontmatter=args.no_frontmatter):
            print(f"{path}:{f.line}: [{f.level}] {f.code}: {f.msg}")
            if f.level == "error" or args.strict:
                failed = True
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
