---
name: orient
description: Quickly load project context from scaffold docs (CLAUDE.md files, docs/OVERVIEW.md, changelog) at the start of a session. Saves exploration time by reading pre-built navigation docs. Use at the beginning of a new session or when switching context to a different part of the codebase.
argument-hint: [path/to/focus]
allowed-tools: Read, Glob, Grep
---

# Orient

You are orienting yourself in the project at the current working directory using pre-built scaffold docs. This is a **read-only** skill — you do not write or modify anything.

## Step 1: Check for scaffold docs

Look for these files:
- `CLAUDE.md` at project root
- `docs/OVERVIEW.md`
- `docs/changelog/` directory

If **none** of these exist, tell the user:
> No scaffold docs found. Run `/scaffold-docs` first to generate project documentation, then `/orient` again.

Stop here if nothing is found.

If only a root `CLAUDE.md` exists (no docs/), still proceed — use what's available.

## Step 2: Load core context

Read these files in parallel:
1. **Root `CLAUDE.md`** — project overview, tech stack, structure, conventions
2. **`docs/OVERVIEW.md`** — full directory map with descriptions (if exists)
3. **Latest file in `docs/changelog/`** — most recent structural snapshot (if exists)

## Step 3: Focus area (if argument provided)

If `$ARGUMENTS` is provided (e.g., `/orient src/api`):
- Find and read the `CLAUDE.md` in or nearest to that path
- Read CLAUDE.md files of immediate child directories if they exist
- Read CLAUDE.md of the parent directory for broader context
- This gives a focused "zoom-in" view of that area

If no argument is provided, load CLAUDE.md files from the top 2 levels of the project to give broad orientation.

## Step 4: Present orientation

Synthesize everything you read into a **concise briefing** for the user. Structure it as:

### Project at a glance
- Name, purpose, tech stack (from root CLAUDE.md)

### Structure
- Key directories and what they do (from OVERVIEW.md or root CLAUDE.md)
- If a focus area was specified, emphasize that area's structure and context

### Recent changes
- What changed in the last scaffold run (from latest changelog)
- Flag if the changelog is older than 7 days — suggest re-running `/scaffold-docs`

### Conventions
- Key patterns, naming conventions, architecture decisions the user should know

### Ready to work
- End with: "What would you like to work on?" so the session flows naturally

## Rules

- **Be concise** — the whole point is speed. The briefing should be scannable in 30 seconds.
- **Do not explore the codebase** — only use what scaffold docs provide. If info is missing, note the gap rather than investigating.
- **Do not write files** — this is read-only.
- **Do not repeat raw file contents** — synthesize and summarize.
- **If scaffold docs seem stale** (structure described doesn't match what Glob reveals at a glance), mention it and suggest `/scaffold-docs` to refresh.
