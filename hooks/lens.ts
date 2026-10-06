import type { AgentNode } from '../types'
import { childrenOf, counts, firstSentence, overlaps, passes, pipeline, scopeNodes, type Filter } from './list'

// Three ways to look at the same runs: their shape (tree), where they stand
// (board), and where the time went (timeline). Pure: the view draws what these return.
export type Lens = 'tree' | 'board' | 'timeline'
export const LENSES: Lens[] = ['tree', 'board', 'timeline']
export const LENS_NAMES: Record<Lens, string> = { tree: 'Tree', board: 'Board', timeline: 'Timeline' }

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
    if (since >= QUIET_MS) out.push({ kind: 'quiet', tone: 'warn', target: n.id, text: `${n.label} quiet for ${mins(since)}, no tool call` })
  }
  for (const o of overlaps(agents)) {
    out.push({ kind: 'overlap', tone: 'warn', target: o.by[0]!.id, text: `${short(o.path)} edited by ${o.by.length} agents (${list2(o.by.map(b => b.label))})` })
  }
  const failed = agents.filter(n => n.status === 'failed')
  if (failed.length) out.push({ kind: 'failed', tone: 'bad', target: failed[0]!.id, text: `${failed.length} failed: ${list2(failed.map(f => f.label))}` })
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
    if (share >= 60 && total >= 10_000) out.push({ kind: 'slow', tone: 'info', target: wf.id, text: `${top.phase} took ${share}% of the time` })
  }
  const spent = agents.filter(n => (n.tokens ?? 0) > 0)
  if (spent.length >= 2) {
    const total = spent.reduce((a, n) => a + (n.tokens ?? 0), 0)
    const top = [...spent].sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0))[0]!
    out.push({ kind: 'tokens', tone: 'info', target: top.id, text: `${kTok(total)} tokens · most: ${top.label} ${kTok(top.tokens ?? 0)} (${Math.round(((top.tokens ?? 0) / total) * 100)}%)` })
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
