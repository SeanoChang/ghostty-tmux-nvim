import type { AgentNode, Brief, NodeStatus, Report } from '../../types'
import { ago } from '../ai'
import { firstSentence, noReportReason, prettyModel, shortPaths, taskText, type FileRow } from '../list'
import { reportFacts, reportOf, kTokens } from '../report'
import { DESK, SPRITE_FOR, clip, diffBarSvg, iconSvg, spriteSvg, statusColor, type DeskTokens } from './svg'

// Small pieces the desktop view is made of. Each takes the surface's element table
// and returns a tree; none of them touches $.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Els = Record<string, any>

export const STATUS_WORD: Record<NodeStatus, string> = { running: 'Running', done: 'Done', failed: 'Failed', killed: 'Stopped' }

export const tokensOf = (theme: 'kitty' | 'minimal'): DeskTokens => DESK[theme]

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

// One status mark: a pixel cat in kitty, a line icon in minimal. Quiet agents sleep.
export function StatusMark(els: Els, t: DeskTokens, status: NodeStatus, px = 16, isQuiet = false) {
  const { Svg } = els
  const word = isQuiet ? 'Quiet' : STATUS_WORD[status]
  if (t.name === 'kitty') return <Svg source={spriteSvg(isQuiet ? 'quiet' : SPRITE_FOR[status], px)} alt={word} width={px} height={px} />
  const name = isQuiet ? 'quiet' : status
  return <Svg source={iconSvg(name, isQuiet ? t.warn : statusColor(t, status), px)} alt={word} width={px} height={px} />
}

// What a row holds: workflows and clusters get a mark, a plain agent none.
export function KindMark(els: Els, t: DeskTokens, kind: AgentNode['kind'], px = 16) {
  const { Svg } = els
  if (kind === 'agent') return null
  const alt = kind === 'workflow' ? 'Workflow' : 'Cluster'
  if (t.name === 'kitty') return <Svg source={spriteSvg(kind === 'workflow' ? 'yarn' : 'pile', px)} alt={alt} width={px} height={px} />
  return <Svg source={iconSvg(kind === 'workflow' ? 'workflow' : 'group', t.muted, px)} alt={alt} width={px} height={px} />
}

export function Chip(els: Els, t: DeskTokens, text: string, color?: string) {
  const { Box, Text } = els
  return (
    <Box borderStyle="round" borderColor={color ?? t.rule} paddingX={1}>
      <Text color={color ?? t.muted}>{text}</Text>
    </Box>
  )
}

export function SectionLabel(els: Els, t: DeskTokens, text: string) {
  const { Text } = els
  return <Text color={t.muted} bold>{text.toUpperCase()}</Text>
}

// The empty state: a scene in kitty, a calm line in minimal.
export function Empty(els: Els, t: DeskTokens, title: string, hint: string) {
  const { Box, Text, Svg } = els
  return (
    <Box flexDirection="column" alignItems="center" paddingY={2} gap={1}>
      {t.name === 'kitty'
        ? <Svg source={spriteSvg('scene', 128)} alt="A cat asleep on a keyboard" width={128} height={80} />
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
  return <Markdown key={key} text={`#### ${mdText(text)}`} />
}

// "the agent it came from", only when it adds something the line does not say.
const sourceNote = (source: string | undefined, self: string) =>
  source && source.toLowerCase() !== self.toLowerCase() ? ` — _${mdText(source)}_` : ''

export function ReportBlock(els: Els, t: DeskTokens, n: AgentNode, all: AgentNode[], now: number, parts: Part[], onPart: (id: string) => void, partsBy = '') {
  const { Box, Text, Button, Svg, Markdown } = els
  const r: Report | undefined = reportOf(n)
  const facts = reportFacts(all, { kind: 'node', id: n.id }, now)
  const names = shortPaths(facts.files.map(f => f.path))
  const max = Math.max(1, ...facts.files.map(f => f.added + f.removed))
  const result = r?.result ?? (n.status === 'running' ? 'Still working.' : noReportReason(n))
  // the verdict is the first sentence, drawn large; the rest of the result follows as body text
  const verdict = firstSentence(result, 300)
  const rest = result.slice(result.indexOf(verdict) + verdict.length).trim()
  const by = r?.model ? `Report by ${aiLabel(r, now)}` : n.report ? 'Report' : 'Report from what the run kept (no model summary)'
  const details = [
    r?.done?.length ? `#### What it did\n\n${r.done.map(d => `- ${mdText(d)}`).join('\n')}` : '',
    r?.decisions?.length ? `#### Decisions\n\n${r.decisions.map(d => `- ${mdText(d.text)}${sourceNote(d.source, n.label)}`).join('\n')}` : '',
    r?.next ? `#### Next step\n\n${mdText(r.next)}` : '',
  ].filter(Boolean).join('\n\n')
  return (
    <Box flexDirection="column" gap={1}>
      <Markdown key="verdict" text={`### ${mdText(verdict)}${rest ? `\n\n${mdText(rest)}` : ''}`} />
      {r?.problems?.length
        ? (
          <Box key="attention" flexDirection="column" borderStyle="round" borderColor={t.bad} paddingX={1}>
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
      <Box key="totals" flexDirection="column">
        <Text color={t.muted}>{[
          facts.phases ? `${facts.phases} phases` : '',
          `${facts.agents} agent${facts.agents === 1 ? '' : 's'}`,
          `${facts.files.length} file${facts.files.length === 1 ? '' : 's'} changed`,
          facts.files.length ? `+${num(facts.added)} −${num(facts.removed)}` : '',
          duration(facts.ms),
          facts.tokens ? `${kTokens(facts.tokens)} tokens` : '',
        ].filter(Boolean).join('  ·  ')}</Text>
        <Text color={t.muted}>{by}</Text>
      </Box>
    </Box>
  )
}

// "Explain this run": Sonnet's brief, with who wrote it, or that it is being written.
// Outcome and open issues lead; how the work went follows.
export function BriefBlock(els: Els, t: DeskTokens, b: Brief | undefined, writing: boolean, now: number) {
  const { Box, Text, Markdown } = els
  const label = writing ? 'Explain · Sonnet is writing…' : `Explain · by ${aiLabel(b, now)}`
  const md = !b ? '' : [
    b.outcome ? `### ${mdText(b.outcome)}` : '',
    b.open?.length ? `#### Still open\n\n${b.open.map(o => `- ${mdText(o)}`).join('\n')}` : '',
    b.goal ? `#### Goal\n\n${mdText(b.goal)}` : '',
    b.who?.length ? `#### Who did what\n\n${b.who.map(w => `- ${mdText(w)}`).join('\n')}` : '',
    b.connected ? `#### How the parts connect\n\n${mdText(b.connected)}` : '',
  ].filter(Boolean).join('\n\n')
  return (
    <Box flexDirection="column" gap={1} borderStyle="round" borderColor={t.accent} paddingX={1}>
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
