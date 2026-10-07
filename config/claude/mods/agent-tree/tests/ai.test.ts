import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import {
  EXPLAIN_CAP, EXPLAIN_SYSTEM, PATTERNS_CAP, PATTERNS_SYSTEM, STORY_SYSTEM, STORY_STEPS_IN, aiAllows, explainInput, parseBrief,
  parsePatterns, parseStory, patternsInput, storyInput,
} from '../hooks/ai'
import { REPORT_SYSTEM } from '../hooks/report'
import { cellWidth } from '../hooks/theme'
import type { Step } from '../hooks/trace'
import type { AgentNode } from '../types'
import { SUBAGENT_TRANSCRIPT } from './fixtures/trace-rows'

const KEY = 'tree-v7'
const PANE = {
  component: 'Pane' as const,
  requestId: 'agent-tree',
  props: { title: 'Agents', isFocused: true, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 36 } } as never,
  viewport: { columns: 110, rows: 40 },
}
const usage = { input_tokens: 500, output_tokens: 140, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const spawnBase = { provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false } as const
const NOW = Date.parse('2026-10-06T12:00:00Z')
const HOUR = 3_600_000
const DAY = 24 * HOUR
const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never

type Drawn = { children?: unknown[] }
function leaves(x: unknown, out: string[] = []): string[] {
  if (typeof x === 'string' || typeof x === 'number') { out.push(String(x)); return out }
  for (const k of (x as Drawn)?.children ?? []) leaves(k, out)
  return out
}
const textRows = async (ui: { drawn: (s: { in: string }) => Promise<unknown> }) => {
  const tree = await ui.drawn({ in: KEY }) as Drawn
  const middle = tree.children?.[1] as Drawn
  return (((middle.children?.[1] as Drawn).children ?? []) as unknown[]).map(r => leaves(r).join(''))
}

// Every model call the plugin makes, with the reply each kind of prompt gets.
type Call = { model: string; system?: string; prompt: string }
function models(on: On, calls: Call[]) {
  on('model.complete', (_$, e) => {
    calls.push({ model: e.model, system: e.system, prompt: e.prompt })
    const text = e.system === STORY_SYSTEM ? '{"steps":["Read the cart files.","Ran the cart tests; one failed.","Fixed total.ts to multiply by quantity."]}'
      : e.system === REPORT_SYSTEM ? '{"result":"Cart totals now multiply by quantity.","problems":[{"text":"The price formatter is still unchecked.","source":"Fix cart totals"}]}'
        : e.system === EXPLAIN_SYSTEM ? JSON.stringify({ goal: 'Fix how the cart adds up prices.', who: [{ agent: 'Fix cart totals', did: 'Made totals multiply by quantity.' }, { agent: 'Check the formatter', did: 'Confirmed two decimals.' }], connected: 'The totals fix fed the formatter check.', outcome: 'Cart totals are right.', open: ['The email check has no test.'] })
          : e.system === PATTERNS_SYSTEM ? JSON.stringify({ patterns: [{ title: 'Verifiers time out on big files', evidence: '3 of 9 verify runs ran out of turns on files over 2,000 lines.', try: 'Raise maxTurns for verify agents.', runs: ['Run 3', 'Run 7', 'Not a run'] }, { title: 'cart.ts changes often', evidence: '4 runs edited cart.ts.', try: 'Add a cart test first.', runs: ['Run 5'] }] })
            : 'Fix the cart'
    return { value: { isAnswered: true, usage, text } } as never
  })
}

// A turn that spawns two agents (a cluster), each with a transcript on disk, and ends them.
async function clusterLifecycle($: Engine, on: On, calls: Call[]) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  models(on, calls)
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('agent.spawn', (_$, e) => ({ model: 'claude-haiku-4-5', agentId: `ag-${e.tool_use_id}` }))
  on('prompt.submit', () => ({ text: '' }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('session.root', () => ({ value: '/repo/a' }) as never)
  on('env.get', () => ({ value: '/home/u' }) as never)
  on('fs.exists', () => ({ value: false }) as never)
  on('process.run', (_$, e) => (e.argv[0] === 'find' ? ok('/p/agent-ag-t0.jsonl\n/p/agent-ag-t1.jsonl\n') : ok('/repo/a\n')))
  on('fs.stat', () => ({ value: { kind: 'file', size: 4000, mtimeMs: 1, isLink: false } }) as never)
  on('fs.read', (_$, e) => (e.path.startsWith('/p/agent-') ? { value: SUBAGENT_TRANSCRIPT } : { deny: 'missing' }))
  await $.prompt.submit({ text: 'fix the cart', origin: { kind: 'user' }, wait: false } as never)
  await Promise.all(['Fix cart totals', 'Check the formatter'].map((d, i) => $.agent.spawn({ ...spawnBase, tool_use_id: `t${i}`, prompt: `${d} in src/cart`, description: d, subagentType: 'general-purpose' } as never)))
  await clock.advance(100)
  for (const id of ['ag-t0', 'ag-t1']) {
    await $.turn.complete({ agentId: id, answer: `${id} fixed the cart totals.`, durationMs: 1000, isAborted: false, reason: 'answer', usage } as never)
  }
  for (let k = 0; k < 6; k++) await clock.advance(10)
  return clock
}

// ── pure parts ───────────────────────────────────────────────────────────────

test('the setting decides who may write: off nobody, cheap Haiku, full Haiku and Sonnet', () => {
  expect([aiAllows('off', 'haiku'), aiAllows('off', 'sonnet')]).toEqual([false, false])
  expect([aiAllows('cheap', 'haiku'), aiAllows('cheap', 'sonnet')]).toEqual([true, false])
  expect([aiAllows('full', 'haiku'), aiAllows('full', 'sonnet')]).toEqual([true, true])
})

test('replies parse into steps, a brief and pattern cards; inputs stay capped', () => {
  expect(parseStory('{"steps":["Read a.ts.","Ran tests."]}')).toEqual(['Read a.ts.', 'Ran tests.'])
  expect(parseStory('Here:\n1. Read a.ts.\n2. Ran tests.')).toEqual(['Read a.ts.', 'Ran tests.'])
  expect(parseStory('nothing useful')).toBeUndefined()
  const brief = parseBrief('{"goal":"G.","who":[{"agent":"A","did":"Did X."},"B: did Y."],"open":[]}')!
  expect(brief).toEqual({ goal: 'G.', who: ['A: Did X.', 'B: did Y.'] })
  const runs = [{ id: 'r1', label: 'Run 1' }, { id: 'r2', label: 'Run 2' }] as AgentNode[]
  const cards = parsePatterns('{"patterns":[{"title":"T","runs":["run 1","Ghost"]}]}', runs)!
  expect(cards[0]!.runs).toEqual([{ id: 'r1', label: 'Run 1' }]) // only runs that exist, matched without case
  // a story reads at most 40 steps, capped in characters
  const steps: Step[] = Array.from({ length: 120 }, (_, i) => ({ agentId: 'a', at: i, kind: 'tool', name: 'Bash', summary: `step ${i} ${'x'.repeat(150)}` }))
  const input = storyInput({ id: 'a', kind: 'agent', label: 'A', status: 'done', startedAt: 0, tools: 1, prompt: 'p'.repeat(5000) }, steps)
  expect(input.length).toBeLessThanOrEqual(3000 + 1200)
  expect(input).not.toContain(`step ${STORY_STEPS_IN} `)
})

// ── the setting, across a run's whole life ─────────────────────────────────────

test('ai off: no model call at all, from spawn to report; the report says AI is off', { options: { ai: 'off' } }, async ($, on) => {
  const calls: Call[] = []
  await clusterLifecycle($, on, calls)
  expect(calls.length).toBe(0)
  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
  await ui.key({ in: KEY, key: '2' })
  await ui.key({ in: KEY, key: 'return' })
  await ui.key({ in: KEY, key: 'o' })
  const rows = await textRows(ui)
  expect(rows.some(r => r.includes('AI is off · from records'))).toBe(true)
  expect(rows.some(r => r.includes('AI is off: no written report.'))).toBe(true)
  expect(rows.some(r => r.includes('Totals') && r.includes('2 agents'))).toBe(true)
  // e says how to turn Sonnet on, and asks nothing
  await ui.key({ in: KEY, key: 'e' })
  expect(await ui.find({ in: KEY, text: /Explain needs ai: full in \/config/ })).toBeDefined()
  expect(calls.length).toBe(0)
  await ui.unmount()
})

test('ai cheap: Haiku writes titles, reports and story steps; Sonnet is never asked', async ($, on) => {
  const calls: Call[] = []
  await clusterLifecycle($, on, calls)
  expect(calls.length).toBeGreaterThan(0)
  expect(calls.every(c => c.model === 'haiku')).toBe(true)
  expect(calls.some(c => c.system === STORY_SYSTEM)).toBe(true)
  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
  await ui.key({ in: KEY, key: '2' })
  await ui.key({ in: KEY, key: 'g' })
  expect(await ui.find({ in: KEY, text: /Patterns need ai: full/ })).toBeDefined()
  await ui.key({ in: KEY, key: 'return' })
  await ui.key({ in: KEY, key: 'e' })
  expect(await ui.find({ in: KEY, text: /Explain needs ai: full/ })).toBeDefined()
  expect(calls.every(c => c.model === 'haiku')).toBe(true)
  // the History header counts what the AI layer spent this week
  await ui.key({ in: KEY, key: 'b' })
  expect(await ui.find({ in: KEY, text: /AI:? [\d.]+k (tokens )?this week/ })).toBeDefined()
  await ui.unmount()
})

test('story steps are written once, kept on the agent, and shown at the Story zoom with who wrote them', async ($, on) => {
  const calls: Call[] = []
  const clock = await clusterLifecycle($, on, calls)
  const stories = calls.filter(c => c.system === STORY_SYSTEM)
  expect(stories.length).toBe(2) // one per agent, never again
  expect(stories[0]!.prompt).toContain('Tool log:')
  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
  await ui.key({ in: KEY, key: '2' })
  await ui.key({ in: KEY, key: 'return' })
  for (let k = 0; k < 3; k++) await ui.key({ in: KEY, key: 'v' }) // tree → board → timeline → trace
  await ui.advance(600)
  await clock.advance(10)
  expect(await ui.find({ in: KEY, text: /Fixed total\.ts to multiply by quantity\./ })).toBeDefined()
  expect(await ui.find({ in: KEY, text: /Story · Haiku · 1\.3k tokens/ })).toBeDefined()
  // Steps shows the tool calls again, not the story
  await ui.key({ in: KEY, key: 'z' })
  await ui.advance(600)
  expect(await ui.find({ in: KEY, text: /Fixed total\.ts to multiply/ })).toBeUndefined()
  expect(calls.filter(c => c.system === STORY_SYSTEM).length).toBe(2)
  await ui.unmount()
})

describe('ai full', () => {
  test('Sonnet is asked only when e or g is pressed', { options: { ai: 'full' } }, async ($, on) => {
    const calls: Call[] = []
    const clock = await clusterLifecycle($, on, calls)
    expect(calls.every(c => c.model === 'haiku')).toBe(true)
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
    await ui.key({ in: KEY, key: '2' })
    await ui.key({ in: KEY, key: 'return' })
    await ui.key({ in: KEY, key: 'e' })
    await clock.advance(10)
    expect(calls.filter(c => c.model === 'sonnet').length).toBe(1)
    expect(calls.find(c => c.model === 'sonnet')!.system).toBe(EXPLAIN_SYSTEM)
    await ui.unmount()
  })

  test('e writes a brief: its sections show in Output with who wrote it; a second e within 3 s writes it again', { options: { ai: 'full' } }, async ($, on) => {
    const calls: Call[] = []
    const clock = await clusterLifecycle($, on, calls)
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
    await ui.key({ in: KEY, key: '2' })
    await ui.key({ in: KEY, key: 'return' })
    await ui.key({ in: KEY, key: 'e' })
    await clock.advance(10)
    const rows = await textRows(ui)
    expect(rows.some(r => /Explain +Sonnet · 640 tokens · just now/.test(r))).toBe(true)
    for (const label of ['Goal', 'Who did what', 'How it connected', 'Outcome', 'Open issues']) expect(rows.some(r => r.includes(label))).toBe(true)
    expect(rows.some(r => r.includes('Fix cart totals: Made totals multiply by quantity.'))).toBe(true)
    const explain = calls.filter(c => c.system === EXPLAIN_SYSTEM)
    expect(explain.length).toBe(1)
    expect(explain[0]!.prompt.length).toBeLessThanOrEqual(EXPLAIN_CAP)
    expect(explain[0]!.prompt).toContain('Agents (2):')
    // with a brief there, e asks first; a second e writes it again
    await ui.key({ in: KEY, key: 'e' })
    expect(await ui.find({ in: KEY, text: /Press e again to write a new brief/ })).toBeDefined()
    expect(calls.filter(c => c.system === EXPLAIN_SYSTEM).length).toBe(1)
    await ui.key({ in: KEY, key: 'e' })
    await clock.advance(10)
    expect(calls.filter(c => c.system === EXPLAIN_SYSTEM).length).toBe(2)
    await ui.unmount()
  })

  test('the explain input is capped however big the run', () => {
    const run: AgentNode = { id: 'w', kind: 'workflow', label: 'Big', status: 'done', startedAt: 0, tools: 0, prompt: 'p'.repeat(9000) }
    const kids: AgentNode[] = Array.from({ length: 200 }, (_, i) => ({ id: `k${i}`, parentId: 'w', kind: 'agent', label: `agent ${i}`, status: 'done', startedAt: i, tools: 1, result: 'r'.repeat(5000) }))
    expect(explainInput(run, [run, ...kids], Array.from({ length: 50 }, () => 'i'.repeat(400))).length).toBeLessThanOrEqual(EXPLAIN_CAP)
  })
})

// ── patterns across runs ───────────────────────────────────────────────────────

const pastRuns = (n: number, at = NOW - DAY): AgentNode[] => Array.from({ length: n }, (_, i) => ({
  id: `r${i}`, kind: 'agent', label: `Run ${i}`, status: i % 3 === 0 ? 'failed' : 'done', startedAt: at - i * HOUR, endedAt: at - i * HOUR + 60_000, tools: 3,
  tokens: 20_000, model: 'claude-haiku-4-5', repo: '/repo/a', result: `Run ${i} result ${'x'.repeat(400)}`,
}))

function historyMocks(on: On, calls: Call[], extra: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, { history: pastRuns(60), ...extra })
  models(on, calls)
  on('session.root', () => ({ value: '/repo/a' }) as never)
  on('process.run', () => ok('/repo/a\n'))
  on('env.get', () => ({ value: '/home/u' }) as never)
  on('command.register', () => ({ value: undefined }) as never)
  on('session.start', () => ({ cwd: '/repo/a' }) as never)
  return clock
}

test('g writes patterns from at most 50 runs, capped; cards show their evidence, what to try, and open their runs', { options: { ai: 'full' } }, async ($, on) => {
  const calls: Call[] = []
  const clock = historyMocks(on, calls)
  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
  await ui.key({ in: KEY, key: '2' })
  expect(await ui.find({ in: KEY, text: /Patterns across runs +g asks Sonnet to look for patterns/ })).toBeDefined()
  await ui.key({ in: KEY, key: 'g' })
  await clock.advance(10)
  const asked = calls.filter(c => c.system === PATTERNS_SYSTEM)
  expect(asked.length).toBe(1)
  expect(asked[0]!.model).toBe('sonnet')
  expect(asked[0]!.prompt.length).toBeLessThanOrEqual(PATTERNS_CAP + 200)
  expect(asked[0]!.prompt).toContain('(50 of 60)')
  expect(asked[0]!.prompt).not.toContain('"Run 55"')
  expect(await ui.find({ in: KEY, text: /Patterns across runs +Sonnet · 640 tokens · just now/ })).toBeDefined()
  expect(await ui.find({ in: KEY, text: /Verifiers time out on big files/ })).toBeDefined()
  expect(await ui.find({ in: KEY, text: /3 of 9 verify runs ran out of turns/ })).toBeDefined()
  expect(await ui.find({ in: KEY, text: /Try: Raise maxTurns for verify agents\./ })).toBeDefined()
  expect(await ui.find({ in: KEY, text: /↳ .*Run 3/ })).toBeDefined()
  expect(await ui.find({ in: KEY, text: /Not a run/ })).toBeUndefined()
  // the first row that can be picked is the first card's first run: enter opens it
  await ui.key({ in: KEY, key: 'return' })
  expect(await ui.find({ in: KEY, text: /›  Run 3/ })).toBeDefined()
  // p hides the cards, and g twice writes them again
  await ui.key({ in: KEY, key: 'b' })
  await ui.key({ in: KEY, key: 'p' })
  expect(await ui.find({ in: KEY, text: /Verifiers time out/ })).toBeUndefined()
  await ui.key({ in: KEY, key: 'g' })
  expect(await ui.find({ in: KEY, text: /Press g again/ })).toBeDefined()
  await ui.key({ in: KEY, key: 'g' })
  await clock.advance(10)
  expect(calls.filter(c => c.system === PATTERNS_SYSTEM).length).toBe(2)
  await ui.unmount()
})

test('patterns input keeps the newest 50 runs and stays under its cap', () => {
  const runs = pastRuns(80)
  const input = patternsInput(runs, runs)
  expect(input.length).toBeLessThanOrEqual(PATTERNS_CAP + 200)
  expect(input).toContain('"Run 0"')
  expect(input).not.toContain('"Run 50"')
})

describe('weekly refresh', () => {
  const doc = (at: number) => ({ patterns: { '-repo-a': { cards: [{ title: 'Old pattern', runs: [] }], model: 'Sonnet', at } } })
  const start = ($: Engine) => $.session.start({ cwd: '/repo/a', surface: 'terminal', isInteractive: true } as never)

  test('on Full, patterns older than a week are written again at session start', { options: { ai: 'full' } }, async ($, on) => {
    const calls: Call[] = []
    const clock = historyMocks(on, calls, doc(NOW - 8 * DAY))
    await start($)
    await clock.advance(10)
    expect(calls.filter(c => c.system === PATTERNS_SYSTEM).length).toBe(1)
  })

  test('patterns from this week, or AI below Full, are left alone', { options: { ai: 'full' } }, async ($, on) => {
    const calls: Call[] = []
    const clock = historyMocks(on, calls, doc(NOW - 2 * DAY))
    await start($)
    await clock.advance(10)
    expect(calls.filter(c => c.system === PATTERNS_SYSTEM).length).toBe(0)
  })

  test('on Cheap a stale set is not written again', async ($, on) => {
    const calls: Call[] = []
    const clock = historyMocks(on, calls, doc(NOW - 30 * DAY))
    await start($)
    await clock.advance(10)
    expect(calls.length).toBe(0)
  })
})

test('a report says who wrote it, what it cost and how old it is', async ($, on) => {
  const calls: Call[] = []
  const clock = await clusterLifecycle($, on, calls)
  await clock.advance(2 * HOUR)
  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
  await ui.key({ in: KEY, key: '2' })
  await ui.key({ in: KEY, key: 'return' })
  await ui.key({ in: KEY, key: 'o' })
  const rows = await textRows(ui)
  expect(rows.some(r => /Report +Haiku · 640 tokens · 2h ago/.test(r))).toBe(true)
  expect(rows.every(r => cellWidth(r) <= 110)).toBe(true)
  await ui.unmount()
})
