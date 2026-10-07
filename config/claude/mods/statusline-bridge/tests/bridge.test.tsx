import { describe, expect, mock, test } from 'claude-code/testing'

import { meter, partsOf, share, usedLine, windowLine } from '../hooks/register'

const NOW = Date.parse('2026-10-06T12:00:00Z')
const USAGE = {
  startedAt: 0,
  context: { tokens: 83_000, window: 1_000_000, percent: 8 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 1, resetsAt: '2026-10-06T16:30:00Z' },
    { kind: 'seven_day', percentUsed: 13, resetsAt: '2026-10-12T10:00:00Z' },
  ],
  cost: { usd: 0.69 },
}
const FEED = JSON.stringify({
  categories: [
    { name: 'system', tokens: 4_800 },
    { name: 'tools', tokens: 27_000 },
    { name: 'mcp', tokens: 22_000 },
    { name: 'skills', tokens: 10_000 },
    { name: 'messages', tokens: 16_000 },
  ],
})
const PROPS = { hasSurvey: false, isWorking: false, maxRows: 12, bodyColumns: 90 } as never

describe('statusline-bridge', () => {
  test('svg helpers and feed parsing', async () => {
    expect(meter(50, '#82aaff')).toContain('<line')
    const parts = [{ name: 'tools', tokens: 27_000 }, { name: 'messages', tokens: 16_000 }]
    // the window line: one run per part, each with a tooltip, over a 1M track
    const win = windowLine(parts, 43_000, 1_000_000)
    expect(win.match(/class="seg"/g)?.length).toBe(2)
    expect(win).toContain('<title>tools: 27k (3% of window)</title>')
    expect(usedLine(parts)).toContain('<title>chat: 16k (37% of used)</title>')
    expect(share(306, 82_000)).toBe('<1%')
    expect(share(27_000, 82_000)).toBe('33%')
    // usage turns red from 80%; the cache line keeps its own color when full
    expect(meter(90, '#86e1fc')).toContain('#ff757f')
    expect(meter(100, '#c3e88d', 44, '', false)).not.toContain('#ff757f')
    expect(partsOf({ categories: [{ name: 'tools', tokens: 5 }, { name: 'x', tokens: 0 }] })).toEqual([{ name: 'tools', tokens: 5 }])
    expect(partsOf(null)).toEqual([])
  })

  for (const surface of ['desktop', 'terminal'] as const) {
    test(`band on ${surface}`, async ($, on) => {
      mock.clock(on, { now: NOW })
      on('session.usage', () => ({ value: USAGE }))
      on('session.model', () => ({ value: 'claude-opus-5-5' }))
      on('session.cwd', () => ({ value: '/work/app' }))
      on('session.id', () => ({ value: 's1' }))
      on('session.repo', () => ({ value: null }))
      on('env.get', () => ({ value: '/home/me' }))
      on('fs.read', (_, e) => (String(e.path).endsWith('s1.json') ? { value: FEED } : { deny: 'missing' }) as never)
      on('session.start', () => ({ cwd: '/work/app' }))
      on('turn.complete', () => ({ text: '' }))
      on('ui.render', () => ({ type: 'Text', props: {}, children: ['beneath'] }) as never)

      await $.session.start({ cwd: '/work/app', surface, isInteractive: true })
      await $.turn.complete({
        answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'end_turn',
        usage: { model: 'claude-opus-5-5', input_tokens: 2, output_tokens: 5, cache_read_input_tokens: 74_000, cache_creation_input_tokens: 26_000 },
      } as never)

      const ui = await $.ui.mount({ plugin: 'statusline-bridge', surface, component: 'AbovePrompt', props: PROPS })
      if (surface === 'terminal') {
        expect(await ui.find({ text: /Opus 5\.5/ })).toBeUndefined()
        expect(await ui.find({ text: 'beneath' })).toBeDefined()
        return
      }
      // the chip row
      expect(await ui.find({ text: /Opus/ })).toBeUndefined()
      expect(await ui.find({ text: /app/ })).toBeUndefined()
      expect(await ui.find({ text: '8%' })).toBeDefined()
      expect(await ui.find({ text: '83k/1M' })).toBeDefined()
      expect(await ui.find({ text: 'beneath' })).toBeDefined()
      expect(await ui.find({ type: 'Button' })).toBeUndefined()
      // the band is a hover scope, and the detail rows wait for hover
      const band = await ui.find({ key: 'band' })
      expect(band?.type).toBe('Box')
      type Node = { props?: Record<string, unknown>; hover?: unknown; children?: unknown[] }
      const all: Node[] = []
      const walk = (n: unknown) => {
        if (!n || typeof n !== 'object') return
        all.push(n as Node)
        for (const c of (n as Node).children ?? []) walk(c)
      }
      walk(await ui.drawn())
      const reveal = all.find(n => n.props?.display === 'none')
      expect(reveal?.hover).toEqual({ display: 'flex' })
      expect(await ui.find({ text: /fixed 64k · chat 16k/ })).toBeDefined()
      expect(await ui.find({ text: /● tools/ })).toBeDefined()
      expect(await ui.find({ text: /60m left of 1h/ })).toBeDefined()
      expect(await ui.find({ text: /hit 74%/ })).toBeDefined()
      // every Svg is a plain image at its exact size: the interactive frame
      // paints a white 300x150 box in the app
      const svgs = await ui.findAll({ type: 'Svg' })
      expect(svgs.length).toBeGreaterThan(3)
      expect(svgs.every(v => v.props.isInteractive === undefined)).toBe(true)
      expect(svgs.every(v => typeof v.props.width === 'number' && v.props.height === 10)).toBe(true)
    })
  }
})
