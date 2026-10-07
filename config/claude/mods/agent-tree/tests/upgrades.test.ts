import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { compareRuns, previousOf, verdict } from '../hooks/compare'
import { criticalPath, idleGaps, modelFamily, rowFlags, spendByModel } from '../hooks/lens'
import { onlyLane, traceHits, traceMarks } from '../hooks/trace'
import type { AgentNode, TraceLane, TraceRow } from '../types'

const KEY = 'tree-v7'
const PANE = {
  component: 'Pane' as const,
  requestId: 'agent-tree',
  props: { title: 'Agents', isFocused: true, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 30 } } as never,
  viewport: { columns: 110, rows: 34 },
}
const node = (id: string, o: Partial<AgentNode> = {}): AgentNode => ({ id, kind: 'agent', label: id, status: 'done', startedAt: 0, tools: 0, ...o })

// ── where the time went ──────────────────────────────────────────────────────

test('the critical path runs back from the agent that ended last through what it waited for', () => {
  // a1 and a2 ran side by side; b1 and b2 started after a1 ended; b1 ended last
  const list = [
    node('a1', { startedAt: 0, endedAt: 10_000 }), node('a2', { startedAt: 0, endedAt: 4000 }),
    node('b1', { startedAt: 11_000, endedAt: 30_000 }), node('b2', { startedAt: 11_000, endedAt: 20_000 }),
  ]
  const p = criticalPath(list, 40_000)!
  expect(p.ids).toEqual(['a1', 'b1'])
  expect(p.ms).toBe(29_000)
  expect(p.span).toBe(30_000)
  // one agent has no path to speak of
  expect(criticalPath([list[0]!], 0)).toBeUndefined()
})

test('idle gaps are the stretches when no agent ran; short ones are left out', () => {
  const list = [node('a', { startedAt: 0, endedAt: 10_000 }), node('b', { startedAt: 40_000, endedAt: 50_000 }), node('c', { startedAt: 50_500, endedAt: 60_000 })]
  const g = idleGaps(list, 0)
  expect(g.gaps).toEqual([{ from: 10_000, to: 40_000 }])
  expect(g.ms).toBe(30_000)
})

test('spend is summed by model family, most first', () => {
  const list = [
    node('a', { model: 'claude-opus-5-5', tokens: 100_000 }), node('b', { model: 'claude-haiku-4-5-20251001', tokens: 5000 }),
    node('c', { model: 'claude-opus-5-5', tokens: 20_000 }), node('d'),
  ]
  expect(spendByModel(list)).toEqual([{ model: 'Opus', tokens: 120_000, agents: 2 }, { model: 'Haiku', tokens: 5000, agents: 1 }])
  expect(modelFamily(undefined)).toBe('Unknown')
  expect(modelFamily('some-other-model')).toBe('Other')
})

test('row flags: a shared file, the biggest spender, the slowest phase', () => {
  const wf: AgentNode = { id: 'w', kind: 'workflow', label: 'wf', status: 'done', startedAt: 0, endedAt: 100_000, tools: 0, phases: ['Find', 'Fix'] }
  const list = [
    wf,
    node('f1', { parentId: 'w', phase: 'Find', startedAt: 0, endedAt: 10_000, tokens: 1000, changes: { '/r/a.ts': { edits: 1, added: 1, removed: 0 } } }),
    node('x1', { parentId: 'w', phase: 'Fix', startedAt: 11_000, endedAt: 100_000, tokens: 90_000 }),
    node('x2', { parentId: 'w', phase: 'Fix', startedAt: 11_000, endedAt: 50_000, tokens: 2000, changes: { '/r/a.ts': { edits: 1, added: 1, removed: 0 } } }),
  ]
  const f = rowFlags(list, list, 100_000)
  expect(f.get('f1')?.text).toBe('⚠ shares a.ts')
  expect(f.get('x2')?.text).toBe('⚠ shares a.ts')
  expect(f.get('x1')?.text).toBe('▲ 97% of tokens')
  expect(f.get('phase:w:Fix')?.text).toBe('slowest · 90% of time')
})

// ── two runs side by side ────────────────────────────────────────────────────

const runA: AgentNode = { id: 'r1', kind: 'workflow', label: 'review', tag: 'review-changes', status: 'done', startedAt: 0, endedAt: 100_000, tools: 0, phases: ['Find'] }
const runB: AgentNode = { ...runA, id: 'r2', startedAt: 200_000, endedAt: 260_000 }
const pairNodes = [
  runA, node('a1', { parentId: 'r1', phase: 'Find', startedAt: 0, endedAt: 100_000, tokens: 50_000, model: 'claude-opus-5-5', tools: 9, changes: { '/x.ts': { edits: 1, added: 3, removed: 1 } } }),
  runB, node('b1', { parentId: 'r2', phase: 'Find', startedAt: 200_000, endedAt: 260_000, tokens: 30_000, model: 'claude-sonnet-5-5', tools: 4, status: 'failed',
    changes: { '/x.ts': { edits: 1, added: 1, removed: 0 }, '/y.ts': { edits: 1, added: 2, removed: 0 } } }),
]

test('a comparison measures both runs and says which way each number went', () => {
  const cmp = compareRuns(pairNodes, runA, runB, 300_000)
  const m = (name: string) => cmp.totals.find(x => x.name === name)!
  expect([m('Time').a, m('Time').b]).toEqual([100_000, 60_000])
  expect(verdict(m('Time'))).toBe('better')
  expect(verdict(m('Failed'))).toBe('worse')
  expect(verdict(m('Agents'))).toBe('same')
  expect(verdict(m('Tool calls'))).toBe('neither')
  expect(cmp.phases).toEqual([{ name: 'Find', a: 100_000, b: 60_000, measure: 'ms', lowerIsBetter: true }])
  expect(cmp.models.map(x => [x.name, x.a, x.b])).toEqual([['Opus', 50_000, 0], ['Sonnet', 0, 30_000]])
  expect(cmp.files).toEqual({ onlyA: [], onlyB: ['/y.ts'], both: ['/x.ts'] })
  expect(previousOf(pairNodes, runB)?.id).toBe('r1')
  expect(previousOf(pairNodes, runA)).toBeUndefined()
})

// ── reading a trace ──────────────────────────────────────────────────────────

test('a trace cuts to one lane, finds what needs a look, and searches its words', () => {
  const rows: TraceRow[] = [
    { kind: 'tool', lane: 0, at: 1, text: 'read 2 files' },
    { kind: 'spawn', lane: 0, to: 1, at: 2, text: 'started Fix' },
    { kind: 'tool', lane: 1, at: 3, text: 'Run the cart tests', input: 'npm test', error: true },
    { kind: 'quiet', lane: 2, at: 4, text: 'quiet 3m' },
    { kind: 'fail', lane: 1, at: 5, text: 'failed' },
  ]
  const lanes: TraceLane[] = [0, 1, 2].map(i => ({ id: `l${i}`, label: `L${i}`, chip: `L${i}`, status: 'done', from: 0, to: 4 }))
  const cut = onlyLane(rows, lanes, 1)
  expect(cut.rows.map(r => r.text)).toEqual(['started Fix', 'Run the cart tests', 'failed'])
  expect([cut.lanes[1]!.from, cut.lanes[1]!.to]).toEqual([0, 2])
  expect(cut.lanes[2]!.to).toBe(-1)
  expect(traceMarks(rows)).toEqual([2, 3, 4])
  expect(traceHits(rows, 'NPM')).toEqual([2])
  expect(traceHits(rows, '  ')).toEqual([])
})

// ── the pane ────────────────────────────────────────────────────────────────

const at = Date.parse('2026-10-05T00:12:00Z')
const cart: AgentNode[] = [
  { id: 'g1', kind: 'group', label: 'Fix shopping cart calculation bugs', status: 'done', startedAt: at, endedAt: at + 9000, tools: 0, repo: '/repo/a' },
  node('c1', { parentId: 'g1', label: 'Fix cart total quantities', model: 'claude-haiku-4-5', startedAt: at, endedAt: at + 8000, tools: 3, tokens: 12000, changes: { '/repo/a/src/cart.ts': { edits: 1, added: 2, removed: 1 } } }),
  node('c2', { parentId: 'g1', label: 'Format prices with two decimals', model: 'claude-haiku-4-5', startedAt: at + 100, endedAt: at + 9000, tools: 3, tokens: 9000 }),
  node('c3', { parentId: 'g1', label: 'Tighten email validation', model: 'claude-opus-5-5', startedAt: at + 200, endedAt: at + 9000, tools: 2, tokens: 5000 }),
  // the same work, done again later: a second run to compare with
  { id: 'g2', kind: 'group', label: 'Fix shopping cart calculation bugs', status: 'done', startedAt: at + 60_000, endedAt: at + 66_000, tools: 0, repo: '/repo/a' },
  node('d1', { parentId: 'g2', label: 'Fix cart total quantities', model: 'claude-haiku-4-5', startedAt: at + 60_000, endedAt: at + 66_000, tools: 2, tokens: 7000 }),
]
const ok = (stdout = '') => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never

// `runs` collects every process the mod starts; rsvg-convert answers as if installed.
async function pane($: Engine, on: On, extra?: (on: On) => void, runs?: string[][]) {
  mock.clock(on, { now: at + 120_000 })
  mock.store(on, { history: cart })
  on('session.root', () => ({ value: '/repo/a' }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  extra?.(on)
  on('process.run', (_$, e) => { runs?.push([...e.argv]); return e.argv[0] === 'rsvg-convert' ? ok() : ok('/repo/a\n') })
  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
  await ui.key({ in: KEY, key: '2' })
  return ui
}

test('arrows stay in the content; ↑ on the top row reaches the bars, where ← → switch', async ($, on) => {
  const ui = await pane($, on)
  // History's page; h, l and → in the content never leave it
  for (const key of ['h', 'l', 'right', 'left']) await ui.key({ in: KEY, key })
  expect(await ui.find({ in: KEY, text: 'Finished' })).toBeDefined()
  // ↑ on the first run goes up to the lenses; → picks the next lens there
  await ui.key({ in: KEY, key: 'up' })
  expect(await ui.find({ in: KEY, text: '▸Tree ' })).toBeDefined()
  await ui.key({ in: KEY, key: 'right' })
  expect(await ui.find({ in: KEY, text: '▸Board ' })).toBeDefined()
  expect(await ui.find({ in: KEY, text: /^DONE/ })).toBeDefined()
  // ↑ again: the tabs; ← there switches to Live
  await ui.key({ in: KEY, key: 'up' })
  expect(await ui.find({ in: KEY, text: /▸History/ })).toBeDefined()
  await ui.key({ in: KEY, key: 'left' })
  expect(await ui.find({ in: KEY, text: /▸Live/ })).toBeDefined()
  expect(await ui.find({ in: KEY, text: 'Running' })).toBeDefined()
  // ↓ twice: back through the lenses to the content, with no bar cursor left
  await ui.key({ in: KEY, key: 'down' })
  await ui.key({ in: KEY, key: 'down' })
  expect(await ui.find({ in: KEY, text: /^▸/ })).toBeUndefined()
  await ui.unmount()
})

test('tree rows show what each agent spent, and a run its spend by model', async ($, on) => {
  const ui = await pane($, on)
  await ui.key({ in: KEY, key: 'j' }) // the older run, which has three members
  await ui.key({ in: KEY, key: 'return' })
  expect(await ui.find({ in: KEY, text: /Haiku 12k/ })).toBeDefined()
  expect(await ui.find({ in: KEY, text: /Opus 5\.0k/ })).toBeDefined()
  expect(await ui.find({ in: KEY, text: 'Spend' })).toBeDefined()
  expect(await ui.find({ in: KEY, text: /Haiku 21\.0k/ })).toBeDefined()
  await ui.unmount()
})

test('m marks a run and m on a second compares them; = compares with the last run of the same work', async ($, on) => {
  const ui = await pane($, on)
  await ui.key({ in: KEY, key: 'm' })
  expect(await ui.find({ in: KEY, text: /◉ Fix shopping cart/ })).toBeDefined()
  await ui.key({ in: KEY, key: 'j' })
  await ui.key({ in: KEY, key: 'm' })
  expect(await ui.find({ in: KEY, text: 'Compare two runs' })).toBeDefined()
  expect(await ui.find({ in: KEY, text: 'Totals' })).toBeDefined()
  expect(await ui.find({ in: KEY, text: 'Tokens by model' })).toBeDefined()
  await ui.key({ in: KEY, key: 'b' })
  expect(await ui.find({ in: KEY, text: 'Compare two runs' })).toBeUndefined()
  // the newer run, opened: = finds the older one by its name
  await ui.key({ in: KEY, key: 'return' })
  await ui.key({ in: KEY, key: '=' })
  expect(await ui.find({ in: KEY, text: 'Compare two runs' })).toBeDefined()
  // B (the newer run) took 6s against 9s: less time is better
  expect(await ui.find({ in: KEY, text: /−3s \(-33%\)/ })).toBeDefined()
  await ui.unmount()
})

test('x saves the timeline as an SVG, and as a PNG when rsvg-convert is there', async ($, on) => {
  const writes: { path: string; text: string }[] = []
  const runs: string[][] = []
  const ui = await pane($, on, o => {
    o('env.get', () => ({ value: '/home/u' }) as never)
    o('fs.write', (_$, e) => { writes.push({ path: e.path, text: e.text }); return { value: undefined } as never })
  }, runs)
  await ui.key({ in: KEY, key: 'j' })
  await ui.key({ in: KEY, key: 'return' })
  await ui.key({ in: KEY, key: 'v' })
  await ui.key({ in: KEY, key: 'v' }) // the timeline
  await ui.key({ in: KEY, key: 'x' })
  await ui.advance(600)
  const svg = writes.find(w => w.path.endsWith('.svg'))
  expect(svg?.path).toMatch(/^\/home\/u\/Downloads\/agent-tree\/fix-shopping-cart-calculation-bugs-timeline-\d{4}-\d\d-\d\d-\d{4}\.svg$/)
  expect(svg?.text).toContain('<svg')
  expect(svg?.text).toContain('timeline')
  expect(svg?.text).toContain('critical path')
  expect(runs.some(a => a[0] === 'rsvg-convert' && a.includes(svg!.path))).toBe(true)
  expect(await ui.find({ in: KEY, text: 'Saved the timeline as PNG and SVG in ~/Downloads/agent-tree' })).toBeDefined()
  await ui.unmount()
})
