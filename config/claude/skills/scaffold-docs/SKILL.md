---
name: scaffold-docs
description: Scans the project directory tree and creates/updates CLAUDE.md entry points in each meaningful directory. Maintains a docs/changelog/ with versioned snapshots of what changed. Use when setting up or refreshing project documentation for agent navigation.
argument-hint: [--dry-run]
allowed-tools: Read, Glob, Grep, Bash(date *), Bash(find *), Bash(wc *), Bash(file *), Bash(git *)
---

# Scaffold Docs

You are scaffolding documentation for the project rooted at the current working directory.

## Step 1: Discover project structure

Scan the full directory tree from the project root. Build a mental map of the project.

### What to skip

Use a heuristic-driven approach — do NOT rely on a hardcoded list. Apply these principles:

1. **Respect `.gitignore`** — if a `.gitignore` exists, treat everything it ignores as skipped. This is the strongest signal.
2. **Skip vendored/third-party code** — dependency directories installed by package managers (`node_modules`, `vendor`, `.bundle`, `site-packages`, etc.). You didn't write it, don't document it.
3. **Skip compiled/generated output** — build artifacts, compiled binaries, bundled assets, generated code. Examples: Rust's `target/`, Go's `bin/` if generated, Python's `__pycache__`/`*.pyc`, C/C++ object files, `.next/`, `dist/`, `build/`, `zig-out/`, `_build/`, `.gradle/`, etc.
4. **Skip version control internals** — `.git`, `.svn`, `.hg`
5. **Skip IDE/editor/OS artifacts** — `.idea`, `.vscode`, `.vs`, `.DS_Store`, `Thumbs.db`
6. **Skip environment/secrets** — `.env*` files, credentials, key files
7. **Skip temporary/cache dirs** — `tmp`, `temp`, `coverage`, `.cache`, `.turbo`, `.parcel-cache`, `.nyc_output`, `htmlcov`, `.pytest_cache`, `.mypy_cache`, `.tox`
8. **Skip infra state** — `.terraform`, `.vagrant`, `.pulumi`
9. **Skip the `.claude` directory itself**

When in doubt about a directory: check if it contains authored source code or just generated/managed files. If generated, skip it.

### What to include

Create CLAUDE.md in directories that contain **authored content**:
- Source code in any language
- Documentation files
- Configuration that defines project behavior
- Test files
- Scripts meant to be maintained

Do NOT create CLAUDE.md in leaf directories with fewer than 3 authored files — the parent's CLAUDE.md is sufficient.

## Step 2: Auto-detect project context

Identify from the root:

- **Language(s)**: Detect from file extensions, manifest files, or shebang lines
- **Project manifest**: `package.json`, `Cargo.toml`, `pyproject.toml`, `setup.py`, `go.mod`, `Gemfile`, `composer.json`, `pom.xml`, `build.gradle`, `mix.exs`, `CMakeLists.txt`, `Makefile`, `dune-project`, `cabal.yaml`, `build.zig`, `meson.build`, `Package.swift`, `*.csproj`, `*.sln`, etc.
- **Framework**: Detect from dependencies and project structure (not from a fixed list)
- **Test setup**: Detect test runner from config files, test directory naming, or manifest scripts
- **Monorepo structure**: Workspaces, multiple manifests, shared tooling at root
- **Key conventions**: Infer naming patterns, directory organization, and architecture style from what exists

## Step 3: Check for dry-run mode

If `$ARGUMENTS` contains `--dry-run`:
- List all directories where CLAUDE.md would be created or updated
- Show a summary of what the changelog entry would contain
- Do NOT write any files
- Stop here

## Step 4: Generate CLAUDE.md files

### Root CLAUDE.md

The root `CLAUDE.md` should contain:
- **Project name and one-line description** (inferred from package manifest or README)
- **Tech stack** (language, framework, key dependencies)
- **Project structure overview** — directory tree (depth 2-3) with brief descriptions
- **Key conventions** — naming, patterns, architecture style
- **How to run** — dev server, build, test commands (from scripts/Makefile/etc.)
- **Cross-references** — list of nested CLAUDE.md locations with brief purpose

### Nested CLAUDE.md files

Each nested `CLAUDE.md` should contain:
- **Purpose** — what this directory is responsible for (1-2 sentences)
- **Key files** — the most important files and what they do (not exhaustive, focus on entry points and core logic)
- **Patterns** — any patterns specific to this directory (e.g., "all files export a default React component", "each file is a CLI subcommand handler")
- **Dependencies** — what this directory depends on and what depends on it (internal cross-references)
- **Parent reference** — link back to parent CLAUDE.md

Keep each nested CLAUDE.md **concise** — aim for 15-40 lines. These are navigation aids, not full documentation.

### Writing rules

- Write in a neutral, factual tone — describe what IS, not what should be
- Use relative paths for all cross-references
- Do not include file contents or code snippets — just describe structure and purpose
- If a CLAUDE.md already exists, read it first. Preserve any manually-added context that is still accurate, but update structural information to reflect current state
- Prioritize accuracy — if you're unsure about a directory's purpose, say what it contains rather than guessing intent

## Step 5: Create changelog entry

Create `docs/changelog/` directory if it doesn't exist.

Create a new file: `docs/changelog/YYYY-MM-DD-HHmmss.md` using the current timestamp.

The changelog entry should contain:

```
# Scaffold Docs — {date}

## Summary
- Directories scanned: {count}
- CLAUDE.md created: {list of paths}
- CLAUDE.md updated: {list of paths}
- CLAUDE.md unchanged: {list of paths}

## Structure Snapshot
{directory tree at time of scan, depth 3, code/docs dirs only}

## Notable Changes
{If a previous changelog exists, diff against it: new directories, removed directories, reorganization.
If this is the first run, note "Initial scaffold."}
```

## Step 6: Update docs/OVERVIEW.md

Create or overwrite `docs/OVERVIEW.md` with:
- Full directory tree (authored content directories only, respecting skip rules)
- Brief one-line description next to each directory
- Last updated timestamp
- This serves as the "instant orientation" file for any agent entering the project

## Execution order

1. Read existing CLAUDE.md files and previous changelog (if any) to understand prior state
2. Scan and map directory structure using skip/include heuristics
3. Detect project type, language, framework, and conventions
4. If `--dry-run`, report what would change and stop
5. Write/update root CLAUDE.md
6. Write/update nested CLAUDE.md files (deepest first, so parent cross-references are accurate)
7. Write changelog entry
8. Write docs/OVERVIEW.md
9. Report summary to user: what was created, updated, and unchanged
