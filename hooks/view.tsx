import type { ClientModule, ClientSurface, JsonValue } from 'claude-code'

import type { Act, AgentNode, Brief, EditRecord, PatternsDoc, TraceRow, TraceView, TraceZoom, ViewProps, Wheel } from '../types'
import {
  COLUMNS, LENSES, LENS_NAMES, aspects, boardLanes, columnOf, criticalPath, idleGaps, insights, lensesFor, modelFamily, rowFlags, spendByModel,
  timelineRows, tokensUnder, type Column, type Flag, type Insight, type Lane, type Lens, type TimeRow,
} from './lens'
import { compareRuns, previousOf, verdict, type Metric } from './compare'
import {
  GROUPS, GROUP_NAMES, childrenOf, counts, dayLabel, diffCounts, fileRows, firstSentence, isSelectable, lineDiff,
  noReportReason, overlaps, phaseWords, pipeline, plain, prettyModel, prettyType, readableResult, runTree, scopeNodes, shortPaths,
  taskText, topItems, whereLabel, workSummary, type DiffLine, type FileRow, type Filter, type Group, type Item,
  folderKey, runKey,
} from './list'
import { cellWidth, fit, kindGlyph, padEnd, padStart, themeOf, type Theme } from './theme'
import {
  HISTORY_FILTERS, HISTORY_FILTER_NAMES, historyItems, historyStats, outcomeOf, runTokens, sparkline, type HistoryFilter,
} from './history'
import { kTokens, reportFacts, reportOf, type Facts } from './report'
import { ZOOMS, ZOOM_NAMES } from './trace'
import { ago } from './ai'

type Tab = 'live' | 'history'
type ViewName = 'agents' | 'changes' | 'output'
type State = {
  tab: Tab
  // the run opened (a workflow, a cluster or a top-level subagent), or null for the run list
  path: string | null
  view: ViewName
  // how the agents are drawn: their tree, a board by status, or a timeline
  lens: Lens
  sel: number
  first: number
  // the agents view's selection, kept while Changes or Output show its scope
  agentSel: number
  // what that selection was (a node id, or phase:<workflow>:<phase>), so any lens finds it again
  focus: string | null
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
  // the insight `i` last jumped to; -1 before the first
  insight: number
  // History: which runs the page keeps, the search words, whether typing goes to
  // the search line, and whether runs older than a week show
  hfilter: HistoryFilter
  query: string
  searching: boolean
  olderOpen: boolean
  // the trace: how close it reads, what was last asked of the hooks and when,
  // and the row to come back to after a diff
  zoom: TraceZoom
  traceAsk: string
  traceAskTick: number
  traceAt: number
  // a short line in the footer (how to turn AI on, "press e again"), and the tick it was set
  note: string
  noteTick: number
  // a second press within a few ticks writes the brief or the patterns again
  confirm: '' | 'explain' | 'patterns'
  confirmTick: number
  // History: whether the patterns across runs show
  patternsOpen: boolean
  // Where the keys go, as on a remote: the content, or one of the two bars above it
  // (the caption's views and lenses, the Live and History tabs). Arrows switch tabs
  // only in a bar; ↑ on the first row goes up to it, ↓ comes back. `barAt` is the
  // item the bar's cursor is on.
  zone: Zone
  barAt: number
  // the agent picked in another lens, whose lane the trace opens on and marks;
  // `traceJump` until the trace has come and the jump is made
  traceFocus: string | null
  traceJump: boolean
  // the trace cut to one lane (its agent id), and the words searched in it
  traceLane: string | null
  tquery: string
  // a run marked to compare with the next one m is pressed on; two runs side by side
  mark: string | null
  compare: [string, string] | null
  // the last picture note shown
  exportSeen: number
}
type Zone = 'content' | 'caption' | 'tabs'

const TICK_MS = 500
// every key the pane takes, for ? help
const KEYS_HELP: [string, string][] = [
  ['j k  ↑ ↓', 'move, or scroll the text'], ['↑ on the top row', 'up to the bar: views and lenses, then Live · History'],
  ['in a bar  ← →', 'switch; ↓ or enter goes back down to the list'], ['PgUp PgDn', 'a page at a time'], ['g G', 'first, last'], ['enter', 'open'],
  ['space  ← →', 'fold or unfold in the tree; ← goes up to the parent'], ['v', 'view: tree, board, timeline; in a run, trace'],
  ['1 2  a c o', 'straight to live, history; agents, changes, output'], ['b  ⌫', 'back'],
  ['i', 'next thing that needs a look'], ['f', 'filter: all, running, failed · history: all, failed, changed files'], ['s', 'group the run list'],
  ['/', 'search history: names and outcomes; in a trace, its rows; enter keeps, ctrl+u clears'], ['o', 'show or hide history older than a week'],
  ['r', 'this repo · all repos (history)'],
  ['m', 'mark a run; m on a second run compares the two'], ['=', 'compare a run with its last run of the same work'],
  ['trace  n p', 'next, previous failure or quiet gap; with a search, its matches'], ['trace  f', 'only the lane of the row you are on; f again for all'],
  ['z', 'trace: story, steps, raw'], ['n p', 'next, previous file in a diff'],
  ['x', 'save the run\'s timeline or trace as a picture (SVG, and PNG with rsvg-convert)'],
  ['e', 'explain this run: a brief from Sonnet (ai: full); twice to write it again'],
  ['g', 'history: patterns across runs from Sonnet (ai: full); twice to look again'],
  ['p', 'history: show or hide the patterns'],
  ['wheel', 'move, or scroll'], ['?', 'close this help'],
]
// its rows: a blank row, then the list
const KEYS_HELP_COUNT = KEYS_HELP.length + 1
const MIN_COLUMNS = 60
const CARDS_PER_CELL = 4
const DEFAULT_STATE: State = {
  tab: 'live', path: null, view: 'agents', lens: 'tree', sel: 0, first: 0, agentSel: 0, focus: null, diffFile: null,
  filter: 'all', group: 'none', flipped: [], showDone: [], tick: 0, atSeen: 0, tickAtSeen: 0, onlyRepo: true, help: false,
  wheelSeen: -1, insight: -1, hfilter: 'all', query: '', searching: false, olderOpen: false,
  zoom: 'story', traceAsk: '', traceAskTick: -100, traceAt: 0,
  note: '', noteTick: -100, confirm: '', confirmTick: -100, patternsOpen: true,
  zone: 'content', barAt: 0, traceFocus: null, traceJump: false, traceLane: null, tquery: '', mark: null, compare: null, exportSeen: 0,
}
const FILTERS: Filter[] = ['all', 'running', 'failed']
// a note shows for 8 ticks (4 s); a confirm waits 6 ticks (3 s) for the second press
const NOTE_TICKS = 8
const CONFIRM_TICKS = 6
const PATTERNS_TITLE = 'Patterns across runs'
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
    ...(traceOf(p.trace) ? { trace: traceOf(p.trace) } : {}),
    ai: p.ai === 'off' || p.ai === 'full' ? p.ai : 'cheap',
    aiWeek: typeof p.aiWeek === 'number' ? p.aiWeek : 0,
    explaining: arrayOf<string>(p.explaining).filter(x => typeof x === 'string'),
    patternsBusy: p.patternsBusy === true,
    ...(patternsOf(p.patterns) ? { patterns: patternsOf(p.patterns) } : {}),
    ...(p.exported && typeof p.exported.seq === 'number' && typeof p.exported.text === 'string' ? { exported: { seq: p.exported.seq, text: p.exported.text } } : {}),
  }
}

// Patterns from the hooks, when they have the shape the view draws.
const patternsOf = (d: unknown): PatternsDoc | undefined => {
  const x = d as Partial<PatternsDoc> | undefined
  if (!x || !Array.isArray(x.cards) || typeof x.at !== 'number') return undefined
  const cards = x.cards.filter(c => c && typeof c.title === 'string').map(c => ({ ...c, runs: arrayOf<{ id: string; label: string }>(c.runs) }))
  return { cards, model: typeof x.model === 'string' ? x.model : 'Sonnet', at: x.at, ...(typeof x.tokens === 'number' ? { tokens: x.tokens } : {}) }
}

// A trace from the hooks, when it has the shape the view draws.
const traceOf = (t: unknown): TraceView | undefined => {
  const x = t as Partial<TraceView> | undefined
  if (!x || typeof x.run !== 'string' || !Array.isArray(x.rows) || !Array.isArray(x.lanes)) return undefined
  return { run: x.run, zoom: ZOOMS.includes(x.zoom as TraceZoom) ? (x.zoom as TraceZoom) : 'story', lanes: x.lanes, rows: x.rows as TraceRow[],
    total: typeof x.total === 'number' ? x.total : x.rows.length, offset: typeof x.offset === 'number' ? x.offset : 0, missing: typeof x.missing === 'number' ? x.missing : 0,
    ...(typeof x.storyBy === 'string' ? { storyBy: x.storyBy } : {}),
    ...(typeof x.lane === 'string' ? { lane: x.lane } : {}),
    marks: arrayOf<number>(x.marks).filter(n => typeof n === 'number'),
    ...(typeof x.query === 'string' ? { query: x.query, hits: arrayOf<number>(x.hits).filter(n => typeof n === 'number') } : {}) }
}

export function viewState(raw: unknown): State {
  const s = { ...DEFAULT_STATE, ...((raw ?? {}) as Partial<State>) }
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
  return {
    ...s,
    tab: s.tab === 'history' ? 'history' : 'live',
    path: typeof s.path === 'string' ? s.path : null,
    view: VIEWS.includes(s.view) ? s.view : 'agents',
    lens: LENSES.includes(s.lens) ? s.lens : 'tree',
    focus: typeof s.focus === 'string' ? s.focus : null,
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
    insight: typeof s.insight === 'number' ? s.insight : -1,
    hfilter: HISTORY_FILTERS.includes(s.hfilter) ? s.hfilter : 'all',
    query: typeof s.query === 'string' ? s.query : '',
    searching: s.searching === true,
    olderOpen: s.olderOpen === true,
    zoom: ZOOMS.includes(s.zoom) ? s.zoom : 'story',
    traceAsk: typeof s.traceAsk === 'string' ? s.traceAsk : '',
    traceAskTick: typeof s.traceAskTick === 'number' ? s.traceAskTick : -100,
    traceAt: num(s.traceAt),
    note: typeof s.note === 'string' ? s.note : '',
    noteTick: typeof s.noteTick === 'number' ? s.noteTick : -100,
    confirm: s.confirm === 'explain' || s.confirm === 'patterns' ? s.confirm : '',
    confirmTick: typeof s.confirmTick === 'number' ? s.confirmTick : -100,
    patternsOpen: s.patternsOpen !== false,
    zone: s.zone === 'caption' || s.zone === 'tabs' ? s.zone : 'content',
    barAt: num(s.barAt),
    traceFocus: typeof s.traceFocus === 'string' ? s.traceFocus : null,
    traceJump: s.traceJump === true,
    traceLane: typeof s.traceLane === 'string' ? s.traceLane : null,
    tquery: typeof s.tquery === 'string' ? s.tquery : '',
    mark: typeof s.mark === 'string' ? s.mark : null,
    compare: Array.isArray(s.compare) && s.compare.length === 2 && s.compare.every(x => typeof x === 'string') ? [s.compare[0]!, s.compare[1]!] : null,
    exportSeen: num(s.exportSeen),
  }
}

const duration = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}
// a ruler's relative time: 0:30, 4:00, 1:05:00
const offset = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`
}
const clock = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const clockSec = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })
const baseName = (p: string) => p.split('/').filter(Boolean).pop() ?? p
// 3,520 rather than 3520: counts read faster with separators
const num = (n: number) => n.toLocaleString('en-US')

// The status line's bar: ▰ filled, ▱ empty, rounded to the nearest cell.
export function bar(done: number, total: number, width: number): { filled: string; empty: string; pct: number } {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const full = Math.min(width, Math.round((pct * width) / 100))
  return { filled: '▰'.repeat(full), empty: '▱'.repeat(Math.max(0, width - full)), pct }
}

// A roll-up bar split by status, in cells: done, failed or stopped, then running.
export function statusCells(c: { done: number; failed: number; stopped: number; running: number; total: number }, width: number) {
  if (c.total === 0) return { done: 0, bad: 0, running: width }
  const done = Math.round((c.done / c.total) * width)
  const bad = Math.min(width - done, Math.max(c.failed + c.stopped > 0 ? 1 : 0, Math.round(((c.failed + c.stopped) / c.total) * width)))
  return { done, bad, running: width - done - bad }
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

// What a selection is, as a key any lens can find again.
const keyOf = (it: Item | undefined): string | null =>
  it?.kind === 'node' ? it.node.id : it?.kind === 'phase' ? `phase:${JSON.stringify([it.wfId, it.phase])}` : null
const scopeOfKey = (key: string | null, nodes: AgentNode[]): Scope | undefined => {
  if (!key) return undefined
  if (key.startsWith('phase:')) {
    try {
      const [wfId, phase] = JSON.parse(key.slice(6)) as [string, string]
      return { kind: 'phase', wfId, phase }
    } catch { return undefined }
  }
  return nodes.some(n => n.id === key) ? { kind: 'node', id: key } : undefined
}

const ACT_WORD: Record<Act, string> = { think: 'thinking', read: 'reading', write: 'writing', run: 'running', web: 'web' }
const COLUMN_NAMES: Record<Column, [string, string]> = { running: ['RUNNING', 'RUNNING'], done: ['DONE', 'DONE'], failed: ['FAILED OR STOPPED', 'FAILED'] }

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
    const here = folderKey(props.repo)
    return props.history.filter(n => runKey(top(n)) === here)
  })()
  const noRepoRuns = props.history.filter(n => !n.parentId && !runKey(n)).length
  const isHistory = s.tab === 'history'
  const nodes = isHistory ? repoHistory : props.nodes
  const allNodes = [...props.nodes, ...props.history]
  const run = s.path ? nodes.find(n => n.id === s.path) : undefined
  const isInWorkflow = (n: AgentNode) => !!n.parentId && nodes.some(p => p.id === n.parentId && p.kind === 'workflow')
  // a trace needs a run open; on the run list the lens falls back to the tree
  const lens: Lens = s.lens === 'trace' && !run ? 'tree' : s.lens
  const offered = lensesFor(!!run)
  const nextLensOf = (l: Lens) => offered[(offered.indexOf(l) + 1) % offered.length] ?? 'tree'

  // ── AI-written blocks: who wrote them, what it cost, how old they are ───────
  const aiLabel = (b: { model?: string; tokens?: number; at?: number } | undefined): string =>
    !b?.model ? '' : [b.model, ...(b.tokens ? [`${kTokens(b.tokens)} tokens`] : []), ...(b.at ? [ago(now - b.at)] : [])].join(' · ')
  const isFull = props.ai === 'full'
  // Patterns across runs, above the day groups: a heading, then per card its title, evidence,
  // what to try and the runs it rests on (those rows open the run). Width: the list's.
  const historyRunCount = props.history.filter(n => !n.parentId).length
  const patternItems = (): Item[] => {
    if (s.query || s.hfilter !== 'all') return []
    const doc = props.patterns
    const busy = !!props.patternsBusy
    if (!doc && !busy && (!isFull || historyRunCount < 2)) return []
    const note = busy ? `writing… (Sonnet)` : doc ? `${aiLabel(doc)}${isFull ? '   ·   g g writes them again' : ''}` : 'g asks Sonnet to look for patterns'
    const head: Item = { kind: 'header', text: PATTERNS_TITLE, note, ...(doc ? { isOpen: s.patternsOpen } : {}) }
    if (!doc || !s.patternsOpen) return [head]
    const w = Math.max(20, (layout === 'split' ? LW : IW) - 6)
    const out: Item[] = [head]
    for (const c of doc.cards) {
      out.push({ kind: 'pattern', tone: 'title', text: c.title })
      if (c.evidence) for (const t of wrap(c.evidence, w)) out.push({ kind: 'pattern', tone: 'evidence', text: t })
      if (c.try) wrap(`Try: ${c.try}`, w).forEach(t => out.push({ kind: 'pattern', tone: 'try', text: t }))
      for (const r of c.runs) {
        const node = props.history.find(n => n.id === r.id)
        if (node) out.push({ kind: 'node', node, species: 'cat', depth: 1, guide: 'pattern' })
      }
    }
    return out
  }

  // ── the three lenses over the same runs ───────────────────────────────
  // the History page lists runs by day, filtered and searched; inside a run, its tree
  const listFor = (flipped: readonly string[], showDone: readonly string[], at: AgentNode | undefined): Item[] =>
    at ? runTree(at, nodes, s.filter, flipped, showDone)
      : isHistory ? [...patternItems(), ...historyItems(nodes, now, { filter: s.hfilter, query: s.query, olderOpen: s.olderOpen })]
        : topItems(nodes, s.filter, isHistory, now, s.group, flipped, showDone)
  const agentItems: Item[] = listFor(s.flipped, s.showDone, run)
  // the runs the run list shows, in its order, for the board and the timeline
  const topRuns = topItems(nodes, s.filter, isHistory, now, 'none').flatMap(it => (it.kind === 'node' ? [it.node] : []))
  const lanes: Lane[] = boardLanes(run, nodes, topRuns, s.filter)
  const laneCells = lanes.map(l => COLUMNS.map(col => l.cards.filter(n => columnOf(n) === col)))
  // a board's cards in reading order: lane by lane, column by column, the first few of each cell
  const boardCards = laneCells.flatMap(cells => cells.flatMap(list => list.slice(0, CARDS_PER_CELL)))
  const timeRows: TimeRow[] = timelineRows(run, nodes, topRuns, s.filter)
  const timeCards = timeRows.flatMap(r => (r.kind === 'bar' ? [r.node] : []))
  const cards = lens === 'board' ? boardCards : lens === 'timeline' ? timeCards : []

  // ── what the screen is about ─────────────────────────────────────────
  const view: ViewName = run ? s.view : 'agents'
  const inAgents = view === 'agents'
  // two runs side by side, when both are still kept
  const pair = s.compare ? s.compare.map(id => allNodes.find(n => n.id === id)) : []
  const comparing = pair.length === 2 && pair.every(Boolean)
  const mode: 'help' | 'compare' | 'agents' | 'board' | 'timeline' | 'trace' | 'files' | 'diff' | 'output' = s.help ? 'help'
    : comparing ? 'compare'
    : inAgents ? (lens === 'tree' ? 'agents' : lens)
      : view === 'output' ? 'output' : s.diffFile !== null ? 'diff' : 'files'
  const asked = Math.min(Math.max(0, inAgents ? s.sel : s.agentSel), Math.max(0, agentItems.length - 1))
  const snap = [asked, ...agentItems.map((_, i) => i).filter(i => i > asked), ...agentItems.map((_, i) => i).filter(i => i < asked).reverse()]
  const agentSel = snap.find(i => isSelectable(agentItems[i])) ?? asked
  const cardSel = Math.min(Math.max(0, s.sel), Math.max(0, cards.length - 1))
  const focusItem = lens === 'tree' ? agentItems[agentSel] : undefined
  const focusCard = lens !== 'tree' ? cards[cardSel] : undefined
  // the key of what is selected in the agents view now
  const focusKey = lens === 'tree' ? keyOf(focusItem) : focusCard?.id ?? null
  const scope: Scope | undefined = inAgents
    ? (scopeOfKey(focusKey, nodes) ?? (run ? { kind: 'node', id: run.id } : undefined))
    : (scopeOfKey(s.focus, nodes) ?? (run ? { kind: 'node', id: run.id } : undefined))
  const scopeList = scope ? scopeNodes(nodes, scope) : []
  const scopeNode = scope?.kind === 'node' ? nodes.find(n => n.id === scope.id) : undefined
  const files = fileRows(scopeList)
  const names = shortPaths(files.map(f => f.path))
  const scopeIds = new Set(scopeList.map(n => n.id))
  const diffOpen = mode === 'diff'

  const fileItems: FileItem[] = files.map(row => ({ row }))
  const blocks: DiffBlock[] = (() => {
    if (!diffOpen || props.diff?.path !== s.diffFile) return []
    return props.diff.edits.filter(r => scopeIds.has(r.agentId)).map(rec => {
      const lines = lineDiff(rec.old, rec.new, rec.line)
      return { rec, hunks: unifiedHunks(lines), ...diffCounts(lines) }
    })
  })()

  // what needs a look: inside a run, everything under it; on the run list, what is live
  const shownInsights: Insight[] = run ? insights(scopeNodes(nodes, { kind: 'node', id: run.id }), nodes, now)
    : !isHistory ? insights(props.nodes, props.nodes, now) : []
  // the same insights on the rows they are about, inside a run
  const flags: Map<string, Flag> = run ? rowFlags(scopeNodes(nodes, { kind: 'node', id: run.id }), nodes, now) : new Map()
  // where a run's time went, on its timeline: the chain that set its end, and the idle time
  const crit = run && lens === 'timeline' ? criticalPath(timeCards, now) : undefined
  const onPath = new Set(crit?.ids ?? [])
  const idle = run && lens === 'timeline' ? idleGaps(timeCards, now) : { gaps: [], ms: 0 }

  // ── pieces ───────────────────────────────────────────────────────────
  const outcome = (n: AgentNode) => n.summary ?? (n.kind === 'workflow' ? firstSentence(readableResult(n.result)) : firstSentence(n.result))
  const elapsed = (n: Pick<AgentNode, 'status' | 'startedAt' | 'endedAt'>) => (n.status === 'running' ? now : n.endedAt ?? now) - n.startedAt
  const statusIcon = (n: Pick<AgentNode, 'status'>) => (n.status === 'running' && !pulse ? T.runningAlt : T.status[n.status].icon)
  const statusSegs = (n: Pick<AgentNode, 'status' | 'startedAt' | 'endedAt'>, extra?: string): Seg[] => {
    const st = T.status[n.status]
    return [seg(statusIcon(n), st.color), seg(' '), seg(st.word, st.color, true),
      seg('   '), seg(duration(elapsed(n)), C.muted), ...(extra ? [seg('   '), seg(extra, C.muted)] : [])]
  }
  // a roll-up bar split by status: done, failed or stopped, still running
  const rollSegs = (c: ReturnType<typeof counts>, w: number): Seg[] => {
    const cells = statusCells(c, w)
    return [seg(T.bar.full.repeat(cells.done), C.ok), seg(T.bar.full.repeat(cells.bad), C.bad), seg(T.bar.empty.repeat(cells.running), C.warn)]
  }
  const changeSegs = (rows: FileRow[]): Seg[] => {
    if (rows.length === 0) return [seg('None', C.muted)]
    const added = rows.reduce((a, r) => a + r.added, 0)
    const removed = rows.reduce((a, r) => a + r.removed, 0)
    return [seg(`${rows.length} file${rows.length === 1 ? '' : 's'}`, C.accent), seg('   '), seg(`+${num(added)}`, C.add), seg(' '), seg(`−${num(removed)}`, C.del)]
  }
  // tokens by model family: "Opus 120k (2) · Sonnet 40k (5)"
  const spendSegs = (scope: AgentNode[]): Seg[] => spendByModel(scope).flatMap((m, i) => [
    ...(i ? [seg('  ·  ', C.faint)] : []), seg(m.model, C.soft), seg(` ${kTokens(m.tokens)}`, C.ink), seg(` (${m.agents})`, C.faint)])
  const nowSegs = (n: AgentNode): Seg[] => [seg('› ', C.accent), seg(n.activity ?? 'Thinking', C.ink), seg(`   ${ACT_WORD[n.act ?? 'think']}`, C.faint)]
  const quietFor = (n: AgentNode) => (n.status === 'running' ? now - (n.lastToolAt ?? n.startedAt) : 0)
  // a cluster's aspects as chips: each member's short task with how it went
  const chipSegs = (groupId: string, w: number): Seg[] => {
    const list = aspects(nodes, groupId)
    if (!list.length) return []
    const each = Math.max(6, Math.floor(w / list.length) - 5)
    const out: Seg[] = []
    let used = 0
    for (let i = 0; i < list.length; i++) {
      const { node, text } = list[i]!
      const piece: Seg[] = [...(i ? [seg('   ')] : []), seg(statusIcon(node), T.status[node.status].color), seg(' '), seg(fit(text, each), C.soft)]
      const rest = list.length - i - 1
      if (used + width(piece) + (rest ? 8 : 0) > w && i > 0) { out.push(seg(`   +${list.length - i}`, C.faint)); break }
      out.push(...piece)
      used += width(piece)
    }
    return out
  }
  const overlapSegs = (groupId: string): Seg[] => {
    const o = overlaps(scopeNodes(nodes, { kind: 'node', id: groupId }).filter(k => k.id !== groupId))[0]
    if (!o) return []
    const more = overlaps(scopeNodes(nodes, { kind: 'node', id: groupId }).filter(k => k.id !== groupId)).length - 1
    return [seg(`${T.warn} `, C.warn), seg(`${baseName(o.path)} edited by ${o.by.length} members`, C.warn), seg(` (${o.by.map(b => b.label).join(', ')})`, C.muted),
      ...(more > 0 ? [seg(`   +${more} more file${more === 1 ? '' : 's'}`, C.faint)] : [])]
  }

  // ── the report: Result, Parts or Done, Decisions, Problems, Next, Changed, Totals ──
  // The words are the model's; Changed and Totals come from the mod's own records.
  type Section = [string, Seg[][]]
  const pmSegs = (added: number, removed: number): Seg[] => [seg(`+${num(added)}`, C.add), seg(' '), seg(`−${num(removed)}`, C.del)]
  const phaseStatus = (p: { running: number; failed: number; stopped: number }) =>
    p.failed ? T.status.failed : p.running ? T.status.running : p.stopped ? T.status.killed : T.status.done
  // one line per part: a workflow's phases, or a cluster's members
  // `all` (the Output view) wraps each part's outcome under itself; the overview cuts it to one line
  const partRows = (n: AgentNode, w: number, all = false): Seg[][] => {
    const line = (glyph: { icon: string; color: string }, name: string, nameW: number, count: string, outcome: string, files: FileRow[]): Seg[][] => {
      const added = files.reduce((a, f) => a + f.added, 0)
      const removed = files.reduce((a, f) => a + f.removed, 0)
      const pm = files.length ? pmSegs(added, removed) : []
      const head: Seg[] = [seg(padEnd(glyph.icon, 2), glyph.color), seg(' '), seg(padEnd(fit(name, nameW), nameW), C.ink, true), ...(count ? [seg(`  ${count}`, C.muted)] : [])]
      const room = Math.max(8, w - width(head) - 2 - (pm.length ? width(pm) + 2 : 0))
      const lines = all ? wrap(outcome, room) : [fit(outcome, room)]
      return lines.map((said, i) => i === 0
        ? [...head, seg('  '), seg(said, C.soft), seg(' '.repeat(Math.max(0, room - cellWidth(said)))), ...(pm.length ? [seg('  '), ...pm] : [])]
        : [seg(' '.repeat(width(head) + 2)), seg(said, C.soft)])
    }
    if (n.kind === 'workflow') {
      const ps = pipeline(n, nodes)
      const nameW = Math.min(14, Math.max(4, ...ps.map(p => cellWidth(p.phase))))
      return ps.flatMap(p => line(phaseStatus(p), p.phase, nameW, padStart(`${p.total} agent${p.total === 1 ? '' : 's'}`, 9),
        n.partReports?.[p.phase]?.result ?? phaseWords(p), fileRows(scopeNodes(nodes, { kind: 'phase', wfId: n.id, phase: p.phase }))))
    }
    if (n.kind === 'group') {
      const kids = childrenOf(nodes, n.id).sort((a, b) => a.startedAt - b.startedAt)
      const nameW = Math.min(30, Math.max(8, ...kids.map(k => cellWidth(k.label))))
      return kids.flatMap(k => line(T.status[k.status], k.label, nameW, '', outcomeOf(k) || noReportReason(k), fileRows(scopeNodes(nodes, { kind: 'node', id: k.id }))))
    }
    return []
  }
  const changedRows = (f: Facts, w: number, all: boolean): Seg[][] => {
    const short = shortPaths(f.files.map(x => x.path))
    if (all) {
      const nameW = Math.min(w - 16, Math.max(...f.files.map(x => cellWidth(short.get(x.path) ?? x.path))))
      return f.files.map(x => [seg(padEnd(fit(short.get(x.path) ?? x.path, nameW), nameW), C.ink), seg('   '), ...pmSegs(x.added, x.removed)])
    }
    const out: Seg[] = []
    let shown = 0
    for (const x of f.files) {
      const piece: Seg[] = [...(shown ? [seg('  ·  ', C.faint)] : []), seg(short.get(x.path) ?? x.path, C.ink), seg(' '), ...pmSegs(x.added, x.removed)]
      const rest = f.files.length - shown - 1
      if (width(out) + width(piece) + (rest ? 10 : 0) > w && shown) break
      out.push(...piece)
      shown++
    }
    if (shown < f.files.length) out.push(seg(`  ·  +${f.files.length - shown} more`, C.faint))
    return [out]
  }
  const plural = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`
  const totalsRows = (f: Facts, w: number): Seg[][] => {
    const parts: Seg[][] = [
      ...(f.phases ? [[seg(plural(f.phases, 'phase'), C.soft)]] : []),
      [seg(plural(f.agents, 'agent'), C.soft)],
      [seg(plural(f.files.length, 'file'), C.soft)],
      ...(f.files.length ? [pmSegs(f.added, f.removed)] : []),
      [seg(duration(f.ms), C.soft)],
      ...(f.tokens ? [[seg(`${kTokens(f.tokens)} tokens`, C.soft)]] : []),
    ]
    const lines: Seg[][] = [[]]
    for (const p of parts) {
      const cur = lines[lines.length - 1]!
      const piece = [...(cur.length ? [seg('  ·  ', C.faint)] : []), ...p]
      if (cur.length && width(cur) + width(piece) > w) lines.push([...p])
      else cur.push(...piece)
    }
    return lines
  }
  // `all`: the Output view's full block; otherwise lists and long text are capped for the
  // overview; `brief` keeps only Result, Problems, Next and Totals, for a pane short of rows
  const reportSections = (sc: Scope, valueW: number, all: boolean, brief = false): Section[] => {
    const node = sc.kind === 'node' ? nodes.find(x => x.id === sc.id) : undefined
    const wf = sc.kind === 'phase' ? nodes.find(x => x.id === sc.wfId) : undefined
    const r = sc.kind === 'phase' ? wf?.partReports?.[sc.phase] : node ? reportOf(node) : undefined
    const f = reportFacts(nodes, sc, now)
    const text = (t: string, c: string): Seg[][] => wrap(t, valueW).slice(0, all ? 99 : brief ? 2 : 3).map(l => [seg(l, c)])
    const bullets = (items: { text: string; source?: string }[], c: string): Seg[][] => items.slice(0, 3).flatMap(it =>
      wrap(`${it.text}${it.source ? ` [${it.source}]` : ''}`, valueW - 3).slice(0, all ? 99 : 2).map((l, i) => [seg(i ? '   ' : '•  ', C.faint), seg(l, c)]))
    const out: Section[] = []
    const aiOff = props.ai === 'off' && !r?.result
    const fallback = aiOff ? 'AI is off: no written report. Set ai to cheap or full in /config.'
      : sc.kind === 'phase' ? 'No part report yet.' : node ? noReportReason(node) : ''
    out.push(['Result', text(r?.result ?? fallback, aiOff ? C.muted : C.ink)])
    // with AI off the failures still show, from the records
    const recordProblems = aiOff ? scopeNodes(nodes, sc).filter(n => n.kind === 'agent' && (n.status === 'failed' || n.status === 'killed'))
      .map(n => ({ text: `${n.label} ${n.status === 'failed' ? 'failed' : 'was stopped'}.` })) : []
    if (brief) {
      if (r?.problems?.length) out.push(['Problems', r.problems.slice(0, 2).map(p => [seg('•  ', C.faint), seg(fit(`${p.text}${p.source ? ` [${p.source}]` : ''}`, valueW - 3), C.warn)])])
      if (r?.next) out.push(['Next', [[seg(fit(r.next, valueW), C.soft)]]])
      out.push(['Totals', totalsRows(f, valueW)])
      return out
    }
    const parts = node ? partRows(node, valueW, all) : []
    if (parts.length) {
      const cap = all ? parts.length : 6
      out.push(['Parts', [...parts.slice(0, cap), ...(parts.length > cap ? [[seg(`+${parts.length - cap} more parts`, C.faint)]] : [])]])
    } else if (r?.done?.length) out.push(['Done', bullets(r.done.map(t => ({ text: t })), C.soft)])
    if (r?.decisions?.length) out.push(['Decisions', bullets(r.decisions, C.soft)])
    if (r?.problems?.length) out.push(['Problems', bullets(r.problems, C.warn)])
    else if (recordProblems.length) out.push(['Problems', bullets(recordProblems, C.warn)])
    if (r?.next) out.push(['Next', text(r.next, C.soft)])
    if (f.files.length) out.push(['Changed', changedRows(f, valueW, all)])
    out.push(['Totals', totalsRows(f, valueW)])
    return out
  }
  const sectionRows = (secs: Section[]): Row[] =>
    secs.flatMap(([name, lines]) => lines.map((l, i) => ({ segs: [seg(padEnd(i ? '' : name, 11), C.muted), ...l] })))
  // who wrote a report, beside its heading
  const writtenBy = (sc: Scope): string => {
    const r = sc.kind === 'phase' ? nodes.find(x => x.id === sc.wfId)?.partReports?.[sc.phase] : nodes.find(x => x.id === sc.id)?.report
    if (r?.model) return aiLabel(r)
    return props.ai === 'off' ? 'AI is off · from records' : 'from what the run kept'
  }

  // ── the overview of the selection, as rows of a given width ───────────
  const overview = (w: number, dense: 'compact' | 'brief' | 'full'): Row[] => {
    if (!scope) return []
    const title = scope.kind === 'phase' ? `${scope.phase} phase` : scopeNode?.label ?? ''
    const when = (n: AgentNode) => (isHistory ? clock(n.startedAt) : undefined)
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
      second = [...rollSegs(c, 12), seg(`   ${c.total - c.running} of ${c.total} agents`, C.muted)]
      const spend = spendSegs(scopeList)
      rows = [['Agents', [seg(phaseWords({ phase: scope.phase, ...c }), C.ink)]], ['Changes', changeSegs(files)], ...(spend.length ? [['Spend', spend] as [string, Seg[]]] : []), ['Part of', [seg(wf?.label ?? 'workflow', C.soft)]]]
    } else if (scopeNode && scopeNode.kind !== 'agent') {
      const n = scopeNode
      const kids = childrenOf(nodes, n.id)
      const c = counts(kids)
      const busy = kids.find(x => x.status === 'running')
      meta = statusSegs(n, when(n))
      second = [...rollSegs(c, 12), seg(`   ${c.total - c.running} of ${c.total} ${n.kind === 'group' ? 'members' : 'agents'}`, C.muted)]
      const phases: Seg[] = pipeline(n, nodes).flatMap((p, i) => [...(i ? [seg('  →  ', C.faint)] : []), seg(p.phase, C.ink), seg(`  ${phaseWords(p)}`, C.muted)])
      const inline = mode === 'agents' && n.kind === 'group' && (dense !== 'full' || layout !== 'split')
      const overlap = n.kind === 'group' && !inline ? overlapSegs(n.id) : []
      rows = [
        n.kind === 'group' ? ['Agents', [seg(phaseWords({ phase: '', ...c }), C.ink)]] : ['Phases', phases],
        ...(n.kind === 'group' && !inline ? [['Aspects', chipSegs(n.id, w - 11)] as [string, Seg[]]] : []),
        ...(overlap.length ? [['Overlap', overlap] as [string, Seg[]]] : []),
        ['Changes', changeSegs(files)],
        ...(spendSegs(scopeList).length ? [['Spend', spendSegs(scopeList)] as [string, Seg[]]] : []),
        n.status === 'running' && busy ? ['Now', [...nowSegs(busy), seg(`   ${busy.label}`, C.muted)]] : ['Outcome', [seg(outcome(n) || '—', C.ink)]],
      ]
      points = n.points ?? []
    } else if (scopeNode) {
      const n = scopeNode
      const inWf = isInWorkflow(n)
      meta = statusSegs(n, when(n))
      second = [seg([prettyType(n, inWf), prettyModel(n.model), inWf && n.phase ? `${n.phase} phase` : n.where && n.where !== 'main' ? whereLabel(n.where) : ''].filter(Boolean).join('   ·   '), C.muted)]
      const quiet = quietFor(n)
      rows = [
        n.status === 'running' ? ['Now', [...nowSegs(n), ...(quiet >= 120_000 ? [seg(`   ${T.warn} quiet ${duration(quiet)}`, C.warn)] : [])]] : ['Outcome', [seg(outcome(n) || noReportReason(n), C.ink)]],
        ['Changes', changeSegs(files)],
        ['Work', [seg(`${workSummary(n)}${n.tokens ? `   ·   ${Math.round(n.tokens / 1000)}k tokens` : ''}`, C.soft)]],
      ]
      points = n.points ?? []
    }
    // finished work shows its report: the model's words, then what changed and the totals from records
    const isFinished = scope.kind === 'phase' ? counts(scopeList).running === 0 && scopeList.length > 0 : !!scopeNode && scopeNode.status !== 'running'
    const secs = isFinished ? reportSections(scope, w - 11, false, dense === 'brief') : undefined
    const out: Row[] = []
    if (dense === 'compact') {
      const changed = files.length ? changeSegs(files) : []
      const titleW = Math.max(8, w - width(changed) - 3)
      const shownTitle = fit(title, titleW)
      out.push({ segs: [seg(shownTitle, C.ink, true), seg(' '.repeat(Math.max(3, w - cellWidth(shownTitle) - width(changed)))), ...changed] })
      const what = scope.kind === 'node' && scopeNode?.kind === 'agent' ? second : rows[0]?.[1] ?? []
      out.push({ segs: [...meta, ...(what.length ? [seg('   ·   ', C.faint), ...what] : [])] })
      const result = secs?.find(([k]) => k === 'Result')?.[1][0]
      const [name, value] = result ? ['Result', result] : rows.find(([k]) => k === 'Now' || k === 'Outcome') ?? rows[0] ?? ['', []]
      out.push({ segs: [seg(padEnd(name, 10), C.muted), ...value] })
      return out
    }
    for (const line of wrap(title, w).slice(0, dense === 'brief' ? 1 : 2)) out.push({ segs: [seg(line, C.ink, true)] })
    out.push({ segs: meta })
    if (dense !== 'brief') { out.push({ segs: second }); out.push({ segs: [] }) }
    if (secs) {
      // a parent keeps its one status line ("6 done"); the report follows
      const status = scope.kind === 'phase' || scopeNode?.kind !== 'agent' ? rows.filter(([k]) => k === 'Agents' || k === 'Phases' || k === 'Spend') : []
      for (const [name, value] of status) out.push({ segs: [seg(padEnd(name, 11), C.muted), ...value] })
      out.push(...sectionRows(secs))
      if (scopeNode?.kind === 'agent') out.push(...rows.filter(([k]) => k === 'Work').map(([name, value]) => ({ segs: [seg(padEnd(name, 11), C.muted), ...value] })))
      return out
    }
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
    // finished work opens with its whole report; the agents' own words follow
    const reportBlock = (sc: Scope) => {
      out.push({ segs: [seg('Report', C.accent, true), seg(`   ${writtenBy(sc)}`, C.faint)] })
      out.push(...sectionRows(reportSections(sc, w - 11, true)))
      gap()
    }
    if (scope?.kind === 'phase') {
      if (scopeList.length && counts(scopeList).running === 0) reportBlock(scope)
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
    // the run's brief, when it has one or one is being written; else how to get one
    if (run && n.id === run.id) {
      const writing = props.explaining?.includes(run.id)
      const b: Brief | undefined = run.explain
      if (b || writing) {
        out.push({ segs: [seg('Explain', C.accent, true), seg(`   ${writing ? 'writing… (Sonnet)' : aiLabel(b)}`, C.faint)] })
        if (b) {
          const LBL = 18
          const vw = Math.max(10, w - LBL)
          const line = (name: string, t: string, c: string) => wrap(t, vw).forEach((x, i) => out.push({ segs: [seg(padEnd(i ? '' : name, LBL), C.muted), seg(x, c)] }))
          const list = (name: string, items: string[], c: string) => items.forEach((t, k) => wrap(t, vw - 3).forEach((x, i) =>
            out.push({ segs: [seg(padEnd(k === 0 && i === 0 ? name : '', LBL), C.muted), seg(i ? '   ' : '•  ', C.faint), seg(x, c)] })))
          if (b.goal) line('Goal', b.goal, C.ink)
          if (b.who?.length) list('Who did what', b.who, C.soft)
          if (b.connected) line('How it connected', b.connected, C.soft)
          if (b.outcome) line('Outcome', b.outcome, C.ink)
          if (b.open?.length) list('Open issues', b.open, C.warn)
        }
        gap()
      } else if (isFull) {
        out.push({ segs: [seg('e', C.soft, true), seg(' asks Sonnet to explain how this run hung together.', C.faint)] })
        gap()
      }
    }
    const isDone = n.status !== 'running'
    if (isDone && scope) reportBlock(scope)
    if (!isDone && n.summary) { para('Outcome', C.accent, true); para(n.summary, C.ink) }
    if (!isDone && n.points?.length) { gap(); para('Key points', C.accent, true); n.points.forEach(p => para(`•  ${p}`, C.soft)) }
    if (n.kind !== 'agent') {
      if (!isDone) gap()
      para(n.kind === 'group' ? 'Members' : 'Agents', C.accent, true)
      for (const k of childrenOf(nodes, n.id)) para(`${k.phase ? `${k.phase}  ·  ` : ''}${k.label} — ${k.summary ?? (firstSentence(k.result, 160) || noReportReason(k))}`, C.soft)
    }
    const report = n.kind === 'workflow' ? readableResult(n.result) : n.result
    if (report) {
      gap(); para(n.kind === 'workflow' ? 'Final result' : 'Full report', C.accent, true)
      for (const line of report.split('\n')) para(plain(line) || ' ', C.muted)
    }
    if (!isDone && !report && !n.summary) para('Still working — the report appears here when it finishes.', C.muted)
    const task = taskText(n.prompt)
    if (task) { gap(); para('Task it was given', C.accent, true); para(task, C.muted) }
    return out
  }

  // ── two runs side by side: totals, phases, spend by model, files ──────
  const compareRows = (w: number): Row[] => {
    if (mode !== 'compare') return []
    const [a, b] = pair as [AgentNode, AgentNode]
    const cmp = compareRuns(allNodes, a, b, now)
    const out: Row[] = []
    const gap = () => out.push({ segs: [] })
    const fmt = (m: Metric, v: number | undefined) => (v === undefined ? '—' : m.measure === 'ms' ? duration(v) : m.measure === 'tokens' ? kTokens(v) : num(v))
    const nameW = Math.min(16, Math.max(8, ...[...cmp.totals, ...cmp.phases, ...cmp.models].map(m => cellWidth(m.name)))) + 2
    const colW = Math.max(9, Math.min(14, Math.floor((w - nameW - 18) / 2)))
    const change = (m: Metric): Seg => {
      const v = verdict(m)
      if (m.a === undefined || m.b === undefined) return seg(m.a === undefined ? 'only in B' : 'only in A', C.faint)
      if (m.a === m.b) return seg('same', C.faint)
      const d = m.b - m.a
      const pct = m.a ? ` (${d > 0 ? '+' : ''}${Math.round((d / m.a) * 100)}%)` : ''
      const abs = m.measure === 'ms' ? duration(Math.abs(d)) : m.measure === 'tokens' ? kTokens(Math.abs(d)) : num(Math.abs(d))
      return seg(`${d > 0 ? '+' : '−'}${abs}${pct}`, v === 'better' ? C.ok : v === 'worse' ? C.bad : C.muted)
    }
    const table = (title: string, list: Metric[]) => {
      if (!list.length) return
      out.push({ segs: [seg(padEnd(title, nameW), C.accent, true), seg(padStart('A', colW), C.muted, true), seg(padStart('B', colW), C.muted, true), seg('   change', C.muted, true)] })
      for (const m of list) out.push({ segs: [seg(padEnd(fit(m.name, nameW - 2), nameW), C.soft), seg(padStart(fmt(m, m.a), colW), C.ink), seg(padStart(fmt(m, m.b), colW), C.ink), seg('   '), change(m)] })
      gap()
    }
    const who = (k: string, n: AgentNode) => [seg(`${k}  `, C.accent, true), seg(statusIcon(n), T.status[n.status].color), seg(' '), seg(n.label, C.ink, true), seg(`   ${dayLabel(n.startedAt, now)} ${clock(n.startedAt)}`, C.muted)]
    out.push({ segs: who('A', a) }, { segs: who('B', b) })
    gap()
    table('Totals', cmp.totals)
    table('Phases', cmp.phases)
    table('Tokens by model', cmp.models)
    const files = (title: string, list: string[]) => {
      if (!list.length) return
      const short = shortPaths(list)
      out.push({ segs: [seg(title, C.accent, true), seg(`  ${list.length}`, C.faint)] })
      wrap(list.map(p => short.get(p) ?? p).join('  ·  '), w - 3).slice(0, 6).forEach(l => out.push({ segs: [seg('   '), seg(l, C.soft)] }))
    }
    files('Files only A changed', cmp.files.onlyA)
    files('Files only B changed', cmp.files.onlyB)
    files('Files both changed', cmp.files.both)
    if (!cmp.files.onlyA.length && !cmp.files.onlyB.length && !cmp.files.both.length) out.push({ segs: [seg('Neither run changed files.', C.muted)] })
    return out
  }

  // ── insights: one row on narrow panes, up to two on wide ones ─────────
  const insightRows = (w: number): Row[] => {
    if (!shownInsights.length || mode === 'help') return []
    const piece = (it: Insight, i: number): Seg[] => {
      const on = i === s.insight
      const mark = it.tone === 'bad' ? T.status.failed.icon : it.tone === 'warn' ? T.warn : '·'
      const color = it.tone === 'bad' ? C.bad : it.tone === 'warn' ? C.warn : C.soft
      return [seg(`${mark} `, color), seg(it.text, on ? C.accent : color, on)]
    }
    const label = [seg(layout === 'compact' ? '' : 'Needs a look   ', C.muted, true)]
    const rows: Row[] = []
    let cur: Seg[] = [...label]
    let hits: Hit[] = []
    const maxRows = layout === 'compact' ? 1 : 2
    for (let i = 0; i < shownInsights.length; i++) {
      const p = [...(width(cur) > width(label) ? [seg('     ')] : []), ...piece(shownInsights[i]!, i)]
      const rest = shownInsights.length - i
      const tail = rows.length + 1 === maxRows && rest > 1 ? 14 : 0
      if (width(cur) + width(p) + tail > w && width(cur) > width(label)) {
        if (rows.length + 1 === maxRows) { cur.push(seg(`   +${rest} more · i`, C.faint)); break }
        rows.push({ segs: cur, hit: hits })
        cur = [seg(' '.repeat(width(label)))]
        hits = []
        i--
        continue
      }
      const x0 = width(cur)
      const target = shownInsights[i]!
      const idx = i
      hits.push({ x0, x1: x0 + width(p), act: () => jumpTo(target.target, idx) })
      cur.push(...p)
    }
    rows.push({ segs: cur, hit: hits })
    return rows
  }

  // ── fixed blocks: top rows, the body, bottom rows ─────────────────────
  const isReading = mode === 'output' || mode === 'diff' || mode === 'help' || mode === 'trace' || mode === 'compare'
  // the History page's numbers on top, and the search line while there is one
  const isHistoryPage = isHistory && !run && lens === 'tree'
  // runs that match, not the runs a pattern card points at
  const matchCount = isHistoryPage ? agentItems.filter(it => it.kind === 'node' && it.guide !== 'pattern').length : 0
  const historyHeader = (): Row[] => {
    const st = historyStats(nodes, now)
    const sp = sparkline(st.perDay)
    // the numbers first; then what the AI layer spent; the sparkline's caption only where it fits
    const base: Seg[] = [seg(`${st.runs}`, C.ink, true), seg(` run${st.runs === 1 ? '' : 's'}`, C.muted), seg('     '),
      seg(`${st.okPct}%`, C.ink, true), seg(' finished OK', C.muted), seg('     '),
      seg(kTokens(st.tokens), C.ink, true), seg(' tokens', C.muted), seg('     '), seg(sp.glyphs, C.accent)]
    // the sparkline's scale keeps its place (a chart needs its extremes); AI spend fits around it
    const spent = props.aiWeek ?? 0
    const longCap = `  runs per day, last 7 days · 0 to ${sp.max}`
    const shortCap = `  per day, 7 days · 0 to ${sp.max}`
    const longAi = spent ? `     AI: ${kTokens(spent)} tokens this week` : ''
    const shortAi = spent ? `   AI ${kTokens(spent)} this week` : ''
    const [cap, ai] = ([[longCap, longAi], [shortCap, longAi], [shortCap, shortAi], [shortCap, ''], ['', '']] as [string, string][])
      .find(([c, a]) => width(base) + cellWidth(c) + cellWidth(a) <= IW) ?? ['', '']
    const rows: Row[] = [{ segs: [...base, ...(cap ? [seg(cap, C.faint)] : []), ...(ai ? [seg(ai, C.faint)] : [])] }]
    if (s.searching || s.query) {
      rows.push({
        segs: [seg('/ ', C.accent, true), seg(s.query, C.ink, true), ...(s.searching ? [seg(T.cursor, C.accent)] : []),
          seg(`   ${matchCount} match${matchCount === 1 ? '' : 'es'}`, C.muted),
          seg(s.searching ? '   enter keep · ctrl+u clear · ⌫ delete' : '   / edit · ctrl+u clear', C.faint)],
      })
    }
    return rows
  }
  const strip = isHistoryPage && mode !== 'help' ? historyHeader() : insightRows(IW)
  const fullOverview = (() => {
    // History's rows carry each run's result; a run's report shows beside them from 140 columns
    if (layout === 'split' || isReading || isHistoryPage) return []
    if (layout === 'compact') return overview(IW, 'compact')
    // the whole report when the list keeps 10 rows; else its brief form; else three lines
    const rowsLeft = (o: Row[]) => CH - 1 - 1 - (strip.length ? strip.length + 1 : 0) - 1 - 2 - (o.length + 1)
    const full = overview(IW, 'full')
    if (rowsLeft(full) >= 10) return full
    const brief = overview(IW, 'brief')
    return rowsLeft(brief) >= 8 ? brief : overview(IW, 'compact')
  })()
  const TOP = 1 + 1 + (strip.length ? strip.length + 1 : 0) + (fullOverview.length ? fullOverview.length + 1 : 0) + 1 // tabs, rule, insights + rule, overview + rule, caption
  const BOTTOM = 2 // rule, keys
  const bodyRows = Math.max(1, CH - TOP - BOTTOM)
  const isSplit = layout === 'split' && (mode === 'agents' || mode === 'files' || mode === 'board' || mode === 'timeline')
  const listW = isSplit ? LW : IW
  const output = outRows(IW)
  const comparison = compareRows(IW)
  // the views that scroll as text, a page at a time
  const isText = mode === 'output' || mode === 'compare' || mode === 'help'

  // ── the board and the timeline: rows built at a width, cards placed on them ──
  type Body = { rows: Row[]; cardRow: number[] }
  const cursorSeg = (on: boolean) => seg(on ? T.cursor : ' ', C.accent)
  const cell2 = (g: string, c?: string) => seg(padEnd(g, 2), c)
  const emptyRows = (w: number): Row[] => [
    { segs: [] },
    { segs: [seg(' '), seg(isHistory ? T.words.emptyHistory : T.words.emptyLive, C.ink)] },
    { segs: [] },
    ...wrap(isHistory ? 'Finished subagents and workflows are kept here across sessions.' : T.words.emptyHint, w - 2).map(t => ({ segs: [seg(' '), seg(t, C.muted)] })),
  ]
  const cardMeta = (n: AgentNode): Seg[] => {
    const quiet = quietFor(n)
    if (n.status === 'running' && quiet >= 120_000) return [seg(`${T.warn} quiet ${duration(quiet)}`, C.warn)]
    const rows = fileRows([n])
    const added = rows.reduce((a, r) => a + r.added, 0)
    const removed = rows.reduce((a, r) => a + r.removed, 0)
    return [seg(duration(elapsed(n)), C.muted), ...(rows.length ? [seg('   '), seg(`+${added}`, C.add), seg(' '), seg(`−${removed}`, C.del)] : []),
      ...(n.status === 'running' && n.activity ? [seg(`   ${n.activity}`, C.faint)] : [])]
  }
  const boardBody = (w: number): Body => {
    const rows: Row[] = []
    const cardRow: number[] = []
    const gap = 2
    const colW = Math.floor((w - gap * 2) / 3)
    const narrow = colW < 22
    const totals = COLUMNS.map((_, ci) => laneCells.reduce((a, cells) => a + cells[ci]!.length, 0))
    rows.push({
      segs: COLUMNS.flatMap((col, ci) => {
        const color = col === 'running' ? T.status.running.color : col === 'done' ? T.status.done.color : T.status.failed.color
        return [...(ci ? [seg(' '.repeat(gap))] : []), seg(padEnd(fit(`${COLUMN_NAMES[col][narrow ? 1 : 0]} ${totals[ci]}`, colW), colW), color, true)]
      }),
    })
    if (!lanes.length) return { rows: [...rows, ...emptyRows(w)], cardRow }
    let k = 0
    lanes.forEach((lane, li) => {
      const cells = laneCells[li]!
      const c = counts(lane.cards)
      const glyph = lane.kind === 'cluster' ? T.kind.group : lane.kind === 'workflow' ? T.kind.workflow : ''
      rows.push({ segs: [] })
      rows.push({ segs: [...(glyph ? [seg(`${glyph} `)] : []), seg(lane.title, C.ink, true), seg('   '), ...rollSegs(c, 6), seg(`  ${c.total - c.running}/${c.total}`, C.muted)] })
      const idx = cells.map(list => list.slice(0, CARDS_PER_CELL).map(() => k++))
      const depth = Math.min(CARDS_PER_CELL, Math.max(...cells.map(l => l.length)))
      for (let r = 0; r < depth; r++) {
        const line1: Seg[] = []
        const line2: Seg[] = []
        const hits: Hit[] = []
        let x = 0
        cells.forEach((list, ci) => {
          if (ci) { line1.push(seg(' '.repeat(gap))); line2.push(seg(' '.repeat(gap))); x += gap }
          const n = list[r]
          if (!n) { line1.push(seg(' '.repeat(colW))); line2.push(seg(' '.repeat(colW))); x += colW; return }
          const at = idx[ci]![r]!
          const on = mode === 'board' && at === sel
          const bg = on ? C.selBg : undefined
          line1.push(...lay([cursorSeg(on), seg(statusIcon(n), T.status[n.status].color), seg(' '), seg(n.label, on ? C.ink : C.soft, on)], colW).map(sg => ({ ...sg, bg })))
          line2.push(...lay([seg('   '), ...cardMeta(n)], colW).map(sg => ({ ...sg, bg })))
          hits.push({ x0: x, x1: x + colW, act: () => pickCard(at) })
          cardRow[at] = rows.length
          x += colW
        })
        rows.push({ segs: line1, hit: hits })
        rows.push({ segs: line2, hit: hits })
      }
      const extra = cells.map(list => Math.max(0, list.length - CARDS_PER_CELL))
      if (extra.some(Boolean)) {
        rows.push({ segs: cells.flatMap((_, ci) => [...(ci ? [seg(' '.repeat(gap))] : []), seg(padEnd(extra[ci] ? `  +${extra[ci]} more` : '', colW), C.faint)]) })
      }
    })
    return { rows, cardRow }
  }
  const timeBody = (w: number): Body => {
    const rows: Row[] = []
    const cardRow: number[] = []
    if (!timeCards.length) return { rows: [{ segs: [] }, ...emptyRows(w)], cardRow }
    const labelW = Math.min(32, Math.max(16, Math.floor(w * 0.34)))
    const durW = 8
    const barW = Math.max(10, w - labelW - durW - 2)
    const t0 = Math.min(...timeCards.map(n => n.startedAt))
    const t1 = Math.max(t0 + 1000, ...timeCards.map(n => n.endedAt ?? now))
    const span = t1 - t0
    const xOf = (t: number) => Math.round(((t - t0) / span) * barW)
    // the ruler: times since the first start, spaced so labels never touch
    const ruler = new Array<string>(barW).fill(' ')
    const ticks = Math.max(1, Math.min(5, Math.floor(barW / 12)))
    for (let i = 0; i <= ticks; i++) {
      const label = offset((i / ticks) * span)
      const x = Math.round((i / ticks) * (barW - 1))
      const at = Math.max(0, Math.min(barW - label.length, i === ticks ? x - label.length + 1 : x))
      for (let j = 0; j < label.length; j++) ruler[at + j] = label[j]!
    }
    // left of the ruler, inside a run: how long the critical path took, and the idle share
    const pathNote = crit ? `━ critical ${duration(crit.ms)}${idle.ms && crit.span ? ` · idle ${Math.round((idle.ms / crit.span) * 100)}%` : ''}` : ''
    rows.push({ segs: [seg(padEnd(fit(pathNote, labelW), labelW), C.accent), seg(' '), seg(ruler.join(''), C.faint), seg(' '.repeat(durW + 1))] })
    // idle stretches shade every row with dots, as a column
    const idleAt = new Array<boolean>(barW).fill(false)
    for (const g of idle.gaps) for (let x = Math.max(0, xOf(g.from)); x < Math.min(barW, xOf(g.to)); x++) idleAt[x] = true
    let k = 0
    for (const r of timeRows) {
      if (r.kind === 'label') { rows.push({ segs: [seg('  '), seg(r.text, C.muted, true)] }); continue }
      const n = r.node
      const at = k++
      const on = mode === 'timeline' && at === sel
      const color = T.status[n.status].color
      const x0 = Math.min(barW - 1, xOf(n.startedAt))
      const x1 = Math.max(x0 + 1, Math.min(barW, xOf(n.endedAt ?? now)))
      const isLive = n.status === 'running'
      // with a critical path, its bars are heavy and the others light
      const isCrit = onPath.has(n.id)
      const line = !crit || isCrit ? '━' : '─'
      const quiet = quietFor(n)
      const flag = flags.get(n.id)
      const tag = isLive ? (quiet >= 120_000 ? ` quiet ${duration(quiet)}` : ' running') : flag ? ` ${flag.text}` : ''
      const tagShown = tag && barW - x1 >= cellWidth(tag) ? tag : ''
      const tagColor = isLive ? (quiet >= 120_000 ? C.warn : C.faint) : flag?.tone === 'warn' ? C.warn : C.faint
      // the bar's cells: idle dots, the bar, then its tag
      const cells: Seg[] = []
      const put = (t: string, c?: string) => { const last = cells[cells.length - 1]; if (last && last.c === c) last.t += t; else cells.push({ t, c }) }
      for (let x = 0; x < x0; x++) put(idleAt[x] ? '·' : ' ', idleAt[x] ? C.rule : undefined)
      put(isLive ? `${line.repeat(Math.max(0, x1 - x0 - 1))}▸` : line.repeat(x1 - x0), color)
      if (tagShown) put(tagShown, tagColor)
      for (let x = x1 + cellWidth(tagShown); x < barW; x++) put(idleAt[x] ? '·' : ' ', idleAt[x] ? C.rule : undefined)
      const label = lay([cursorSeg(on), seg(' '), cell2(statusIcon(n), color), seg(' '), seg(n.label, on || isLive || isCrit ? C.ink : C.soft, on || isCrit)], labelW)
      rows.push({
        bg: on ? C.selBg : undefined,
        segs: [...label, seg(' '), ...cells, seg(' '), seg(padStart(duration(elapsed(n)), durW), C.muted)],
        hit: [{ x0: 0, x1: w, act: () => pickCard(at) }],
      })
      cardRow[at] = rows.length - 1
    }
    return { rows, cardRow }
  }

  // ── selection, scrolling ─────────────────────────────────────────────
  const isLens = mode === 'board' || mode === 'timeline'
  // the trace the hooks sent for this run at this zoom; its rows are a window of all of them
  // (cut to the lane asked for; while a search is typed the rows stay, and only the hits wait)
  const tq = s.tquery.trim().slice(0, 80)
  const tv: TraceView | undefined = mode === 'trace' && run && props.trace?.run === run.id && props.trace.zoom === s.zoom && (props.trace.lane ?? null) === s.traceLane ? props.trace : undefined
  // the rows n and p step through: the search's hits while there is a search, else what needs a look
  const traceStops = tv ? (tq ? (tv.query === tq ? tv.hits ?? [] : []) : tv.marks ?? []) : []
  // under the trace: two pinned rows above (legend, lanes), a rule and two detail rows below
  const traceWin = mode === 'trace' ? Math.max(1, bodyRows - 5) : 0
  const count = mode === 'agents' ? agentItems.length : mode === 'files' ? fileItems.length : mode === 'diff' ? blocks.length
    : mode === 'output' ? output.length : mode === 'compare' ? comparison.length : mode === 'help' ? KEYS_HELP_COUNT : isLens ? cards.length : mode === 'trace' ? tv?.total ?? 0 : 0
  const okRow = (i: number) => (mode === 'agents' ? isSelectable(agentItems[i]) : true)
  const rawSel = mode === 'agents' ? agentSel : isLens ? cardSel : s.sel
  const sel = isText ? 0 : Math.min(Math.max(0, rawSel), Math.max(0, count - 1))
  const body: Body | undefined = mode === 'board' ? boardBody(listW) : mode === 'timeline' ? timeBody(listW) : undefined
  // the diff scrolls by edit block, the selected one at the top; the board and the
  // timeline by rows under their pinned first row, keeping the selected card in sight
  let first = isText ? s.first : mode === 'diff' ? sel : Math.min(s.first, sel)
  if (body) {
    const win = Math.max(1, bodyRows - 1)
    const total = body.rows.length - 1
    const top = (body.cardRow[sel] ?? 1) - 1
    const tall = mode === 'board' ? 2 : 1
    first = Math.min(s.first, total)
    if (top < first) first = Math.max(0, top - (mode === 'board' ? 2 : 0))
    if (top + tall > first + win) first = top + tall - win
    first = Math.max(0, Math.min(first, Math.max(0, total - win)))
  } else {
    const win = mode === 'trace' ? traceWin : bodyRows
    if (!isText && mode !== 'diff' && sel >= first + win) first = sel - win + 1
    if (mode !== 'diff') first = Math.max(0, Math.min(first, Math.max(0, count - win)))
  }

  // ── actions ──────────────────────────────────────────────────────────
  const set = (patch: Partial<State>) => surface.setState({ ...s, sel, first, ...patch })
  const toggleIn = (list: string[], key: string) => (list.includes(key) ? list.filter(k => k !== key) : [...list, key])
  const closeDiff = () => { surface.post({ type: 'diff', path: null }); return { diffFile: null } }
  const topOf = (n: AgentNode) => { let x = n; while (x.parentId) { const p = nodes.find(m => m.id === x.parentId); if (!p) break; x = p } return x }
  const cardsFor = (at: AgentNode | undefined, l: Lens) => {
    if (l === 'board') return boardLanes(at, nodes, topRuns, s.filter).flatMap(lane => COLUMNS.flatMap(col => lane.cards.filter(n => columnOf(n) === col).slice(0, CARDS_PER_CELL)))
    return timelineRows(at, nodes, topRuns, s.filter).flatMap(r => (r.kind === 'bar' ? [r.node] : []))
  }
  // where a key sits in a lens's list, so a selection survives a change of view
  const indexIn = (key: string | null, at: AgentNode | undefined, l: Lens, flipped = s.flipped, showDone = s.showDone): number => {
    // a trace comes back to the row it was left on
    if (l === 'trace') return s.traceAt
    if (!key) return -1
    if (l === 'tree') return listFor(flipped, showDone, at).findIndex(it => keyOf(it) === key)
    return cardsFor(at, l).findIndex(n => n.id === key)
  }
  const go = (v: ViewName, extra: Partial<State> = {}) => {
    if (!run || v === view) return
    const keep = inAgents ? { agentSel: sel, focus: focusKey } : {}
    const leaving = diffOpen ? closeDiff() : {}
    const back = v === 'agents' ? Math.max(0, indexIn(s.focus, run, lens)) : 0
    set({ ...keep, ...leaving, ...extra, view: v, sel: v === 'agents' ? (inAgents ? sel : back) : 0, first: 0 })
  }
  const openRun = (n: AgentNode, v: ViewName = 'agents', focus: string | null = null) =>
    set({ path: n.id, view: v, sel: v === 'agents' ? Math.max(0, indexIn(focus, n, lens)) : 0, first: 0, agentSel: 0, focus, diffFile: null })
  const openDiff = (path: string) => { surface.post({ type: 'diff', path }); set({ diffFile: path, sel: 0, first: 0 }) }
  // Opens what hides a node in a run's tree: its phase, the done agents folded
  // under it, and any parent that was closed.
  const reveal = (n: AgentNode, at: AgentNode) => {
    let flipped = [...s.flipped]
    let showDone = [...s.showDone]
    for (let x: AgentNode | undefined = nodes.find(m => m.id === n.parentId); x; x = nodes.find(m => m.id === x!.parentId)) {
      flipped = flipped.filter(k => k !== `o:${x.id}`)
      if (x.id === at.id) break
    }
    const wf = nodes.find(m => m.id === n.parentId && m.kind === 'workflow')
    if (wf && n.phase) {
      const key = `${wf.id}:${n.phase}`
      const phaseRow = listFor(flipped, showDone, at).find(it => it.kind === 'phase' && it.key === key)
      if (phaseRow?.kind === 'phase' && !phaseRow.isOpen) flipped = toggleIn(flipped, key)
      const shown = listFor(flipped, showDone, at).some(it => it.kind === 'node' && it.node.id === n.id)
      if (!shown && !showDone.includes(key)) showDone = [...showDone, key]
    }
    return { flipped, showDone }
  }
  // From a change, or an insight, to the agent it names, in the tree.
  const showInTree = (id: string, extra: Partial<State> = {}) => {
    const n = nodes.find(x => x.id === id)
    if (!n) return
    const at = topOf(n)
    if (!run && at.id === n.id && n.kind === 'agent') {
      const i = listFor(s.flipped, s.showDone, undefined).findIndex(it => it.kind === 'node' && it.node.id === id)
      return set({ ...extra, lens: 'tree', sel: Math.max(0, i) })
    }
    const { flipped, showDone } = reveal(n, at)
    const i = listFor(flipped, showDone, at).findIndex(it => it.kind === 'node' && it.node.id === id)
    if (diffOpen) surface.post({ type: 'diff', path: null })
    surface.setState({ ...s, ...extra, path: at.id, view: 'agents', lens: 'tree', diffFile: null, flipped, showDone, sel: Math.max(0, i), agentSel: Math.max(0, i), first: Math.max(0, i - 2) })
  }
  const jumpTo = (id: string | undefined, idx: number) => {
    if (!id) return set({ insight: idx })
    if (isLens && inAgents) {
      const i = cards.findIndex(c => c.id === id)
      if (i >= 0) return set({ sel: i, insight: idx })
    }
    showInTree(id, { insight: idx })
  }
  const toggleFold = (it: Item | undefined, open?: boolean) => {
    if (it?.kind === 'node' && it.fold && open !== it.fold.isOpen) return set({ flipped: toggleIn(s.flipped, it.fold.key) }), true
    if (it?.kind === 'phase' && open !== it.isOpen) return set({ flipped: toggleIn(s.flipped, it.key) }), true
    if (it?.kind === 'more' && open !== false) return set({ showDone: toggleIn(s.showDone, it.key) }), true
    return false
  }
  const activateCard = (i: number) => {
    const n = cards[i]
    if (!n) return
    if (!run) return openRun(topOf(n), 'agents', n.id)
    set({ agentSel: i, focus: n.id, view: 'output', sel: 0, first: 0 })
  }
  const pickCard = (i: number) => (i === sel ? activateCard(i) : set({ sel: i }))
  // a trace row, when the window the hooks sent holds it
  const traceRow = (i: number): TraceRow | undefined => (tv && i >= tv.offset && i < tv.offset + tv.rows.length ? tv.rows[i - tv.offset] : undefined)
  const laneId = (r: TraceRow | undefined) => (r && tv ? tv.lanes[r.lane]?.id : undefined)
  // Enter on a trace row: an edit opens its diff; any other row shows its agent in the tree
  const activateTrace = (i: number) => {
    const r = traceRow(i)
    const id = laneId(r)
    if (!r || !run) return
    if (r.kind === 'edit' && r.path) {
      const focus = id && id !== 'main' ? id : run.id
      surface.post({ type: 'diff', path: r.path })
      return set({ view: 'changes', diffFile: r.path, focus, agentSel: 0, traceAt: i, sel: 0, first: 0 })
    }
    if (id && id !== 'main') showInTree(id, { traceAt: i })
  }
  const activate = (i = sel) => {
    if (mode === 'agents') {
      const it = agentItems[i]
      if (!it) return
      if (!run && it.kind === 'node') return openRun(topOf(it.node), 'agents', it.node.id)
      if (it.kind === 'phase' || it.kind === 'more') return toggleFold(it)
      if (it.kind === 'node') return go('output')
    } else if (isLens) {
      activateCard(i)
    } else if (mode === 'trace') {
      activateTrace(i)
    } else if (mode === 'files') {
      const it = fileItems[i]
      if (it) openDiff(it.row.path)
    } else if (mode === 'diff') {
      const b = blocks[i]
      if (b) showInTree(b.rec.agentId)
    }
  }
  const back = () => {
    if (s.help) return set({ help: false })
    if (mode === 'compare') return set({ compare: null, sel: 0, first: 0 })
    if (mode === 'diff') return set({ ...closeDiff(), sel: Math.max(0, fileItems.findIndex(f => f.row.path === s.diffFile)), first: 0 })
    if (run && view !== 'agents') return go('agents')
    if (!run) return
    const at = lens === 'tree' ? indexIn(run.id, undefined, 'tree') : 0
    set({ path: null, view: 'agents', sel: Math.max(0, at), first: 0, focus: null })
  }
  // in a replay the History tab leads back to the History page
  const switchTab = (tab: Tab, extra: Partial<State> = {}) => (tab === s.tab && run && tab === 'history' ? back()
    : tab !== s.tab && set({ ...extra, tab, path: null, view: 'agents', sel: 0, first: 0, diffFile: null, focus: null, insight: -1, compare: null }))
  // A change of lens keeps what is picked: the trace opens on the picked agent's lane,
  // and leaving the trace picks the agent of the row it was on.
  const switchLens = (l: Lens, extra: Partial<State> = {}) => {
    const leaving = diffOpen ? closeDiff() : {}
    const fromTrace = mode === 'trace' ? laneId(traceRow(sel)) : undefined
    const key = fromTrace && fromTrace !== 'main' ? fromTrace : mode === 'trace' ? s.traceFocus : inAgents ? focusKey : s.focus
    const agent = key ? nodes.find(n => n.id === key && n.kind === 'agent') : undefined
    const toTrace = l === 'trace' && !!run
    // the tree opens what hides the agent: its phase, a folded parent
    const opened = l === 'tree' && run && agent && agent.id !== run.id ? reveal(agent, run) : { flipped: s.flipped, showDone: s.showDone }
    set({
      ...leaving, ...extra, lens: l, view: 'agents', first: 0, ...opened,
      sel: toTrace ? (agent ? 0 : s.traceAt) : Math.max(0, indexIn(key, run, l, opened.flipped, opened.showDone)),
      ...(mode === 'trace' ? { traceAt: sel, traceFocus: agent?.id ?? null } : {}),
      ...(toTrace ? { traceFocus: agent?.id ?? null, traceJump: !!agent, traceLane: null, tquery: '' } : {}),
    })
  }
  const confirming = (what: 'explain' | 'patterns') => s.confirm === what && s.tick - s.confirmTick <= CONFIRM_TICKS
  const say = (note: string, extra: Partial<State> = {}) => set({ ...extra, note, noteTick: s.tick })
  // e: a run's brief from Sonnet. With one there, a second press within 3 s writes it again.
  const explainKey = () => {
    if (!run) return
    const leaving = diffOpen ? closeDiff() : {}
    const toOutput: Partial<State> = { ...leaving, view: 'output', focus: run.id, agentSel: 0, sel: 0, first: 0 }
    if (!isFull) return say('Explain needs ai: full in /config. It asks Sonnet, on demand.')
    if (props.explaining?.includes(run.id)) return say('Sonnet is writing the brief.', toOutput)
    if (run.explain && !confirming('explain')) return say('Press e again to write a new brief (Sonnet).', { ...toOutput, confirm: 'explain', confirmTick: s.tick })
    surface.post({ type: 'explain', run: run.id, regenerate: !!run.explain })
    say(run.explain ? 'Writing a new brief… (Sonnet)' : 'Writing the brief… (Sonnet)', { ...toOutput, confirm: '' })
  }
  // g on the History page: patterns across runs from Sonnet; twice within 3 s to write them again.
  const patternsKey = () => {
    if (!isFull) return say('Patterns need ai: full in /config. They ask Sonnet, on demand.')
    if (props.patternsBusy) return say('Sonnet is looking for patterns.')
    if (props.patterns && !confirming('patterns')) return say('Press g again to look for patterns again (Sonnet).', { confirm: 'patterns', confirmTick: s.tick, patternsOpen: true })
    surface.post({ type: 'patterns', regenerate: !!props.patterns })
    say('Looking for patterns… (Sonnet)', { confirm: '', patternsOpen: true, sel: 0, first: 0 })
  }
  const nextFile = (dir: 1 | -1) => {
    const f = fileItems[fileItems.findIndex(x => x.row.path === s.diffFile) + dir]
    if (f) openDiff(f.row.path)
  }
  // ← and → open and close the tree, as file trees do, and ← goes up to the parent.
  // They never leave the content: tabs and views switch only from a bar (↑ at the top).
  const arrow = (dir: 1 | -1) => {
    if (mode === 'agents') {
      const it = agentItems[sel]
      if (toggleFold(it, dir > 0)) return
      if (dir < 0 && it && (it.kind === 'node' || it.kind === 'phase' || it.kind === 'more') && 'guide' in it && it.guide) {
        // up to the row it hangs from
        const myX = (it.guide ?? '').length
        for (let j = sel - 1; j >= 0; j--) {
          const p = agentItems[j]
          if (p && (p.kind === 'node' || p.kind === 'phase') && (p.guide ?? '').length < myX) return set({ sel: j })
        }
      }
    }
  }
  const moveBy = (by: number): Partial<State> => {
    if (isText) return { first: Math.max(0, Math.min(first + by, count - bodyRows)) }
    let at = sel
    for (let k = 0; k < Math.abs(by); k++) at = step(count, at, by > 0 ? 1 : -1, okRow)
    return { sel: at }
  }
  const move = (dir: 1 | -1) => set(moveBy(dir))

  // A wheel move the hooks forwarded: applied once, as j/k would be.
  const wheel = props.wheel ?? { seq: 0, by: 0 }
  const wheelPending = surface.state !== undefined && s.wheelSeen !== wheel.seq
  if (wheelPending) {
    surface.setState({ ...s, sel, first, wheelSeen: wheel.seq, ...(s.wheelSeen >= 0 && wheel.by ? moveBy(Math.sign(wheel.by) * Math.min(3, Math.abs(wheel.by))) : {}) })
  }

  // The trace's rows come from the hooks: ask for the run and zoom, and for a new
  // window when reading moves past the one held; ask again after 2 s if nothing came
  // (a reload drops what the hooks held). Leaving the trace lets it go.
  // the hooks say where a picture went (or why it did not): once, in the footer
  const exportNote = props.exported && surface.state !== undefined && !wheelPending && props.exported.seq !== s.exportSeen ? props.exported : undefined
  if (exportNote) surface.setState({ ...s, sel, first, note: exportNote.text, noteTick: s.tick, exportSeen: exportNote.seq })
  if (surface.state !== undefined && !wheelPending && !exportNote) {
    if (mode === 'trace' && run) {
      const holds = !!tv && (tv.query ?? '') === tq && first >= tv.offset && (first + traceWin <= tv.offset + tv.rows.length || tv.offset + tv.rows.length >= tv.total)
      if (tv && s.traceJump) {
        // the trace has come: open it on the lane of the agent picked in the other lens
        const L = tv.lanes.find(l => l.id === s.traceFocus)
        const at = L && L.to >= L.from ? L.from : 0
        surface.setState({ ...s, sel: at, first: Math.max(0, at - 2), traceAt: at, traceJump: false })
      } else if (!holds) {
        const offset = Math.max(0, first - 20)
        const ask = `${run.id}|${s.zoom}|${offset}|${s.traceLane ?? ''}|${tq}`
        if (ask !== s.traceAsk || s.tick - s.traceAskTick >= 4) {
          surface.post({ type: 'trace', run: run.id, zoom: s.zoom, offset, ...(s.traceLane ? { lane: s.traceLane } : {}), ...(tq ? { query: tq } : {}) })
          surface.setState({ ...s, sel, first, traceAsk: ask, traceAskTick: s.tick })
        }
      }
    } else if (s.traceAsk) {
      surface.post({ type: 'trace', run: null })
      surface.setState({ ...s, sel, first, traceAsk: '' })
    }
  }

  // ── m and =: two runs side by side ────────────────────────────────────
  // the run a key is about: the open run, else the run the selection sits in
  const runOfSel = (): AgentNode | undefined => run ?? (focusItem?.kind === 'node' ? topOf(focusItem.node) : focusCard ? topOf(focusCard) : undefined)
  const markKey = () => {
    const target = runOfSel()
    if (!target) return say('Pick a run first, then press m.')
    if (!s.mark) return say(`Marked ${fit(target.label, 32)}. Press m on another run to compare.`, { mark: target.id })
    if (s.mark === target.id) return say('Mark cleared.', { mark: null })
    set({ compare: [s.mark, target.id], mark: null, sel: 0, first: 0, help: false, note: '' })
  }
  const lastRunKey = () => {
    const target = runOfSel()
    if (!target) return say('Pick a run first, then press =.')
    const prev = previousOf([...props.history, ...props.nodes], target)
    if (!prev) return say(`No earlier run of ${fit(target.label, 32)} is kept.`)
    set({ compare: [prev.id, target.id], mark: null, sel: 0, first: 0, note: '' })
  }
  // ── x: the open run's timeline or trace, saved as a picture by the hooks ──
  const exportKey = () => {
    if (!run || (mode !== 'timeline' && mode !== 'trace')) return say('x saves a picture of a run\'s Timeline or Trace: open a run, then v to one of them.')
    const focus = mode === 'trace' ? laneId(traceRow(sel)) : focusCard?.id
    surface.post({ type: 'export', run: run.id, lens: mode, zoom: s.zoom, ...(focus && focus !== 'main' ? { focus } : {}) })
    say('Drawing the picture…')
  }
  // ── the trace: n p step through what needs a look (or the search's hits), f one lane ──
  const traceStep = (dir: 1 | -1) => {
    const at = dir > 0 ? traceStops.find(i => i > sel) : [...traceStops].reverse().find(i => i < sel)
    if (at === undefined) return say(tq ? (traceStops.length ? 'No more matches that way.' : `Nothing in this trace says "${tq}".`) : traceStops.length ? 'Nothing more that way.' : 'No failures, errors or quiet gaps here.')
    set({ sel: at, first: Math.max(0, at - 3) })
  }
  const laneKey = () => {
    if (s.traceLane) return set({ traceLane: null, sel: 0, first: 0, traceJump: !!s.traceFocus })
    const id = laneId(traceRow(sel))
    if (!id) return
    set({ traceLane: id, traceFocus: id === 'main' ? s.traceFocus : id, sel: 0, first: 0 })
  }

  // ── the bars above the content, for a remote's ↑ ← → ↓ ─────────────────
  type BarItem = { label: string; on: boolean; act: (extra: Partial<State>) => void }
  const tabItems: BarItem[] = [
    { label: `Live ${props.nodes.filter(n => !n.parentId && n.status === 'running').length}`, on: s.tab === 'live', act: x => switchTab('live', x) },
    { label: `History ${repoHistory.filter(n => !n.parentId).length}`, on: s.tab === 'history', act: x => switchTab('history', x) },
  ]
  // the caption's views (inside a run) and lenses; a page with a caption of its own has none
  const captionItems: BarItem[] = mode === 'help' || mode === 'diff' || mode === 'compare' ? [] : [
    ...(run ? ([['Agents', 'agents'], [`Changes ${files.length}`, 'changes'], ['Output', 'output']] as [string, ViewName][])
      .map(([label, v]) => ({ label, on: view === v, act: (x: Partial<State>) => go(v, x) })) : []),
    ...offered.map(l => ({ label: LENS_NAMES[l], on: inAgents && lens === l, act: (x: Partial<State>) => switchLens(l, x) })),
  ]
  // a bar's cursor starts on its first chosen item: the open view, else the lens or the tab
  const activeIn = (items: BarItem[]) => Math.max(0, items.findIndex(it => it.on))
  const zone: Zone = s.zone === 'caption' && !captionItems.length ? 'tabs' : s.zone
  const barAt = Math.min(Math.max(0, s.barAt), Math.max(0, (zone === 'tabs' ? tabItems : captionItems).length - 1))
  // the first row of the content: ↑ there goes up to the bar
  const atTop = () => (isText ? first === 0 : mode === 'agents' ? step(count, sel, -1, okRow) === sel : sel === 0)
  const upToBar = () => set(captionItems.length ? { zone: 'caption', barAt: activeIn(captionItems) } : { zone: 'tabs', barAt: activeIn(tabItems) })

  surface.onKey(({ key, ctrl, meta }) => {
    // Escape never reaches a Client (it returns focus to the prompt), so ctrl+u clears the search.
    const clearsSearch = ctrl === true && key === 'u'
    // while the search line takes typing, every printable key goes to it: History's, or the trace's
    if (s.searching) {
      const inTrace = mode === 'trace'
      const field: 'tquery' | 'query' = inTrace ? 'tquery' : 'query'
      const text = s[field]
      const reset = inTrace ? {} : { sel: 0, first: 0 }
      if (key === 'return') {
        // the trace jumps to its first hit at or after the row it is on
        const hit = inTrace ? traceStops.find(i => i >= sel) ?? traceStops[0] : undefined
        return set({ searching: false, ...(hit !== undefined ? { sel: hit, first: Math.max(0, hit - 3) } : {}) })
      }
      if (clearsSearch) return set({ searching: false, [field]: '', ...reset })
      if (ctrl || meta) return
      if (key === 'escape') return set({ searching: false, [field]: '', ...reset })
      if (key === 'backspace' || key === 'delete') return text ? set({ [field]: text.slice(0, -1), ...reset }) : set({ searching: false })
      if (key === 'down') return move(1)
      if (key === 'up') return move(-1)
      const ch = key === 'space' ? ' ' : key
      if ([...ch].length === 1) return set({ [field]: text + ch, ...reset })
      return
    }
    // a bar has the keys: ← → switch, ↑ goes to the tabs, ↓ or enter back down to the content
    if (zone !== 'content' && !s.help) {
      const items = zone === 'tabs' ? tabItems : captionItems
      const moveBar = (dir: 1 | -1) => {
        const it = items[barAt + dir]
        if (!it) return
        if (it.on) set({ zone, barAt: barAt + dir })
        else it.act({ zone, barAt: barAt + dir })
      }
      if (key === 'left' || key === 'h') return moveBar(-1)
      if (key === 'right' || key === 'l') return moveBar(1)
      if (key === 'up' || key === 'k') return zone === 'caption' ? set({ zone: 'tabs', barAt: activeIn(tabItems) }) : undefined
      if (key === 'down' || key === 'j' || key === 'return') return zone === 'tabs' && captionItems.length ? set({ zone: 'caption', barAt: activeIn(captionItems) }) : set({ zone: 'content' })
      if (key === 'backspace' || key === 'b') return set({ zone: 'content' })
      // any other key does what it does in the content, and the content takes the keys back
      s.zone = 'content'
    }
    if (isHistoryPage && !s.help) {
      if (key === 'g') return patternsKey()
      if (key === 'p' && props.patterns) return set({ patternsOpen: !s.patternsOpen, sel: 0, first: 0 })
      if (key === '/') return set({ searching: true, sel: 0, first: 0 })
      if ((key === 'escape' || clearsSearch) && s.query) return set({ query: '', sel: 0, first: 0 })
      if (key === 'f') return set({ hfilter: HISTORY_FILTERS[(HISTORY_FILTERS.indexOf(s.hfilter) + 1) % HISTORY_FILTERS.length]!, sel: 0, first: 0 })
      if (key === 'o') return set({ olderOpen: !s.olderOpen })
    }
    if (mode === 'trace' && !s.help) {
      if (key === 'n') return traceStep(1)
      if (key === 'p') return traceStep(-1)
      if (key === 'f') return laneKey()
      if (key === '/') return set({ searching: true })
      if (clearsSearch && s.tquery) return set({ tquery: '' })
    }
    if (key === '?') return set({ help: !s.help, first: 0 })
    // the help scrolls; any other key closes it
    if (s.help) return key === 'j' || key === 'down' || key === 'k' || key === 'up' ? move(key === 'j' || key === 'down' ? 1 : -1)
      : key === 'pagedown' || key === 'pageup' ? set(moveBy((key === 'pagedown' ? 1 : -1) * Math.max(1, bodyRows - 1))) : set({ help: false, first: 0 })
    if (key === 'j' || key === 'down') move(1)
    else if (key === 'k' || key === 'up') (atTop() ? upToBar() : move(-1))
    else if (key === 'pagedown') set(moveBy(Math.max(1, bodyRows - 1)))
    else if (key === 'pageup') set(moveBy(-Math.max(1, bodyRows - 1)))
    else if (key === 'g' || key === 'home') set({ sel: 0, first: 0 })
    else if (key === 'G' || key === 'end') set({ sel: Math.max(0, count - 1), first: Math.max(0, count - bodyRows) })
    else if (key === 'return') activate()
    else if (key === ' ' || key === 'space') toggleFold(agentItems[sel])
    else if (key === 'left') arrow(-1)
    else if (key === 'right') arrow(1)
    else if (key === 'backspace' || key === 'b') back()
    else if (key === 'n') nextFile(1)
    else if (key === 'p') nextFile(-1)
    else if (key === '1') switchTab('live')
    else if (key === '2') switchTab('history')
    else if (key === 'a') go('agents')
    else if (key === 'c') (run ? go('changes') : (focusItem?.kind === 'node' || focusCard) && openRun(topOf(focusCard ?? (focusItem as { node: AgentNode }).node), 'changes', focusKey))
    else if (key === 'o') (run ? go('output') : (focusItem?.kind === 'node' || focusCard) && openRun(topOf(focusCard ?? (focusItem as { node: AgentNode }).node), 'output', focusKey))
    else if (key === 'tab') (run ? go(VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]!) : switchTab(s.tab === 'live' ? 'history' : 'live'))
    else if (key === 'v') switchLens(nextLensOf(lens))
    else if (key === 'e' && run) explainKey()
    else if (key === 'z' && mode === 'trace') set({ zoom: ZOOMS[(ZOOMS.indexOf(s.zoom) + 1) % ZOOMS.length]!, sel: 0, first: 0, traceAt: 0, traceJump: !!s.traceFocus })
    else if (key === 'i' && shownInsights.length) { const next = (s.insight + 1) % shownInsights.length; jumpTo(shownInsights[next]!.target, next) }
    else if (key === 'f') set({ filter: FILTERS[(FILTERS.indexOf(s.filter) + 1) % FILTERS.length], sel: 0, first: 0 })
    else if (key === 'r' && !run) set({ onlyRepo: !s.onlyRepo, sel: 0, first: 0 })
    else if (key === 's' && !run) set({ group: GROUPS[(GROUPS.indexOf(s.group) + 1) % GROUPS.length], sel: 0, first: 0 })
    else if (key === 'm') markKey()
    else if (key === '=') lastRunKey()
    else if (key === 'x') exportKey()
  })

  // ── rows of the tree ─────────────────────────────────────────────────
  const running = props.nodes.filter(n => !n.parentId && n.status === 'running').length
  const histTops = repoHistory.filter(n => !n.parentId)
  const today = histTops.filter(n => dayLabel(n.startedAt, now) === 'Today').length

  // the run list's columns: status · tree · label · roll-up or changes · start · duration
  const showMid = listW >= 60
  const showStart = listW >= 84
  // what each row spent: "Opus 120k" for an agent, the sum for what holds agents
  const showCost = listW >= 76
  const COST_W = 11
  const costSegs = (tokens: number, model?: string): Seg[] => {
    if (!showCost) return []
    const fam = model ? modelFamily(model) : ''
    // short counts, so a model name and its tokens fit the column: 9.5k, 12k, 1.2M
    const short = tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1)}M` : tokens >= 10_000 ? `${Math.round(tokens / 1000)}k` : tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)
    const text = tokens ? `${fam && fam !== 'Unknown' ? `${fam} ` : ''}${short}` : ''
    return [seg(' '), seg(padStart(fit(text, COST_W), COST_W), C.faint)]
  }
  const tailSegs = (n: AgentNode, isParent: boolean): Seg[] => {
    const kids = isParent ? scopeNodes(nodes, { kind: 'node', id: n.id }).filter(k => k.id !== n.id && k.kind === 'agent') : []
    const c = counts(kids)
    const rows = fileRows(scopeNodes(nodes, { kind: 'node', id: n.id }))
    const added = rows.reduce((a, r) => a + r.added, 0)
    const removed = rows.reduce((a, r) => a + r.removed, 0)
    const quiet = quietFor(n)
    const mid: Seg[] = !showMid ? []
      : isParent && kids.length ? [...rollSegs(c, 6), seg(' '), seg(padStart(`${c.total - c.running}/${c.total}`, 7), C.muted)]
        : n.status === 'running' && quiet >= 120_000 ? [seg(fit(`${T.warn} quiet ${duration(quiet)}`, 14), C.warn)]
          : n.status === 'running' ? [seg(fit(n.activity ?? 'Thinking', 14), C.warn)]
            : rows.length ? [seg(`+${added}`, C.add), seg(' '), seg(`−${removed}`, C.del)] : []
    return [
      ...(showMid ? [seg(' '), seg(' '.repeat(Math.max(0, 14 - width(mid)))), ...mid] : []),
      ...costSegs(tokensUnder(nodes, n), n.kind === 'agent' ? n.model : undefined),
      ...(showStart ? [seg(' '), seg(padStart(!run || isHistory ? clock(n.startedAt) : '', 8), C.faint)] : []),
      seg(' '), seg(padStart(duration(elapsed(n)), 8), C.muted),
    ]
  }
  const flagSegs = (f: Flag | undefined): Seg[] => (f ? [seg('  '), seg(f.text, f.tone === 'bad' ? C.bad : f.tone === 'warn' ? C.warn : C.faint)] : [])
  const agentRow = (it: Item, i: number, w: number): Row => {
    const on = i === sel && mode === 'agents'
    const bg = on ? C.selBg : undefined
    if (it.kind === 'header') return { segs: [seg(' '), seg(it.text, C.muted, true), seg(`  ${it.count}`, C.faint)] }
    const lead = (icon: string, color?: string): Seg[] => [cursorSeg(on), seg(' '), cell2(icon, color), seg(' ')]
    if (it.kind === 'info') {
      const content = it.tone === 'chips' ? chipSegs(it.nodeId, w - 5 - cellWidth(it.guide))
        : it.tone === 'warn' ? overlapSegs(it.nodeId)
          : [seg('Outcome  ', C.muted), seg(outcome(nodes.find(n => n.id === it.nodeId)!) ?? '', C.soft)]
      return { segs: [...lead(''), seg(it.guide, C.rule), ...content] }
    }
    if (it.kind === 'more') {
      return { bg, segs: [...lead(''), seg(it.guide ?? '', C.rule), seg(`… ${it.count} more finished agents`, C.muted), seg('   enter to list them', C.faint)] }
    }
    if (it.kind === 'phase') {
      const icon = it.failed ? T.status.failed : it.running ? T.status.running : T.status.done
      const c = { total: it.total, running: it.running, done: it.done, failed: it.failed, stopped: it.stopped }
      const words = phaseWords(it)
      const head: Seg[] = [...lead(icon.icon, icon.color), seg(it.guide ?? '', C.rule), seg(it.isOpen ? T.fold.open : T.fold.closed, C.muted), seg(' '), seg(it.phase, C.ink, true)]
      const inPhase = nodes.filter(k => k.parentId === it.wfId && (k.phase ?? 'Agents') === it.phase)
      const start = Math.min(...inPhase.map(k => k.startedAt))
      const end = it.running ? now : Math.max(...inPhase.map(k => k.endedAt ?? now))
      const tail: Seg[] = [
        ...(showMid ? [seg(' '), ...rollSegs(c, 6), seg(' '), seg(padStart(`${c.total - c.running}/${c.total}`, 7), C.muted)] : []),
        ...costSegs(scopeNodes(nodes, { kind: 'phase', wfId: it.wfId, phase: it.phase }).filter(k => k.kind === 'agent').reduce((a, k) => a + (k.tokens ?? 0), 0)),
        ...(showStart ? [seg(' '), seg(' '.repeat(8))] : []),
        seg(' '), seg(padStart(Number.isFinite(start) ? duration(end - start) : '', 8), C.muted),
      ]
      const flag = flagSegs(flags.get(`phase:${it.wfId}:${it.phase}`))
      const room = w - width(head) - width(tail) - width(flag)
      const mid = fit(`   ${words}`, Math.max(0, room))
      return { bg, segs: [...head, seg(mid, C.muted), ...flag, seg(' '.repeat(Math.max(0, room - cellWidth(mid)))), ...tail] }
    }
    if (it.kind !== 'node') return { segs: [] }
    const n = it.node
    const st = T.status[n.status]
    const isTop = !it.guide
    const glyph = kindGlyph(T, n)
    const head: Seg[] = [
      ...lead(statusIcon(n), st.color),
      seg(it.guide ?? '', C.rule),
      // what holds others folds; on the run list every row keeps the fold column, so labels line up
      ...(it.fold ? [seg(it.fold.isOpen ? T.fold.open : T.fold.closed, C.muted), seg(' ')] : isTop ? [seg('  ')] : []),
      ...(glyph ? [cell2(glyph), seg(' ')] : isTop && !run ? [seg('   ')] : []),
    ]
    const tail = tailSegs(n, !!it.fold || n.kind !== 'agent')
    // the run marked for a compare carries a mark; a row an insight is about carries its tag
    const marked = s.mark === n.id ? [seg('◉ ', C.accent, true)] : []
    const flag = flagSegs(flags.get(n.id))
    const labelW = Math.max(4, w - width(head) - width(tail) - width(marked) - width(flag))
    const shown = fit(n.label, labelW)
    const isLive = n.status === 'running'
    return {
      bg,
      segs: [...head, ...marked, seg(shown, isLive || on ? C.ink : C.soft, on || n.kind !== 'agent'), ...flag, seg(' '.repeat(Math.max(0, labelW - cellWidth(shown)))), ...tail],
    }
  }
  // History's columns: status · kind · name · outcome · ± · duration · tokens. Narrow
  // panes drop tokens first, then ±; the outcome shrinks, and goes when it gets too small.
  const historyRuns = isHistoryPage ? agentItems.flatMap(it => (it.kind === 'node' ? [it.node] : [])) : []
  const historyCols = (w: number) => {
    const showTok = w >= 100
    const showPm = w >= 84
    const avail = Math.max(10, w - 8 - 9 - (showPm ? 13 : 0) - (showTok ? 9 : 0))
    const longest = Math.min(44, Math.max(10, ...historyRuns.map(n => cellWidth(n.label))))
    let nameW = Math.min(longest, Math.max(16, avail - 14))
    let outW = avail - nameW - 2
    if (outW < 12) { outW = 0; nameW = avail }
    return { showTok, showPm, nameW, outW }
  }
  const historyRow = (it: Item, i: number, w: number): Row => {
    if (it.kind === 'header') {
      const folds = it.isOpen !== undefined
      const isPatterns = it.text === PATTERNS_TITLE
      const k = isPatterns ? 'p' : 'o'
      return {
        segs: [seg(' '), ...(folds ? [seg(`${it.isOpen ? T.fold.open : T.fold.closed} `, C.muted)] : []), seg(it.text, isPatterns ? C.accent : C.ink, true), seg(`   ${it.note ?? ''}`, C.faint),
          ...(folds ? [seg(it.isOpen ? `   ${k} hides them` : `   ${k} shows them`, C.faint)] : [])],
        ...(folds ? { hit: [{ x0: 0, x1: w, act: () => set(isPatterns ? { patternsOpen: !s.patternsOpen } : { olderOpen: !s.olderOpen }) }] } : {}),
      }
    }
    if (it.kind === 'pattern') {
      if (it.tone === 'title') return { segs: [seg('   '), seg(`${T.warn} `, C.warn), seg(it.text, C.ink, true)] }
      return { segs: [seg('     '), seg(it.text, it.tone === 'try' ? C.accent : C.soft)] }
    }
    if (it.kind !== 'node') return { segs: [] }
    if (it.guide === 'pattern') {
      // a run a pattern rests on: enter opens it
      const n = it.node
      const on = i === sel && mode === 'agents'
      return {
        bg: on ? C.selBg : undefined,
        segs: [cursorSeg(on), seg('     ↳ '), cell2(statusIcon(n), T.status[n.status].color), seg(' '), seg(n.label, on ? C.ink : C.soft, on), seg(`   ${dayLabel(n.startedAt, now)}`, C.faint)],
      }
    }
    const n = it.node
    const on = i === sel && mode === 'agents'
    const k = historyCols(w)
    const said = outcomeOf(n) || noReportReason(n)
    const rows = fileRows(scopeNodes(nodes, { kind: 'node', id: n.id }))
    const pm: Seg[] = rows.length ? pmSegs(rows.reduce((a, r) => a + r.added, 0), rows.reduce((a, r) => a + r.removed, 0)) : [seg('—', C.faint)]
    const tok = runTokens(nodes, n)
    const name = fit(`${s.mark === n.id ? '◉ ' : ''}${n.label}`, k.nameW)
    const out = k.outW ? fit(said, k.outW) : ''
    return {
      bg: on ? C.selBg : undefined,
      segs: [
        cursorSeg(on), seg(' '), cell2(statusIcon(n), T.status[n.status].color), seg(' '), cell2(kindGlyph(T, n)), seg(' '),
        seg(name, on ? C.ink : C.soft, on), seg(' '.repeat(Math.max(0, k.nameW - cellWidth(name)))),
        ...(k.outW ? [seg('  '), seg(out, C.muted), seg(' '.repeat(Math.max(0, k.outW - cellWidth(out))))] : []),
        ...(k.showPm ? [seg(' '), seg(' '.repeat(Math.max(0, 12 - width(pm)))), ...pm] : []),
        seg(' '), seg(padStart(duration(elapsed(n)), 8), C.muted),
        ...(k.showTok ? [seg(' '), seg(padStart(tok ? kTokens(tok) : '', 8), C.faint)] : []),
      ],
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

  // ── the trace: a vertical log with a lane gutter, git log --graph style ─────
  const KIND_WORD: Record<TraceRow['kind'], string> = {
    spawn: 'started an agent', tool: 'tool call', edit: 'edit', message: 'message', handback: 'handed back',
    report: 'reported', fail: 'ended', quiet: 'quiet gap', note: 'note', step: 'story step',
  }
  const laneColor = (k: number) => T.lanes[k % T.lanes.length]!
  const isArrow = (r: TraceRow) => r.to !== undefined && r.to !== r.lane && (r.kind === 'spawn' || r.kind === 'handback' || r.kind === 'report' || r.kind === 'message')
  const glyphOf = (r: TraceRow): string => {
    if (r.kind === 'fail') return T.traceFail
    if (r.kind === 'tool') return r.error ? '✗' : '●'
    if (r.kind === 'edit') return '◆'
    if (r.kind === 'spawn') return '▷'
    if (r.kind === 'message') return r.from ? '◁' : '▷'
    if (r.kind === 'handback') return '◀'
    if (r.kind === 'report') return '○'
    if (r.kind === 'quiet') return '┆'
    if (r.kind === 'step') return '◇'
    return '·'
  }
  const traceRows = (w: number): Row[] => {
    const lanes = tv?.lanes ?? []
    // the lanes draw as columns while they fit in two fifths of the width; else one column and chips
    const graph = w >= 80 && lanes.length > 0 && lanes.length * 2 <= Math.floor(w * 0.4)
    const t0 = run?.startedAt ?? 0
    const zoomSegs: Seg[] = [...ZOOMS.flatMap((z, k) => [...(k ? [seg(' · ', C.faint)] : []), seg(ZOOM_NAMES[z], z === s.zoom ? C.accent : C.muted, z === s.zoom)]), seg('   z', C.soft, true), seg(' zoom', C.muted)]
    const legendParts: Seg[][] = [[seg('●', C.soft), seg(' call', C.faint)], [seg('◆', C.soft), seg(' edit', C.faint)], [seg('├─▶', C.soft), seg(' start', C.faint)],
      [seg('◀─┤', C.soft), seg(' back', C.faint)], [seg('┄▶', C.soft), seg(' message', C.faint)], [seg(T.traceFail, C.bad), seg(' ended', C.faint)], [seg('┆', C.faint), seg(' quiet', C.faint)]]
    // the story's steps are Haiku's when it wrote them: say so, with what they cost
    if (s.zoom === 'story' && tv?.storyBy) zoomSegs.push(seg(`   Story · ${tv.storyBy}`, C.faint))
    const legend: Seg[] = [...zoomSegs]
    // while there is a search, its line stands where the legend was
    const found = tq && tv?.query === tq ? traceStops.length : undefined
    const searchSegs: Seg[] = [seg('/ ', C.accent, true), seg(s.tquery, C.ink, true), ...(s.searching ? [seg(T.cursor, C.accent)] : []),
      seg(found === undefined ? (tq ? '   …' : '') : `   ${found} match${found === 1 ? '' : 'es'}`, C.muted),
      seg(s.searching ? '   enter jump · ctrl+u clear' : '   n p next · ctrl+u clear', C.faint)]
    if (s.searching || tq) legend.push(seg('   '), ...searchSegs)
    else for (const part of legendParts) if (width(legend) + 3 + width(part) <= w - 1) legend.push(seg('   '), ...part)
    // the picked agent's lane stands out; a trace cut to one lane says so first
    const focusLane = lanes.findIndex(L => L.id === s.traceFocus)
    const only = s.traceLane ? lanes.find(L => L.id === s.traceLane) : undefined
    const laneSegs: Seg[] = [
      ...(only ? [seg('only ', C.accent, true), seg(only.chip, laneColor(lanes.indexOf(only)), true), seg(` ${only.label}`, C.ink), seg('   f all lanes   ·  ', C.faint)] : []),
      ...lanes.flatMap((L, k) => [...(k ? [seg('   ')] : []), { t: L.chip, c: laneColor(k), b: true, ...(k === focusLane ? { bg: C.selBg } : {}) }, seg(` ${L.label}`, k === focusLane ? C.ink : C.muted)]),
    ]
    const missing = tv?.missing ? [seg('   '), seg(`${T.warn} ${tv.missing} transcript${tv.missing === 1 ? '' : 's'} no longer on disk`, C.warn)] : []
    // the warning first, so a long list of lanes never cuts it off
    const head: Row[] = [{ segs: legend }, { segs: lay([...missing.slice(1), ...(missing.length ? [seg('   ')] : []), ...laneSegs], w) }]
    const pad = (rows: Row[]) => [...rows, ...Array.from({ length: Math.max(0, traceWin + 5 - rows.length) }, () => ({ segs: [] as Seg[] }))].slice(0, traceWin + 5)
    if (!tv) return pad([{ segs: legend }, { segs: [] }, { segs: [seg(' '), seg('Reading the transcripts…', C.muted)] }])
    if (tv.total === 0) return pad([...head, { segs: [] }, { segs: [seg(' '), seg('No steps were recorded for this run.', C.muted)] }])
    const gutter = (r: TraceRow, i: number): Seg[] => {
      if (!graph) {
        const g = glyphOf(r)
        return [seg(g, r.kind === 'fail' || r.error ? C.bad : laneColor(r.lane)), seg(cellWidth(g) >= 2 ? '' : ' ')]
      }
      const cells = lanes.map((L, k) => ({ ch: L.from <= i && i <= L.to ? '│' : ' ', fill: ' ', c: C.rule }))
      if (isArrow(r)) {
        const lo = Math.min(r.lane, r.to!)
        const hi = Math.max(r.lane, r.to!)
        const line = r.kind === 'message' ? '┄' : '─'
        const fromLeft = r.lane < r.to!
        const c = r.kind === 'message' ? C.muted : laneColor(fromLeft ? r.lane : r.to!)
        for (let k = lo + 1; k < hi; k++) cells[k] = { ch: line, fill: line, c }
        cells[lo] = { ch: fromLeft ? '├' : '◀', fill: line, c: laneColor(lo) }
        cells[hi] = { ch: fromLeft ? '▶' : '┤', fill: ' ', c: laneColor(hi) }
      } else {
        const g = glyphOf(r)
        const c = r.kind === 'fail' || r.error ? C.bad : r.kind === 'quiet' || r.kind === 'note' ? C.faint : laneColor(r.lane)
        cells[r.lane] = { ch: g, fill: cellWidth(g) >= 2 ? '' : ' ', c }
      }
      return cells.flatMap(x => [seg(x.ch, x.c), ...(x.fill ? [seg(x.fill, x.c)] : [])])
    }
    const nameOf = (k: number | undefined) => (k === undefined ? undefined : lanes[k]?.label)
    const textSegs = (r: TraceRow): Seg[] => {
      const target = nameOf(r.to) ?? r.target
      if (r.kind === 'spawn') return [seg('started ', C.muted), seg(target ?? r.text.replace(/^started /, ''), C.ink)]
      if (r.kind === 'handback') return [seg(`handed back${target ? ` to ${target}` : ''}: `, C.muted), seg(r.text, C.soft)]
      if (r.kind === 'report') return [seg(`reported${target ? ` to ${target}` : ''}: `, C.muted), seg(r.text, C.soft)]
      if (r.kind === 'message') return r.from ? [seg(`from ${r.from}: `, C.muted), seg(r.text, C.soft)] : [seg(`to ${target ?? 'another session'}: `, C.muted), seg(r.text, C.soft)]
      if (r.kind === 'quiet') return [seg(`··· ${T.quiet} ${r.text.replace(/^quiet /, '')} ···`, C.faint)]
      if (r.kind === 'note') return [seg(r.text, C.faint)]
      if (r.kind === 'step') return [seg(r.text, C.ink)]
      if (r.kind === 'fail') return [seg(r.text, C.bad, true)]
      if (r.kind === 'edit') return [seg(r.text, C.ink), seg('   '), seg(`+${r.added ?? 0}`, C.add), seg(' '), seg(`−${r.removed ?? 0}`, C.del)]
      return [seg(r.text, r.error ? C.bad : C.soft)]
    }
    const hitSet = new Set(tq ? traceStops : [])
    const rows: Row[] = [...head]
    for (let y = 0; y < traceWin; y++) {
      const i = first + y
      const r = traceRow(i)
      if (!r) { rows.push({ segs: i < tv.total ? [seg(' '), seg('…', C.faint)] : [] }); continue }
      const on = i === sel
      const L = lanes[r.lane]
      // a row in the picked agent's lane keeps a thin mark where the cursor goes
      const lead: Seg = on ? cursorSeg(true) : r.lane === focusLane ? seg('│', laneColor(r.lane)) : seg(' ')
      const segs: Seg[] = [lead, ...gutter(r, i), seg(' '), seg(padStart(`+${offset(r.at - t0)}`, 8), C.faint), seg('  '),
        seg(L?.chip ?? '··', laneColor(r.lane), true), seg(' '), ...(hitSet.has(i) ? textSegs(r).map(x => ({ ...x, c: C.accent })) : textSegs(r))]
      rows.push({ segs: lay(segs, w), bg: on ? C.selBg : undefined, hit: [{ x0: 0, x1: w, act: () => (i === sel ? activateTrace(i) : set({ sel: i })) }] })
    }
    // the detail strip: when, which lane, what it cost; then what went in and came out
    const r = traceRow(sel)
    const L = r ? lanes[r.lane] : undefined
    const d1: Seg[] = r && L ? [seg(clockSec(r.at), C.muted), seg('   '), seg(L.chip, laneColor(r.lane), true), seg(` ${L.label}`, C.ink, true),
      seg(`   ·   ${KIND_WORD[r.kind]}${r.name ? ` · ${r.name}` : ''}${r.count ? ` · ${r.count} calls` : ''}${r.tokens ? ` · ${kTokens(r.tokens)} tokens` : ''}`, C.muted),
      ...(r.error ? [seg('   ·   error', C.bad)] : [])] : []
    const d2: Seg[] = !r ? [] : r.kind === 'edit' && r.path
      ? [seg(r.path, C.soft), seg('   '), seg(`+${r.added ?? 0}`, C.add), seg(' '), seg(`−${r.removed ?? 0}`, C.del), seg('   enter opens the diff', C.faint)]
      : !r.input && !r.output ? [seg('Nothing more was recorded for this step.', C.faint)]
        : [...(r.input ? [seg('in ', C.faint), seg(r.input, C.soft)] : []), ...(r.output ? [seg(r.input ? '   out ' : 'out ', C.faint), seg(r.output, C.soft)] : [])]
    rows.push({ segs: [seg('─'.repeat(w), C.rule)] }, { segs: lay(d1, w) }, { segs: lay(d2, w) })
    return pad(rows)
  }

  const bodyList: Row[] = (() => {
    if (mode === 'trace') return traceRows(listW)
    if (mode === 'help') {
      return [{ segs: [] }, ...KEYS_HELP.map(([k, what]) => ({ segs: [seg(padEnd(k, 18), C.ink, true), seg(what, C.muted)] }))].slice(first, first + bodyRows)
    }
    if (mode === 'agents') {
      if (isHistoryPage && matchCount === 0 && (s.query || s.hfilter !== 'all')) {
        return [{ segs: [] }, { segs: [seg(' '), seg(s.query ? `No runs match "${s.query}".` : `No runs: ${HISTORY_FILTER_NAMES[s.hfilter]}.`, C.muted)] },
          { segs: [seg(' '), seg(s.query ? '⌫ edits the search; ctrl+u clears it.' : 'f shows all runs again.', C.faint)] }]
      }
      if (agentItems.length === 0) return emptyRows(listW)
      const draw = isHistoryPage ? historyRow : agentRow
      return agentItems.slice(first, first + bodyRows).map((it, k) => draw(it, first + k, listW))
    }
    if (body) return [body.rows[0]!, ...body.rows.slice(1 + first, 1 + first + Math.max(1, bodyRows - 1))]
    if (mode === 'files') {
      if (fileItems.length === 0) {
        const what = scope?.kind === 'phase' ? 'this phase' : scopeNode?.kind === 'workflow' ? 'this workflow' : scopeNode?.kind === 'group' ? 'this cluster' : 'this agent'
        return [{ segs: [] }, { segs: [seg(' '), seg(`No files were changed by ${what}.`, C.muted)] }]
      }
      return fileItems.slice(first, first + bodyRows).map((it, k) => fileRow(it, first + k, listW))
    }
    if (mode === 'output') return output.slice(first, first + bodyRows)
    if (mode === 'compare') return comparison.slice(first, first + bodyRows)
    return []
  })()

  // ── the rows above and below the body ────────────────────────────────
  // the bar's cursor draws as a filled tab, ink on accent; the chosen tab as accent on the selection ground
  const tabSeg = (label: string, on: boolean, focused = false): Seg => (focused ? { t: `▸${label} `, c: C.selBg, b: true, bg: C.accent }
    : on ? { t: ` ${label} `, c: C.accent, b: true, bg: C.selBg } : { t: ` ${label} `, c: C.muted })
  const tabRow = (specs: [string, boolean, () => void, boolean?][], start = 0): { segs: Seg[]; hit: Hit[] } => {
    const segs: Seg[] = []
    const hit: Hit[] = []
    let x = start
    specs.forEach(([label, on, act, focused], i) => {
      if (i) { segs.push(seg('  ')); x += 2 }
      const sg = tabSeg(label, on, focused)
      hit.push({ x0: x, x1: x + cellWidth(sg.t), act })
      segs.push(sg)
      x += cellWidth(sg.t)
    })
    return { segs, hit }
  }
  const tabsRow: Row = (() => {
    const t = tabRow(tabItems.map((it, i) => [it.label, it.on, () => it.act({}), zone === 'tabs' && i === barAt] as [string, boolean, () => void, boolean]))
    // the open run follows its tab; in a replay the History tab itself leads back
    if (run) t.segs.push(seg('   ›  ', C.faint), seg(run.label, C.soft, true))
    return t
  })()
  // the lens switch, at the right of the caption: all three when there is room, else the current one
  // the caption bar's lens items come after its view items
  const lensBase = run ? 3 : 0
  const onLens = zone === 'caption' && barAt >= lensBase
  const lensSegs = (room: number, x: number): { segs: Seg[]; hit: Hit[] } => {
    const full = tabRow(offered.map((l, i) => [LENS_NAMES[l], inAgents && lens === l, () => switchLens(l), onLens && barAt - lensBase === i] as [string, boolean, () => void, boolean]), x)
    if (width(full.segs) <= room) return full
    const short = onLens ? [tabSeg(LENS_NAMES[lens], true, true)] : [seg('v ', C.soft, true), seg(LENS_NAMES[lens], C.accent, true)]
    return { segs: short, hit: [{ x0: x, x1: x + width(short), act: () => switchLens(nextLensOf(lens)) }] }
  }
  const caption: Row = (() => {
    if (mode === 'help') return { segs: [seg('Keys', C.accent, true), seg('   every key the pane takes', C.muted)] }
    if (mode === 'compare') return { segs: [seg('‹ ', C.accent), seg('Compare two runs', C.ink, true), seg('   change is B against A · green where B did better', C.muted)], hit: [{ x0: 0, x1: 2, act: back }] }
    if (mode === 'diff') {
      const row = files.find(f => f.path === s.diffFile)
      return {
        segs: [seg('‹ ', C.accent), seg(names.get(s.diffFile ?? '') ?? s.diffFile ?? '', C.ink, true),
          ...(row ? [seg('   '), seg(`+${row.added}`, C.add), seg(' '), seg(`−${row.removed}`, C.del), seg(`   ${row.edits} edit${row.edits === 1 ? '' : 's'}`, C.muted)] : []),
          ...(blocks.length ? [seg(`   ·   edit ${sel + 1} of ${blocks.length}`, C.faint)] : [])],
        hit: [{ x0: 0, x1: 2, act: back }],
      }
    }
    let left: { segs: Seg[]; hit: Hit[] }
    if (!run) {
      const where = s.onlyRepo && props.repo ? `this repo${noRepoRuns ? ` (${noRepoRuns} older without a repo: r for all)` : ''}` : 'all repos'
      const what = !isHistory ? (running ? `${running} running` : 'Nothing running')
        : `${where}${s.hfilter !== 'all' ? `   ·   ${HISTORY_FILTER_NAMES[s.hfilter]}` : ''}${today ? `   ·   ${today} today` : ''}`
      const header = !isHistory ? T.words.live : T.words.history
      const grouping = !isHistory && s.group !== 'none' ? `   ·   ${GROUP_NAMES[s.group]}` : ''
      const filtering = !isHistory && s.filter !== 'all' ? `   ·   ${s.filter} only` : ''
      left = { segs: [seg(header, C.ink, true), seg('   '), seg(`${what}${grouping}${filtering}`, C.muted)], hit: [] }
    } else {
      left = tabRow(captionItems.slice(0, 3).map((it, i) => [it.label, it.on, () => it.act({}), zone === 'caption' && i === barAt] as [string, boolean, () => void, boolean]))
    }
    const room = listW - 3
    const fullW = width(lensSegs(1000, 0).segs)
    const shortW = cellWidth(`v ${LENS_NAMES[lens]}`)
    // the left side keeps its words: the lens switch shortens first, and only then the left is cut
    const lensW = width(left.segs) + 2 + fullW <= room ? fullW : shortW
    const keepLeft = Math.max(0, room - lensW - 2)
    const leftLaid = width(left.segs) > keepLeft ? lay(left.segs, keepLeft) : left.segs
    const x = Math.max(width(leftLaid) + 2, room - lensW)
    const right = lensSegs(lensW, x)
    return { segs: [...leftLaid, seg(' '.repeat(Math.max(2, x - width(leftLaid)))), ...right.segs], hit: [...left.hit.filter(h => h.x1 <= width(leftLaid)), ...right.hit] }
  })()
  const nextLens = LENS_NAMES[nextLensOf(lens)].toLowerCase()
  const insightKey: [string, string][] = shownInsights.length ? [['i', 'insight']] : []
  const nextFilter = HISTORY_FILTER_NAMES[HISTORY_FILTERS[(HISTORY_FILTERS.indexOf(s.hfilter) + 1) % HISTORY_FILTERS.length]!]
  // ↑ at the top of the content reaches the bars: the views and lenses, then the tabs
  const upKey: [string, string] = ['↑ top', run ? 'views' : 'tabs']
  const keyList: [string, string][] = mode === 'help' ? [['?', 'close']]
    : s.searching ? [['type', 'search'], ['enter', mode === 'trace' ? 'jump' : 'keep'], ['ctrl+u', 'clear'], ['⌫', 'delete'], ['↑ ↓', 'move']]
    : zone !== 'content' ? [['← →', zone === 'tabs' ? 'live · history' : 'switch'], ['↓', zone === 'tabs' && captionItems.length ? 'views' : 'back to the list'], ...(zone === 'caption' ? [['↑', 'tabs']] as [string, string][] : []), ['?', 'help']]
    : mode === 'compare' ? [['j k', 'scroll'], ['b', 'back'], ['?', 'help']]
    : mode === 'trace' ? [['j k', 'move'], ['n p', tq ? 'matches' : 'problems'], ['f', s.traceLane ? 'all lanes' : 'this lane'], ['/', 'search'],
      ['z', ZOOM_NAMES[ZOOMS[(ZOOMS.indexOf(s.zoom) + 1) % ZOOMS.length]!].toLowerCase()],
      ...(traceRow(sel)?.kind === 'edit' ? [['enter', 'diff']] as [string, string][] : laneId(traceRow(sel)) && laneId(traceRow(sel)) !== 'main' ? [['enter', 'agent']] as [string, string][] : []),
      ['v', nextLens], ['x', 'picture'], upKey, ['b', 'back'], ['?', 'help']]
    : isHistoryPage && mode === 'agents' ? [['j k', 'move'], ['enter', 'open'], ['/', 'search'], ['f', nextFilter], ['m', s.mark ? 'compare' : 'mark'], ['=', 'vs last'], ['o', s.olderOpen ? 'hide older' : 'older'],
      ['v', nextLens], ['r', s.onlyRepo ? 'all repos' : 'this repo'], upKey, ['?', 'help']]
    : !run && mode === 'agents' ? [['j k', 'move'], ['enter', 'open'], ['space', 'fold'], ['v', nextLens], ...insightKey, ['c', 'changes'], upKey, ['m', s.mark ? 'compare' : 'mark'], ['s', 'group'], ...(isHistory ? [['r', s.onlyRepo ? 'all repos' : 'this repo'] as [string, string]] : []), ['?', 'help']]
      : mode === 'agents' ? [['j k', 'move'], ['enter', 'open'], ['← →', 'fold'], ['v', nextLens], ...insightKey, upKey, ['=', 'vs last'], ['b', 'back'], ['?', 'help']]
        : isLens ? [['j k', 'card'], ['enter', 'open'], ['v', nextLens], ...insightKey, ...(run && mode === 'timeline' ? [['x', 'picture']] as [string, string][] : []), upKey, ...(run ? [['b', 'back']] as [string, string][] : []), ['?', 'help']]
          : mode === 'files' ? [['j k', 'move'], ['enter', 'diff'], upKey, ['b', 'back'], ['?', 'help']]
            : mode === 'diff' ? [['j k', 'edit'], ['enter', 'go to agent'], ['n p', 'files'], ['b', 'back'], ['?', 'help']]
              : [['j k', 'scroll'], upKey, ['b', 'back'], ['?', 'help']]
  // e and g where they work, before ? help
  const aiKeys: [string, string][] = !isFull || s.searching || mode === 'help' ? []
    : isHistoryPage ? [['g', props.patterns ? 'patterns again' : 'patterns'], ...(props.patterns ? [['p', s.patternsOpen ? 'hide patterns' : 'patterns'] as [string, string]] : [])]
      : run ? [['e', run.explain ? 'explain again' : 'explain']] : []
  // right after move and open: the footer drops keys from its right end first, so these stay
  if (aiKeys.length && keyList.length > 2 && keyList[keyList.length - 1]![0] === '?') keyList.splice(2, 0, ...aiKeys)
  const hiddenBelow = mode === 'diff' ? 0 : body ? body.rows.length - 1 - first - Math.max(1, bodyRows - 1) : count - first - (mode === 'trace' ? traceWin : bodyRows)
  const footer: Row = (() => {
    const noteOn = !!s.note && s.tick - s.noteTick <= NOTE_TICKS
    const right: Seg[] = noteOn ? [seg(s.note, C.accent)] : hiddenBelow > 0 ? [seg(`${hiddenBelow} more below`, C.faint)] : []
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
    pushRow(tabsRow)
    pushRule(isSplit && !strip.length ? '┬' : undefined)
    if (strip.length) { strip.forEach(pushRow); pushRule(isSplit ? '┬' : undefined) }
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
    if (mode === 'help' || mode === 'output' || isLens || mode === 'trace') return
    const at = y - bodyTop
    if (at < 0 || at >= bodyRows) return
    if (mode === 'diff') return
    if (isSplit && x >= LW) return
    const i = first + at
    if (i >= count || !okRow(i)) return
    // a click in the content gives it the keys back
    if (i === sel) { if (s.zone !== 'content') s.zone = 'content'; activate(i) }
    else set({ sel: i, zone: 'content' })
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
