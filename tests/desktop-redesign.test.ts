import { describe, expect, test } from 'claude-code/testing'
import type { AgentNode } from '../types'
import { childrenOf, joinNodes } from '../hooks/list'
import { listTimelineRows } from '../hooks/lens'
import { DESK, stripSvg, timelineSvg } from '../hooks/desktop/svg'

// The desktop redesign: no repeated rows, a stacked report, a readable timeline.

const t0 = Date.parse('2026-10-06T16:53:00Z')
// A finished cluster of two refuters, as the store keeps it.
const run: AgentNode[] = [
  { id: 'grp:1', kind: 'group', label: 'Verify Distributed Systems notes against DDIA', status: 'done', startedAt: t0, endedAt: t0 + 90000, tools: 0, repo: '/repo/a',
    report: { result: 'Checked 23 claims. 14 hold. 9 lack full support.', problems: [{ text: 'Claim 11 has no supporting citation.', source: 'Refute ch3,7 audit findings' }], next: 'Find the missing citations.' } },
  { id: 'a1', kind: 'agent', parentId: 'grp:1', label: 'Refute ch8,9 audit findings', status: 'done', startedAt: t0, endedAt: t0 + 73000, tools: 9, tokens: 500000, report: { result: 'Checked 11 claims in ch8-9.' } },
  { id: 'a2', kind: 'agent', parentId: 'grp:1', label: 'Refute ch3,7 audit findings', status: 'done', startedAt: t0 + 10000, endedAt: t0 + 90000, tools: 9, tokens: 733000, report: { result: 'Checked 12 claims in ch3 and ch7.' } },
] as AgentNode[]

describe('desktop redesign', () => {
  // A run that just finished stays in the session's live list and is in History too.
  test('a run in both Live and History is joined once, live first', () => {
    const live = run.map(n => ({ ...n, tools: 99 }))
    const all = joinNodes(live, run)
    expect(all.length).toBe(3)
    expect(all.every(n => n.tools === 99)).toBe(true)
    expect(childrenOf(all, 'grp:1').length).toBe(2)
  })

  test('the run list timeline opens each run into its agents, newest runs first', () => {
    const solo = { id: 's1', kind: 'agent', label: 'Refute ch10-12 audit findings', status: 'done', startedAt: t0 + 100000, endedAt: t0 + 190000, tools: 3 } as AgentNode
    const { rows, runs, hidden } = listTimelineRows([...run, solo], [run[0]!, solo], 1)
    // only the newest run fits under a cap of 1: the solo agent, as one bar with no heading
    expect(runs).toBe(1)
    expect(hidden).toBe(1)
    expect(rows).toEqual([{ kind: 'bar', node: solo }])
    const both = listTimelineRows([...run, solo], [run[0]!, solo])
    expect(both.rows.map(r => (r.kind === 'label' ? `# ${r.text}` : r.node.id))).toEqual(['# Verify Distributed Systems notes against DDIA', 'a1', 'a2', 's1'])
  })

  test('timeline strips keep labels out of the picture and type at 12-13 px', () => {
    const bar = { label: 'Refute ch3,7 audit findings', start: t0, end: t0 + 80000, status: 'done' as const }
    const strip = stripSvg(DESK.minimal, bar, t0, t0 + 90000, 600)
    expect(strip).not.toContain('Refute')
    expect(strip).toContain('font-size="12"')
    expect(strip).toContain('>1m 20s<')
    const pic = timelineSvg(DESK.minimal, [bar], t0, t0 + 90000, 900)
    expect(pic).toContain('font-size="13"')
    expect(pic).not.toContain('font-size="9"')
  })
})
