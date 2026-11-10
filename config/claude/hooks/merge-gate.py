#!/usr/bin/env python3
"""PreToolUse hook (matcher: Bash): gate `gh pr merge`.

An agent may merge a task PR into the integration branch without asking when
all of this holds for the PR's head commit:

  1. The command is plain `gh pr merge` alone, with a merge method and
     `--match-head-commit <full sha>`, and none of --admin, --auto,
     --disable-auto, --delete-branch.
  2. The PR is open, not a draft, and its base is the integration branch:
     one of `dev`, `develop`, `development` or `integration`. When
     $MERGE_GATE_BASE is set, only that branch counts. Any other name, such
     as `staging`, needs the setting: such a branch often deploys. Sean sets
     it, never the agent. `main`, `master` and `trunk` are refused whatever
     the setting says.
  3. The sha is the PR's current head.
  4. Every CI check on that commit is green, and at least one ran and
     succeeded (skipped and neutral checks alone do not count).
  5. A PR comment written by the authenticated user, not minimized, has the
     line `review: pass <sha> tier=<0|1|2> important=0`, with ` adversary=held`
     at the end when the tier is 2. The highest tier claimed for the commit
     decides, so a tier=1 line cannot replace an unfinished tier=2 review.

Then the hook returns "allow" together with a command it rebuilt from the
arguments it validated, so what runs is what was checked. Otherwise it returns
"deny". A problem in the arguments (1) is reported first, without a lookup on
GitHub; the PR conditions (2 to 5) are then reported together. The lookup
(`gh pr view`) has one time limit, $MERGE_GATE_TIMEOUT seconds (default 20),
and may print at most 16 MB; past either limit the answer is a deny.

Which commands get a decision: only a command whose text begins with plain
`gh pr merge` (blanks and newlines may come first). Bash always runs such a
command as a merge, so the hook can say allow or deny. The one exception is
a help request written in plain words (`gh pr merge --help`): it gets no
decision, because gh then prints help and merges nothing. Every other command
gets no decision, and the normal permission flow applies. So does a payload
that Python cannot parse (an integer of thousands of digits, nesting far too
deep): the hook cannot read its command. That includes a
merge behind `cd x &&`, an env prefix, a wrapper such as `timeout`, a path
such as `/opt/homebrew/bin/gh`, or a quoted spelling. The hook does not look
for a merge inside a larger command: that needs a full model of bash, and a
partial model misreads text that never runs (`arr=(gh pr merge)`).

This guards against drift in a cooperative agent. It is not a security
boundary: `gh api`, `git push` to the integration branch, and every merge
that does not begin the command do not pass through it. There is on purpose
no `Bash(gh pr merge*)` allow rule, so anything the hook does not approve
still goes through the normal permission flow.

Tests: python3 -m pytest ~/.claude/hooks/tests/test_merge_gate.py -q
"""
import json
import os
import re
import select
import shlex
import signal
import subprocess
import sys
import time

OPERATOR_CHARS = "();<>|&\n"
DEFAULT_TIMEOUT = 20.0  # seconds for the `gh pr view` lookup
MAX_OUTPUT = 16 * 1024 * 1024  # bytes it may print; a PR with a thousand comments is a few MB

METHODS = {"--squash": "s", "--merge": "m", "--rebase": "r"}
VALUE_FLAGS = {
    "--repo": "R", "--match-head-commit": None, "--subject": "t",
    "--body": "b", "--body-file": "F", "--author-email": "A",
}
FORBIDDEN = {
    "--admin": "it bypasses branch protection",
    "--auto": "it would merge a later, unreviewed commit",
    "--disable-auto": "it is not a merge",
    "--delete-branch": "agents never delete branches",
}
SHORT = {"d": "--delete-branch"}
SHORT.update({short: name for name, short in METHODS.items()})
SHORT.update({short: name for name, short in VALUE_FLAGS.items() if short})
ONCE = {"--repo", "--match-head-commit"}
TEXT_ORDER = ["--subject", "--body", "--body-file", "--author-email"]

SHA = re.compile(r"[0-9a-f]{40}")
SELECTOR = re.compile(
    r"[1-9]\d{0,9}"
    r"|https://[\w.-]+/[\w.-]+/[\w.-]+/pull/\d+"
    r"|[A-Za-z0-9][\w./:-]{0,250}"
)
REPO = re.compile(r"[\w.-]+/[\w.-]+(/[\w.-]+)?")
REVIEW_LINE = re.compile(
    r"review: pass (?P<sha>[0-9a-f]{40}) tier=(?P<tier>[012]) important=0(?P<held> adversary=held)?"
)
GREEN = {"SUCCESS", "NEUTRAL", "SKIPPED"}
FIELDS = "number,url,state,isDraft,baseRefName,headRefOid,statusCheckRollup,comments"
# Branch names the hook takes as an integration branch. Any other name needs
# $MERGE_GATE_BASE, which then is the only base accepted. `staging` is left
# out on purpose: in many repos a merge into it starts a deploy.
INTEGRATION_BASES = ("dev", "develop", "development", "integration")
# Never a base for an agent merge, in any letter case, even when
# $MERGE_GATE_BASE names it: an agent that set the variable itself must not be
# able to open the gate to the release branch.
RELEASE_BASES = ("main", "master", "trunk")

# The command begins with plain `gh pr merge`. Only space, tab and newline may
# come first: they are the blanks bash skips. `merge` must end the word, so
# `merge-queue` and `merge"d"` do not match.
BEGINS_WITH_MERGE = re.compile(r"[ \t\n]*gh[ \t]+pr[ \t]+merge(?=[ \t\n;&|<>()]|\Z)")
# The whole command is plain words: letters, digits and `_ @ % + = : , . / -`.
# Bash passes such words to gh exactly as written. It has no quote or escape
# to remove and no brace, glob, tilde or `!` to expand.
PLAIN_WORDS = re.compile(r"[ \t\n]*gh[ \t]+pr[ \t]+merge(?:[ \t]+[A-Za-z0-9_@%+=:,./-]+)*[ \t\n]*\Z")
# Marks of syntax the tokenizer does not model: expansion, command
# substitution, $'..' quoting, here-documents.
UNMODELLED = ("$", "`", "<<")

EXAMPLE = "gh pr merge <number> --squash --match-head-commit <full 40-character sha>"
NOT_LITERAL = (
    "This `gh pr merge` uses `$`, a backtick or a here-document. Write it with literal "
    f"values, alone in its own Bash call: `{EXAMPLE}`. Get the number and the sha with "
    "separate commands first."
)
NOT_ALONE = (
    "This command begins with `gh pr merge` and has more after it: a pipe, a redirect, "
    "`&&`, `;`, `&` or a second line. Run the merge alone, as its own Bash call: "
    f"`{EXAMPLE}`. Use -R owner/repo for another repository."
)
UNBALANCED = (
    "This `gh pr merge` has an unbalanced quote, so bash cannot run it. Write it again "
    f"with every quote closed: `{EXAMPLE}`."
)
UNWRITABLE = (
    "The merge gate could not write its answer, because the tool input holds a number "
    "or a nesting that JSON cannot carry. Run the merge again with only the command."
)
HELP_NOT_PLAIN = (
    "This `gh pr merge` asks for help but is not written in plain words, so bash could "
    "change what gh receives. For the help text, run exactly `gh pr merge --help`."
)


class GateError(Exception):
    """A reason to deny that is not one of the PR conditions."""


class Operator(str):
    """An unquoted run of shell operator characters, such as `&&` or a newline."""


def tokenize(command):
    """Split a command the way bash does, without expanding anything.

    Returns words (str) and operators (Operator). It tracks quoting, so a
    quoted `;` is a word, and a `#` comment or a backslash-newline is dropped.
    Raises ValueError on an unterminated quote. Here-documents are not
    understood: their body is read as more commands.
    """
    tokens = []
    word = None  # None between words; a list of characters inside one
    i, n = 0, len(command)
    while i < n:
        ch = command[i]
        if ch == "\\":
            nxt = command[i + 1] if i + 1 < n else "\\"
            if nxt != "\n":  # a backslash-newline joins the lines
                word = [] if word is None else word
                word.append(nxt)
            i += 2
        elif ch == "'":
            end = command.find("'", i + 1)
            if end < 0:
                raise ValueError("unterminated single quote")
            word = [] if word is None else word
            word.extend(command[i + 1:end])
            i = end + 1
        elif ch == '"':
            word = [] if word is None else word
            i += 1
            while True:
                if i >= n:
                    raise ValueError("unterminated double quote")
                inner = command[i]
                if inner == '"':
                    i += 1
                    break
                if inner == "\\" and i + 1 < n and command[i + 1] in '$`"\\\n':
                    if command[i + 1] != "\n":
                        word.append(command[i + 1])
                    i += 2
                    continue
                word.append(inner)
                i += 1
        elif ch in " \t":
            if word is not None:
                tokens.append("".join(word))
                word = None
            i += 1
        elif ch in OPERATOR_CHARS:
            if word is not None:
                tokens.append("".join(word))
                word = None
            end = i
            while end < n and command[end] in OPERATOR_CHARS:
                end += 1
            tokens.append(Operator(command[i:end]))
            i = end
        elif ch == "#" and word is None:
            end = command.find("\n", i)
            i = n if end < 0 else end
        else:
            word = [] if word is None else word
            word.append(ch)
            i += 1
    if word is not None:
        tokens.append("".join(word))
    return tokens


def is_operator(token):
    return isinstance(token, Operator)


def classify(command):
    """For a command that begins with the merge: a deny reason (str) or its arguments (list)."""
    if any(mark in command for mark in UNMODELLED):
        return NOT_LITERAL
    try:
        tokens = tokenize(command)
    except ValueError:
        return UNBALANCED
    def is_blank_line(token):
        return is_operator(token) and not token.strip("\n")

    # Drop blank lines before and after the command, by index: popping from
    # the front of a list of many tokens takes quadratic time.
    first, last = 0, len(tokens)
    while first < last and is_blank_line(tokens[first]):
        first += 1
    while last > first and is_blank_line(tokens[last - 1]):
        last -= 1
    tokens = tokens[first:last]
    if any(is_operator(t) for t in tokens) or tokens[:3] != ["gh", "pr", "merge"]:
        return NOT_ALONE
    return tokens[3:]


def parse_args(args):
    """Read the arguments the way gh does. Return (options, errors)."""
    opts = {"positionals": [], "methods": [], "values": {}, "help": False, "bad_help": False}
    errors = []

    def flag(name, attached, takes_next):
        """Handle one long-form flag. Return True when it used the next argument."""
        if name == "--help":
            if attached is None:
                opts["help"] = True
            else:  # gh honours --help=false and then runs the merge
                opts["bad_help"] = True
                errors.append("Write `--help` without a value.")
        elif name in FORBIDDEN:
            errors.append(f"`{name}` is not allowed: {FORBIDDEN[name]}.")
        elif name in METHODS:
            if attached is not None:
                errors.append(f"Write `{name}` without a value.")
            elif name not in opts["methods"]:
                opts["methods"].append(name)
        elif name in VALUE_FLAGS:
            value = attached if attached is not None else takes_next()
            if value is None:
                errors.append(f"`{name}` needs a value.")
            elif name in ONCE and name in opts["values"]:
                errors.append(f"`{name}` is given twice.")
            else:
                opts["values"][name] = value
            return attached is None
        else:
            errors.append(f"`{name}` is not a flag the merge gate knows.")
        return False

    i = 0
    only_positionals = False
    while i < len(args):
        arg = args[i]
        i += 1

        def takes_next():
            return args[i] if i < len(args) else None

        if only_positionals or not arg.startswith("-") or arg == "-":
            opts["positionals"].append(arg)
        elif arg == "--":
            only_positionals = True
        elif arg.startswith("--"):
            name, eq, attached = arg.partition("=")
            if flag(name, attached if eq else None, takes_next):
                i += 1
        else:
            group = arg[1:]
            for k, ch in enumerate(group):
                if ch == "h":
                    if group == "h":
                        opts["help"] = True
                    else:
                        opts["bad_help"] = True
                        errors.append("Write `-h` alone, without a value or other flags.")
                    break
                name = SHORT.get(ch)
                if name is None:
                    errors.append(f"`-{ch}` is not a flag the merge gate knows.")
                    break
                if name in VALUE_FLAGS:
                    tail = group[k + 1:]
                    attached = tail[1:] if tail.startswith("=") else tail
                    if flag(name, attached if tail else None, takes_next):
                        i += 1
                    break
                flag(name, None, takes_next)
    return opts, errors


def check_args(opts, errors):
    """Policy on the arguments alone, before anything is asked of GitHub."""
    errors = list(errors)
    values = opts["values"]
    if len(opts["methods"]) != 1:
        errors.append("Pass exactly one of `--squash`, `--merge`, `--rebase`.")
    if len(opts["positionals"]) > 1:
        errors.append("Pass at most one PR selector (a number, a URL or a branch).")
    for selector in opts["positionals"][:1]:
        if not SELECTOR.fullmatch(selector):
            errors.append("The PR selector must be a literal number, URL or branch name.")
    repo = values.get("--repo")
    if repo is not None and not REPO.fullmatch(repo):
        errors.append("`--repo` must be a literal [HOST/]OWNER/REPO.")
    sha = values.get("--match-head-commit")
    if sha is None:
        errors.append(
            "Add `--match-head-commit <sha>` with the full sha of the commit that was "
            "reviewed, so a later push cannot be merged by accident."
        )
    elif not SHA.fullmatch(sha):
        errors.append("`--match-head-commit` needs the full 40-character lowercase sha.")
    for name in TEXT_ORDER:
        text = values.get(name)
        if text is not None and ("$" in text or "`" in text):
            errors.append(f"Write the `{name}` value as literal text, without `$` or backticks.")
    return errors


def canonical(opts):
    """The one spelling of the validated merge. This is what runs."""
    values = opts["values"]
    argv = ["gh", "pr", "merge"] + opts["positionals"]
    if "--repo" in values:
        argv.append(f"--repo={values['--repo']}")
    argv.append(opts["methods"][0])
    argv.append(f"--match-head-commit={values['--match-head-commit']}")
    for name in TEXT_ORDER:
        if name in values:
            argv.append(f"{name}={values[name]}")
    return shlex.join(argv)


def run_bounded(argv, cwd, timeout, name):
    """Run a command under one time limit and one size limit.

    Returns (returncode, stdout, stderr), the two outputs as bytes. Raises
    GateError when the command cannot start, runs past `timeout` seconds, or
    prints more than MAX_OUTPUT bytes.

    It reads the pipes itself and does not use `communicate()`, which bounds
    neither the total time nor the memory. One deadline covers the reading
    and the exit. After a failure it kills the process group and closes the
    pipes without draining them, so a child that left the group, or one that
    floods its output, cannot hold the hook or fill its memory.
    """
    try:
        proc = subprocess.Popen(
            argv, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, start_new_session=True,
        )
    except FileNotFoundError:
        raise GateError(f"`{argv[0]}` is not on PATH, so {name} could not run.")
    except OSError as exc:
        raise GateError(f"{name} could not start: {exc}.")
    deadline = time.monotonic() + timeout
    out_fd, err_fd = proc.stdout.fileno(), proc.stderr.fileno()
    buffers = {out_fd: bytearray(), err_fd: bytearray()}
    open_fds = set(buffers)
    problem = None
    reaped = False
    try:
        while open_fds and problem is None:
            left = deadline - time.monotonic()
            ready = select.select(list(open_fds), [], [], left)[0] if left > 0 else []
            if not ready:
                problem = f"timed out after {timeout:g} s"
            for fd in ready:
                data = os.read(fd, 65536)
                if not data:
                    open_fds.discard(fd)
                elif len(buffers[out_fd]) + len(buffers[err_fd]) + len(data) > MAX_OUTPUT:
                    problem = f"printed more than {MAX_OUTPUT >> 20} MB"
                    break
                else:
                    buffers[fd] += data
        if problem is None:  # both pipes are closed; the exit shares the deadline
            try:
                proc.wait(timeout=max(0.0, deadline - time.monotonic()))
                reaped = True
            except subprocess.TimeoutExpired:
                problem = f"timed out after {timeout:g} s"
    finally:
        if not reaped:  # also on an unexpected error: never leave the command running
            # The process is not reaped yet, so its pid still names its own group.
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except OSError:
                proc.kill()
        proc.stdout.close()
        proc.stderr.close()
        try:
            proc.wait(timeout=1)
        except subprocess.TimeoutExpired:
            pass
    if problem:
        raise GateError(f"{name} {problem}.")
    return proc.returncode, bytes(buffers[out_fd]), bytes(buffers[err_fd])


def lookup_timeout():
    """Seconds for the lookup: $MERGE_GATE_TIMEOUT when it is a number from above 0 to 600."""
    try:
        value = float(os.environ.get("MERGE_GATE_TIMEOUT", ""))
    except ValueError:
        return DEFAULT_TIMEOUT
    return value if 0 < value <= 600 else DEFAULT_TIMEOUT  # nan and inf fail the test


def fetch_pr(opts, cwd, timeout):
    argv = ["gh", "pr", "view"] + opts["positionals"]
    if "--repo" in opts["values"]:
        argv.append(f"--repo={opts['values']['--repo']}")
    argv += ["--json", FIELDS]
    returncode, out, err = run_bounded(argv, cwd, timeout, "`gh pr view`")
    if returncode != 0:
        lines = err.decode("utf-8", "replace").strip().splitlines()
        raise GateError(f"`gh pr view` failed: {(lines or ['no error text'])[0][:300]}")
    try:
        data = json.loads(out.decode("utf-8"))
    except ValueError:  # includes text that is not UTF-8
        raise GateError("`gh pr view` did not return JSON.")
    if not isinstance(data, dict):
        raise GateError("`gh pr view` did not return a JSON object.")
    return data


def ci_problem(rollup):
    if not isinstance(rollup, list) or not rollup:
        return "CI reported no checks on the head commit."
    waiting, failed, succeeded = [], [], 0
    for item in rollup:
        if not isinstance(item, dict):
            failed.append("unreadable check")
            continue
        name = str(item.get("name") or item.get("context") or "unnamed check")
        kind = item.get("__typename")
        if kind == "CheckRun":
            if item.get("status") != "COMPLETED":
                waiting.append(name)
            elif item.get("conclusion") not in GREEN:
                failed.append(f"{name} ({item.get('conclusion')})")
            elif item.get("conclusion") == "SUCCESS":
                succeeded += 1
        elif kind == "StatusContext":
            if item.get("state") in ("PENDING", "EXPECTED"):
                waiting.append(name)
            elif item.get("state") != "SUCCESS":
                failed.append(f"{name} ({item.get('state')})")
            else:
                succeeded += 1
        else:
            failed.append(f"{name} (unknown check type)")
    if failed:
        return "CI is not green: " + ", ".join(failed[:6]) + "."
    if waiting:
        return "CI is still running: " + ", ".join(waiting[:6]) + "."
    if not succeeded:
        return "CI ran nothing on the head commit: every check was skipped or neutral."
    return None


def review_problem(comments, head):
    found = []  # (tier, adversary held) of each review line for the head commit
    for item in comments if isinstance(comments, list) else []:
        if not isinstance(item, dict) or not isinstance(item.get("body"), str):
            continue
        if item.get("viewerDidAuthor") is not True or item.get("isMinimized") is not False:
            continue
        for line in item["body"].split("\n"):
            match = REVIEW_LINE.fullmatch(line.strip(" \t\r"))
            if match and match["sha"] == head:
                found.append((int(match["tier"]), bool(match["held"])))
    # The highest tier claimed for this commit decides: a later tier=1 line
    # cannot stand in for a tier=2 review that the adversary has not passed.
    if found and (max(tier for tier, _ in found) < 2 or (2, True) in found):
        return None
    if found:
        return (
            "The review line for the head commit says tier=2 but lacks ` adversary=held`. "
            "Run the adversary until it reports held, then post the full line."
        )
    return (
        f"No review line for the head commit. After the review passes on {head}, post a PR "
        f"comment with the line `review: pass {head} tier=<0|1|2> important=0` "
        "(tier 2 adds ` adversary=held`)."
    )


def pr_problems(pr, sha, bases):
    problems = []
    head = pr.get("headRefOid")
    if pr.get("state") != "OPEN":
        problems.append(f"The PR is not open (state {pr.get('state')}).")
    if pr.get("isDraft") is not False:
        problems.append("The PR is a draft. Mark it ready first.")
    base = pr.get("baseRefName")
    release = isinstance(base, str) and base.casefold() in RELEASE_BASES
    if release or not isinstance(base, str) or base not in bases:
        if bases == INTEGRATION_BASES:
            allowed = ", ".join(f"`{b}`" for b in bases) + ", or the one branch named in $MERGE_GATE_BASE"
        else:
            allowed = f"`{bases[0]}` (set in $MERGE_GATE_BASE)"
        never = ("Agents never merge into `main`, `master` or `trunk`, whatever $MERGE_GATE_BASE says. "
                 if release else "")
        problems.append(
            f"The base is `{base}`. Agents merge only into the integration branch: {allowed}. {never}"
            "For any other base, leave the PR open and report it under \"Blocked on me\": "
            "Sean merges it. Do not set $MERGE_GATE_BASE yourself: only Sean sets it."
        )
    if not isinstance(head, str) or head != sha:
        problems.append(
            f"The head commit is {head}, not {sha}. The review covers one commit: "
            "re-check the new head, then merge with its sha."
        )
    ci = ci_problem(pr.get("statusCheckRollup"))
    if ci:
        problems.append(ci)
    if isinstance(head, str) and head == sha:
        missing = review_problem(pr.get("comments"), head)
        if missing:
            problems.append(missing)
    return problems


def decide(payload):
    """Return the hookSpecificOutput dict, or None for no decision.

    Two tests give "no decision", and both read the raw text only, never the
    tokenizer's words. The first: the command does not begin with the merge.
    The second: it is a help request in plain words. Everything else about a
    command that begins with the merge is an allow (which runs the rebuilt
    command) or a deny. So where the tokenizer reads a word differently from
    bash, the result can be a wrong deny, never a merge the hook let pass.
    """
    if not isinstance(payload, dict) or payload.get("tool_name") != "Bash":
        return None
    tool_input = payload.get("tool_input")
    command = tool_input.get("command") if isinstance(tool_input, dict) else None
    if not isinstance(command, str) or not BEGINS_WITH_MERGE.match(command):
        return None
    try:
        found = classify(command)
        if isinstance(found, str):
            return deny([found])
        opts, errors = parse_args(found)
        if opts["help"] and not opts["bad_help"]:
            if PLAIN_WORDS.match(command):
                return None  # gh prints the help text and merges nothing
            return deny([HELP_NOT_PLAIN])
        errors = check_args(opts, errors)
        if errors:
            return deny(errors)
        override = os.environ.get("MERGE_GATE_BASE")
        bases = (override,) if override else INTEGRATION_BASES
        cwd = payload.get("cwd")
        cwd = cwd if isinstance(cwd, str) and os.path.isdir(cwd) else None
        pr = fetch_pr(opts, cwd, lookup_timeout())
        problems = pr_problems(pr, opts["values"]["--match-head-commit"], bases)
        if problems:
            return deny(problems)
        updated = dict(tool_input)
        updated["command"] = canonical(opts)
        return {
            "hookEventName": "PreToolUse",
            "permissionDecision": "allow",
            "permissionDecisionReason": f"merge gate: PR into {pr['baseRefName']}, CI green, review passed on head",
            "updatedInput": updated,
        }
    except GateError as exc:
        return deny([str(exc)])
    except Exception as exc:  # a merge was seen, so fail closed
        return deny([f"The merge gate hit an internal error ({exc!r})."])


def deny(reasons):
    text = "Merge gate: not merged.\n" + "\n".join(f"- {reason}" for reason in reasons)
    return {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": text,
    }


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return 0
    result = decide(payload)
    if result is None:
        return 0
    # An allow carries the caller's tool input back. Build the whole text
    # before writing any of it, and refuse what strict JSON cannot carry
    # (Infinity, NaN, nesting too deep to write): half an answer, or one the
    # harness cannot parse, would drop the decision.
    try:
        text = json.dumps({"hookSpecificOutput": result}, allow_nan=False)
    except (ValueError, RecursionError, TypeError):
        text = json.dumps({"hookSpecificOutput": deny([UNWRITABLE])})
    sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
