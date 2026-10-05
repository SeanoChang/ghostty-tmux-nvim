import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import {
  changesLine, cleanTitle, describeTool, diffCounts, editRecords, editStats, fileRows, lineDiff, phaseWords, readableResult, firstPrompt, fitProps, markFor, parseDigest, parseJournal,
  pipeline, plain, prettyModel, prettyType, scopeNodes, shortPaths, taskText, topItems, transcriptEdits, workSummary, workflowItems,
} from '../hooks/list'
import { bar, viewProps, viewState, wrap } from '../hooks/view'
import type { AgentNode } from '../types'

const KEY = 'tree-v6'
const PANE = {
  component: 'Pane' as const,
  requestId: 'agent-tree',
  props: { title: 'Agents', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 40 } } as never,
  viewport: { columns: 90, rows: 44 },
}
const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const spawnBase = {
  provider: { plugin: 'engine', tier: 'core' }, parentModel: 'claude-opus-5-5', background: false, fork: false,
} as const

// A workflow of 50 agents: phase "Find" (10, all done) and phase "Verify" (40: 30 done, 10 running).
function bigJournal(): string {
  const lines = [JSON.stringify({ type: 'launched' })]
  for (let i = 0; i < 50; i++) {
    const phase = i < 10 ? 'Find' : 'Verify'
    lines.push(JSON.stringify({ type: 'started', agentId: `w${i}`, label: `${phase.toLowerCase()}:${i}`, phase }))
    if (i < 40) lines.push(JSON.stringify({ type: 'result', agentId: `w${i}` }))
  }
  return lines.join('\n')
}

// The two harness frames a workflow agent's transcript opens with.
const harnessTranscript = (task: string) => [
  { type: 'user', message: { role: 'user', content: '[Workflow harness — user request] The harness relays the user request:\n  show me a workflow' } },
  { type: 'user', message: { role: 'user', content: `[Workflow harness — computed task] The computed task text follows:\n  ${task}` } },
].map(r => JSON.stringify(r)).join('\n')

async function bigWorkflow($: Engine, on: On) {
  const clock = mock.clock(on)
  mock.store(on)
  on('classic.Stop', () => ({}))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('tool.call', { tool: 'Workflow' }, () => ({
    result: { status: 'async_launched', taskId: 'task-big', workflowName: 'big-review', transcriptDir: '/runs/big' },
  }) as never)
  on('tool.call', { tool: 'Edit' }, () => ({ result: { filePath: 'x' } }) as never)
  on('fs.read', (_$, e) => {
    if (e.path.endsWith('journal.jsonl')) return { value: bigJournal() }
    if (e.path.endsWith('.meta.json')) return { value: JSON.stringify({ agentType: 'Explore', model: 'haiku' }) }
    if (e.path.endsWith('.jsonl')) return { value: harnessTranscript('Check the retry loop in the HTTP client for off-by-one errors.') }
    return { deny: 'missing' }
  })
  on('model.complete', (_$, e) => ({
    value: { isAnswered: true, text: e.prompt.includes('Report:') ? '{"outcome":"Found the off-by-one.","points":["retry starts at 1"]}' : 'Check retry loop for off-by-one', usage },
  }) as never)
  await $.tool.call({ tool: 'Workflow', tool_use_id: 'tu-wf', script: "export const meta = { name: 'big-review', description: 'Review the pull request' }" } as never)
  await clock.advance(2100)
  return clock
}

const edit = (agentId: string, file: string, oldS: string, newS: string) =>
  ({ tool: 'Edit', tool_use_id: `e-${agentId}-${file}`, agentId, file_path: `/repo/src/${file}`, old_string: oldS, new_string: newS, replace_all: false }) as never

describe('a 50-agent workflow', () => {
  test('one row at the top; inside, phases fold and done agents collapse', async ($, on) => {
    await bigWorkflow($, on)
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
    expect(await ui.find({ in: KEY, text: 'Review the pull request' })).toBeDefined()
    expect(await ui.find({ in: KEY, text: /40\/50/ })).toBeDefined()

    await ui.key({ in: KEY, key: 'return' })
    expect(await ui.find({ in: KEY, text: 'Find' })).toBeDefined()
    expect(await ui.find({ in: KEY, text: /27 more finished agents/ })).toBeDefined()
    // titles come from the computed task, not the relayed user request
    expect(await ui.find({ in: KEY, text: 'Check retry loop for off-by-one' })).toBeDefined()
    expect(await ui.find({ in: KEY, text: /show me a workflow/ })).toBeUndefined()

    await ui.key({ in: KEY, key: 'h' })
    expect(await ui.find({ in: KEY, text: /more finished agents/ })).toBeUndefined()
    await ui.unmount()
  })

  test('changes trace from a file to the agents that made them', async ($, on) => {
    await bigWorkflow($, on)
    await $.tool.call(edit('w45', 'retry.ts', 'a\nb', 'a\nb\nc'))
    await $.tool.call(edit('w46', 'retry.ts', 'x', 'y'))
    await $.tool.call(edit('w47', 'client.ts', 'q', 'r'))
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
    await ui.key({ in: KEY, key: 'return' })
    // true line diffs: "a b" → "a b c" adds one line and removes none
    expect(await ui.find({ in: KEY, text: '2 files' })).toBeDefined()
    expect(await ui.find({ in: KEY, text: '+3' })).toBeDefined()
    expect(await ui.find({ in: KEY, text: '−2' })).toBeDefined()

    await ui.key({ in: KEY, key: 'l' }) // h/l walk the views
    expect(await ui.find({ in: KEY, text: /Changes 2/ })).toBeDefined()
    expect(await ui.find({ in: KEY, text: /src\/retry\.ts/ })).toBeDefined()

    await ui.key({ in: KEY, key: 'return' }) // open retry.ts's diff
    expect(await ui.find({ in: KEY, text: 'Verify  ›  ' })).toBeDefined()
    expect(await ui.find({ in: KEY, text: '+  c' })).toBeDefined()
    expect(await ui.find({ in: KEY, text: '−  x' })).toBeDefined()
    expect(await ui.find({ in: KEY, text: /enter: go to agent/ })).toBeDefined()
    await ui.key({ in: KEY, key: 'return' }) // trace the first edit to its agent
    expect(await ui.find({ in: KEY, text: /Verify phase/ })).toBeDefined()
    expect(await ui.find({ in: KEY, text: 'open' })).toBeDefined()
    await ui.unmount()
  })

  test('a phase is a scope: its overview and its output', async ($, on) => {
    await bigWorkflow($, on)
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
    await ui.key({ in: KEY, key: 'return' })
    expect(await ui.find({ in: KEY, text: 'Find' })).toBeDefined()
    await ui.key({ in: KEY, key: 'j' }) // from the whole-run row to the Find phase
    expect(await ui.find({ in: KEY, text: '10 done' })).toBeDefined()
    await ui.key({ in: KEY, key: 'o' })
    expect(await ui.find({ in: KEY, text: 'What the Find phase reported' })).toBeDefined()
    await ui.unmount()
  })

  test('the end-of-turn list of in-flight tasks ends the workflow, and the run lands in History', async ($, on) => {
    await bigWorkflow($, on)
    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] } as never)
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
    await ui.key({ in: KEY, key: '2' })
    expect(await ui.find({ in: KEY, text: /History 1/ })).toBeDefined()
    expect(await ui.find({ in: KEY, text: 'Review the pull request' })).toBeDefined()
    expect(await ui.find({ in: KEY, text: 'Today' })).toBeDefined()
    await ui.unmount()
  })
})

async function oneCat($: Engine, on: On) {
  mock.clock(on)
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('agent.spawn', () => ({ model: 'claude-sonnet-5-5', agentId: 'cat1' }))
  await $.agent.spawn({ ...spawnBase, tool_use_id: 't1', prompt: 'find every caller of parseJwt', description: 'Map the auth module', subagentType: 'Explore' } as never)
}

describe('subagents', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`a subagent reads as plain words; Output shows its task (${surface})`, async ($, on) => {
      await oneCat($, on)
      const ui = await $.ui.mount({ plugin: 'agent-tree', surface, ...PANE })
      expect(await ui.find({ in: KEY, text: 'Map the auth module' })).toBeDefined()
      expect(await ui.find({ in: KEY, text: /Explore agent   ·   Sonnet 5\.5/ })).toBeDefined()
      await ui.key({ in: KEY, key: 'return' }) // open the run
      await ui.key({ in: KEY, key: 'o' })
      expect(await ui.find({ in: KEY, text: 'find every caller of parseJwt' })).toBeDefined()
      expect(await ui.find({ in: KEY, text: /Still working/ })).toBeDefined()
      await ui.unmount()
    })
  }

  test('grouping puts a header over the rows', async ($, on) => {
    await oneCat($, on)
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
    await ui.key({ in: KEY, key: 'v' })
    expect(await ui.find({ in: KEY, text: 'Explore agents' })).toBeDefined()
    await ui.key({ in: KEY, key: 'v' })
    expect(await ui.find({ in: KEY, text: 'Main checkout' })).toBeDefined()
    await ui.unmount()
  })
})

test('the transcript Agent row draws as one line', async $ => {
  const ui = await $.ui.mount({
    plugin: 'agent-tree', surface: 'terminal', component: 'ToolUse', requestId: 't9',
    props: { tool_use_id: 't9', tool: 'Agent', input: { description: 'map the repo', subagent_type: 'Explore' }, isRunning: true, isErrored: false, isInterrupted: false } as never,
  })
  expect(await ui.find({ type: 'Text', text: 'map the repo' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /details in the Agents pane/ })).toBeDefined()
})

test('words a person reads', () => {
  expect(describeTool('Read', { file_path: '/a/b/jwt.ts' })).toEqual({ act: 'read', activity: 'Reading jwt.ts' })
  expect(describeTool('mcp__claude_ai_Linear__get_issue', {}).activity).toBe('Calling Linear · get issue')
  expect(workSummary({ tools: 4, work: { read: 2, run: 1 }, changes: { 'a.ts': { edits: 1, added: 1, removed: 0 } } })).toBe('Read 2 files, edited 1 file, ran 1 command')
  expect(plain('## Test Files Found\n**File:** `tree.test.ts`')).toBe('Test Files Found File: tree.test.ts')
  expect(prettyModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(prettyType({ kind: 'agent', type: 'feature-dev:code-reviewer' }, false)).toBe('Code reviewer agent')
  expect(markFor({ id: 'x', kind: 'agent' }, false)).toBe('🐱')
  expect(['🐡', '🐠', '🐙', '🐟']).toContain(markFor({ id: 'x', kind: 'agent' }, true))
  expect(taskText('[Workflow harness — computed task] blah follows:\n  List the tests.')).toBe('List the tests.')
  expect(taskText('[Workflow harness — user request] show me')).toBe('')
  expect(wrap('aa bb cc', 5)).toEqual(['aa bb', 'cc'])
})

test('changes: diffstats, the file trail, and short paths', () => {
  expect(editStats('Edit', { file_path: '/r/a.ts', old_string: 'x', new_string: 'x\ny' })).toEqual({ path: '/r/a.ts', added: 2, removed: 1 })
  expect(editStats('Write', { file_path: '/r/b.ts', content: '1\n2\n3' })).toEqual({ path: '/r/b.ts', added: 3, removed: 0 })
  expect(editStats('Read', { file_path: '/r/a.ts' })).toBeUndefined()
  const a: AgentNode = { id: 'a', kind: 'agent', label: 'A', status: 'done', startedAt: 0, tools: 1, changes: { '/r/src/x.ts': { edits: 1, added: 3, removed: 1 } } }
  const b: AgentNode = { id: 'b', kind: 'agent', label: 'B', status: 'done', startedAt: 0, tools: 1, changes: { '/r/src/x.ts': { edits: 2, added: 1, removed: 0 }, '/r/lib/y.ts': { edits: 1, added: 1, removed: 1 } } }
  const rows = fileRows([a, b])
  expect(rows.map(r => [r.path, r.added, r.removed, r.by.map(x => x.node.id)])).toEqual([['/r/src/x.ts', 4, 1, ['a', 'b']], ['/r/lib/y.ts', 1, 1, ['b']]])
  expect(changesLine(rows)).toBe('Changed 2 files (+5 −2)')
  expect([...shortPaths(['/r/src/x.ts', '/r/lib/y.ts']).values()]).toEqual(['src/x.ts', 'lib/y.ts'])
  expect([...shortPaths(['/repo/deep/x.ts']).values()]).toEqual(['deep/x.ts'])
})

test('journal, harness-aware task text, titles, digests', () => {
  const j = parseJournal(bigJournal())
  expect(j.length).toBe(50)
  expect(j[12]).toEqual({ agentId: 'w12', label: 'verify:12', phase: 'Verify', isDone: true })
  expect(firstPrompt(harnessTranscript('List the test files.'))).toBe('List the test files.')
  expect(cleanTitle('"Check the retry loop."\nextra')).toBe('Check the retry loop')
  expect(parseDigest('```json\n{"outcome":"It **found** 3.","points":["a","b","c","d"]}\n```')).toEqual({ outcome: 'It found 3.', points: ['a', 'b', 'c'] })
  expect(parseDigest('no json')).toBeUndefined()
})

test('list building: folds, filters, groups, scopes, pipeline', () => {
  const n = (id: string, over: Partial<AgentNode> = {}): AgentNode =>
    ({ id, kind: 'agent', label: id, status: 'done', startedAt: 1, endedAt: 2, tools: 0, ...over })
  const wf = n('wf', { kind: 'workflow', status: 'running', phases: ['A', 'B'] })
  const kids = Array.from({ length: 8 }, (_, i) => n(`k${i}`, { parentId: 'wf', phase: i < 6 ? 'A' : 'B', status: i === 0 ? 'running' : 'done' }))
  const all = [wf, ...kids]
  expect(workflowItems(wf, all, 'all', [], []).map(i => i.kind)).toEqual(['phase', 'node', 'node', 'node', 'node', 'more', 'phase'])
  expect(topItems(all, 'all', false, 0).length).toBe(1)
  expect(pipeline(wf, all).map(p => [p.phase, p.running, p.done])).toEqual([['A', 1, 5], ['B', 0, 2]])
  expect(scopeNodes(all, { kind: 'phase', wfId: 'wf', phase: 'B' }).map(k => k.id)).toEqual(['k6', 'k7'])
  expect(scopeNodes(all, { kind: 'node', id: 'wf' }).length).toBe(9)
  const cats = [n('c1', { status: 'running', type: 'Explore' }), n('c2', { status: 'running', type: 'Plan', where: 'worktree' })]
  expect(topItems(cats, 'all', false, 0, 'where').filter(i => i.kind === 'header').map(i => (i as { text: string }).text)).toEqual(['Main checkout', 'Own worktree'])
  expect(bar(1, 2, 4)).toEqual({ filled: '▰▰', empty: '▱▱', pct: 50 })
  const big = { nodes: [], history: Array.from({ length: 2000 }, (_, i) => n(`h${i}`, { result: 'x'.repeat(300) })) }
  expect(JSON.stringify(fitProps(big)).length).toBeLessThanOrEqual(90_000)
})

test('the view accepts the previous version props and state', () => {
  expect(viewProps({ nodes: [], at: 5 }).history).toEqual([])
  const s = viewState({ sel: 2, first: 0, open: ['a1'], tick: 7, drawer: true, group: 'nope' })
  expect([s.tab, s.path, s.view, s.filter, s.group, s.sel, s.tick]).toEqual(['live', null, 'agents', 'all', 'none', 2, 7])
})

test('diffs: true line changes, edit records, readable phases and results', () => {
  const d = lineDiff('## Ideas\n\n- (none yet)', '## Ideas\n\n- one\n- two', 5)
  expect(d.map(l => `${l.op}${l.op === '-' ? l.oldNo : l.newNo} ${l.text}`)).toEqual([' 5 ## Ideas', ' 6 ', '-7 - (none yet)', '+7 - one', '+8 - two'])
  expect(diffCounts(d)).toEqual({ added: 2, removed: 1 })
  expect(diffCounts(lineDiff('a\nb', 'a\nb\nc'))).toEqual({ added: 1, removed: 0 })
  const after = 'x\ny\nNEW\nz'
  expect(editRecords('Edit', { file_path: '/r/a.ts', old_string: 'OLD', new_string: 'NEW' }, undefined, after)).toEqual([{ path: '/r/a.ts', old: 'OLD', new: 'NEW', line: 3 }])
  expect(editRecords('Write', { file_path: '/r/n.ts', content: 'hi' }, undefined, 'hi')).toEqual([{ path: '/r/n.ts', old: '', new: 'hi', line: 1, isNew: true }])
  expect(phaseWords({ phase: 'A', total: 3, running: 1, done: 2, failed: 0, stopped: 0 })).toBe('1 running, 2 done')
  expect(readableResult('{"drafts":["Added ideas.","Raised retries."],"refine":"Documented settings."}')).toBe('Added ideas. Raised retries. Documented settings.')
})

// A run from before edits were kept: History knows the file changed, the store has no edit text.
const oldTranscript = [
  { type: 'assistant', timestamp: '2026-10-04T13:56:32.000Z', message: { content: [
    { type: 'tool_use', id: 'tu1', name: 'Edit', input: { file_path: '/demo/config.json', old_string: '  "retries": 1,', new_string: '  "retries": 3,' } },
    { type: 'tool_use', id: 'tu2', name: 'Edit', input: { file_path: '/demo/config.json', old_string: 'nope', new_string: 'never' } },
  ] } },
  { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu2', is_error: true, content: 'not found' }] } },
].map(r => JSON.stringify(r)).join('\n')

test('a run recorded before edits were kept gets its diff from the transcript', async ($, on) => {
  mock.clock(on)
  const at = Date.parse('2026-10-04T13:56:00Z')
  mock.store(on, { history: [
    { id: 'wf1', kind: 'workflow', label: 'Edit two scratch files', status: 'done', startedAt: at, endedAt: at + 9000, tools: 0, transcriptDir: '/runs/old' },
    { id: 'a1', kind: 'agent', parentId: 'wf1', label: 'Edit config.json', phase: 'Draft', status: 'done', startedAt: at, endedAt: at + 5000, tools: 2,
      changes: { '/demo/config.json': { edits: 1, added: 1, removed: 1 } } },
  ] })
  on('fs.read', (_$, e) => {
    if (e.path === '/runs/old/agent-a1.jsonl') return { value: oldTranscript }
    if (e.path === '/demo/config.json') return { value: '{\n  "name": "demo",\n  "retries": 3,\n  "timeoutMs": 5000\n}\n' }
    return { deny: 'missing' }
  })
  const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
  await ui.key({ in: KEY, key: '2' })
  await ui.key({ in: KEY, key: 'c' }) // the run, straight into Changes
  await ui.key({ in: KEY, key: 'return' }) // config.json's diff
  expect(await ui.find({ in: KEY, text: '+  ' + '  "retries": 3,' })).toBeDefined()
  expect(await ui.find({ in: KEY, text: '−  ' + '  "retries": 1,' })).toBeDefined()
  expect(await ui.find({ in: KEY, text: /never/ })).toBeUndefined() // the failed call is left out
  await ui.unmount()
})

test('transcript edits: calls that landed, placed in the file as it is now', () => {
  const recs = transcriptEdits(oldTranscript, 'a1', 'x\n  "retries": 3,\n')
  expect(recs.length).toBe(1)
  expect(recs[0]).toMatchObject({ id: 'tu1:0', agentId: 'a1', path: '/demo/config.json', line: 2 })
})

// Six spawns in one turn are one piece of work; a spawn in the next turn is its own run.
async function turnOfSpawns($: Engine, on: On) {
  const clock = mock.clock(on)
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('ui.toast', () => ({ value: undefined }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('agent.spawn', (_$, e) => ({ model: 'claude-sonnet-5-5', agentId: `cat-${e.tool_use_id}` }))
  on('model.complete', (_$, e) => ({
    value: { isAnswered: true, usage, text: e.prompt.startsWith('Agents and their tasks')
      ? 'Map how auth tokens flow'
      : '{"outcome":"Tokens are signed in jwt.ts and checked in middleware.","points":["refresh lives in session.ts"]}' },
  }) as never)
  on('prompt.submit', () => ({ text: '' }) as never)
  on('turn.complete', () => ({ text: '' }) as never)
  await $.prompt.submit({ text: 'explore auth', origin: { kind: 'user' }, wait: false } as never)
  const tasks = ['Find the token issuer', 'Trace the refresh flow', 'Map the middleware', 'List auth routes', 'Find key storage', 'Check logout']
  // parallel Agent calls: every spawn lands at once
  await Promise.all(tasks.map((d, i) => $.agent.spawn({ ...spawnBase, tool_use_id: `t${i}`, prompt: `${d} in src/auth`, description: d, subagentType: 'Explore' } as never)))
  await clock.advance(100)
  return clock
}

describe('subagents from one turn', () => {
  test('cluster under one Haiku-named group, and a new turn starts a new run', async ($, on) => {
    const clock = await turnOfSpawns($, on)
    await $.prompt.submit({ text: 'now check billing', origin: { kind: 'user' }, wait: false } as never)
    await $.agent.spawn({ ...spawnBase, tool_use_id: 'solo', prompt: 'read billing.ts', description: 'Read the billing module', subagentType: 'Explore' } as never)
    await clock.advance(100)
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
    expect(await ui.find({ in: KEY, text: 'Map how auth tokens flow' })).toBeDefined()
    expect(await ui.find({ in: KEY, text: '0/6' })).toBeDefined()
    expect(await ui.find({ in: KEY, text: 'Read the billing module' })).toBeDefined() // one spawn stays a plain row
    expect(await ui.find({ in: KEY, text: 'Trace the refresh flow' })).toBeUndefined() // members sit inside the group
    await ui.key({ in: KEY, key: 'return' })
    expect(await ui.find({ in: KEY, text: 'All agents' })).toBeDefined()
    expect(await ui.find({ in: KEY, text: 'Trace the refresh flow' })).toBeDefined()
    expect(await ui.find({ in: KEY, text: '6 running' })).toBeDefined()
    await ui.unmount()
  })

  test('the group ends with its last member, gets one digest, and moves to History', async ($, on) => {
    const clock = await turnOfSpawns($, on)
    for (let i = 0; i < 6; i++) {
      await $.turn.complete({ agentId: `cat-t${i}`, answer: `Report ${i}: found it.`, durationMs: 1000, isAborted: false, reason: 'answer', usage } as never)
    }
    await clock.advance(100)
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
    expect(await ui.find({ in: KEY, text: /Live 0/ })).toBeDefined()
    await ui.key({ in: KEY, key: '2' })
    expect(await ui.find({ in: KEY, text: /History 1/ })).toBeDefined()
    await ui.key({ in: KEY, key: 'return' })
    expect(await ui.find({ in: KEY, text: /Tokens are signed in jwt\.ts/ })).toBeDefined()
    expect(await ui.find({ in: KEY, text: '6 done' })).toBeDefined()
    await ui.unmount()
  })
})
