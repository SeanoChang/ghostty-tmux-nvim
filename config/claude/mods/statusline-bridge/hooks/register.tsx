// Status line for the desktop app: a compact native band above the prompt.
//
// One row of chips: the git branch (in a repo), context, the 5h and 7d limits,
// and the prompt cache, each with a thin line. No folder or model: the app
// already shows the model under the prompt. The context line spans the
// whole window, its used part colored by category. Hovering the band reveals
// the used context as its own line with a color legend, and the cache detail.
//
// It reads the same sources as the terminal script: $.session for usage and
// limits, the context-feed file for the parts, the cache-keepalive file for
// refreshes. The mod API has no prompt_cache block, so the cache view is built
// from each main turn's usage: expiry is the last turn's end plus the 1h TTL.
//
// The terminal keeps its own status line, so the band is drawn only on the
// app surfaces, and it draws whatever the hooks beneath drew after its own rows.

import { atom, read, update } from 'claude-code'
import type { ElementTable, EngineInterface, Register, RenderChildren } from 'claude-code'

import type { CacheView, Limit, Part, Snapshot } from '../types'

const snapshot = atom({ plugin: 'statusline-bridge', key: 'snapshot' } as const, null)

const REFRESH_MS = 30_000
const TTL_S = 3600

// Cache bookkeeping for this load of the module; a reload starts it over.
const cache = { lastEndS: 0, submitS: 0, reads: 0, input: 0, misses: 0 }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    $.clock.every(REFRESH_MS, () => void refresh($))
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    cache.submitS = Math.floor((await $.clock.now()) / 1000)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    const u = e.usage ?? result.usage
    if (u) {
      cache.reads += u.cache_read_input_tokens
      cache.input += u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      const wasCold = cache.lastEndS > 0 && cache.submitS - cache.lastEndS > TTL_S
      if (wasCold && u.cache_creation_input_tokens > u.cache_read_input_tokens) cache.misses += 1
    }
    cache.lastEndS = Math.floor((await $.clock.now()) / 1000)
    await refresh($)
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.surface === 'terminal' || e.props.hasSurvey) return next(e)
    const snap = await read($, snapshot)
    if (snap === null) return next(e)
    const below = await next(e)
    const { Box, Text, Svg } = $.ui.resolve(e)
    const kit: Kit = { Box, Text, Svg }
    const sep = <Text color={C.dim}>│</Text>

    // The band is one hover scope: the pointer anywhere over it reveals the
    // detail rows beneath the chips, and the band grows to hold them.
    return (
      <Box key="band" flexDirection="column" paddingX={1}>
        <Box flexDirection="row" alignItems="center" gap={1} flexWrap="wrap">
          {snap.branch ? <Text color={C.magenta}>{`⎇ ${snap.branch}${snap.isDirty ? '*' : ''}`}</Text> : null}
          {snap.branch ? sep : null}
          <Text color={C.muted}>ctx</Text>
          <Svg
            source={windowLine(snap.parts, snap.contextTokens, snap.contextWindow)}
            alt={`context ${snap.contextPercent}% of ${short(snap.contextWindow)}`}
            width={WINDOW_W}
            height={H}
          />
          <Text color={levelColor(snap.contextPercent, C.text)}>{`${snap.contextPercent}%`}</Text>
          <Text color={C.muted}>{`${short(snap.contextTokens)}/${short(snap.contextWindow)}`}</Text>
          {limitChip('5h', snap.five, kit, sep)}
          {limitChip('7d', snap.seven, kit, sep)}
          {snap.cache && sep}
          {snap.cache && cacheChip(snap.cache, kit)}
        </Box>
        <Box display="none" hover={{ display: 'flex' }} flexDirection="column" paddingTop={1} gap={1}>
          {snap.parts.length > 0 && contextDetail(snap.parts, kit)}
          {snap.cache && cacheDetail(snap.cache, snap.costUsd, kit)}
        </Box>
        {below}
      </Box>
    )
  })
}

// The app surfaces' elements these helpers draw with.
type Kit = Pick<ElementTable<'desktop'>, 'Box' | 'Text' | 'Svg'>

// ── data ─────────────────────────────────────────────────────────────────────

async function refresh($: EngineInterface): Promise<void> {
  try {
    const [usage, model, cwd, id, home, repo] = await Promise.all([
      $.session.usage(),
      $.session.model(),
      $.session.cwd(),
      $.session.id(),
      $.env.get('HOME'),
      $.session.repo(),
    ])
    const nowS = Math.floor((await $.clock.now()) / 1000)
    const git = repo ? await gitStatus($, cwd) : { branch: '', isDirty: false }
    const feedDir = home ? `${home}/.cache/claude-statusline` : null
    const feed = feedDir ? await readJson($, `${feedDir}/${id}.json`) : null
    const kept = feedDir ? await readJson($, `${feedDir}/${id}.keepalive.json`) : null

    const limit = (kind: string): Limit | null => {
      const found = usage.rateLimits.find(r => r.kind === kind)
      return found ? { percent: Math.round(found.percentUsed), resetsIn: until(found.resetsAt, nowS) } : null
    }
    const tokens = usage.context.tokens ?? 0
    const snap: Snapshot = {
      branch: git.branch,
      isDirty: git.isDirty,
      contextPercent: usage.context.percent ?? 0,
      contextTokens: tokens,
      contextWindow: usage.context.window,
      five: limit('five_hour'),
      seven: limit('seven_day'),
      costUsd: usage.cost?.usd ?? null,
      parts: partsOf(feed),
      cache: cacheView(nowS, tokens, model, kept),
    }
    await update($, snapshot, () => snap)
  } catch {
    // Keep the last snapshot; the next turn or tick tries again.
  }
}

async function readJson($: EngineInterface, path: string): Promise<unknown> {
  try {
    return JSON.parse(await $.fs.read(path))
  } catch {
    return null
  }
}

async function gitStatus($: EngineInterface, cwd: string): Promise<{ branch: string; isDirty: boolean }> {
  const { exitCode, stdout } = await $.process.run(
    ['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch', '-uno'],
    { cwd, timeoutMs: 5_000 },
  )
  if (exitCode !== 0) return { branch: '', isDirty: false }
  let head = ''
  let oid = ''
  let isDirty = false
  for (const line of stdout.split('\n')) {
    if (line.startsWith('# branch.head ')) head = line.slice(14)
    else if (line.startsWith('# branch.oid ')) oid = line.slice(13, 20)
    else if (/^[12u] /.test(line)) isDirty = true
  }
  return { branch: head === '(detached)' ? oid : head, isDirty }
}

export function partsOf(feed: unknown): Part[] {
  const rows = (feed as { categories?: unknown } | null)?.categories
  if (!Array.isArray(rows)) return []
  return rows.filter(
    (r): r is Part => typeof r?.name === 'string' && typeof r?.tokens === 'number' && r.tokens > 0,
  )
}

// 1h-write price per MTok (2x base input), for the rebuild estimate.
function writePrice(model: string): number {
  const m = model.toLowerCase()
  if (m.includes('fable')) return 20
  if (m.includes('opus-5-5') || m.includes('opus 5.5')) return 8
  if (m.includes('opus')) return 10
  if (m.includes('sonnet')) return 4
  if (m.includes('haiku')) return 2
  return 8
}

export function cacheView(nowS: number, tokens: number, model: string, kept: unknown): CacheView | null {
  if (cache.lastEndS === 0) return null
  let expiresS = cache.lastEndS + TTL_S
  const k = kept as { refreshes?: number; max?: number; lastAt?: number | null } | null
  // A keep-alive read the cache after the last turn: the TTL restarts there.
  if (k?.lastAt && k.lastAt + TTL_S > expiresS) expiresS = k.lastAt + TTL_S
  const leftS = Math.max(0, expiresS - nowS)
  return {
    isWarm: leftS > 0,
    leftS,
    hitPercent: cache.input > 0 ? Math.round((cache.reads / cache.input) * 100) : null,
    misses: cache.misses,
    rebuildTokens: tokens,
    rebuildUsd: (tokens * writePrice(model)) / 1e6,
    keepalive: k && (k.refreshes ?? 0) > 0 ? { used: k.refreshes ?? 0, max: k.max ?? 3 } : null,
  }
}


export function displayName(id: string): string {
  const m = /(haiku|sonnet|opus|fable)[- ]?(\d+)(?:[-.](\d+))?/i.exec(id)
  if (!m) return id
  const name = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1).toLowerCase()
  return m[3] ? `${name} ${m[2]}.${m[3]}` : `${name} ${m[2]}`
}

export function until(iso: string | undefined, nowS: number): string {
  if (!iso) return ''
  return duration(Math.floor(Date.parse(iso) / 1000) - nowS)
}

function duration(s: number): string {
  if (!(s > 0)) return 'now'
  if (s <= 3600) return `${Math.ceil(s / 60)}m`
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  if (d > 0) return `${d}d${h}h`
  if (h > 0) return `${h}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
  return `${Math.ceil(s / 60)}m`
}

// A share as a whole percent; a part that is there but under 1% reads <1%.
export function share(part: number, total: number): string {
  const pct = (part / total) * 100
  return part > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`
}

export function short(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1_000)}k`
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`
  return String(n)
}

// ── drawing ──────────────────────────────────────────────────────────────────

// TokyoNight Moon, the terminal script's palette.
const C = {
  blue: '#82aaff',
  cyan: '#86e1fc',
  magenta: '#c099ff',
  teal: '#4fd6be',
  yellow: '#ffc777',
  green: '#c3e88d',
  orange: '#ff966c',
  red: '#ff757f',
  text: '#c8d3f5',
  muted: '#828bb8',
  dim: '#444a73',
  track: '#2f334d',
}

const PART: Record<string, { label: string; color: string }> = {
  system: { label: 'system', color: C.blue },
  tools: { label: 'tools', color: C.cyan },
  mcp: { label: 'mcp', color: C.magenta },
  agents: { label: 'agents', color: C.teal },
  memory: { label: 'memory', color: C.yellow },
  skills: { label: 'skills', color: C.green },
  other: { label: 'other', color: C.muted },
  messages: { label: 'chat', color: C.orange },
}

function levelColor(percent: number, base: string): string {
  return percent >= 80 ? C.red : base
}



function svg(w: number, h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Thin rounded lines: a faint track, then colored runs over it. They are drawn
// as plain images at their exact size: the interactive frame paints a white
// 300x150 box around each one in the app. Each run keeps a <title> for readers.
const H = 10
const Y = H / 2
const STROKE = 3
const WINDOW_W = 150
const USED_W = 260
const METER_W = 44

function track(w: number): string {
  return `<line x1="${STROKE / 2}" y1="${Y}" x2="${w - STROKE / 2}" y2="${Y}" stroke="${C.track}" stroke-width="${STROKE}" stroke-linecap="round"/>`
}

function seg(x1: number, x2: number, color: string, tip: string): string {
  return (
    `<line class="seg" x1="${x1.toFixed(1)}" y1="${Y}" x2="${x2.toFixed(1)}" y2="${Y}" stroke="${color}" ` +
    `stroke-width="${STROKE}" stroke-linecap="round"><title>${esc(tip)}</title></line>`
  )
}

// Runs laid end to end over `w`, each at least 2px so a small part stays visible.
function runs(parts: readonly { tokens: number; color: string; tip: string }[], scale: number, w: number): string {
  let x = STROKE / 2
  let out = ''
  for (const p of parts) {
    const len = Math.max(2, p.tokens * scale)
    const end = Math.min(w - STROKE / 2, x + len)
    if (end > x) out += seg(x, end, p.color, p.tip)
    x = end + 1
  }
  return out
}

function partTip(p: Part, total: number, of: string): string {
  const meta = PART[p.name] ?? PART.other!
  return `${meta.label}: ${short(p.tokens)} (${share(p.tokens, total)} of ${of})`
}

// The whole window: used parts in their colors, free space as the track.
export function windowLine(parts: readonly Part[], used: number, window: number, w = WINDOW_W): string {
  if (window <= 0) return svg(w, H, track(w))
  const inner = w - STROKE
  const list = parts.length > 0 ? parts : [{ name: 'other', tokens: used }]
  const body = runs(
    list.map(p => ({ tokens: p.tokens, color: (PART[p.name] ?? PART.other!).color, tip: partTip(p, window, 'window') })),
    inner / window,
    w,
  )
  return svg(w, H, track(w) + body)
}

// The used tokens alone, so the small parts get room.
export function usedLine(parts: readonly Part[], w = USED_W): string {
  const total = parts.reduce((sum, p) => sum + p.tokens, 0)
  if (total === 0) return svg(w, H, track(w))
  const gaps = parts.length - 1
  const body = runs(
    parts.map(p => ({ tokens: p.tokens, color: (PART[p.name] ?? PART.other!).color, tip: partTip(p, total, 'used') })),
    (w - STROKE - gaps) / total,
    w,
  )
  return svg(w, H, track(w) + body)
}

// One value against its maximum, as a line. `isLevel` turns it red from 80%,
// for usage; the cache's time left is good when full, so it passes false.
export function meter(percent: number, color: string, w = METER_W, tip = '', isLevel = true): string {
  const p = Math.max(0, Math.min(100, percent))
  const end = STROKE / 2 + ((w - STROKE) * p) / 100
  const fill = p > 0 ? seg(STROKE / 2, Math.max(end, STROKE / 2 + 1), isLevel ? levelColor(percent, color) : color, tip || `${Math.round(p)}%`) : ''
  return svg(w, H, track(w) + fill)
}

function limitChip(label: string, limit: Limit | null, { Text, Svg }: Kit, sep: RenderChildren) {
  if (!limit) return null
  const tip = `${label} limit: ${limit.percent}% used${limit.resetsIn ? `, resets in ${limit.resetsIn}` : ''}`
  return [
    sep,
    <Text color={C.muted}>{label}</Text>,
    <Svg source={meter(limit.percent, C.cyan, METER_W, tip)} alt={tip} width={METER_W} height={H} />,
    <Text color={levelColor(limit.percent, C.text)}>{`${limit.percent}%`}</Text>,
  ]
}

function cacheState(c: CacheView): { glyph: string; word: string; color: string } {
  if (!c.isWarm) return { glyph: '❄', word: 'cold', color: C.cyan }
  if (c.leftS <= 300) return { glyph: '●', word: 'expiring', color: C.red }
  if (c.leftS <= 1200) return { glyph: '◐', word: 'cooling', color: C.yellow }
  return { glyph: '●', word: 'warm', color: C.green }
}

function cacheChip(c: CacheView, { Text, Svg }: Kit) {
  const s = cacheState(c)
  const left = c.isWarm ? `${duration(c.leftS)} left` : 'cold'
  return [
    <Text color={s.color}>{`${s.glyph} cache`}</Text>,
    <Svg source={meter((c.leftS / TTL_S) * 100, s.color, METER_W, `cache ${left} of 1h`, false)} alt={`cache ${left}`} width={METER_W} height={H} />,
    <Text color={C.muted}>{c.isWarm ? duration(c.leftS) : 'cold'}</Text>,
    c.keepalive ? <Text color={C.teal}>{`♻ ${c.keepalive.used}/${c.keepalive.max}`}</Text> : null,
  ]
}

function contextDetail(parts: readonly Part[], { Box, Text, Svg }: Kit) {
  const total = parts.reduce((sum, p) => sum + p.tokens, 0)
  const fixed = parts.filter(p => p.name !== 'messages').reduce((sum, p) => sum + p.tokens, 0)
  const ordered = [...parts].sort((a, b) => b.tokens - a.tokens)
  return (
    <Box key="context" flexDirection="column">
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Text color={C.muted}>{`used ${short(total)}`}</Text>
        <Svg source={usedLine(parts)} alt="used context by part" width={USED_W} height={H} />
        <Text color={C.muted}>{`fixed ${short(fixed)} · chat ${short(total - fixed)}`}</Text>
      </Box>
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">
        {ordered.map(p => {
          const meta = PART[p.name] ?? PART.other!
          return (
            <Box key={`part-${p.name}`} flexDirection="row" gap={1}>
              <Text color={meta.color}>{`● ${meta.label}`}</Text>
              <Text>{share(p.tokens, total)}</Text>
              <Text color={C.muted}>{short(p.tokens)}</Text>
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

function cacheDetail(c: CacheView, costUsd: number | null, { Box, Text }: Kit) {
  const s = cacheState(c)
  const facts = [
    c.isWarm ? `${s.word}, ${duration(c.leftS)} left of 1h` : 'cold',
    `${c.isWarm ? 'rebuild if cold' : 'next turn rebuilds'} ${short(c.rebuildTokens)} ≈$${c.rebuildUsd.toFixed(2)}`,
    c.hitPercent !== null ? `hit ${c.hitPercent}%` : null,
    `${c.misses} miss`,
    c.keepalive ? `keep-alive ${c.keepalive.used}/${c.keepalive.max}` : null,
    costUsd !== null ? `session $${costUsd.toFixed(2)}` : null,
  ].filter((f): f is string => f !== null)
  return (
    <Box key="cache" flexDirection="row" gap={1} flexWrap="wrap">
      <Text color={s.color}>{`${s.glyph} cache`}</Text>
      <Text color={C.muted}>{facts.join('  ·  ')}</Text>
    </Box>
  )
}
