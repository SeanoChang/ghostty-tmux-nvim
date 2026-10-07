// Context feed: after each main-loop turn, writes the context window's
// breakdown (as /context counts it, estimated locally, so no request is sent)
// to ~/.cache/claude-statusline/<session id>.json. The status line script
// reads it by the session_id in its own input and draws lines 3 and 4.

import type { EngineInterface, Register } from 'claude-code'

export type FeedCategory = { name: string; tokens: number }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await writeFeed($)
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) await writeFeed($)
    return result
  })
}

async function writeFeed($: EngineInterface): Promise<void> {
  try {
    const [home, id, usage] = await Promise.all([
      $.env.get('HOME'),
      $.session.id(),
      $.session.usage({ breakdown: 'summary' }),
    ])
    const rows = usage.context.breakdown?.categories
    if (!home || !rows) return
    const used = rows.filter(r => r.kind === 'used').map(r => ({ name: r.name, tokens: r.tokens }))
    // `labels` keeps /context's own rows, so a label the mapping misses shows up as `other`.
    const feed = { updatedAt: new Date(await $.clock.now()).toISOString(), categories: group(used), labels: used }
    await $.fs.write(`${home}/.cache/claude-statusline/${id}.json`, JSON.stringify(feed))
  } catch {
    // No feed this turn; the script keeps drawing the last one.
  }
}

// /context labels ("System prompt", "MCP tools", ...) to the script's keys,
// summed per key, in a fixed order so the bar's colors stay put.
const ORDER = ['system', 'tools', 'mcp', 'agents', 'memory', 'skills', 'other', 'messages']

export function keyFor(label: string): string {
  const l = label.toLowerCase()
  if (l.includes('mcp')) return 'mcp'
  if (l.includes('system prompt')) return 'system'
  if (l.includes('tool')) return 'tools'
  if (l.includes('agent')) return 'agents'
  if (l.includes('memory')) return 'memory'
  if (l.includes('skill')) return 'skills'
  if (l.includes('message')) return 'messages'
  return 'other'
}

export function group(rows: readonly FeedCategory[]): FeedCategory[] {
  const sums = new Map<string, number>()
  for (const row of rows) {
    if (row.tokens <= 0) continue
    const key = keyFor(row.name)
    sums.set(key, (sums.get(key) ?? 0) + row.tokens)
  }
  return ORDER.filter(k => sums.has(k)).map(k => ({ name: k, tokens: Math.round(sums.get(k)!) }))
}
