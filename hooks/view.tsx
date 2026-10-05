import type { ClientModule, ClientSurface, JsonValue } from 'claude-code'

import type { Act, AgentNode, EditRecord, NodeStatus, ViewProps } from '../types'
import {
  GROUPS, GROUP_NAMES, childrenOf, counts, dayLabel, diffCounts, fileRows, firstSentence, isSelectable, lineDiff,
  markFor, phaseWords, pipeline, plain, prettyModel, prettyType, readableResult, runItems, scopeNodes, shortPaths,
  taskText, topItems, whereLabel, workSummary, type DiffLine, type FileRow, type Filter, type Group, type Item,
} from './list'

type Tab = 'live' | 'history'
type ViewName = 'agents' | 'changes' | 'output'
type State = {
  tab: Tab
  // the run opened (a workflow or a top-level subagent), or null for the run list
  path: string | null
  view: ViewName
  sel: number
  first: number
  // the Agents view's selection, kept while Changes or Output show its scope
  agentSel: number
  // the file whose diff the Changes view shows, or null for its file list
  diffFile: string | null
  filter: Filter
  group: Group
  flipped: string[]
  showDone: string[]
  tick: number
  // The engine time last handed in, and the tick it arrived on: now = that + ticks since.
  atSeen: number
  tickAtSeen: number
}

const TICK_MS = 500
const DEFAULT_STATE: State = {
  tab: 'live', path: null, view: 'agents', sel: 0, first: 0, agentSel: 0, diffFile: null, filter: 'all', group: 'none',
  flipped: [], showDone: [], tick: 0, atSeen: 0, tickAtSeen: 0,
}
const FILTERS: Filter[] = ['all', 'running', 'failed']
const VIEWS: ViewName[] = ['agents', 'changes', 'output']

const arrayOf = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : [])

// Props and local state come from outside this module (the hooks, a previous
// version of this view), so each field is checked and defaulted, never assumed.
export function viewProps(raw: unknown): ViewProps {
  const p = (raw ?? {}) as Partial<ViewProps>
  const diff = p.diff && typeof p.diff.path === 'string' ? { path: p.diff.path, edits: arrayOf<EditRecord>(p.diff.edits) } : undefined
  return { nodes: arrayOf(p.nodes), history: arrayOf(p.history), at: typeof p.at === 'number' ? p.at : 0, diff }
}

export function viewState(raw: unknown): State {
  const s = { ...DEFAULT_STATE, ...((raw ?? {}) as Partial<State>) }
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
  return {
    ...s,
    tab: s.tab === 'history' ? 'history' : 'live',
    path: typeof s.path === 'string' ? s.path : null,
    view: VIEWS.includes(s.view) ? s.view : 'agents',
    diffFile: typeof s.diffFile === 'string' ? s.diffFile : null,
    filter: FILTERS.includes(s.filter) ? s.filter : 'all',
    group: GROUPS.includes(s.group) ? s.group : 'none',
    flipped: arrayOf(s.flipped),
    showDone: arrayOf(s.showDone),
    sel: num(s.sel),
    first: num(s.first),
    agentSel: num(s.agentSel),
    tick: num(s.tick),
  }
}

// ── look: TokyoNight Moon, as the status line; blue carries the interface, green and red only mean done, added, removed ──
const C = {
  blue: '#82aaff', ink: '#c8d3f5', soft: '#a9b8e8', muted: '#828bb8', faint: '#444a73', rule: '#2f334d', selBg: '#2f334d',
  green: '#c3e88d', red: '#ff757f', yellow: '#ffc777', magenta: '#c099ff', cyan: '#86e1fc',
}
// Nerd Font glyphs from the Font Awesome block, which every Nerd Font carries.
const I = {
  live: '', history: '', agents: '', changes: '', output: '', clock: '',
  done: '', failed: '', stopped: '', running: '', idle: '', file: '',
  workflow: '', agent: '', back: '', open: '', closed: '',
  read: '', write: '', run: '', web: '', think: '',
}
const STATUS: Record<NodeStatus, { icon: string; word: string; color: string }> = {
  running: { icon: I.running, word: 'Running', color: C.yellow },
  done: { icon: I.done, word: 'Done', color: C.green },
  failed: { icon: I.failed, word: 'Failed', color: C.red },
  killed: { icon: I.stopped, word: 'Stopped', color: C.muted },
}
const ACT: Record<Act, { icon: string; color: string }> = {
  think: { icon: I.think, color: C.magenta }, read: { icon: I.read, color: C.cyan }, write: { icon: I.write, color: C.yellow },
  run: { icon: I.run, color: C.green }, web: { icon: I.web, color: C.blue },
}

const duration = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}
const clock = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const clockSec = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })

// The status line's bar: ▰ filled, ▱ empty, rounded to the nearest cell.
export function bar(done: number, total: number, width: number): { filled: string; empty: string; pct: number } {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const full = Math.min(width, Math.round((pct * width) / 100))
  return { filled: '▰'.repeat(full), empty: '▱'.repeat(Math.max(0, width - full)), pct }
}

// Word wrap to a width, so text scrolls and clips by whole lines.
export function wrap(text: string, width: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    if (!para.trim()) { out.push(''); continue }
    let line = ''
    for (const word of para.split(/\s+/)) {
      if (!word) continue
      if ((line ? line.length + 1 : 0) + word.length > width && line) { out.push(line); line = '' }
      line = line ? `${line} ${word}` : word.length > width ? word.slice(0, width) : word
    }
    if (line) out.push(line)
  }
  return out
}

export function step(n: number, from: number, dir: 1 | -1, ok: (i: number) => boolean): number {
  for (let i = from + dir; i >= 0 && i < n; i += dir) if (ok(i)) return i
  return from
}

type Scope = { kind: 'node'; id: string } | { kind: 'phase'; wfId: string; phase: string }
type FileItem = { row: FileRow }
type DiffItem = { kind: 'edit'; rec: EditRecord; added: number; removed: number } | { kind: 'line'; rec: EditRecord; line: DiffLine } | { kind: 'gap' }
type OutLine = { text: string; color?: string; bold?: boolean }

// Inside a workflow the Agents view starts with a row for the whole run: its scope is everything.
const runRows = (run: AgentNode, nodes: AgentNode[], s: Pick<State, 'filter' | 'flipped' | 'showDone'>): Item[] =>
  run.kind !== 'agent'
    ? [{ kind: 'node', node: run, species: 'school', depth: 0 }, ...runItems(run, nodes, s.filter, s.flipped, s.showDone)]
    : runItems(run, nodes, s.filter, s.flipped, s.showDone)

const scopeOf = (it: Item | undefined, run: AgentNode): Scope =>
  it?.kind === 'node' ? { kind: 'node', id: it.node.id }
    : it?.kind === 'phase' ? { kind: 'phase', wfId: it.wfId, phase: it.phase }
      : { kind: 'node', id: run.id }

let live: ClientSurface<State> | undefined

const View: ClientModule<JsonValue, State> = (raw, surface) => {
  const props = viewProps(raw)
  const { Box, Text } = surface.elements
  live = surface
  const s: State = viewState(surface.state)
  if (surface.state === undefined) {
    surface.setState(s)
    surface.every(TICK_MS, () => live?.state && live.setState({ ...live.state, tick: live.state.tick + 1 }))
  }
  if (surface.state !== undefined && s.atSeen !== props.at) surface.setState({ ...s, atSeen: props.at, tickAtSeen: s.tick })
  const now = s.atSeen === props.at ? props.at + (s.tick - s.tickAtSeen) * TICK_MS : props.at
  const pulse = s.tick % 2 === 0
  const nodes = s.tab === 'live' ? props.nodes : props.history
  const allNodes = [...props.nodes, ...props.history]
  const run = s.path ? nodes.find(n => n.id === s.path) : undefined
  const isInWorkflow = (n: AgentNode) => !!n.parentId && nodes.some(p => p.id === n.parentId && p.kind === 'workflow')
  const W = Math.max(30, surface.columns)
  const R = Math.max(12, surface.rows)
  const PAD = '  '

  // ── what the screen is about: the run list's selection, or the scope inside a run ──
  const agentItems: Item[] = run ? runRows(run, nodes, s) : topItems(nodes, s.filter, s.tab === 'history', now, s.group)
  const view: ViewName = run ? s.view : 'agents'
  // a header or fold is never the selection: it snaps to the nearest row that can be opened
  const asked = Math.min(Math.max(0, view === 'agents' ? s.sel : s.agentSel), Math.max(0, agentItems.length - 1))
  const snap = [asked, ...agentItems.map((_, i) => i).filter(i => i > asked), ...agentItems.map((_, i) => i).filter(i => i < asked).reverse()]
  const agentSel = snap.find(i => isSelectable(agentItems[i])) ?? asked
  const focusItem = agentItems[agentSel]
  const scope: Scope | undefined = run ? scopeOf(focusItem, run) : focusItem?.kind === 'node' ? { kind: 'node', id: focusItem.node.id } : undefined
  const scopeList = scope ? scopeNodes(nodes, scope) : []
  const scopeNode = scope?.kind === 'node' ? nodes.find(n => n.id === scope.id) : undefined
  const files = fileRows(scopeList)
  const names = shortPaths(files.map(f => f.path))
  const scopeIds = new Set(scopeList.map(n => n.id))
  const diffOpen = view === 'changes' && s.diffFile !== null

  // ── rows of the current list ─────────────────────────────────────────
  const fileItems: FileItem[] = files.map(row => ({ row }))
  const diffItems: DiffItem[] = (() => {
    if (!diffOpen || props.diff?.path !== s.diffFile) return []
    const out: DiffItem[] = []
    for (const rec of props.diff.edits.filter(r => scopeIds.has(r.agentId))) {
      const lines = lineDiff(rec.old, rec.new, rec.line)
      if (out.length) out.push({ kind: 'gap' })
      out.push({ kind: 'edit', rec, ...diffCounts(lines) })
      for (const line of lines) out.push({ kind: 'line', rec, line })
    }
    return out
  })()
  const outLines: OutLine[] = (() => {
    if (view !== 'output') return []
    const w = W - 4
    const out: OutLine[] = []
    const para = (t: string, color?: string, bold?: boolean) => wrap(t, w).forEach(text => out.push({ text, color, bold }))
    const gap = () => out.push({ text: '' })
    if (scope?.kind === 'phase') {
      para(`What the ${scope.phase} phase reported`, C.blue, true)
      for (const k of scopeList) {
        gap()
        para(k.label, C.ink, true)
        para(k.summary ?? (firstSentence(k.result, 300) || (k.status === 'running' ? 'Still working.' : 'Reported nothing.')), C.soft)
      }
      return out
    }
    const n = scopeNode
    if (!n) return out
    if (n.summary) { para('Outcome', C.blue, true); para(n.summary, C.ink) }
    if (n.points?.length) { gap(); para('Key points', C.blue, true); n.points.forEach(p => para(`•  ${p}`, C.soft)) }
    if (n.kind !== 'agent') {
      gap(); para('Agents', C.blue, true)
      for (const k of childrenOf(nodes, n.id)) para(`${k.phase ? `${k.phase}  ·  ` : ''}${k.label} — ${k.summary ?? firstSentence(k.result, 160)}`, C.soft)
    }
    const report = n.kind === 'workflow' ? readableResult(n.result) : n.result
    if (report) {
      gap(); para(n.kind === 'workflow' ? 'Final result' : 'Full report', C.blue, true)
      for (const line of report.split('\n')) para(plain(line) || ' ', C.muted)
    }
    if (!report && !n.summary) para(n.status === 'running' ? 'Still working — the report appears here when it finishes.' : 'It reported nothing.', C.muted)
    const task = taskText(n.prompt)
    if (task) { gap(); para('Task it was given', C.blue, true); para(task, C.muted) }
    return out
  })()

  // ── geometry: fixed blocks, so a click maps to a row ─────────────────
  const scopeTitle = !scope ? '' : scope.kind === 'phase' ? `${scope.phase} phase` : scopeNode?.label ?? ''
  const roomy = R >= 26
  const titleLines = wrap(scopeTitle, W - 4).slice(0, roomy ? 2 : 1)
  const OVERVIEW = !scope ? 0 : roomy ? 10 : 3
  const listTop = 1 + OVERVIEW + 2 // tabs, overview, list caption or view tabs, rule
  const listRows = Math.max(1, R - listTop - 2) // the spacer and the key hints below
  const mode = view === 'agents' ? 'agents' : view === 'output' ? 'output' : diffOpen ? 'diff' : 'files'
  const count = mode === 'agents' ? agentItems.length : mode === 'files' ? fileItems.length : mode === 'diff' ? diffItems.length : outLines.length
  const okRow = (i: number) => (mode === 'agents' ? isSelectable(agentItems[i]) : mode === 'diff' ? diffItems[i]?.kind !== 'gap' : true)
  const rawSel = mode === 'agents' ? agentSel : s.sel
  const sel = mode === 'output' ? 0 : Math.min(Math.max(0, rawSel), Math.max(0, count - 1))
  let first = mode === 'output' ? s.first : Math.min(s.first, sel)
  if (mode !== 'output' && sel >= first + listRows) first = sel - listRows + 1
  first = Math.max(0, Math.min(first, Math.max(0, count - listRows)))

  // ── actions ──────────────────────────────────────────────────────────
  const set = (patch: Partial<State>) => surface.setState({ ...s, sel, first, ...patch })
  const toggleIn = (list: string[], key: string) => (list.includes(key) ? list.filter(k => k !== key) : [...list, key])
  const closeDiff = () => { surface.post({ type: 'diff', path: null }); return { diffFile: null } }
  const go = (v: ViewName) => {
    if (!run || v === view) return
    const keep = view === 'agents' ? { agentSel: sel } : {}
    const leaving = diffOpen ? closeDiff() : {}
    set({ ...keep, ...leaving, view: v, sel: v === 'agents' ? (view === 'agents' ? sel : s.agentSel) : 0, first: 0 })
  }
  const openRun = (n: AgentNode, v: ViewName = 'agents') => set({ path: n.id, view: v, sel: 0, first: 0, agentSel: 0, diffFile: null })
  const openDiff = (path: string) => { surface.post({ type: 'diff', path }); set({ diffFile: path, sel: 0, first: 0 }) }
  // From a change back to the agent that made it, unfolding what hides it in the Agents view.
  const trace = (agentId: string) => {
    if (!run) return
    const n = nodes.find(x => x.id === agentId)
    if (!n) return
    const key = n.phase ? `${run.id}:${n.phase}` : ''
    const phaseRow = runRows(run, nodes, s).find(it => it.kind === 'phase' && it.key === key)
    const flipped = phaseRow?.kind === 'phase' && !phaseRow.isOpen ? [...s.flipped, key] : s.flipped
    const showDone = key && !s.showDone.includes(key) ? [...s.showDone, key] : s.showDone
    const at = runRows(run, nodes, { ...s, flipped, showDone }).findIndex(it => it.kind === 'node' && it.node.id === n.id)
    surface.post({ type: 'diff', path: null })
    surface.setState({ ...s, view: 'agents', diffFile: null, flipped, showDone, sel: Math.max(0, at), agentSel: Math.max(0, at), first: Math.max(0, at - 2) })
  }
  const activate = () => {
    if (mode === 'agents') {
      const it = agentItems[sel]
      if (!it) return
      if (!run && it.kind === 'node') return openRun(it.node)
      if (it.kind === 'phase') return set({ flipped: toggleIn(s.flipped, it.key) })
      if (it.kind === 'more') return set({ showDone: toggleIn(s.showDone, it.key) })
      if (it.kind === 'node') return go('output')
    } else if (mode === 'files') {
      const it = fileItems[sel]
      if (it) openDiff(it.row.path)
    } else if (mode === 'diff') {
      const it = diffItems[sel]
      if (it && it.kind !== 'gap') trace(it.rec.agentId)
    }
  }
  const back = () => {
    if (mode === 'diff') return set({ ...closeDiff(), sel: Math.max(0, fileItems.findIndex(f => f.row.path === s.diffFile)), first: 0 })
    if (run && view !== 'agents') return go('agents')
    if (!run) return
    const up = topItems(nodes, s.filter, s.tab === 'history', now, s.group)
    const at = up.findIndex(it => it.kind === 'node' && it.node.id === run.id)
    set({ path: null, view: 'agents', sel: Math.max(0, at), first: 0 })
  }
  const switchTab = (tab: Tab) => tab !== s.tab && set({ tab, path: null, view: 'agents', sel: 0, first: 0, diffFile: null })
  const nextFile = (dir: 1 | -1) => {
    const f = fileItems[fileItems.findIndex(x => x.row.path === s.diffFile) + dir]
    if (f) openDiff(f.row.path)
  }
  // h and l walk the tabs of the current level; h past the first one goes up a level.
  const side = (dir: 1 | -1) => {
    if (!run) return switchTab(dir > 0 ? 'history' : 'live')
    if (mode === 'diff') return nextFile(dir)
    const i = VIEWS.indexOf(view) + dir
    if (i < 0) return back()
    if (i < VIEWS.length) go(VIEWS[i]!)
  }
  const move = (dir: 1 | -1) => (mode === 'output'
    ? set({ first: Math.max(0, Math.min(first + dir, count - listRows)) })
    : set({ sel: step(count, sel, dir, okRow) }))

  const running = props.nodes.filter(n => !n.parentId && n.status === 'running').length
  const histTops = props.history.filter(n => !n.parentId)
  const today = histTops.filter(n => dayLabel(n.startedAt, now) === 'Today').length
  const tabSpecs: [string, string][] = [[`${I.live} Live ${running}`, 'live'], [`${I.history} History ${histTops.length}`, 'history']]
  const viewSpecs: [string, ViewName][] = [[`${I.agents} Agents`, 'agents'], [`${I.changes} Changes ${files.length}`, 'changes'], [`${I.output} Output`, 'output']]
  const TAB_GAP = 4

  surface.onKey(({ key }) => {
    if (key === 'j' || key === 'down') move(1)
    else if (key === 'k' || key === 'up') move(-1)
    else if (key === 'g' || key === 'home') set({ sel: 0, first: 0 })
    else if (key === 'G' || key === 'end') set({ sel: Math.max(0, count - 1), first: Math.max(0, count - listRows) })
    else if (key === 'return') activate()
    else if (key === 'h' || key === 'left' || key === '<' || key === ',') side(-1)
    else if (key === 'l' || key === 'right' || key === '>' || key === '.') side(1)
    else if (key === 'backspace' || key === 'b') back()
    else if (key === 'n') nextFile(1)
    else if (key === 'p') nextFile(-1)
    else if (key === '1') switchTab('live')
    else if (key === '2') switchTab('history')
    else if (key === 'a') go('agents')
    else if (key === 'c') (run ? go('changes') : focusItem?.kind === 'node' && openRun(focusItem.node, 'changes'))
    else if (key === 'o') (run ? go('output') : focusItem?.kind === 'node' && openRun(focusItem.node, 'output'))
    else if (key === 'tab') (run ? go(VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]!) : switchTab(s.tab === 'live' ? 'history' : 'live'))
    else if (key === 'f') set({ filter: FILTERS[(FILTERS.indexOf(s.filter) + 1) % FILTERS.length], sel: 0, first: 0 })
    else if (key === 'v' && !run) set({ group: GROUPS[(GROUPS.indexOf(s.group) + 1) % GROUPS.length], sel: 0, first: 0 })
  })

  const hitTab = (x: number, labels: string[]) => {
    let at = PAD.length
    for (let i = 0; i < labels.length; i++) {
      if (x >= at && x < at + labels[i]!.length) return i
      at += labels[i]!.length + TAB_GAP
    }
    return -1
  }
  surface.onPointer(e => {
    if (e.type !== 'down' || e.button !== 'left') return
    if (e.y === 0) { const i = hitTab(e.x, tabSpecs.map(t => t[0])); if (i >= 0) switchTab(i === 0 ? 'live' : 'history'); return }
    if (e.y === listTop - 2) {
      if (!run) return
      if (mode === 'diff') return back()
      const i = hitTab(e.x, viewSpecs.map(t => t[0]))
      if (i >= 0) go(VIEWS[i]!)
      return
    }
    const i = first + (e.y - listTop)
    if (e.y < listTop || e.y >= listTop + listRows || i >= count || mode === 'output' || !okRow(i)) return
    if (i === sel) activate()
    else set({ sel: i })
  })

  // ── pieces ───────────────────────────────────────────────────────────
  const Line = (p: { children?: unknown; bg?: string }) => (
    <Box height={1} backgroundColor={p.bg}><Text wrap="truncate-end">{p.children as never}</Text></Box>
  )
  const Blank = () => <Box height={1}><Text> </Text></Box>
  const tabs = (specs: [string, string][], on: string) => specs.map(([label, key], i) => (
    <Text>
      {i ? ' '.repeat(TAB_GAP) : ''}
      {key === on ? <Text bold color={C.blue}>{label}</Text> : <Text color={C.muted}>{label}</Text>}
    </Text>
  ))
  const label = (t: string) => <Text color={C.muted}>{t.padEnd(11)}</Text>
  const progress = (done: number, total: number, width: number) => {
    const b = bar(done, total, width)
    return <Text><Text color={C.blue}>{b.filled}</Text><Text color={C.faint}>{b.empty}</Text></Text>
  }
  const changesValue = (rows: FileRow[]) => {
    if (rows.length === 0) return <Text color={C.muted}>None</Text>
    const added = rows.reduce((a, r) => a + r.added, 0)
    const removed = rows.reduce((a, r) => a + r.removed, 0)
    return <Text><Text color={C.blue}>{rows.length} file{rows.length === 1 ? '' : 's'}</Text><Text>   </Text><Text color={C.green}>+{added}</Text><Text> </Text><Text color={C.red}>−{removed}</Text></Text>
  }
  const statusRow = (n: Pick<AgentNode, 'status' | 'startedAt' | 'endedAt'>, extra?: string) => {
    const st = STATUS[n.status]
    const time = n.status === 'running' ? duration(now - n.startedAt) : duration((n.endedAt ?? now) - n.startedAt)
    return (
      <Text>
        <Text bold color={st.color}>{n.status === 'running' && !pulse ? I.idle : st.icon} {st.word}</Text>
        <Text color={C.muted}>{'   '}{I.clock} {time}</Text>
        {extra ? <Text color={C.muted}>{'   '}{extra}</Text> : ''}
      </Text>
    )
  }
  const activityValue = (n: AgentNode) => {
    const a = ACT[n.act ?? 'think']
    return <Text color={a.color}>{a.icon}  {n.activity ?? 'Thinking'}</Text>
  }
  const outcome = (n: AgentNode) => n.summary ?? (n.kind === 'workflow' ? firstSentence(readableResult(n.result)) : firstSentence(n.result))

  // ── overview ─────────────────────────────────────────────────────────
  const overview = (() => {
    if (!scope) return null
    const title = titleLines.length
      ? [0, 1].slice(0, roomy ? 2 : 1).map(i => <Line>{PAD}<Text bold color={C.ink}>{titleLines[i] ?? ''}</Text></Line>)
      : [<Blank />]
    const when = (n: AgentNode) => (s.tab === 'history' ? clock(n.startedAt) : undefined)
    let meta: unknown = ''
    let second: unknown = ''
    let rows: [string, unknown][] = []
    if (scope.kind === 'phase') {
      const c = counts(scopeList)
      const wf = nodes.find(n => n.id === scope.wfId)
      const start = Math.min(...scopeList.map(k => k.startedAt))
      const end = c.running ? now : Math.max(...scopeList.map(k => k.endedAt ?? now))
      meta = statusRow({ status: c.running ? 'running' : c.failed ? 'failed' : 'done', startedAt: start, endedAt: end })
      second = <Text>{progress(c.total - c.running, c.total, 12)}<Text color={C.muted}>   {c.total - c.running} of {c.total} agents</Text></Text>
      rows = [
        ['Agents', <Text color={C.ink}>{phaseWords({ phase: scope.phase, ...c })}</Text>],
        ['Changes', changesValue(files)],
        ['Part of', <Text color={C.soft}>{wf?.label ?? 'workflow'}</Text>],
      ]
    } else if (scopeNode && scopeNode.kind !== 'agent') {
      const n = scopeNode
      const kids = childrenOf(nodes, n.id)
      const c = counts(kids)
      meta = statusRow(n, when(n))
      second = <Text>{progress(c.total - c.running, c.total, 12)}<Text color={C.muted}>   {c.total - c.running} of {c.total} agents</Text></Text>
      const busy = kids.find(x => x.status === 'running')
      rows = [
        n.kind === 'group'
          ? ['Agents', <Text color={C.ink}>{phaseWords({ phase: '', ...c })}</Text>]
          : ['Phases', <Text>{pipeline(n, nodes).map((p, i) => <Text>{i ? <Text color={C.faint}>   →   </Text> : ''}<Text color={C.ink}>{p.phase}</Text><Text color={C.muted}>  {phaseWords(p)}</Text></Text>)}</Text>],
        ['Changes', changesValue(files)],
        n.status === 'running' && busy
          ? ['Now', <Text>{activityValue(busy)}<Text color={C.muted}>   {busy.label}</Text></Text>]
          : ['Outcome', <Text color={C.ink}>{outcome(n) || '—'}</Text>],
      ]
    } else if (scopeNode) {
      const n = scopeNode
      const inWf = isInWorkflow(n)
      meta = statusRow(n, when(n))
      second = <Text color={C.muted}>{I.agent}  {[prettyType(n, inWf), prettyModel(n.model), inWf && n.phase ? `${n.phase} phase` : n.where && n.where !== 'main' ? whereLabel(n.where) : ''].filter(Boolean).join('   ·   ')}</Text>
      rows = [
        n.status === 'running' ? ['Now', activityValue(n)] : ['Outcome', <Text color={C.ink}>{outcome(n) || 'No report.'}</Text>],
        ['Changes', changesValue(files)],
        ['Work', <Text color={C.soft}>{workSummary(n)}{n.tokens ? `   ·   ${Math.round(n.tokens / 1000)}k tokens` : ''}</Text>],
      ]
    }
    if (!roomy) return [...title, <Line>{PAD}{meta as never}</Line>, <Blank />]
    return [
      <Blank />,
      ...title,
      <Line>{PAD}{meta as never}</Line>,
      <Line>{PAD}{second as never}</Line>,
      <Blank />,
      ...rows.map(([name, value]) => <Line>{PAD}{label(name)}{value as never}</Line>),
      <Blank />,
    ]
  })()

  // ── list rows ────────────────────────────────────────────────────────
  const cursor = (on: boolean) => <Text color={C.blue}>{on ? '▎' : ' '} </Text>
  const agentRow = (it: Item, i: number) => {
    const on = i === sel
    const bg = on ? C.selBg : undefined
    if (it.kind === 'header') return <Line>{PAD}<Text bold color={C.muted}>{it.text}</Text><Text color={C.faint}>  {it.count}</Text></Line>
    if (it.kind === 'more') return <Line bg={bg}>{cursor(on)}<Text color={C.muted}>      {it.count} more finished agents</Text><Text color={C.faint}>   enter to list them</Text></Line>
    if (it.kind === 'phase') {
      const color = it.failed ? C.red : it.running ? C.yellow : C.green
      return (
        <Line bg={bg}>
          {cursor(on)}<Text color={C.muted}>{it.isOpen ? I.open : I.closed}  </Text>
          <Text bold color={C.ink}>{it.phase}</Text>
          <Text color={color}>   {phaseWords(it)}</Text>
        </Line>
      )
    }
    const n = it.node
    const st = STATUS[n.status]
    const isLive = n.status === 'running'
    const isWhole = !!run && n.id === run.id && n.kind !== 'agent'
    const kids = n.kind !== 'agent' ? counts(childrenOf(nodes, n.id)) : undefined
    const rows = fileRows(scopeNodes(nodes, { kind: 'node', id: n.id }))
    const added = rows.reduce((a, r) => a + r.added, 0)
    const removed = rows.reduce((a, r) => a + r.removed, 0)
    const time = duration((n.endedAt ?? now) - n.startedAt)
    return (
      <Line bg={bg}>
        {cursor(on)}{'   '.repeat(it.depth)}
        <Text color={st.color}>{isLive && !pulse ? I.idle : st.icon}</Text>
        <Text>  {isWhole ? (n.kind === 'group' ? I.agents : I.workflow) : markFor(n, it.species === 'sea')}  </Text>
        <Text bold={on || n.kind !== 'agent'} color={isLive || on ? C.ink : C.soft}>{isWhole ? 'All agents' : n.label}</Text>
        <Text>   </Text>
        {kids && !isWhole ? <Text>{progress(kids.total - kids.running, kids.total, 6)}<Text color={C.muted}>  {kids.total - kids.running}/{kids.total}</Text><Text>   </Text></Text> : ''}
        {isLive && !kids ? <Text color={ACT[n.act ?? 'think'].color}>{n.activity ?? 'Thinking'}<Text>   </Text></Text> : ''}
        {rows.length ? <Text><Text color={C.green}>+{added}</Text><Text> </Text><Text color={C.red}>−{removed}</Text><Text>   </Text></Text> : ''}
        <Text color={C.muted}>{!run && s.tab === 'history' ? `${clock(n.startedAt)}  ` : ''}{time}</Text>
      </Line>
    )
  }
  const nameWidth = Math.min(32, Math.max(8, ...files.map(f => (names.get(f.path) ?? '').length)))
  const fileRow = (it: FileItem, i: number) => {
    const on = i === sel
    const phases = [...new Set(it.row.by.map(b => b.node.phase).filter(Boolean))]
    const who = phases.length ? phases.join(', ') : it.row.by.length === 1 ? it.row.by[0]!.node.label : `${it.row.by.length} agents`
    return (
      <Line bg={on ? C.selBg : undefined}>
        {cursor(on)}<Text color={C.muted}>{I.file}  </Text>
        <Text bold={on} color={C.ink}>{(names.get(it.row.path) ?? it.row.path).padEnd(nameWidth)}</Text>
        <Text>   <Text color={C.green}>+{it.row.added}</Text> <Text color={C.red}>−{it.row.removed}</Text></Text>
        <Text color={C.muted}>   {who}</Text>
      </Line>
    )
  }
  const agentOf = (id: string) => allNodes.find(n => n.id === id)
  const diffRow = (it: DiffItem, i: number) => {
    const on = i === sel
    const bg = on ? C.selBg : undefined
    if (it.kind === 'gap') return <Blank />
    if (it.kind === 'edit') {
      const n = agentOf(it.rec.agentId)
      return (
        <Line bg={bg}>
          {cursor(on)}
          {n?.phase ? <Text color={C.blue}>{n.phase}  ›  </Text> : ''}
          <Text>{n ? markFor(n, isInWorkflow(n)) : ''}  </Text>
          <Text bold color={C.ink}>{n?.label ?? it.rec.agentId}</Text>
          <Text>   <Text color={C.green}>+{it.added}</Text> <Text color={C.red}>−{it.removed}</Text></Text>
          <Text color={C.muted}>   {clockSec(it.rec.at)}{it.rec.isNew ? '   new file' : ''}{on ? '   enter: go to agent' : ''}</Text>
        </Line>
      )
    }
    const l = it.line
    const no = String((l.op === '-' ? l.oldNo : l.newNo) ?? '').padStart(5)
    const color = l.op === '+' ? C.green : l.op === '-' ? C.red : C.muted
    return (
      <Line bg={bg}>
        {cursor(on)}<Text color={C.faint}>{no}  </Text>
        <Text color={color}>{l.op === ' ' ? ' ' : l.op === '+' ? '+' : '−'}  {l.text}</Text>
      </Line>
    )
  }

  const body = (() => {
    if (mode === 'agents') {
      if (agentItems.length === 0) {
        return [
          <Blank />,
          <Line>{PAD}<Text color={C.ink}>{s.tab === 'live' ? 'Nothing is running right now.' : 'No finished runs yet.'}</Text></Line>,
          <Blank />,
          ...wrap(s.tab === 'live'
            ? 'Subagents (🐱) and workflows (🌊) appear here while they run, then move to History.'
            : 'Finished subagents and workflows are kept here across sessions.', W - 4).map(t => <Line>{PAD}<Text color={C.muted}>{t}</Text></Line>),
        ]
      }
      return agentItems.slice(first, first + listRows).map((it, k) => agentRow(it, first + k))
    }
    if (mode === 'files') {
      if (fileItems.length === 0) {
        const what = scope?.kind === 'phase' ? 'this phase' : scopeNode?.kind === 'workflow' ? 'this workflow' : scopeNode?.kind === 'group' ? 'this group' : 'this agent'
        return [<Blank />, <Line>{PAD}<Text color={C.muted}>No files were changed by {what}.</Text></Line>]
      }
      return fileItems.slice(first, first + listRows).map((it, k) => fileRow(it, first + k))
    }
    if (mode === 'diff') {
      if (diffItems.length === 0) return [<Blank />, <Line>{PAD}<Text color={C.muted}>{props.diff?.path === s.diffFile ? 'No recorded edits for this file in this scope.' : 'Loading the diff…'}</Text></Line>]
      return diffItems.slice(first, first + listRows).map((it, k) => diffRow(it, first + k))
    }
    return outLines.slice(first, first + listRows).map(l => <Line>{PAD}<Text color={l.color} bold={l.bold}>{l.text}</Text></Line>)
  })()

  // ── the row above the list: a caption on the run list, the view tabs inside a run ──
  const caption = (() => {
    if (!run) {
      const what = s.tab === 'live' ? (running ? `${running} running` : 'Nothing running') : `${today} finished today`
      return <Line>{PAD}<Text color={C.muted}>{what}{s.group !== 'none' ? `   ·   ${GROUP_NAMES[s.group]}` : ''}{s.filter !== 'all' ? `   ·   ${s.filter} only` : ''}</Text></Line>
    }
    if (mode === 'diff') {
      const row = files.find(f => f.path === s.diffFile)
      return (
        <Line>
          {PAD}<Text color={C.blue}>{I.back}  </Text><Text bold color={C.ink}>{names.get(s.diffFile ?? '') ?? s.diffFile}</Text>
          {row ? <Text>   <Text color={C.green}>+{row.added}</Text> <Text color={C.red}>−{row.removed}</Text><Text color={C.muted}>   {row.edits} edit{row.edits === 1 ? '' : 's'}</Text></Text> : ''}
        </Line>
      )
    }
    return <Line>{PAD}{tabs(viewSpecs, view)}</Line>
  })()

  const keyList: [string, string][] = !run
    ? [['j k', 'move'], ['enter', 'open'], ['c', 'changes'], ['h l', 'live · history'], ['v', 'group']]
    : mode === 'agents' ? [['j k', 'move'], ['enter', 'open'], ['h l', 'views'], ['⌫', 'back']]
      : mode === 'files' ? [['j k', 'move'], ['enter', 'diff'], ['h l', 'views'], ['⌫', 'back']]
        : mode === 'diff' ? [['j k', 'move'], ['enter', 'go to agent'], ['h l', 'files'], ['⌫', 'back']]
          : [['j k', 'scroll'], ['h l', 'views'], ['⌫', 'back']]
  const hiddenBelow = count - first - listRows

  return (
    <Box flexDirection="column" height={R}>
      <Line>{PAD}{tabs(tabSpecs, s.tab)}{run ? <Text color={C.faint}>{'    '}{I.closed}  </Text> : ''}{run ? <Text color={C.soft}>{run.label}</Text> : ''}</Line>
      {overview}
      {caption}
      <Text color={C.rule}>{PAD}{'─'.repeat(Math.max(0, W - 4))}</Text>
      <Box flexDirection="column" height={listRows} overflow="hidden">{body}</Box>
      <Blank />
      <Line>
        {PAD}
        {keyList.map(([k, what], i) => <Text>{i ? '     ' : ''}<Text bold color={C.soft}>{k}</Text><Text color={C.muted}> {what}</Text></Text>)}
        {hiddenBelow > 0 ? <Text color={C.faint}>     {hiddenBelow} more below</Text> : ''}
      </Line>
    </Box>
  )
}

export default View
