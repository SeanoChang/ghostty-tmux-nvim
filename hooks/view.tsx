import type { ClientModule, ClientSurface, JsonValue } from 'claude-code'

import type { Act, AgentNode, EditRecord, NodeStatus, ViewProps, Wheel } from '../types'
import {
  GROUPS, GROUP_NAMES, childrenOf, counts, dayLabel, diffCounts, fileRows, firstSentence, isSelectable, lineDiff,
  noReportReason, phaseWords, pipeline, plain, prettyModel, prettyType, readableResult, runItems, scopeNodes, shortPaths,
  taskText, topItems, whereLabel, workSummary, type DiffLine, type FileRow, type Filter, type Group, type Item,
} from './list'
import { cellWidth, fit, kindGlyph, padEnd, padStart, themeOf, type Theme } from './theme'

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
  // History shows only this repository's runs
  onlyRepo: boolean
  // the key overlay
  help: boolean
  // the last wheel move applied; -1 until the first props arrive
  wheelSeen: number
}

const TICK_MS = 500
const MIN_COLUMNS = 60
const DEFAULT_STATE: State = {
  tab: 'live', path: null, view: 'agents', sel: 0, first: 0, agentSel: 0, diffFile: null, filter: 'all', group: 'none',
  flipped: [], showDone: [], tick: 0, atSeen: 0, tickAtSeen: 0, onlyRepo: true, help: false, wheelSeen: -1,
}
const FILTERS: Filter[] = ['all', 'running', 'failed']
const VIEWS: ViewName[] = ['agents', 'changes', 'output']

const arrayOf = <T,>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : [])

// Props and local state come from outside this module (the hooks, a previous
// version of this view), so each field is checked and defaulted, never assumed.
export function viewProps(raw: unknown): ViewProps {
  const p = (raw ?? {}) as Partial<ViewProps>
  const diff = p.diff && typeof p.diff.path === 'string' ? { path: p.diff.path, edits: arrayOf<EditRecord>(p.diff.edits) } : undefined
  const w = p.wheel as Partial<Wheel> | undefined
  return {
    nodes: arrayOf(p.nodes), history: arrayOf(p.history), at: typeof p.at === 'number' ? p.at : 0, diff,
    ...(typeof p.repo === 'string' ? { repo: p.repo } : {}),
    theme: p.theme === 'kitty' ? 'kitty' : 'minimal',
    wheel: { seq: typeof w?.seq === 'number' ? w.seq : 0, by: typeof w?.by === 'number' ? w.by : 0 },
  }
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
    onlyRepo: s.onlyRepo !== false,
    help: s.help === true,
    wheelSeen: typeof s.wheelSeen === 'number' ? s.wheelSeen : -1,
  }
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

// Word wrap to a width in cells, so text scrolls and clips by whole lines.
export function wrap(text: string, width: number): string[] {
  const out: string[] = []
  for (const para of text.split('\n')) {
    if (!para.trim()) { out.push(''); continue }
    let line = ''
    for (const word of para.split(/\s+/)) {
      if (!word) continue
      if ((line ? cellWidth(line) + 1 : 0) + cellWidth(word) > width && line) { out.push(line); line = '' }
      line = line ? `${line} ${word}` : cellWidth(word) > width ? fit(word, width) : word
    }
    if (line) out.push(line)
  }
  return out
}

export function step(n: number, from: number, dir: 1 | -1, ok: (i: number) => boolean): number {
  for (let i = from + dir; i >= 0 && i < n; i += dir) if (ok(i)) return i
  return from
}

// ── unified diff hunks for the engine's own diff drawing ──────────────────
const CODE_LIMIT = 9000
// One edit as unified-diff hunks, split so each stays under the Code element's size limit.
export function unifiedHunks(lines: DiffLine[]): string[] {
  const out: string[] = []
  let chunk: DiffLine[] = []
  let size = 0
  const flush = () => {
    if (chunk.length === 0) return
    const oldNos = chunk.filter(l => l.op !== '+').map(l => l.oldNo ?? 0)
    const newNos = chunk.filter(l => l.op !== '-').map(l => l.newNo ?? 0)
    const firstOld = oldNos[0] ?? Math.max(0, (chunk[0]!.newNo ?? 1) - 1)
    const firstNew = newNos[0] ?? Math.max(0, (chunk[0]!.oldNo ?? 1) - 1)
    const head = `@@ -${firstOld},${oldNos.length} +${firstNew},${newNos.length} @@`
    out.push([head, ...chunk.map(l => `${l.op === ' ' ? ' ' : l.op}${l.text}`)].join('\n'))
    chunk = []
    size = 0
  }
  for (const l of lines) {
    const len = l.text.length + 2
    if (size + len > CODE_LIMIT) flush()
    chunk.push({ ...l, text: l.text.length > CODE_LIMIT - 100 ? l.text.slice(0, CODE_LIMIT - 100) : l.text })
    size += len
  }
  flush()
  return out
}

type Scope = { kind: 'node'; id: string } | { kind: 'phase'; wfId: string; phase: string }
type FileItem = { row: FileRow }
type DiffBlock = { rec: EditRecord; hunks: string[]; added: number; removed: number }

// A row is a run of coloured pieces, laid out to an exact width in cells.
type Seg = { t: string; c?: string; b?: boolean; bg?: string }
type Row = { segs: Seg[]; bg?: string; hit?: Hit[] }
type Hit = { x0: number; x1: number; act: () => void }
const seg = (t: string, c?: string, b?: boolean): Seg => ({ t, c, b })
const width = (segs: Seg[]) => segs.reduce((w, s) => w + cellWidth(s.t), 0)

// Cuts pieces to a width (… on the last one kept), then pads with one piece of spaces.
function lay(segs: Seg[], w: number): Seg[] {
  const out: Seg[] = []
  let used = 0
  for (const s of segs) {
    const cw = cellWidth(s.t)
    if (used + cw <= w) { out.push(s); used += cw; continue }
    const room = w - used
    if (room > 0) { out.push({ ...s, t: fit(s.t, room) }); used += cellWidth(fit(s.t, room)) }
    break
  }
  if (used < w) out.push({ t: ' '.repeat(w - used) })
  return out
}

// Inside a workflow the Agents view starts with a row for the whole run: its scope is everything.
const runRows = (run: AgentNode, nodes: AgentNode[], s: Pick<State, 'filter' | 'flipped' | 'showDone'>): Item[] =>
  run.kind !== 'agent'
    ? [{ kind: 'node', node: run, species: 'school', depth: 0 }, ...runItems(run, nodes, s.filter, s.flipped, s.showDone)]
    : runItems(run, nodes, s.filter, s.flipped, s.showDone)

const scopeOf = (it: Item | undefined, run: AgentNode): Scope =>
  it?.kind === 'node' ? { kind: 'node', id: it.node.id }
    : it?.kind === 'phase' ? { kind: 'phase', wfId: it.wfId, phase: it.phase }
      : { kind: 'node', id: run.id }

const ACT_WORD: Record<Act, string> = { think: 'thinking', read: 'reading', write: 'writing', run: 'running', web: 'web' }

let live: ClientSurface<State> | undefined

const View: ClientModule<JsonValue, State> = (raw, surface) => {
  const props = viewProps(raw)
  const { Box, Text, Code } = surface.elements
  const T: Theme = themeOf(props.theme)
  const C = T.c
  live = surface
  const s: State = viewState(surface.state)
  if (surface.state === undefined) {
    surface.setState(s)
    surface.every(TICK_MS, () => live?.state && live.setState({ ...live.state, tick: live.state.tick + 1 }))
  }
  if (surface.state !== undefined && s.atSeen !== props.at) surface.setState({ ...s, atSeen: props.at, tickAtSeen: s.tick })
  const now = s.atSeen === props.at ? props.at + (s.tick - s.tickAtSeen) * TICK_MS : props.at
  const pulse = s.tick % 2 === 0

  // ── geometry, from the region as laid out now ─────────────────────────
  const W = Math.max(20, surface.columns || 100)
  const R = Math.max(8, surface.rows || 30)
  const IW = W - 4 // inside the frame and its one-cell margins
  const CH = R - 2 // rows between the top and bottom borders
  const layout = W >= 140 ? 'split' : W >= 100 ? 'full' : 'compact'
  const LW = layout === 'split' ? Math.floor(IW * 0.45) : IW
  const RW = layout === 'split' ? IW - LW - 3 : IW

  // History filtered to this repository: a run belongs where its top node ran.
  const repoHistory = (() => {
    if (!s.onlyRepo || !props.repo) return props.history
    const byId = new Map(props.history.map(n => [n.id, n]))
    const top = (n: AgentNode) => { let x = n; while (x.parentId && byId.has(x.parentId)) x = byId.get(x.parentId)!; return x }
    return props.history.filter(n => top(n).repo === props.repo)
  })()
  const noRepoRuns = props.history.filter(n => !n.parentId && !n.repo).length
  const nodes = s.tab === 'live' ? props.nodes : repoHistory
  const allNodes = [...props.nodes, ...props.history]
  const run = s.path ? nodes.find(n => n.id === s.path) : undefined
  const isInWorkflow = (n: AgentNode) => !!n.parentId && nodes.some(p => p.id === n.parentId && p.kind === 'workflow')

  // ── what the screen is about: the run list's selection, or the scope inside a run ──
  const agentItems: Item[] = run ? runRows(run, nodes, s) : topItems(nodes, s.filter, s.tab === 'history', now, s.group)
  const view: ViewName = run ? s.view : 'agents'
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
  const mode = s.help ? 'help' : view === 'agents' ? 'agents' : view === 'output' ? 'output' : diffOpen ? 'diff' : 'files'

  const fileItems: FileItem[] = files.map(row => ({ row }))
  const blocks: DiffBlock[] = (() => {
    if (!diffOpen || props.diff?.path !== s.diffFile) return []
    return props.diff.edits.filter(r => scopeIds.has(r.agentId)).map(rec => {
      const lines = lineDiff(rec.old, rec.new, rec.line)
      return { rec, hunks: unifiedHunks(lines), ...diffCounts(lines) }
    })
  })()

  // ── the overview of the selection, as rows of a given width ───────────
  const outcome = (n: AgentNode) => n.summary ?? (n.kind === 'workflow' ? firstSentence(readableResult(n.result)) : firstSentence(n.result))
  const statusSegs = (n: Pick<AgentNode, 'status' | 'startedAt' | 'endedAt'>, extra?: string): Seg[] => {
    const st = T.status[n.status]
    const time = duration((n.status === 'running' ? now : n.endedAt ?? now) - n.startedAt)
    return [seg(n.status === 'running' && !pulse ? T.runningAlt : st.icon, st.color), seg(' '), seg(st.word, st.color, true),
      seg('   '), seg(time, C.muted), ...(extra ? [seg('   '), seg(extra, C.muted)] : [])]
  }
  const progressSegs = (done: number, total: number, w: number): Seg[] => {
    const b = bar(done, total, w)
    return [seg(b.filled, C.accent), seg(b.empty, C.faint)]
  }
  const changeSegs = (rows: FileRow[]): Seg[] => {
    if (rows.length === 0) return [seg('None', C.muted)]
    const added = rows.reduce((a, r) => a + r.added, 0)
    const removed = rows.reduce((a, r) => a + r.removed, 0)
    return [seg(`${rows.length} file${rows.length === 1 ? '' : 's'}`, C.accent), seg('   '), seg(`+${added}`, C.add), seg(' '), seg(`−${removed}`, C.del)]
  }
  const nowSegs = (n: AgentNode): Seg[] => [seg('› ', C.accent), seg(n.activity ?? 'Thinking', C.ink), seg(`   ${ACT_WORD[n.act ?? 'think']}`, C.faint)]

  const overview = (w: number, dense: 'compact' | 'full'): Row[] => {
    if (!scope) return []
    const title = scope.kind === 'phase' ? `${scope.phase} phase` : scopeNode?.label ?? ''
    const when = (n: AgentNode) => (s.tab === 'history' ? clock(n.startedAt) : undefined)
    let meta: Seg[] = []
    let second: Seg[] = []
    let rows: [string, Seg[]][] = []
    let points: string[] = []
    if (scope.kind === 'phase') {
      const c = counts(scopeList)
      const wf = nodes.find(n => n.id === scope.wfId)
      const start = Math.min(...scopeList.map(k => k.startedAt))
      const end = c.running ? now : Math.max(...scopeList.map(k => k.endedAt ?? now))
      meta = statusSegs({ status: c.running ? 'running' : c.failed ? 'failed' : 'done', startedAt: start, endedAt: end })
      second = [...progressSegs(c.total - c.running, c.total, 12), seg(`   ${c.total - c.running} of ${c.total} agents`, C.muted)]
      rows = [['Agents', [seg(phaseWords({ phase: scope.phase, ...c }), C.ink)]], ['Changes', changeSegs(files)], ['Part of', [seg(wf?.label ?? 'workflow', C.soft)]]]
    } else if (scopeNode && scopeNode.kind !== 'agent') {
      const n = scopeNode
      const kids = childrenOf(nodes, n.id)
      const c = counts(kids)
      const busy = kids.find(x => x.status === 'running')
      meta = statusSegs(n, when(n))
      second = [...progressSegs(c.total - c.running, c.total, 12), seg(`   ${c.total - c.running} of ${c.total} agents`, C.muted)]
      const phases: Seg[] = pipeline(n, nodes).flatMap((p, i) => [...(i ? [seg('  →  ', C.faint)] : []), seg(p.phase, C.ink), seg(`  ${phaseWords(p)}`, C.muted)])
      rows = [
        n.kind === 'group' ? ['Agents', [seg(phaseWords({ phase: '', ...c }), C.ink)]] : ['Phases', phases],
        ['Changes', changeSegs(files)],
        n.status === 'running' && busy ? ['Now', [...nowSegs(busy), seg(`   ${busy.label}`, C.muted)]] : ['Outcome', [seg(outcome(n) || '—', C.ink)]],
      ]
      points = n.points ?? []
    } else if (scopeNode) {
      const n = scopeNode
      const inWf = isInWorkflow(n)
      meta = statusSegs(n, when(n))
      second = [seg([prettyType(n, inWf), prettyModel(n.model), inWf && n.phase ? `${n.phase} phase` : n.where && n.where !== 'main' ? whereLabel(n.where) : ''].filter(Boolean).join('   ·   '), C.muted)]
      rows = [
        n.status === 'running' ? ['Now', nowSegs(n)] : ['Outcome', [seg(outcome(n) || noReportReason(n), C.ink)]],
        ['Changes', changeSegs(files)],
        ['Work', [seg(`${workSummary(n)}${n.tokens ? `   ·   ${Math.round(n.tokens / 1000)}k tokens` : ''}`, C.soft)]],
      ]
      points = n.points ?? []
    }
    const out: Row[] = []
    if (dense === 'compact') {
      out.push({ segs: [seg(fit(title, w), C.ink, true)] })
      const what = scope.kind === 'node' && scopeNode?.kind === 'agent' ? second : rows[0]?.[1] ?? []
      const changed = files.length ? [seg('   ·   ', C.faint), ...changeSegs(files)] : []
      out.push({ segs: [...meta, ...(what.length ? [seg('   ·   ', C.faint), ...what] : []), ...changed] })
      const [name, value] = rows.find(([k]) => k === 'Now' || k === 'Outcome') ?? rows[0] ?? ['', []]
      out.push({ segs: [seg(padEnd(name, 10), C.muted), ...value] })
      return out
    }
    for (const line of wrap(title, w).slice(0, 2)) out.push({ segs: [seg(line, C.ink, true)] })
    out.push({ segs: meta })
    out.push({ segs: second })
    out.push({ segs: [] })
    for (const [name, value] of rows) {
      const valueW = w - 11
      // a long sentence wraps under its value column
      if (value.length === 1 && cellWidth(value[0]!.t) > valueW) {
        wrap(value[0]!.t, valueW).slice(0, 3).forEach((t, i) => out.push({ segs: [seg(padEnd(i ? '' : name, 11), C.muted), seg(t, value[0]!.c)] }))
      } else out.push({ segs: [seg(padEnd(name, 11), C.muted), ...value] })
    }
    if (layout === 'split' && points.length) {
      out.push({ segs: [] })
      out.push({ segs: [seg('Key points', C.accent, true)] })
      for (const p of points) wrap(p, w - 3).forEach((t, i) => out.push({ segs: [seg(i ? '   ' : ' • ', C.faint), seg(t, C.soft)] }))
    }
    return out
  }

  // ── output text ──────────────────────────────────────────────────────
  const outRows = (w: number): Row[] => {
    if (mode !== 'output') return []
    const out: Row[] = []
    const para = (t: string, c?: string, b?: boolean) => wrap(t, w).forEach(text => out.push({ segs: [seg(text, c, b)] }))
    const gap = () => out.push({ segs: [] })
    if (scope?.kind === 'phase') {
      para(`What the ${scope.phase} phase reported`, C.accent, true)
      for (const k of scopeList) {
        gap()
        para(k.label, C.ink, true)
        para(k.summary ?? (firstSentence(k.result, 300) || noReportReason(k)), C.soft)
      }
      return out
    }
    const n = scopeNode
    if (!n) return out
    if (n.summary) { para('Outcome', C.accent, true); para(n.summary, C.ink) }
    if (n.points?.length) { gap(); para('Key points', C.accent, true); n.points.forEach(p => para(`•  ${p}`, C.soft)) }
    if (n.kind !== 'agent') {
      gap(); para('Agents', C.accent, true)
      for (const k of childrenOf(nodes, n.id)) para(`${k.phase ? `${k.phase}  ·  ` : ''}${k.label} — ${k.summary ?? firstSentence(k.result, 160)}`, C.soft)
    }
    const report = n.kind === 'workflow' ? readableResult(n.result) : n.result
    if (report) {
      gap(); para(n.kind === 'workflow' ? 'Final result' : 'Full report', C.accent, true)
      for (const line of report.split('\n')) para(plain(line) || ' ', C.muted)
    }
    if (!report && !n.summary) para(n.status === 'running' ? 'Still working — the report appears here when it finishes.' : noReportReason(n), C.muted)
    const task = taskText(n.prompt)
    if (task) { gap(); para('Task it was given', C.accent, true); para(task, C.muted) }
    return out
  }

  // ── fixed blocks: top rows, the body, bottom rows ─────────────────────
  const isReading = mode === 'output' || mode === 'diff' || mode === 'help'
  const fullOverview = layout === 'split' || isReading ? [] : overview(IW, layout === 'compact' ? 'compact' : 'full')
  const TOP = 1 + 1 + (fullOverview.length ? fullOverview.length + 1 : 0) + 1 // tabs, rule, overview + rule, caption
  const BOTTOM = 2 // rule, keys
  const bodyRows = Math.max(1, CH - TOP - BOTTOM)
  const listW = layout === 'split' && (mode === 'agents' || mode === 'files') ? LW : IW
  const output = outRows(IW)
  const count = mode === 'agents' ? agentItems.length : mode === 'files' ? fileItems.length : mode === 'diff' ? blocks.length : mode === 'output' ? output.length : 0
  const okRow = (i: number) => (mode === 'agents' ? isSelectable(agentItems[i]) : true)
  const rawSel = mode === 'agents' ? agentSel : s.sel
  const sel = mode === 'output' || mode === 'help' ? 0 : Math.min(Math.max(0, rawSel), Math.max(0, count - 1))
  // the diff scrolls by edit block, the selected one at the top
  let first = mode === 'output' ? s.first : mode === 'diff' ? sel : Math.min(s.first, sel)
  if (mode !== 'output' && mode !== 'diff' && sel >= first + bodyRows) first = sel - bodyRows + 1
  if (mode !== 'diff') first = Math.max(0, Math.min(first, Math.max(0, count - bodyRows)))

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
  const activate = (i = sel) => {
    if (mode === 'agents') {
      const it = agentItems[i]
      if (!it) return
      if (!run && it.kind === 'node') return openRun(it.node)
      if (it.kind === 'phase') return set({ sel: i, flipped: toggleIn(s.flipped, it.key) })
      if (it.kind === 'more') return set({ sel: i, showDone: toggleIn(s.showDone, it.key) })
      if (it.kind === 'node') return go('output')
    } else if (mode === 'files') {
      const it = fileItems[i]
      if (it) openDiff(it.row.path)
    } else if (mode === 'diff') {
      const b = blocks[i]
      if (b) trace(b.rec.agentId)
    }
  }
  const back = () => {
    if (s.help) return set({ help: false })
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
  const side = (dir: 1 | -1) => {
    if (!run) return switchTab(dir > 0 ? 'history' : 'live')
    if (mode === 'diff') return nextFile(dir)
    const i = VIEWS.indexOf(view) + dir
    if (i < 0) return back()
    if (i < VIEWS.length) go(VIEWS[i]!)
  }
  const moveBy = (by: number): Partial<State> => {
    if (mode === 'output') return { first: Math.max(0, Math.min(first + by, count - bodyRows)) }
    if (mode === 'help') return {}
    let at = sel
    for (let k = 0; k < Math.abs(by); k++) at = step(count, at, by > 0 ? 1 : -1, okRow)
    return { sel: at }
  }
  const move = (dir: 1 | -1) => set(moveBy(dir))

  // A wheel move the hooks forwarded: applied once, as j/k would be.
  const wheel = props.wheel ?? { seq: 0, by: 0 }
  if (surface.state !== undefined && s.wheelSeen !== wheel.seq) {
    surface.setState({ ...s, sel, first, wheelSeen: wheel.seq, ...(s.wheelSeen >= 0 && wheel.by ? moveBy(Math.sign(wheel.by) * Math.min(3, Math.abs(wheel.by))) : {}) })
  }

  surface.onKey(({ key }) => {
    if (key === '?') return set({ help: !s.help })
    if (s.help) return set({ help: false })
    if (key === 'j' || key === 'down') move(1)
    else if (key === 'k' || key === 'up') move(-1)
    else if (key === 'pagedown') set(moveBy(Math.max(1, bodyRows - 1)))
    else if (key === 'pageup') set(moveBy(-Math.max(1, bodyRows - 1)))
    else if (key === 'g' || key === 'home') set({ sel: 0, first: 0 })
    else if (key === 'G' || key === 'end') set({ sel: Math.max(0, count - 1), first: Math.max(0, count - bodyRows) })
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
    else if (key === 'r' && !run) set({ onlyRepo: !s.onlyRepo, sel: 0, first: 0 })
    else if (key === 'v' && !run) set({ group: GROUPS[(GROUPS.indexOf(s.group) + 1) % GROUPS.length], sel: 0, first: 0 })
  })

  // ── rows of the lists ────────────────────────────────────────────────
  const running = props.nodes.filter(n => !n.parentId && n.status === 'running').length
  const histTops = repoHistory.filter(n => !n.parentId)
  const today = histTops.filter(n => dayLabel(n.startedAt, now) === 'Today').length
  const cursorSeg = (on: boolean) => seg(on ? T.cursor : ' ', C.accent)
  const cell2 = (g: string, c?: string) => seg(padEnd(g, 2), c)

  // the run list's columns: status · kind · label · progress or changes · start · duration
  const showMid = listW >= 60
  const showStart = listW >= 84
  const agentRow = (it: Item, i: number, w: number): Row => {
    const on = i === sel
    const bg = on ? C.selBg : undefined
    if (it.kind === 'header') return { segs: [seg(' '), seg(it.text, C.muted, true), seg(`  ${it.count}`, C.faint)] }
    if (it.kind === 'more') return { bg, segs: [cursorSeg(on), seg('      '), seg(`${it.count} more finished agents`, C.muted), seg('   enter to list them', C.faint)] }
    if (it.kind === 'phase') {
      const color = it.failed ? C.bad : it.running ? C.warn : C.ok
      return { bg, segs: [cursorSeg(on), seg(' '), seg(it.isOpen ? T.fold.open : T.fold.closed, C.muted), seg(' '), seg(it.phase, C.ink, true), seg('   '), seg(phaseWords(it), color)] }
    }
    const n = it.node
    const st = T.status[n.status]
    const isLive = n.status === 'running'
    const isWhole = !!run && n.id === run.id && n.kind !== 'agent'
    const kids = n.kind !== 'agent' ? counts(childrenOf(nodes, n.id)) : undefined
    const rows = fileRows(scopeNodes(nodes, { kind: 'node', id: n.id }))
    const added = rows.reduce((a, r) => a + r.added, 0)
    const removed = rows.reduce((a, r) => a + r.removed, 0)
    const mid: Seg[] = !showMid ? []
      : kids && !isWhole ? [...progressSegs(kids.total - kids.running, kids.total, 6), seg(' '), seg(`${kids.total - kids.running}/${kids.total}`, C.muted)]
        : isLive && !kids ? [seg(fit(n.activity ?? 'Thinking', 14), C.warn)]
          : rows.length ? [seg(`+${added}`, C.add), seg(' '), seg(`−${removed}`, C.del)] : []
    const midW = width(mid)
    const tail: Seg[] = [
      ...(showMid ? [seg(' '), seg(' '.repeat(Math.max(0, 14 - midW))), ...mid] : []),
      ...(showStart ? [seg(' '), seg(padStart(!run || s.tab === 'history' ? clock(n.startedAt) : '', 8), C.faint)] : []),
      seg(' '), seg(padStart(duration((n.endedAt ?? now) - n.startedAt), 8), C.muted),
    ]
    const head: Seg[] = [
      cursorSeg(on), seg(' '),
      cell2(isLive && !pulse ? T.runningAlt : st.icon, st.color), seg(' '),
      cell2(isWhole ? (n.kind === 'group' ? T.kind.group : T.kind.workflow) : kindGlyph(T, n, it.species === 'sea'), C.soft), seg(' '),
      ...(it.depth ? [seg('  '.repeat(it.depth))] : []),
    ]
    const labelW = Math.max(4, w - width(head) - width(tail))
    const text = isWhole ? 'All agents' : n.label
    const shown = fit(text, labelW)
    return {
      bg,
      segs: [...head, seg(shown, isLive || on ? C.ink : C.soft, on || n.kind !== 'agent'), seg(' '.repeat(Math.max(0, labelW - cellWidth(shown)))), ...tail],
    }
  }
  const nameWidth = Math.min(32, Math.max(8, ...files.map(f => cellWidth(names.get(f.path) ?? ''))))
  const fileRow = (it: FileItem, i: number, w: number): Row => {
    const on = i === sel
    const phases = [...new Set(it.row.by.map(b => b.node.phase).filter(Boolean))]
    const who = phases.length ? phases.join(', ') : it.row.by.length === 1 ? it.row.by[0]!.node.label : `${it.row.by.length} agents`
    const name = names.get(it.row.path) ?? it.row.path
    const nw = Math.min(nameWidth, Math.max(8, w - 30))
    return {
      bg: on ? C.selBg : undefined,
      segs: [cursorSeg(on), seg(' '), cell2(T.kind.file, C.muted), seg(' '), seg(fit(name, nw), C.ink, on), seg(' '.repeat(Math.max(0, nw - cellWidth(fit(name, nw))))),
        seg('   '), seg(`+${it.row.added}`, C.add), seg(' '), seg(`−${it.row.removed}`, C.del), seg('   '), seg(who, C.muted)],
    }
  }

  const KEYS_HELP: [string, string][] = [
    ['j k  ↑ ↓', 'move, or scroll the text'], ['PgUp PgDn', 'a page at a time'], ['g G', 'first, last'], ['enter', 'open'],
    ['h l  ← →', 'live · history, or the views of a run'], ['1 2', 'live, history'], ['a c o', 'agents, changes, output'],
    ['n p', 'next, previous file in a diff'], ['b  ⌫', 'back'], ['f', 'filter: all, running, failed'], ['v', 'group the run list'],
    ['r', 'this repo · all repos (history)'], ['wheel', 'move, or scroll'], ['?', 'close this help'],
  ]
  const bodyList: Row[] = (() => {
    if (mode === 'help') {
      return [{ segs: [] }, ...KEYS_HELP.map(([k, what]) => ({ segs: [seg(padEnd(k, 14), C.ink, true), seg(what, C.muted)] }))]
    }
    if (mode === 'agents') {
      if (agentItems.length === 0) {
        return [
          { segs: [] },
          { segs: [seg(' '), seg(s.tab === 'live' ? T.words.emptyLive : T.words.emptyHistory, C.ink)] },
          { segs: [] },
          ...wrap(s.tab === 'live' ? T.words.emptyHint : 'Finished subagents and workflows are kept here across sessions.', listW - 2).map(t => ({ segs: [seg(' '), seg(t, C.muted)] })),
        ]
      }
      return agentItems.slice(first, first + bodyRows).map((it, k) => agentRow(it, first + k, listW))
    }
    if (mode === 'files') {
      if (fileItems.length === 0) {
        const what = scope?.kind === 'phase' ? 'this phase' : scopeNode?.kind === 'workflow' ? 'this workflow' : scopeNode?.kind === 'group' ? 'this group' : 'this agent'
        return [{ segs: [] }, { segs: [seg(' '), seg(`No files were changed by ${what}.`, C.muted)] }]
      }
      return fileItems.slice(first, first + bodyRows).map((it, k) => fileRow(it, first + k, listW))
    }
    if (mode === 'output') return output.slice(first, first + bodyRows)
    return []
  })()

  // ── the rows above and below the body ────────────────────────────────
  const tabSeg = (label: string, on: boolean): Seg => (on ? { t: ` ${label} `, c: C.accent, b: true, bg: C.selBg } : { t: ` ${label} `, c: C.muted })
  const tabsRow: Row = (() => {
    const specs: [string, Tab][] = [[`Live ${running}`, 'live'], [`History ${histTops.length}`, 'history']]
    const segs: Seg[] = []
    const hit: Hit[] = []
    let x = 0
    specs.forEach(([label, tab], i) => {
      if (i) { segs.push(seg('  ')); x += 2 }
      const sg = tabSeg(label, s.tab === tab)
      hit.push({ x0: x, x1: x + cellWidth(sg.t), act: () => switchTab(tab) })
      segs.push(sg)
      x += cellWidth(sg.t)
    })
    if (run) segs.push(seg('   ›  ', C.faint), seg(run.label, C.soft, true))
    return { segs, hit }
  })()
  const viewTabs: Row = (() => {
    const specs: [string, ViewName][] = [['Agents', 'agents'], [`Changes ${files.length}`, 'changes'], ['Output', 'output']]
    const segs: Seg[] = []
    const hit: Hit[] = []
    let x = 0
    specs.forEach(([label, v], i) => {
      if (i) { segs.push(seg('  ')); x += 2 }
      const sg = tabSeg(label, view === v)
      hit.push({ x0: x, x1: x + cellWidth(sg.t), act: () => go(v) })
      segs.push(sg)
      x += cellWidth(sg.t)
    })
    return { segs, hit }
  })()
  const caption: Row = (() => {
    if (mode === 'help') return { segs: [seg('Keys', C.accent, true), seg('   every key the pane takes', C.muted)] }
    if (!run) {
      const where = s.onlyRepo && props.repo ? `this repo${noRepoRuns ? ` (${noRepoRuns} older without a repo: r for all)` : ''}` : 'all repos'
      const what = s.tab === 'live' ? (running ? `${running} running` : 'Nothing running') : `${today} finished today   ·   ${where}`
      const header = s.tab === 'live' ? T.words.live : T.words.history
      return { segs: [seg(header, C.ink, true), seg('   '), seg(`${what}${s.group !== 'none' ? `   ·   ${GROUP_NAMES[s.group]}` : ''}${s.filter !== 'all' ? `   ·   ${s.filter} only` : ''}`, C.muted)] }
    }
    if (mode === 'diff') {
      const row = files.find(f => f.path === s.diffFile)
      return {
        segs: [seg('‹ ', C.accent), seg(names.get(s.diffFile ?? '') ?? s.diffFile ?? '', C.ink, true),
          ...(row ? [seg('   '), seg(`+${row.added}`, C.add), seg(' '), seg(`−${row.removed}`, C.del), seg(`   ${row.edits} edit${row.edits === 1 ? '' : 's'}`, C.muted)] : []),
          ...(blocks.length ? [seg(`   ·   edit ${sel + 1} of ${blocks.length}`, C.faint)] : [])],
        hit: [{ x0: 0, x1: 2, act: back }],
      }
    }
    return viewTabs
  })()
  const keyList: [string, string][] = mode === 'help' ? [['?', 'close']]
    : !run ? [['j k', 'move'], ['enter', 'open'], ['c', 'changes'], ['h l', 'live · history'], ['v', 'group'], ...(s.tab === 'history' ? [['r', s.onlyRepo ? 'all repos' : 'this repo'] as [string, string]] : []), ['?', 'help']]
      : mode === 'agents' ? [['j k', 'move'], ['enter', 'open'], ['h l', 'views'], ['b', 'back'], ['?', 'help']]
        : mode === 'files' ? [['j k', 'move'], ['enter', 'diff'], ['h l', 'views'], ['b', 'back'], ['?', 'help']]
          : mode === 'diff' ? [['j k', 'edit'], ['enter', 'go to agent'], ['n p', 'files'], ['b', 'back'], ['?', 'help']]
            : [['j k', 'scroll'], ['h l', 'views'], ['b', 'back'], ['?', 'help']]
  const hiddenBelow = mode === 'diff' ? 0 : count - first - bodyRows
  const footer: Row = (() => {
    const right: Seg[] = hiddenBelow > 0 ? [seg(`${hiddenBelow} more below`, C.faint)] : []
    const room = IW - width(right) - 2
    // keys drop from the right until they fit, but ? help stays
    const keys = [...keyList]
    const keySegs = (ks: [string, string][]) => ks.flatMap(([k, what], i) => [...(i ? [seg('   ')] : []), seg(k, C.soft, true), seg(` ${what}`, C.muted)])
    while (keys.length > 1 && width(keySegs(keys)) > room) keys.splice(keys.length - 2, 1)
    const left = keySegs(keys)
    return { segs: [...left, seg(' '.repeat(Math.max(1, IW - width(left) - width(right)))), ...right] }
  })()

  // ── assembling the frame ─────────────────────────────────────────────
  type Line = { row?: Row; rule?: boolean; join?: string; node?: unknown; height?: number }
  const lines: Line[] = []
  const pointerRows: (Row | undefined)[] = []
  const pushRow = (row: Row) => { lines.push({ row }); pointerRows.push(row) }
  const pushRule = (join?: string) => { lines.push({ rule: true, join }); pointerRows.push(undefined) }
  const used = () => lines.reduce((n, l) => n + (l.height ?? 1), 0)
  let bodyTop = 0

  if (W < MIN_COLUMNS) {
    const msg = `Widen the pane to at least ${MIN_COLUMNS} columns.`
    const lines2 = wrap(msg, IW)
    const top = Math.max(0, Math.floor((CH - lines2.length) / 2))
    for (let y = 0; y < CH; y++) {
      const t = lines2[y - top]
      pushRow({ segs: t ? [seg(' '.repeat(Math.max(0, Math.floor((IW - cellWidth(t)) / 2)))), seg(t, C.muted)] : [] })
    }
  } else {
    const isSplit = layout === 'split' && (mode === 'agents' || mode === 'files')
    pushRow(tabsRow)
    pushRule(isSplit ? '┬' : undefined)
    if (fullOverview.length) { fullOverview.forEach(pushRow); pushRule() }
    if (isSplit) {
      // master left, detail right, one divider between them
      const left: Row[] = [caption, ...bodyList]
      const right = overview(RW, 'full')
      bodyTop = lines.length + 1
      const n = bodyRows + 1
      for (let y = 0; y < n; y++) {
        const l = left[y] ?? { segs: [] }
        const r = right[y] ?? { segs: [] }
        // the selection's background covers its half only
        const half = lay(l.segs, LW).map(sg => (l.bg ? { ...sg, bg: sg.bg ?? l.bg } : sg))
        pushRow({ segs: [...half, seg(' │ ', C.rule), ...lay(r.segs, RW)], hit: l.hit })
      }
    } else {
      pushRow(caption)
      bodyTop = lines.length
      if (mode === 'diff') {
        lines.push({ node: 'diff', height: bodyRows })
        for (let y = 0; y < bodyRows; y++) pointerRows.push(undefined)
      } else {
        for (let y = 0; y < bodyRows; y++) pushRow(bodyList[y] ?? { segs: [] })
      }
    }
    // keep the bottom rows on the last rows whatever the layout above took
    while (used() < CH - BOTTOM) pushRow({ segs: [] })
    pushRule(isSplit ? '┴' : undefined)
    pushRow(footer)
  }

  // ── pointer: rows map to what they show ──────────────────────────────
  surface.onPointer(e => {
    if (e.type !== 'down' || e.button !== 'left') return
    const y = e.y - 1
    const x = e.x - 2
    const row = pointerRows[y]
    const hit = row?.hit?.find(h => x >= h.x0 && x < h.x1)
    if (hit) return hit.act()
    if (mode === 'help' || mode === 'output') return
    const at = y - bodyTop
    if (at < 0 || at >= bodyRows) return
    if (mode === 'diff') return
    if (layout === 'split' && x >= LW) return
    const i = first + at
    if (i >= count || !okRow(i)) return
    if (i === sel) activate(i)
    else set({ sel: i })
  })

  // ── drawing ──────────────────────────────────────────────────────────
  const drawRow = (row: Row, w: number) => (
    <Box height={1} backgroundColor={row.bg}>
      <Text wrap="truncate-end">{lay(row.segs, w).map(sg => <Text color={sg.c} bold={sg.b} backgroundColor={sg.bg}>{sg.t}</Text>)}</Text>
    </Box>
  )
  const diffBody = () => {
    if (blocks.length === 0) {
      return <Box height={bodyRows}><Text color={C.muted}>{props.diff?.path === s.diffFile ? 'No recorded edits for this file in this scope.' : 'Loading the diff…'}</Text></Box>
    }
    return (
      <Box flexDirection="column" height={bodyRows} overflow="hidden">
        {blocks.slice(first).map((b, k) => {
          const n = allNodes.find(x => x.id === b.rec.agentId)
          const on = first + k === sel
          const head: Row = {
            bg: on ? C.selBg : undefined,
            segs: [cursorSeg(on), seg(' '), ...(n?.phase ? [seg(n.phase, C.accent), seg('  ›  ', C.faint)] : []),
              seg(n?.label ?? b.rec.agentId, C.ink, true), seg(`   line ${b.rec.line}   ${clockSec(b.rec.at)}`, C.muted),
              seg('   '), seg(`+${b.added}`, C.add), seg(' '), seg(`−${b.removed}`, C.del), ...(b.rec.isNew ? [seg('   new file', C.muted)] : []),
            ],
          }
          return (
            <Box flexDirection="column">
              {drawRow(head, IW)}
              {b.hunks.map(hunk => <Code source={hunk} format="diff" path={b.rec.path} wrap="wrap" />)}
              <Text> </Text>
            </Box>
          )
        })}
      </Box>
    )
  }

  // the frame: a titled top border, side borders that meet the rules, a bottom border
  const isRule = lines.flatMap((l, i) => (l.rule ? [i] : []))
  const sideRows = (left: boolean) => {
    const out: string[] = []
    lines.forEach((l, i) => {
      const h = l.height ?? 1
      for (let k = 0; k < h; k++) out.push(isRule.includes(i) ? (left ? '├' : '┤') : '│')
    })
    while (out.length < CH) out.push('│')
    return out.slice(0, CH)
  }
  const tops = run ? nodes.filter(n => n.id === run.id) : nodes.filter(n => !n.parentId)
  const tally = counts(tops)
  const title: Seg[] = [seg('Agents', C.ink, true), seg(` · ${s.onlyRepo && props.repo ? 'this repo' : 'all repos'}`, C.muted)]
  const tallySegs: Seg[] = [seg(T.status.running.icon, T.status.running.color), seg(` ${tally.running} running  `, C.muted),
    seg(T.status.done.icon, T.status.done.color), seg(` ${tally.done}  `, C.muted),
    seg(T.status.failed.icon, T.status.failed.color), seg(` ${tally.failed + tally.stopped}`, C.muted)]
  const topFill = W - 4 - width(title) - width(tallySegs) - 4
  const topSegs: Seg[] = topFill >= 1
    ? [seg('╭─ ', C.frame), ...title, seg(` ${'─'.repeat(topFill)} `, C.frame), ...tallySegs, seg(' ─╮', C.frame)]
    : [seg('╭─ ', C.frame), ...lay(title, W - 6), seg(' ─╮', C.frame)]

  return (
    <Box flexDirection="column" height={R} width={W}>
      <Box height={1}><Text wrap="truncate-end">{topSegs.map(sg => <Text color={sg.c} bold={sg.b}>{sg.t}</Text>)}</Text></Box>
      <Box flexDirection="row" height={CH}>
        <Box flexDirection="column" width={1}>{sideRows(true).map(ch => <Text color={C.frame}>{ch}</Text>)}</Box>
        <Box flexDirection="column" width={W - 2} overflow="hidden">
          {lines.map(l => {
            if (l.rule) {
              const line = l.join ? `${'─'.repeat(LW + 2)}${l.join}${'─'.repeat(Math.max(0, W - 2 - LW - 3))}` : '─'.repeat(W - 2)
              return <Box height={1}><Text color={C.rule}>{line}</Text></Box>
            }
            if (l.node === 'diff') return <Box paddingX={1} height={l.height}>{diffBody()}</Box>
            return <Box height={1} paddingX={1} backgroundColor={l.row?.bg}>{drawRow(l.row ?? { segs: [] }, IW)}</Box>
          })}
        </Box>
        <Box flexDirection="column" width={1}>{sideRows(false).map(ch => <Text color={C.frame}>{ch}</Text>)}</Box>
      </Box>
      <Box height={1}><Text color={C.frame}>{`╰${'─'.repeat(Math.max(0, W - 2))}╯`}</Text></Box>
    </Box>
  )
}

export default View
