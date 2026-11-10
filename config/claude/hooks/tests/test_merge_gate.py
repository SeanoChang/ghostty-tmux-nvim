"""Tests for merge-gate.py, the PreToolUse hook that gates `gh pr merge`.

Run: python3 -m pytest ~/.claude/hooks/tests/test_merge_gate.py -q

The hook runs as a real process. Only GitHub is faked: a `gh` script on PATH
prints a canned `gh pr view --json` answer and logs the arguments it received.
"""
import json
import os
import random
import shlex
import stat
import subprocess
import sys
from pathlib import Path

import pytest

HOOK = Path(__file__).resolve().parent.parent / "merge-gate.py"
SHA = "7cb09713ccfa5305ebc81448a0b89c347a8bd36f"
OTHER = "0123456789abcdef0123456789abcdef01234567"
OK_CMD = f"gh pr merge 12 --squash --match-head-commit {SHA}"

FAKE_GH = r"""#!/bin/sh
for a in "$@"; do printf '%s\037' "$a"; done >> "$FAKE_GH_LOG"
printf '\n' >> "$FAKE_GH_LOG"
case "$FAKE_GH_MODE" in
  fail) echo "no pull requests found for branch" >&2; exit 1 ;;
  garbage) echo "<html>rate limited</html>"; exit 0 ;;
  hang) sleep 30 ;;
  orphan) python3 -c 'import os, time; os.setsid(); time.sleep(12)' & sleep 12 ;;
  flood) exec yes 0123456789012345678901234567890123456789012345678901234567890123 ;;
  errflood) exec yes 0123456789012345678901234567890123456789012345678901234567890123 >&2 ;;
  orphanflood) python3 -c 'import os; os.setsid(); os.execvp("yes", ["yes", "0123456789" * 6])' & sleep 12 ;;
  closedpipes) exec >&- 2>&-; sleep 12 ;;
  binary) printf '\377\376{"number": 12}'; exit 0 ;;
esac
cat "$FAKE_GH_JSON"
"""


def check(conclusion="SUCCESS", status="COMPLETED"):
    return {"__typename": "CheckRun", "name": "test", "status": status, "conclusion": conclusion}


def comment(body, mine=True, minimized=False):
    return {"author": {"login": "sean"}, "body": body, "viewerDidAuthor": mine, "isMinimized": minimized}


def review(sha=SHA, tier=1, extra=""):
    return comment(f"Verifier passed.\n\nreview: pass {sha} tier={tier} important=0{extra}\n")


def pr(**over):
    data = {
        "number": 12,
        "url": "https://github.com/sean/app/pull/12",
        "state": "OPEN",
        "isDraft": False,
        "baseRefName": "dev",
        "headRefOid": SHA,
        "statusCheckRollup": [check(), check("SKIPPED")],
        "comments": [review()],
    }
    data.update(over)
    return data


@pytest.fixture
def gate(tmp_path):
    bindir = tmp_path / "bin"
    bindir.mkdir()
    fake = bindir / "gh"
    fake.write_text(FAKE_GH)
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    log = tmp_path / "gh.log"
    pr_file = tmp_path / "pr.json"
    repo = tmp_path / "repo"
    repo.mkdir()

    def run(command, pr_json=None, mode="ok", tool="Bash", raw_stdin=None, env=None, extra_input=None):
        log.write_text("")
        pr_file.write_text(json.dumps(pr() if pr_json is None else pr_json))
        tool_input = {"command": command, "description": "merge the task PR"}
        tool_input.update(extra_input or {})
        payload = {
            "session_id": "s1",
            "hook_event_name": "PreToolUse",
            "cwd": str(repo),
            "tool_name": tool,
            "tool_input": tool_input,
        }
        environ = dict(os.environ)
        environ.pop("MERGE_GATE_BASE", None)
        environ.update(
            PATH=f"{bindir}{os.pathsep}{environ['PATH']}",
            FAKE_GH_LOG=str(log),
            FAKE_GH_JSON=str(pr_file),
            FAKE_GH_MODE=mode,
        )
        environ.update(env or {})
        proc = subprocess.run(
            [sys.executable, str(HOOK)],
            input=json.dumps(payload) if raw_stdin is None else raw_stdin,
            capture_output=True,
            text=True,
            env=environ,
            timeout=60,
        )
        assert proc.returncode == 0, (proc.returncode, proc.stderr)
        calls = [line.split("\037")[:-1] for line in log.read_text().splitlines() if line]
        out = proc.stdout.strip()
        result = {"rc": proc.returncode, "out": out, "err": proc.stderr, "calls": calls,
                  "decision": None, "reason": "", "command": None}
        if out:
            hso = json.loads(out)["hookSpecificOutput"]
            assert hso["hookEventName"] == "PreToolUse"
            result["decision"] = hso["permissionDecision"]
            result["reason"] = hso.get("permissionDecisionReason", "")
            result["updated"] = hso.get("updatedInput")
            if hso.get("updatedInput"):
                result["command"] = hso["updatedInput"]["command"]
        return result

    return run


def silent(r):
    return r["rc"] == 0 and r["out"] == "" and r["decision"] is None


# ---------------------------------------------------------------- not a merge

@pytest.mark.parametrize("command", [
    "ls -la",
    "git merge dev",
    "gh pr view 12 --json mergeable",
    "gh pr list --search merge",
    "gh pr checks 12",
    "gh pr create --title 'merge gate' --body 'run gh pr merge 12 --squash'",
    'git commit -m "document gh pr merge 12 --admin in the runbook"',
    "grep -rn 'gh pr merge' docs/",
    "gh issue list",
    "gh repo view --json mergeCommitAllowed",
    "echo \"it's an unbalanced quote and gh pr merge",
    "ls  # later; gh pr merge 12 --squash",
    "gh pr checks 12   # all green -> gh pr merge next",
    'echo ";" gh pr merge 12',
    "echo 'a && b' gh pr merge 12",
    "printf '%s\\n' done # gh pr merge 12 --admin",
    # Outside the syntax the hook models ($, backtick, here-document): no decision.
    "echo $'a\\' ; gh pr merge 12 ; b' \\'",
    'echo "$(printf "%s" "a; gh pr merge 12")"',
    'git commit -m "$(printf \'CI green\' "; gh pr merge 12 next")"',
    "cat > docs/runbook.md <<'EOF'\nThen run:\ngh pr merge 12 --squash\nEOF",
    "echo `date`; echo 'gh pr merge 12'",
])
def test_other_commands_pass_silently(gate, command):
    r = gate(command)
    assert silent(r), r
    assert r["calls"] == []


def test_other_tools_pass_silently(gate):
    assert silent(gate(OK_CMD, tool="Write"))


def test_malformed_stdin_passes_silently(gate):
    assert silent(gate("", raw_stdin="not json"))
    assert silent(gate("", raw_stdin='{"tool_name":"Bash"}'))
    assert silent(gate("", raw_stdin='{"tool_name":"Bash","tool_input":{"command":42}}'))


@pytest.mark.parametrize("command", [
    "gh pr merge --help", "gh pr merge -h", f"{OK_CMD} --help", "gh pr merge 12 --admin --help",
])
def test_help_is_not_gated(gate, command):
    assert silent(gate(command))


@pytest.mark.parametrize("command", [
    # Bash expands the braces or the glob, the new flag takes `--help` as its
    # value, and gh merges. Found by a reviewer with real bash and real gh.
    "gh pr merge 12 --admin {-t,} --help",
    "gh pr merge 12 --admin --help --help{,=false}",
    "gh pr merge 12 --admin --delete-branch {--subject,} -h",
    "gh pr merge 12 --admin -[t] --help",
    # Help in any spelling that is not plain words: not worth a model of bash.
    "gh pr merge 12 ~ --help",
    "gh pr merge 12 * -h",
    "gh pr merge 12 ? --help",
    'gh pr merge "--help"',
    "gh pr merge '-h'",
    "gh pr merge --he\\lp",
    "gh pr merge --help # how do I merge",
    "gh pr merge \\\n --help",
    "gh pr merge 12 ! --help",
    "gh pr merge 12 ^x^y --help",
])
def test_help_with_anything_bash_could_expand_is_denied(gate, command):
    r = gate(command)
    assert r["decision"] == "deny", r
    assert "plain" in r["reason"]
    assert r["calls"] == []


# ------------------------------------------------------------------ the allow

def test_allows_a_reviewed_green_pr_into_dev(gate):
    r = gate(OK_CMD)
    assert r["decision"] == "allow", r
    assert r["command"] == f"gh pr merge 12 --squash --match-head-commit={SHA}"
    assert len(r["calls"]) == 1
    call = r["calls"][0]
    assert call[:3] == ["pr", "view", "12"]
    assert "--json" in call


def test_allow_keeps_the_other_tool_input_fields(gate):
    r = gate(OK_CMD, extra_input={"timeout": 60000})
    assert r["updated"]["timeout"] == 60000
    assert r["updated"]["description"] == "merge the task PR"


def test_allows_without_selector_and_checks_the_current_branch(gate):
    r = gate(f"gh pr merge --rebase --match-head-commit {SHA}")
    assert r["decision"] == "allow", r
    assert r["calls"][0][:2] == ["pr", "view"]
    assert r["calls"][0][2] == "--json"
    assert r["command"] == f"gh pr merge --rebase --match-head-commit={SHA}"


def test_repo_flag_reaches_the_lookup_and_the_merge(gate):
    r = gate(f"gh pr merge 12 -R sean/app -m --match-head-commit={SHA}")
    assert r["decision"] == "allow", r
    assert ["--repo", "sean/app"] == r["calls"][0][3:5] or "--repo=sean/app" in r["calls"][0]
    assert r["command"] == f"gh pr merge 12 --repo=sean/app --merge --match-head-commit={SHA}"


def test_text_values_are_requoted_not_reinterpreted(gate):
    r = gate(f"gh pr merge 12 -s --match-head-commit {SHA} -t 'fix: a; b && c' --body \"two\nlines\"")
    assert r["decision"] == "allow", r
    assert shlex.split(r["command"]) == [
        "gh", "pr", "merge", "12", "--squash", f"--match-head-commit={SHA}",
        "--subject=fix: a; b && c", "--body=two\nlines",
    ]


def test_line_continuations_are_joined(gate):
    r = gate(f"gh pr merge 12 \\\n  --squash \\\n  --match-head-commit {SHA}")
    assert r["decision"] == "allow", r
    assert r["command"] == f"gh pr merge 12 --squash --match-head-commit={SHA}"


def test_a_trailing_comment_is_dropped(gate):
    r = gate(f"{OK_CMD}  # tier 1, verifier passed")
    assert r["decision"] == "allow", r
    assert r["command"] == f"gh pr merge 12 --squash --match-head-commit={SHA}"


def test_url_and_branch_selectors(gate):
    for sel in ["https://github.com/sean/app/pull/12", "feat/login-flow"]:
        r = gate(f"gh pr merge {sel} --squash --match-head-commit {SHA}")
        assert r["decision"] == "allow", r
        assert r["calls"][0][2] == sel


def test_integration_branch_name_comes_from_the_environment(gate):
    r = gate(OK_CMD, pr_json=pr(baseRefName="integration"), env={"MERGE_GATE_BASE": "integration"})
    assert r["decision"] == "allow", r
    r = gate(OK_CMD, env={"MERGE_GATE_BASE": "integration"})
    assert r["decision"] == "deny"


@pytest.mark.parametrize("base", ["dev", "develop", "development", "integration"])
def test_a_branch_with_an_integration_name_is_accepted_as_the_base(gate, base):
    r = gate(OK_CMD, pr_json=pr(baseRefName=base))
    assert r["decision"] == "allow", r
    assert f"PR into {base}," in r["reason"]  # the allow message names the real base


@pytest.mark.parametrize("base", ["main", "master", "trunk", "release", "production", "prod", "staging", "stage",
                                  "preview", "qa", "uat", "Dev", "DEV", "dev2",
                                  "develop-old", "feature/dev", "dev/x", " dev", "dev ", "", None, 0, ["dev"],
                                  {"name": "dev"}, True])
def test_any_other_base_is_denied(gate, base):
    r = deny(gate, "base", pr_json=pr(baseRefName=base))
    assert "integration branch" in r["reason"]
    for name in ("`dev`", "`develop`", "`development`", "`integration`", "MERGE_GATE_BASE"):
        assert name in r["reason"], r["reason"]
    assert "`staging`" not in r["reason"].split("Agents merge only into")[1]


def test_a_branch_that_often_deploys_needs_the_setting(gate):
    """`staging` is a deploy target in many repos, so its name alone is not enough."""
    deny(gate, "base", pr_json=pr(baseRefName="staging"))
    r = gate(OK_CMD, pr_json=pr(baseRefName="staging"), env={"MERGE_GATE_BASE": "staging"})
    assert r["decision"] == "allow", r


@pytest.mark.parametrize("base", ["dev", "develop", "development", "staging"])
def test_a_base_set_in_the_environment_is_the_only_one_accepted(gate, base):
    r = deny(gate, "base", pr_json=pr(baseRefName=base), env={"MERGE_GATE_BASE": "integration"})
    assert "`integration`" in r["reason"]
    r = gate(OK_CMD, pr_json=pr(baseRefName="trunk-next"), env={"MERGE_GATE_BASE": "trunk-next"})
    assert r["decision"] == "allow", r


def test_an_empty_base_setting_means_the_default_names(gate):
    assert gate(OK_CMD, pr_json=pr(baseRefName="develop"), env={"MERGE_GATE_BASE": ""})["decision"] == "allow"
    deny(gate, "base", pr_json=pr(baseRefName="main"), env={"MERGE_GATE_BASE": ""})


def test_tier2_with_adversary_held(gate):
    r = gate(OK_CMD, pr_json=pr(comments=[review(tier=2, extra=" adversary=held")]))
    assert r["decision"] == "allow", r


def test_a_later_review_line_for_the_head_commit_counts(gate):
    comments = [review(sha=OTHER), comment("looks fine"), review()]
    assert gate(OK_CMD, pr_json=pr(comments=comments))["decision"] == "allow"


# ------------------------------------------------------- conditions that deny

def deny(gate, needle, command=OK_CMD, **kw):
    r = gate(command, **kw)
    assert r["decision"] == "deny", r
    assert r["command"] is None
    assert needle.lower() in r["reason"].lower(), r["reason"]
    return r


def test_denies_a_merge_into_main(gate):
    r = deny(gate, "base", pr_json=pr(baseRefName="main"))
    assert "dev" in r["reason"] and "main" in r["reason"]


def test_denies_when_head_moved_after_the_review(gate):
    deny(gate, "head", pr_json=pr(headRefOid=OTHER, comments=[review(), review(sha=OTHER)]))


def test_denies_without_match_head_commit(gate):
    deny(gate, "--match-head-commit", command="gh pr merge 12 --squash")


def test_denies_a_short_sha(gate):
    deny(gate, "40", command=f"gh pr merge 12 --squash --match-head-commit {SHA[:12]}")


@pytest.mark.parametrize("rollup", [
    [],
    None,
    [check(), check(None, "IN_PROGRESS")],
    [check(), check("FAILURE")],
    [check(), check("CANCELLED")],
    [check(), check("TIMED_OUT")],
    [check(), check("ACTION_REQUIRED")],
    [check(), {"__typename": "StatusContext", "context": "ci", "state": "PENDING"}],
    [check(), {"__typename": "StatusContext", "context": "ci", "state": "FAILURE"}],
    [check(), {"__typename": "StatusContext", "context": "ci", "state": "ERROR"}],
    [check(), {"__typename": "StatusContext", "context": "ci"}],
    [check(), {"__typename": "Mystery"}],
    [check("SKIPPED")],
    [check("NEUTRAL"), check("SKIPPED")],
    [check(), "not an object"],
    "not a list",
])
def test_denies_when_ci_is_not_green(gate, rollup):
    deny(gate, "CI", pr_json=pr(statusCheckRollup=rollup))


def test_ci_reason_tells_running_from_failed(gate):
    running = [check(), check("SUCCESS", "IN_PROGRESS"), check(None, "QUEUED")]
    r = deny(gate, "still running", pr_json=pr(statusCheckRollup=running))
    assert "not green" not in r["reason"]
    failed = [check(), check("FAILURE"), check(None, "IN_PROGRESS")]
    deny(gate, "not green", pr_json=pr(statusCheckRollup=failed))


def test_status_context_success_is_green(gate):
    rollup = [check(), {"__typename": "StatusContext", "context": "ci", "state": "SUCCESS"}]
    assert gate(OK_CMD, pr_json=pr(statusCheckRollup=rollup))["decision"] == "allow"


@pytest.mark.parametrize("comments", [
    [],
    None,
    [comment("LGTM")],
    [review(sha=OTHER)],
    [comment(f"review: fail {SHA} tier=1 important=2")],
    [comment(f"review: pass {SHA} tier=1 important=1")],
    [comment(f"review: pass {SHA[:10]} tier=1 important=0")],
    [comment(f"review: pass {SHA} tier=1")],
    [comment(f"> review: pass {SHA} tier=1 important=0")],
    [comment(f"I will post review: pass {SHA} tier=1 important=0 later")],
    [comment(f"review: pass {SHA} tier=3 important=0")],
    [comment(f"review: pass {SHA} tier=1 important=0", mine=False)],
    [comment(f"review: pass {SHA} tier=1 important=0", minimized=True)],
    [{"body": None}],
    [comment(f"> quoted\u2028review: pass {SHA} tier=1 important=0")],
    [{"body": f"review: pass {SHA} tier=1 important=0", "viewerDidAuthor": True}],
    ["not an object"],
])
def test_denies_without_a_review_line_for_the_head_commit(gate, comments):
    deny(gate, "review: pass", pr_json=pr(comments=comments))


def test_denies_tier2_without_adversary_held(gate):
    deny(gate, "adversary=held", pr_json=pr(comments=[review(tier=2)]))


def test_a_lower_tier_line_cannot_replace_a_tier2_line(gate):
    for comments in ([review(tier=2), review(tier=1)], [review(tier=0), review(tier=2)]):
        deny(gate, "adversary=held", pr_json=pr(comments=comments))
    held = [review(tier=1), review(tier=2), review(tier=2, extra=" adversary=held")]
    assert gate(OK_CMD, pr_json=pr(comments=held))["decision"] == "allow"


def test_adversary_held_on_a_lower_tier_line_does_not_count_for_tier2(gate):
    comments = [review(tier=2), review(tier=1, extra=" adversary=held")]
    deny(gate, "adversary=held", pr_json=pr(comments=comments))


def test_denies_a_pr_answer_without_the_draft_field(gate):
    answer = pr()
    del answer["isDraft"]
    deny(gate, "draft", pr_json=answer)


@pytest.mark.parametrize("over,needle", [
    ({"state": "MERGED"}, "open"),
    ({"state": "CLOSED"}, "open"),
    ({"isDraft": True}, "draft"),
])
def test_denies_a_pr_that_is_not_open_and_ready(gate, over, needle):
    deny(gate, needle, pr_json=pr(**over))


def test_reports_every_failed_condition_at_once(gate):
    r = deny(gate, "base", pr_json=pr(baseRefName="main", statusCheckRollup=[], comments=[]))
    assert "CI" in r["reason"] and "review: pass" in r["reason"]


@pytest.mark.parametrize("mode", ["fail", "garbage"])
def test_denies_when_gh_cannot_answer(gate, mode):
    deny(gate, "gh pr view", mode=mode)


def test_denies_when_gh_hangs(gate):
    deny(gate, "gh pr view", mode="hang", env={"MERGE_GATE_TIMEOUT": "1"})


def test_denies_when_gh_is_missing(gate, tmp_path):
    empty = tmp_path / "empty"
    empty.mkdir()
    deny(gate, "gh", env={"PATH": str(empty)})


def test_a_child_of_gh_that_leaves_the_process_group_cannot_hold_the_hook(gate):
    """The kill at the timeout misses such a child, and it keeps the output pipe open."""
    import time
    started = time.monotonic()
    deny(gate, "timed out", mode="orphan", env={"MERGE_GATE_TIMEOUT": "1"})
    assert time.monotonic() - started < 8


def children_peak_mb():
    import resource
    peak = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    return peak / (1024 * 1024 if sys.platform == "darwin" else 1024)


@pytest.mark.parametrize("mode,needle", [
    ("flood", "more than"), ("errflood", "more than"), ("orphanflood", "more than"),
    ("orphan", "timed out"), ("hang", "timed out"), ("closedpipes", "timed out"),
])
def test_the_lookup_has_one_time_limit_and_one_size_limit(gate, mode, needle):
    """Whatever gh and its children do, the hook answers within the limit and stays small."""
    import time
    started = time.monotonic()
    deny(gate, needle, mode=mode, env={"MERGE_GATE_TIMEOUT": "2"})
    assert time.monotonic() - started < 5.5, mode
    assert children_peak_mb() < 300, mode


def test_denies_a_gh_answer_that_is_not_text(gate):
    deny(gate, "did not return JSON", mode="binary")


@pytest.mark.parametrize("value", ["0", "-1", "nan", "inf", "-inf", "1e300", "soon", ""])
def test_a_timeout_setting_that_is_not_a_sensible_number_means_the_default(gate, value):
    r = gate(OK_CMD, env={"MERGE_GATE_TIMEOUT": value})
    assert r["decision"] == "allow", r


# ------------------------------------------------- odd payloads from the harness

def strict_json(text):
    def refuse(name):
        raise ValueError(f"{name} is not JSON")
    return json.loads(text, parse_constant=refuse)


@pytest.mark.parametrize("extra", ['"timeout":1e999', '"timeout":-1e999', '"x":NaN', '"x":[1,{"y":Infinity}]'])
def test_a_number_json_cannot_carry_gives_a_valid_deny(gate, extra):
    raw = '{"tool_name":"Bash","tool_input":{"command":%s,%s}}' % (json.dumps(OK_CMD), extra)
    r = gate("", raw_stdin=raw)
    strict_json(r["out"])
    assert r["decision"] == "deny", r
    assert "tool input" in r["reason"]


@pytest.mark.parametrize("depth", [200, 900, 990, 995, 1000, 1100, 3000])
def test_deep_nesting_in_the_tool_input_never_breaks_the_output(gate, depth):
    """Exit 0 (the fixture checks it) and nothing or one whole JSON object on stdout."""
    raw = '{"tool_name":"Bash","tool_input":{"command":%s,"x":%s}}' % (
        json.dumps(OK_CMD), "[" * depth + "]" * depth)
    r = gate("", raw_stdin=raw)
    if r["out"]:
        strict_json(r["out"])
        assert r["decision"] in ("allow", "deny")
        if r["decision"] == "allow":
            assert r["command"] == f"gh pr merge 12 --squash --match-head-commit={SHA}"


def test_many_blank_lines_before_the_merge_do_not_slow_the_hook(gate):
    import time
    started = time.monotonic()
    r = gate("\n " * 400_000 + OK_CMD)
    assert r["decision"] == "allow", r["reason"]
    assert time.monotonic() - started < 5


# ------------------------------------------------------------ flags that deny

@pytest.mark.parametrize("flag,needle", [
    ("--admin", "--admin"),
    ("--auto", "--auto"),
    ("--disable-auto", "--disable-auto"),
    ("--delete-branch", "--delete-branch"),
    ("-d", "--delete-branch"),
    ("-sd", "--delete-branch"),
    ("-ds", "--delete-branch"),
    ("--delete-branch=false", "--delete-branch"),
    ("--admin=false", "--admin"),
    ("--squash=false", "value"),
    ("--frobnicate", "--frobnicate"),
    ("--admin --help=false", "--help"),
    ("-d --help=false", "--help"),
    ("--auto -h=false", "-h"),
    ("--admin -sh", "-h"),
    ("--help=true", "--help"),
    ("--help --help=false", "--help"),
    ("--help=false --help", "--help"),
    ("-x", "-x"),
    ("--merge", "one of"),
    ("-r", "one of"),
    ("13", "selector"),
])
def test_denies_flags_outside_the_allowed_set(gate, flag, needle):
    r = deny(gate, needle, command=f"{OK_CMD} {flag}")
    assert r["calls"] == [], "a malformed merge must not reach GitHub"


def test_denies_a_merge_without_a_method(gate):
    deny(gate, "one of", command=f"gh pr merge 12 --match-head-commit {SHA}")


@pytest.mark.parametrize("command", [
    f"gh pr merge '12; rm -rf x' --squash --match-head-commit {SHA}",
    f"gh pr merge -- -12 --squash --match-head-commit {SHA}",
    f"gh pr merge 12 --squash --match-head-commit {SHA} --match-head-commit {OTHER}",
    f"gh pr merge 12 --squash --match-head-commit {SHA} -R 'sean/app --admin'",
    f"gh pr merge 12 --squash --match-head-commit {SHA} --subject",
    f"gh pr merge 12 --squash --match-head-commit {SHA} --subject \"$TITLE\"",
    f"gh pr merge 12 --squash --match-head-commit {SHA} --body \"`cat notes`\"",
    f"gh pr merge $PR --squash --match-head-commit {SHA}",
    f"gh pr merge 12 --squash --match-head-commit $(git rev-parse HEAD)",
])
def test_denies_arguments_it_cannot_read_literally(gate, command):
    r = gate(command)
    assert r["decision"] == "deny", r


# ------------------- the gate decides only when the command begins with the merge
#
# The rule: a command gets a decision when its text begins with plain
# `gh pr merge`. Every other command gets none, and the normal permission flow
# applies. The hook does not look for a merge inside a larger command: that
# needs a full model of bash, and a partial one misreads text that never runs.

@pytest.mark.parametrize("command", [
    f"{OK_CMD} && git pull",
    f"{OK_CMD}; rm -rf build",
    f"{OK_CMD} | tee merge.log",
    f"{OK_CMD} > merge.log",
    f"{OK_CMD} &",
    f"{OK_CMD}\nrm -rf build",
    f"gh pr merge 12 --squash --match-head-commit {SHA} --subject x\\\\\nrm -rf build",
    "gh pr merge;ls",
    "gh pr merge>out",
    "gh pr merge|cat",
    "gh pr merge --help | cat",
])
def test_denies_a_merge_with_more_after_it(gate, command):
    r = gate(command)
    assert r["decision"] == "deny", r
    assert "alone" in r["reason"]
    assert r["calls"] == []


@pytest.mark.parametrize("command", [
    # A second command, a prefix or a wrapper before the merge.
    f"cd ../other && {OK_CMD}",
    f"GH_REPO=evil/repo {OK_CMD}",
    f"env GH_REPO=evil/repo {OK_CMD}",
    f"( {OK_CMD} )",
    f"{{ {OK_CMD}; }}",
    f"if true; then {OK_CMD}; fi",
    f"time {OK_CMD}",
    f"timeout 60 {OK_CMD}",
    f"nice -n 5 {OK_CMD}",
    f"command -p {OK_CMD}",
    f"sudo -E {OK_CMD}",
    f"env -i PATH=/usr/bin {OK_CMD}",
    f">out {OK_CMD} --admin",
    f"# merge now\n{OK_CMD}",
    # Another spelling of the three words.
    f"GH pr merge 12 --squash --match-head-commit {SHA}",
    f"/opt/homebrew/bin/{OK_CMD}",
    f"gh pr -R sean/app merge 12 --squash --match-head-commit {SHA}",
    f"g\\h pr merge 12 --squash --match-head-commit {SHA}",
    f'"g"h pr me"rge" 12 --squash --match-head-commit {SHA}',
    f"gh \\\npr merge 12 --squash --match-head-commit {SHA}",
    f"gh pr merge\\\n 12 --squash --match-head-commit {SHA}",
    # Not blanks to bash, so bash does not read the first word as `gh`.
    f"\x0b{OK_CMD}",
    f" {OK_CMD}",
    f"\r{OK_CMD}",
    # A merge as data, or inside another program's input.
    f"bash -c '{OK_CMD}'",
    f"echo '{OK_CMD}' | sh",
    f"eval \"{OK_CMD}\"",
    f"echo $({OK_CMD})",
    f"bash <<EOF\n{OK_CMD}\nEOF",
    f"cd $REPO && {OK_CMD}",
    f"`{OK_CMD}`",
    # Text that never runs a merge (each was wrongly denied before).
    "arr=(gh pr merge 12 --squash)",
    "declare -a cmd=(gh pr merge 12)",
    "echo hi > gh pr merge",
    "[[ x =~ a|(gh pr merge) ]]",
    "echo done; x=(gh pr merge)",
    "cat < gh pr merge",
    "gh pr merge-queue 12",
    "gh pr mergeable",
    'gh pr merge"d" 12',
])
def test_a_command_that_does_not_begin_with_the_merge_gets_no_decision(gate, command):
    r = gate(command)
    assert silent(r), r
    assert r["calls"] == []


@pytest.mark.parametrize("command", [
    f"gh pr merge $PR --squash --match-head-commit {SHA}",
    f"gh pr merge 12 --squash --match-head-commit $(git rev-parse HEAD)",
    f"gh pr merge 12 --squash --match-head-commit {SHA} --body \"$(cat <<'EOF'\nnotes\nEOF\n)\"",
    f"gh pr merge 12 --squash --match-head-commit {SHA} && echo $?",
    "gh pr merge --help | grep $x",
])
def test_a_command_that_starts_with_the_merge_is_always_gated(gate, command):
    r = gate(command)
    assert r["decision"] == "deny", r
    assert "literal" in r["reason"]
    assert r["calls"] == []


@pytest.mark.parametrize("command", [
    f"gh pr merge 12 --squash --match-head-commit {SHA} --subject \"oops",
    f"gh pr merge 12 --squash --match-head-commit {SHA} --subject 'oops",
])
def test_denies_a_merge_with_an_unbalanced_quote(gate, command):
    r = gate(command)
    assert r["decision"] == "deny", r
    assert "quote" in r["reason"]
    assert r["calls"] == []


@pytest.mark.parametrize("command", [
    f"{OK_CMD}\n",
    f"\n  {OK_CMD}  \n\n",
    f"\t{OK_CMD}",
    f"gh pr merge 12 --squash --match-head-commit {SHA}\\\n",
    f"gh  pr\tmerge 12 --squash --match-head-commit {SHA}",
])
def test_spellings_bash_reads_as_the_plain_merge(gate, command):
    r = gate(command)
    assert r["decision"] == "allow", r
    assert r["command"] == f"gh pr merge 12 --squash --match-head-commit={SHA}"


# ------------------------------- random commands against a built-in oracle

METHODS = [("--squash", "-s"), ("--merge", "-m"), ("--rebase", "-r")]
FORBIDDEN = ["--admin", "--auto", "--delete-branch", "-d", "--disable-auto"]


def random_case(rng):
    """Build a merge command from a spec, so the expected result is known."""
    methods = rng.sample(METHODS, rng.choice([0, 1, 1, 1, 1, 2]))
    sha = rng.choice([SHA, SHA, SHA, SHA, OTHER, SHA[:8], None])
    forbidden = rng.sample(FORBIDDEN, rng.choice([0, 0, 0, 1, 2]))
    selector = rng.choice(["12", "12", "feat/x", None, "12 13"])
    repo = rng.choice([None, None, "sean/app"])
    subject = rng.choice([None, None, "fix: login", "a; b | c", "it's done"])

    parts, canon = [], ["gh", "pr", "merge"]
    if selector:
        parts.append(selector)
    if selector and " " not in selector:
        canon.append(selector)
    if repo:
        parts.append(rng.choice([f"-R {repo}", f"--repo {repo}", f"--repo={repo}", f"-R{repo}"]))
        canon.append(f"--repo={repo}")
    short_methods = []
    for long, short in methods:
        if rng.random() < 0.5:
            parts.append(long)
        else:
            short_methods.append(short[1])
    if short_methods:
        parts.append("-" + "".join(short_methods))
    if len(methods) == 1:
        canon.append(methods[0][0])
    if sha:
        parts.append(rng.choice([f"--match-head-commit {sha}", f"--match-head-commit={sha}"]))
        canon.append(f"--match-head-commit={sha}")
    if subject:
        parts.append(rng.choice([f"-t {shlex.quote(subject)}", f"--subject={shlex.quote(subject)}"]))
        canon.append(f"--subject={subject}")
    parts.extend(forbidden)
    rng.shuffle(parts)
    command = " ".join(["gh pr merge"] + parts)
    allowed = (
        len(methods) == 1 and sha == SHA and not forbidden and selector != "12 13"
    )
    return command, allowed, canon


GH_LOGGER = """#!/bin/sh
line=
for a in "$@"; do line="$line$a$(printf '\\037')"; done
printf '%s\\n' "$line" >> "$FAKE_GH_LOG"
"""


def real_bash(tmp_path, files=()):
    """Run text in /bin/bash where the only program on PATH is a `gh` that logs its arguments.

    Returns run(*bash_args) -> (calls, process). `files` are created empty in
    the working directory.
    """
    bindir = tmp_path / "logger-bin"
    bindir.mkdir()
    fake = bindir / "gh"
    fake.write_text(GH_LOGGER)
    fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    work = tmp_path / "logger-work"
    work.mkdir()
    for name in files:
        (work / name).write_text("")
    log = tmp_path / "logger.log"
    env = {"PATH": str(bindir), "FAKE_GH_LOG": str(log)}

    def run(*args):
        log.write_text("")
        proc = subprocess.run(["/bin/bash", "--norc", "--noprofile", *args], cwd=work, env=env,
                              stdin=subprocess.DEVNULL, capture_output=True, text=True,
                              errors="replace", timeout=20)  # bash 3.2 prints raw bytes in some errors
        calls = [line.split("\037")[:-1] for line in log.read_text().split("\n") if line]
        return calls, proc

    return run


def test_random_merge_commands_match_the_oracle(gate, tmp_path):
    bash = real_bash(tmp_path)
    rng = random.Random(20261110)
    allowed_seen = denied_seen = 0
    for _ in range(300):
        command, allowed, canon = random_case(rng)
        r = gate(command)
        if allowed:
            allowed_seen += 1
            assert r["decision"] == "allow", (command, r)
            assert sorted(shlex.split(r["command"])) == sorted(canon), (command, r["command"])
            # What bash passes to gh for the rebuilt command: the validated values, in order.
            calls, _ = bash("-c", r["command"])
            assert calls == [canon[1:]], (command, r["command"], calls)
        else:
            denied_seen += 1
            assert r["decision"] == "deny", (command, r)
    assert allowed_seen > 30 and denied_seen > 30, (allowed_seen, denied_seen)


WRAPPERS = [
    "cd repo && {c}", "{c} && ls", "{c}; ls", "ls; {c}", "{c} | cat", "FOO=1 {c}",
    "echo $({c})", "( {c} )", "{c} &", "ls\n{c}", "{c}\nls", "sudo {c}", "{c} 2>&1",
    "true || {c}", "bash -c {q}", "sh -c {q}", "echo {q} | sh", "eval {q}", "`{c}`",
]


def test_a_valid_merge_inside_any_wrapper_is_never_allowed(gate):
    rng = random.Random(7)
    for _ in range(150):
        command, allowed, _ = random_case(rng)
        if not allowed:
            continue
        wrapper = rng.choice(WRAPPERS)
        wrapped = wrapper.format(c=command, q=shlex.quote(command))
        r = gate(wrapped)
        assert r["decision"] != "allow", (wrapped, r)


# ------------------------- which commands get a decision: a reference rule,
# ------------------------- and what real bash runs

def load_hook():
    import importlib.util
    spec = importlib.util.spec_from_file_location("merge_gate", HOOK)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def begins_with_plain_merge(text):
    """The rule, written a second time without a regular expression."""
    rest = text.lstrip(" \t\n")
    for word in ("gh", "pr"):
        if not rest.startswith(word) or rest[len(word):len(word) + 1] not in (" ", "\t"):
            return False
        rest = rest[len(word):].lstrip(" \t")
    if not rest.startswith("merge"):
        return False
    return rest[5:6] in ("", " ", "\t", "\n", ";", "&", "|", "<", ">", "(", ")")


def in_process_gate(hook):
    """decide() with GitHub answering that the PR is reviewed and green."""
    hook.fetch_pr = lambda opts, cwd, timeout: pr()

    def run(command):
        out = hook.decide({"tool_name": "Bash", "tool_input": {"command": command}})
        return (None, None) if out is None else (out["permissionDecision"], out.get("updatedInput"))

    return run


# Words and marks that the earlier versions misread, with no `--help`: a help
# request is the one command that begins with the merge and gets no decision.
NOISE = [
    "gh", "pr", "merge", "12", "--squash", "--admin", f"--match-head-commit={SHA}", "echo",
    "x", "arr=", "cmd=", "declare", "-a", "(", ")", "[[", "]]", "=~", ";", "&&", "||", "|",
    "&", ">", "<", "<<", "'", '"', "#", "\n", "{", "}", "!", "if", "then", "fi", "$", "$(",
    "`", "\\", "\t", "\x0b", " ", "\r", "env", "sudo", "cd", "GH", "-R", "sean/app",
    "merge-queue", "mergeable",
]


def random_noise(rng, bits):
    text = "".join(rng.choice(bits) + rng.choice([" ", " ", " ", ""]) for _ in range(rng.randint(1, 9)))
    if rng.random() < 0.4:
        text = rng.choice(["", " ", "\n", "\t", "\n  "]) + rng.choice(["gh pr merge", "gh  pr\tmerge"]) \
            + rng.choice([" ", " ", "", "\n"]) + text
    return text


def test_a_decision_is_given_exactly_when_the_command_begins_with_the_merge():
    run = in_process_gate(load_hook())
    rng = random.Random(1111)
    decided = undecided = mentions = 0
    for _ in range(6000):
        text = random_noise(rng, NOISE)
        decision, _ = run(text)
        assert (decision is not None) == begins_with_plain_merge(text), (text, decision)
        decided += decision is not None
        undecided += decision is None
        mentions += decision is None and "merge" in text and "gh" in text
    assert decided > 1000 and undecided > 1000 and mentions > 300, (decided, undecided, mentions)


# The subset of NOISE that is safe to run: with PATH holding only a fake `gh`,
# these words can start no other program and name no path outside the directory.
RUNNABLE = [
    "gh", "pr", "merge", "12", "--squash", f"--match-head-commit={SHA}", "echo", "x", "arr=",
    "(", ")", "[[", "]]", "=~", ";", "&&", "||", "|", "&", ">", "<", "'", '"', "#", "\n",
    "{", "}", "!", "if", "then", "fi", "true", "out",
]
# Help flags, and words that bash expands into a flag that takes `--help` as its value.
HELPISH = ["--help", "-h", "--admin", "-t", "{-t,}", "{--subject,}", "--help{,=false}", "-[t]", "12"]
PLAIN_ALLOW = ["pr", "merge", "12", "--squash", f"--match-head-commit={SHA}"]


def test_every_decision_is_for_a_merge_that_real_bash_runs(tmp_path):
    """Three properties, each checked against what /bin/bash does with the text.

    1. A deny or an allow is given only for text that makes bash call `gh pr merge`.
    2. No decision for text that begins with the merge (a help request) is given
       only when bash passes the words to gh exactly as they are written.
    3. The rebuilt command of an allow makes bash call gh with the validated values.
    """
    # Files so that `< word` has something to read, and `-t` so that `-[t]` matches.
    bash = real_bash(tmp_path, files=("gh", "pr", "merge", "12", "echo", "x", "out", "true",
                                      "if", "then", "fi", "-t"))
    run = in_process_gate(load_hook())
    rng = random.Random(1112)
    ran = denied = allowed = silent_merges = silent_help = 0
    for _ in range(3000):
        text = random_noise(rng, RUNNABLE)
        pick = rng.random()
        if pick < 0.05:  # a merge that meets every condition, in a random spelling
            parts = ["12", "--squash", f"--match-head-commit={SHA}"]
            rng.shuffle(parts)
            text = (rng.choice(["", "\n", " ", "\t"]) + "gh pr merge " + " ".join(parts)
                    + rng.choice(["", "\n", " # note", " --squash", " \\\n"]))
        elif pick < 0.15:  # a merge behind something: bash runs it, the hook stays silent
            text = (rng.choice(["echo x; ", "true && ", "! ", "x=1 ", "> out ", "true\n", "{ "])
                    + "gh pr merge 12" + rng.choice(["", " --squash", "; }", " | true"]))
        elif pick < 0.40:  # a merge with help flags and words that bash expands
            text = "gh pr merge " + " ".join(rng.choice(HELPISH) for _ in range(rng.randint(1, 4))) \
                + rng.choice(["", "", "\n", " "])
        decision, updated = run(text)
        if "<<" in text or bash("-n", "-c", text)[1].returncode != 0:
            continue  # a here-document or a syntax error: bash runs nothing we can compare
        calls, proc = bash("-c", text + "\nwait\n")
        merged = any(call[:2] == ["pr", "merge"] for call in calls)
        ran += 1
        if decision is None:
            if begins_with_plain_merge(text):
                silent_help += 1
                assert calls == [text.split()[1:]], (text, calls)
                assert "--help" in calls[0] or "-h" in calls[0], (text, calls)
            else:
                silent_merges += merged
            continue
        # A failed `< file` stops bash before it starts the command.
        assert merged or "No such file" in proc.stderr, (text, decision, calls, proc.stderr)
        if decision == "deny":
            denied += 1
        else:
            allowed += 1
            assert len(calls) == 1, (text, calls)
            assert sorted(set(calls[0])) == sorted(PLAIN_ALLOW), (text, calls)
            rebuilt_calls, _ = bash("-c", updated["command"])
            assert rebuilt_calls == [PLAIN_ALLOW], (text, updated["command"], rebuilt_calls)
    print(f"bash comparison: ran={ran} denied={denied} allowed={allowed} "
          f"silent_merges={silent_merges} silent_help={silent_help}")
    assert ran > 400 and denied > 100 and allowed > 5 and silent_help > 30, (ran, denied, allowed, silent_help)
    # A merge behind a prefix runs in bash and gets no decision: the stated cost of the rule.
    assert silent_merges > 5, silent_merges


def test_an_internal_error_after_the_merge_is_seen_is_a_deny():
    hook = load_hook()
    run = in_process_gate(hook)

    def broken(command):
        raise RuntimeError("boom")

    hook.tokenize = broken
    decision, updated = run(OK_CMD)
    assert decision == "deny" and updated is None
    assert run("ls -la") == (None, None)
    assert run(f"cd x && {OK_CMD}") == (None, None)


# ----------------------------------- the tokenizer against real bash


def bash_words(text):
    """What bash passes as arguments for `set -- <text>`, or None on a syntax error."""
    script = "set -- " + text + "\n" + 'for a in "$@"; do printf "%s\\0" "$a"; done\n'
    proc = subprocess.run(["/bin/bash", "--norc", "--noprofile", "-c", script],
                          capture_output=True, timeout=20)
    if proc.returncode != 0:
        return None
    return proc.stdout.decode().split("\0")[:-1]


def random_shell_text(rng, comments):
    """Words built from unquoted, single-quoted and double-quoted pieces.

    No `$`, backtick or glob outside single quotes, so bash expands nothing.
    A text has either `#` or newlines, never both: after a comment a newline
    would start a second command, and bash would run it.
    """
    plain = "qjk07-=/.:" + ("#" if comments else "")
    quoted = "qjk ;|&<>()'\"\\=-" + ("#" if comments else "\n")
    words = []
    for _ in range(rng.randint(0, 5)):
        word = ""
        for _ in range(rng.randint(1, 3)):
            kind = rng.choice("usd")
            if kind == "u":
                for _ in range(rng.randint(1, 4)):
                    if rng.random() < 0.25:
                        word += "\\" + rng.choice(" \"'\\#;|q" + ("" if comments else "\n"))
                    else:
                        word += rng.choice(plain)
            elif kind == "s":
                body = "".join(rng.choice(quoted + "$") for _ in range(rng.randint(0, 5)))
                word += "'" + body.replace("'", "") + "'"
            else:
                body = ""
                for _ in range(rng.randint(0, 5)):
                    ch = rng.choice(quoted)
                    if ch == '"':
                        body += '\\"'
                    elif ch == "\\":
                        body += rng.choice(['\\\\', '\\"', "\\$", "\\q"] + ([] if comments else ["\\\n"]))
                    else:
                        body += ch
                word += '"' + body + '"'
        words.append(word)
    return rng.choice([" ", "  ", "\t"]).join(words) + rng.choice(["", " ", " # note" if comments else ""])


def test_tokenizer_matches_bash_on_random_words():
    hook = load_hook()
    rng = random.Random(1110)
    compared = with_comment = 0
    for n in range(600):
        text = random_shell_text(rng, comments=n % 2 == 0)
        expected = bash_words(text)
        try:
            tokens = hook.tokenize(text)
        except ValueError:
            tokens = None
        if expected is None:
            assert tokens is None, (text, tokens)
            continue
        assert tokens is not None, (text, expected)
        assert not any(hook.is_operator(t) for t in tokens), (text, tokens)
        assert [str(t) for t in tokens] == expected, (text, tokens, expected)
        compared += 1
        with_comment += "#" in text
    assert compared > 400 and with_comment > 100, (compared, with_comment)


@pytest.mark.parametrize("text,expected", [
    ("a&&b", ["a", "&&", "b"]),
    ("a ';' b", ["a", ";", "b"]),
    ("a;b|c >d 2>&1", ["a", ";", "b", "|", "c", ">", "d", "2", ">&", "1"]),
    ("a\nb", ["a", "\n", "b"]),
    ("a \\\n b", ["a", "b"]),
    ("a\\\\\nb", ["a\\", "\n", "b"]),
    ("a #b;c\nd", ["a", "\n", "d"]),
    ("a#b", ["a#b"]),
    ('""', [""]),
])
def test_tokenizer_operators_and_comments(text, expected):
    hook = load_hook()
    tokens = hook.tokenize(text)
    assert [str(t) for t in tokens] == expected
    quoted_semicolon = text == "a ';' b"
    assert any(hook.is_operator(t) for t in tokens) == (not quoted_semicolon and expected not in (["a", "b"], ["a#b"], [""]))
