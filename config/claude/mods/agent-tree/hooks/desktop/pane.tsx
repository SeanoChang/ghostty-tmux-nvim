import type { AgentNode, DeskUi, EditRecord, PatternsDoc, TraceZoom, ViewProps } from '../../types'
import { HISTORY_FILTERS, HISTORY_FILTER_NAMES, historyItems, historyStats, outcomeOf, runTokens } from '../history'
import { aspects, boardLanes, criticalPath, idleGaps, insights, listTimelineRows, rollup, timelineRows, type Lane } from '../lens'
import {
  childrenOf, counts, fileRows, folderKey, joinNodes, lineDiff, noReportReason, overlaps, pipeline, prettyModel, prettyType, runKey,
  runTree, scopeNodes, shortPaths, topItems, type Item,
} from '../list'
import { kTokens, reportFacts, reportOf } from '../report'
import { ZOOMS, ZOOM_NAMES } from '../trace'
import { unifiedHunks } from '../view'
import {
  BriefBlock, Chip, Empty, Heading, KindMark, ReportBlock, SectionLabel, StatusMark, STATUS_WORD, SummaryCard, aiLabel, briefMarkdown, changeTotals, clock, duration, metaLine, num,
  mdText, outputMarkdown, tilesOf, tint, tokensOf, type Els, type Part, type Tile,
} from './parts'
import { STRIP_H, clip, diffBarSvg, iconSvg, rulerSvg, sparkSvg, spriteSvg, statusBarSvg, statusColor, stripSvg, traceSvg, walkSvg, type DeskTokens, type TimeBar } from './svg'

// The desktop's own view of agent-tree: native controls, Svg pictures and pixel
// cats, drawn straight into the pane (a Client's elements have no Svg). It takes
// the same data the terminal view gets and the desk state; presses call `acts`,
// which the hooks module turns into $.state writes.

export type DeskActs = {
  set: (patch: Partial<DeskUi>) => void
  openDiff: (path: string | null) => void
  askTrace: (run: string | null, zoom: TraceZoom, offset: number) => void
  /** Ask Sonnet for a run's brief, or for patterns across runs (the hooks check ai: full again). */
  explain: (run: string) => void
  patterns: () => void
  /** Save a run's timeline or trace as a picture in ~/Downloads/agent-tree (the hooks say where). */
  exportPic: (run: string, lens: 'timeline' | 'trace', zoom: TraceZoom, focus?: string) => void
}

// Below this many columns nothing fits well, so the pane says so. The desktop
// lays panes out in character cells, as the terminal does; a cell is about 7.5 px.
export const MIN_COLUMNS = 60
export const WIDE_COLUMNS = 120
const CELL_PX = 7.5

export function drawDesktop(els: Els, data: ViewProps, ui: DeskUi, acts: DeskActs, columns: number) {
  const { Box, Text } = els
  const t = tokensOf(data.theme ?? 'minimal')
  const now = data.at
  if (columns < MIN_COLUMNS) {
    return (
      <Box flexDirection="column" alignItems="center" paddingY={2}>
        <Text color={t.muted}>Widen the pane to at least 480 px to see your agents.</Text>
      </Box>
    )
  }
  const here = data.repo ? folderKey(data.repo) : undefined
  const history = ui.onlyRepo && here
    ? (() => {
      const byId = new Map(data.history.map(n => [n.id, n]))
      const top = (n: AgentNode) => { let x = n; while (x.parentId && byId.has(x.parentId)) x = byId.get(x.parentId)!; return x }
      return data.history.filter(n => runKey(top(n)) === here)
    })()
    : data.history
  const pool = ui.tab === 'live' ? data.nodes : history
  const all = joinNodes(data.nodes, data.history)
  const run = ui.run ? (pool.find(n => n.id === ui.run) ?? all.find(n => n.id === ui.run)) : undefined
  const wide = columns >= WIDE_COLUMNS
  const ctx: Ctx = { els, t, ui, acts, now, all, pool, wide, columns, data }

  return (
    <Box flexDirection="column" gap={1} paddingX={1} paddingY={1}>
      {Header(ctx, history, run)}
      {Insights(ctx, run)}
      {run ? RunView(ctx, run) : ui.tab === 'live' ? LiveList(ctx) : HistoryPage(ctx, history)}
    </Box>
  )
}

type Ctx = {
  els: Els; t: DeskTokens; ui: DeskUi; acts: DeskActs; now: number; all: AgentNode[]; pool: AgentNode[]
  wide: boolean; columns: number; data: ViewProps
}

const openRun = (c: Ctx, id: string | null) => {
  c.acts.set({ run: id, sel: null, view: 'overview', file: null, traceOffset: 0, confirm: '', note: '', ...(id === null && c.ui.lens === 'trace' ? { lens: 'tree' as const } : {}) })
  if (c.ui.file) c.acts.openDiff(null)
  if (c.ui.lens === 'trace') c.acts.askTrace(id, c.ui.zoom, 0)
}

// A segmented control: one Button per option, the chosen one drawn as primary.
function Segmented<T extends string>(c: Ctx, key: string, options: readonly [T, string, string?][], current: T, pick: (v: T) => void) {
  const { Box, Button } = c.els
  return (
    <Box flexDirection="row" gap={0}>
      {options.map(([v, label, hotkey]) => (
        <Button key={`${key}:${v}`} label={label} {...(hotkey ? { hotkey } : {})} {...(v === current ? { variant: 'primary' as const } : {})} onPress={() => pick(v)} />
      ))}
    </Box>
  )
}

// ── header: what you see, where, and how it is going ──────────────────────────
function Header(c: Ctx, history: AgentNode[], run: AgentNode | undefined) {
  const { Box, Text, Button, Input, Svg } = c.els
  const { t, ui } = c
  const liveTops = c.data.nodes.filter(n => !n.parentId || !c.data.nodes.some(m => m.id === n.parentId))
  const running = liveTops.filter(n => n.status === 'running').length
  const histRuns = history.filter(n => !n.parentId || !history.some(m => m.id === n.parentId)).length
  const cnt = counts(c.pool.filter(n => n.kind === 'agent'))
  // Board last: it is the view used least
  const lenses: [DeskUi['lens'], string][] = [['tree', 'Tree'], ['timeline', 'Timeline'], ...(run ? [['trace', 'Trace'] as [DeskUi['lens'], string]] : []), ['board', 'Board']]
  // a count draws in its colour only when it is not zero, so the eye lands on what is there
  const tally = (n: number, word: string, color: string) => <Text color={n ? color : t.muted} {...(n ? { bold: true } : {})}>{n} {word}</Text>
  const lensBar = Segmented(c, 'lens', lenses, ui.lens, v => {
    c.acts.set({ lens: v, traceOffset: 0 })
    c.acts.askTrace(v === 'trace' && run ? run.id : null, ui.zoom, 0)
  })
  // a run is open: one row of controls, so its summary card sits near the top.
  // The run's name shows here only when the card below is about a part of it.
  if (run) {
    const inPart = !!ui.sel && ui.sel !== run.id
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" columnGap={2} rowGap={1} flexWrap="wrap" alignItems="center">
          <Button key="back" plain label={`‹ ${ui.tab === 'live' ? 'Live' : 'History'}`} onPress={() => openRun(c, null)} />
          {lensBar}
          <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
            {inPart ? <Text color={t.muted} wrap="truncate-end">in {run.label}</Text> : null}
          </Box>
          {ExplainButton(c, run)}
        </Box>
        {ui.note ? <Text color={t.warn}>{ui.note}</Text> : null}
        {ui.confirm === 'explain' ? ConfirmRow(c, 'explain', 'Write a new brief? It asks Sonnet again.', () => c.acts.explain(run.id)) : null}
      </Box>
    )
  }
  return (
    <Box flexDirection="column" gap={1}>
      {/* row 1: what you look at */}
      <Box flexDirection="row" columnGap={2} rowGap={1} flexWrap="wrap" alignItems="center">
        <Box flexDirection="row" gap={1} alignItems="center">
          {t.art
            ? <Svg source={spriteSvg(t.art, 'group', 20)} alt="Agents" width={20} height={20} />
            : <Svg source={iconSvg('workflow', t.accent, 18)} alt="Agents" width={18} height={18} />}
          <Text bold>Agents</Text>
        </Box>
        {Segmented(c, 'tab', [['live', `Live ${running}`, '1'], ['history', `History ${histRuns}`, '2']], ui.tab, v => {
          c.acts.set({ tab: v, run: null, sel: null, file: null, view: 'overview', ...(ui.lens === 'trace' ? { lens: 'tree' as const } : {}) })
          if (ui.lens === 'trace') c.acts.askTrace(null, ui.zoom, 0)
        })}
        {Segmented(c, 'scope', [['repo', 'This repo', 'r'], ['all', 'All repos']], ui.onlyRepo ? 'repo' : 'all', v => c.acts.set({ onlyRepo: v === 'repo' }))}
      </Box>
      {/* row 2: how you look at it */}
      <Box flexDirection="row" columnGap={2} rowGap={1} flexWrap="wrap" alignItems="center">
        {lensBar}
        {ui.tab === 'history'
          ? <Box flexGrow={1} minWidth={24}><Input key="search" placeholder="Search names and outcomes" value={ui.query} onInput={(v: string) => c.acts.set({ query: v })} onSubmit={(v: string) => c.acts.set({ query: v })} /></Box>
          : null}
      </Box>
      {/* row 3: one quiet status line */}
      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        {tally(cnt.running, 'running', t.warn)}<Text color={t.muted}>·</Text>
        {tally(cnt.done, 'done', t.ok)}<Text color={t.muted}>·</Text>
        {tally(cnt.failed + cnt.stopped, 'failed or stopped', t.bad)}<Text color={t.muted}>·</Text>
        <Text color={t.muted}>{ui.onlyRepo && c.data.repo ? shortHome(c.data.repo) : 'all repos'}</Text><Text color={t.muted}>·</Text>
        <Text color={c.data.ai === 'off' ? t.muted : t.accent}>AI · {c.data.ai ?? 'cheap'}</Text>
        <Text color={t.muted}>(change in /config)</Text>
      </Box>
      {ui.note ? <Text color={t.warn}>{ui.note}</Text> : null}
    </Box>
  )
}

const shortHome = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')

const isFull = (c: Ctx) => c.data.ai === 'full'

// Explain this run: Sonnet, on Full only; with a brief there it asks first.
function ExplainButton(c: Ctx, run: AgentNode) {
  const { Button } = c.els
  const writing = !!c.data.explaining?.includes(run.id)
  const label = writing ? 'Writing the brief…' : run.explain ? 'Regenerate brief' : 'Explain this run'
  return (
    <Button key="explain" label={label} hotkey="e" {...(isFull(c) ? {} : { dimColor: true })} onPress={() => {
      if (!isFull(c)) return c.acts.set({ note: 'Explain needs ai: full in /config. It asks Sonnet, on demand.' })
      if (writing) return
      if (run.explain) return c.acts.set({ confirm: 'explain', note: '', view: 'overview' })
      c.acts.set({ confirm: '', note: '', view: 'overview' })
      c.acts.explain(run.id)
    }} />
  )
}

// A small confirm row for a Sonnet job that would write over what is there.
function ConfirmRow(c: Ctx, what: 'explain' | 'patterns', question: string, go: () => void) {
  const { Box, Text, Button } = c.els
  return (
    <Box flexDirection="row" gap={2} alignItems="center">
      <Text color={c.t.warn}>{question}</Text>
      <Button key={`${what}:yes`} label="Yes, ask Sonnet" variant="primary" onPress={() => { c.acts.set({ confirm: '' }); go() }} />
      <Button key={`${what}:no`} plain label="Cancel" onPress={() => c.acts.set({ confirm: '' })} />
    </Box>
  )
}

// ── the insights strip: what needs a look, each naming the item it is about ──
function Insights(c: Ctx, run: AgentNode | undefined) {
  const { Box, Text, Button, Svg } = c.els
  const { t } = c
  if (!run && c.ui.tab === 'history') return null
  const scope = run ? scopeNodes(c.all, { kind: 'node', id: run.id }) : c.pool
  const list = insights(scope, c.all, c.now)
  if (!list.length) return null
  const go = (it: (typeof list)[number]) => {
    if (!it.target) return
    if (run) c.acts.set({ sel: it.target, view: it.kind === 'overlap' ? 'changes' : 'overview' })
    else {
      const byId = new Map(c.all.map(n => [n.id, n]))
      let top = byId.get(it.target)
      while (top?.parentId && byId.has(top.parentId)) top = byId.get(top.parentId)
      if (top) c.acts.set({ run: top.id, sel: it.target, view: it.kind === 'overlap' ? 'changes' : 'overview', file: null })
    }
  }
  // one insight per line; warnings and failures in a box, plain notes as a quiet line under it
  const line = (it: (typeof list)[number], i: number) => (
    <Box key={`ins-${i}`} flexDirection="row" gap={1} alignItems="center">
      <Svg source={iconSvg(it.tone === 'bad' ? 'failed' : it.kind === 'quiet' ? 'quiet' : it.tone === 'info' ? 'info' : 'warn', it.tone === 'bad' ? t.bad : it.tone === 'warn' ? t.warn : t.muted, 14)} alt={it.kind} width={14} height={14} />
      <Box flexShrink={1}><Button key={`insight:${i}`} plain {...(it.tone === 'info' ? { dimColor: true } : {})} label={it.text} onPress={() => go(it)} /></Box>
    </Box>
  )
  const loud = list.map((it, i) => [it, i] as const).filter(([it]) => it.tone !== 'info')
  const quiet = list.map((it, i) => [it, i] as const).filter(([it]) => it.tone === 'info')
  return (
    <Box flexDirection="column" gap={1}>
      {loud.length
        ? (
          <Box flexDirection="column" backgroundColor={tint(loud.some(([it]) => it.tone === 'bad') ? t.bad : t.warn)} paddingX={2} paddingY={1}>
            <Text bold color={loud.some(([it]) => it.tone === 'bad') ? t.bad : t.warn}>Needs a look ({loud.length})</Text>
            {loud.map(([it, i]) => line(it, i))}
          </Box>
        )
        : null}
      {quiet.length ? <Box flexDirection="column">{quiet.map(([it, i]) => line(it, i))}</Box> : null}
    </Box>
  )
}

// ── Live, no run open: one card per running run ──────────────────────────────
function LiveList(c: Ctx) {
  const { Box } = c.els
  const items = topItems(c.data.nodes, 'all', false, c.now).filter((it): it is Extract<Item, { kind: 'node' }> => it.kind === 'node' && it.depth === 0)
  if (c.ui.lens === 'board') return Board(c, boardLanes(undefined, c.data.nodes, items.map(i => i.node), 'all'), undefined)
  if (c.ui.lens === 'timeline') return Timeline(c, undefined, items.map(i => i.node))
  if (!items.length) {
    return Empty(c.els, c.t, c.t.words.emptyLive, 'Subagents and workflows appear here while they run, then move to History.')
  }
  return <Box flexDirection="column" gap={1}>{items.map(it => RunCard(c, it.node, c.data.nodes))}</Box>
}

function RunCard(c: Ctx, n: AgentNode, nodes: AgentNode[]) {
  const { Box, Text, Button, Svg } = c.els
  const { t } = c
  const scope = scopeNodes(nodes, { kind: 'node', id: n.id })
  const agents = scope.filter(k => k.kind === 'agent')
  const r = rollup(n.kind === 'agent' ? [n] : agents)
  const files = fileRows(scope)
  const ch = changeTotals(files)
  const clash = n.kind === 'group' ? overlaps(agents) : []
  return (
    <Box key={`card-${n.id}`} flexDirection="column" backgroundColor={tint(n.status === 'running' ? t.accent : t.rule)} paddingX={2} paddingY={1}>
      <Box flexDirection="row" gap={1} alignItems="center">
        {StatusMark(c.els, t, n.status)}
        {KindMark(c.els, t, n.kind)}
        <Button key={`run:${n.id}`} plain label={clip(n.label, 70)} onPress={() => openRun(c, n.id)} />
        <Text color={statusColor(t, n.status)}>{STATUS_WORD[n.status]}</Text>
      </Box>
      <Text color={t.muted}>{metaLine(n, c.now)}{n.kind !== 'agent' ? ` · ${agents.length} agents` : ''}{files.length ? ` · +${num(ch.added)} −${num(ch.removed)}` : ''}</Text>
      {n.kind !== 'agent'
        ? (
          <Box flexDirection="row" gap={1} alignItems="center">
            <Svg source={statusBarSvg(t, { ...r, total: r.total })} alt={`${r.finished} of ${r.total} finished`} width={96} height={6} />
            <Text color={t.muted}>{r.finished}/{r.total} done</Text>
          </Box>
        )
        : null}
      {n.kind === 'group'
        ? <Box flexDirection="row" gap={1} flexWrap="wrap">{aspects(nodes, n.id).map(a => (
          <Box key={`asp-${a.node.id}`} flexDirection="row" gap={1} backgroundColor={tint(t.rule, '26')} paddingX={1}>
            {StatusMark(c.els, t, a.node.status, 12)}
            <Text>{a.text}</Text>
          </Box>
        ))}</Box>
        : null}
      {clash.map(o => <Text key={`clash-${o.path}`} color={t.warn}>⚠ {o.path.split('/').pop()} edited by {o.by.length} members ({o.by.map(b => b.label).join(', ')})</Text>)}
    </Box>
  )
}

// ── History, no run open: numbers, filters, runs by day ──────────────────────
function HistoryPage(c: Ctx, history: AgentNode[]) {
  const { Box, Text, Button, Svg } = c.els
  const { t, ui } = c
  if (ui.lens === 'board') return Board(c, boardLanes(undefined, history, history.filter(n => !n.parentId || !history.some(m => m.id === n.parentId)), 'all'), undefined)
  if (ui.lens === 'timeline') return Timeline(c, undefined, history.filter(n => !n.parentId || !history.some(m => m.id === n.parentId)).slice(0, 30))
  const stats = historyStats(history, c.now)
  const items = historyItems(history, c.now, { filter: ui.hfilter, query: ui.query, olderOpen: ui.olderOpen })
  const stat = (value: string, label: string) => (
    <Box flexDirection="column">
      <Text bold>{value}</Text>
      <Text color={t.muted}>{label}</Text>
    </Box>
  )
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={4} alignItems="flex-end" flexWrap="wrap">
        {stat(String(stats.runs), 'runs')}
        {stat(`${stats.okPct}%`, 'finished OK')}
        {stat(kTokens(stats.tokens), 'tokens')}
        <Svg source={sparkSvg(t, stats.perDay)} alt={`Runs per day for 7 days: ${stats.perDay.join(', ')}`} width={140} height={34} />
        {c.data.ai !== 'off' || c.data.aiWeek ? stat(kTokens(c.data.aiWeek ?? 0), 'AI tokens this week') : null}
      </Box>
      <Box flexDirection="row" gap={2} alignItems="center" flexWrap="wrap">
        {Segmented(c, 'hfilter', HISTORY_FILTERS.map(f => [f, HISTORY_FILTER_NAMES[f].replace(/^./, ch => ch.toUpperCase())] as [typeof f, string]), ui.hfilter, v => c.acts.set({ hfilter: v }))}
        {ui.query ? <Button key="clear-search" plain label={`Clear “${clip(ui.query, 20)}”`} onPress={() => c.acts.set({ query: '' })} /> : null}
      </Box>
      {!ui.query && ui.hfilter === 'all' ? Patterns(c, c.data.patterns) : null}
      {items.length === 0
        ? Empty(c.els, t, t.words.emptyHistory, ui.query || ui.hfilter !== 'all' ? 'Nothing matches the search or filter.' : 'Finished runs land here.')
        : (
          <Box flexDirection="column">
            {items.map((it, i) => {
              if (it.kind === 'header') {
                return (
                  <Box key={`h-${i}`} flexDirection="row" gap={2} paddingTop={1}>
                    <Text bold>{it.text}</Text>
                    <Text color={t.muted}>{it.note ?? ''}</Text>
                    {it.isOpen === false || (it.text === 'Older')
                      ? <Button key="older" plain label={ui.olderOpen ? 'Hide' : 'Show'} onPress={() => c.acts.set({ olderOpen: !ui.olderOpen })} />
                      : null}
                  </Box>
                )
              }
              if (it.kind !== 'node') return null
              return HistoryRow(c, it.node, history)
            })}
          </Box>
        )}
    </Box>
  )
}

// Patterns across runs: Sonnet's cards, each with its evidence, one thing to try, and its runs.
function Patterns(c: Ctx, doc: PatternsDoc | undefined) {
  const { Box, Text, Button, Svg } = c.els
  const { t, ui } = c
  if (!isFull(c) && !doc) return null
  const busy = !!c.data.patternsBusy
  const label = busy ? 'writing… (Sonnet)' : doc ? aiLabel(doc, c.now) : 'Sonnet looks for what repeats across your runs.'
  const press = () => {
    if (!isFull(c)) return c.acts.set({ note: 'Patterns need ai: full in /config. They ask Sonnet, on demand.' })
    if (busy) return
    if (doc) return c.acts.set({ confirm: 'patterns', note: '', patternsOpen: true })
    c.acts.set({ confirm: '', note: '', patternsOpen: true })
    c.acts.patterns()
  }
  return (
    <Box flexDirection="column" gap={1} backgroundColor={tint(t.rule)} paddingX={2} paddingY={1}>
      <Box flexDirection="row" gap={1} alignItems="center" flexWrap="wrap">
        {doc ? <Button key="patterns:fold" plain label={ui.patternsOpen ? '▾' : '▸'} onPress={() => c.acts.set({ patternsOpen: !ui.patternsOpen })} /> : null}
        <Text bold>Patterns across runs</Text>
        <Box flexGrow={1}><Text color={t.muted}>{label}</Text></Box>
        <Button key="patterns:go" label={busy ? 'Looking…' : doc ? 'Regenerate' : 'Find patterns'} hotkey="g" {...(isFull(c) ? {} : { dimColor: true })} onPress={press} />
      </Box>
      {ui.confirm === 'patterns' ? ConfirmRow(c, 'patterns', 'Look for patterns again? It asks Sonnet again.', () => c.acts.patterns()) : null}
      {doc && ui.patternsOpen
        ? doc.cards.map((card, i) => (
          <Box key={`pat-${i}`} flexDirection="column" paddingLeft={1}>
            <Box flexDirection="row" gap={1} alignItems="center">
              <Svg source={iconSvg('warn', t.warn, 14)} alt="Pattern" width={14} height={14} />
              <Text bold>{card.title}</Text>
            </Box>
            {card.evidence ? <Text color={t.muted}>{card.evidence}</Text> : null}
            {card.try ? <Text><Text color={t.accent} bold>Try: </Text>{card.try}</Text> : null}
            {card.runs.length
              ? (
                <Box flexDirection="row" gap={1} flexWrap="wrap">
                  {card.runs.map(r => <Button key={`prun:${i}:${r.id}`} plain label={`↳ ${clip(r.label, 40)}`} onPress={() => openRun(c, r.id)} />)}
                </Box>
              )
              : null}
          </Box>
        ))
        : null}
    </Box>
  )
}

function HistoryRow(c: Ctx, n: AgentNode, history: AgentNode[]) {
  const { Box, Text, Button } = c.els
  const { t } = c
  const files = fileRows(scopeNodes(history, { kind: 'node', id: n.id }))
  const ch = changeTotals(files)
  const tok = runTokens(history, n)
  const outcome = outcomeOf(n) || noReportReason(n)
  return (
    <Box key={`hr-${n.id}`} flexDirection="row" gap={1} alignItems="center">
      {StatusMark(c.els, t, n.status)}
      <Box width={2}>{KindMark(c.els, t, n.kind, 14)}</Box>
      <Box width={c.wide ? 34 : 24}><Button key={`run:${n.id}`} plain label={clip(n.label, c.wide ? 34 : 24)} onPress={() => openRun(c, n.id)} /></Box>
      <Box flexGrow={1}><Text color={t.muted} wrap="truncate-end">{outcome}</Text></Box>
      {c.wide ? <Box width={14}><Text color={files.length ? t.add : t.muted}>{files.length ? `+${num(ch.added)} −${num(ch.removed)}` : '—'}</Text></Box> : null}
      <Box width={8}><Text color={t.muted}>{duration((n.endedAt ?? c.now) - n.startedAt)}</Text></Box>
      {c.wide ? <Box width={7}><Text color={t.muted}>{tok ? kTokens(tok) : ''}</Text></Box> : null}
    </Box>
  )
}

// ── a run: the chosen lens beside (or above) the detail of what is picked ────
function RunView(c: Ctx, run: AgentNode) {
  const { Box } = c.els
  const { ui } = c
  const nodes = c.all
  const target = targetOf(ui.sel, nodes) ?? { kind: 'node' as const, node: run }
  // Only the tree sits beside the detail, and only when both get room. The pictures
  // (timeline, trace, board) need the full width, so they always sit above it.
  const side = c.wide && ui.lens === 'tree'
  const treeCols = Math.max(52, Math.round(c.columns * 0.4))
  const full = c.columns - 4
  const lens = ui.lens === 'board'
    ? Board(c, boardLanes(run, nodes, [], 'all'), run, full)
    : ui.lens === 'timeline'
      ? Timeline(c, run, [], full)
      : ui.lens === 'trace'
        ? Trace(c, run, full)
        : Tree(c, run)
  const detail = Detail(c, run, target)
  // a run that is one agent has a one-row tree that only repeats the card's title
  const lone = ui.lens === 'tree' && run.kind === 'agent' && !childrenOf(nodes, run.id).length
  if (lone) return detail
  return side
    ? (
      <Box flexDirection="row" gap={2}>
        <Box flexDirection="column" width={treeCols} flexShrink={0} overflow="hidden">{lens}</Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={40}>{detail}</Box>
      </Box>
    )
    : <Box flexDirection="column" gap={2}>{lens}{detail}</Box>
}

type Target = { kind: 'node'; node: AgentNode } | { kind: 'phase'; wf: AgentNode; phase: string }

function targetOf(sel: string | null, nodes: AgentNode[]): Target | undefined {
  if (!sel) return undefined
  if (sel.startsWith('phase:')) {
    const [, wfId, ...rest] = sel.split(':')
    const wf = nodes.find(n => n.id === wfId)
    return wf ? { kind: 'phase', wf, phase: rest.join(':') } : undefined
  }
  const node = nodes.find(n => n.id === sel)
  return node ? { kind: 'node', node } : undefined
}

const toggle = (list: string[], key: string) => (list.includes(key) ? list.filter(k => k !== key) : [...list, key])

// ── Tree: workflow → phase → agent, cluster → members, subagents under parents ─
function Tree(c: Ctx, run: AgentNode) {
  const { Box, Text, Button, Svg } = c.els
  const { t, ui } = c
  const items = runTree(run, c.all, 'all', ui.flipped, ui.flipped)
  // the picked row gets a tinted ground; its label never has to share space with a marker
  const pickedBg = `${t.accent}26`
  const INDENT = 3
  // the right-hand facts sit in one block that never shrinks, so they line up and never spill
  const facts = (parts: unknown[]) => <Box flexShrink={0} flexDirection="row" gap={1} alignItems="center">{parts}</Box>
  const label = (key: string, text: string, onPress: () => void) => (
    <Box flexGrow={1} flexShrink={1} minWidth={10} overflow="hidden"><Button key={key} plain label={text} onPress={onPress} /></Box>
  )
  const fold = (key: string, isOpen: boolean) => (
    <Box width={2} flexShrink={0}><Button key={`fold:${key}`} plain label={isOpen ? '▾' : '▸'} onPress={() => c.acts.set({ flipped: toggle(ui.flipped, key) })} /></Box>
  )
  const noFold = <Box width={2} flexShrink={0} />
  return (
    <Box flexDirection="column" gap={0}>
      {items.map((it, i) => {
        if (it.kind === 'node') {
          const n = it.node
          const isSel = (ui.sel ?? run.id) === n.id
          const files = n.kind === 'agent' ? fileRows([n]) : []
          const ch = changeTotals(files)
          const kids = n.kind === 'agent' ? [] : scopeNodes(c.all, { kind: 'node', id: n.id }).filter(k => k.kind === 'agent')
          const r = rollup(kids)
          return (
            <Box key={`tn-${n.id}`} flexDirection="row" gap={1} alignItems="center" paddingLeft={it.depth * INDENT} paddingY={0} {...(isSel ? { backgroundColor: pickedBg } : {})}>
              {it.fold ? fold(it.fold.key, it.fold.isOpen) : noFold}
              {StatusMark(c.els, t, n.status, 16, isQuiet(n, c.now))}
              {KindMark(c.els, t, n.kind)}
              {label(`sel:${n.id}`, n.label, () => c.acts.set({ sel: n.id, file: null }))}
              {facts([
                kids.length ? <Svg key="bar" source={statusBarSvg(t, r, 48, 5)} alt={`${r.finished} of ${r.total}`} width={48} height={5} /> : null,
                kids.length ? <Text key="n" color={t.muted}>{r.finished}/{r.total}</Text> : null,
                files.length ? <Text key="d" color={t.add}>+{ch.added} <Text color={t.del}>−{ch.removed}</Text></Text> : null,
                <Box key="ms" width={8} justifyContent="flex-end"><Text color={t.muted}>{duration((n.endedAt ?? c.now) - n.startedAt)}</Text></Box>,
              ])}
            </Box>
          )
        }
        if (it.kind === 'phase') {
          const key = `phase:${it.wfId}:${it.phase}`
          const isSel = ui.sel === key
          return (
            <Box key={`tp-${it.key}`} flexDirection="row" gap={1} alignItems="center" paddingLeft={INDENT} {...(isSel ? { backgroundColor: pickedBg } : {})}>
              {fold(it.key, it.isOpen)}
              {label(`sel:${key}`, `${it.phase} phase`, () => c.acts.set({ sel: key, file: null }))}
              {facts([
                <Svg key="bar" source={statusBarSvg(t, it, 48, 5)} alt={`${it.done} of ${it.total}`} width={48} height={5} />,
                <Box key="n" width={8} justifyContent="flex-end"><Text color={t.muted}>{it.total - it.running}/{it.total}</Text></Box>,
              ])}
            </Box>
          )
        }
        if (it.kind === 'more') {
          return <Box key={`tm-${i}`} paddingLeft={INDENT * 2 + 3}><Button key={`more:${it.key}`} plain label={`Show ${it.count} more finished`} onPress={() => c.acts.set({ flipped: toggle(ui.flipped, it.key) })} /></Box>
        }
        if (it.kind === 'info' && it.tone === 'warn') {
          const o = overlaps(scopeNodes(c.all, { kind: 'node', id: it.nodeId }).filter(k => k.id !== it.nodeId))[0]
          return o ? <Box key={`tw-${i}`} paddingLeft={INDENT * 2 + 3}><Text color={t.warn}>⚠ {o.by.length} members edited {o.path.split('/').pop()}</Text></Box> : null
        }
        if (it.kind === 'info' && it.tone === 'outcome') {
          const n = c.all.find(x => x.id === it.nodeId)
          // the outcome sits under the row it belongs to, indented past the marks
          return n ? <Box key={`to-${i}`} paddingLeft={INDENT + 7} paddingBottom={1}><Text color={t.muted}>{clip(reportOf(n)?.result ?? '', 160)}</Text></Box> : null
        }
        return null
      })}
    </Box>
  )
}

const isQuiet = (n: AgentNode, now: number) => n.status === 'running' && now - (n.lastToolAt ?? n.startedAt) >= 120_000

// ── Board: one card per lane, its agents by status, full names and outcomes ────
// Three fixed status columns squeezed every name into a third of the width, and
// most of them stood empty. Now status is the order and the mark: running first,
// then failed or stopped, then done.
const BOARD_ORDER: Record<AgentNode['status'], number> = { running: 0, failed: 1, killed: 2, done: 3 }
const BOARD_CAP = 12

function Board(c: Ctx, lanes: Lane[], run: AgentNode | undefined, cols = c.columns - 4) {
  const { Box, Text, Button } = c.els
  const { t, ui } = c
  if (!lanes.length) return Empty(c.els, t, 'Nothing to put on the board.', 'Agents show up here as cards, by status.')
  const pick = (k: AgentNode) => {
    if (run) return c.acts.set({ sel: k.id, file: null })
    const byId = new Map(c.all.map(n => [n.id, n]))
    let top: AgentNode | undefined = k
    while (top?.parentId && byId.has(top.parentId)) top = byId.get(top.parentId)
    if (top) c.acts.set({ run: top.id, sel: k.id, file: null })
  }
  const summary = (cards: AgentNode[]) => {
    const cn = counts(cards)
    return [cn.running ? `${cn.running} running` : '', cn.failed + cn.stopped ? `${cn.failed + cn.stopped} failed or stopped` : '', cn.done ? `${cn.done} done` : ''].filter(Boolean).join(' · ')
  }
  // the card: how the agents stand, as a headline and tiles
  const every = lanes.flatMap(l => l.cards)
  const cn = counts(every)
  const failed = cn.failed + cn.stopped
  const headline = failed
    ? `${failed} of ${cn.total} agents failed or stopped.`
    : cn.running ? `${cn.running} of ${cn.total} agents still run.` : `All ${cn.total} agents finished.`
  const color = failed ? t.bad : cn.running ? t.warn : t.ok
  const runs = lanes.filter(l => l.kind !== 'singles').length + (lanes.find(l => l.kind === 'singles')?.cards.length ?? 0)
  const tiles: Tile[] = [
    { value: String(cn.running), label: 'running', ...(cn.running ? { color: t.warn } : {}) },
    { value: String(failed), label: 'failed or stopped', ...(failed ? { color: t.bad } : {}) },
    { value: String(cn.done), label: 'done', ...(cn.done ? { color: t.ok } : {}) },
    run ? { value: String(lanes.length), label: lanes.length === 1 ? 'lane' : 'lanes' } : { value: String(runs), label: runs === 1 ? 'run' : 'runs' },
  ]
  // agents as tiles, tinted by status: two to a row when each still gets 48 columns
  const tileW = cols >= 100 ? Math.floor((cols - 1) / 2) : undefined
  return (
    <Box flexDirection="column" gap={1}>
      {SummaryCard(c.els, t, { id: 'board', statusWord: 'Board', color, title: run ? run.label : `${ui.tab === 'live' ? 'Live' : 'History'} runs`, result: headline, tiles })}
      {!run ? <Text color={t.muted}>Each section is one run. Press an agent to open its run.</Text> : null}
      {lanes.map(l => {
        const cards = [...l.cards].sort((a, b) => BOARD_ORDER[a.status] - BOARD_ORDER[b.status] || a.startedAt - b.startedAt)
        const bad = cards.some(k => k.status === 'failed' || k.status === 'killed')
        return (
          <Box key={`lane-${l.key}`} flexDirection="column" gap={1}>
            <Box flexDirection="column">
              {Heading(c.els, l.title, `h-lane-${l.key}`)}
              <Text color={bad ? t.bad : t.muted}>{summary(cards)}</Text>
            </Box>
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              {cards.slice(0, BOARD_CAP).map(k => {
                const outcome = k.status === 'running' ? (k.activity ?? '') : (reportOf(k)?.result ?? '')
                const isSel = ui.sel === k.id
                return (
                  <Box key={`card-${k.id}`} flexDirection="column" backgroundColor={tint(isSel ? t.accent : statusColor(t, k.status), isSel ? '33' : '1a')} paddingX={1}
                    {...(tileW ? { width: tileW } : { flexGrow: 1 })}>
                    <Box flexDirection="row" gap={1} alignItems="center">
                      {StatusMark(c.els, t, k.status, 14, isQuiet(k, c.now))}
                      <Box flexGrow={1} flexShrink={1} minWidth={10} overflow="hidden"><Button key={`bsel:${k.id}`} plain label={k.label} onPress={() => pick(k)} /></Box>
                      <Box flexShrink={0}><Text color={t.muted}>{duration((k.endedAt ?? c.now) - k.startedAt)}</Text></Box>
                    </Box>
                    {outcome ? <Box paddingLeft={3}><Text color={t.muted}>{clip(outcome, 120)}</Text></Box> : null}
                  </Box>
                )
              })}
            </Box>
            {cards.length > BOARD_CAP ? <Text color={t.muted}>and {cards.length - BOARD_CAP} more</Text> : null}
          </Box>
        )
      })}
    </Box>
  )
}

// ── Timeline: bars on a shared ruler ──────────────────────────────────────────
function Timeline(c: Ctx, run: AgentNode | undefined, tops: AgentNode[], cols = c.columns - 4) {
  const { Box, Text, Button, Svg } = c.els
  const { t, ui } = c
  // on the run list, each run opens into its agents (newest 8 runs), so the bars are not 4 thin lines
  const list = run ? undefined : listTimelineRows(c.all, tops)
  const rows = run ? timelineRows(run, c.all, tops, 'all') : list!.rows
  // inside a run: the chain that set its end time, outlined, and the idle time, shaded
  const agents = rows.flatMap(r => (r.kind === 'bar' ? [r.node] : []))
  const path = run ? criticalPath(agents, c.now) : undefined
  const idle = run ? idleGaps(agents, c.now) : { gaps: [], ms: 0 }
  const onPath = new Set(path?.ids ?? [])
  if (!agents.length) return Empty(c.els, t, 'No timeline yet.', 'Bars appear as agents start and finish.')
  const from = Math.min(...agents.map(n => n.startedAt))
  const to = Math.max(...agents.map(n => n.endedAt ?? c.now))
  // labels are native text in their own column (they follow the theme and can be
  // pressed); each bar is a strip picture as wide as the rest of the pane
  const LABEL = Math.max(18, Math.min(44, Math.round(cols * 0.32)))
  const w = Math.max(200, Math.round((cols - LABEL - 2) * CELL_PX))
  const pick = (n: AgentNode) => {
    if (run) return c.acts.set({ sel: n.id, file: null })
    const byId = new Map(c.all.map(x => [x.id, x]))
    let top: AgentNode | undefined = n
    while (top?.parentId && byId.has(top.parentId)) top = byId.get(top.parentId)
    if (top) c.acts.set({ run: top.id, sel: n.id, file: null })
  }
  // the card: how long it took and where the time went, as a headline and tiles
  const span = to - from
  const cn = counts(agents)
  const failed = cn.failed + cn.stopped
  const headline = run
    ? path && path.ids.length
      ? `It took ${duration(span)}. ${path.ids.length} agent${path.ids.length === 1 ? '' : 's'} on the critical path set the end time.`
      : `It took ${duration(span)}.`
    : `${list!.runs} run${list!.runs === 1 ? '' : 's'} and ${agents.length} agents over ${duration(span)}.`
  const tiles: Tile[] = run
    ? [
      { value: duration(span), label: 'total time' },
      ...(path ? [{ value: duration(path.ms), label: `critical path · ${path.ids.length} agent${path.ids.length === 1 ? '' : 's'}`, color: t.accent }] : []),
      { value: duration(idle.ms), label: 'idle', ...(idle.ms && idle.ms >= span * 0.2 ? { color: t.warn } : {}) },
      { value: String(agents.length), label: 'agents' },
    ]
    : [
      { value: String(list!.runs), label: list!.hidden ? `runs · ${list!.hidden} older hidden` : 'runs' },
      { value: String(agents.length), label: 'agents' },
      { value: duration(span), label: 'time span' },
      { value: String(failed), label: 'failed or stopped', ...(failed ? { color: t.bad } : {}) },
    ]
  const key = [run && path ? 'Outlined bars: critical path' : '', run && idle.ms ? 'shaded: idle' : '', 'press a name to open it'].filter(Boolean).join(' · ')
  return (
    <Box flexDirection="column" gap={1}>
      {SummaryCard(c.els, t, { id: 'timeline', statusWord: 'Timeline', color: failed ? t.bad : cn.running ? t.warn : t.accent, title: run ? run.label : `${list!.runs} newest runs`, result: headline, tiles })}
      <Box flexDirection="row" columnGap={2} alignItems="center" flexWrap="wrap">
        <Box flexGrow={1} flexShrink={1}><Text color={t.muted}>{key.replace(/^./, ch => ch.toUpperCase())}.</Text></Box>
        {run ? <Button key="save-timeline" plain label="Save picture" hotkey="x" onPress={() => c.acts.exportPic(run.id, 'timeline', ui.zoom)} /> : null}
      </Box>
      <Box flexDirection="column" gap={0}>
        <Box flexDirection="row" gap={1}>
          <Box width={LABEL} flexShrink={0} />
          <Svg source={rulerSvg(t, from, to, w)} alt={`Timeline of ${agents.length} agents over ${duration(to - from)}`} width={w} height={20} />
        </Box>
        {rows.map((r, i) => {
          if (r.kind === 'label') {
            // a run or phase starts a section, as in the report
            return <Box key={`tlh-${i}`} paddingTop={i ? 1 : 0}>{Heading(c.els, r.text, `h-tl-${i}`)}</Box>
          }
          const n = r.node
          const isSel = ui.sel === n.id
          const bar: TimeBar = { label: n.label, start: n.startedAt, end: n.endedAt ?? c.now, status: n.status, isCritical: onPath.has(n.id) }
          return (
            <Box key={`tl-${n.id}`} flexDirection="row" gap={1} alignItems="center" {...(isSel ? { backgroundColor: `${t.accent}26` } : {})}>
              <Box width={LABEL} flexShrink={0} overflow="hidden" paddingLeft={1}>
                <Button key={`tsel:${n.id}`} plain {...(onPath.has(n.id) || !run ? {} : { dimColor: true })} label={n.label} onPress={() => pick(n)} />
              </Box>
              <Svg source={stripSvg(t, bar, from, to, w, idle.gaps)} alt={`${n.label}: ${STATUS_WORD[n.status]}, ${duration(bar.end - bar.start)}`} width={w} height={STRIP_H} />
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

// ── Trace: lanes on a time axis, arrows for spawns, messages, hand-backs ──────
function Trace(c: Ctx, run: AgentNode, cols: number) {
  const { Box, Text, Button, Svg } = c.els
  const { t, ui } = c
  const tr = c.data.trace
  const zoomBar = Segmented(c, 'zoom', ZOOMS.map(z => [z, ZOOM_NAMES[z]] as [TraceZoom, string]), ui.zoom, z => {
    c.acts.set({ zoom: z, traceOffset: 0 })
    c.acts.askTrace(run.id, z, 0)
  })
  if (!tr || tr.run !== run.id) {
    return (
      <Box flexDirection="column" gap={1}>
        {zoomBar}
        <Text color={t.muted}>Reading the transcripts…</Text>
        <Button key="read-trace" plain label="Read the trail now" onPress={() => c.acts.askTrace(run.id, ui.zoom, 0)} />
      </Box>
    )
  }
  const lanes = tr.lanes.map(l => ({ label: l.label, chip: l.chip, status: l.status }))
  const timed = tr.rows.filter(r => r.at > 0)
  const from = timed.length ? Math.min(...timed.map(r => r.at)) : c.now
  const to = timed.length ? Math.max(...timed.map(r => r.end ?? r.at)) : c.now
  const w = Math.max(320, Math.round(cols * CELL_PX))
  const marks = tr.rows.map(r => ({ lane: r.lane, ...(r.to !== undefined ? { to: r.to } : {}), at: r.at || from, kind: r.kind, text: r.text }))
  // the agent picked in the tree or the timeline: its lane stands out, the others fade
  const focus = ui.sel ? tr.lanes.findIndex(l => l.id === ui.sel) : -1
  const svgH = 24 + lanes.length * 40 + 8
  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" gap={2} alignItems="center">
        {zoomBar}
        <Text color={t.muted}>{tr.lanes.length} lanes · {tr.total} events{tr.missing ? ` · ${tr.missing} transcript${tr.missing === 1 ? '' : 's'} no longer on disk` : ''}{tr.loading ? ' · reading…' : ''}</Text>
        {ui.zoom === 'story' && tr.storyBy ? <Text color={t.accent}>Story · {tr.storyBy}</Text> : null}
        <Button key="save-trace" plain label="Save picture" hotkey="x" onPress={() => c.acts.exportPic(run.id, 'trace', ui.zoom, ui.sel ?? undefined)} />
      </Box>
      <Svg source={traceSvg(t, lanes, marks, from, to, w, focus >= 0 ? focus : undefined)} alt={`Trace of ${tr.lanes.length} agents`} width={w} height={svgH} />
      <Box flexDirection="column">
        {tr.rows.map((r, i) => (
          <Box key={`tr-${tr.offset + i}`} flexDirection="row" gap={1}>
            <Box width={8}><Text color={t.muted}>{r.at ? clock(r.at) : ''}</Text></Box>
            {Chip(c.els, t, tr.lanes[r.lane]?.chip ?? '··', t.lanes[r.lane % t.lanes.length])}
            <Box flexGrow={1}><Text {...(r.kind === 'fail' ? { color: t.bad } : r.kind === 'quiet' ? { color: t.muted } : {})} wrap="truncate-end">{r.kind === 'spawn' ? '↳ ' : r.kind === 'handback' ? '↩ ' : r.kind === 'message' ? '✉ ' : ''}{r.text}</Text></Box>
            {r.kind === 'edit' && r.path
              ? <Button key={`trdiff:${tr.offset + i}`} plain label="diff" onPress={() => { c.acts.set({ view: 'changes', file: r.path! }); c.acts.openDiff(r.path!) }} />
              : null}
          </Box>
        ))}
      </Box>
      {tr.total > tr.rows.length
        ? (
          <Box flexDirection="row" gap={2}>
            {tr.offset > 0 ? <Button key="trace-prev" plain label="‹ Earlier" onPress={() => { const o = Math.max(0, tr.offset - tr.rows.length); c.acts.set({ traceOffset: o }); c.acts.askTrace(run.id, ui.zoom, o) }} /> : null}
            <Text color={t.muted}>{tr.offset + 1}–{tr.offset + tr.rows.length} of {tr.total}</Text>
            {tr.offset + tr.rows.length < tr.total ? <Button key="trace-next" plain label="Later ›" onPress={() => { const o = tr.offset + tr.rows.length; c.acts.set({ traceOffset: o }); c.acts.askTrace(run.id, ui.zoom, o) }} /> : null}
          </Box>
        )
        : null}
    </Box>
  )
}

// ── the detail of what is picked: header, then Overview, Changes or Output ───
function Detail(c: Ctx, run: AgentNode, target: Target) {
  const { Box, Text, Svg, Markdown, Button } = c.els
  const { t, ui } = c
  const scope = target.kind === 'node'
    ? scopeNodes(c.all, { kind: 'node', id: target.node.id })
    : scopeNodes(c.all, { kind: 'phase', wfId: target.wf.id, phase: target.phase })
  const files = fileRows(scope)
  const names = shortPaths(files.map(f => f.path))
  const head = target.kind === 'node' ? target.node : undefined
  const title = head ? head.label : `${target.kind === 'phase' ? target.phase : ''} phase`
  const status = head ? head.status : (() => {
    const cn = counts(scope)
    return cn.running ? 'running' as const : cn.failed ? 'failed' as const : cn.stopped ? 'killed' as const : 'done' as const
  })()
  const quiet = head ? isQuiet(head, c.now) : false
  const big = t.art
    ? status === 'running' && !quiet
      ? <Svg source={walkSvg(t.art, 48)} alt="Running" width={48} height={48} isInteractive />
      : <Svg source={spriteSvg(t.art, quiet ? 'quiet' : head?.kind === 'workflow' ? 'workflow' : head?.kind === 'group' ? 'group' : status === 'done' ? 'done' : status === 'failed' ? 'failed' : 'stopped', 48)} alt={STATUS_WORD[status]} width={48} height={48} />
    : <Svg source={iconSvg(quiet ? 'quiet' : status, quiet ? t.warn : statusColor(t, status), 28)} alt={STATUS_WORD[status]} width={28} height={28} />
  const meta = head
    ? [prettyType(head, !!head.phase), prettyModel(head.model), duration((head.endedAt ?? c.now) - head.startedAt), clock(head.startedAt)].filter(Boolean).join(' · ')
    : `${scope.length} agents`
  const tabs = Segmented(c, 'view', [['overview', 'Overview', 'o'], ['changes', `Changes ${files.length}`, 'c'], ['output', 'Output', 'u']], ui.view, v => {
    c.acts.set({ view: v, file: null })
    if (ui.file) c.acts.openDiff(null)
  })
  // the parts of a run: a workflow's phases, or a cluster's members
  const parts: Part[] = head?.kind === 'workflow'
    ? pipeline(head, c.all).map(p => ({
      id: `phase:${head.id}:${p.phase}`, label: p.phase,
      status: p.running ? 'running' as const : p.failed ? 'failed' as const : p.stopped ? 'killed' as const : 'done' as const,
      result: head.partReports?.[p.phase]?.result ?? `${p.total - p.running} of ${p.total} agents finished`,
      meta: `${p.total} agent${p.total === 1 ? '' : 's'}`,
    }))
    : head?.kind === 'group'
      ? childrenOf(c.all, head.id).map(k => ({ id: k.id, label: k.label, status: k.status, result: reportOf(k)?.result ?? noReportReason(k) }))
      : []
  let body
  if (ui.view === 'changes') body = Changes(c, scope, files, names)
  else if (ui.view === 'output') {
    const md = target.kind === 'node'
      ? outputMarkdown(target.node, childrenOf(c.all, target.node.id))
      : [`### ${target.phase} phase`, target.wf.partReports?.[target.phase]?.result ?? '', ...scope.map(k => `- **${k.label}** — ${reportOf(k)?.result ?? noReportReason(k)}`)].filter(Boolean).join('\n\n')
    const brief = target.kind === 'node' && target.node.id === run.id && (run.explain || c.data.explaining?.includes(run.id))
      ? `${briefMarkdown(run.explain, !!c.data.explaining?.includes(run.id), c.now)}\n\n---\n\n`
      : ''
    body = <Markdown key="output" text={brief + md} />
  } else if (head) {
    const prs = Object.values(head.partReports ?? {}).filter(p => p.model)
    const partsBy = prs.length ? aiLabel({ model: prs[0]!.model, tokens: prs.reduce((a, p) => a + (p.tokens ?? 0), 0), at: Math.max(...prs.map(p => p.at ?? 0)) || undefined }, c.now) : ''
    const writing = !!c.data.explaining?.includes(head.id)
    const showBrief = head.id === run.id && (head.explain || writing)
    body = (
      <Box flexDirection="column" gap={1}>
        {showBrief ? BriefBlock(c.els, t, head.explain, writing, c.now) : null}
        {ReportBlock(c.els, t, head, c.all, c.now, parts, id => c.acts.set({ sel: id, file: null }), partsBy)}
      </Box>
    )
  } else {
    const pr = target.kind === 'phase' ? target.wf.partReports?.[target.phase] : undefined
    body = (
      <Box flexDirection="column" gap={1}>
        {pr?.problems?.length
          ? (
            <Box key="attention" flexDirection="column">
              <Box flexDirection="row" gap={1} alignItems="center">
                <Svg source={iconSvg('warn', t.bad, 16)} alt="Needs your attention" width={16} height={16} />
                <Text color={t.bad} bold>Needs your attention ({pr.problems.length})</Text>
              </Box>
              <Markdown key="pproblems" text={pr.problems.map(p => `- ${mdText(p.text)}`).join('\n')} />
            </Box>
          )
          : null}
        {Heading(c.els, `Agents (${scope.length})`, 'h-agents')}
        {scope.map(k => (
          <Box key={`pa-${k.id}`} flexDirection="column">
            <Box flexDirection="row" gap={1} alignItems="center">
              {StatusMark(c.els, t, k.status, 14)}
              <Box flexGrow={1} flexShrink={1} overflow="hidden"><Button key={`psel:${k.id}`} plain label={k.label} onPress={() => c.acts.set({ sel: k.id })} /></Box>
              <Box flexShrink={0}><Text color={t.muted}>{duration((k.endedAt ?? c.now) - k.startedAt)}</Text></Box>
            </Box>
            <Box paddingLeft={3}><Text color={t.muted}>{clip(reportOf(k)?.result ?? noReportReason(k), 200)}</Text></Box>
          </Box>
        ))}
        {pr?.model ? <Text color={t.muted}>Part report by {aiLabel(pr, c.now)}</Text> : null}
      </Box>
    )
  }
  // the card: status, verdict and numbers in one glance; every view below shares it
  const factScope = target.kind === 'node' ? { kind: 'node' as const, id: target.node.id } : { kind: 'phase' as const, wfId: target.wf.id, phase: target.phase }
  const facts = reportFacts(c.all, factScope, c.now)
  const result = head
    ? reportOf(head)?.result ?? (head.status === 'running' ? 'Still working.' : noReportReason(head))
    : target.kind === 'phase' ? target.wf.partReports?.[target.phase]?.result ?? `${counts(scope).done} of ${scope.length} agents done.` : ''
  const problems = head ? (reportOf(head)?.problems?.length ?? 0) : target.kind === 'phase' ? (target.wf.partReports?.[target.phase]?.problems?.length ?? 0) : 0
  const color = quiet ? t.warn : statusColor(t, status)
  return (
    <Box flexDirection="column" gap={1}>
      {SummaryCard(c.els, t, { id: 'detail', big, statusWord: quiet ? 'Quiet' : STATUS_WORD[status], color, title, meta, result, tiles: tilesOf(t, facts, problems) })}
      {quiet && head ? <Text color={t.warn}>No tool call for {duration(c.now - (head.lastToolAt ?? head.startedAt))}. Last: {head.activity ?? head.lastTool ?? 'unknown'}.</Text> : null}
      {tabs}
      {body}
    </Box>
  )
}

function Changes(c: Ctx, scope: AgentNode[], files: ReturnType<typeof fileRows>, names: Map<string, string>) {
  const { Box, Text, Button, Svg, Code } = c.els
  const { t, ui } = c
  if (!files.length) return <Text color={t.muted}>No files were changed here.</Text>
  if (ui.file) {
    const row = files.find(f => f.path === ui.file)
    const ids = new Set(scope.map(n => n.id))
    const edits: EditRecord[] = c.data.diff?.path === ui.file ? c.data.diff.edits.filter(r => ids.has(r.agentId)) : []
    const byId = new Map(c.all.map(n => [n.id, n]))
    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={2} alignItems="center">
          <Button key="files" plain label="‹ All files" onPress={() => { c.acts.set({ file: null }); c.acts.openDiff(null) }} />
          <Text bold>{names.get(ui.file) ?? ui.file}</Text>
          {row ? <Text color={t.add}>+{num(row.added)} <Text color={t.del}>−{num(row.removed)}</Text></Text> : null}
        </Box>
        {c.data.diff?.path !== ui.file
          ? <Text color={t.muted}>Loading the diff…</Text>
          : edits.length === 0
            ? <Text color={t.muted}>No saved edits for this file in this scope.</Text>
            : edits.map(rec => {
              const lines = lineDiff(rec.old, rec.new, rec.line)
              const hunks = unifiedHunks(lines)
              const who = byId.get(rec.agentId)
              const added = lines.filter(l => l.op === '+').length
              const removed = lines.filter(l => l.op === '-').length
              return (
                <Box key={`edit-${rec.id}`} flexDirection="column">
                  <Box flexDirection="row" gap={1} alignItems="center">
                    {Chip(c.els, t, who ? clip(who.label, 30) : rec.agentId.slice(0, 8), t.accent)}
                    <Text color={t.muted}>line {rec.line} · {clock(rec.at)}</Text>
                    <Text color={t.add}>+{added} <Text color={t.del}>−{removed}</Text></Text>
                  </Box>
                  {hunks.map((hunk, i) => <Code key={`hunk-${rec.id}-${i}`} source={hunk} format="diff" path={rec.path} wrap="wrap" />)}
                </Box>
              )
            })}
      </Box>
    )
  }
  const max = Math.max(1, ...files.map(f => f.added + f.removed))
  return (
    <Box flexDirection="column">
      {files.map(f => (
        <Box key={`file-${f.path}`} flexDirection="row" gap={1} alignItems="center">
          <Svg source={iconSvg('file', t.muted, 14)} alt="File" width={14} height={14} />
          <Box flexGrow={1}><Button key={`file:${f.path}`} plain label={clip(names.get(f.path) ?? f.path, 50)} onPress={() => { c.acts.set({ file: f.path }); c.acts.openDiff(f.path) }} /></Box>
          <Svg source={diffBarSvg(t, f.added, f.removed, max)} alt={`+${f.added} −${f.removed}`} width={60} height={6} />
          <Box width={14}><Text color={t.add}>+{num(f.added)} <Text color={t.del}>−{num(f.removed)}</Text></Text></Box>
          <Text color={t.muted}>{clip(f.by.map(b => b.node.label).join(', '), 30)}</Text>
        </Box>
      ))}
    </Box>
  )
}
