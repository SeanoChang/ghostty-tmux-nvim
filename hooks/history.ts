import type { AgentNode } from '../types'
import { fileRows, scopeNodes, type Item } from './list'
import { reportOf } from './report'

// The History page: finished runs by day, with what each one achieved, filters and
// a search. Pure: the view draws what these return.

export type HistoryFilter = 'all' | 'failed' | 'changed'
export const HISTORY_FILTERS: HistoryFilter[] = ['all', 'failed', 'changed']
export const HISTORY_FILTER_NAMES: Record<HistoryFilter, string> = { all: 'all runs', failed: 'failed only', changed: 'changed files only' }

export type Bucket = 'Today' | 'Yesterday' | 'This week' | 'Older'
const BUCKETS: Bucket[] = ['Today', 'Yesterday', 'This week', 'Older']
const DAY = 86_400_000
const startOf = (x: number) => { const d = new Date(x); d.setHours(0, 0, 0, 0); return d.getTime() }
// whole days between a time and now, by the calendar; a time after now counts as today
export const daysAgo = (t: number, now: number) => Math.max(0, Math.round((startOf(now) - startOf(t)) / DAY))
export const bucketOf = (t: number, now: number): Bucket => {
  const d = daysAgo(t, now)
  return d === 0 ? 'Today' : d === 1 ? 'Yesterday' : d < 7 ? 'This week' : 'Older'
}

// The top-level runs of a list of nodes, newest first.
export function historyRuns(nodes: AgentNode[]): AgentNode[] {
  const ids = new Set(nodes.map(n => n.id))
  return nodes.filter(n => !n.parentId || !ids.has(n.parentId)).sort((a, b) => b.startedAt - a.startedAt)
}

const failedUnder = (nodes: AgentNode[], run: AgentNode) =>
  scopeNodes(nodes, { kind: 'node', id: run.id }).some(n => n.status === 'failed' || n.status === 'killed')

// What a run achieved, in one sentence: its report's result, else why there is none.
export const outcomeOf = (n: AgentNode) => reportOf(n)?.result ?? ''

// Runs the filter and the search keep: names and outcomes, a run's members' names too.
export function matches(nodes: AgentNode[], run: AgentNode, filter: HistoryFilter, query: string): boolean {
  if (filter === 'failed' && !failedUnder(nodes, run)) return false
  if (filter === 'changed' && fileRows(scopeNodes(nodes, { kind: 'node', id: run.id })).length === 0) return false
  const q = query.trim().toLowerCase()
  if (!q) return true
  const under = scopeNodes(nodes, { kind: 'node', id: run.id })
  return under.some(n => n.label.toLowerCase().includes(q) || outcomeOf(n).toLowerCase().includes(q))
}

// The page's rows: a header per day bucket ("2 runs · 1 with failures"), then its runs.
// Older starts folded: its header stays, its runs show once it is opened.
export function historyItems(nodes: AgentNode[], now: number, o: { filter: HistoryFilter; query: string; olderOpen: boolean }): Item[] {
  const runs = historyRuns(nodes).filter(r => matches(nodes, r, o.filter, o.query))
  const out: Item[] = []
  for (const b of BUCKETS) {
    const list = runs.filter(r => bucketOf(r.startedAt, now) === b)
    if (!list.length) continue
    const failures = list.filter(r => failedUnder(nodes, r)).length
    const note = `${list.length} run${list.length === 1 ? '' : 's'}${failures ? ` · ${failures} with failures` : ''}`
    const isOpen = b !== 'Older' || o.olderOpen
    out.push({ kind: 'header', text: b, count: list.length, note, ...(b === 'Older' ? { isOpen } : {}) })
    if (!isOpen) continue
    for (const node of list) out.push({ kind: 'node', node, species: 'cat', depth: 0 })
  }
  return out
}

// Tokens a run spent: its agents', else what the run itself recorded.
export function runTokens(nodes: AgentNode[], run: AgentNode): number {
  const sum = scopeNodes(nodes, { kind: 'node', id: run.id }).filter(n => n.kind === 'agent').reduce((a, n) => a + (n.tokens ?? 0), 0)
  return sum || run.tokens || 0
}

export type HistoryStats = { runs: number; okPct: number; tokens: number; perDay: number[] }

// The page's header numbers: runs, the share that finished OK, tokens, runs per day.
export function historyStats(nodes: AgentNode[], now: number, days = 7): HistoryStats {
  const runs = historyRuns(nodes)
  const finished = runs.filter(r => r.status !== 'running')
  const ok = finished.filter(r => r.status === 'done' && !failedUnder(nodes, r)).length
  const perDay = new Array<number>(days).fill(0)
  for (const r of runs) {
    const d = daysAgo(r.startedAt, now)
    if (d < days) perDay[days - 1 - d]!++
  }
  return {
    runs: runs.length,
    okPct: finished.length ? Math.round((ok / finished.length) * 100) : 0,
    tokens: runs.reduce((a, r) => a + runTokens(nodes, r), 0),
    perDay,
  }
}

// Block glyphs over a domain taken from the data: an empty day is the lowest block,
// the busiest day the highest, so the shape never clips.
const SPARK = ['▁', '▂', '▃', '▅', '▇']
export function sparkline(counts: number[]): { glyphs: string; max: number } {
  const max = Math.max(0, ...counts)
  const glyphs = counts.map(c => (c <= 0 || max === 0 ? SPARK[0]! : SPARK[Math.max(1, Math.min(4, Math.round((c / max) * 4)))]!)).join('')
  return { glyphs, max }
}
