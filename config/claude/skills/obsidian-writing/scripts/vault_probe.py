#!/usr/bin/env python3
"""
Probe an Obsidian vault and report what a writer needs to know before writing into it.

Reads .obsidian/ config plus a sample of notes, and reports:
  - which core and community plugins are enabled (and their versions)
  - derived capability verdicts (can I use Bases? is Excalidraw installed? is Mermaid current?)
  - link, attachment, and daily-note settings
  - registered property types and the frontmatter keys actually in use
  - folder shape and naming samples

Everything is read-only. Missing or malformed files degrade to "not found" rather than failing.

Usage:
    python vault_probe.py [VAULT_PATH] [--json] [--sample N]

VAULT_PATH defaults to the current directory. If it is inside a vault, the
enclosing vault root is found by walking up to the nearest .obsidian/.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
from collections import Counter
from pathlib import Path

SKIP_DIRS = {".obsidian", ".trash", ".git", ".stfolder", "node_modules", ".venv"}

ATTACHMENT_EXT = {
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".svg", ".webp", ".avif",
    ".pdf", ".mp3", ".wav", ".m4a", ".flac", ".ogg", ".3gp",
    ".mp4", ".mov", ".mkv", ".webm", ".ogv",
}

# plugin id -> (label, verdict when present)
PLUGIN_NOTES = {
    "obsidian-excalidraw-plugin": (
        "Excalidraw",
        "installed — NEVER hand-author .excalidraw.md (compressed JSON). Hand the drawing back to the user or emit .svg.",
    ),
    "mermaid-next": (
        "Mermaid Next",
        "installed — current Mermaid available in `mermaid-next` blocks; -beta diagram types are usable there.",
    ),
    "dataview": (
        "Dataview",
        "installed — existing dataview blocks are safe to edit, but prefer Bases for new derived views.",
    ),
    "templater-obsidian": (
        "Templater",
        "installed — templates may contain <% %> syntax; match the existing template style.",
    ),
    "obsidian-git": (
        "Obsidian Git",
        "installed — vault is versioned, so large restructures are recoverable.",
    ),
    "periodic-notes": ("Periodic Notes", "installed — weekly/monthly notes exist alongside dailies."),
    "calendar": ("Calendar", "installed"),
    "obsidian-kanban": ("Kanban", "installed — .md kanban boards use a plugin-specific block format."),
    "obsidian-tasks-plugin": ("Tasks", "installed — `tasks` query blocks are a hard dependency."),
    "obsidian-map-view": ("Map View", "installed"),
    "obsidian-linter": ("Linter", "installed — it may rewrite formatting on save; keep output canonical."),
    "smart-connections": ("Smart Connections", "installed"),
    "quickadd": ("QuickAdd", "installed"),
    "omnisearch": ("Omnisearch", "installed"),
}


def find_vault_root(start: Path) -> Path | None:
    p = start.resolve()
    for cand in [p, *p.parents]:
        if (cand / ".obsidian").is_dir():
            return cand
    return None


def load_json(path: Path):
    try:
        with path.open(encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return None


def frontmatter_keys(path: Path) -> list[str]:
    """Extract top-level frontmatter keys without a YAML dependency."""
    try:
        with path.open(encoding="utf-8", errors="replace") as fh:
            if fh.readline().rstrip("\n\r") != "---":
                return []
            keys, depth_guard = [], 0
            for line in fh:
                stripped = line.rstrip("\n\r")
                if stripped in ("---", "..."):
                    break
                depth_guard += 1
                if depth_guard > 200:
                    break
                m = re.match(r"^([A-Za-z_][A-Za-z0-9_\- ]*)\s*:", stripped)
                if m:
                    keys.append(m.group(1).strip())
            return keys
    except Exception:
        return []


def walk_vault(root: Path):
    notes, attachments, canvases, bases, top_dirs = [], 0, [], [], Counter()
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        rel_dir = Path(dirpath).relative_to(root)
        top = rel_dir.parts[0] if rel_dir.parts else "."
        for name in filenames:
            ext = Path(name).suffix.lower()
            full = Path(dirpath) / name
            if name.endswith(".excalidraw.md"):
                top_dirs[top] += 1
                continue
            if ext == ".md":
                notes.append(full)
                top_dirs[top] += 1
            elif ext == ".canvas":
                canvases.append(full)
            elif ext == ".base":
                bases.append(full)
            elif ext in ATTACHMENT_EXT:
                attachments += 1
    return notes, attachments, canvases, bases, top_dirs


def build_report(root: Path, sample_size: int) -> dict:
    cfg = root / ".obsidian"
    app = load_json(cfg / "app.json") or {}
    types = load_json(cfg / "types.json") or {}
    daily = load_json(cfg / "daily-notes.json") or {}
    templates = load_json(cfg / "templates.json") or {}

    core_raw = load_json(cfg / "core-plugins.json")
    if core_raw is None:
        core_raw = load_json(cfg / "core-plugins-migration.json")
    if isinstance(core_raw, dict):
        core = sorted(k for k, v in core_raw.items() if v)
    elif isinstance(core_raw, list):
        core = sorted(str(x) for x in core_raw)
    else:
        core = []

    community = load_json(cfg / "community-plugins.json") or []
    community = [str(x) for x in community] if isinstance(community, list) else []

    versions = {}
    plugins_dir = cfg / "plugins"
    if plugins_dir.is_dir():
        for pdir in sorted(plugins_dir.iterdir()):
            man = load_json(pdir / "manifest.json")
            if man:
                versions[pdir.name] = man.get("version", "?")

    notes, attachments, canvases, bases_files, top_dirs = walk_vault(root)

    sample = random.sample(notes, min(sample_size, len(notes))) if notes else []
    key_counter = Counter()
    for n in sample:
        key_counter.update(set(frontmatter_keys(n)))

    prop_types = {}
    tmap = types.get("types") if isinstance(types.get("types"), dict) else types
    if isinstance(tmap, dict):
        for prop, kind in tmap.items():
            if isinstance(kind, str):
                prop_types.setdefault(kind, []).append(prop)

    capability = []
    if "bases" in core:
        capability.append(("Bases", "core plugin ENABLED — prefer .base over hand-maintained tables and over Dataview."))
    else:
        capability.append(("Bases", "not enabled — derived views need Dataview, or hand-maintained tables."))
    capability.append(("Canvas", "enabled" if "canvas" in core else "not enabled"))
    if "mermaid-next" not in community:
        capability.append(("Mermaid", "bundled copy only — use the conservative subset; avoid -beta diagram types."))
    for pid, (label, verdict) in PLUGIN_NOTES.items():
        if pid in community:
            v = versions.get(pid)
            capability.append((label, f"{verdict}" + (f" (v{v})" if v else "")))
    if "obsidian-excalidraw-plugin" not in community:
        capability.append(("Excalidraw", "NOT installed — do not suggest .excalidraw.md; use .svg or Canvas."))

    return {
        "vault": str(root),
        "counts": {
            "notes": len(notes),
            "attachments": attachments,
            "canvases": len(canvases),
            "bases": len(bases_files),
        },
        "core_plugins": core,
        "community_plugins": [{"id": p, "version": versions.get(p, "?")} for p in sorted(community)],
        "capability": [{"name": n, "verdict": v} for n, v in capability],
        "settings": {
            "useMarkdownLinks": app.get("useMarkdownLinks", False),
            "newLinkFormat": app.get("newLinkFormat", "shortest"),
            "alwaysUpdateLinks": app.get("alwaysUpdateLinks"),
            "attachmentFolderPath": app.get("attachmentFolderPath"),
            "defaultViewMode": app.get("defaultViewMode"),
            "dailyNoteFolder": daily.get("folder"),
            "dailyNoteFormat": daily.get("format"),
            "dailyNoteTemplate": daily.get("template"),
            "templateFolder": templates.get("folder"),
        },
        "property_types": prop_types,
        "frontmatter_keys": key_counter.most_common(25),
        "sampled": len(sample),
        "folders": top_dirs.most_common(20),
        "naming_samples": [str(p.relative_to(root)) for p in sample[:6]],
        "base_files": [str(p.relative_to(root)) for p in bases_files[:8]],
        "canvas_files": [str(p.relative_to(root)) for p in canvases[:8]],
    }


def render(r: dict) -> str:
    L = []
    c = r["counts"]
    L.append(f"VAULT  {r['vault']}")
    L.append(
        f"       {c['notes']} notes · {c['attachments']} attachments · "
        f"{c['canvases']} canvases · {c['bases']} bases"
    )

    L.append("\nCAPABILITY  (read this before choosing a representation)")
    for item in r["capability"]:
        L.append(f"  {item['name']:<14} {item['verdict']}")

    L.append(f"\nCORE PLUGINS ({len(r['core_plugins'])})")
    L.append("  " + (", ".join(r["core_plugins"]) if r["core_plugins"] else "none detected"))

    L.append(f"\nCOMMUNITY PLUGINS ({len(r['community_plugins'])})")
    if r["community_plugins"]:
        for p in r["community_plugins"]:
            L.append(f"  {p['id']:<34} {p['version']}")
    else:
        L.append("  none")

    s = r["settings"]
    L.append("\nSETTINGS")
    link_style = "[[wikilinks]]" if not s["useMarkdownLinks"] else "[markdown](links.md)"
    L.append(f"  link style           {link_style}  (newLinkFormat: {s['newLinkFormat']})")
    for label, key in [
        ("alwaysUpdateLinks", "alwaysUpdateLinks"),
        ("attachment folder", "attachmentFolderPath"),
        ("default view mode", "defaultViewMode"),
        ("daily note folder", "dailyNoteFolder"),
        ("daily note format", "dailyNoteFormat"),
        ("daily note template", "dailyNoteTemplate"),
        ("template folder", "templateFolder"),
    ]:
        if s.get(key) not in (None, ""):
            L.append(f"  {label:<20} {s[key]}")

    if r["property_types"]:
        L.append("\nREGISTERED PROPERTY TYPES")
        for kind, props in sorted(r["property_types"].items()):
            L.append(f"  {kind:<12} {', '.join(sorted(props)[:14])}")

    if r["frontmatter_keys"]:
        L.append(f"\nFRONTMATTER KEYS IN USE  (sampled {r['sampled']} notes)")
        row = "  " + " · ".join(f"{k} {n}" for k, n in r["frontmatter_keys"])
        L.append(row)

    if r["folders"]:
        L.append("\nFOLDER SHAPE  (top level, by note count)")
        L.append("  " + " · ".join(f"{d}/ {n}" for d, n in r["folders"]))

    if r["naming_samples"]:
        L.append("\nNAMING SAMPLES")
        for p in r["naming_samples"]:
            L.append(f"  {p}")

    for label, key in [("EXISTING BASES", "base_files"), ("EXISTING CANVASES", "canvas_files")]:
        if r[key]:
            L.append(f"\n{label}")
            for p in r[key]:
                L.append(f"  {p}")

    return "\n".join(L)


def main() -> int:
    ap = argparse.ArgumentParser(description="Probe an Obsidian vault.")
    ap.add_argument("vault", nargs="?", default=".", help="vault path (default: cwd)")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of a report")
    ap.add_argument("--sample", type=int, default=200, help="notes to sample for frontmatter keys")
    args = ap.parse_args()

    start = Path(args.vault).expanduser()
    if not start.exists():
        print(f"error: path does not exist: {start}", file=sys.stderr)
        return 2

    root = find_vault_root(start)
    if root is None:
        print(
            f"error: no .obsidian/ found at or above {start.resolve()}\n"
            "       point this at an Obsidian vault root.",
            file=sys.stderr,
        )
        return 1

    report = build_report(root, args.sample)
    print(json.dumps(report, indent=2) if args.json else render(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
