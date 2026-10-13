import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { CAP_ALL, CAP_FINAL, REPORT_SYSTEM, runInput } from '../hooks/report'
import type { AgentNode } from '../types'

// The report Haiku writes must be read from the agent's whole answer, not from the
// short copy the pane keeps: a cut copy reads as unfinished work.
const KEY = 'tree-v7'
const PANE = {
  component: 'Pane' as const,
  requestId: 'agent-tree',
  props: { title: 'Agents', isFocused: true, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 36 } } as never,
  viewport: { columns: 110, rows: 40 },
}
const usage = { input_tokens: 500, output_tokens: 140, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const spawnBase = { provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false } as const
const NOW = Date.parse('2026-10-12T12:00:00Z')
const HOUR = 3_600_000
const END = 'REPRO-SENTINEL-END'
// 979 characters, like the repro fixture: a full map whose last line is the marker
const ANSWER = `${'Widget repo architecture map. '.repeat(31)}All four parts were read and checked. ${END}`.slice(-979)

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

function engine(on: On, reports: string[]) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  on('model.complete', (_$, e) => {
    if (e.system === REPORT_SYSTEM) reports.push(e.prompt)
    const text = e.system === REPORT_SYSTEM ? '{"result":"The map is complete."}' : 'Map the widget repo'
    return { value: { isAnswered: true, usage, text } } as never
  })
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('agent.spawn', (_$, e) => ({ model: 'claude-haiku-4-5', agentId: `ag-${e.tool_use_id}` }))
  on('prompt.submit', () => ({ text: '' }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  on('session.root', () => ({ value: '/repo/a' }) as never)
  on('env.get', () => ({ value: '/home/u' }) as never)
  on('fs.exists', () => ({ value: false }) as never)
  on('fs.read', () => ({ deny: 'missing' }))
  return clock
}

async function spawnOne($: Engine) {
  await $.prompt.submit({ text: 'map the widget repo', origin: { kind: 'user' }, wait: false } as never)
  await $.agent.spawn({ ...spawnBase, tool_use_id: 't0', prompt: 'Map the widget repo', description: 'Map widget architecture', subagentType: 'Explore' } as never)
}

test('an agent report longer than the kept copy reaches Haiku whole', async ($, on) => {
  const reports: string[] = []
  const clock = engine(on, reports)
  await spawnOne($)
  await clock.advance(100)
  await $.turn.complete({ agentId: 'ag-t0', answer: ANSWER, durationMs: 1000, isAborted: false, reason: 'answer', usage } as never)
  for (let k = 0; k < 6; k++) await clock.advance(10)
  expect(reports.length).toBe(1)
  expect(reports[0]).toContain(END)
})

test('a report handed back through SubagentHandback reaches Haiku whole', async ($, on) => {
  const reports: string[] = []
  const clock = engine(on, reports)
  on('tool.call', () => ({ result: {} }) as never)
  await spawnOne($)
  await clock.advance(100)
  await $.tool.call({ tool: 'SubagentHandback', tool_use_id: 'h0', agentId: 'ag-t0', message: ANSWER } as never)
  await $.turn.complete({ agentId: 'ag-t0', answer: '', durationMs: 1000, isAborted: false, reason: 'answer', usage } as never)
  for (let k = 0; k < 6; k++) await clock.advance(10)
  expect(reports.length).toBe(1)
  expect(reports[0]).toContain(END)
})

test("a workflow's final result reaches Haiku whole, up to its own cap", async ($, on) => {
  const reports: string[] = []
  const clock = engine(on, reports)
  on('tool.call', { tool: 'Workflow' }, () => ({ result: { status: 'async_launched', taskId: 'task-w', workflowName: 'widget-map', transcriptDir: '/runs/w' } }) as never)
  await $.tool.call({ tool: 'Workflow', tool_use_id: 'tu-w', script: "export const meta = { name: 'widget-map', description: 'Map the widget repo' }" } as never)
  await clock.advance(2100)
  const final = 'step done. '.repeat(20) + ANSWER // 1,199 characters, under CAP_FINAL; the marker only at the end
  await $.prompt.submit({ text: `<task-notification><task-id>task-w</task-id><status>completed</status><result>${final}</result></task-notification>`, origin: { kind: 'task-notification' }, wait: false } as never)
  for (let k = 0; k < 6; k++) await clock.advance(10)
  const run = reports.find(p => p.includes('Final result:'))
  expect(run).toBeDefined()
  expect(run).toContain(END)
})

test('a report over the cap keeps its start and its end, and says what was left out', () => {
  const long = `FIRST-LINE start of the report.\n${'middle words '.repeat(1000)}\nLAST-LINE the verdict.`
  const node = { id: 'a', kind: 'agent', label: 'Map', status: 'done', startedAt: 0, tools: 3 } as AgentNode
  const prompt = runInput(node, [node], long)
  expect(prompt).toContain('FIRST-LINE')
  expect(prompt).toContain('LAST-LINE the verdict.')
  expect(prompt).toMatch(/\[… [\d,]+ characters left out by the dashboard …\]/)
  expect(prompt.length).toBeLessThanOrEqual(CAP_ALL + 600)
  // the system prompt tells Haiku such a gap is not the agent's
  expect(REPORT_SYSTEM).toMatch(/left out by the dashboard/)
  // a workflow's final result is cut the same way, at its own cap
  const wf = { id: 'w', kind: 'workflow', label: 'Map', status: 'done', startedAt: 0, tools: 0 } as AgentNode
  const wfPrompt = runInput(wf, [wf], long)
  expect(wfPrompt).toContain('LAST-LINE the verdict.')
  expect(wfPrompt.length).toBeLessThanOrEqual(CAP_ALL + CAP_FINAL + 600)
})

test('with only the kept copy, the prompt says the rest was not kept', () => {
  const node = { id: 'a', kind: 'agent', label: 'Map', status: 'done', startedAt: 0, tools: 3, result: ANSWER.slice(0, 400), resultLength: 979 } as AgentNode
  const prompt = runInput(node, [node])
  expect(prompt).toContain(ANSWER.slice(0, 400))
  expect(prompt).toMatch(/\[… 579 characters left out by the dashboard …\]/)
})

test('the pane says when it shows only the start of a report', async ($, on) => {
  const reports: string[] = []
  const clock = engine(on, reports)
  await spawnOne($)
  await clock.advance(100)
  await $.turn.complete({ agentId: 'ag-t0', answer: ANSWER, durationMs: 1000, isAborted: false, reason: 'answer', usage } as never)
  for (let k = 0; k < 6; k++) await clock.advance(10)
  await clock.advance(2 * HOUR)
  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
  await ui.key({ in: KEY, key: '2' })
  await ui.key({ in: KEY, key: 'return' })
  await ui.key({ in: KEY, key: 'o' })
  const rows = await textRows(ui)
  expect(rows.some(r => r.includes('Report (first 400 of 979 characters)'))).toBe(true)
  expect(rows.some(r => r.includes('Full report'))).toBe(false)
  await ui.unmount()
})
