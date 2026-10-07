import { describe, expect, mock, test } from 'claude-code/testing'

import { IDLE_MS, MAX_REFRESHES } from '../hooks/register'

const USAGE = (tokens: number) => ({ value: { startedAt: 0, context: { tokens, window: 1_000_000, percent: 30 }, rateLimits: [] } })
const FORK = { value: { isAnswered: true, text: 'ok', usage: { input_tokens: 5, output_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 300_000 } } }
const MIN = 60_000

describe('cache-keepalive', () => {
  test('fires once the session idles 50 minutes, then caps at 3', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    let forks = 0
    on('session.start', () => ({ cwd: '/w' }))
    on('session.usage', () => USAGE(300_000))
    on('session.id', () => ({ value: 's' }))
    on('env.get', () => ({ value: '/home/me' }))
    on('fs.write', () => ({ value: undefined }))
    on('model.fork', () => { forks += 1; return FORK as never })
    await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })

    await clock.advance(IDLE_MS - 2 * MIN)
    expect(forks).toBe(0)
    await clock.advance(3 * MIN)
    expect(forks).toBe(1)
    await clock.advance(4 * IDLE_MS)
    expect(forks).toBe(MAX_REFRESHES)
  })

  test('skips small contexts', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    let forks = 0
    on('session.start', () => ({ cwd: '/w' }))
    on('session.usage', () => USAGE(10_000))
    on('model.fork', () => { forks += 1; return FORK as never })
    await $.session.start({ cwd: '/w', surface: 'terminal', isInteractive: true })
    await clock.advance(2 * IDLE_MS)
    expect(forks).toBe(0)
  })
})
