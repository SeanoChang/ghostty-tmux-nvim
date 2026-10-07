import type { AgentNode, Brief, NodeStatus, Report } from '../../types'
import type { ThemeName } from '../theme'
import { ago } from '../ai'
import { firstSentence, noReportReason, prettyModel, shortPaths, taskText, type FileRow } from '../list'
import { reportFacts, reportOf, kTokens } from '../report'
import { DESK, SPRITE_FOR, clip, diffBarSvg, iconSvg, spriteSvg, statusColor, type DeskTokens } from './svg'

// Small pieces the desktop view is made of. Each takes the surface's element table
// and returns a tree; none of them touches $.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Els = Record<string, any>

export const STATUS_WORD: Record<NodeStatus, string> = { running: 'Running', done: 'Done', failed: 'Failed', killed: 'Stopped' }

export const tokensOf = (theme: ThemeName): DeskTokens => DESK[theme]

// Who wrote an AI block, what it cost and how old it is: "Haiku · 900 tokens · 2h ago".
export const aiLabel = (b: { model?: string; tokens?: number; at?: number } | undefined, now: number): string =>
  !b?.model ? '' : [b.model, ...(b.tokens ? [`${kTokens(b.tokens)} tokens`] : []), ...(b.at ? [ago(Math.max(0, now - b.at))] : [])].join(' · ')

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}
export const clock = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
export const num = (n: number) => n.toLocaleString('en-US')

// One status mark: the theme's pixel art (a cat, a fish, a dog), or a line icon in
// minimal. Quiet agents sleep.
export function StatusMark(els: Els, t: DeskTokens, status: NodeStatus, px = 16, isQuiet = false) {
  const { Svg } = els
  const word = isQuiet ? 'Quiet' : STATUS_WORD[status]
  if (t.art) return <Svg source={spriteSvg(t.art, isQuiet ? 'quiet' : SPRITE_FOR[status], px)} alt={word} width={px} height={px} />
  const name = isQuiet ? 'quiet' : status
  return <Svg source={iconSvg(name, isQuiet ? t.warn : statusColor(t, status), px)} alt={word} width={px} height={px} />
}

// What a row holds: workflows and clusters get a mark, a plain agent none.
export function KindMark(els: Els, t: DeskTokens, kind: AgentNode['kind'], px = 16) {
  const { Svg } = els
  if (kind === 'agent') return null
  const alt = kind === 'workflow' ? 'Workflow' : 'Cluster'
  if (t.art) return <Svg source={spriteSvg(t.art, kind === 'workflow' ? 'workflow' : 'group', px)} alt={alt} width={px} height={px} />
  return <Svg source={iconSvg(kind === 'workflow' ? 'workflow' : 'group', t.muted, px)} alt={alt} width={px} height={px} />
}


// A label in a colour, with no outline: the pane draws no borders, only tints.
export function Chip(els: Els, t: DeskTokens, text: string, color?: string) {
  const { Text } = els
  return <Text color={color ?? t.muted} bold>{text}</Text>
}

// A tint behind a block, as an 8-digit hex: the colour at about 10% (or `alpha`).
// It reads on light and dark grounds alike, which an outline in a mid-tone did not.
export const tint = (color: string, alpha = '1a') => `${color}${alpha}`

export function SectionLabel(els: Els, t: DeskTokens, text: string) {
  const { Text } = els
  return <Text color={t.muted} bold>{text.toUpperCase()}</Text>
}

// The empty state: the theme's scene when it has pixel art, a calm line in minimal.
export function Empty(els: Els, t: DeskTokens, title: string, hint: string) {
  const { Box, Text, Svg } = els
  return (
    <Box flexDirection="column" alignItems="center" paddingY={2} gap={1}>
      {t.art
        ? <Svg source={spriteSvg(t.art, 'scene', 128)} alt={t.words.scene} width={128} height={80} />
        : <Svg source={iconSvg('empty', t.rule, 28)} alt="Nothing here" width={28} height={28} />}
      <Text bold>{title}</Text>
      <Text color={t.muted}>{hint}</Text>
    </Box>
  )
}

// ── the report: verdict, what needs attention, parts, details, then the records ─
// The desktop gives Text no sizes, so Markdown carries the hierarchy: its headings
// are the only larger type the pane can draw. Buttons stay native, for presses.
// Changed and Totals come from records, never from the model.
// A part of a run: a workflow phase or a cluster member, with its own short result.
export type Part = { id: string; label: string; status: NodeStatus; result: string; meta?: string }

// Report text is the model's plain prose; keep Markdown from reading it as markup.
export const mdText = (s: string) => s.replace(/([\\`*_[\]#<>|])/g, '\\$1')

// A section heading: Markdown's h4, the one step up from body text.
export function Heading(els: Els, text: string, key: string) {
  const { Markdown } = els
  return <Markdown key={key} text={`### ${mdText(text)}`} />
}

// "the agent it came from", only when it adds something the line does not say.
const sourceNote = (source: string | undefined, self: string) =>
  source && source.toLowerCase() !== self.toLowerCase() ? ` — _${mdText(source)}_` : ''

// A result split into its verdict (the first sentence, drawn large) and the rest.
export function verdictOf(result: string): { verdict: string; rest: string } {
  const verdict = firstSentence(result, 300)
  return { verdict, rest: result.slice(result.indexOf(verdict) + verdict.length).trim() }
}

export type Tile = { value: string; label: string; color?: string }

// The summary card: what is shown and how it ended, its headline, and its numbers
// as tiles. The card is tinted in its colour; nothing in it has an outline. The run
// view, the timeline and the board each open on one, so every view reads the same way.
export function SummaryCard(els: Els, t: DeskTokens, o: {
  /** Keys the card's elements: a view's card and the run's card can be on screen together. */
  id: string
  big?: unknown; statusWord: string; color: string; title: string; meta?: string; result: string; tiles: Tile[]
}) {
  const { Box, Text, Markdown } = els
  const { verdict, rest } = verdictOf(o.result)
  return (
    <Box flexDirection="column" gap={1} backgroundColor={tint(o.color)} paddingX={2} paddingY={1}>
      <Box flexDirection="row" gap={2} alignItems="flex-start">
        {o.big ? <Box flexShrink={0} paddingTop={1}>{o.big}</Box> : null}
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Text color={o.color} bold>{o.statusWord.toUpperCase()} · {o.title}</Text>
          <Markdown key={`verdict-${o.id}`} text={`## ${mdText(verdict)}${rest ? `\n\n${mdText(rest)}` : ''}`} />
          {o.meta ? <Text color={t.muted}>{o.meta}</Text> : null}
        </Box>
      </Box>
      <Box flexDirection="row" flexWrap="wrap" gap={1}>
        {o.tiles.map(tl => (
          <Box key={`tile-${o.id}-${tl.label}`} flexDirection="column" flexGrow={1} minWidth={12} backgroundColor={tint(t.rule, '26')} paddingX={1}>
            <Text bold {...(tl.color ? { color: tl.color } : {})}>{tl.value}</Text>
            <Text color={t.muted}>{tl.label}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// The tiles for a scope: time, tokens, problems, files, and agents when more than one.
export function tilesOf(t: DeskTokens, facts: ReturnType<typeof reportFacts>, problems: number): Tile[] {
  return [
    { value: duration(facts.ms), label: 'time' },
    { value: facts.tokens ? kTokens(facts.tokens) : '—', label: 'tokens' },
    { value: String(problems), label: problems === 1 ? 'problem' : 'problems', ...(problems ? { color: t.bad } : {}) },
    { value: facts.files.length ? `+${num(facts.added)} −${num(facts.removed)}` : '0', label: `${facts.files.length} file${facts.files.length === 1 ? '' : 's'} changed`, ...(facts.files.length ? { color: t.add } : {}) },
    ...(facts.agents > 1 ? [{ value: String(facts.agents), label: facts.phases ? `agents · ${facts.phases} phases` : 'agents' }] : []),
  ]
}

// The report below the card: what needs attention, the parts, the details, the
// files. The verdict and the numbers are in the card above it.
export function ReportBlock(els: Els, t: DeskTokens, n: AgentNode, all: AgentNode[], now: number, parts: Part[], onPart: (id: string) => void, partsBy = '') {
  const { Box, Text, Button, Svg, Markdown } = els
  const r: Report | undefined = reportOf(n)
  const facts = reportFacts(all, { kind: 'node', id: n.id }, now)
  const names = shortPaths(facts.files.map(f => f.path))
  const max = Math.max(1, ...facts.files.map(f => f.added + f.removed))
  const by = r?.model ? `Report by ${aiLabel(r, now)}` : n.report ? 'Report' : 'Report from what the run kept (no model summary)'
  const details = [
    r?.done?.length ? `### What it did\n\n${r.done.map(d => `- ${mdText(d)}`).join('\n')}` : '',
    r?.decisions?.length ? `### Decisions\n\n${r.decisions.map(d => `- ${mdText(d.text)}${sourceNote(d.source, n.label)}`).join('\n')}` : '',
    r?.next ? `### Next step\n\n${mdText(r.next)}` : '',
  ].filter(Boolean).join('\n\n')
  return (
    <Box flexDirection="column" gap={1}>
      {r?.problems?.length
        ? (
          <Box key="attention" flexDirection="column">
            <Box flexDirection="row" gap={1} alignItems="center">
              <Svg source={iconSvg('warn', t.bad, 16)} alt="Needs your attention" width={16} height={16} />
              <Text color={t.bad} bold>Needs your attention ({r.problems.length})</Text>
            </Box>
            <Markdown key="problems" text={r.problems.map(p => `- ${mdText(p.text)}${sourceNote(p.source, n.label)}`).join('\n')} />
          </Box>
        )
        : null}
      {parts.length
        ? (
          <Box key="parts" flexDirection="column">
            {Heading(els, `Parts (${parts.length})`, 'h-parts')}
            {partsBy ? <Text color={t.muted}>Part reports by {partsBy}</Text> : null}
            <Box flexDirection="column" gap={1}>
              {parts.map(p => (
                <Box key={`part-${p.id}`} flexDirection="column">
                  <Box flexDirection="row" gap={1} alignItems="center">
                    {StatusMark(els, t, p.status)}
                    <Box flexGrow={1} flexShrink={1}><Button key={`part:${p.id}`} plain label={p.label} onPress={() => onPart(p.id)} /></Box>
                    {p.meta ? <Box flexShrink={0}><Text color={t.muted}>{p.meta}</Text></Box> : null}
                  </Box>
                  <Box paddingLeft={3}><Text color={t.muted}>{clip(p.result, 220)}</Text></Box>
                </Box>
              ))}
            </Box>
          </Box>
        )
        : null}
      {details ? <Markdown key="details" text={details} /> : null}
      {facts.files.length
        ? (
          <Box key="changed" flexDirection="column">
            {Heading(els, `Changed files (${facts.files.length})`, 'h-changed')}
            {facts.files.slice(0, 8).map(f => (
              <Box key={`chg-${f.path}`} flexDirection="row" gap={1} alignItems="center">
                <Box flexGrow={1} flexShrink={1}><Text wrap="truncate-start">{names.get(f.path) ?? f.path}</Text></Box>
                <Box flexShrink={0} flexDirection="row" gap={1} alignItems="center">
                  <Svg source={diffBarSvg(t, f.added, f.removed, max)} alt={`+${f.added} −${f.removed}`} width={60} height={6} />
                  <Text color={t.add}>+{num(f.added)}</Text><Text color={t.del}>−{num(f.removed)}</Text>
                </Box>
              </Box>
            ))}
            {facts.files.length > 8 ? <Text color={t.muted}>and {facts.files.length - 8} more files</Text> : null}
          </Box>
        )
        : null}
      <Text color={t.muted}>{by}</Text>
    </Box>
  )
}

// "Explain this run": Sonnet's brief, with who wrote it, or that it is being written.
// Outcome and open issues lead; how the work went follows.
export function BriefBlock(els: Els, t: DeskTokens, b: Brief | undefined, writing: boolean, now: number) {
  const { Box, Text, Markdown } = els
  const label = writing ? 'Explain · Sonnet is writing…' : `Explain · by ${aiLabel(b, now)}`
  const md = !b ? '' : [
    b.outcome ? `## ${mdText(b.outcome)}` : '',
    b.open?.length ? `### Still open\n\n${b.open.map(o => `- ${mdText(o)}`).join('\n')}` : '',
    b.goal ? `### Goal\n\n${mdText(b.goal)}` : '',
    b.who?.length ? `### Who did what\n\n${b.who.map(w => `- ${mdText(w)}`).join('\n')}` : '',
    b.connected ? `### How the parts connect\n\n${mdText(b.connected)}` : '',
  ].filter(Boolean).join('\n\n')
  return (
    <Box flexDirection="column" gap={1} backgroundColor={tint(t.accent)} paddingX={2} paddingY={1}>
      <Text color={t.accent} bold>{label}</Text>
      {!b
        ? <Text color={t.muted}>Sonnet reads the run's reports, steps and insights.</Text>
        : <Markdown key="brief" text={md} />}
    </Box>
  )
}

// The brief as Markdown, for the Output view.
export function briefMarkdown(b: Brief | undefined, writing: boolean, now: number): string {
  const head = `**Explain** · _${writing ? 'writing… (Sonnet)' : aiLabel(b, now)}_`
  if (!b) return `${head}\n\n_Sonnet is reading the run's reports, steps and insights._`
  return [
    head,
    b.goal ? `**Goal:** ${b.goal}` : '',
    b.who?.length ? `**Who did what**\n\n${b.who.map(w => `- ${w}`).join('\n')}` : '',
    b.connected ? `**How it connected:** ${b.connected}` : '',
    b.outcome ? `**Outcome:** ${b.outcome}` : '',
    b.open?.length ? `**Open issues**\n\n${b.open.map(o => `- ${o}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n')
}

// The Output view: the full report as Markdown, then the task it was given.
export function outputMarkdown(n: AgentNode, kids: AgentNode[]): string {
  const r = reportOf(n)
  const out: string[] = []
  out.push(`### ${n.label}`)
  out.push(r?.result ?? (n.status === 'running' ? '_Still working — the report appears here when it finishes._' : `_${noReportReason(n)}_`))
  if (r?.done?.length) out.push(r.done.map(d => `- ${d}`).join('\n'))
  if (r?.problems?.length) out.push(`**Problems**\n\n${r.problems.map(p => `- ${p.text}${p.source ? ` _[${p.source}]_` : ''}`).join('\n')}`)
  if (r?.next) out.push(`**Next:** ${r.next}`)
  if (kids.length) out.push(`**Agents**\n\n${kids.map(k => `- **${k.label}** — ${firstSentence(reportOf(k)?.result ?? noReportReason(k), 160)}`).join('\n')}`)
  const full = n.result && !n.result.startsWith('{') ? n.result : ''
  if (full && full !== r?.result) out.push(`**Full report**\n\n${full}`)
  const task = taskText(n.prompt)
  if (task) out.push(`**Task it was given**\n\n> ${task.replace(/\n/g, '\n> ')}`)
  return out.join('\n\n').slice(0, 9000)
}

export const metaLine = (n: AgentNode, now: number) => [
  n.kind === 'workflow' ? 'Workflow' : n.kind === 'group' ? 'Cluster' : prettyModel(n.model) ?? 'Agent',
  duration((n.endedAt ?? now) - n.startedAt),
  clock(n.startedAt),
].filter(Boolean).join(' · ')

export const changeTotals = (files: FileRow[]) => ({
  added: files.reduce((a, f) => a + f.added, 0),
  removed: files.reduce((a, f) => a + f.removed, 0),
})
