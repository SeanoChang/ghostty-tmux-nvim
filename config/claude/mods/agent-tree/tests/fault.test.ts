import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

// One draw over the Client's budget unmounts the view, and the engine draws
// nothing more under that key: the pane stays dead until the mod reloads.

const KEY = 'tree-v7'
const PANE = {
  component: 'Pane' as const,
  requestId: 'agent-tree',
  props: { title: 'Agents', isFocused: true, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 40 } } as never,
  viewport: { columns: 90, rows: 44 },
}
const NOW = new Date(2026, 9, 5, 15, 0, 0).getTime()
const inRepoA = () => ({ value: { exitCode: 0, stdout: '/repo/a\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as never
const hrun = (id: string, label: string, ago: number, over: Record<string, unknown> = {}) =>
  ({ id, kind: 'agent', label, status: 'done', startedAt: NOW - ago, endedAt: NOW - ago + 30_000, tools: 2, repo: '/repo/a', ...over })

describe('a view that faults', () => {
  const clientKey = async (ui: { find: (q: { type: string }) => Promise<{ key: string | undefined } | undefined> }) => (await ui.find({ type: 'Client' }))?.key
  async function faulting($: Engine, on: On) {
    const clock = mock.clock(on, { now: NOW })
    const history = Array.from({ length: 150 }, (_, i) => hrun(`f${i}`, `Check the fault path ${i} ${'x'.repeat(180)}`, (i + 1) * 60_000, { summary: 'y'.repeat(300) }))
    mock.store(on, { history })
    on('process.run', inRepoA)
    on('session.root', () => ({ value: '/repo/a' }) as never)
    const ui = await $.ui.mount({ plugin: 'agent-tree', surface: 'terminal', ...PANE })
    // History in a pane far past any real terminal draws a tree over the engine's
    // 100,000-character bound: a real fault of the drawn instance (phase render)
    const fault = async () => {
      const key = (await clientKey(ui))!
      await ui.key({ in: key, key: '2' })
      await ui.resize({ in: key, columns: 400, rows: 400 })
    }
    return { clock, ui, fault }
  }

  // mounting 150 runs is the slow part; slack for a loaded machine
  const SLOW = { timeoutMs: 20_000 }

  test('a failed view is drawn again under a new key', SLOW, async ($, on) => {
    const { ui, fault } = await faulting($, on)
    expect(await clientKey(ui)).toBe(KEY)
    await fault()
    const key = (await clientKey(ui))!
    expect(key).toBeDefined()
    expect(key).not.toBe(KEY)
    // the new instance draws at the pane's own size, from its first tab
    await ui.key({ in: key, key: '2' })
    expect(await ui.find({ in: key, text: /Check the fault path 0/ })).toBeDefined()
    await ui.unmount()
  })

  test('three retries in ten minutes; the fourth failure waits for a reload', SLOW, async ($, on) => {
    const { ui, fault } = await faulting($, on)
    const keys: string[] = []
    for (let i = 0; i < 4; i++) { await fault(); keys.push((await clientKey(ui))!) }
    expect(new Set([KEY, ...keys.slice(0, 3)]).size).toBe(4)
    expect(keys[3]).toBe(keys[2])
    await ui.unmount()
  })

  test('once ten minutes pass, a failure is retried again', SLOW, async ($, on) => {
    const { clock, ui, fault } = await faulting($, on)
    for (let i = 0; i < 3; i++) await fault()
    const third = (await clientKey(ui))!
    await clock.set(NOW + 10 * 60_000 + 1)
    await fault()
    expect(await clientKey(ui)).not.toBe(third)
    await ui.unmount()
  })
})
