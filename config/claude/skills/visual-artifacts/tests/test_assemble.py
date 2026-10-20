"""Tests for scripts/assemble.py: placeholders in a page source become inlined assets."""

import importlib.util
import pathlib
import re
import subprocess
import sys

import pytest

HERE = pathlib.Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("assemble", HERE.parent / "scripts" / "assemble.py")
asm = importlib.util.module_from_spec(SPEC)
sys.modules["assemble"] = asm
SPEC.loader.exec_module(asm)
ASSETS = HERE.parent / "assets"

SRC = """<title>X</title>
<link data-va="fonts">
<style data-va="claude.css"></style>
<style>.page { color: var(--ink); }</style>
<script data-va="kit.js"></script>
<script>Kit.init();</script>
"""


def test_placeholders_are_replaced_with_asset_contents():
    out = asm.assemble(SRC)
    assert out.count("data-va=") == 3, "markers stay so a published page can be re-assembled"
    assert "--accent: #C96442" in out, "claude.css tokens inlined"
    assert "global.Kit = {" in out, "kit.js inlined"
    assert 'href="https://fonts.googleapis.com/css2?' in out
    assert ".page { color: var(--ink); }" in out, "page CSS untouched"


def test_assets_keep_source_order():
    out = asm.assemble(SRC)
    assert out.index("--accent: #C96442") < out.index(".page { color") < out.index("global.Kit") < out.index("Kit.init()")


def test_unknown_placeholder_is_an_error():
    with pytest.raises(asm.AssembleError):
        asm.assemble('<style data-va="nope.css"></style>')


def test_assembled_output_is_stable():
    once = asm.assemble(SRC)
    assert asm.assemble(once) == once


def test_katex_css_is_inlined_with_fonts_as_data_uris():
    out = asm.assemble('<style data-va="katex.css"></style>')
    assert "font-family:KaTeX_Main" in out
    assert "data:font/woff2;base64," in out
    assert "url(fonts/" not in out, "no font may load from a relative path in an Artifact"
    assert asm.assemble(out) == out


@pytest.mark.parametrize("name", sorted(p.name for p in ASSETS.iterdir() if p.suffix in (".css", ".js")))
def test_no_asset_can_end_its_own_inline_element(name):
    text = (ASSETS / name).read_text(encoding="utf-8").lower()
    assert "</style" not in text and "</script" not in text, "inlined, this text ends the element early, even inside a comment"


# ── --root: cited code comes from the repo ──────────────────────────────────
def cite(src, lines):
    return f'<pre class="code-src" data-src="{src}" data-lines="{lines}"><code class="language-go"></code></pre>'


def repo(tmp_path):
    (tmp_path / "gateway").mkdir(parents=True)
    (tmp_path / "gateway" / "router.go").write_text("".join(f"line {i} <a>\n" for i in range(1, 41)), encoding="utf-8")
    return tmp_path


def test_root_fills_cited_code_with_the_named_lines(tmp_path):
    out = asm.assemble(cite("gateway/router.go", "28-31"), root=repo(tmp_path))
    assert 'data-start="28"' in out
    assert '<code class="language-go">line 28 &lt;a&gt;\nline 29 &lt;a&gt;\nline 30 &lt;a&gt;\nline 31 &lt;a&gt;</code>' in out
    assert asm.assemble(out, root=tmp_path) == out, "assembling again gives the same page"


def test_root_fills_one_line(tmp_path):
    out = asm.assemble(cite("gateway/router.go", "40"), root=repo(tmp_path))
    assert ">line 40 &lt;a&gt;</code>" in out and 'data-start="40"' in out


def test_lines_past_the_end_of_the_file_are_an_error(tmp_path):
    with pytest.raises(asm.AssembleError, match="40 lines"):
        asm.assemble(cite("gateway/router.go", "38-44"), root=repo(tmp_path))


def test_cited_code_without_root_is_an_error_until_it_is_filled(tmp_path):
    with pytest.raises(asm.AssembleError, match="--root"):
        asm.assemble(cite("gateway/router.go", "28-31"))
    filled = asm.assemble(cite("gateway/router.go", "28-31"), root=repo(tmp_path))
    assert asm.assemble(filled) == filled, "a filled page re-assembles without the repo"


@pytest.mark.parametrize("src", ["../outside.go", "/etc/hosts", "gateway/../../outside.go"])
def test_root_refuses_a_path_outside_the_root(tmp_path, src):
    root = repo(tmp_path / "repo")
    (tmp_path / "outside.go").write_text("x\n", encoding="utf-8")
    with pytest.raises(asm.AssembleError, match="outside"):
        asm.assemble(cite(src, "1"), root=root)


def test_root_refuses_a_symlink_that_leaves_the_root(tmp_path):
    (tmp_path / "outside.go").write_text("x\n", encoding="utf-8")
    root = repo(tmp_path / "repo")
    (root / "link.go").symlink_to(tmp_path / "outside.go")
    with pytest.raises(asm.AssembleError, match="outside"):
        asm.assemble(cite("link.go", "1"), root=root)


@pytest.mark.parametrize("name", [".env", ".env.production", "deploy/id_rsa", "certs/server.pem", "keys/api.key",
                                  "config/credentials.json", "secrets.yaml", ".npmrc", "infra/terraform.tfstate", ".ssh/config"])
def test_root_refuses_files_that_look_like_secrets(tmp_path, name):
    root = repo(tmp_path)
    (root / name).parent.mkdir(parents=True, exist_ok=True)
    (root / name).write_text("x = 1\n", encoding="utf-8")
    with pytest.raises(asm.AssembleError, match="secret"):
        asm.assemble(cite(name, "1"), root=root)


def test_example_env_files_are_not_secrets(tmp_path):
    root = repo(tmp_path)
    (root / ".env.example").write_text("PORT=8080\n", encoding="utf-8")
    assert ">PORT=8080</code>" in asm.assemble(cite(".env.example", "1"), root=root)


# Built at run time, so this public repo never holds a string a secret scanner would flag.
SECRETS = {
    "private key": "-----BEGIN " + "OPENSSH PRIVATE KEY-----",
    "AWS key": "aws = '" + "AKIA" + "QWERTYUIOPASDFGH" + "'",
    "GitHub token": "token: " + "ghp_" + "Ab3" * 12,
    "API key": 'API_KEY = "' + "sk-" + "ant-" + "x7Yq" * 8 + '"',
}


@pytest.mark.parametrize("kind", sorted(SECRETS))
def test_root_refuses_a_slice_that_holds_a_secret_and_never_prints_it(tmp_path, kind):
    root = repo(tmp_path)
    (root / "config.go").write_text("package config\n" + SECRETS[kind] + "\n", encoding="utf-8")
    with pytest.raises(asm.AssembleError, match="secret") as e:
        asm.assemble(cite("config.go", "1-2"), root=root)
    assert "config.go:2" in str(e.value)
    tokens = re.findall(r"[\w-]{12,}", SECRETS[kind])
    assert SECRETS[kind] not in str(e.value) and not any(t in str(e.value) for t in tokens), "the error names the place, never the value"


def test_main_lists_every_file_whose_code_is_now_in_the_page(tmp_path, capsys):
    root = repo(tmp_path / "repo")
    page = tmp_path / "plan.src.html"
    page.write_text(cite("gateway/router.go", "28-31") + cite("gateway/router.go", "1-2"), encoding="utf-8")
    assert asm.main([str(page), "--root", str(root)]) == 0
    out = capsys.readouterr().out
    assert "embedded code from 1 file" in out and "gateway/router.go:1-2, 28-31" in out
    assert (tmp_path / "plan.html").read_text(encoding="utf-8").count('data-start="') == 2


def git(root, *args):
    subprocess.run(["git", "-C", str(root), "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", *args],
                   check=True, capture_output=True)


def test_root_stamps_the_commit_and_marks_a_changed_file(tmp_path):
    root = repo(tmp_path)
    git(root, "init", "-q")
    git(root, "add", ".")
    git(root, "commit", "-q", "--no-verify", "-m", "x")
    sha = subprocess.run(["git", "-C", str(root), "rev-parse", "--short", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
    assert f'data-ref="{sha}"' in asm.assemble(cite("gateway/router.go", "1"), root=root)
    with open(root / "gateway" / "router.go", "a", encoding="utf-8") as f:
        f.write("line 41\n")
    assert f'data-ref="{sha}-dirty"' in asm.assemble(cite("gateway/router.go", "1"), root=root)
