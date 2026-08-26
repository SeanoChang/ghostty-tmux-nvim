---
name: ccdash-analysis
description: Analyze a local ccdash archive of Claude Code and Codex requests — token spend, model routing, subagent fan-out, cost trend — and turn it into ranked, evidence-backed changes. Use when the user asks to analyze their ccdash usage, review token spend, work out where their Claude costs are going, find savings in model routing or subagent use, or explain a spend trend.
---

# ccdash analysis

ccdash keeps a local archive of every Claude Code and Codex request it has
ingested: token counts and an equivalent cost, nothing else. This playbook
turns that into advice.

Read the archive through `ccdash export`. Answer the five questions in section
3, in that order. Cite a slice and a figure for every claim, and say "the data
cannot answer that" rather than estimating — section 5 is the list of things it
genuinely cannot answer, and it is not negotiable.

## 1. Get the data

Run:

```bash
ccdash export --stdout --format json
```

That prints one JSON document and writes nothing to disk. Add a window from
what the user asked for; when they did not say, use `--range 30d`.

| The user said                | Flag              |
| ---------------------------- | ----------------- |
| nothing about time           | `--range 30d`     |
| today, so far today          | `--range today`   |
| this week                    | `--range week`    |
| this month                   | `--range month`   |
| everything, all time, ever   | `--range all`     |

Those five words are the only ones the flag takes. There is no `7d` and no
`24h`; if the user asks for a window ccdash has no word for, take the next
larger one and say in your answer that you widened it.

Narrow further only when the ask is narrow:

- `--tool claude` or `--tool codex` when the question is about one tool.
- `--project /absolute/path` for one working directory.
- `--session ID` for one session.
- `--top N` to name more rows per table before the rest folds into `other`.

If `ccdash` is not on the PATH, say so and stop.

**Never read the database.** Do not open the SQLite archive, do not shell out
to a SQL client, and do not parse the raw transcript files under
`~/.claude/projects` or `~/.codex/sessions` yourself. The export is a stable
contract across schema changes, needs no extra binary, and is where every
honesty rule below is enforced. A number obtained any other way is a number
nobody checked.

## 2. What comes back

One JSON object:

| Key        | Holds                                                                                  |
| ---------- | -------------------------------------------------------------------------------------- |
| `manifest` | tool and schema version, the scope that was queried, and the full rate table cost used  |
| `coverage` | one line — request count, date span, unpriced count                                     |
| `brief`    | the generated analysis brief: the column dictionary and the caveats. Read it first.     |
| `data`     | the ten slices                                                                          |

`data` holds `totals`, `models`, `projects`, `sessions`, `agents`,
`workflows`, `days`, `unpriced`, `limits` and `counts`. Every slice carries its
own `slice`, `source` and `note` fields. The `note` is not decoration — it is
the caveat that applies to that slice, and it overrides anything you assumed.

Three rules the shape enforces:

- **Ranked slices reconcile.** `models`, `projects`, `sessions`, `agents` and
  `workflows` come as `top` + `other` + `totals`, and nothing is dropped in the
  fold. Compute shares against that slice's own `totals` — `agents` and
  `workflows` total subagent work only, not the headline — and never present a
  `top` list as the whole population: name the `other` remainder whenever it is
  large. When every request folded into `other` is unpriced, its cost is
  `null`, so the priced rows can appear to add up to the total while a whole
  remainder has no price at all. Say so rather than reading that `null` as a
  zero.
- **`null` is not zero.** Money is `cost_at_api_rates` in USD at the list rates
  in `manifest`. `null` means the model has no rate, not that the work was
  free; `unpriced_requests` on the same row says how many requests are behind
  that `null`. A `0` you do see is a real zero.
- **`last_seen` in `limits` is a file mtime**, not a measurement clock. Treat
  it as an upper bound on freshness. An old sample is evidence of an old
  capture and of nothing else.

## 3. Answer these five, in this order

Number them in your answer. Under each, give the figures you used and the slice
they came from.

### Q1. Where is the spend concentrated, and is it trending?

From `models`, `projects` and `days`. Name the three largest cost buckets and
give each as a share of `totals.cost_at_api_rates`. Then say whether the series
in `days` is rising, flat or falling across the window, name the days that
drive it, and state how many days of data that judgement rests on. A handful of
days is a shape, not a trend — say which one you have.

### Q2. Main loop against subagents — does the fan-out earn its share?

`totals` splits tokens and cost into `main_*` and `subagent_*`. Give the
subagent share of both. Then, from `workflows` and `agents`, compare each
workflow's `agents` count against its tokens per agent.

A high agent count with low tokens per agent is the shape of over-fanning: work
split more ways than it needed, each agent paying for its own prompt and
returning little. Name the workflows that have it. One agent carrying most of a
workflow's tokens is the opposite shape, and is usually fine.

You know how many agents ran and what they cost. You do not know what any of
them did. Describe the shape; do not narrate the work.

### Q3. Cache write volume against read volume, per model

From `models`: `cache_write_5m_tokens`, `cache_write_1h_tokens` and
`cache_read_tokens`. Report the three as volumes per model, and flag exactly
one pattern:

> A model with substantial `cache_write_1h_tokens` and little or no
> `cache_read_tokens` is worth **investigating** — an hour-long cache entry
> that is never read is paying for a TTL nothing used.

Flag it as something to investigate, never as a finding, and always with this
caveat stated in the same breath: **the archive cannot trace a read back to the
write that populated it.** It records per-request token counts, not cache keys
or hits. Writes and reads in one bucket may belong to entirely different
prompts, and a low read volume may mean the cache was cold, the session was
short, or the work simply moved on — none of which is a misconfigured TTL.

Do not turn this into arithmetic. No ratio at which a cache write is said to
repay itself, no savings figure, no "the cache repaid itself after N reads".
The archive does not carry what any of those need. If the user wants cache
economics, say what would have to be recorded — cache keys, and a hit or miss
per request — and stop there.

### Q4. Model routing

`models` is the only slice that carries a model name. `sessions`, `projects`
and `agents` carry none, and `ccdash export` has no `--model` flag, so nothing
in one export says which model ran a given session, project or agent. That join
is not in the data. Do not perform it, and do not describe a model's work as
concentrated anywhere: Q2's rule applies here too — you know what each model
cost, not where it ran.

What `models` alone supports, per model: cost share of
`totals.cost_at_api_rates`, request count, tokens per request (`tokens` /
`requests`), the input and output split, and the cache mix from Q3. Take the
model with the largest cost share and give those figures for it beside the
other rows.

Two shapes are worth naming, both stated in exactly those terms:

- **Expensive model, small requests.** A large cost share made of many
  low-token requests is work a cheaper model may be able to do. Give tokens per
  request against the other rows in the slice; do not say which sessions or
  projects those requests came from.
- **Cheap model, heavy request count.** A cheap model carrying many more
  requests than its tokens per request would explain is a candidate for work
  being re-run. One better call can cost less than five worse ones. `models`
  gives you the count; nothing gives you what was re-run.

If the user wants to know where a model's spend sits, that is a second export,
not a join. Re-run it scoped and read the `models` slice of the scoped run:

```bash
ccdash export --stdout --format json --project /absolute/path
ccdash export --stdout --format json --session ID
```

Every slice is filtered to the scope, `models` included, so the per-project or
per-session model breakdown comes back as that run's own `models` table. Name
the scope you ran. If you did not run a second export, say the per-project
detail is not in what you have rather than reaching for it.

Both shapes are hypotheses about routing, and this archive can confirm neither — it
has no record of whether any request succeeded. Present them as worth testing,
with the numbers that suggested them, and say what the next window would have
to show to settle it.

### Q5. Unpriced coverage — settle this before trusting any dollar figure

From `unpriced` and the `unpriced_requests` field on every row. State what
share of requests carries no price, and which models they are.

Then say, explicitly, which of the four answers above would change if those
requests turned out to be expensive. This question comes last so its answer can
qualify the others, not because it matters least: if unpriced coverage is more
than a few percent, every dollar figure you have quoted is a floor, and the
summary has to say so.

## 4. What each finding licenses

| Finding                                        | You may recommend                                                             | You may not                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| One project or model dominates cost            | Looking at that project's workflow; checking whether the window explains it     | Calling the work wasteful — the archive holds no measure of value                                   |
| Subagent share high, tokens per agent low      | Fanning out less: fewer agents per workflow, or one agent with a larger brief   | Saying the agents duplicated each other — nothing records what they did                             |
| Largest-cost model doing many small requests   | Routing that class of work to a cheaper model and comparing the next window     | Predicting the saving as a fixed percentage — the cheaper model may need more passes                |
| Cheap model, many requests for few tokens      | Trying one better call in place of the repeat loop                              | Asserting the repeats were failures — success is not recorded                                       |
| 1h cache writes with no read volume            | Investigating the TTL choice at that call site                                  | Computing what the cache cost or saved                                                              |
| Unpriced share material                        | Adding rates to `pricing.toml` and re-running the export                        | Quoting a total as if it were complete                                                              |
| A limit near its cap                           | Noting it with `last_seen` and `age_seconds` beside it                          | Treating `last_seen` as a reading — it is a file mtime                                              |

## 5. What ccdash cannot see

None of this is in the archive. If an answer needs one of them, say so and say
what would have to be recorded. Do not infer it, and do not soften it into a
guess.

- **Which tools a request called.** No Bash, Read, Edit, WebFetch or MCP call
  is recorded — only the token totals of the request that made them. You cannot
  call a session tool-heavy, cannot count tool calls, and cannot recommend a
  change to tool usage.
- **Prompt or response text.** No content of any kind is stored. Nothing here
  says what the work was about, so do not characterise it.
- **Latency.** No start, end or duration per request. A session's span is its
  first timestamp to its last, including every minute nobody was working. Never
  present a span as time spent, and never compare models on speed.
- **Success or failure.** A retried, abandoned or discarded turn looks exactly
  like a useful one. No success rate, no error rate, no "wasted" tokens.
- **Per-request context window.** The token columns are what was billed, not
  how full the window was.
- **Git branch, commit, diff size or any repository state.**
- **Anything about a subagent beyond its name, workflow, depth, tokens and
  cost.**
- **Which model ran a given session, project or agent.** `models` carries the
  model names; `sessions`, `projects` and `agents` carry none, and there is no
  `--model` flag to filter by. A scoped re-run — `--project`, `--session`,
  `--tool` — returns a `models` slice for that scope, and that is the only way
  to get the breakdown. Joining the slices of a single run is not it.

Three definitions the field names hide:

- `tokens` = input + output + cache_read + cache_write_5m + cache_write_1h.
  Thinking tokens are excluded everywhere and are not priced.
- `project` is a raw working directory, not a repository. Two checkouts of one
  repo are two projects; a monorepo is one.
- `counts.utc_days` counts UTC days while `days` buckets by local calendar day,
  so the two can differ by one at each end.

## 6. How to deliver the answer

- Lead with the three changes you would make, ranked by expected saving, each
  citing the slice and the figures it rests on.
- Then the five questions, answered in order.
- Then a short list of changes you would want to recommend but cannot justify
  from this data, each with what ccdash would have to record to support it.
- Write costs as "$X at list rates". It is an equivalent at published API
  rates, not an invoice, and a subscription plan bills nothing like it.
- If `coverage` shows a short window or a small request count, say what the
  conclusions rest on before you draw them.

If the user wants to hand the numbers to someone else, `ccdash export` without
`--stdout` writes a bundle to `$XDG_DATA_HOME/ccdash/exports/<timestamp>/`, and
`--redact` maps working directories to `project-N` and session IDs to `sNN`
first.

<!--
  Absent by design — two things this playbook used to be asked for, and does
  not carry. Do not add them back.

  1. A fixed multiple at which a cache write is said to repay itself. The
     figure that circulated was checked against the real counterfactual —
     paying the input rate on every prompt token when there is no cache entry
     — and was wrong by close to an order of magnitude, in the direction that
     flatters caching. A replacement rule of thumb derived any other way will
     be wrong the same way.

  2. Any formula that reconstructs how full a context window was from the
     token columns. Every candidate leaves out part of the same prompt, and
     the live archive holds counterexamples where it disagrees with reality by
     a wide margin.

  Both belong to proposals the design demoted, each with a stated condition for
  coming back: new recorded data — cache keys and hit/miss per request, or a
  per-request window figure — not better prose here. Until then, a question
  that needs either one gets the honest answer in section 5: say what ccdash
  would have to record, and stop.
-->
