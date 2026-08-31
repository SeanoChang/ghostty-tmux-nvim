# Conventions

The vault's established rules, measured from 1,364 notes. **Structure is settled — match it. Properties are not — write the committed set below and nothing else.**

## Contents

- [Folder map](#folder-map)
- [Naming and IDs](#naming-and-ids)
- [Filename vs H1](#filename-vs-h1)
- [Committed frontmatter](#committed-frontmatter)
- [Controlled vocabularies](#controlled-vocabularies)
- [Tags](#tags)
- [Linking and MOCs](#linking-and-mocs)
- [The iCloud mirror](#the-icloud-mirror)

---

## Folder map

New notes have **no fixed default** — route by topic into the existing tree, then follow that folder's local naming rule. The rules differ.

| Folder | Notes | Holds | Naming rule |
|---|---:|---|---|
| `Learning/` | 357 | Real Purdue coursework + Self Study + Financial Engineering | `Week NN - Topic.md` — ASCII hyphen, **no ID** |
| `Hardware & IC Design/` | 295 | Self-run HDL → RISC-V → VLSI → SoC curriculum | `NN-NN Topic — Subtitle.md`, tracks A/B |
| `System Design/` | 247 | Self-run 22-week interview-prep curriculum | `NN-NN Topic — Subtitle.md`, tracks A–D |
| `AI Infra & Cloud Ops/` | 174 | Self-run 13-week AI-infra curriculum | `αN-NN`, `βN-NN`, `MN-NN Topic — Subtitle.md` |
| `Projects/` | 157 | Real software projects (Ark, Cubit, Keel, Noah, Taiwan Stock Monitor) | Descriptive title, em dash, versioned `vN` or plan name. **No ID** |
| `Ideas/` | 83 | Venture planning, mostly the Taiwan POS platform | No ID. Chinese titles common. ISO-date prefix for dated working docs |
| `Solo Leveling/` | 29 | Trading-infra build log, phases 0–6 | `Phase N - Name.md` — hyphen, **unpadded** |
| `Trading/` | 7 | Market/strategy reference | Plain topic nouns, no prefix |
| `Research/` | 4 + PDFs | Paper stash — `Agent/`, `Finance/` | No ID; Chinese common in `Finance/` |
| `ByteByteGo/` | 1 | Course scaffold `00`–`07`, effectively empty | `NN-NN` when populated |
| `故事/`, `Career/`, `Life/` | 5 / 4 / 1 | **Personal. Do not read or write without explicit instruction.** | — |

**Scheme: MOC/Zettelkasten navigation over a course syllabus.** Not Johnny Decimal, not PARA. Zero-padded topic folders (`04 Distributed Systems Fundamentals/`) hold zero-padded notes (`04-06 Topic — Subtitle.md`), one `NN-00 MOC — …` hub per folder, and a `00 HOME.md` per curriculum root linking to `00 STUDY PLAN`, `00 TRACK *`, `00 RESOURCE LOG`.

**Greek and Latin prefixes encode track, never difficulty.** In `AI Infra & Cloud Ops/`: α = AI Ops & Platform, β = Hardware & Serving, M = Merge capstones integrating both. `Hardware & IC Design` and `System Design` express the same axis as Latin A/B and A–D. Always *track*, never *tier*.

## Naming and IDs

**Dominant pattern:** `NN-NN Topic — Elaborating Clause.md`

The em dash separates a short noun-phrase topic from a longer explanatory subtitle — a technique list, or author and year for papers. Titles **name a subject and enumerate its facets**. They are claim-adjacent but not claim-shaped sentences; do not convert them into assertions.

```
04-02 CAP Theorem — Consistency, Availability, Partitions.md
08-13 The Power Wall — Dennard Scaling's End.md
α1-03 Semantic Caching — Embedding Similarity, Cache Invalidation, GPTCache Architecture.md
M1-08 Paper — RAG for Knowledge-Intensive NLP Tasks (Lewis et al. 2020).md
β1-04 Math — FLOPS Calculation, Bandwidth Utilization, Optimal Tile Size Derivation.md
```

**Reserved type-words** follow the ID and replace the topic noun. Each maps to a `type:` value and a template in `references/patterns.md`:

`Paper —` · `SOTA —` · `Math —` · `PROJECT —` · `LAB —` · `INTERVIEW —`

**Deriving the next ID:**

1. List existing notes in the target folder; take the numeric prefix of each.
2. The folder number is fixed by the folder (`08 Advanced Architecture/` → `08-`).
3. Next note number is max + 1, zero-padded to two digits.
4. **Suffix letters attach a side-note without renumbering** — `-03a`, `-07b` for a paper or SOTA note that elaborates the note it hangs off. Use a suffix rather than inserting and shifting everything after it.
5. Never renumber existing notes. Links resolve by name; renumbering breaks every inbound link.

## Filename vs H1

**The H1 repeats the title with the ID prefix stripped.** This is convention, not drift — 1,006 of 1,334 notes with an H1 differ from their filename for exactly this reason.

```
File:  04-06 Fault Tolerance — Byzantine, Fail-Stop, Crash Recovery.md
H1:    # Fault Tolerance — Byzantine, Fail-Stop, Crash Recovery
```

**MOC notes keep a shortened ID:** `# 04 — Distributed Systems Fundamentals`

**Exception:** long SOTA and Paper notes sometimes keep the full ID in the H1. Match the sibling notes in the same folder.

Immediately under the H1: a **one-line `>` blockquote abstract**. Then the first `##`.

## Committed frontmatter

The vault has 48 distinct keys across 1,049 notes with frontmatter. **Write only these.** Anything else is sprawl.

**Universal — every note:**

| Key | Type | Notes |
|---|---|---|
| `tags` | inline array | `[topic, topic, course-code]`. Inline form (`[a, b]`), not block list — 794 vs 234, pick the majority |
| `type` | string | See vocabulary below. Replaces `category` and `classification` |

**Curriculum notes** (`Hardware & IC Design/`, `System Design/`, `AI Infra & Cloud Ops/`, `ByteByteGo/`):

| Key | Type | Notes |
|---|---|---|
| `track` | **list, always** | `[A]`, `[B]`, `[α]`, `[β]`, `[M]`. Never a bare string |
| `difficulty` | string | `foundation` \| `intermediate` \| `advanced` \| `capstone` |
| `domain` | string | Subject axis — `ml-systems`, `agent-llm`, `ops`, `networking`, … |
| `course` | **list, always** | `[ECE-437, ECE-565]`. Never a bare string |
| `prereqs` | list of wikilinks | `["[[04-05 …]]"]`. Never `prerequisites` |
| `estimated-hours` | number | Never `estimated_hours`, never `hours` |
| `status` | string | See vocabulary below |

**Dated and project notes** (`Projects/`, `Ideas/`, `Trading/`, `Research/`, `Solo Leveling/`):

| Key | Type | Notes |
|---|---|---|
| `created` | date `YYYY-MM-DD` | Never `date` |
| `project` | string | Project slug |
| `sources` | list | Citations. Never `source` |
| `source_key` | string | **Distinct meaning** — a join key, not a citation. Do not merge into `sources` |
| `aliases` | list | Alternate-language or shortened name. **This is where a Chinese title goes**, not `title:` |
| `due` | date `YYYY-MM-DD` | Staleness review date. Written by second-brain-obsidian on SOTA notes only; do not backfill |

**Never write these** — they are drift, degenerate, or duplicate what the filename already says:

`estimated_hours` · `hours` · `prerequisites` · `date` · `category` · `classification` · `source` · `folder` · `module` · `layer` · `scope` · `name` · `title` · `week` · `professor` · `exam` · `syllabus` · `market` · `parent` · `key` · `hidden` · `verified` · `description` · `author` · `authors` · `last-updated` · `methodology` · `semester` · `supersedes` · `version` · `audience`

> [!warning] `title:` is the trap
> 179 notes carry it, usually duplicating the H1. Where it differs — typically a Chinese title on an English-named note — migrate it to `aliases:`, which is Obsidian-native and makes `[[中文名]]` actually resolve. Where it duplicates, drop it.

> [!note] Out of scope
> `mode`, `model`, `temperature`, `permission` (10 notes each) configure a tool rather than describe a note. Leave them alone.

## Controlled vocabularies

**`type`** — the note's kind, mirroring the filename type-word:

`note` (default) · `moc` · `paper` · `sota` · `math` · `lab` · `project` · `spec` · `interview` · `home` · `plan`

**`status`** — collapse the existing seven-plus values to three:

| Write | Absorbs |
|---|---|
| `scaffold` | `scaffold`, `skeleton` — created, body not written |
| `draft` | `draft`, `research-complete` — written, not finished |
| `done` | `complete`, `current`, `approved` — finished |

**`track`** — always a list. `merge` (42 notes) is a sentinel, not a track: it means `[M]`.

**`difficulty`** and **`domain`** — the existing `level` key conflates two orthogonal axes across 531 notes, which makes sorting or filtering by it meaningless. Split:

| `level` value | Becomes |
|---|---|
| `foundation`, `intermediate`, `advanced`, `capstone` | `difficulty:` |
| `ml-systems`, `agent-llm`, `ml-bridge`, `ops` | `domain:` |
| `SOTA` | `type: sota` — it's a note kind, not a level |

## Tags

**Frontmatter tags only.** 1,028 notes use them; inline `#tags` appear in 7 and are not a convention. Never write an inline tag — and note that `[[#Heading]]` anchors are *not* tags, despite matching a naive `#\w+` search.

**Flat, no nesting.** Exactly one tag in the vault contains a `/`. Hierarchy is carried by prefixed flat tags (`track-B`) and by dedicated keys (`track`, `difficulty`, `domain`, `course`) — not by `parent/child`.

**Reuse before inventing.** 1,272 distinct tags exist and most are singletons. Before adding a tag, check whether an established one covers it. The high-frequency set: `java`, `enterprise`, `twn-stocks`, `research`, `interview`, `MOC`, `data-pipeline`, `memory`, `theory`, `spring`, `opencode`, `track-B`, `SOTA`, `project`, `qwen`, `architecture`, `foundation`, `market-data`, `information`, `agents`, `spec`, `ECE-437`, `ECE-565`, `processor`, `hands-on`, `messaging`, `taiwan-pos`, `verification`, `VLSI`, `infra`.

## Linking and MOCs

**Wikilinks, shortest form.** `newLinkFormat: shortest`, `alwaysUpdateLinks: true`.

**Never write a relative-path link.** `[[../concurrency/05 Virtual Threads]]` does not resolve in Obsidian — it is a bug, not a style. Link by note name.

**Never link a duplicated basename bare.** `README` (16), `00 README` (7), `SKILL` (4), `00 HOME` (3), `00 STUDY PLAN` (3), `Week 16 - Capstone` (2) all resolve ambiguously. Use a fuller path or link to the parent MOC instead.

**Every new note gets an inbound link in the same edit.** 168 notes (12.4%) are orphans — substantial, written, and reachable from nowhere. A new note that nothing links to is a new orphan. Add it to the folder's `NN-00 MOC` and to the `prereqs` chain of whatever follows it.

**The `←`/`→` footer is established** — 400 notes carry it. Keep it:

```markdown
## Prerequisites
← [[04-05 Consensus — Raft, Paxos]]

## Next
→ [[04-07 Replication — Leader-Follower, Quorum]]
```

**Forward links to unwritten notes are acceptable** and account for a large share of the 1,026 broken refs. They are a promotion backlog, not a defect — but every one written is a debt, so prefer linking to the MOC over inventing a note name that may never exist.

## The iCloud mirror

`~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Seano` is a **mirror**, not a second vault: 1,196 of its 1,204 notes exist at identical relative paths locally, plugin config is byte-identical, and it lags by ~161 notes. Sync runs through **remotely-save**, not git.

**Never write to it.** All writes go to `~/vaults/Seano`. Its files carry the macOS `compressed,dataless` xattr — many are undownloaded stubs, so reading one may trigger a download and may return nothing useful.

If a note appears missing, check the local vault before concluding anything from the mirror.
