import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { buildTrace, chipOf, parseTranscript, stepsOf, storyOf, traceWindow, type TraceEvent } from '../hooks/trace'
import type { AgentNode } from '../types'
import { FORK_TRANSCRIPT, SUBAGENT_TRANSCRIPT } from './fixtures/trace-rows'

const KEY = 'tree-v7'
const PANE = {
  component: 'Pane' as const,
  requestId: 'agent-tree',
  props: { title: 'Agents', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 30 } } as never,
  viewport: { columns: 120, rows: 34 },
}
const A = 'aaaa000000000001'
const B = 'bbbb000000000002'
const F = 'cccc000000000003'
const T0 = Date.parse('2026-10-05T10:00:00.000Z')

// ── the parser, on rows shaped like real transcripts ─────────────────────────

test('a tool call pairs with its result; an error result marks the call', () => {
  const ev = parseTranscript(SUBAGENT_TRANSCRIPT, A)
  const read = ev.find(e => e.name === 'Read')!
  expect(read.kind).toBe('tool')
  expect(read.input).toBe('/repo/src/cart/total.ts')
  expect(read.output).toContain('export function total')
  expect(read.tokens).toBe(2 + 1200 + 40) // input + cache writes + output; cache reads are not new work
  const failing = ev.find(e => e.name === 'Bash' && e.input === 'npm test -- cart')!
  expect(failing.error).toBe(true)
  expect(failing.output).toContain('1 failing')
})

test('an edit, a spawn, a message out and in, and a hand-back each become their own event', () => {
  const ev = parseTranscript(SUBAGENT_TRANSCRIPT, A)
  const edit = ev.find(e => e.kind === 'edit')!
  expect(edit.path).toBe('/repo/src/cart/total.ts')
  expect(edit.summary).toBe('edited total.ts')
  expect([edit.added, edit.removed]).toEqual([1, 1])
  const spawn = ev.find(e => e.kind === 'spawn')!
  expect(spawn.to).toBe(B) // the background launch result names the agent it started
  expect(spawn.summary).toBe('started Check the price formatter')
  const out = ev.find(e => e.kind === 'message' && !e.from)!
  expect(out.to).toBe('uds:/tmp/cc-socks/1.sock')
  expect(out.summary).toBe('Ask peer to rerun price check')
  const inbound = ev.find(e => e.kind === 'message' && e.from)!
  expect(inbound.from).toBe('peer-session')
  expect(inbound.summary).toBe('price check passes')
  const back = ev.filter(e => e.kind === 'handback')
  expect(back.length).toBe(1)
  expect(back[0]!.summary).toBe('Cart totals now multiply by quantity.')
  // a hand-back is the report: no extra report from the last text
  expect(ev.some(e => e.kind === 'report')).toBe(false)
  // the task it was given is not a message
  expect(ev.filter(e => e.kind === 'message').length).toBe(2)
})

test("a fork's trace starts at its directive, not at the parent's call that started it", () => {
  const ev = parseTranscript(FORK_TRANSCRIPT, F)
  expect(ev.some(e => e.kind === 'spawn')).toBe(false)
  expect(ev[0]!.kind).toBe('edit')
  expect(ev[0]!.summary).toBe('wrote page.html')
  const report = ev[ev.length - 1]!
  expect(report.kind).toBe('report')
  expect(report.summary).toBe('Published the page.')
})

test('steps group like calls in a row; a story keeps a few beats per agent', () => {
  const ev = parseTranscript(SUBAGENT_TRANSCRIPT, A)
  const steps = stepsOf(ev)
  expect(steps.map(s => s.summary)).toEqual([
    'read 2 files in src/cart', 'ran 2 commands', 'edited total.ts', 'started Check the price formatter',
    'Ask peer to rerun price check', 'price check passes', 'Cart totals now multiply by quantity.',
  ])
  expect(steps[1]!.error).toBe(true) // one of the commands failed
  expect(steps[0]!.count).toBe(2)
  // forty reads in a row are one step, and a story folds tool steps into a few beats
  const many: TraceEvent[] = Array.from({ length: 40 }, (_, i) => ({ agentId: 'x', at: T0 + i * 1000, kind: 'tool', name: i % 2 ? 'Read' : 'Bash', summary: 'x', input: `/r/a/f${i}.ts` }))
  const story = storyOf(many, 8)
  expect(story.length).toBeLessThanOrEqual(8)
  expect(story.reduce((a, s) => a + (s.count ?? 1), 0)).toBe(40)
  expect(chipOf('review:bugs')).toBe('RB')
})

const node = (id: string, over: Partial<AgentNode>): AgentNode => ({ id, kind: 'agent', label: id, status: 'done', startedAt: T0, tools: 1, ...over })
const runNodes = (): AgentNode[] => [
  node('g1', { kind: 'group', label: 'Fix the cart', startedAt: T0 - 1000, endedAt: Date.parse('2026-10-05T11:05:00Z'), repo: '/repo/a' }),
  node(A, { parentId: 'g1', label: 'Fix cart totals', startedAt: T0, endedAt: T0 + 14_000, changes: { '/repo/src/cart/total.ts': { edits: 1, added: 1, removed: 1 } } }),
  node(B, { parentId: A, label: 'Check the price formatter', startedAt: T0 + 8_500, endedAt: T0 + 20_000, summary: 'Prices format with two decimals.' }),
  node(F, { parentId: 'g1', label: 'Build the explainer', startedAt: Date.parse('2026-10-05T11:00:00Z'), endedAt: Date.parse('2026-10-05T11:05:01Z'), status: 'failed' }),
]

test('a trace links a spawn to its child lane, reads back to the parent, and marks gaps, ends and missing transcripts', () => {
  const list = runNodes()
  const events = new Map([[A, parseTranscript(SUBAGENT_TRANSCRIPT, A)], [F, parseTranscript(FORK_TRANSCRIPT, F)]])
  const t = buildTrace(list[0]!, list, events, Date.parse('2026-10-05T12:00:00Z'), 'raw')
  expect(t.lanes.map(l => l.chip)).toEqual(['MS', 'FC', 'CT', 'BT'])
  expect(t.missing).toBe(1) // the price formatter's transcript is gone
  const lane = (id: string) => t.lanes.findIndex(l => l.id === id)
  // the parent's own spawn call points at the child lane, and the main session started the two top agents
  const spawnB = t.rows.find(r => r.kind === 'spawn' && r.lane === lane(A))!
  expect(spawnB.to).toBe(lane(B))
  expect(t.rows.filter(r => r.kind === 'spawn' && r.lane === lane('main')).map(r => r.to)).toEqual([lane(A), lane(F)])
  // the hand-back and the last report go back to whoever started them
  expect(t.rows.find(r => r.kind === 'handback')!.to).toBe(lane('main'))
  expect(t.rows.find(r => r.kind === 'report' && r.lane === lane(B))!.to).toBe(lane(A))
  expect(t.rows.some(r => r.kind === 'note' && r.lane === lane(B) && r.text === 'transcript no longer on disk')).toBe(true)
  expect(t.rows.some(r => r.kind === 'quiet' && r.lane === lane(F) && r.text === 'quiet 5m')).toBe(true)
  expect(t.rows.some(r => r.kind === 'fail' && r.lane === lane(F))).toBe(true)
  // rows the view gets hold nothing undefined
  for (const r of t.rows) for (const v of Object.values(r)) expect(v).toBeDefined()
  // a window keeps props small
  expect(traceWindow(t.rows, 100, 5).rows.length).toBe(5)
})

// ── the pane ────────────────────────────────────────────────────────────────

const repo = { value: { exitCode: 0, stdout: '/repo/a\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never

// History holds the cart run; transcripts are found by find, and read whole or with dd.
function traceMocks(on: On, opts: { big?: boolean; dd?: string[][]; reads?: string[] } = {}) {
  mock.clock(on, { now: Date.parse('2026-10-05T12:00:00Z') })
  mock.store(on, { history: runNodes() })
  const textOf: Record<string, string> = { [`/p/agent-${A}.jsonl`]: SUBAGENT_TRANSCRIPT, [`/p/agent-${F}.jsonl`]: FORK_TRANSCRIPT }
  const pieces = (() => {
    const t = SUBAGENT_TRANSCRIPT
    const cut1 = Math.floor(t.length / 3) + 7
    const cut2 = Math.floor((2 * t.length) / 3) + 11 // both cut through the middle of a line
    return [t.slice(0, cut1), t.slice(cut1, cut2), t.slice(cut2)]
  })()
  on('process.run', (_$, e) => {
    if (e.argv[0] === 'find') return ok(`/p/agent-${A}.jsonl\n/p/agent-${F}.jsonl\n`)
    if (e.argv[0] === 'dd') {
      opts.dd?.push([...e.argv])
      const skip = Number(e.argv.find(a => a.startsWith('skip='))?.slice(5))
      return ok(pieces[skip / 48] ?? '')
    }
    return repo as never
  })
  on('fs.exists', () => ({ value: false }) as never)
  on('env.get', () => ({ value: '/home/u' }) as never)
  on('fs.stat', (_$, e) => ({ value: { kind: 'file', size: opts.big && e.path.includes(A) ? 9 * 1024 * 1024 : 4000, mtimeMs: 1, isLink: false } }) as never)
  on('fs.read', (_$, e) => {
    opts.reads?.push(e.path)
    return textOf[e.path] !== undefined ? { value: textOf[e.path]! } : { deny: 'missing' }
  })
}

async function openTrace($: Engine, columns = 120) {
  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
  await ui.resize({ in: KEY, columns, rows: 34 })
  await ui.key({ in: KEY, key: '2' })
  await ui.key({ in: KEY, key: 'return' })
  for (let k = 0; k < 3; k++) await ui.key({ in: KEY, key: 'v' }) // tree → board → timeline → trace
  await ui.advance(600)
  return ui
}

test('the trace view draws lanes, arrows between them, and the detail of the row picked', async ($, on) => {
  traceMocks(on)
  const ui = await openTrace($)
  expect(await ui.find({ in: KEY, text: /Story · Steps · Raw/ })).toBeDefined()
  expect(await ui.find({ in: KEY, text: /MS Main session/ })).toBeDefined()
  expect(await ui.find({ in: KEY, text: /├─+▶.*started Fix cart totals/ })).toBeDefined()
  expect(await ui.find({ in: KEY, text: /◀─+┤.*handed back to Main session: Cart totals now multiply/ })).toBeDefined()
  expect(await ui.find({ in: KEY, text: /1 transcript no longer on disk/ })).toBeDefined()
  expect(await ui.find({ in: KEY, text: /quiet 5m/ })).toBeDefined()
  // the detail strip shows the first row: the main session starting Fix cart totals
  expect(await ui.find({ in: KEY, text: /started an agent/ })).toBeDefined()
  await ui.unmount()
})

test('z moves through story, steps and raw; raw shows every call', async ($, on) => {
  traceMocks(on)
  const ui = await openTrace($)
  expect(await ui.find({ in: KEY, text: /read 2 files in src\/cart/ })).toBeDefined()
  await ui.key({ in: KEY, key: 'z' }) // steps
  await ui.advance(600)
  expect(await ui.find({ in: KEY, text: /read 2 files in src\/cart/ })).toBeDefined()
  await ui.key({ in: KEY, key: 'z' }) // raw
  await ui.advance(600)
  expect(await ui.find({ in: KEY, text: /Reading total\.ts/ })).toBeDefined()
  expect(await ui.find({ in: KEY, text: /Reading items\.ts/ })).toBeDefined()
  expect(await ui.find({ in: KEY, text: /read 2 files/ })).toBeUndefined()
  await ui.unmount()
})

test('enter on an edit opens its diff', async ($, on) => {
  traceMocks(on)
  const ui = await openTrace($)
  // walk down to the edit row
  for (let k = 0; k < 12; k++) {
    if (await ui.find({ in: KEY, text: /enter opens the diff/ })) break
    await ui.key({ in: KEY, key: 'j' })
  }
  expect(await ui.find({ in: KEY, text: /\/repo\/src\/cart\/total\.ts/ })).toBeDefined()
  await ui.key({ in: KEY, key: 'return' })
  expect(await ui.find({ in: KEY, text: /‹ cart\/total\.ts/ })).toBeDefined()
  expect(await ui.find({ in: KEY, text: /edit 1 of 1/ })).toBeDefined()
  await ui.unmount()
})

test('under 80 columns the lanes fold into one column with agent chips', async ($, on) => {
  traceMocks(on)
  const ui = await openTrace($, 70)
  expect(await ui.find({ in: KEY, text: /▷ +\+0:01  MS started Fix cart totals/ })).toBeDefined()
  // the legend shows the arrow; no row draws one
  expect(await ui.find({ in: KEY, text: /├─+▶ +\+\d/ })).toBeUndefined()
  await ui.unmount()
})

test('a transcript over the read limit is read in 3 MiB pieces with dd, never whole', async ($, on) => {
  const dd: string[][] = []
  const reads: string[] = []
  traceMocks(on, { big: true, dd, reads })
  const ui = await openTrace($)
  expect(dd.map(a => a.find(x => x.startsWith('skip=')))).toEqual(['skip=0', 'skip=48', 'skip=96'])
  expect(dd.every(a => a.includes('count=48') && a.includes('bs=65536'))).toBe(true)
  expect(reads.some(p => p.includes(A))).toBe(false)
  // the pieces cut lines in half, and every event still came through
  expect(await ui.find({ in: KEY, text: /handed back to Main session/ })).toBeDefined()
  await ui.key({ in: KEY, key: 'z' })
  await ui.key({ in: KEY, key: 'z' })
  await ui.advance(600)
  expect(await ui.find({ in: KEY, text: /Reading items\.ts/ })).toBeDefined()
  await ui.unmount()
})
