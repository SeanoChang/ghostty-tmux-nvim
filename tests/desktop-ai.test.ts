import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { EXPLAIN_SYSTEM, PATTERNS_SYSTEM, STORY_SYSTEM } from '../hooks/ai'
import { REPORT_SYSTEM } from '../hooks/report'
import type { AgentNode } from '../types'
import { SUBAGENT_TRANSCRIPT } from './fixtures/trace-rows'

// The AI layer on the desktop's native view: labels on every AI block, Explain this
// run, patterns across runs, the AI pill, and story steps in the trace.

const PANE = {
  component: 'Pane' as const,
  requestId: 'agent-tree',
  props: { title: 'Agents', isFocused: true, bodyColumns: 130, placement: 'dock', scroll: { offset: 0, bodyRows: 40 } } as never,
  viewport: { columns: 130, rows: 44 },
}
const usage = { input_tokens: 500, output_tokens: 140, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const spawnBase = { provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false } as const
const NOW = Date.parse('2026-10-06T12:00:00Z')
const HOUR = 3_600_000
const DAY = 24 * HOUR
const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never

type El = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
const kids = (x: unknown): unknown[] => {
  const el = x as El
  const c = el?.children ?? (el?.props?.children as unknown)
  return Array.isArray(c) ? c : c === undefined || c === null ? [] : [c]
}
const leaf = (x: unknown): string => (typeof x === 'string' || typeof x === 'number' ? String(x) : kids(x).map(leaf).join(''))
type Mounted = { drawn: () => Promise<unknown> }
// every Text's whole words, and every element's key, as drawn now
async function texts(ui: Mounted): Promise<string[]> {
  const out: string[] = []
  const walk = (x: unknown) => {
    const el = x as El
    if (el?.type === 'Text') out.push(leaf(el))
    else kids(x).forEach(walk)
  }
  walk(await ui.drawn())
  return out
}
async function keys(ui: Mounted): Promise<string[]> {
  const out: string[] = []
  const walk = (x: unknown) => {
    const el = x as El
    const k = el?.props?.key
    if (typeof k === 'string') out.push(k)
    kids(x).forEach(walk)
  }
  walk(await ui.drawn())
  return out
}
const has = async (ui: Mounted, re: RegExp) => (await texts(ui)).some(t => re.test(t))

type Call = { model: string; system?: string }
// Every model call, with the reply each kind of prompt gets. `hold` keeps Sonnet's
// replies waiting until released, so the "writing" state can be seen.
function models(on: On, calls: Call[], hold?: { release?: () => void }) {
  on('model.complete', (_$, e) => {
    calls.push({ model: e.model, system: e.system })
    const text = e.system === STORY_SYSTEM ? '{"steps":["Read the cart files.","Ran the cart tests; one failed.","Fixed total.ts to multiply by quantity."]}'
      : e.system === REPORT_SYSTEM ? '{"result":"Cart totals now multiply by quantity."}'
        : e.system === EXPLAIN_SYSTEM ? JSON.stringify({ goal: 'Fix how the cart adds up prices.', who: [{ agent: 'Fix cart totals', did: 'Made totals multiply by quantity.' }], connected: 'The totals fix fed the formatter check.', outcome: 'Cart totals are right.', open: ['The email check has no test.'] })
          : e.system === PATTERNS_SYSTEM ? JSON.stringify({ patterns: [{ title: 'Verifiers time out on big files', evidence: '3 of 9 verify runs ran out of turns.', try: 'Raise maxTurns for verify agents.', runs: ['Run 3'] }] })
            : 'Fix the cart'
    const value = { value: { isAnswered: true, usage, text } } as never
    if (hold && e.model === 'sonnet') return new Promise(resolve => { hold.release = () => resolve(value) })
    return value
  })
}

// A turn that spawns a cluster of two agents with transcripts on disk, and ends them.
async function cluster($: Engine, on: On, calls: Call[], hold?: { release?: () => void }) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  models(on, calls, hold)
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

// Open the cluster's run from History on the desktop.
async function openCluster(ui: Mounted & { press: (t: { key: string }) => Promise<unknown> }) {
  await ui.press({ key: 'tab:history' })
  const run = (await keys(ui)).find(k => k.startsWith('run:grp:'))
  expect(run).toBeDefined()
  await ui.press({ key: run! })
}

describe('desktop AI', () => {
  test('the header shows the AI setting as a pill, with where to change it', async ($, on) => {
    const calls: Call[] = []
    await cluster($, on, calls)
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'desktop', ...PANE })
    expect(await has(ui, /^AI · cheap$/)).toBe(true)
    expect(await has(ui, /change in \/config/)).toBe(true)
    await ui.unmount()
  })

  test('reports and part labels say who wrote them, what it cost and how old they are', async ($, on) => {
    const calls: Call[] = []
    const clock = await cluster($, on, calls)
    await clock.advance(2 * HOUR)
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'desktop', ...PANE })
    await openCluster(ui)
    expect(await has(ui, /^Report · Haiku · 640 tokens · 2h ago$/)).toBe(true)
    await ui.unmount()
  })

  test('below Full, Explain does not ask Sonnet; it says how to turn it on', async ($, on) => {
    const calls: Call[] = []
    await cluster($, on, calls)
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'desktop', ...PANE })
    await openCluster(ui)
    await ui.press({ key: 'explain' })
    expect(calls.some(c => c.model === 'sonnet')).toBe(false)
    expect(await has(ui, /Explain needs ai: full in \/config/)).toBe(true)
    await ui.unmount()
  })

  test('on Full, Explain shows the writing state, then the brief; a new brief asks first', { options: { ai: 'full' } }, async ($, on) => {
    const calls: Call[] = []
    const hold: { release?: () => void } = {}
    const clock = await cluster($, on, calls, hold)
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'desktop', ...PANE })
    expect(await has(ui, /^AI · full$/)).toBe(true)
    await openCluster(ui)
    await ui.press({ key: 'explain' })
    await clock.advance(10)
    expect(calls.filter(c => c.system === EXPLAIN_SYSTEM).length).toBe(1)
    expect(await has(ui, /Explain · writing… \(Sonnet\)/)).toBe(true)
    hold.release!()
    for (let k = 0; k < 3; k++) await clock.advance(10)
    expect(await has(ui, /^Explain · Sonnet · 640 tokens · just now$/)).toBe(true)
    for (const label of ['Goal', 'Who did what', 'How it connected', 'Outcome', 'Open issues']) expect(await has(ui, new RegExp(`^${label}$`))).toBe(true)
    expect(await has(ui, /Fix cart totals: Made totals multiply by quantity\./)).toBe(true)
    // Output carries the brief too
    await ui.press({ key: 'view:output' })
    const md = (await ui.findAll({ type: 'Markdown' })) as unknown as { props?: { text?: string } }[]
    expect(md.some(m => String(m.props?.text ?? '').includes('**Goal:** Fix how the cart adds up prices.'))).toBe(true)
    // with a brief there, Explain asks first; Cancel asks nothing, Yes asks Sonnet again
    await ui.press({ key: 'explain' })
    expect(await ui.find({ key: 'explain:yes' })).toBeDefined()
    await ui.press({ key: 'explain:no' })
    expect(await ui.find({ key: 'explain:yes' })).toBeUndefined()
    expect(calls.filter(c => c.system === EXPLAIN_SYSTEM).length).toBe(1)
    await ui.press({ key: 'explain' })
    await ui.press({ key: 'explain:yes' })
    await clock.advance(10)
    expect(calls.filter(c => c.system === EXPLAIN_SYSTEM).length).toBe(2)
    hold.release!()
    await clock.advance(10)
    await ui.unmount()
  })

  test('story steps show in the desktop trace with who wrote them', async ($, on) => {
    const calls: Call[] = []
    const clock = await cluster($, on, calls)
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'desktop', ...PANE })
    await openCluster(ui)
    await ui.press({ key: 'lens:trace' })
    for (let k = 0; k < 4; k++) await clock.advance(10)
    expect(await has(ui, /Fixed total\.ts to multiply by quantity\./)).toBe(true)
    expect(await has(ui, /^Story · Haiku · 1\.3k tokens$/)).toBe(true)
    await ui.unmount()
  })
})

// ── patterns across runs ────────────────────────────────────────────────────────

const pastRuns = (n: number, at = NOW - DAY): AgentNode[] => Array.from({ length: n }, (_, i) => ({
  id: `r${i}`, kind: 'agent', label: `Run ${i}`, status: i % 3 === 0 ? 'failed' : 'done', startedAt: at - i * HOUR, endedAt: at - i * HOUR + 60_000, tools: 3,
  tokens: 20_000, model: 'claude-haiku-4-5', repo: '/repo/a', result: `Run ${i} result`,
}))

function historyMocks(on: On, calls: Call[]) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, { history: pastRuns(12) })
  models(on, calls)
  on('session.root', () => ({ value: '/repo/a' }) as never)
  on('process.run', () => ok('/repo/a\n'))
  on('env.get', () => ({ value: '/home/u' }) as never)
  return clock
}

test('below Full with no patterns kept, History shows no patterns block', async ($, on) => {
  const calls: Call[] = []
  historyMocks(on, calls)
  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'desktop', ...PANE })
  await ui.press({ key: 'tab:history' })
  expect(await ui.find({ key: 'patterns:go' })).toBeUndefined()
  expect(await has(ui, /^AI tokens this week$/)).toBe(true)
  await ui.unmount()
})

test('on Full, History finds patterns: cards with evidence and what to try; a run chip opens its run', { options: { ai: 'full' } }, async ($, on) => {
  const calls: Call[] = []
  const clock = historyMocks(on, calls)
  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'desktop', ...PANE })
  await ui.press({ key: 'tab:history' })
  expect(await has(ui, /^Patterns across runs$/)).toBe(true)
  await ui.press({ key: 'patterns:go' })
  for (let k = 0; k < 3; k++) await clock.advance(10)
  expect(calls.filter(c => c.system === PATTERNS_SYSTEM && c.model === 'sonnet').length).toBe(1)
  expect(await has(ui, /^Sonnet · 640 tokens · just now$/)).toBe(true)
  expect(await has(ui, /^Verifiers time out on big files$/)).toBe(true)
  expect(await has(ui, /3 of 9 verify runs ran out of turns/)).toBe(true)
  expect(await has(ui, /Try: Raise maxTurns for verify agents\./)).toBe(true)
  // the fold hides the cards; Regenerate asks first
  await ui.press({ key: 'patterns:fold' })
  expect(await has(ui, /^Verifiers time out on big files$/)).toBe(false)
  await ui.press({ key: 'patterns:fold' })
  await ui.press({ key: 'patterns:go' })
  expect(await ui.find({ key: 'patterns:yes' })).toBeDefined()
  expect(calls.filter(c => c.system === PATTERNS_SYSTEM).length).toBe(1)
  await ui.press({ key: 'patterns:no' })
  // a run chip opens that run
  await ui.press({ key: 'prun:0:r3' })
  expect(await ui.find({ key: 'back' })).toBeDefined()
  expect(await has(ui, /^Run 3$/)).toBe(true)
  await ui.unmount()
})
