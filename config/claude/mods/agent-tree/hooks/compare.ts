import type { AgentNode } from '../types'
import { idleGaps, spendByModel } from './lens'
import { childrenOf, fileRows, pipeline, scopeNodes } from './list'

// Two runs side by side: what each took, spent and changed, and where they differ.
// Pure: the view formats what this returns.

export type Measure = 'ms' | 'count' | 'tokens' | 'lines'
export type Metric = {
  name: string
  a: number | undefined
  b: number | undefined
  measure: Measure
  /** Whether a smaller number is the better one (time, tokens, failures); unset when neither is. */
  lowerIsBetter?: boolean
}

export type Comparison = {
  a: AgentNode
  b: AgentNode
  totals: Metric[]
  /** Per phase, by name, when either run is a workflow. */
  phases: Metric[]
  /** Tokens per model family. */
  models: Metric[]
  files: { onlyA: string[]; onlyB: string[]; both: string[] }
}

const endOf = (n: AgentNode, now: number) => (n.status === 'running' ? now : n.endedAt ?? now)

function measures(nodes: AgentNode[], run: AgentNode, now: number) {
  const scope = scopeNodes(nodes, { kind: 'node', id: run.id })
  const agents = scope.filter(n => n.kind === 'agent')
  const files = fileRows(scope)
  return {
    scope,
    agents,
    files,
    ms: endOf(run, now) - run.startedAt,
    failed: agents.filter(n => n.status === 'failed' || n.status === 'killed').length,
    tokens: agents.reduce((a, n) => a + (n.tokens ?? 0), 0) || run.tokens || 0,
    tools: agents.reduce((a, n) => a + n.tools, 0),
    added: files.reduce((a, f) => a + f.added, 0),
    removed: files.reduce((a, f) => a + f.removed, 0),
    idle: idleGaps(agents, now).ms,
  }
}

// How long each phase of a workflow took, by name.
function phaseTimes(nodes: AgentNode[], run: AgentNode, now: number): Map<string, number> {
  const out = new Map<string, number>()
  if (run.kind !== 'workflow') return out
  for (const p of pipeline(run, nodes)) {
    const list = childrenOf(nodes, run.id).filter(k => (k.phase ?? 'Agents') === p.phase)
    if (!list.length) continue
    out.set(p.phase, Math.max(...list.map(k => endOf(k, now))) - Math.min(...list.map(k => k.startedAt)))
  }
  return out
}

export function compareRuns(nodes: AgentNode[], a: AgentNode, b: AgentNode, now: number): Comparison {
  const A = measures(nodes, a, now)
  const B = measures(nodes, b, now)
  const totals: Metric[] = [
    { name: 'Time', a: A.ms, b: B.ms, measure: 'ms', lowerIsBetter: true },
    { name: 'Idle', a: A.idle, b: B.idle, measure: 'ms', lowerIsBetter: true },
    { name: 'Agents', a: A.agents.length, b: B.agents.length, measure: 'count' },
    { name: 'Failed', a: A.failed, b: B.failed, measure: 'count', lowerIsBetter: true },
    { name: 'Tokens', a: A.tokens, b: B.tokens, measure: 'tokens', lowerIsBetter: true },
    { name: 'Tool calls', a: A.tools, b: B.tools, measure: 'count' },
    { name: 'Files', a: A.files.length, b: B.files.length, measure: 'count' },
    { name: 'Lines added', a: A.added, b: B.added, measure: 'lines' },
    { name: 'Lines removed', a: A.removed, b: B.removed, measure: 'lines' },
  ]
  const pa = phaseTimes(nodes, a, now)
  const pb = phaseTimes(nodes, b, now)
  const phaseNames = [...pa.keys(), ...[...pb.keys()].filter(k => !pa.has(k))]
  const phases: Metric[] = phaseNames.map(name => ({ name, a: pa.get(name), b: pb.get(name), measure: 'ms', lowerIsBetter: true }))
  const ma = new Map(spendByModel(A.agents).map(m => [m.model, m.tokens]))
  const mb = new Map(spendByModel(B.agents).map(m => [m.model, m.tokens]))
  const modelNames = [...ma.keys(), ...[...mb.keys()].filter(k => !ma.has(k))]
  const models: Metric[] = modelNames.map(name => ({ name, a: ma.get(name) ?? 0, b: mb.get(name) ?? 0, measure: 'tokens', lowerIsBetter: true }))
  const fa = new Set(A.files.map(f => f.path))
  const fb = new Set(B.files.map(f => f.path))
  return {
    a, b, totals, phases, models,
    files: { onlyA: [...fa].filter(p => !fb.has(p)), onlyB: [...fb].filter(p => !fa.has(p)), both: [...fa].filter(p => fb.has(p)) },
  }
}

// Whether B did better, worse or the same as A on one metric.
export function verdict(m: Metric): 'better' | 'worse' | 'same' | 'neither' {
  if (m.a === undefined || m.b === undefined || m.a === m.b) return m.a === m.b ? 'same' : 'neither'
  if (m.lowerIsBetter === undefined) return 'neither'
  // a change under 5% is the same, for time and tokens
  if ((m.measure === 'ms' || m.measure === 'tokens') && Math.abs(m.b - m.a) <= Math.max(m.a, m.b) * 0.05) return 'same'
  return (m.b < m.a) === m.lowerIsBetter ? 'better' : 'worse'
}

// The earlier run that did the same work: same workflow name, else the same label.
export function previousOf(history: AgentNode[], run: AgentNode): AgentNode | undefined {
  const same = (n: AgentNode) => n.id !== run.id && !n.parentId && n.kind === run.kind && (run.tag ? n.tag === run.tag : n.label === run.label)
  return history.filter(n => same(n) && n.startedAt < run.startedAt).sort((x, y) => y.startedAt - x.startedAt)[0]
}
