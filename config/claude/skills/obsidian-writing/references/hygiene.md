# Hygiene

Twelve measured defects, the order they must be fixed in, and what becomes possible afterwards.

**The ordering is not cosmetic.** Link repair must precede renames, key normalization must precede value normalization, and everything must precede Bases — a Base built on `track:` today matches roughly half the notes it should, silently.

## Contents

- [The defects](#the-defects)
- [Order of operations](#order-of-operations)
- [Normalization map](#normalization-map)
- [What Bases unlocks](#what-bases-unlocks)
- [Running the pass](#running-the-pass)

---

## The defects

| # | Defect | Scale | Kind |
|---|---|---:|---|
| 1 | `track:` is a bare string in Hardware, an inline list in System Design | 675 notes | Type split |
| 2 | Relative-path wikilinks (`[[../concurrency/…]]`) never resolve | part of 1,026 broken refs | Bug |
| 3 | `<!-- Content to be generated -->` scaffolds | 143 notes (10.5%) | Backlog |
| 4 | Notes with no frontmatter at all | 307 notes (23%) | Gap |
| 5 | `level:` conflates difficulty and domain | 531 notes | Schema |
| 6 | `status:` uncontrolled vocabulary | 89 notes | Vocabulary |
| 7 | `estimated-hours` / `estimated_hours` / `hours` — three-way, folder-localized | 639 notes | Key drift |
| 8 | `created` vs `date` — zero notes carry both | 348 notes | Key drift |
| 9 | Duplicated basenames (`README` ×16) make `[[…]]` ambiguous | 6 basenames, 35 notes | Resolution |
| 10 | Orphans — substantial notes nothing links to | 168 notes (12.4%) | Weaving |
| 11 | `prereqs` vs `prerequisites`, plus list-vs-string | 486 notes | Key drift |
| 12 | 2 commits in 8 days, dirty tree, obsidian-git never auto-committed | — | Process |

**#1 is the worst.** It is invisible from inside Obsidian, it breaks every future query on the vault's most-used discriminator, and it got there because two folders were authored in different sessions — which means it will happen again to the next key unless the committed set in `references/conventions.md` is actually enforced.

**#3 is eight times larger than the stub count suggests.** Scaffolds carry enough words and links to clear both stub thresholds, so a stub scan reports 18 while the real unwritten backlog is 143.

**#10 is the diagnosis.** Capture works — 18 true stubs out of 1,364, and written notes run 800–3,200 words. Content gets generated and gets written. It does not get **woven in**. The vault's failure mode is promotion and linkage, not capture.

## Order of operations

Each step depends on the ones above it.

1. **Commit first.** Dirty tree, 12 changed paths. Nothing below is safe to run against uncommitted work. This also fixes #12.
2. **Repair relative-path links** (#2). Pure mechanical bug, no judgment, no renames yet. `[[../concurrency/05 Virtual Threads (Project Loom)]]` → `[[05 Virtual Threads (Project Loom)]]`.
3. **Disambiguate duplicated basenames** (#9). Renames must happen after link repair and before any bulk link rewriting, or the two passes fight. With `alwaysUpdateLinks: true`, renaming inside Obsidian rewrites inbound links automatically — renaming from the shell does not.
4. **Normalize key names** (#7, #8, #11, and `category`→`type`, `source`→`sources`). Rename only; do not touch values yet.
5. **Normalize value types** (#1, plus `course`, `tags` form). String → list.
6. **Split `level`** into `difficulty` + `domain`, routing `SOTA` to `type` (#5).
7. **Collapse `status`** to three values (#6).
8. **Migrate `title:` → `aliases:`** where it differs from the H1; drop where it duplicates.
9. **Backfill frontmatter** on the 307 notes with none (#4) — minimum `tags` and `type`.
10. **Build Bases** (below). Only now do they return correct results.
11. **Weave orphans** (#10) and **burn down scaffolds** (#3). Both are ongoing editorial work, not a one-shot script.

Steps 2–9 are mechanical and scriptable. Steps 10–11 are not.

## Normalization map

**Key renames** — value untouched:

| From | To | Where it lives |
|---|---|---|
| `estimated_hours` (11) | `estimated-hours` | `AI Infra/α4 AI Observability/` only |
| `hours` (10) | `estimated-hours` | `AI Infra/α5 Eval-Driven LLMOps/` only |
| `prerequisites` (2) | `prereqs` | `AI Infra/M3`, `/M4` MOCs — also wrap the bare string in a list |
| `date` (166) | `created` | Projects, Ideas, Learning, Trading |
| `category` (10) | `type` | `Projects/Taiwan Stock Monitor/…/info/` only |
| `classification` (1) | `type` | |
| `source` (2) | `sources` | 2 Learning notes. **Do not touch `source_key`** — different meaning |
| `name` (4) | `title` → then `aliases` | 4 Learning notes |

**Keys to drop** — the filename, folder, or H1 already carries the information:

`folder` (144) · `module` (10) · `layer` (68, all 68 values identical — degenerate) · `scope` (3) · `week` (11) · `professor` (11) · `exam` (5) · `syllabus` (3) · `hidden` (3) · `verified` (71, mixed boolean/date) · `description` (14) · `market` (4) · `parent` (4) · `key` (10) · and the 9 singletons.

**Value normalization:**

| Key | Rule |
|---|---|
| `track` | Always a list. `A` → `[A]`, `merge` → `[M]`. 266 Hardware notes are bare strings |
| `course` | Always a list. 13 Learning notes are bare strings |
| `tags` | Inline array form. 234 notes use block-list form — convert to match the 794 |
| `status` | `skeleton`→`scaffold`; `research-complete`→`draft`; `complete`/`current`/`approved`→`done`. One note has a ~200-char prose sentence as its status — read it, then replace |
| `level` | Split per `references/conventions.md`, then delete the key |
| `title` | Chinese or differing → `aliases`. Duplicates H1 → drop. One bare value parses as a date object |
| `verified` | Drop. 71 booleans plus 2 parsing as dates under one key |

> [!warning] Verify before bulk-editing
> Counts here come from a point-in-time scan. Re-derive them before a destructive pass, and run each step as a separate commit so any one is revertable.

## What Bases unlocks

Zero `.base` files exist today, and the plugin is enabled. Three are worth building **after** step 9 — each replaces hand-maintenance that is currently a stated pain point.

**1. Backlog** — the 143 scaffolds, which are currently invisible:

```yaml
filters:
  and:
    - 'status == "scaffold"'
views:
  - type: table
    name: "Unwritten"
    order: [file.folder, file.name, estimated-hours]
    groupBy:
      property: file.folder
      direction: ASC
```

**2. Track progress** — replaces the hand-written `00 TRACK *` notes:

```yaml
filters:
  and:
    - 'file.hasTag("MOC") == false'
    - 'track'
views:
  - type: table
    name: "By track"
    order: [file.name, difficulty, status, estimated-hours]
    groupBy:
      property: track
      direction: ASC
summaries:
  estimated-hours: Sum
```

**3. Folder index, embedded in each MOC** — replaces the hand-maintained `## Order` list:

```markdown
![[Curriculum.base#Folder index]]
```

Keep `## Planned` hand-written. A Base can only list notes that exist; the planned-but-unwritten list is exactly what it cannot derive, and that list is the curriculum.

Verify `file.backlinks` predicates against `kepano/obsidian-skills` before relying on an orphan-finding Base — the function surface changes between releases, and a filter that silently returns nothing looks identical to a clean vault.

## Running the pass

Steps 2–9 are a Claude Code job, not a chat job — they touch ~1,000 files.

- **One step, one commit.** Never batch. A bad regex across 675 notes is only recoverable if it is isolated.
- **Rename inside Obsidian, not the shell**, for step 3 — `alwaysUpdateLinks: true` rewrites inbound links on rename, and the shell bypasses that entirely.
- **Diff the key census before and after.** The count of distinct keys should fall from 48 toward the committed set. If it doesn't, a rename missed a folder.
- **The iCloud mirror lags ~161 notes and syncs via remotely-save.** Let it settle after each step; do not edit both copies.
- **`故事/`, `Career/`, `Life/` are out of scope** for any bulk pass unless explicitly included.
