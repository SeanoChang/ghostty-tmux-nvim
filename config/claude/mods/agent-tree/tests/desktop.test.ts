import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { ART, SLOTS } from '../hooks/desktop/sprites'
import { spriteSvg, walkSvg } from '../hooks/desktop/svg'

// Phase 6: the desktop surface draws its own native view (Svg, Buttons, Code,
// Markdown) instead of the terminal grid. These tests drive it by pressing.

const PANE = {
  component: 'Pane' as const,
  requestId: 'agent-tree',
  props: { title: 'Agents', isFocused: true, bodyColumns: 130, placement: 'dock', scroll: { offset: 0, bodyRows: 40 } } as never,
  viewport: { columns: 130, rows: 44 },
}
const NARROW = { ...PANE, props: { ...PANE.props as object, bodyColumns: 50 } as never, viewport: { columns: 50, rows: 44 } }

const t0 = Date.parse('2026-10-05T10:00:00Z')
const runs = [
  { id: 'w1', kind: 'workflow', label: 'Review changed files across dimensions', status: 'done', startedAt: t0, endedAt: t0 + 242000, tools: 0, phases: ['Review', 'Verify'], repo: '/repo/a',
    report: { result: 'Found 3 issues; 2 confirmed by verifiers.', problems: [{ text: 'retry-after ran out of turns.', source: 'verify:retry-after' }], next: 'Rerun it with more turns.', model: 'Haiku', tokens: 900 },
    partReports: { Review: { result: 'Three reviewers found 3 issues.' }, Verify: { result: 'Two of three confirmed.' } } },
  { id: 'w1a', kind: 'agent', parentId: 'w1', label: 'review:bugs', phase: 'Review', status: 'done', startedAt: t0, endedAt: t0 + 90000, tools: 3, tokens: 30000,
    changes: { '/repo/a/src/auth.ts': { edits: 1, added: 3, removed: 1 } } },
  { id: 'w1b', kind: 'agent', parentId: 'w1', label: 'verify:retry-after', phase: 'Verify', status: 'failed', startedAt: t0 + 90000, endedAt: t0 + 200000, tools: 25, tokens: 12000 },
  { id: 'h1', kind: 'agent', label: 'Map nark-os agents and memory', type: 'Explore', status: 'done', startedAt: t0 + 300000, endedAt: t0 + 351000, tools: 15, result: 'Tools, not personas.', repo: '/repo/a',
    prompt: 'find every caller of parseJwt' },
  { id: 'h2', kind: 'agent', label: 'Build the explainer', type: 'fork', status: 'failed', startedAt: t0 + 400000, endedAt: t0 + 1000000, tools: 0, repo: '/repo/a' },
]
const edits = [{
  id: 'e1', agentId: 'w1a', path: '/repo/a/src/auth.ts', at: t0 + 60000, line: 41,
  old: 'export async function refresh(token: Session) {\n  return issue(token.userId)\n}',
  new: 'export async function refresh(token: Session) {\n  if (isExpired(token)) throw new AuthError(\'expired\')\n  await revoke(token.id)\n  return issue(token.userId)\n}',
}]

async function desk($: Engine, on: On, pane: typeof PANE = PANE) {
  mock.clock(on)
  mock.store(on, { history: runs, edits })
  on('session.root', () => ({ value: '/repo/a' }) as never)
  on('fs.read', () => ({ deny: 'missing' }) as never)
  on('env.get', () => ({ value: '/home/test' }) as never)
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never)
  return $.ui.mount({ plugin: 'agent-tree', surface: 'desktop', ...pane })
}

type Found = { type?: string; props?: Record<string, unknown> }
const svgs = async (ui: Awaited<ReturnType<typeof desk>>) => (await ui.findAll({ type: 'Svg' })) as unknown as Found[]

describe('desktop: a native view', () => {
  test('draws Svg pictures and Buttons, never the terminal grid', async ($, on) => {
    const ui = await desk($, on)
    expect(await ui.find({ type: 'Client' })).toBeUndefined()
    expect((await svgs(ui)).length).toBeGreaterThan(0)
    expect(await ui.find({ key: 'tab:live' })).toBeDefined()
    expect(await ui.find({ key: 'tab:history' })).toBeDefined()
    expect(await ui.find({ key: 'lens:board' })).toBeDefined()
    await ui.unmount()
  })

  test('the History tab shows the page: numbers, a sparkline, runs by day', async ($, on) => {
    const ui = await desk($, on)
    await ui.press({ key: 'tab:history' })
    expect(await ui.find({ text: 'finished OK' })).toBeDefined()
    expect(await ui.find({ key: 'run:h1' })).toBeDefined()
    const spark = (await svgs(ui)).find(s => String(s.props?.alt ?? '').startsWith('Runs per day'))
    expect(spark).toBeDefined()
    expect(await ui.find({ key: 'search' })).toBeDefined()
    await ui.unmount()
  })

  test('a run opens with its report: verdict, what needs attention, parts, next, changed files', async ($, on) => {
    const ui = await desk($, on)
    await ui.press({ key: 'tab:history' })
    await ui.press({ key: 'run:w1' })
    const md = ((await ui.findAll({ type: 'Markdown' })) as unknown as Found[]).map(m => String(m.props?.text ?? '')).join('\n')
    // the verdict is the large heading; each section has its own heading
    expect(md).toContain('## Found 3 issues; 2 confirmed by verifiers.')
    for (const h of ['### Parts (2)', '### Next step', '### Changed files (1)']) expect(md).toContain(h)
    expect(await ui.find({ text: 'Needs your attention (1)' })).toBeDefined()
    expect(md).toContain('- retry-after ran out of turns. — _verify:retry-after_')
    expect(await ui.find({ key: 'part:phase:w1:Review' })).toBeDefined()
    // the tree beside it: phases, whose finished agents start folded
    expect(await ui.find({ key: 'sel:phase:w1:Review' })).toBeDefined()
    await ui.press({ key: 'sel:phase:w1:Verify' })
    expect(await ui.find({ text: 'Two of three confirmed.' })).toBeDefined()
    await ui.unmount()
  })

  test('picking an agent shows its detail; Output renders Markdown with its task', async ($, on) => {
    const ui = await desk($, on)
    await ui.press({ key: 'tab:history' })
    await ui.press({ key: 'run:h1' })
    await ui.press({ key: 'view:output' })
    // the summary card's verdict is one Markdown; the Output view is the other
    const md = (await ui.findAll({ type: 'Markdown' })) as unknown as Found[]
    expect(md.length).toBe(2)
    expect(md.some(m => String(m.props?.text).includes('find every caller of parseJwt'))).toBe(true)
    await ui.unmount()
  })

  test('Changes lists files; a file opens Claude-style diffs, one per edit', async ($, on) => {
    const ui = await desk($, on)
    await ui.press({ key: 'tab:history' })
    await ui.press({ key: 'run:w1' })
    await ui.press({ key: 'view:changes' })
    await ui.press({ key: 'file:/repo/a/src/auth.ts' })
    const code = (await ui.findAll({ type: 'Code' })) as unknown as Found[]
    expect(code.length).toBeGreaterThan(0)
    expect(code[0]!.props?.format).toBe('diff')
    expect(code[0]!.props?.wrap).toBe('wrap')
    expect(String(code[0]!.props?.source)).toMatch(/^@@ -/)
    await ui.press({ key: 'files' })
    expect((await ui.findAll({ type: 'Code' })).length).toBe(0)
    await ui.unmount()
  })

  test('the lens switch draws a board and a timeline', async ($, on) => {
    const ui = await desk($, on)
    await ui.press({ key: 'tab:history' })
    await ui.press({ key: 'run:w1' })
    await ui.press({ key: 'lens:board' })
    expect(await ui.find({ text: /^1 failed or stopped$/ })).toBeDefined()
    expect(await ui.find({ key: 'bsel:w1b' })).toBeDefined()
    await ui.press({ key: 'lens:timeline' })
    const tl = (await svgs(ui)).find(s => String(s.props?.alt ?? '').startsWith('Timeline of'))
    expect(tl).toBeDefined()
    await ui.unmount()
  })

  test('the Trace lens reads the trail of a run and draws its lanes', async ($, on) => {
    const ui = await desk($, on)
    await ui.press({ key: 'tab:history' })
    await ui.press({ key: 'run:w1' })
    await ui.press({ key: 'lens:trace' })
    await ui.advance(50)
    const trace = (await svgs(ui)).find(s => String(s.props?.alt ?? '').startsWith('Trace of'))
    const reading = await ui.find({ text: /Reading the transcripts/ })
    expect(trace !== undefined || reading !== undefined).toBe(true)
    expect(await ui.find({ key: 'zoom:steps' })).toBeDefined()
    await ui.unmount()
  })

  test('This repo and All filter History', async ($, on) => {
    mock.clock(on)
    mock.store(on, { history: [...runs, { id: 'x1', kind: 'agent', label: 'Run elsewhere', status: 'done', startedAt: t0, endedAt: t0 + 1000, tools: 1, repo: '/repo/b' }] })
    on('session.root', () => ({ value: '/repo/a' }) as never)
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'desktop', ...PANE })
    await ui.press({ key: 'tab:history' })
    expect(await ui.find({ key: 'run:x1' })).toBeUndefined()
    await ui.press({ key: 'scope:all' })
    expect(await ui.find({ key: 'run:x1' })).toBeDefined()
    await ui.unmount()
  })

  test('under 60 columns the pane asks to be widened', async ($, on) => {
    const ui = await desk($, on, NARROW)
    expect(await ui.find({ text: /Widen the pane/ })).toBeDefined()
    expect(await ui.find({ key: 'tab:live' })).toBeUndefined()
    await ui.unmount()
  })
})

describe('desktop: themes', () => {
  test('kitty draws pixel sprites as crisp-edged Svg', { options: { theme: 'kitty' } }, async ($, on) => {
    const ui = await desk($, on)
    await ui.press({ key: 'tab:history' })
    const all = await svgs(ui)
    const pixel = all.filter(s => String(s.props?.source ?? '').includes('shape-rendering="crispEdges"'))
    expect(pixel.length).toBeGreaterThan(2)
    expect(all.every(s => String(s.props?.source ?? '').length < 131_072)).toBe(true)
    await ui.unmount()
  })

  test('minimal draws line icons and no sprites', async ($, on) => {
    const ui = await desk($, on)
    await ui.press({ key: 'tab:history' })
    const all = await svgs(ui)
    expect(all.length).toBeGreaterThan(0)
    expect(all.some(s => String(s.props?.source ?? '').includes('crispEdges'))).toBe(false)
    expect(all.some(s => String(s.props?.source ?? '').includes('stroke-linecap="round"'))).toBe(true)
    await ui.unmount()
  })

  test('kitty empty Live shows the sleeping-cat scene', { options: { theme: 'kitty' } }, async ($, on) => {
    const ui = await desk($, on)
    expect(await ui.find({ text: 'No cats out.' })).toBeDefined()
    const scene = (await svgs(ui)).find(s => s.props?.alt === 'A cat asleep on a keyboard')
    expect(scene).toBeDefined()
    await ui.unmount()
  })

  for (const [theme, empty, alt, emptyHistory] of [
    ['fish', 'Lines are dry.', 'A rod propped on a dock at night, a fish asleep below', 'Nothing in the bucket yet.'],
    ['dog', 'No dogs out.', 'A dog asleep by its dog house', 'No dogs are back from walks yet.'],
  ] as const) {
    test(`${theme} draws its own pixel sprites and empty scene`, { options: { theme } }, async ($, on) => {
      const ui = await desk($, on)
      expect(await ui.find({ text: empty })).toBeDefined()
      const scene = (await svgs(ui)).find(s => s.props?.alt === alt)
      expect(String(scene?.props?.source ?? '')).toContain(ART[theme].pal.o!)
      await ui.press({ key: 'tab:history' })
      const pixel = (await svgs(ui)).filter(s => String(s.props?.source ?? '').includes('shape-rendering="crispEdges"'))
      expect(pixel.length).toBeGreaterThan(2)
      expect(await ui.find({ text: emptyHistory })).toBeUndefined() // History has runs
      await ui.unmount()
    })
  }
})

test('desktop: a run\'s timeline names its critical path and saves a picture', async ($, on) => {
  const writes: string[] = []
  on('fs.write', (_$, e) => { writes.push(e.path); return { value: undefined } as never })
  on('ui.toast', () => ({ value: undefined }) as never)
  const ui = await desk($, on)
  await ui.press({ key: 'tab:history' })
  await ui.press({ key: 'run:w1' })
  await ui.press({ key: 'lens:timeline' })
  // the timeline opens on its own card: a headline and time tiles
  expect(await ui.find({ text: /^TIMELINE · Review changed files across dimensions$/ })).toBeDefined()
  expect(await ui.find({ text: 'critical path · 2 agents' })).toBeDefined()
  for (const label of ['total time', 'idle', 'agents']) expect(await ui.find({ text: label })).toBeDefined()
  const md = ((await ui.findAll({ type: 'Markdown' })) as unknown as Found[]).map(m => String(m.props?.text ?? ''))
  // the time is the large headline; the critical path follows as body text
  expect(md.some(m => /^## It took [^.]+\.\n\n2 agents on the critical path set the end time\.$/.test(m))).toBe(true)
  // its phases are section headings, as in the report
  expect(md).toContain('### Review')
  // each bar's label is a native button that picks the agent
  await ui.press({ key: 'tsel:w1b' })
  expect(await ui.find({ key: 'tsel:w1b' })).toBeDefined()
  await ui.press({ key: 'save-timeline' })
  await ui.advance(600)
  expect(writes.some(p => /^\/home\/test\/Downloads\/agent-tree\/review-changed-files-across-dimensions-timeline-.*\.svg$/.test(p))).toBe(true)
  await ui.unmount()
})

test('sprites: each art set fills every slot; grids are rectangular, every pixel in its palette, sizes under the Svg cap', () => {
  for (const set of Object.values(ART)) {
    for (const slot of SLOTS) {
      const grid = set.pix[slot]
      expect(grid.length).toBeGreaterThan(0)
      expect(new Set(grid.map(r => r.length)).size).toBe(1)
      expect([...grid.join('')].every(ch => ch === '.' || ch in set.pal)).toBe(true)
      const svg = spriteSvg(set, slot, slot === 'scene' ? 128 : 48)
      expect(svg).toContain('crispEdges')
      expect(svg.length).toBeLessThan(131_072)
    }
    expect((walkSvg(set, 48).match(/<animate /g) ?? []).length).toBe(4)
  }
  // kitty's failed cat lies down: its top five rows are clear, unlike done, which sits up
  expect(ART.kitty.pix.failed.slice(0, 5).every(r => /^\.+$/.test(r))).toBe(true)
  expect(ART.kitty.pix.done.slice(0, 5).some(r => /[^.]/.test(r))).toBe(true)
})

// The run view, direction C: a summary card first, one row of controls, no outlines.
test('desktop: a run opens on a tinted summary card with tiles, under one row of controls, with no outlines', async ($, on) => {
  const ui = await desk($, on)
  await ui.press({ key: 'tab:history' })
  await ui.press({ key: 'run:w1' })
  // one row: back, the lens switch, Explain; Live/History and scope wait on the list
  expect(await ui.find({ key: 'back' })).toBeDefined()
  expect(await ui.find({ key: 'lens:timeline' })).toBeDefined()
  expect(await ui.find({ key: 'tab:live' })).toBeUndefined()
  expect(await ui.find({ key: 'scope:all' })).toBeUndefined()
  // the card: status and name, then tiles for time, tokens, problems and files
  expect(await ui.find({ text: /^DONE · Review changed files across dimensions$/ })).toBeDefined()
  for (const label of ['time', 'tokens', 'problem', '1 file changed', 'agents · 2 phases']) expect(await ui.find({ text: label })).toBeDefined()
  // nothing in the pane draws an outline
  const boxes = (await ui.findAll({ type: 'Box' })) as unknown as Found[]
  expect(boxes.some(b => b.props?.borderStyle)).toBe(false)
  expect(boxes.some(b => String(b.props?.backgroundColor ?? '').length === 9)).toBe(true)
  await ui.unmount()
})

test('desktop: the board opens on its card; lanes are headed sections of status-tinted agent tiles', async ($, on) => {
  const ui = await desk($, on)
  await ui.press({ key: 'tab:history' })
  await ui.press({ key: 'lens:board' })
  expect(await ui.find({ text: /^BOARD · History runs$/ })).toBeDefined()
  const md = ((await ui.findAll({ type: 'Markdown' })) as unknown as Found[]).map(m => String(m.props?.text ?? ''))
  // w1b failed and h2 failed: 2 of 4 agents
  expect(md).toContain('## 2 of 4 agents failed or stopped.')
  for (const label of ['running', 'failed or stopped', 'done', 'runs']) expect(await ui.find({ text: label })).toBeDefined()
  expect(md).toContain('### Review changed files across dimensions')
  const boxes = (await ui.findAll({ type: 'Box' })) as unknown as Found[]
  expect(boxes.some(b => b.props?.borderStyle)).toBe(false)
  await ui.unmount()
})

test('desktop: a run that is one agent shows its card, not a one-row tree', async ($, on) => {
  const ui = await desk($, on)
  await ui.press({ key: 'tab:history' })
  await ui.press({ key: 'run:h1' })
  expect(await ui.find({ key: 'sel:h1' })).toBeUndefined()
  expect(await ui.find({ text: /^DONE · Map nark-os agents and memory$/ })).toBeDefined()
  await ui.unmount()
})
