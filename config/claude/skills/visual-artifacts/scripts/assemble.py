#!/usr/bin/env python3
"""Inline the shared design system into an Artifact page.

A page source marks where the shared assets go:

    <link data-va="fonts">                     -> the Google Fonts stylesheet link
    <style data-va="claude.css"></style>       -> tokens + components
    <script data-va="kit.js"></script>         -> shared behaviours (window.Kit)

The markers stay in the output with fresh contents, so assembling an already
assembled page (for example one read back from a published artifact) refreshes
it to the current assets.

Plan pages cite code from the repo instead of retyping it:

    <pre class="code-src" data-src="gateway/router.go" data-lines="24-40"><code class="language-go"></code></pre>

With --root, each cited block is filled from that file (data-start is set, and
data-ref holds the commit when the root is a git checkout). The script reads
nothing outside the root, refuses files that look like they hold a secret, and
lists every file whose code is now inside the page. Check that list before you
publish or share.

Usage: assemble.py SRC.html [-o OUT.html] [--root REPO]   (default OUT: name.src.html -> name.html, else stdout)
"""

from __future__ import annotations

import argparse
import html
import pathlib
import re
import subprocess
import sys

ASSETS = pathlib.Path(__file__).resolve().parent.parent / "assets"
FONTS_URL = (
    "https://fonts.googleapis.com/css2?family=Albert+Sans:ital,wght@0,400..700;1,400..700"
    "&family=Source+Serif+4:ital,opsz,wght@0,8..60,400..600;1,8..60,400..600&family=JetBrains+Mono:wght@400;500;600&display=swap"
)


class AssembleError(Exception):
    pass


def _katex_css() -> str:
    """KaTeX's stylesheet with every font inlined as a woff2 data URI (an Artifact cannot fetch fonts from a CDN)."""
    import base64

    root = ASSETS / "katex"
    css = (root / "katex.min.css").read_text(encoding="utf-8")

    def src(m: re.Match) -> str:
        woff2 = re.search(r"url\((fonts/[^)]+\.woff2)\)", m.group(0))
        data = base64.b64encode((root / woff2.group(1)).read_bytes()).decode()
        return f'src:url(data:font/woff2;base64,{data}) format("woff2")'

    return re.sub(r"src:url\(fonts/[^;}]*", src, css)


def _asset(name: str) -> str:
    if name == "katex.css":
        return _katex_css()
    path = ASSETS / name
    if not path.is_file() or path.parent != ASSETS:
        have = ", ".join(sorted(p.name for p in ASSETS.iterdir() if p.is_file()))
        raise AssembleError(f"unknown asset '{name}' (have: {have})")
    return path.read_text(encoding="utf-8").strip()


# A file whose name says it holds keys or credentials is never embedded, whatever lines are asked for.
SECRET_NAMES = re.compile(
    r"(^|/)(\.env(\.[\w.-]+)?|\.npmrc|\.pypirc|\.netrc|\.htpasswd|\.git-credentials|\.dockercfg|kubeconfig"
    r"|id_(rsa|dsa|ecdsa|ed25519)[\w.-]*|(credentials|secrets?)(\.(json|ya?ml|toml|ini|conf|cfg|txt|csv|env))?|client_secret[\w.-]*\.json"
    r"|[\w.-]+\.(pem|key|p12|pfx|jks|keystore|kdbx|tfstate|tfstate\.backup|tfvars))$"
    r"|(^|/)(\.ssh|\.gnupg|\.aws|secrets?|credentials)/", re.I)
SAFE_NAMES = re.compile(r"\.(example|sample|template|dist)$", re.I)
# A name that says its value is a credential (db_password, GITHUB_TOKEN, apiKey, API_KEY_PROD), then := or :.
_KEY = (r"(?i:password|passwd|passphrase|secret|private[_-]?key|api[_-]?key|access[_-]?key|token)[\w-]*"
        r"[\"']?\s*[:=]\s*")


def _live(end: str) -> str:
    """Fails when the whole value, up to `end`, is a bare name in a placeholder shape: ${DB_PASS}, $DB_PASS,
    <your-key>, {{ vault_pass }}, or an ALL_CAPS name ending in KEY, TOKEN, SECRET or PASSWORD, such as
    OPENAI_API_KEY. A name holds letters and underscores only: a digit or a default (${X:-...}) means the
    value is checked, as are $ecret, $uperS3cret and bcrypt hashes."""
    return (r"(?!(?:\$\{[A-Za-z_]+\}|\$[A-Z_]+|<[A-Za-z][A-Za-z_-]*>|\{\{\s*[A-Za-z_][A-Za-z_.]*\s*\}\}"
            r"|[A-Z][A-Z_]*_(?:KEY|TOKEN|SECRET|PASSWORD|PASS|PWD))" + end + ")")


_BARE = r"[\w!@#$%^&*+/=~-]"
# Lines that look like a live secret. The error names the place and the kind, never the value.
SECRET_TEXT = [
    ("private key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("AWS access key", re.compile(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("GitHub token", re.compile(r"\b(gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,})")),
    ("Slack token", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}")),
    ("API key", re.compile(r"\bsk-[A-Za-z0-9_-]{20,}|\bAIza[0-9A-Za-z_-]{35}\b|\b[rs]k_live_[0-9A-Za-z]{20,}")),
    ("password or token", re.compile(_KEY + r"[\"']" + _live(r"[\"']") + r"[^\"'\s]{8,}[\"']")),
    # Unquoted (YAML, env, INI): only a literal with letters and digits, so code such as settings.KEY or get_key() still embeds.
    ("password or token", re.compile(_KEY + _live(r"(?:[\s,;#]|$)") + rf"(?={_BARE}*\d)(?={_BARE}*[A-Za-z]){_BARE}{{8,}}(?![^\s,;#])")),
    ("connection string with a password", re.compile(r"\b[A-Za-z][\w+.-]*://[^/\s:@]*:" + _live("@") + r"[^/\s@]{4,}@")),
]


def _git(root: pathlib.Path, *args: str) -> str | None:
    try:
        r = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return r.stdout.strip() if r.returncode == 0 else None


def _cited(root: pathlib.Path, src: str, lines: str) -> tuple[str, int, str | None, str]:
    """The text of lines a-b of root/src, its first line number, the commit it came from, and the
    path of the file actually read (symlinks and .. resolved), relative to root."""
    path = (root / src).resolve()
    if src.startswith("/") or not path.is_relative_to(root):
        raise AssembleError(f"'{src}' is outside the root {root}; cite files inside the repo only")
    rel = path.relative_to(root).as_posix()
    if SECRET_NAMES.search(rel) and not SAFE_NAMES.search(rel):
        raise AssembleError(f"'{rel}' looks like a file that holds a secret; it is never embedded")
    if not path.is_file():
        raise AssembleError(f"'{rel}' does not exist under {root}")
    m = re.fullmatch(r"\s*(\d+)\s*(?:-\s*(\d+)\s*)?", lines)
    if not m:
        raise AssembleError(f"{rel}: data-lines=\"{lines}\" must be a line or a range, such as 24-40")
    a, b = int(m.group(1)), int(m.group(2) or m.group(1))
    text = path.read_text(encoding="utf-8", errors="replace").splitlines()
    if not 1 <= a <= b <= len(text):
        raise AssembleError(f"{rel}: lines {a}-{b} are not in the file, which has {len(text)} lines")
    for n in range(a, b + 1):
        for kind, pat in SECRET_TEXT:
            if pat.search(text[n - 1]):
                raise AssembleError(f"{rel}:{n} looks like it holds a secret ({kind}); cite other lines")
    ref = None
    if _git(root, "rev-parse", "--is-inside-work-tree") == "true":
        ref = _git(root, "rev-parse", "--short", "HEAD")
        if ref and _git(root, "status", "--porcelain", "--", rel):
            ref += "-dirty"
    return "\n".join(text[a - 1 : b]), a, ref, rel


def _fill_code(src: str, root: pathlib.Path | None, embedded: dict | None) -> str:
    def sub(m: re.Match) -> str:
        attrs = dict(re.findall(r'([\w:-]+)(?:="([^"]*)")?', m.group(1)))
        path, lines = attrs.get("data-src", ""), attrs.get("data-lines", "")
        if root is None:
            if m.group(3).strip():
                return m.group(0)  # filled earlier; keep it
            raise AssembleError(f"<pre data-src=\"{path}\"> cites code; pass --root <repo> to fill it")
        text, start, ref, rel = _cited(root, path, lines)
        attrs["data-start"] = str(start)
        if ref:
            attrs["data-ref"] = ref
        else:
            attrs.pop("data-ref", None)
        if embedded is not None:
            embedded.setdefault(rel, set()).add((start, start + text.count("\n")))
        tag = " ".join(f'{k}="{v}"' if v else k for k, v in attrs.items())  # values stay as written: re-escaping would grow &amp; on each run
        return f"<pre {tag}><code{m.group(2)}>{html.escape(text, quote=False)}</code></pre>"

    return re.sub(r'<pre\b((?=[^>]*\bdata-src=")[^>]*)>\s*<code([^>]*)>(.*?)</code>\s*</pre>', sub, src, flags=re.S)


def assemble(src: str, root: str | pathlib.Path | None = None, embedded: dict | None = None) -> str:
    """embedded, if given, collects {path: {(first, last), ...}} for every block filled from the root."""
    src = _fill_code(src, pathlib.Path(root).resolve() if root is not None else None, embedded)

    def block(tag: str):
        def sub(m: re.Match) -> str:
            return f'<{tag} data-va="{m.group(1)}">\n{_asset(m.group(1))}\n</{tag}>'
        return sub

    out = re.sub(r'<style data-va="([^"]+)">.*?</style>', block("style"), src, flags=re.S)
    out = re.sub(r'<script data-va="([^"]+)">.*?</script>', block("script"), out, flags=re.S)

    def fonts(m: re.Match) -> str:
        if m.group(1) != "fonts":
            raise AssembleError(f"unknown link placeholder '{m.group(1)}' (only 'fonts')")
        return f'<link data-va="fonts" rel="stylesheet" href="{FONTS_URL}">'

    return re.sub(r'<link data-va="([^"]+)"[^>]*>', fonts, out)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src")
    ap.add_argument("-o", "--out")
    ap.add_argument("--root", help="the repo that data-src paths are relative to")
    a = ap.parse_args(argv)
    src = pathlib.Path(a.src)
    embedded: dict = {}
    try:
        page = assemble(src.read_text(encoding="utf-8"), root=a.root, embedded=embedded)
    except AssembleError as e:
        print(f"assemble: {e}", file=sys.stderr)
        return 2
    out = pathlib.Path(a.out) if a.out else (src.with_name(src.name.replace(".src.html", ".html")) if src.name.endswith(".src.html") else None)
    if out is None:
        sys.stdout.write(page)
    else:
        out.write_text(page, encoding="utf-8")
        print(f"wrote {out} ({len(page.encode()) / 1024:.0f} KiB)")
    if embedded:
        n = len(embedded)
        print(f"embedded code from {n} file{'s' * (n != 1)} (check this list before you publish or share):", file=sys.stderr if out is None else sys.stdout)
        for path, spans in sorted(embedded.items()):
            print("  " + path + ":" + ", ".join(f"{a}-{b}" if b > a else str(a) for a, b in sorted(spans)), file=sys.stderr if out is None else sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
