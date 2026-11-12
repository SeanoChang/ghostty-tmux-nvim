#!/usr/bin/env python3
"""Build config/codex/AGENTS.md, the rules Codex loads, from two sources.

  config/claude/CLAUDE.md     the root: every rule is written once, here
  config/codex/AGENTS.src.md  the Codex frame: what is only for Codex, and
                              where each rule from the root goes

Why: the two rule files were kept in step by hand. Twelve commits changed
CLAUDE.md in ten days and none of them changed AGENTS.md.

In CLAUDE.md a line `<!-- rule: name -->` starts a named rule. The rule runs
to the next such line, the next heading, or the end of the file. Claude Code
leaves HTML comments out when it loads the file, so the names cost a session
nothing.

The build reads CLAUDE.md line by line; Claude Code reads it as Markdown. So
the build takes only lines that both read the same way, and stops at any
other. Outside a rule a line is blank, a heading (one to six `#`, then a
blank or the line end), or part of a comment that ends, with nothing after
its end on that line. A line that starts with `#` and is not such a heading
stops the build, in a rule too: to Claude Code it is text.

AGENTS.src.md must say what happens to every rule, in one of three ways:

  {{rule: name}}                   the rule's text goes here, word for word
  <!-- adapts: name@hash -->       Codex has its own wording, on the lines
                                   below. The hash is of the root's text when
                                   the wording was written: when the root
                                   changes, the build stops until someone has
                                   read both and set the new hash.
  <!-- claude-only: name, ... -->  the rule is not for Codex

So a new rule, or a changed one, cannot stay out of the Codex file without a
decision. Codex shows HTML comments to the model, so the built file has none
but its first line.

Usage:
  build_agents_md.py            write AGENTS.md
  build_agents_md.py --check    exit 1 when AGENTS.md is not what a build gives
  build_agents_md.py --hashes   print each rule's name and hash
"""
import hashlib
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent / "claude" / "CLAUDE.md"
FRAME = HERE / "AGENTS.src.md"
BUILT = HERE / "AGENTS.md"

NAME = r"[a-z0-9]+(?:[.-][a-z0-9]+)*"
RULE = re.compile(rf"<!-- rule: ({NAME}) -->")
HEADING = re.compile(r"#{1,6}(?: .*)?")
PLACE = re.compile(rf"\{{\{{rule: ({NAME})\}}\}}")
ADAPTS = re.compile(rf"<!-- adapts: ({NAME})@([0-9a-f]+) -->")
CLAUDE_ONLY = re.compile(rf"<!-- claude-only: ({NAME}(?:, {NAME})*) -->")
BANNER = "<!-- Built by build_agents_md.py from ../claude/CLAUDE.md and AGENTS.src.md. Do not edit. -->"


class BuildError(Exception):
    """The two sources do not agree. The message says what to change."""


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:10]


def rules(root_text):
    """The named rules of the root file, in order: {name: text}.

    Text that is in no rule may only be a heading, a blank line, or an HTML
    comment that is not a rule name: anything else would be a rule that the
    Codex file never has to account for."""
    found, name, lines, comment_from = {}, None, [], 0

    def comment_end(number, line, start):
        """Whether the comment ends on this line. Text after its end is text
        to Claude Code, so there must be none."""
        end = line.find("-->", start)
        if end == -1:
            return False
        if line[end + 3:].strip():
            raise BuildError(
                f"CLAUDE.md:{number}: text after the end of a comment: {line[end + 3:].strip()[:60]!r}. "
                "Claude Code loads it. Put it on a line of its own, under a rule name."
            )
        return True

    def close():
        if name is None:
            return
        while lines and not lines[-1].strip():
            lines.pop()
        if not lines:
            raise BuildError(f"CLAUDE.md: the rule {name!r} has no text")
        found[name] = "\n".join(lines)

    for number, line in enumerate(root_text.splitlines(), 1):
        if comment_from:
            if comment_end(number, line, 0):
                comment_from = 0
            continue
        start = RULE.fullmatch(line)
        if start:
            close()
            name, lines = start.group(1), []
            if name in found:
                raise BuildError(f"CLAUDE.md:{number}: the rule name {name!r} is used twice")
            continue
        if line.lstrip().startswith("<!-- rule"):
            raise BuildError(f"CLAUDE.md:{number}: not a rule name line: {line!r}")
        if line.startswith("<!--") and name is None:
            # The end is looked for from the third character, so `<!-->` and `<!--->` end at once, as in the
            # Markdown reader of Claude Code. (Its stripping step keeps a line that is only that: docs/known-limits.md.)
            if not comment_end(number, line, 2):
                comment_from = number
            continue
        if line.startswith("#"):
            if not HEADING.fullmatch(line):
                raise BuildError(
                    f"CLAUDE.md:{number}: starts with # but is not a heading: {line[:60]!r}. A heading is one to "
                    "six # and then a blank. Claude Code loads this line as text, so write it another way."
                )
            close()
            name, lines = None, []
            continue
        if name is None:
            if line.strip():
                raise BuildError(
                    f"CLAUDE.md:{number}: text outside a named rule: {line.strip()[:60]!r}. "
                    "Put a `<!-- rule: name -->` line above it, then say in "
                    "AGENTS.src.md what Codex gets."
                )
            continue
        if "<!--" in line:
            raise BuildError(f"CLAUDE.md:{number}: an HTML comment inside the rule {name!r}")
        lines.append(line)
    if comment_from:
        raise BuildError(
            f"CLAUDE.md:{comment_from}: a comment that is never closed. Claude Code loads what comes after it."
        )
    close()
    return found


def build(root_text, frame_text):
    """The text of AGENTS.md. Raises BuildError when a rule has no decision,
    two decisions, an unknown name, or a hash that no longer fits."""
    known = rules(root_text)
    decided, out, problems = {}, [], []

    def decide(name, how, number):
        if name not in known:
            problems.append(f"AGENTS.src.md:{number}: no rule named {name!r} in CLAUDE.md")
        elif name in decided:
            problems.append(f"AGENTS.src.md:{number}: {name!r} is already decided ({decided[name]})")
        else:
            decided[name] = how

    for number, line in enumerate(frame_text.splitlines(), 1):
        place, adapts, only = PLACE.fullmatch(line), ADAPTS.fullmatch(line), CLAUDE_ONLY.fullmatch(line)
        if place:
            decide(place.group(1), "placed", number)
            out.append(known.get(place.group(1), ""))
        elif adapts:
            name, was = adapts.groups()
            decide(name, "adapted", number)
            if name in known and digest(known[name]) != was:
                problems.append(
                    f"AGENTS.src.md:{number}: the rule {name!r} changed in CLAUDE.md since the Codex "
                    f"wording was written. Read both, update the Codex wording when it needs it, "
                    f"then set the hash to {digest(known[name])}."
                )
        elif only:
            for name in only.group(1).split(", "):
                decide(name, "claude-only", number)
        elif "<!--" in line or "-->" in line or "{{" in line or "}}" in line:
            problems.append(f"AGENTS.src.md:{number}: not a line this build knows: {line.strip()[:70]!r}")
        else:
            out.append(line)
    for name in known:
        if name not in decided:
            problems.append(
                f"the rule {name!r} in CLAUDE.md has no decision in AGENTS.src.md: place it "
                f"({{{{rule: {name}}}}}), adapt it (<!-- adapts: {name}@{digest(known[name])} -->), "
                f"or list it under claude-only"
            )
    if problems:
        raise BuildError("\n".join(problems))
    if not out or not out[0].startswith("# "):
        raise BuildError("AGENTS.src.md: the first line must be the `# ` title")
    text = "\n".join([out[0], "", BANNER] + out[1:])
    return re.sub(r"\n{3,}", "\n\n", text).rstrip("\n") + "\n"


def main(argv):
    root_text = ROOT.read_text(encoding="utf-8")
    if argv == ["--hashes"]:
        for name, text in rules(root_text).items():
            print(f"{digest(text)}  {name}")
        return 0
    try:
        text = build(root_text, FRAME.read_text(encoding="utf-8"))
    except BuildError as err:
        print(err, file=sys.stderr)
        return 1
    if argv == ["--check"]:
        if not BUILT.exists() or BUILT.read_text(encoding="utf-8") != text:
            print("AGENTS.md is stale: run config/codex/build_agents_md.py", file=sys.stderr)
            return 1
        return 0
    if argv:
        print(__doc__.split("Usage:")[1], file=sys.stderr)
        return 2
    BUILT.write_text(text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
