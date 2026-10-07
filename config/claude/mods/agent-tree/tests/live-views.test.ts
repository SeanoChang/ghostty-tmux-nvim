import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import type { AgentNode } from '../types'
import { liveGroups, timelineRows } from '../hooks/lens'
import { buildTrace } from '../hooks/trace'
import { THEMES, THEME_NAMES } from '../hooks/theme'
import { DESK, statusColor, walkSlot } from '../hooks/desktop/svg'

// Live views review (2026-10-07): status colours follow the theme, sub-agents sit
// under the agent that spawned them, the run header is plain, the tree has weight.

const t0 = Date.parse('2026-10-07T17:27:00Z')
// A cluster of two resume agents; each spawned its own reviewers later.
const run: AgentNode[] = [
  { id: 'g', kind: 'group', label: 'Tailor resumes', status: 'done', startedAt: t0, endedAt: t0 + 300000, tools: 0, repo: '/repo/a' },
  { id: 'A', kind: 'agent', parentId: 'g', label: 'Resume A', status: 'done', startedAt: t0, endedAt: t0 + 290000, tools: 9, tokens: 50000 },
  { id: 'B', kind: 'agent', parentId: 'g', label: 'Resume B', status: 'failed', startedAt: t0 + 1000, endedAt: t0 + 200000, tools: 9, tokens: 40000 },
  { id: 'B1', kind: 'agent', parentId: 'B', label: 'B reviewer', status: 'done', startedAt: t0 + 2000, endedAt: t0 + 30000, tools: 2 },
  { id: 'A1', kind: 'agent', parentId: 'A', label: 'A reviewer', status: 'done', startedAt: t0 + 150000, endedAt: t0 + 180000, tools: 2 },
  { id: 'A2', kind: 'agent', parentId: 'A', label: 'A judge', status: 'done', startedAt: t0 + 200000, endedAt: t0 + 210000, tools: 1 },
] as AgentNode[]

describe('status colours follow the theme', () => {
  test('desktop: running is the theme accent, done is calm, failed is the bad colour', () => {
    for (const name of THEME_NAMES) {
      const t = DESK[name]
      expect(statusColor(t, 'running')).toBe(t.accent)
      expect(statusColor(t, 'done')).toBe(t.muted)
      expect(statusColor(t, 'failed')).toBe(t.bad)
    }
  })

  test('terminal: running is the theme accent and done is not green', () => {
    for (const name of THEME_NAMES) {
      const T = THEMES[name]
      expect(T.status.running.color).toBe(T.c.accent)
      expect(T.status.done.color).not.toBe(T.c.ok)
    }
  })
})

describe('sub-agents sit under the agent that spawned them', () => {
  test('timeline rows run depth-first, children by start time, with depth', () => {
    const rows = timelineRows(run[0]!, run, [], 'all')
    expect(rows.map(r => (r.kind === 'bar' ? `${r.node.id}@${r.depth}` : r.text))).toEqual(['A@0', 'A1@1', 'A2@1', 'B@0', 'B1@1'])
  })

  test('a folded parent hides its children and counts them', () => {
    const rows = timelineRows(run[0]!, run, [], 'all', ['tl:A'])
    expect(rows.map(r => (r.kind === 'bar' ? r.node.id : r.text))).toEqual(['A', 'B', 'B1'])
    const a = rows[0]!
    expect(a.kind === 'bar' && a.hidden).toBe(2)
  })

  test('trace lanes follow the same order and carry depth', () => {
    const { lanes } = buildTrace(run[0]!, run, new Map(), t0 + 300000, 'steps')
    expect(lanes.map(l => `${l.id}@${l.depth ?? 0}`)).toEqual(['main@0', 'A@0', 'A1@1', 'A2@1', 'B@0', 'B1@1'])
  })
})

describe('the running sprite', () => {
  test('steps through four walk frames on the redraw tick, one per second', () => {
    expect([0, 1, 2, 3, 4].map(k => walkSlot(t0 + k * 1000))).toEqual(['walk0', 'walk1', 'walk2', 'walk3', 'walk0'])
  })
})

describe('live status rows', () => {
  test('agents are grouped running, then failed or stopped, then done; each row keeps its step', () => {
    const live = [
      { id: 'g', kind: 'group', label: 'Review', status: 'running', startedAt: t0, tools: 0 },
      { id: 'x', kind: 'agent', parentId: 'g', label: 'Map engine', status: 'running', startedAt: t0, tools: 3, activity: 'Reading matching.py', tokens: 24000 },
      { id: 'y', kind: 'agent', parentId: 'g', label: 'Read docs', status: 'failed', startedAt: t0, endedAt: t0 + 28000, tools: 1 },
      { id: 'z', kind: 'agent', parentId: 'g', label: 'Find gaps', status: 'done', startedAt: t0, endedAt: t0 + 24000, tools: 4 },
      { id: 'w', kind: 'agent', parentId: 'g', label: 'Review tests', status: 'running', startedAt: t0 + 1000, tools: 2, activity: 'Running pytest' },
    ] as AgentNode[]
    const groups = liveGroups(live, 'g')
    expect(groups.map(g => `${g.status}:${g.nodes.map(n => n.id).join(',')}`)).toEqual(['running:x,w', 'failed:y', 'done:z'])
  })
})

// ── the desktop pane, mounted on a History run ───────────────────────────────

const PANE = {
  component: 'Pane' as const,
  requestId: 'agent-tree',
  props: { title: 'Agents', isFocused: true, bodyColumns: 130, placement: 'dock', scroll: { offset: 0, bodyRows: 40 } } as never,
  viewport: { columns: 130, rows: 44 },
}

async function desk($: Engine, on: On) {
  mock.clock(on)
  mock.store(on, { history: run, edits: [] })
  on('session.root', () => ({ value: '/repo/a' }) as never)
  on('fs.read', () => ({ deny: 'missing' }) as never)
  on('env.get', () => ({ value: '/home/test' }) as never)
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never)
  return $.ui.mount({ plugin: 'agent-tree', surface: 'desktop', ...PANE })
}

type Found = { type?: string; props?: Record<string, unknown> }

describe('desktop: an open run', () => {
  test('the tree gives levels weight: the run bold, sub-agents dim', async ($, on) => {
    const ui = await desk($, on)
    await ui.press({ key: 'tab:history' })
    await ui.press({ key: 'run:g' })
    const head = (await ui.find({ key: 'rlabel:g' })) as (Found & { children?: Found[] }) | undefined
    expect(head?.children?.[0]?.props?.bold).toBe(true)
    const agent = (await ui.find({ key: 'sel:A' })) as Found | undefined
    expect(agent?.props?.dimColor).toBeUndefined()
    const sub = (await ui.find({ key: 'sel:A1' })) as Found | undefined
    expect(sub?.props?.dimColor).toBe(true)
    await ui.unmount()
  })

  test('the run header is plain: no tinted card, no tiles, one fact line', async ($, on) => {
    const ui = await desk($, on)
    await ui.press({ key: 'tab:history' })
    await ui.press({ key: 'run:g' })
    expect(await ui.find({ key: 'tile-detail-time' })).toBeUndefined()
    const facts = (await ui.find({ key: 'facts-detail' })) as Found | undefined
    expect(facts).toBeDefined()
    const card = (await ui.find({ key: 'card-detail' })) as Found | undefined
    expect(card?.props?.backgroundColor).toBeUndefined()
    await ui.unmount()
  })
})
