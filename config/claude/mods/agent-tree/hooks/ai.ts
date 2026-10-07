import type { AgentNode, Brief, PatternCard } from '../types'
import { REPORT_RULES, capLines, reportOf } from './report'
import { childrenOf, fileRows, plain, prettyModel, scopeNodes } from './list'
import type { Step } from './trace'

// The AI layer: who may write what, the prompts, what each call reads (capped, so
// no call grows with the run or the history), and how each reply is read back.
// Pure: the hooks make the calls, the view draws what comes back.

// What the /config setting allows: nothing, Haiku only, or Haiku and Sonnet on demand.
export type AiMode = 'off' | 'cheap' | 'full'
export const AI_MODES: AiMode[] = ['off', 'cheap', 'full']
export type Tier = 'haiku' | 'sonnet'
export const aiAllows = (mode: AiMode, tier: Tier) => mode === 'full' || (mode === 'cheap' && tier === 'haiku')
export const TIER_NAME: Record<Tier, string> = { haiku: 'Haiku', sonnet: 'Sonnet' }

// The caps: one line, a whole input, how many rows a call reads.
export const STORY_STEPS_IN = 40
export const STORY_CAP = 3000
export const EXPLAIN_CAP = 6000
export const PATTERN_RUNS = 50
export const PATTERNS_CAP = 8000
const LINE = 300

const clip = (s: string | undefined, n = LINE) => plain(s ?? '').slice(0, n)

// ── story steps: what one agent did, in a few short steps ─────────────────────

export const STORY_SYSTEM = [
  'You turn the tool log of one AI agent into the few steps a person reads to follow what it did.',
  REPORT_RULES,
  'Write 3 to 8 steps, in the order they happened. Each step is one sentence that starts with a verb in the past tense.',
  'Group many small calls into one step. Name files and commands as the log gives them.',
  'Reply with JSON only, no markdown: {"steps": ["..."]}',
].join('\n')

// Each call in its own words (a shell call's own description), repeats folded, the beats
// that are not tool calls always kept, and the rest sampled evenly: at most 40 lines.
// A shell call with no description of its own reads as its command, not its first 40 characters.
const said = (e: Step) => (e.kind === 'tool' && e.summary.startsWith('Running ') && e.input ? `ran ${clip(e.input, 140)}` : e.summary)

export function storyLines(events: Step[], max = STORY_STEPS_IN): { lines: Step[]; dropped: number } {
  const folded: Step[] = []
  for (const e0 of events) {
    const e = { ...e0, summary: said(e0) }
    const last = folded[folded.length - 1]
    if (last && last.kind === e.kind && last.summary === e.summary) { last.count = (last.count ?? 1) + (e.count ?? 1); last.error = last.error || e.error; continue }
    folded.push({ ...e })
  }
  if (folded.length <= max) return { lines: folded, dropped: 0 }
  const beats = folded.filter(e => e.kind !== 'tool')
  const tools = folded.filter(e => e.kind === 'tool')
  const room = Math.max(0, max - beats.length)
  const every = tools.length / Math.max(1, room)
  const kept = new Set(Array.from({ length: Math.min(room, tools.length) }, (_, i) => tools[Math.floor(i * every)]!))
  const lines = folded.filter(e => e.kind !== 'tool' || kept.has(e)).slice(0, max)
  return { lines, dropped: folded.length - lines.length }
}

// The agent's task, its calls in their own words (at most 40), and what it reported, capped.
export function storyInput(n: AgentNode, events: Step[]): string {
  const { lines, dropped } = storyLines(events)
  const shown = lines.map(s => `- ${s.kind === 'tool' ? '' : `[${s.kind}] `}${clip(s.summary, 160)}${s.count && s.count > 1 ? ` (×${s.count})` : ''}${s.error ? ' [failed]' : ''}`)
  const more = dropped ? [`- … ${dropped} more calls not shown`] : []
  const said = reportOf(n)?.result ?? clip(n.result)
  return [
    `Agent: ${clip(n.label, 120)}`,
    `Task: ${clip(n.prompt)}`,
    '',
    'Tool log:',
    capLines([...shown, ...more], STORY_CAP),
    ...(said ? ['', `It reported: ${clip(said)}`] : []),
  ].join('\n')
}

const jsonOf = (raw: string): Record<string, unknown> | undefined => {
  const json = /\{[\s\S]*\}/.exec(raw)?.[0]
  if (!json) return undefined
  try { return JSON.parse(json) as Record<string, unknown> } catch { return undefined }
}
const texts = (x: unknown, n: number, max: number): string[] =>
  (Array.isArray(x) ? x : []).map(i => clip(typeof i === 'string' ? i : '', n)).filter(Boolean).slice(0, max)

// A reply as story steps: the JSON asked for, else its bulleted or numbered lines.
export function parseStory(raw: string): string[] | undefined {
  const d = jsonOf(raw)
  const fromJson = d ? texts(d.steps, 160, 8) : []
  if (fromJson.length) return fromJson
  const lines = raw.split('\n').map(l => /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/.exec(l)?.[1]).filter((l): l is string => !!l).map(l => clip(l, 160)).slice(0, 8)
  return lines.length ? lines : undefined
}

// ── explain this run: how the work hung together ─────────────────────────────

export const EXPLAIN_SYSTEM = [
  'You explain one finished or running piece of AI agent work to the person who asked for it.',
  'Write in Simplified Technical English, about 60% of the way:',
  '- One idea per sentence. At most 15 words in a sentence.',
  '- Use active voice and plain words. Name agents, files and numbers exactly as the input gives them.',
  '- No hedging, no filler, no praise. Use only facts in the input; write "unknown" when it does not say.',
  '- At most 250 words in total. At most 5 items in each list.',
  'Reply with JSON only, no markdown:',
  '{"goal": "1 sentence: what the work set out to do",',
  ' "who": [{"agent": "agent name", "did": "1 sentence"}],',
  ' "connected": "1 or 2 sentences: how the parts fed each other",',
  ' "outcome": "1 or 2 sentences: what it achieved",',
  ' "open": ["what is still open or wrong"]}',
  'The pane shows outcome first, as a heading. Its first sentence is the verdict: at most 12 words, with the key number.',
].join('\n')

// The run's own report, its part reports, each agent's steps or result, and what needs a look.
export function explainInput(run: AgentNode, nodes: AgentNode[], insights: string[]): string {
  const r = reportOf(run)
  const scope = scopeNodes(nodes, { kind: 'node', id: run.id })
  const agents = scope.filter(n => n.kind === 'agent').sort((a, b) => a.startedAt - b.startedAt)
  const parts = Object.entries(run.partReports ?? {}).map(([phase, p]) => `- ${phase} phase: ${clip(p.result) || 'unknown'}${p.problems?.length ? ` Problems: ${p.problems.map(x => x.text).join(' ')}` : ''}`)
  const agentLines = agents.map(a => {
    const steps = a.story?.steps?.length ? a.story.steps.join(' ') : reportOf(a)?.result ?? clip(a.result) ?? ''
    const parent = a.parentId && a.parentId !== run.id ? scope.find(p => p.id === a.parentId)?.label : undefined
    return `- ${a.label} [${a.status}${a.phase ? `, ${a.phase} phase` : ''}${parent ? `, started by ${parent}` : ''}]: ${clip(steps) || 'no report'}`
  })
  const files = fileRows(scope).map(f => `${f.path} (+${f.added} −${f.removed})`)
  return [
    `Run: ${clip(run.label, 200)} (${run.kind}, ${run.status})`,
    `Task: ${clip(run.prompt)}`,
    '',
    'Run report:',
    capLines([
      ...(r?.result ? [`- Result: ${clip(r.result)}`] : []),
      ...(r?.decisions ?? []).map(d => `- Decision: ${clip(d.text)}${d.source ? ` [${d.source}]` : ''}`),
      ...(r?.problems ?? []).map(p => `- Problem: ${clip(p.text)}${p.source ? ` [${p.source}]` : ''}`),
      ...(r?.next ? [`- Next: ${clip(r.next)}`] : []),
    ], 1500) || '- none',
    ...(parts.length ? ['', 'Part reports:', capLines(parts, 1500)] : []),
    '',
    `Agents (${agents.length}):`,
    capLines(agentLines, EXPLAIN_CAP - 3000),
    ...(files.length ? ['', `Files changed: ${capLines(files.map(f => `- ${f}`), 600)}`] : []),
    ...(insights.length ? ['', 'Needs a look:', capLines(insights.map(t => `- ${clip(t)}`), 600)] : []),
  ].join('\n').slice(0, EXPLAIN_CAP)
}

// A reply as a brief. Fields it cannot read are left out, never undefined.
export function parseBrief(raw: string): Omit<Brief, 'model' | 'at'> | undefined {
  const d = jsonOf(raw)
  if (!d) return undefined
  const out: Omit<Brief, 'model' | 'at'> = {}
  const goal = clip(typeof d.goal === 'string' ? d.goal : '')
  if (goal) out.goal = goal
  const who = (Array.isArray(d.who) ? d.who : []).flatMap(w => {
    if (typeof w === 'string') return clip(w) ? [clip(w)] : []
    const x = w as { agent?: unknown; did?: unknown } | null
    const did = clip(typeof x?.did === 'string' ? x.did : '')
    const agent = clip(typeof x?.agent === 'string' ? x.agent : '', 80)
    return did ? [agent ? `${agent}: ${did}` : did] : []
  }).slice(0, 5)
  if (who.length) out.who = who
  const connected = clip(typeof d.connected === 'string' ? d.connected : '')
  if (connected) out.connected = connected
  const outcome = clip(typeof d.outcome === 'string' ? d.outcome : '')
  if (outcome) out.outcome = outcome
  const open = texts(d.open, LINE, 5)
  if (open.length) out.open = open
  return Object.keys(out).length ? out : undefined
}

// ── patterns across runs ─────────────────────────────────────────────────────

export const PATTERNS_SYSTEM = [
  'You read a list of past AI agent runs and find what repeats: failures with one cause, files many runs change, costly agent types, slow phases.',
  'Write in Simplified Technical English, about 60% of the way: one idea per sentence, at most 15 words, active voice, plain words, exact names and numbers.',
  'Use only facts in the input. Each pattern must rest on at least 2 runs. No hedging, no filler.',
  'Write 2 to 4 patterns. Each has a short title, one evidence sentence with numbers, one concrete thing to try, and the exact names of the runs it rests on.',
  'Reply with JSON only, no markdown:',
  '{"patterns": [{"title": "", "evidence": "", "try": "", "runs": ["run name"]}]}',
].join('\n')

const durationText = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`)

// One compact row per run, newest first, at most 50 runs and 8,000 characters.
export function patternsInput(runs: AgentNode[], nodes: AgentNode[]): string {
  const rows = runs.slice(0, PATTERN_RUNS).map(run => {
    const scope = scopeNodes(nodes, { kind: 'node', id: run.id })
    const agents = scope.filter(n => n.kind === 'agent')
    const r = reportOf(run)
    const files = fileRows(scope)
    const models = [...new Set(agents.map(a => prettyModel(a.model)).filter(Boolean))].join('/')
    const tokens = agents.reduce((a, n) => a + (n.tokens ?? 0), 0) || run.tokens || 0
    const failed = agents.filter(a => a.status === 'failed' || a.status === 'killed').map(a => `${a.label} (${a.status === 'failed' ? 'failed' : 'stopped'}${reportOf(a)?.result ? `: ${clip(reportOf(a)!.result, 80)}` : ''})`)
    return clip([
      `- "${clip(run.label, 100)}" [${run.status}] ${run.kind}${run.kind !== 'agent' ? `, ${childrenOf(nodes, run.id).length} parts` : ''}`,
      models && `models ${models}`,
      tokens && `${Math.round(tokens / 1000)}k tokens`,
      run.endedAt && `${durationText(run.endedAt - run.startedAt)}`,
      files.length && `files ${files.slice(0, 4).map(f => f.path.split('/').pop()).join(', ')}${files.length > 4 ? ` +${files.length - 4}` : ''}`,
      r?.result && `result: ${clip(r.result, 120)}`,
      r?.problems?.length && `problems: ${r.problems.map(p => clip(p.text, 80)).join('; ')}`,
      failed.length && `failed: ${failed.join('; ')}`,
    ].filter(Boolean).join(' · '), LINE + 120)
  })
  const more = runs.length > PATTERN_RUNS ? [`- … ${runs.length - PATTERN_RUNS} older runs not shown`] : []
  return [`Runs, newest first (${Math.min(runs.length, PATTERN_RUNS)} of ${runs.length}):`, capLines([...rows, ...more], PATTERNS_CAP)].join('\n')
}

// A reply as pattern cards: each card keeps only the runs it names that exist, by id.
export function parsePatterns(raw: string, runs: AgentNode[]): PatternCard[] | undefined {
  const d = jsonOf(raw)
  if (!d) return undefined
  const byLabel = new Map(runs.map(r => [r.label.trim().toLowerCase(), r]))
  const cards = (Array.isArray(d.patterns) ? d.patterns : []).flatMap(p => {
    const x = p as { title?: unknown; evidence?: unknown; try?: unknown; runs?: unknown } | null
    const title = clip(typeof x?.title === 'string' ? x.title : '', 90)
    if (!title) return []
    const card: PatternCard = { title, runs: [] }
    const evidence = clip(typeof x?.evidence === 'string' ? x.evidence : '')
    if (evidence) card.evidence = evidence
    const tryIt = clip(typeof x?.try === 'string' ? x.try : '')
    if (tryIt) card.try = tryIt
    for (const name of texts(x?.runs, 200, 8)) {
      const hit = byLabel.get(name.trim().toLowerCase().replace(/^"|"$/g, ''))
      if (hit && !card.runs.some(r => r.id === hit.id)) card.runs.push({ id: hit.id, label: hit.label })
    }
    return [card]
  }).slice(0, 4)
  return cards.length ? cards : undefined
}

// "just now", "12m ago", "3h ago", "2d ago": how old an AI-written block is.
export function ago(ms: number): string {
  if (ms < 60_000) return 'just now'
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`
  if (ms < 48 * 3_600_000) return `${Math.round(ms / 3_600_000)}h ago`
  return `${Math.round(ms / 86_400_000)}d ago`
}
