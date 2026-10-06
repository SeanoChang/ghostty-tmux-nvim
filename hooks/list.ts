import type { Act, AgentNode, EditRecord } from '../types'

// Subagents are cats, workflow agents sea creatures, a workflow its lead creature.
export type Species = 'cat' | 'sea' | 'school'
export const speciesOf = (n: Pick<AgentNode, 'kind'>, inWorkflow: boolean): Species =>
  n.kind !== 'agent' ? 'school' : inWorkflow ? 'sea' : 'cat'

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const baseName = (p: string) => p.split('/').filter(Boolean).pop() ?? p
const firstLine = (s: string) => s.split('\n')[0]?.trim() ?? ''
const hostOf = (url: string) => /^[a-z]+:\/\/([^/]+)/i.exec(url)?.[1] ?? url
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// What a tool call is doing, as a sentence a person reads, and the prop the icon holds.
export function describeTool(tool: string, input: Record<string, unknown>): { act: Act; activity: string } {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  switch (tool) {
    case 'Read': return { act: 'read', activity: `Reading ${baseName(s('file_path'))}` }
    case 'Grep': return { act: 'read', activity: `Searching the code for "${clip(s('pattern'), 32)}"` }
    case 'Glob': return { act: 'read', activity: `Looking for files matching ${clip(s('pattern'), 32)}` }
    case 'LS': return { act: 'read', activity: `Listing ${baseName(s('path'))}` }
    case 'ToolSearch': return { act: 'read', activity: 'Looking up tools' }
    case 'LSP': return { act: 'read', activity: 'Asking the language server' }
    case 'Edit':
    case 'MultiEdit': return { act: 'write', activity: `Editing ${baseName(s('file_path'))}` }
    case 'Write': return { act: 'write', activity: `Writing ${baseName(s('file_path'))}` }
    case 'NotebookEdit': return { act: 'write', activity: `Editing ${baseName(s('notebook_path'))}` }
    case 'Bash': return { act: 'run', activity: `Running ${clip(firstLine(s('command')), 40)}` }
    case 'Monitor': return { act: 'run', activity: 'Watching a process' }
    case 'Agent':
    case 'Task': return { act: 'run', activity: `Handing off: ${clip(s('description'), 36)}` }
    case 'Workflow': return { act: 'run', activity: 'Starting a workflow' }
    case 'WebFetch': return { act: 'web', activity: `Reading ${hostOf(s('url'))}` }
    case 'WebSearch': return { act: 'web', activity: `Searching the web for "${clip(s('query'), 30)}"` }
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool)
  if (mcp) return { act: 'web', activity: `Calling ${mcp[1]?.replace(/^claude_ai_/, '')} · ${mcp[2]?.replace(/_/g, ' ')}` }
  return { act: 'think', activity: `Using ${tool}` }
}

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
export const editedPath = (tool: string, input: Record<string, unknown>): string | undefined => {
  if (!EDIT_TOOLS.has(tool)) return undefined
  const p = input.file_path ?? input.notebook_path
  return typeof p === 'string' ? p : undefined
}

// "Read 3 files, edited 1, ran 2 commands": what an agent did, from its tool counts.
export function workSummary(n: Pick<AgentNode, 'work' | 'changes' | 'tools'>): string {
  const w = n.work ?? {}
  const edited = Object.keys(n.changes ?? {}).length
  const parts = [
    w.read ? `read ${plural(w.read, 'file')}` : '',
    edited ? `edited ${plural(edited, 'file')}` : '',
    w.run ? `ran ${plural(w.run, 'command')}` : '',
    w.web ? `${plural(w.web, 'web call')}` : '',
  ].filter(Boolean)
  if (parts.length === 0) return n.tools ? plural(n.tools, 'tool call') : 'No tools used'
  const s = parts.join(', ')
  return s[0]!.toUpperCase() + s.slice(1)
}

const lineCount = (s: unknown) => (typeof s === 'string' && s.length > 0 ? s.split('\n').length : 0)

// What one edit did to one file, in lines, like a diffstat.
export function editStats(tool: string, input: Record<string, unknown>): { path: string; added: number; removed: number } | undefined {
  const path = editedPath(tool, input)
  if (!path) return undefined
  if (tool === 'Edit') return { path, added: lineCount(input.new_string), removed: lineCount(input.old_string) }
  if (tool === 'MultiEdit') {
    const edits = Array.isArray(input.edits) ? (input.edits as { old_string?: unknown; new_string?: unknown }[]) : []
    return { path, added: edits.reduce((a, e) => a + lineCount(e.new_string), 0), removed: edits.reduce((a, e) => a + lineCount(e.old_string), 0) }
  }
  if (tool === 'Write') return { path, added: lineCount(input.content), removed: 0 }
  return { path, added: lineCount(input.new_source), removed: 0 }
}

export type FileRow = { path: string; added: number; removed: number; edits: number; by: { node: AgentNode; added: number; removed: number; edits: number }[] }

// Every file the given agents changed, with who changed it: the trail from a file back to its agents.
export function fileRows(scope: AgentNode[]): FileRow[] {
  const rows = new Map<string, FileRow>()
  for (const n of scope) {
    for (const [path, c] of Object.entries(n.changes ?? {})) {
      const row = rows.get(path) ?? { path, added: 0, removed: 0, edits: 0, by: [] }
      row.added += c.added
      row.removed += c.removed
      row.edits += c.edits
      row.by.push({ node: n, ...c })
      rows.set(path, row)
    }
  }
  return [...rows.values()].sort((a, b) => b.added + b.removed - (a.added + a.removed) || a.path.localeCompare(b.path))
}

// Paths shown relative to what they share, so "hooks/view.tsx", not a 90-column absolute path.
export function shortPaths(paths: string[]): Map<string, string> {
  const split = paths.map(p => p.split('/'))
  let common = 0
  if (split.length > 0) {
    const first = split[0]!
    while (common < first.length - 1 && split.every(s => s.length - 1 > common && s[common] === first[common])) common++
  }
  // keep one directory of context when every file sits in the same folder
  const keep = Math.max(0, Math.min(common, ...split.map(s => s.length - 2)))
  return new Map(paths.map((p, i) => [p, split[i]!.slice(paths.length === 1 ? Math.max(0, split[i]!.length - 2) : keep).join('/')]))
}

export const diffstat = (added: number, removed: number) => `+${added} −${removed}`

export type DiffLine = { op: ' ' | '+' | '-'; text: string; oldNo?: number; newNo?: number }

// A line diff of one edit's before and after, numbered from where it sits in the
// file: a longest-common-subsequence walk, as `diff` does, so context lines the edit
// repeated are context, not a removal and an addition.
export function lineDiff(before: string, after: string, start = 1): DiffLine[] {
  const a = before ? before.split('\n') : []
  const b = after ? after.split('\n') : []
  const out: DiffLine[] = []
  if (a.length * b.length > 400_000) {
    a.forEach((text, i) => out.push({ op: '-', text, oldNo: start + i }))
    b.forEach((text, i) => out.push({ op: '+', text, newNo: start + i }))
    return out
  }
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { out.push({ op: ' ', text: a[i]!, oldNo: start + i, newNo: start + j }); i++; j++ }
    // removals before additions, as diff prints them
    else if (i < a.length && (j >= b.length || lcs[i + 1]![j]! >= lcs[i]![j + 1]!)) { out.push({ op: '-', text: a[i]!, oldNo: start + i }); i++ }
    else { out.push({ op: '+', text: b[j]!, newNo: start + j }); j++ }
  }
  return out
}

export const diffCounts = (lines: DiffLine[]) => ({
  added: lines.filter(l => l.op === '+').length,
  removed: lines.filter(l => l.op === '-').length,
})

// What one tool call wrote, as before/after text and where it sits: one record per
// change, so a file's diff can be told edit by edit, each with the agent that made it.
export function editRecords(tool: string, input: Record<string, unknown>, before: string | undefined, after: string | undefined): { path: string; old: string; new: string; line: number; isNew?: boolean }[] {
  const path = editedPath(tool, input)
  if (!path) return []
  const lineOf = (text: string) => {
    const at = after && text ? after.indexOf(text) : -1
    return at < 0 ? 1 : after!.slice(0, at).split('\n').length
  }
  const str = (x: unknown) => (typeof x === 'string' ? x : '')
  if (tool === 'Edit') return [{ path, old: str(input.old_string), new: str(input.new_string), line: lineOf(str(input.new_string)) }]
  if (tool === 'MultiEdit') {
    const edits = Array.isArray(input.edits) ? (input.edits as { old_string?: unknown; new_string?: unknown }[]) : []
    return edits.map(e => ({ path, old: str(e.old_string), new: str(e.new_string), line: lineOf(str(e.new_string)) }))
  }
  if (tool === 'Write') return [{ path, old: before ?? '', new: str(input.content), line: 1, isNew: before === undefined }]
  return [{ path, old: '', new: str(input.new_source), line: 1 }]
}

// "Draft  2 done  →  Refine  1 running": a workflow's phases in words.
export function phaseWords(p: { phase: string; total: number; running: number; done: number; failed: number; stopped: number }): string {
  const parts = [
    p.running ? `${p.running} running` : '',
    p.done ? `${p.done} done` : '',
    p.failed ? `${p.failed} failed` : '',
    p.stopped ? `${p.stopped} stopped` : '',
  ].filter(Boolean)
  return parts.join(', ') || 'waiting'
}

// A workflow's return value is often JSON: its strings, joined, read better than its braces.
export function readableResult(s: string | undefined): string {
  if (!s) return ''
  const t = s.trim()
  if (!t.startsWith('{') && !t.startsWith('[')) return plain(t)
  try {
    const strings: string[] = []
    const walk = (v: unknown) => {
      if (typeof v === 'string') strings.push(v)
      else if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') Object.values(v).forEach(walk)
    }
    walk(JSON.parse(t))
    return plain(strings.join(' '))
  } catch { return plain(t) }
}

export function changesLine(rows: readonly FileRow[]): string {
  if (rows.length === 0) return 'No files changed'
  const added = rows.reduce((a, r) => a + r.added, 0)
  const removed = rows.reduce((a, r) => a + r.removed, 0)
  return `Changed ${plural(rows.length, 'file')} (${diffstat(added, removed)})`
}

// A workflow's phases in order with their agents' counts: "Explore ✓3 → Verify ●2 ✓1".
export function pipeline(wf: AgentNode, nodes: AgentNode[]) {
  const kids = nodes.filter(n => n.parentId === wf.id)
  const order = [...(wf.phases ?? [])]
  for (const k of kids) if (!order.includes(k.phase ?? 'Agents')) order.push(k.phase ?? 'Agents')
  return order.map(phase => ({ phase, ...counts(kids.filter(k => (k.phase ?? 'Agents') === phase)) }))
}

// The agents a scope covers: a run with everything under it, one phase, or one agent and its own subagents.
export function scopeNodes(nodes: AgentNode[], scope: { kind: 'node'; id: string } | { kind: 'phase'; wfId: string; phase: string }): AgentNode[] {
  if (scope.kind === 'phase') return nodes.filter(n => n.parentId === scope.wfId && (n.phase ?? 'Agents') === scope.phase)
  const under = (id: string): AgentNode[] => nodes.filter(n => n.parentId === id).flatMap(k => [k, ...under(k.id)])
  const root = nodes.find(n => n.id === scope.id)
  return root ? [root, ...under(root.id)] : []
}

// ── emoji: a cat for a subagent; a workflow agent's own sea creature, fixed by its id ──
const SEA = ['🐡', '🐠', '🐙', '🐟']
const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}
export const markFor = (n: Pick<AgentNode, 'id' | 'kind'>, inWorkflow: boolean): string =>
  n.kind === 'workflow' ? '🌊' : n.kind === 'group' ? '🐾' : inWorkflow ? SEA[hash(n.id) % SEA.length]! : '🐱'

// Markdown to one plain line: headings, emphasis, code marks, links and list bullets go.
export function plain(s: string | undefined): string {
  return (s ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(\*\*|__|\*|_|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export const firstSentence = (s: string | undefined, max = 140) => {
  const p = plain(s)
  const m = /^(.+?[.!?])(\s|$)/.exec(p)
  return clip(m?.[1] ?? p, max)
}

export function prettyModel(m: string | undefined): string | undefined {
  if (!m) return undefined
  const x = /(haiku|sonnet|opus|fable)(?:-(\d+)-(\d+))?/i.exec(m)
  if (!x) return m
  const name = x[1]![0]!.toUpperCase() + x[1]!.slice(1).toLowerCase()
  return x[2] ? `${name} ${x[2]}.${x[3]}` : name
}

export function prettyType(n: Pick<AgentNode, 'kind' | 'type'>, inWorkflow: boolean): string {
  if (n.kind === 'workflow') return 'Workflow'
  if (n.kind === 'group') return 'Agent group'
  const t = n.type
  if (!t) return inWorkflow ? 'Workflow agent' : 'Agent'
  const name = t.includes(':') ? t.split(':').pop()! : t
  const words = name.replace(/[-_]/g, ' ')
  return `${words[0]!.toUpperCase()}${words.slice(1)} agent`
}

export const whereLabel = (w: AgentNode['where']) =>
  w === 'worktree' ? 'Own worktree' : w === 'remote' ? 'Remote' : 'Main checkout'

export type JournalEntry = { agentId: string; label?: string; phase?: string; isDone: boolean }

// A workflow run's journal.jsonl: a `started` line per agent (id, label, phase), a `result` line as each ends.
export function parseJournal(text: string): JournalEntry[] {
  const byId = new Map<string, JournalEntry>()
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let row: { type?: unknown; agentId?: unknown; label?: unknown; phase?: unknown }
    try { row = JSON.parse(line) } catch { continue }
    if (typeof row.agentId !== 'string') continue
    const cur = byId.get(row.agentId) ?? { agentId: row.agentId, isDone: false }
    if (row.type === 'started') {
      if (typeof row.label === 'string') cur.label = row.label
      if (typeof row.phase === 'string') cur.phase = row.phase
    } else if (row.type === 'result') {
      cur.isDone = true
    }
    byId.set(row.agentId, cur)
  }
  return [...byId.values()]
}

// The task an agent was given. A workflow agent's transcript opens with harness
// frames: the relayed user request (skipped: it is the user's, not the agent's
// task) and the computed task, whose text follows "follows:" indented two spaces.
export function firstPrompt(jsonl: string): string | undefined {
  for (const line of jsonl.split('\n').slice(0, 20)) {
    let row: { message?: { role?: unknown; content?: unknown } }
    try { row = JSON.parse(line) } catch { continue }
    const m = row.message
    if (m?.role !== 'user') continue
    const text = typeof m.content === 'string'
      ? m.content
      : Array.isArray(m.content)
        ? m.content.map(b => (b && typeof b === 'object' && 'text' in b ? String(b.text) : '')).join('\n').trim()
        : ''
    if (!text) continue
    if (text.startsWith('[Workflow harness — user request]')) continue
    if (text.startsWith('[Workflow harness')) {
      const body = text.split(/follows:\s*\n/)[1]
      return body ? body.split('\n').map(l => l.replace(/^ {2}/, '')).join('\n').trim() : undefined
    }
    return text
  }
  return undefined
}

// A digest reply: JSON with an outcome sentence and up to three points, tolerating fences and chatter.
export function parseDigest(raw: string): { outcome?: string; points?: string[] } | undefined {
  const json = /\{[\s\S]*\}/.exec(raw)?.[0]
  if (!json) return undefined
  try {
    const d = JSON.parse(json) as { outcome?: unknown; points?: unknown }
    const outcome = typeof d.outcome === 'string' ? plain(d.outcome).slice(0, 300) : undefined
    const points = Array.isArray(d.points) ? d.points.filter((p): p is string => typeof p === 'string').map(p => plain(p).slice(0, 120)).slice(0, 3) : undefined
    return { outcome, points }
  } catch { return undefined }
}

// The report an agent handed back. Agents that end with a SubagentHandback call
// leave no final text, so their report is that call's message; otherwise it is
// the last text the agent wrote.
export function handbackOf(transcript: string): string | undefined {
  const lines = transcript.split('\n').filter(Boolean)
  let lastText: string | undefined
  for (let i = lines.length - 1; i >= 0; i--) {
    let row: { message?: { role?: string; content?: unknown } }
    try { row = JSON.parse(lines[i]!) } catch { continue }
    const content = row.message?.role === 'assistant' && Array.isArray(row.message.content) ? row.message.content : []
    for (const b of content as { type?: string; name?: string; text?: string; input?: { message?: unknown } }[]) {
      if (b.type === 'tool_use' && b.name === 'SubagentHandback' && typeof b.input?.message === 'string') return b.input.message
      if (b.type === 'text' && b.text?.trim() && lastText === undefined) lastText = b.text
    }
  }
  return lastText
}

// A root folder as Claude Code names its projects folder: every character
// that is not a letter or digit becomes '-'. Runs compare by this key.
export const folderKey = (path: string) => path.replace(/[^a-zA-Z0-9]/g, '-')
export const runKey = (n: { repo?: string; repoKey?: string }) => n.repoKey ?? (n.repo ? folderKey(n.repo) : undefined)

// Why a finished agent has no report, in words, instead of a bare "No report".
export function noReportReason(n: { status: string }): string {
  if (n.status === 'running') return 'Still working.'
  if (n.status === 'failed') return 'Stopped with an error before it reported.'
  if (n.status === 'killed') return 'Stopped before it reported.'
  return 'Finished without a written report.'
}

// Task text as a person reads it: runs recorded before the harness-aware reader kept the frames.
export function taskText(prompt: string | undefined): string {
  if (!prompt) return ''
  if (prompt.startsWith('[Workflow harness — user request]')) return ''
  if (prompt.startsWith('[Workflow harness')) return plain(prompt.split(/follows:\s*/)[1] ?? '')
  return plain(prompt)
}

export function cleanTitle(raw: string): string | undefined {
  const t = firstLine(raw).replace(/^["'`*#\s]+|["'`*.\s]+$/g, '').replace(/^title:\s*/i, '')
  return t && t.length <= 80 ? t : undefined
}

export type Filter = 'all' | 'running' | 'failed'
export type Group = 'none' | 'type' | 'where' | 'status'
export const GROUPS: Group[] = ['none', 'type', 'where', 'status']
export const GROUP_NAMES: Record<Group, string> = { none: 'no grouping', type: 'by type', where: 'by worktree', status: 'by status' }

// A row of the run list or of a run's tree. `guide` is the tree's drawing to the
// left of the row (├─ └─ │), `fold` a row that holds others and can open or close.
export type Fold = { key: string; isOpen: boolean }
export type Item =
  | { kind: 'node'; node: AgentNode; species: Species; depth: number; guide?: string; fold?: Fold }
  | { kind: 'phase'; key: string; wfId: string; phase: string; isOpen: boolean; total: number; done: number; failed: number; running: number; stopped: number; guide?: string }
  | { kind: 'more'; key: string; count: number; guide?: string }
  // a heading over rows; History's day headings carry a note and Older folds
  | { kind: 'header'; text: string; count?: number; note?: string; isOpen?: boolean }
  // a line under a cluster's row: its aspects, a file overlap, its combined outcome
  | { kind: 'info'; tone: 'chips' | 'warn' | 'outcome'; nodeId: string; guide: string }

export const isSelectable = (it: Item | undefined) => it !== undefined && it.kind !== 'header' && it.kind !== 'info'

export function childrenOf(nodes: AgentNode[], id: string) {
  return nodes.filter(n => n.parentId === id)
}

export function counts(kids: AgentNode[]) {
  const c = { total: kids.length, running: 0, done: 0, failed: 0, stopped: 0 }
  for (const k of kids) {
    if (k.status === 'running') c.running++
    else if (k.status === 'failed') c.failed++
    else if (k.status === 'killed') c.stopped++
    else c.done++
  }
  return c
}

export const passes = (n: AgentNode, kids: AgentNode[], f: Filter) =>
  f === 'all' ||
  (f === 'running' && (n.status === 'running' || kids.some(k => k.status === 'running'))) ||
  (f === 'failed' && (n.status === 'failed' || kids.some(k => k.status === 'failed')))

const DAY = 86_400_000
export const dayLabel = (t: number, now: number) => {
  const startOf = (x: number) => { const d = new Date(x); d.setHours(0, 0, 0, 0); return d.getTime() }
  const diff = Math.round((startOf(now) - startOf(t)) / DAY)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

const STATUS_GROUP: Record<AgentNode['status'], string> = { running: 'Running', failed: 'Failed', done: 'Done', killed: 'Stopped' }
const groupOf = (n: AgentNode, g: Group, now: number): string =>
  g === 'type' ? prettyType(n, false).replace(/ agent$/, '') + (n.kind !== 'agent' ? 's' : ' agents')
    : g === 'where' ? whereLabel(n.where)
      : g === 'status' ? STATUS_GROUP[n.status]
        : dayLabel(n.startedAt, now)

// The top level: one row per subagent or workflow; a subagent's own subagents sit under it.
// Live holds what is still running; a finished run moves to History. Rows sit under
// group headers: the chosen grouping, or the day in History when there is none.
export function topItems(
  nodes: AgentNode[], filter: Filter, isHistory: boolean, now: number, group: Group = 'none',
  flipped: readonly string[] = [], showDone: readonly string[] = [],
): Item[] {
  const ids = new Set(nodes.map(n => n.id))
  const tops = nodes.filter(n => !n.parentId || !ids.has(n.parentId))
  const sorted = isHistory
    ? [...tops].sort((a, b) => b.startedAt - a.startedAt)
    : [...tops].sort((a, b) => a.startedAt - b.startedAt)
  const shown = sorted.filter(n => {
    const kids = childrenOf(nodes, n.id)
    if (!isHistory && n.status !== 'running' && !kids.some(k => k.status === 'running')) return false
    return passes(n, kids, filter)
  })
  const useHeaders = group !== 'none' || isHistory
  const buckets = new Map<string, AgentNode[]>()
  for (const n of shown) {
    const key = useHeaders ? groupOf(n, group, now) : ''
    buckets.set(key, [...(buckets.get(key) ?? []), n])
  }
  const out: Item[] = []
  for (const [key, list] of buckets) {
    if (useHeaders) out.push({ kind: 'header', text: key, count: list.length })
    // folded by default: the run list stays one row per run until one is opened
    for (const n of list) emitTree(n, nodes, { filter, flipped, showDone }, out, { guide: '', prefix: '', depth: 0, defaultOpen: false })
  }
  return out
}

// ── the tree: a run and everything under it, with guide lines ─────────────

type TreeOpts = { filter: Filter; flipped: readonly string[]; showDone: readonly string[] }
type At = { guide: string; prefix: string; depth: number; defaultOpen: boolean }

const isOpenNow = (key: string, byDefault: boolean, flipped: readonly string[]) => byDefault !== flipped.includes(key)
const visibleKids = (nodes: AgentNode[], id: string, f: Filter) =>
  childrenOf(nodes, id).filter(k => passes(k, childrenOf(nodes, k.id), f)).sort((a, b) => a.startedAt - b.startedAt)
const branch = (prefix: string, isLast: boolean) => ({ guide: `${prefix}${isLast ? '└─ ' : '├─ '}`, prefix: `${prefix}${isLast ? '   ' : '│  '}` })

// One node, then (when open) its cluster lines and its children: a group's members,
// a workflow's phases and their agents, an agent's own subagents.
function emitTree(n: AgentNode, nodes: AgentNode[], o: TreeOpts, out: Item[], at: At): void {
  const isWorkflow = n.kind === 'workflow'
  const kids = isWorkflow ? [] : visibleKids(nodes, n.id, o.filter)
  const hasKids = isWorkflow ? childrenOf(nodes, n.id).length > 0 : kids.length > 0
  // closed-by-default rows (the run list) and open-by-default rows (inside a run) keep separate keys
  const key = `${at.defaultOpen ? 'o' : 'c'}:${n.id}`
  const isOpen = hasKids && isOpenNow(key, at.defaultOpen, o.flipped)
  out.push({ kind: 'node', node: n, species: speciesOf(n, !!n.phase), depth: at.depth, guide: at.guide, ...(hasKids ? { fold: { key, isOpen } } : {}) })
  if (!isOpen) return
  const more = hasKids ? `${at.prefix}│  ` : `${at.prefix}   `
  if (n.kind === 'group') {
    // no aspect chips here: the members are the rows right below
    if (overlaps(scopeNodes(nodes, { kind: 'node', id: n.id }).filter(k => k.id !== n.id)).length) out.push({ kind: 'info', tone: 'warn', nodeId: n.id, guide: more })
    if (n.summary && n.status !== 'running') out.push({ kind: 'info', tone: 'outcome', nodeId: n.id, guide: more })
  }
  if (isWorkflow) return emitPhases(n, nodes, o, out, at)
  kids.forEach((k, i) => emitTree(k, nodes, o, out, { ...branch(at.prefix, i === kids.length - 1), depth: at.depth + 1, defaultOpen: true }))
}

// A workflow's phases: one folding row each; a phase with nothing running or failed
// folds to its row, and finished agents past the first few fold to a "… N done" row.
function emitPhases(wf: AgentNode, nodes: AgentNode[], o: TreeOpts, out: Item[], at: At): void {
  const kids = childrenOf(nodes, wf.id).sort((a, b) => a.startedAt - b.startedAt)
  const order = [...(wf.phases ?? [])]
  for (const k of kids) if (!order.includes(k.phase ?? 'Agents')) order.push(k.phase ?? 'Agents')
  const phases = order
    .map(phase => ({ phase, list: kids.filter(k => (k.phase ?? 'Agents') === phase && passes(k, [], o.filter)) }))
    .filter(p => p.list.length > 0)
  phases.forEach(({ phase, list }, pi) => {
    const c = counts(list)
    const key = `${wf.id}:${phase}`
    const isOpen = (c.running > 0 || c.failed > 0) !== o.flipped.includes(key)
    const b = branch(at.prefix, pi === phases.length - 1)
    out.push({ kind: 'phase', key, wfId: wf.id, phase, isOpen, ...c, guide: b.guide })
    if (!isOpen) return
    const failed = list.filter(k => k.status === 'failed')
    const running = list.filter(k => k.status === 'running')
    const done = list.filter(k => k.status !== 'running' && k.status !== 'failed').sort((a, z) => (z.endedAt ?? 0) - (a.endedAt ?? 0))
    const doneShown = o.showDone.includes(key) || done.length <= SHOWN_DONE + 1 ? done : done.slice(0, SHOWN_DONE)
    const rows = [...failed, ...running, ...doneShown]
    const hidden = done.length - doneShown.length
    rows.forEach((n, i) => emitTree(n, nodes, o, out, { ...branch(b.prefix, i === rows.length - 1 && hidden === 0), depth: at.depth + 2, defaultOpen: true }))
    if (hidden > 0) out.push({ kind: 'more', key, count: hidden, guide: branch(b.prefix, true).guide })
  })
}

// Inside an opened run: the run's own row first, then its whole tree, open.
export function runTree(run: AgentNode, nodes: AgentNode[], filter: Filter, flipped: readonly string[], showDone: readonly string[]): Item[] {
  const out: Item[] = []
  emitTree(run, nodes, { filter, flipped, showDone }, out, { guide: '', prefix: '', depth: 0, defaultOpen: true })
  return out
}

// Files two or more agents of a scope edited: where parallel work can collide.
export function overlaps(scope: AgentNode[]): { path: string; by: AgentNode[] }[] {
  return fileRows(scope)
    .map(r => ({ path: r.path, by: [...new Map(r.by.map(b => [b.node.id, b.node])).values()] }))
    .filter(r => r.by.length >= 2)
}

// The agents a run or a top-level view covers, for the board, the timeline and the insights.
export const leafAgents = (scope: AgentNode[]) => scope.filter(n => n.kind === 'agent')

const SHOWN_DONE = 3

// Inside a workflow: agents grouped by phase. A phase with nothing running or failed
// folds to its header; finished agents past the first few fold to a "… N done" row.
export function workflowItems(
  wf: AgentNode, nodes: AgentNode[], filter: Filter, flipped: readonly string[], showDone: readonly string[],
): Item[] {
  const kids = childrenOf(nodes, wf.id).sort((a, b) => a.startedAt - b.startedAt)
  const order = [...(wf.phases ?? [])]
  for (const k of kids) if (!order.includes(k.phase ?? 'Agents')) order.push(k.phase ?? 'Agents')
  const out: Item[] = []
  for (const phase of order) {
    const inPhase = kids.filter(k => (k.phase ?? 'Agents') === phase && passes(k, [], filter))
    if (inPhase.length === 0) continue
    const c = counts(inPhase)
    const key = `${wf.id}:${phase}`
    const isOpen = (c.running > 0 || c.failed > 0) !== flipped.includes(key)
    out.push({ kind: 'phase', key, wfId: wf.id, phase, isOpen, ...c })
    if (!isOpen) continue
    const failed = inPhase.filter(k => k.status === 'failed')
    const running = inPhase.filter(k => k.status === 'running')
    const done = inPhase.filter(k => k.status !== 'running' && k.status !== 'failed')
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    const doneShown = showDone.includes(key) || done.length <= SHOWN_DONE + 1 ? done : done.slice(0, SHOWN_DONE)
    for (const n of [...failed, ...running, ...doneShown]) out.push({ kind: 'node', node: n, species: 'sea', depth: 1 })
    if (doneShown.length < done.length) out.push({ kind: 'more', key, count: done.length - doneShown.length })
  }
  return out
}

// Inside a run: a workflow's phases and agents, or a subagent with its own subagents.
export function runItems(
  run: AgentNode, nodes: AgentNode[], filter: Filter, flipped: readonly string[], showDone: readonly string[],
): Item[] {
  if (run.kind === 'workflow') return workflowItems(run, nodes, filter, flipped, showDone)
  const out: Item[] = []
  const walk = (n: AgentNode, depth: number) => {
    out.push({ kind: 'node', node: n, species: 'cat', depth })
    for (const k of childrenOf(nodes, n.id)) walk(k, depth + 1)
  }
  // a group lists its members in the order they started, each with its own subagents
  if (run.kind === 'group') for (const k of childrenOf(nodes, run.id).filter(k => passes(k, [], filter)).sort((a, b) => a.startedAt - b.startedAt)) walk(k, 1)
  else walk(run, 0)
  return out
}

// Keep the client's props under the tree bound: drop bulky text first, then the oldest history.
export function fitProps<T extends { nodes: AgentNode[]; history: AgentNode[] }>(p: T, limit = 90_000): T {
  const size = (x: unknown) => JSON.stringify(x).length
  if (size(p) <= limit) return p
  const slim = (n: AgentNode): AgentNode => ({ ...n, prompt: n.prompt?.slice(0, 160), result: n.result?.slice(0, 300) })
  let next = { ...p, nodes: p.nodes.map(n => (n.status === 'running' ? n : slim(n))), history: p.history.map(slim) }
  while (size(next) > limit && next.history.length > 0) next = { ...next, history: next.history.slice(Math.ceil(next.history.length / 4)) }
  return next
}

// An agent's transcript keeps every edit call it made, so a run recorded before
// edits were kept can still show its diffs. Failed calls are left out; lines are
// placed against the file as it is now, which is right unless a later edit moved them.
export function transcriptEdits(text: string, agentId: string, now: string | undefined): EditRecord[] {
  const calls: { id: string; tool: string; input: Record<string, unknown>; at: number }[] = []
  const failed = new Set<string>()
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let row: { timestamp?: string; message?: { content?: unknown } }
    try { row = JSON.parse(line) } catch { continue }
    const content = Array.isArray(row.message?.content) ? (row.message!.content as Record<string, unknown>[]) : []
    const at = row.timestamp ? Date.parse(row.timestamp) || 0 : 0
    for (const b of content) {
      if (b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string' && b.input && typeof b.input === 'object')
        calls.push({ id: b.id, tool: b.name, input: b.input as Record<string, unknown>, at })
      if (b.type === 'tool_result' && b.is_error === true && typeof b.tool_use_id === 'string') failed.add(b.tool_use_id)
    }
  }
  return calls
    .filter(c => !failed.has(c.id) && editedPath(c.tool, c.input))
    .flatMap(c => editRecords(c.tool, c.input, undefined, now).map((r, i) => ({
      ...r, isNew: c.tool === 'Write' ? undefined : r.isNew, id: `${c.id}:${i}`, agentId, at: c.at,
    })))
}
