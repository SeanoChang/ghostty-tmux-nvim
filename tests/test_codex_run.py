"""codex-run, the watchdog Claude starts Codex through, does what its header says.

The real `codex` is never started here. A stand-in program named `codex` is
put first on PATH. It writes down the arguments it got, and then does what the
test asks through FAKE_CODEX_DO: end with a code, write files into the folder
it was told to work in, print for a while, or hang with a child process.

What this holds:
  - the codex arguments and the exit code pass through;
  - --role turns an agent file into a model, an effort and the instructions,
    and the caller's own model wins;
  - --worktree runs Codex in a new worktree and leaves the lead's tree alone,
    and --allow reports every changed file that fits no pattern (exit 3),
    a file under a cache folder too;
  - a silent run and a run past its time limit are killed, with their children.

What it does not hold: that the real Codex accepts these arguments (the skill
records live runs for that), and that Codex stays inside the worktree. The
allow list is checked after the run, on the worktree only.

Run: python3 -m pytest tests/test_codex_run.py -q -p no:cacheprovider
"""
import fnmatch
import json
import os
import random
import subprocess
import time
import tomllib
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
RUN = REPO / "config" / "claude" / "skills" / "codex-exec" / "scripts" / "codex-run"
AGENTS = REPO / "config" / "codex" / "agents"

FAKE = r'''#!/usr/bin/env python3
import json, os, subprocess, sys, time
argv = sys.argv[1:]
with open(os.environ["FAKE_CODEX_ARGS"], "w") as fh:
    json.dump(argv, fh)
do = os.environ.get("FAKE_CODEX_DO", "ok")
work = argv[argv.index("-C") + 1] if "-C" in argv else os.getcwd()
print('{"type":"thread.started"}', flush=True)
for step in do.split(";"):
    kind, _, arg = step.partition(":")
    if kind == "exit":
        sys.exit(int(arg))
    elif kind == "write":
        path = os.path.join(work, arg)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, "a").write("changed\n")
    elif kind == "delete":
        os.remove(os.path.join(work, arg))
    elif kind == "gitmv":
        old, new = arg.split(">")
        subprocess.run(["git", "mv", old, new], cwd=work, check=True)
    elif kind == "chatter":
        end = time.time() + float(arg)
        while time.time() < end:
            print('{"type":"item.completed"}', flush=True)
            time.sleep(0.2)
    elif kind == "hang":
        child = subprocess.Popen(["sleep", "300"])
        open(os.environ["FAKE_CODEX_CHILD"], "w").write(str(child.pid))
        time.sleep(300)
'''


@pytest.fixture
def box(tmp_path):
    """A stand-in codex on PATH, and a runner that returns the finished process."""
    bindir = tmp_path / "bin"
    bindir.mkdir()
    fake = bindir / "codex"
    fake.write_text(FAKE)
    fake.chmod(0o755)
    args_file = tmp_path / "args.json"
    child_file = tmp_path / "child.pid"

    def run(*argv, do="ok", agents=None, cwd=None, poll="0.2"):
        env = dict(os.environ, PATH=f"{bindir}{os.pathsep}{os.environ['PATH']}", FAKE_CODEX_ARGS=str(args_file),
                   FAKE_CODEX_DO=do, FAKE_CODEX_CHILD=str(child_file), CODEX_RUN_POLL=poll,
                   CODEX_AGENTS_DIR=str(agents or tmp_path / "no-agents"))
        return subprocess.run([str(RUN), *argv], capture_output=True, text=True, env=env, cwd=cwd or tmp_path, timeout=60)

    run.args = lambda: json.loads(args_file.read_text()) if args_file.exists() else None
    run.child = lambda: int(child_file.read_text())
    run.log = str(tmp_path / "events.jsonl")
    run.tmp = tmp_path
    return run


def git(cwd, *argv):
    return subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.invalid", *argv],
                          cwd=cwd, capture_output=True, text=True, check=True).stdout


@pytest.fixture
def lead(tmp_path):
    """A small repository with one commit: the lead's tree."""
    repo = tmp_path / "lead"
    (repo / "src").mkdir(parents=True)
    (repo / "src" / "a.py").write_text("a = 1\n")
    (repo / "README.md").write_text("read me\n")
    git(repo, "init", "-q")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "start")
    return repo


def alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


# ── arguments and exit code ──────────────────────────────────────────────────

def test_the_codex_arguments_pass_through(box):
    done = box("--log", box.log, "--", "-m", "some-model", "-s", "read-only", "the prompt\nwith two lines")
    assert done.returncode == 0, done.stderr
    assert box.args() == ["exec", "--json", "-m", "some-model", "-s", "read-only", "the prompt\nwith two lines"]
    assert '"thread.started"' in Path(box.log).read_text()


def test_the_exit_code_of_codex_passes_through(box):
    assert box("--log", box.log, "--", "prompt", do="exit:7").returncode == 7


@pytest.mark.parametrize("argv", [
    ["--", "prompt"],                                   # no log
    ["--log", "L"],                                     # no codex arguments
    ["--log", "L", "--"],
    ["--log", "L", "--nope", "x", "--", "prompt"],      # unknown option
    ["--log", "L", "--allow", "src/*", "--", "prompt"], # --allow with no worktree
    ["--log", "L", "--repo", ".", "--", "prompt"],
    ["--log", "L", "--role"],                           # an option with no value
], ids=lambda a: " ".join(a))
def test_bad_usage_ends_with_2_and_starts_nothing(box, argv):
    done = box(*argv)
    assert done.returncode == 2
    assert box.args() is None, "codex was started"


# ── --role ───────────────────────────────────────────────────────────────────

TRICKY = 'Line one.\nA "quoted" word, a $HOME, a back\\slash, a `tick`, an é and a 中.\n\n- last line'


def agent_dir(tmp, text=TRICKY, **fields):
    d = tmp / "agents"
    d.mkdir(exist_ok=True)
    values = {"name": "builder", "description": "d", "model": "role-model", "model_reasoning_effort": "low", **fields}
    lines = [f"{k} = {json.dumps(v)}" for k, v in values.items() if v is not None]
    if text is not None:
        lines.append("developer_instructions = '''\n" + text + "\n'''")
    (d / "builder.toml").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return d


def config_values(args):
    """The -c key=value arguments, with each value read as TOML, as Codex reads it."""
    out = {}
    for flag, value in zip(args, args[1:]):
        if flag == "-c":
            key, _, raw = value.partition("=")
            out[key] = tomllib.loads(f"v = {raw}")["v"]
    return out


def test_a_role_gives_the_model_the_effort_and_the_instructions(box):
    done = box("--log", box.log, "--role", "builder", "--", "-s", "workspace-write", "prompt", agents=agent_dir(box.tmp))
    assert done.returncode == 0, done.stderr
    args = box.args()
    assert args[:2] == ["exec", "--json"] and args[-3:] == ["-s", "workspace-write", "prompt"]
    assert args[args.index("-m") + 1] == "role-model"
    assert config_values(args) == {"model_reasoning_effort": "low", "developer_instructions": TRICKY}


def test_the_callers_model_and_effort_win_over_the_roles(box):
    box("--log", box.log, "--role", "builder", "--", "-m", "mine", "-c", 'model_reasoning_effort="high"', "prompt",
        agents=agent_dir(box.tmp))
    args = box.args()
    assert args.count("-m") == 1 and args[args.index("-m") + 1] == "mine"
    assert sum("model_reasoning_effort" in arg for arg in args) == 1, "the effort was sent twice"
    assert config_values(args) == {"model_reasoning_effort": "high", "developer_instructions": TRICKY}


@pytest.mark.parametrize("role", ["nobody", "../builder", "Builder", "a b"])
def test_a_role_with_no_agent_file_ends_with_2(box, role):
    done = box("--log", box.log, "--role", role, "--", "prompt", agents=agent_dir(box.tmp))
    assert done.returncode == 2 and box.args() is None


@pytest.mark.parametrize("change", [{"text": None}, {"text": "  \n"}, {"model": 5}, {"model": "two\nlines"}],
                         ids=["no-instructions", "blank-instructions", "model-not-text", "model-two-lines"])
def test_an_agent_file_that_cannot_be_used_ends_with_2(box, change):
    text = change.pop("text", TRICKY)
    done = box("--log", box.log, "--role", "builder", "--", "prompt", agents=agent_dir(box.tmp, text=text, **change))
    assert done.returncode == 2 and box.args() is None, done.stderr


@pytest.mark.parametrize("role", ["builder", "verifier", "adversary"])
def test_each_agent_file_in_the_repo_reaches_codex_whole(box, role):
    agent = tomllib.loads((AGENTS / f"{role}.toml").read_text(encoding="utf-8"))
    done = box("--log", box.log, "--role", role, "--", "prompt", agents=AGENTS)
    assert done.returncode == 0, done.stderr
    args = box.args()
    assert args[args.index("-m") + 1] == agent["model"]
    assert config_values(args) == {
        "model_reasoning_effort": agent["model_reasoning_effort"],
        "developer_instructions": agent["developer_instructions"].strip("\n"),
    }


# ── --worktree and --allow ───────────────────────────────────────────────────

def worktree_run(box, lead, do, *allow, extra=()):
    wt = box.tmp / "wt"
    argv = ["--log", box.log, "--worktree", str(wt), "--repo", str(lead)]
    for pattern in allow:
        argv += ["--allow", pattern]
    return box(*argv, *extra, "--", "prompt", do=do), wt


def test_codex_runs_in_a_new_worktree_and_the_lead_tree_stays_as_it_was(box, lead):
    done, wt = worktree_run(box, lead, "write:src/a.py;write:src/new.py", "src/*")
    assert done.returncode == 0, done.stderr
    args = box.args()
    assert Path(args[args.index("-C") + 1]) == wt.resolve()
    assert (wt / "src" / "new.py").exists() and "changed" in (wt / "src" / "a.py").read_text()
    assert (lead / "src" / "a.py").read_text() == "a = 1\n" and not (lead / "src" / "new.py").exists()
    assert git(lead, "status", "--porcelain") == ""
    assert "2 file(s) changed" in done.stderr


def test_the_worktree_starts_from_the_commit_not_from_uncommitted_work(box, lead):
    (lead / "src" / "a.py").write_text("a = 2  # not committed\n")
    done, wt = worktree_run(box, lead, "ok")
    assert done.returncode == 0 and (wt / "src" / "a.py").read_text() == "a = 1\n"
    assert "0 file(s) changed" in done.stderr


@pytest.mark.parametrize("do, named", [
    ("write:README.md", ["README.md"]),
    ("write:src/a.py;write:docs/x.md;write:top.txt", ["docs/x.md", "top.txt"]),
    ("write:a name with spaces.txt", ["a name with spaces.txt"]),
    ("write:src/é 中.py;write:é.txt", ["é.txt"]),
    ("delete:README.md", ["README.md"]),
    ("gitmv:README.md>src/README.md", ["README.md"]),
    ("gitmv:src/a.py>moved.py", ["moved.py"]),
    ("write:srcx/a.py", ["srcx/a.py"]),
])
def test_a_change_outside_the_allowed_files_is_named_and_ends_with_3(box, lead, do, named):
    done, _ = worktree_run(box, lead, do, "src/*")
    assert done.returncode == 3, done.stderr
    listed = done.stderr.split("changed outside the allowed files:\n")[1].splitlines()
    assert [line.strip() for line in listed] == named


def test_several_patterns_and_a_star_that_crosses_folders(box, lead):
    done, _ = worktree_run(box, lead, "write:src/deep/er/x.py;write:tests/test_a.py;write:README.md",
                           "src/*", "tests/test_*.py", "README.md")
    assert done.returncode == 0, done.stderr


@pytest.mark.parametrize("hidden", ["src/__pycache__/payload.py", "__pycache__/a.pyc", ".pytest_cache/v/x",
                                    ".ruff_cache/x", "docs/.mypy_cache/x.json"])
def test_a_file_under_a_cache_name_is_shown_like_any_other(box, lead, hidden):
    """A cache folder is not a place to put a file unseen. (An earlier version
    left four cache names out before the check.)"""
    done, _ = worktree_run(box, lead, f"write:{hidden};write:src/a.py", "src/a.py")
    assert done.returncode == 3, done.stderr
    assert done.stderr.split("changed outside the allowed files:\n")[1].split() == [hidden]
    assert "2 file(s) changed" in done.stderr


def test_a_file_that_git_ignores_is_not_listed(box, lead):
    (lead / ".gitignore").write_text("__pycache__/\n")
    git(lead, "add", "-A")
    git(lead, "commit", "-q", "-m", "ignore caches")
    done, _ = worktree_run(box, lead, "write:src/__pycache__/a.pyc;write:src/a.py", "src/a.py")
    assert done.returncode == 0, done.stderr
    assert "1 file(s) changed" in done.stderr


def test_with_no_allow_list_every_change_is_fine(box, lead):
    done, _ = worktree_run(box, lead, "write:anything.txt")
    assert done.returncode == 0 and "1 file(s) changed" in done.stderr


def test_a_failed_codex_keeps_its_own_exit_code_and_the_list_is_still_printed(box, lead):
    done, _ = worktree_run(box, lead, "write:README.md;exit:7", "src/*")
    assert done.returncode == 7 and "README.md" in done.stderr


def test_a_worktree_needs_a_new_path_a_repository_and_no_folder_argument(box, lead):
    (box.tmp / "wt").mkdir()
    done, _ = worktree_run(box, lead, "ok")
    assert done.returncode == 2 and box.args() is None
    (box.tmp / "wt").rmdir()
    not_a_repo = box.tmp / "plain"
    not_a_repo.mkdir()
    assert box("--log", box.log, "--worktree", str(box.tmp / "wt"), "--repo", str(not_a_repo), "--", "p").returncode == 2
    done = box("--log", box.log, "--worktree", str(box.tmp / "wt"), "--repo", str(lead), "--", "-C", "/tmp", "p")
    assert done.returncode == 2 and box.args() is None and not (box.tmp / "wt").exists()


@pytest.mark.parametrize("seed", range(20))
def test_random_changes_and_patterns_against_a_reference_matcher(box, lead, seed):
    """The files a run changed and the patterns it may change are random. The
    list codex-run prints must be the one Python's own matcher gives: in both,
    `*` is any run of characters, `/` included, and `?` is one character."""
    rng = random.Random(seed)
    folders = ["src", "tests", "docs", "a b", "é", "deep"]                 # src/ is in the lead's tree already
    names = ["x.py", "test_x.py", "NOTES.md", "notes.txt", "é.txt", "a.py"]
    files = sorted({"/".join([rng.choice(folders) for _ in range(rng.randint(0, 2))] + [rng.choice(names)])
                    for _ in range(rng.randint(1, 6))})
    shapes = ["src/*", "tests/test_*.py", "*.md", "*/x.py", "docs/*", "?.py", "*", "src/deep/*", "a b/*", "*.t?t", "é/*", "NOTES.md"]
    patterns = rng.sample(shapes, rng.randint(1, 3))
    want = [f for f in files if not any(fnmatch.fnmatchcase(f, p) for p in patterns)]
    done, _ = worktree_run(box, lead, ";".join(f"write:{f}" for f in files), *patterns)
    if not want:
        assert done.returncode == 0, (files, patterns, done.stderr)
    else:
        assert done.returncode == 3, (files, patterns, done.stderr)
        listed = done.stderr.split("changed outside the allowed files:\n")[1].splitlines()
        assert sorted(line.strip() for line in listed) == sorted(want), (files, patterns)
    assert f"{len(files)} file(s) changed" in done.stderr


# ── the watchdog ─────────────────────────────────────────────────────────────

def test_a_silent_run_is_killed_with_its_child(box):
    started = time.time()
    done = box("--log", box.log, "--idle", "1", "--", "prompt", do="hang")
    assert done.returncode == 124, done.stderr
    assert "no output for 1s" in done.stderr
    assert time.time() - started < 20
    time.sleep(0.3)
    assert not alive(box.child()), "the child of the stand-in codex is still running"


def test_a_run_that_keeps_printing_is_not_killed_for_silence(box):
    done = box("--log", box.log, "--idle", "2", "--", "prompt", do="chatter:4")
    assert done.returncode == 0, done.stderr


def test_a_run_past_its_time_limit_is_killed_even_while_it_prints(box):
    done = box("--log", box.log, "--idle", "30", "--max", "2", "--", "prompt", do="chatter:30")
    assert done.returncode == 124 and "ran past 2s" in done.stderr
