// Cache keep-alive: Claude Code caches the conversation for 1 hour, and an
// idle session past that rebuilds the whole context on its next turn (a 2x
// write). A cache read resets the timer, so after 50 idle minutes this mod
// sends one tiny forked request over the session's own transcript, which
// reads the cache instead. Its own tail is never cached.
//
// Limits: only for contexts of MIN_TOKENS or more, at most MAX_REFRESHES per
// idle stretch (a new prompt resets the count), never while a turn runs.
// State goes to ~/.cache/claude-statusline/<session id>.keepalive.json for
// the status line script.

import type { EngineInterface, Register } from 'claude-code'

export const IDLE_MS = 50 * 60_000
export const MAX_REFRESHES = 3
export const MIN_TOKENS = 30_000
const TICK_MS = 60_000
const PROMPT = 'Keep-alive ping. Reply with the single word: ok'

export type KeepaliveState = {
  refreshes: number
  max: number
  lastAt: number | null
  lastReadTokens: number | null
  lastResult: string | null
}

// Module state: a reload starts it over, which only ever delays a refresh.
let lastStartMs = 0
let isBusy = false
let isFiring = false
let state: KeepaliveState = { refreshes: 0, max: MAX_REFRESHES, lastAt: null, lastReadTokens: null, lastResult: null }

async function tick($: EngineInterface): Promise<void> {
  if (isBusy || isFiring || state.refreshes >= MAX_REFRESHES) return
  const now = await $.clock.now()
  if (now - lastStartMs < IDLE_MS) return
  const { context } = await $.session.usage()
  if ((context.tokens ?? 0) < MIN_TOKENS) return

  isFiring = true
  lastStartMs = now
  try {
    const reply = await $.model.fork({ prompt: PROMPT })
    state = {
      ...state,
      refreshes: state.refreshes + 1,
      lastAt: Math.floor(now / 1000),
      lastReadTokens: reply.isAnswered ? reply.usage.cache_read_input_tokens ?? 0 : null,
      lastResult: reply.isAnswered ? 'ok' : reply.reason,
    }
    await save($, state)
  } catch {
    // A failed fork counts nothing; the next tick tries again.
  } finally {
    isFiring = false
  }
}

export const register: Register = on => {
  lastStartMs = 0
  isBusy = false
  state = { refreshes: 0, max: MAX_REFRESHES, lastAt: null, lastReadTokens: null, lastResult: null }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    lastStartMs = await $.clock.now()
    $.clock.every(TICK_MS, () => void tick($))
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    isBusy = true
    lastStartMs = await $.clock.now()
    if (state.refreshes > 0) {
      state = { ...state, refreshes: 0 }
      await save($, state)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      isBusy = false
      // The turn's last request started at or before now: idle time counts from here.
      lastStartMs = await $.clock.now()
    }
    return result
  })
}

async function save($: EngineInterface, state: KeepaliveState): Promise<void> {
  try {
    const [home, id] = await Promise.all([$.env.get('HOME'), $.session.id()])
    if (home) await $.fs.write(`${home}/.cache/claude-statusline/${id}.keepalive.json`, JSON.stringify(state))
  } catch {
    // The status line just shows no keep-alive state.
  }
}
