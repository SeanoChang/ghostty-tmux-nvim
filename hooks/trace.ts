import type { AgentNode, TraceLane, TraceRow, TraceZoom } from '../types'
import { describeTool, editedPath } from './list'

// The trail behind a run: what each agent did, in order, and how the agents
// handed work to each other. Read from transcripts when a trace opens; pure here.

export type TraceKind = 'spawn' | 'tool' | 'edit' | 'message' | 'handback' | 'report' | 'fail' | 'quiet' | 'note'

export type TraceEvent = {
  agentId: string
  at: number
  kind: TraceKind
  // the tool's name for a tool call, else the kind
  name: string
  summary: string
  input?: string
  output?: string
  tokens?: number
  // a spawn's child (its agent id when the result names it, else its description), a message's recipient
  to?: string
  // a message's sender, when it arrived from another agent or session
  from?: string
  path?: string
  added?: number
  removed?: number
  error?: boolean
}

export const ZOOMS: TraceZoom[] = ['story', 'steps', 'raw']
export const ZOOM_NAMES: Record<TraceZoom, string> = { story: 'Story', steps: 'Steps', raw: 'Raw' }
export const QUIET_GAP = 120_000
const EXCERPT = 160

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
export const excerpt = (s: unknown, n = EXCERPT): string | undefined => {
  if (typeof s !== 'string') return undefined
  const t = oneLine(s)
  if (!t) return undefined
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}
const baseName = (p: string) => p.split('/').filter(Boolean).pop() ?? p
const lines = (s: unknown) => (typeof s === 'string' && s.length ? s.split('\n').length : 0)

// The text of a tool result: a string, or text blocks.
function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(b => (b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : '')).join('\n')
  return ''
}

// The few input fields a person reads, not the whole input.
function inputText(name: string, input: Record<string, unknown>): string | undefined {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  if (name === 'Bash') return excerpt(s('command'))
  if (name === 'Read' || name === 'Write' || name === 'Edit' || name === 'MultiEdit') return excerpt(s('file_path'))
  if (name === 'Grep' || name === 'Glob') return excerpt([s('pattern'), s('path')].filter(Boolean).join(' in '))
  if (name === 'WebFetch') return excerpt(s('url'))
  if (name === 'WebSearch') return excerpt(s('query'))
  if (name === 'Agent' || name === 'Task') return excerpt(s('prompt'))
  if (name === 'SendMessage') return excerpt(s('message') || s('content'))
  if (name === 'SubagentHandback') return excerpt(s('message'))
  const first = Object.entries(input).find(([, v]) => typeof v === 'string')
  return first ? excerpt(String(first[1])) : undefined
}

// What a message that arrived says: who sent it and its first words.
const INCOMING = /<(cross-session-message|agent-message)\b([^>]*)>([\s\S]*?)(?:<\/\1>|$)/g
function incoming(text: string): { from: string; body: string }[] {
  const out: { from: string; body: string }[] = []
  for (const m of text.matchAll(INCOMING)) {
    const attrs = m[2] ?? ''
    const from = /from-name="([^"]*)"/.exec(attrs)?.[1] ?? /from="([^"]*)"/.exec(attrs)?.[1] ?? 'another session'
    out.push({ from, body: m[3] ?? '' })
  }
  return out
}

type Row = { type?: string; timestamp?: string; message?: { role?: string; content?: unknown; usage?: Record<string, unknown> } }
type Block = { type?: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }

// A parse that can take a transcript in pieces: whole lines in, events out.
export type Parse = { agentId: string; events: TraceEvent[]; pending: Map<string, number>; lastText?: { at: number; text: string }; handedBack: boolean; sawTask: boolean; lastAt: number; beforeTask: boolean }

export const newParse = (agentId: string): Parse => ({ agentId, events: [], pending: new Map(), handedBack: false, sawTask: false, lastAt: 0, beforeTask: false })

export function parseLines(p: Parse, text: string): Parse {
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let row: Row
    try { row = JSON.parse(line) as Row } catch { continue }
    const at = row.timestamp ? Date.parse(row.timestamp) : p.lastAt
    if (Number.isFinite(at) && at > 0) p.lastAt = at
    const content = row.message?.content
    // A fork's transcript opens with the parent's own call that started it; its
    // work begins at the first text it is given (the directive).
    if (row.type === 'fork-context-ref') { p.beforeTask = true; continue }
    if (p.beforeTask) {
      const text = row.type === 'user' && (typeof content === 'string' || (Array.isArray(content) && (content as Block[]).some(b => b.type === 'text')))
      if (text) { p.beforeTask = false; p.sawTask = true }
      continue
    }
    if (row.type === 'assistant' && Array.isArray(content)) {
      const u = row.message?.usage ?? {}
      const num = (k: string) => (typeof u[k] === 'number' ? (u[k] as number) : 0)
      let tokens: number | undefined = num('input_tokens') + num('cache_creation_input_tokens') + num('output_tokens') || undefined
      for (const b of content as Block[]) {
        if (b.type === 'text' && b.text?.trim()) p.lastText = { at: p.lastAt, text: b.text }
        if (b.type !== 'tool_use' || !b.name) continue
        const ev = toolEvent(p.agentId, p.lastAt, b.name, b.input ?? {})
        if (tokens) { ev.tokens = tokens; tokens = undefined }
        if (ev.kind === 'handback') p.handedBack = true
        if (b.id) p.pending.set(b.id, p.events.length)
        p.events.push(ev)
      }
    } else if (row.type === 'user') {
      const blocks: Block[] = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? (content as Block[]) : []
      for (const b of blocks) {
        if (b.type === 'tool_result' && b.tool_use_id) {
          const i = p.pending.get(b.tool_use_id)
          if (i === undefined) continue
          p.pending.delete(b.tool_use_id)
          const ev = p.events[i]!
          const out = resultText(b.content)
          const o = excerpt(out)
          if (o) ev.output = o
          if (b.is_error) ev.error = true
          // a background spawn's result names the agent it started
          const child = ev.kind === 'spawn' ? /agentId:\s*([a-z0-9]{8,})/i.exec(out)?.[1] : undefined
          if (child) ev.to = child
        } else if (b.type === 'text' && b.text) {
          // the first user text is the task this agent was given, not a message
          if (!p.sawTask) { p.sawTask = true; continue }
          for (const m of incoming(b.text)) {
            p.events.push({ agentId: p.agentId, at: p.lastAt, kind: 'message', name: 'message', summary: excerpt(m.body, 80) ?? 'a message', from: m.from, ...(excerpt(m.body) ? { input: excerpt(m.body) } : {}) })
          }
        }
      }
    }
  }
  return p
}

function toolEvent(agentId: string, at: number, name: string, input: Record<string, unknown>): TraceEvent {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  const base = { agentId, at, name, ...(inputText(name, input) ? { input: inputText(name, input) } : {}) }
  if (name === 'Agent' || name === 'Task') return { ...base, kind: 'spawn', summary: `started ${s('description') || s('name') || 'a subagent'}`, to: s('description') || s('name') }
  if (name === 'SendMessage') return { ...base, kind: 'message', summary: excerpt(s('summary') || s('message') || s('content'), 80) ?? 'a message', to: s('to') || s('recipient') }
  if (name === 'SubagentHandback') return { ...base, kind: 'handback', summary: excerpt(s('message').split('\n').find(l => l.trim()) ?? 'its report', 80) ?? 'its report' }
  const path = editedPath(name, input)
  if (path) {
    const added = name === 'Write' ? lines(input.content) : lines(input.new_string)
    const removed = name === 'Write' ? 0 : lines(input.old_string)
    return { ...base, kind: 'edit', summary: `${name === 'Write' ? 'wrote' : 'edited'} ${baseName(path)}`, path, added, removed }
  }
  return { ...base, kind: 'tool', summary: describeTool(name, input).activity }
}

// The end of a parse: an agent that wrote a last text and handed nothing back reported that text.
export function finishParse(p: Parse): TraceEvent[] {
  const out = [...p.events]
  if (!p.handedBack && p.lastText) {
    out.push({ agentId: p.agentId, at: p.lastText.at, kind: 'report', name: 'report', summary: excerpt(p.lastText.text.split('\n').find(l => l.trim()) ?? '', 80) ?? 'its report', ...(excerpt(p.lastText.text) ? { input: excerpt(p.lastText.text) } : {}) })
  }
  return out
}

export const parseTranscript = (text: string, agentId: string): TraceEvent[] => finishParse(parseLines(newParse(agentId), text))

// ── zoom: steps group runs of like tool calls; a story keeps a few beats ──────

type Cls = 'read' | 'search' | 'run' | 'web' | 'other'
const clsOf = (e: TraceEvent): Cls => {
  if (e.name === 'Read' || e.name === 'LS') return 'read'
  if (e.name === 'Grep' || e.name === 'Glob' || e.name === 'ToolSearch' || e.name === 'LSP') return 'search'
  if (e.name === 'Bash' || e.name === 'Monitor') return 'run'
  if (e.name === 'WebFetch' || e.name === 'WebSearch' || e.name.startsWith('mcp__')) return 'web'
  return 'other'
}
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
// the folder most of the paths share, for "read 6 files in src/auth"
function commonDir(paths: string[]): string {
  const parts = paths.map(p => p.split('/').filter(Boolean).slice(0, -1))
  if (!parts.length) return ''
  let n = 0
  while (parts.every(ps => ps[n] !== undefined && ps[n] === parts[0]![n])) n++
  const dir = parts[0]!.slice(0, n)
  return dir.slice(-2).join('/')
}
function groupText(cls: Cls, list: TraceEvent[]): string {
  if (cls === 'read') {
    const dir = commonDir(list.map(e => e.input ?? ''))
    return `read ${plural(list.length, 'file')}${dir ? ` in ${dir}` : ''}`
  }
  if (cls === 'search') return `searched ${plural(list.length, 'time')}`
  if (cls === 'run') return `ran ${plural(list.length, 'command')}`
  if (cls === 'web') return plural(list.length, 'web call')
  return `used ${plural(list.length, 'tool')}`
}

export type Step = TraceEvent & { count?: number; end?: number; error?: boolean }

// Steps: consecutive tool calls of one kind become one row; edits to one file become one row.
export function stepsOf(events: TraceEvent[]): Step[] {
  const out: Step[] = []
  for (const e of events) {
    const last = out[out.length - 1]
    if (last && last.agentId === e.agentId && e.kind === 'tool' && last.kind === 'tool' && clsOf(last) === clsOf(e)) {
      const members = [...((last as Step & { members?: TraceEvent[] }).members ?? [last]), e]
      Object.assign(last, { count: members.length, end: e.at, summary: groupText(clsOf(e), members), members, error: last.error || e.error,
        tokens: (last.tokens ?? 0) + (e.tokens ?? 0) || undefined, output: e.output ?? last.output })
      continue
    }
    if (last && last.agentId === e.agentId && e.kind === 'edit' && last.kind === 'edit' && last.path === e.path) {
      const count = (last.count ?? 1) + 1
      Object.assign(last, { count, end: e.at, summary: `${last.summary.split(' ×')[0]} ×${count}`, added: (last.added ?? 0) + (e.added ?? 0), removed: (last.removed ?? 0) + (e.removed ?? 0),
        tokens: (last.tokens ?? 0) + (e.tokens ?? 0) || undefined })
      continue
    }
    out.push({ ...e })
  }
  return out.map(({ ...s }) => { delete (s as { members?: unknown }).members; return s })
}

// A story: per agent, its own beats (spawns, edits, messages, hand-backs, reports)
// stay, and its tool work folds into at most a few beats between them.
export function storyOf(events: TraceEvent[], maxBeats = 8): Step[] {
  const steps = stepsOf(events)
  const byAgent = new Map<string, Step[]>()
  for (const s of steps) byAgent.set(s.agentId, [...(byAgent.get(s.agentId) ?? []), s])
  const out: Step[] = []
  for (const agentId of [...new Set(steps.map(s => s.agentId))]) {
    const list: Step[] = byAgent.get(agentId) ?? []
    const keep = list.filter((s: Step) => s.kind !== 'tool')
    const room = Math.max(3, maxBeats - keep.length)
    // tool steps fold into `room` buckets of neighbours
    const tools: Step[] = list.filter((s: Step) => s.kind === 'tool')
    const size = Math.max(1, Math.ceil(tools.length / room))
    const buckets: Step[] = []
    for (let i = 0; i < tools.length; i += size) {
      const part = tools.slice(i, i + size)
      if (part.length === 1) { buckets.push(part[0]!); continue }
      // a step keeps its first call's tool name, and steps group one class each
      const tally = (c: Cls) => part.filter(t => clsOf(t) === c).reduce((a, t) => a + (t.count ?? 1), 0)
      const bits = [
        tally('read') ? `read ${plural(tally('read'), 'file')}` : '',
        tally('search') ? `searched ${plural(tally('search'), 'time')}` : '',
        tally('run') ? `ran ${plural(tally('run'), 'command')}` : '',
        tally('web') ? plural(tally('web'), 'web call') : '',
        tally('other') ? `used ${plural(tally('other'), 'other tool')}` : '',
      ].filter(Boolean)
      buckets.push({ ...part[0]!, summary: bits.join(', ') || `used ${plural(part.length, 'tool')}`, count: part.reduce((a, t) => a + (t.count ?? 1), 0), end: part[part.length - 1]!.end ?? part[part.length - 1]!.at,
        error: part.some(t => t.error), tokens: part.reduce((a, t) => a + (t.tokens ?? 0), 0) || undefined })
    }
    out.push(...[...keep, ...buckets].sort((a, b) => a.at - b.at))
  }
  return out.sort((a, b) => a.at - b.at)
}

export const zoomed = (events: TraceEvent[], zoom: TraceZoom): Step[] => (zoom === 'raw' ? events.map(e => ({ ...e })) : zoom === 'steps' ? stepsOf(events) : storyOf(events))

// ── lanes: one per agent, the main session first; rows in time order ─────────

// Two letters a lane is known by: "review:bugs" → RB, "Fix cart totals" → FC.
export function chipOf(label: string): string {
  const words = label.split(/[^A-Za-z0-9]+/).filter(Boolean)
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase()
  return (words[0] ?? label).slice(0, 2).toUpperCase().padEnd(2, ' ')
}

export const MAIN = 'main'

// Builds a run's trace: its lanes, and its rows at a zoom.
// `events` holds what each agent's transcript gave; an agent missing from it has no
// transcript on disk, and its lane is built from what its node holds.
export function buildTrace(run: AgentNode, scope: AgentNode[], events: Map<string, TraceEvent[]>, now: number, zoom: TraceZoom): { lanes: TraceLane[]; rows: TraceRow[]; missing: number } {
  const agents = scope.filter(n => n.kind === 'agent').sort((a, b) => a.startedAt - b.startedAt)
  const isAgent = new Set(agents.map(a => a.id))
  const parentLane = (n: AgentNode) => (n.parentId && isAgent.has(n.parentId) ? n.parentId : MAIN)
  const hasMain = agents.some(a => parentLane(a) === MAIN)
  const laneIds = [...(hasMain ? [MAIN] : []), ...agents.map(a => a.id)]
  const laneOf = new Map(laneIds.map((id, i) => [id, i]))
  const all: TraceEvent[] = []
  let missing = 0
  // copies: linking a spawn to its child's lane must not change what the cache holds
  const copies = new Map<string, TraceEvent[]>()
  for (const a of agents) { const own = events.get(a.id); if (own) copies.set(a.id, own.map(e => ({ ...e }))) }
  // which spawn events of a parent are linked to a child lane already
  const linked = new Set<TraceEvent>()
  for (const a of agents) {
    const own = copies.get(a.id)
    const parent = parentLane(a)
    // the arrow into this lane: from its parent's own spawn call when that is in a transcript, else from the main session
    const parentEvents = parent === MAIN ? undefined : copies.get(parent)
    const spawn = parentEvents?.find(e => e.kind === 'spawn' && !linked.has(e) && (e.to === a.id || e.to === a.label))
    if (spawn) { linked.add(spawn); spawn.to = a.id }
    else all.push({ agentId: parent, at: a.startedAt, kind: 'spawn', name: 'spawn', summary: `started ${a.label}`, to: a.id, ...(excerpt(a.prompt) ? { input: excerpt(a.prompt) } : {}) })
    if (own) {
      all.push(...own)
    } else {
      missing++
      all.push({ agentId: a.id, at: a.startedAt, kind: 'note', name: 'note', summary: 'transcript no longer on disk' })
      const said = a.report?.result ?? a.summary ?? a.result
      if (said && a.status !== 'running') all.push({ agentId: a.id, at: a.endedAt ?? a.startedAt, kind: 'report', name: 'report', summary: excerpt(said, 80) ?? said, ...(excerpt(said) ? { input: excerpt(said) } : {}) })
    }
    if (a.status === 'failed' || a.status === 'killed') {
      all.push({ agentId: a.id, at: a.endedAt ?? now, kind: 'fail', name: 'fail', summary: a.status === 'failed' ? 'failed' : 'stopped' })
    }
  }
  // a hand-back or a last report goes to the lane that started the agent
  for (const e of all) {
    if ((e.kind === 'handback' || e.kind === 'report') && laneOf.has(e.agentId)) {
      const a = agents.find(x => x.id === e.agentId)
      if (a) e.to = parentLane(a)
    }
    // a spawn the parent made that matches no lane stays a plain row
    if (e.kind === 'spawn' && e.to && !laneOf.has(e.to)) e.to = undefined
  }
  all.sort((a, b) => a.at - b.at)
  const steps = zoomed(all, zoom)
  // quiet gaps: a lane that called nothing for two minutes or more, while it ran
  const withQuiet: Step[] = []
  const lastAt = new Map<string, number>()
  for (const s of steps) {
    const prev = lastAt.get(s.agentId)
    if (prev !== undefined && s.at - prev >= QUIET_GAP && s.agentId !== MAIN) {
      withQuiet.push({ agentId: s.agentId, at: prev, kind: 'quiet', name: 'quiet', summary: `quiet ${mins(s.at - prev)}` })
    }
    lastAt.set(s.agentId, s.end ?? s.at)
    withQuiet.push(s)
  }
  for (const a of agents) {
    const prev = lastAt.get(a.id)
    if (a.status === 'running' && prev !== undefined && now - prev >= QUIET_GAP) {
      withQuiet.push({ agentId: a.id, at: prev, kind: 'quiet', name: 'quiet', summary: `quiet ${mins(now - prev)} so far` })
    }
  }
  withQuiet.sort((a, b) => a.at - b.at)
  const rows: TraceRow[] = withQuiet.map(s => compact(s, laneOf))
  const lanes: TraceLane[] = laneIds.map((id, i) => {
    const a = agents.find(x => x.id === id)
    const idx = rows.flatMap((r, k) => (r.lane === i || r.to === i ? [k] : []))
    return {
      id, label: a ? a.label : 'Main session', chip: a ? chipOf(a.label) : 'MS',
      status: a ? a.status : run.status === 'running' ? 'running' : 'done',
      from: idx.length ? Math.min(...idx) : 0, to: idx.length ? Math.max(...idx) : 0,
    }
  })
  return { lanes, rows, missing }
}

const mins = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`)

// A row as the view gets it: short keys, nothing undefined.
function compact(s: Step, laneOf: Map<string, number>): TraceRow {
  const r: TraceRow = { kind: s.kind, lane: laneOf.get(s.agentId) ?? 0, at: s.at, text: s.summary }
  if (s.to !== undefined && laneOf.has(s.to)) r.to = laneOf.get(s.to)!
  else if (s.to) r.target = s.to
  if (s.from) r.from = s.from
  if (s.count && s.count > 1) r.count = s.count
  if (s.end && s.end !== s.at) r.end = s.end
  if (s.input) r.input = s.input
  if (s.output) r.output = s.output
  if (s.tokens) r.tokens = s.tokens
  if (s.path) r.path = s.path
  if (s.added !== undefined && s.kind === 'edit') r.added = s.added
  if (s.removed !== undefined && s.kind === 'edit') r.removed = s.removed
  if (s.error) r.error = true
  if (s.kind === 'tool' || s.kind === 'edit') r.name = s.name
  return r
}

export const TRACE_WINDOW = 160

// The rows the view gets: a window around where it reads, so props stay small.
export function traceWindow(rows: TraceRow[], offset: number, size = TRACE_WINDOW): { offset: number; rows: TraceRow[] } {
  const at = Math.max(0, Math.min(offset, Math.max(0, rows.length - size)))
  return { offset: at, rows: rows.slice(at, at + size) }
}
