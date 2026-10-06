import type { AgentNode, Report } from '../types'
import { childrenOf, counts, fileRows, firstSentence, noReportReason, phaseWords, pipeline, plain, readableResult, scopeNodes, type FileRow } from './list'

// The short report a person reads when work finishes. The model writes the words
// (result, done, decisions, problems, next); what changed and the totals come from
// the mod's own records, so they are exact. Reports are written bottom-up: an agent
// from its own report, a workflow phase from its agents' reports, a run from its
// part reports. Each call reads one level down and is capped, so none grows with the run.

// Simplified Technical English, about 70% of the way: what every report prompt says.
export const REPORT_RULES = [
  'Write in Simplified Technical English, about 70% of the way:',
  '- One idea per sentence. At most 15 words in a sentence.',
  '- Use active voice and plain words.',
  '- Name files, agents and numbers exactly as the input gives them.',
  '- No hedging, no filler, no praise.',
  '- Use only facts that are in the input. Do not invent. Write "unknown" when the input does not say.',
  '- At most 3 items in each list. At most 120 words in total.',
].join('\n')

export const REPORT_SYSTEM = [
  'You write the short report a person reads when AI agents finish a piece of work.',
  REPORT_RULES,
  'Reply with JSON only, no markdown:',
  '{"result": "1 or 2 sentences: what the work achieved", "done": ["what was done"],',
  ' "decisions": [{"text": "a design choice the agents made", "source": "the agent or phase it came from"}],',
  ' "problems": [{"text": "what went wrong or is still open", "source": "the agent or phase it came from"}],',
  ' "next": "1 sentence: the next step, or empty"}',
  'Use [] for an empty list. Decisions are only design choices the input states. Leave out files and line counts: the dashboard adds them from its own records.',
].join('\n')

// The caps that keep every report call bounded, however big the run.
export const CAP_EACH = 400
export const CAP_ALL = 4000
export const CAP_FINAL = 1500
export const CAP_TASK = 500

// A model's reply as a report: tolerant of fences and chatter, and of the older
// {outcome, points} digest shape. Fields it cannot read are left out, never undefined.
export function parseReport(raw: string): Report | undefined {
  const json = /\{[\s\S]*\}/.exec(raw)?.[0]
  if (!json) return undefined
  let d: Record<string, unknown>
  try { d = JSON.parse(json) as Record<string, unknown> } catch { return undefined }
  const str = (x: unknown, n: number) => {
    const t = typeof x === 'string' ? plain(x) : ''
    return t ? t.slice(0, n) : undefined
  }
  const tagged = (x: unknown) => (Array.isArray(x) ? x : []).flatMap(i => {
    const text = str(typeof i === 'string' ? i : (i as { text?: unknown } | null)?.text, 200)
    if (!text) return []
    const source = i && typeof i === 'object' ? str((i as { source?: unknown }).source, 60) : undefined
    return [source ? { text, source } : { text }]
  }).slice(0, 3)
  const doneRaw = Array.isArray(d.done) ? d.done : Array.isArray(d.points) ? d.points : []
  const done = doneRaw.map(p => str(typeof p === 'string' ? p : (p as { text?: unknown } | null)?.text, 160)).filter((p): p is string => !!p).slice(0, 3)
  const out: Report = {}
  const result = str(d.result, 300) ?? str(d.outcome, 300)
  if (result) out.result = result
  if (done.length) out.done = done
  const decisions = tagged(d.decisions)
  if (decisions.length) out.decisions = decisions
  const problems = tagged(d.problems)
  if (problems.length) out.problems = problems
  const next = str(d.next, 200)
  if (next) out.next = next
  return Object.keys(out).length ? out : undefined
}

// The report a node shows: its own, else one shaped from what an older run kept
// (summary as the result, points as what was done). No model call.
export function reportOf(n: AgentNode): Report | undefined {
  if (n.report) return n.report
  const result = n.summary || (n.kind === 'workflow' ? firstSentence(readableResult(n.result), 300) : firstSentence(n.result, 300))
  const out: Report = {}
  if (result) out.result = result
  if (n.points?.length) out.done = n.points.slice(0, 3)
  return Object.keys(out).length ? out : undefined
}

const STATUS_WORD: Record<AgentNode['status'], string> = { running: 'running', done: 'done', failed: 'failed', killed: 'stopped' }

// One line per part for the level above: its result and its problems, never its raw text.
export function partLine(n: AgentNode): string {
  const r = reportOf(n)
  const problems = r?.problems?.map(p => p.text).join(' ') ?? ''
  return `- ${n.label} [${STATUS_WORD[n.status]}]: ${r?.result ?? noReportReason(n)}${problems ? ` Problems: ${problems}` : ''}`.slice(0, CAP_EACH)
}

// Lines joined until the cap, so the input never grows with the run.
export function capLines(lines: string[], cap = CAP_ALL): string {
  let out = ''
  for (const l of lines) {
    if (out.length + l.length + 1 > cap) { out += `${out ? '\n' : ''}- … ${lines.length - out.split('\n').length} more not shown`; break }
    out += `${out ? '\n' : ''}${l}`
  }
  return out
}

// A workflow phase's part report reads its agents' reports.
export function partInput(wf: AgentNode, phase: string, nodes: AgentNode[]): string {
  const agents = childrenOf(nodes, wf.id).filter(k => (k.phase ?? 'Agents') === phase).sort((a, b) => a.startedAt - b.startedAt)
  return [
    `Workflow: ${wf.label.slice(0, 200)}`,
    `Part: the ${phase} phase, ${agents.length} agent${agents.length === 1 ? '' : 's'} (${phaseWords({ phase, ...counts(agents) })})`,
    '',
    'Agent reports:',
    capLines(agents.map(partLine)),
  ].join('\n')
}

// A run's report reads one level down: a single agent its own report text; a
// cluster its members' reports; a workflow its phases' part reports.
export function runInput(n: AgentNode, nodes: AgentNode[]): string {
  const task = `Task: ${(n.prompt ?? n.label).slice(0, CAP_TASK)}`
  if (n.kind === 'group') {
    const kids = childrenOf(nodes, n.id).sort((a, b) => a.startedAt - b.startedAt)
    return [task, '', `Part reports, one per member (${kids.length}):`, capLines(kids.map(partLine))].join('\n')
  }
  if (n.kind === 'workflow') {
    const parts = pipeline(n, nodes).map(p => {
      const pr = n.partReports?.[p.phase]
      const problems = pr?.problems?.map(x => `${x.text}${x.source ? ` [${x.source}]` : ''}`).join(' ') ?? ''
      return `- ${p.phase} phase [${phaseWords(p)}]: ${pr?.result ?? 'unknown'}${problems ? ` Problems: ${problems}` : ''}`.slice(0, CAP_EACH)
    })
    const final = readableResult(n.result).slice(0, CAP_FINAL)
    return [task, '', `Part reports, one per phase (${parts.length}):`, capLines(parts), ...(final ? ['', `Final result: ${final}`] : [])].join('\n')
  }
  return [task, '', 'Report:', (n.result ?? '').slice(0, CAP_ALL)].join('\n')
}

// ── facts from records: what changed and the totals, never from the model ────
export type Facts = {
  files: FileRow[]
  added: number
  removed: number
  agents: number
  phases: number
  ms: number
  tokens: number
}

export function reportFacts(nodes: AgentNode[], scope: { kind: 'node'; id: string } | { kind: 'phase'; wfId: string; phase: string }, now: number): Facts {
  const list = scopeNodes(nodes, scope)
  const agents = list.filter(n => n.kind === 'agent')
  const files = fileRows(list)
  const root = scope.kind === 'node' ? nodes.find(n => n.id === scope.id) : undefined
  const starts = list.map(n => n.startedAt).filter(Number.isFinite)
  const ends = list.map(n => n.endedAt ?? now)
  return {
    files,
    added: files.reduce((a, f) => a + f.added, 0),
    removed: files.reduce((a, f) => a + f.removed, 0),
    agents: agents.length,
    phases: root?.kind === 'workflow' ? pipeline(root, nodes).length : 0,
    ms: starts.length ? Math.max(0, Math.max(...ends) - Math.min(...starts)) : 0,
    tokens: agents.reduce((a, n) => a + (n.tokens ?? 0), 0),
  }
}

export const kTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n))
