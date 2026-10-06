import type { AgentNode } from '../types'
import { childrenOf, counts, firstSentence, overlaps, passes, pipeline, scopeNodes, type Filter } from './list'

// Four ways to look at the same runs: their shape (tree), where they stand
// (board), where the time went (timeline), and, inside a run, the trail of what
// each agent did and handed to the others (trace). Pure: the view draws what these return.
export type Lens = 'tree' | 'board' | 'timeline' | 'trace'
export const LENSES: Lens[] = ['tree', 'board', 'timeline', 'trace']
export const LENS_NAMES: Record<Lens, string> = { tree: 'Tree', board: 'Board', timeline: 'Timeline', trace: 'Trace' }
// The lenses a place offers: a trace needs a run open.
export const lensesFor = (hasRun: boolean): Lens[] => (hasRun ? LENSES : LENSES.filter(l => l !== 'trace'))

export type Column = 'running' | 'done' | 'failed'
export const COLUMNS: Column[] = ['running', 'done', 'failed']
export const columnOf = (n: Pick<AgentNode, 'status'>): Column => (n.status === 'running' ? 'running' : n.status === 'done' ? 'done' : 'failed')

export type Lane = { key: string; title: string; kind: 'phase' | 'cluster' | 'workflow' | 'agent' | 'singles'; cards: AgentNode[] }

const byStart = (a: AgentNode, b: AgentNode) => a.startedAt - b.startedAt
const agentsUnder = (nodes: AgentNode[], id: string) => scopeNodes(nodes, { kind: 'node', id }).filter(n => n.kind === 'agent')

// The board's swimlanes. Inside a workflow: one lane per phase. Inside a cluster:
// one lane for its members. Inside a subagent: one lane, it and its own subagents.
// On the run list: one lane per workflow or cluster, and one for single agents.
export function boardLanes(run: AgentNode | undefined, nodes: AgentNode[], tops: AgentNode[], filter: Filter): Lane[] {
  const keep = (list: AgentNode[]) => list.filter(n => passes(n, [], filter)).sort(byStart)
  if (run) {
    if (run.kind === 'workflow') {
      return pipeline(run, nodes)
        .map(p => ({ key: `${run.id}:${p.phase}`, title: p.phase, kind: 'phase' as const, cards: keep(childrenOf(nodes, run.id).filter(k => (k.phase ?? 'Agents') === p.phase).flatMap(k => agentsUnder(nodes, k.id))) }))
        .filter(l => l.cards.length > 0)
    }
    const kind = run.kind === 'group' ? 'cluster' : 'agent'
    return [{ key: run.id, title: run.label, kind, cards: keep(agentsUnder(nodes, run.id).filter(n => run.kind === 'agent' || n.id !== run.id)) }]
  }
  const lanes: Lane[] = []
  const singles: AgentNode[] = []
  for (const t of tops) {
    if (t.kind === 'agent') { singles.push(...agentsUnder(nodes, t.id)); continue }
    const cards = keep(agentsUnder(nodes, t.id))
    if (cards.length) lanes.push({ key: t.id, title: t.label, kind: t.kind === 'group' ? 'cluster' : 'workflow', cards })
  }
  if (singles.length) lanes.push({ key: 'singles', title: 'Single agents', kind: 'singles', cards: keep(singles) })
  return lanes
}

export type TimeRow = { kind: 'bar'; node: AgentNode } | { kind: 'label'; text: string }

// The timeline's rows: on the run list one bar per run; inside a workflow its agents
// under phase labels; inside a cluster or a subagent every agent under it.
export function timelineRows(run: AgentNode | undefined, nodes: AgentNode[], tops: AgentNode[], filter: Filter): TimeRow[] {
  if (!run) return tops.filter(n => passes(n, childrenOf(nodes, n.id), filter)).map(node => ({ kind: 'bar' as const, node }))
  if (run.kind === 'workflow') {
    const out: TimeRow[] = []
    for (const p of pipeline(run, nodes)) {
      const list = childrenOf(nodes, run.id).filter(k => (k.phase ?? 'Agents') === p.phase && passes(k, [], filter)).flatMap(k => agentsUnder(nodes, k.id)).sort(byStart)
      if (!list.length) continue
      out.push({ kind: 'label', text: p.phase })
      for (const node of list) out.push({ kind: 'bar', node })
    }
    return out
  }
  return agentsUnder(nodes, run.id).filter(n => (run.kind === 'agent' || n.id !== run.id) && passes(n, [], filter)).sort(byStart).map(node => ({ kind: 'bar' as const, node }))
}

// The run list's timeline, opened up: each run as a heading with its agents under
// it, newest runs first (at most `maxRuns`), so the picture shows who ran when.
// A run that is one agent stays one bar, with no heading.
export function listTimelineRows(nodes: AgentNode[], tops: AgentNode[], maxRuns = 8): { rows: TimeRow[]; runs: number; hidden: number } {
  const shown = [...tops].sort((a, b) => b.startedAt - a.startedAt).slice(0, maxRuns).sort(byStart)
  const rows: TimeRow[] = []
  for (const top of shown) {
    if (top.kind === 'agent' && !childrenOf(nodes, top.id).length) { rows.push({ kind: 'bar', node: top }); continue }
    rows.push({ kind: 'label', text: top.label })
    for (const node of agentsUnder(nodes, top.id).filter(n => n.id !== top.id || top.kind === 'agent').sort(byStart)) rows.push({ kind: 'bar', node })
  }
  return { rows, runs: shown.length, hidden: Math.max(0, tops.length - shown.length) }
}

// ── insights: what needs a look, each pointing at the item it names ─────────

export const QUIET_MS = 120_000
export type Insight = { kind: 'quiet' | 'overlap' | 'failed' | 'slow' | 'tokens'; text: string; target?: string; tone: 'warn' | 'bad' | 'info' }

const mins = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.round(ms / 60_000)}m`)
const short = (p: string) => p.split('/').filter(Boolean).pop() ?? p
const kTok = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
const list2 = (names: string[]) => (names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`)

// The scope is every node the view shows (a run's subtree, or the tab's runs).
export function insights(scope: AgentNode[], all: AgentNode[], now: number): Insight[] {
  const agents = scope.filter(n => n.kind === 'agent')
  const out: Insight[] = []
  for (const n of agents) {
    if (n.status !== 'running') continue
    const since = now - (n.lastToolAt ?? n.startedAt)
    if (since >= QUIET_MS) out.push({ kind: 'quiet', tone: 'warn', target: n.id, text: `${n.label} made no tool call for ${mins(since)}.` })
  }
  for (const o of overlaps(agents)) {
    out.push({ kind: 'overlap', tone: 'warn', target: o.by[0]!.id, text: `${o.by.length} agents edited ${short(o.path)}: ${list2(o.by.map(b => b.label))}.` })
  }
  const failed = agents.filter(n => n.status === 'failed')
  if (failed.length) out.push({ kind: 'failed', tone: 'bad', target: failed[0]!.id, text: `${failed.length} agent${failed.length === 1 ? '' : 's'} failed: ${list2(failed.map(f => f.label))}.` })
  // the slowest phase of each workflow in scope, when it took most of the time
  for (const wf of scope.filter(n => n.kind === 'workflow')) {
    const spans = pipeline(wf, all).map(p => {
      const list = childrenOf(all, wf.id).filter(k => (k.phase ?? 'Agents') === p.phase)
      const start = Math.min(...list.map(k => k.startedAt))
      const end = Math.max(...list.map(k => k.endedAt ?? now))
      return { phase: p.phase, ms: Math.max(0, end - start) }
    }).filter(p => Number.isFinite(p.ms))
    if (spans.length < 2 || spans.some(p => p.ms <= 0)) continue
    const total = spans.reduce((a, p) => a + p.ms, 0)
    const top = [...spans].sort((a, b) => b.ms - a.ms)[0]!
    const share = total > 0 ? Math.round((top.ms / total) * 100) : 0
    if (share >= 60 && total >= 10_000) out.push({ kind: 'slow', tone: 'info', target: wf.id, text: `The ${top.phase} phase took ${share}% of the time.` })
  }
  const spent = agents.filter(n => (n.tokens ?? 0) > 0)
  if (spent.length >= 2) {
    const total = spent.reduce((a, n) => a + (n.tokens ?? 0), 0)
    const top = [...spent].sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0))[0]!
    out.push({ kind: 'tokens', tone: 'info', target: top.id, text: `${top.label} used ${Math.round(((top.tokens ?? 0) / total) * 100)}% of the tokens (${kTok(top.tokens ?? 0)} of ${kTok(total)}).` })
  }
  return out
}

// A cluster's aspects: what each member covers, with how it went.
export const aspects = (nodes: AgentNode[], groupId: string) =>
  childrenOf(nodes, groupId).sort(byStart).map(k => ({ node: k, text: firstSentence(k.label, 40) }))

// Done of total, for a roll-up: finished (done, failed or stopped) out of all.
export const rollup = (list: AgentNode[]) => {
  const c = counts(list)
  return { ...c, finished: c.total - c.running }
}

// ── where the time went: the chain that set the end time, and the idle time ──

// Agents count as one after another when the later one starts within this of the earlier one's end.
const SLACK_MS = 3000
const endOf = (n: AgentNode, now: number) => (n.status === 'running' ? now : n.endedAt ?? now)

export type CriticalPath = { ids: string[]; ms: number; span: number }

// The critical path: the agent that ended last, then, going back in time, the agent
// that ended last before it started, and so on. Shortening any of them shortens the
// run; the others ran beside them. Needs two agents or more.
export function criticalPath(agents: AgentNode[], now: number): CriticalPath | undefined {
  const list = agents.filter(n => n.kind === 'agent')
  if (list.length < 2) return undefined
  const t0 = Math.min(...list.map(n => n.startedAt))
  const t1 = Math.max(...list.map(n => endOf(n, now)))
  const latest = (xs: AgentNode[]) => xs.reduce((a, b) => (endOf(b, now) > endOf(a, now) || (endOf(b, now) === endOf(a, now) && b.startedAt < a.startedAt) ? b : a))
  const chain: AgentNode[] = [latest(list)]
  for (;;) {
    const cur = chain[chain.length - 1]!
    const before = list.filter(n => !chain.includes(n) && endOf(n, now) <= cur.startedAt + SLACK_MS)
    if (!before.length) break
    chain.push(latest(before))
  }
  chain.reverse()
  return { ids: chain.map(n => n.id), ms: chain.reduce((a, n) => a + Math.max(0, endOf(n, now) - n.startedAt), 0), span: t1 - t0 }
}

export type Gap = { from: number; to: number }

// Stretches inside a run when none of its agents ran: the main session thinking,
// or waiting for the person. Short gaps are noise and are left out.
export function idleGaps(agents: AgentNode[], now: number): { gaps: Gap[]; ms: number } {
  const spans = agents.filter(n => n.kind === 'agent').map(n => ({ from: n.startedAt, to: endOf(n, now) })).sort((a, b) => a.from - b.from)
  if (spans.length < 2) return { gaps: [], ms: 0 }
  const span = Math.max(...spans.map(s => s.to)) - spans[0]!.from
  const least = Math.max(5000, span * 0.03)
  const gaps: Gap[] = []
  let reach = spans[0]!.to
  for (const s of spans.slice(1)) {
    if (s.from - reach >= least) gaps.push({ from: reach, to: s.from })
    reach = Math.max(reach, s.to)
  }
  return { gaps, ms: gaps.reduce((a, g) => a + g.to - g.from, 0) }
}

// ── cost: tokens by model family ─────────────────────────────────────────────

const FAMILIES = ['Fable', 'Opus', 'Sonnet', 'Haiku'] as const
export const modelFamily = (m: string | undefined): string => FAMILIES.find(f => m?.toLowerCase().includes(f.toLowerCase())) ?? (m ? 'Other' : 'Unknown')

// What the agents of a scope spent, per model family, most first.
export function spendByModel(scope: AgentNode[]): { model: string; tokens: number; agents: number }[] {
  const by = new Map<string, { model: string; tokens: number; agents: number }>()
  for (const n of scope) {
    if (n.kind !== 'agent' || !n.tokens) continue
    const model = modelFamily(n.model)
    const cur = by.get(model) ?? { model, tokens: 0, agents: 0 }
    cur.tokens += n.tokens
    cur.agents += 1
    by.set(model, cur)
  }
  return [...by.values()].sort((a, b) => b.tokens - a.tokens)
}

// Tokens a node and everything under it spent.
export const tokensUnder = (nodes: AgentNode[], n: AgentNode) =>
  n.kind === 'agent' ? n.tokens ?? 0 : scopeNodes(nodes, { kind: 'node', id: n.id }).filter(k => k.kind === 'agent').reduce((a, k) => a + (k.tokens ?? 0), 0) || (n.tokens ?? 0)

// ── flags: an insight, shown on the row it is about ──────────────────────────

export type Flag = { tone: 'warn' | 'bad' | 'info'; text: string }

// A short tag per row that needs a look: agents that edited a file another agent
// also edited, the agent that spent the most, a workflow's slowest phase, and the
// agent that ended last on the critical path. Keys: node ids, "phase:<wf>:<phase>".
export function rowFlags(scope: AgentNode[], all: AgentNode[], now: number): Map<string, Flag> {
  const out = new Map<string, Flag>()
  const agents = scope.filter(n => n.kind === 'agent')
  for (const o of overlaps(agents)) for (const b of o.by) if (!out.has(b.id)) out.set(b.id, { tone: 'warn', text: `⚠ shares ${short(o.path)}` })
  const spent = agents.filter(n => (n.tokens ?? 0) > 0)
  if (spent.length >= 3) {
    const total = spent.reduce((a, n) => a + (n.tokens ?? 0), 0)
    const top = [...spent].sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0))[0]!
    const share = Math.round(((top.tokens ?? 0) / total) * 100)
    if (share >= 40 && !out.has(top.id)) out.set(top.id, { tone: 'info', text: `▲ ${share}% of tokens` })
  }
  for (const wf of scope.filter(n => n.kind === 'workflow')) {
    const spans = pipeline(wf, all).map(p => {
      const list = childrenOf(all, wf.id).filter(k => (k.phase ?? 'Agents') === p.phase)
      return { phase: p.phase, ms: Math.max(...list.map(k => endOf(k, now))) - Math.min(...list.map(k => k.startedAt)) }
    }).filter(p => Number.isFinite(p.ms) && p.ms > 0)
    if (spans.length < 2) continue
    const total = spans.reduce((a, p) => a + p.ms, 0)
    const top = [...spans].sort((a, b) => b.ms - a.ms)[0]!
    const share = Math.round((top.ms / total) * 100)
    if (share >= 50) out.set(`phase:${wf.id}:${top.phase}`, { tone: 'info', text: `slowest · ${share}% of time` })
  }
  const path = criticalPath(agents, now)
  const last = path && path.ids.length >= 2 ? path.ids[path.ids.length - 1]! : undefined
  if (last && !out.has(last)) out.set(last, { tone: 'info', text: '◆ ended last' })
  return out
}
