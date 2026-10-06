import type { AgentNode, NodeStatus, Report } from '../../types'
import { firstSentence, noReportReason, prettyModel, shortPaths, taskText, type FileRow } from '../list'
import { reportFacts, reportOf, kTokens } from '../report'
import { DESK, SPRITE_FOR, clip, diffBarSvg, iconSvg, spriteSvg, statusColor, type DeskTokens } from './svg'

// Small pieces the desktop view is made of. Each takes the surface's element table
// and returns a tree; none of them touches $.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Els = Record<string, any>

export const STATUS_WORD: Record<NodeStatus, string> = { running: 'Running', done: 'Done', failed: 'Failed', killed: 'Stopped' }

export const tokensOf = (theme: 'kitty' | 'minimal'): DeskTokens => DESK[theme]

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

// ── the report: Result, Parts, Decisions, Problems, Next, Changed, Totals ─────
// Changed and Totals come from records, never from the model.
// A part of a run: a workflow phase or a cluster member, with its own short result.
export type Part = { id: string; label: string; status: NodeStatus; result: string; meta?: string }

export function ReportBlock(els: Els, t: DeskTokens, n: AgentNode, all: AgentNode[], now: number, parts: Part[], onPart: (id: string) => void) {
  const { Box, Text, Button, Svg } = els
  const r: Report | undefined = reportOf(n)
  const facts = reportFacts(all, { kind: 'node', id: n.id }, now)
  const names = shortPaths(facts.files.map(f => f.path))
  const max = Math.max(1, ...facts.files.map(f => f.added + f.removed))
  const label = r?.model ? `${n.report ? 'Report' : 'Report · from what the run kept'} · ${r.model}${r.tokens ? ` · ${kTokens(r.tokens)} tokens` : ''}` : n.report ? 'Report' : 'Report · from what the run kept'
  const row = (name: string, body: unknown) => (
    <Box flexDirection="row" gap={2}>
      <Box width={10}><Text color={t.muted} bold>{name}</Text></Box>
      <Box flexDirection="column" flexGrow={1}>{body}</Box>
    </Box>
  )
  return (
    <Box flexDirection="column" gap={1}>
      <Text color={t.muted}>{label}</Text>
      {row('Result', <Text bold>{r?.result ?? (n.status === 'running' ? 'Still working.' : noReportReason(n))}</Text>)}
      {parts.length
        ? row('Parts', <Box flexDirection="column">{parts.map(p => (
          <Box key={`part-${p.id}`} flexDirection="row" gap={1}>
            {StatusMark(els, t, p.status)}
            <Button key={`part:${p.id}`} plain label={clip(p.label, 34)} onPress={() => onPart(p.id)} />
            <Text color={t.muted}>{clip(p.result, 70)}</Text>
            {p.meta ? <Text color={t.muted}>{p.meta}</Text> : null}
          </Box>
        ))}</Box>)
        : r?.done?.length ? row('Done', <Box flexDirection="column">{r.done.map((d, i) => <Text key={`done-${i}`}>• {d}</Text>)}</Box>) : null}
      {r?.decisions?.length ? row('Decisions', <Box flexDirection="column">{r.decisions.map((d, i) => <Text key={`dec-${i}`}>• {d.text}{d.source ? <Text color={t.muted}> [{d.source}]</Text> : ''}</Text>)}</Box>) : null}
      {r?.problems?.length ? row('Problems', <Box flexDirection="column">{r.problems.map((p, i) => <Text key={`prob-${i}`} color={t.bad}>• <Text>{p.text}</Text>{p.source ? <Text color={t.muted}> [{p.source}]</Text> : ''}</Text>)}</Box>) : null}
      {r?.next ? row('Next', <Text>{r.next}</Text>) : null}
      {facts.files.length
        ? row('Changed', <Box flexDirection="column">{facts.files.slice(0, 8).map(f => (
          <Box key={`chg-${f.path}`} flexDirection="row" gap={1}>
            <Box width={26}><Text wrap="truncate-start">{names.get(f.path) ?? f.path}</Text></Box>
            <Svg source={diffBarSvg(t, f.added, f.removed, max)} alt={`+${f.added} −${f.removed}`} width={60} height={6} />
            <Text color={t.add}>+{num(f.added)}</Text><Text color={t.del}>−{num(f.removed)}</Text>
          </Box>
        ))}{facts.files.length > 8 ? <Text color={t.muted}>and {facts.files.length - 8} more files</Text> : null}</Box>)
        : null}
      {row('Totals', <Text color={t.muted}>{[
        facts.phases ? `${facts.phases} phases` : '',
        `${facts.agents} agent${facts.agents === 1 ? '' : 's'}`,
        `${facts.files.length} file${facts.files.length === 1 ? '' : 's'}`,
        `+${num(facts.added)} −${num(facts.removed)}`,
        duration(facts.ms),
        facts.tokens ? `${kTokens(facts.tokens)} tokens` : '',
      ].filter(Boolean).join('  ·  ')}</Text>)}
    </Box>
  )
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
