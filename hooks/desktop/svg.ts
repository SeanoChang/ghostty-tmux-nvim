import type { NodeStatus } from '../../types'
import { PIX, PIX_PAL } from './sprites'

// Every picture the desktop view draws, as SVG source strings. An Svg element is
// drawn as an image, where currentColor means nothing, so every colour is written
// out from the desk tokens. Sizes are CSS pixels.

// The desktop can not tell its light or dark mode to a plugin, so these tokens are
// mid-tone hues that read on both; text and grounds stay the surface's own.
export type DeskTokens = {
  name: 'kitty' | 'minimal'
  accent: string
  ok: string
  warn: string
  bad: string
  stop: string
  muted: string
  rule: string
  add: string
  del: string
  lanes: string[]
}

export const DESK: Record<'kitty' | 'minimal', DeskTokens> = {
  minimal: {
    name: 'minimal', accent: '#3b82f6', ok: '#16a34a', warn: '#d97706', bad: '#dc2626', stop: '#6b7280',
    muted: '#6b7280', rule: '#9ca3af', add: '#16a34a', del: '#dc2626',
    lanes: ['#3b82f6', '#8b5cf6', '#0891b2', '#0d9488', '#ea580c', '#64748b'],
  },
  kitty: {
    name: 'kitty', accent: '#e8735a', ok: '#4d9e5c', warn: '#d9893b', bad: '#d9566e', stop: '#9b7f86',
    muted: '#9b7f86', rule: '#d8b8a8', add: '#4d9e5c', del: '#d9566e',
    lanes: ['#e8735a', '#a874c4', '#3aa6c4', '#3ea58f', '#d9893b', '#9b7f86'],
  },
}

export const statusColor = (t: DeskTokens, s: NodeStatus) =>
  s === 'running' ? t.warn : s === 'done' ? t.ok : s === 'failed' ? t.bad : t.stop

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// ── pixel sprites ────────────────────────────────────────────────────────────
// One rect per run of same-coloured pixels in a row, so a 16×16 sprite stays a
// few hundred characters and the 64×40 scene stays far under the 131072 cap.
function spriteRects(grid: readonly string[], dx = 0): string {
  let out = ''
  grid.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const ch = row[x]!
      if (ch === '.') { x++; continue }
      let end = x + 1
      while (end < row.length && row[end] === ch) end++
      out += `<rect x="${x + dx}" y="${y}" width="${end - x}" height="1" fill="${PIX_PAL[ch]}"/>`
      x = end
    }
  })
  return out
}

export const SPRITE_FOR: Record<NodeStatus, string> = { running: 'walk0', done: 'done', failed: 'failed', killed: 'stopped' }

export function spriteSvg(name: string, px: number): string {
  const grid = PIX[name] ?? PIX.done!
  const w = grid[0]!.length
  const h = grid.length
  const scale = px / Math.max(w, h)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w * scale)}" height="${Math.round(h * scale)}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${spriteRects(grid)}</svg>`
}

// The running header sprite walks: four frames, each shown for a quarter of the
// cycle by SMIL. It needs an interactive Svg, which the desktop draws in a frame.
export function walkSvg(px: number): string {
  const frames = ['walk0', 'walk1', 'walk2', 'walk3']
  const layers = frames.map((f, i) =>
    `<g visibility="hidden">${spriteRects(PIX[f]!)}<animate attributeName="visibility" values="${frames.map((_, j) => (j === i ? 'visible' : 'hidden')).join(';')}" dur="0.6s" calcMode="discrete" repeatCount="indefinite"/></g>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 16 16" shape-rendering="crispEdges">${layers.join('')}</svg>`
}

// ── minimal: one line-icon set, 16 px grid ───────────────────────────────────
const ICON: Record<string, string> = {
  workflow: '<circle cx="3.75" cy="4.25" r="1.75"/><circle cx="12.25" cy="4.25" r="1.75"/><circle cx="8" cy="11.75" r="1.75"/><path d="M4.8 5.7 7.1 10.2M11.2 5.7 8.9 10.2"/>',
  group: '<rect x="2.5" y="5.5" width="8" height="8" rx="2"/><path d="M5.5 3h5.5a2 2 0 0 1 2 2v5.5"/>',
  agent: '<circle cx="8" cy="8" r="5.25"/><circle cx="8" cy="8" r="1.6" fill="COLOR" stroke="none"/>',
  running: '<circle cx="8" cy="8" r="5.75" opacity=".25"/><path d="M8 2.25a5.75 5.75 0 0 1 5.75 5.75"/>',
  done: '<circle cx="8" cy="8" r="6"/><path d="m5.3 8.2 1.85 1.85L10.8 6.2"/>',
  failed: '<circle cx="8" cy="8" r="6"/><path d="m5.9 5.9 4.2 4.2m0-4.2-4.2 4.2"/>',
  killed: '<circle cx="8" cy="8" r="6"/><rect x="6" y="6" width="4" height="4" rx="1" fill="COLOR" stroke="none"/>',
  quiet: '<circle cx="8" cy="8" r="6"/><path d="M6 6.5h4l-4 3.5h4"/>',
  worktree: '<circle cx="4.5" cy="3.5" r="1.5"/><circle cx="4.5" cy="12.5" r="1.5"/><circle cx="11.5" cy="5" r="1.5"/><path d="M4.5 5v6M11.5 6.5c0 3-7 1.8-7 4.5"/>',
  file: '<path d="M4 2.25h5l3 3v8.5H4Z"/><path d="M9 2.25v3h3"/>',
  warn: '<path d="M8 2.5 14 13H2Z"/><path d="M8 6.5v3M8 11.2v.1"/>',
  empty: '<circle cx="8" cy="8" r="6" stroke-dasharray="2 2"/>',
}

export function iconSvg(name: string, color: string, px = 16): string {
  const body = (ICON[name] ?? ICON.agent!).replace(/COLOR/g, color)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 16 16" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
}

// ── small charts ─────────────────────────────────────────────────────────────

// A bar split by status: done, running, failed, stopped, then the empty track.
export function statusBarSvg(t: DeskTokens, c: { done: number; running: number; failed: number; stopped: number; total: number }, w = 96, h = 6): string {
  const total = Math.max(1, c.total)
  const parts: [number, string][] = [[c.done, t.ok], [c.running, t.warn], [c.failed, t.bad], [c.stopped, t.stop]]
  let x = 0
  let rects = `<rect x="0" y="0" width="${w}" height="${h}" rx="${h / 2}" fill="${t.rule}" opacity=".35"/>`
  for (const [n, color] of parts) {
    if (!n) continue
    const pw = (n / total) * w
    rects += `<rect x="${x.toFixed(1)}" y="0" width="${pw.toFixed(1)}" height="${h}" fill="${color}"/>`
    x += pw
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><clipPath id="c"><rect width="${w}" height="${h}" rx="${h / 2}"/></clipPath><g clip-path="url(#c)">${rects}</g></svg>`
}

// Lines added and removed as two proportional bars, the larger side scaled to `w`.
export function diffBarSvg(t: DeskTokens, added: number, removed: number, max: number, w = 60, h = 6): string {
  const m = Math.max(1, max)
  const a = Math.max(added ? 2 : 0, Math.round((added / m) * w))
  const r = Math.max(removed ? 2 : 0, Math.round((removed / m) * w))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect x="0" y="0" width="${a}" height="${h}" rx="1" fill="${t.add}"/><rect x="${a + (a && r ? 1 : 0)}" y="0" width="${Math.min(r, w - a)}" height="${h}" rx="1" fill="${t.del}"/></svg>`
}

// Runs per day: bars from a data-derived scale, its extremes labelled.
export function sparkSvg(t: DeskTokens, perDay: number[], w = 140, h = 34): string {
  const max = Math.max(1, ...perDay)
  const n = perDay.length || 1
  const bw = (w - (n - 1) * 3) / n
  const chartH = h - 12
  const bars = perDay.map((v, i) => {
    const bh = v ? Math.max(2, (v / max) * chartH) : 1
    const isToday = i === n - 1
    return `<rect x="${(i * (bw + 3)).toFixed(1)}" y="${(chartH - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5" fill="${isToday ? t.accent : t.rule}"/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${bars}<text x="0" y="${h - 1}" font-size="9" font-family="-apple-system, sans-serif" fill="${t.muted}">7 days ago</text><text x="${w}" y="${h - 1}" font-size="9" font-family="-apple-system, sans-serif" fill="${t.muted}" text-anchor="end">today · max ${max}</text></svg>`
}

// ── the timeline: one bar per agent on a shared ruler ────────────────────────
export type TimeBar = { label: string; start: number; end: number; status: NodeStatus; isHeader?: boolean; isSelected?: boolean; isCritical?: boolean }

// `idle`: stretches when no agent ran, shaded across every row.
export type TimelineOpts = { idle?: { from: number; to: number }[] }

export function timelineSvg(t: DeskTokens, bars: TimeBar[], from: number, to: number, w: number, opts: TimelineOpts = {}): string {
  const LABEL = Math.min(200, Math.round(w * 0.28))
  const plot = Math.max(80, w - LABEL - 16)
  const span = Math.max(1, to - from)
  const rowH = 22
  const h = 26 + bars.length * rowH
  const x = (at: number) => LABEL + ((at - from) / span) * plot
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const tx = LABEL + f * plot
    return `<line x1="${tx}" y1="18" x2="${tx}" y2="${h}" stroke="${t.rule}" stroke-opacity=".35"/><text x="${tx}" y="12" font-size="9" fill="${t.muted}" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}" font-family="-apple-system, sans-serif">${esc(clockOff(span * f))}</text>`
  }).join('')
  const idle = (opts.idle ?? []).map(g => {
    const x0 = x(Math.max(from, g.from))
    const x1 = x(Math.min(to, g.to))
    return x1 - x0 < 1 ? '' : `<rect x="${x0.toFixed(1)}" y="18" width="${(x1 - x0).toFixed(1)}" height="${h - 18}" fill="${t.rule}" opacity=".18"><title>idle ${esc(clockOff(g.to - g.from).slice(1))}</title></rect>`
  }).join('')
  const rows = bars.map((b, i) => {
    const y = 26 + i * rowH
    if (b.isHeader) return `<text x="0" y="${y + 13}" font-size="10" font-weight="600" fill="${t.muted}" font-family="-apple-system, sans-serif">${esc(clip(b.label, 34).toUpperCase())}</text>`
    const x0 = x(b.start)
    const x1 = Math.max(x0 + 3, x(b.end))
    const color = statusColor(t, b.status)
    const sel = b.isSelected ? `<rect x="0" y="${y - 2}" width="${w}" height="${rowH - 2}" fill="${t.accent}" opacity=".12" rx="4"/>` : ''
    const live = b.status === 'running' ? `<rect x="${x1 - 6}" y="${y + 3}" width="6" height="10" fill="${color}" opacity=".5"/>` : ''
    // the critical path: an accent outline, and the label in bold
    const crit = b.isCritical ? ` stroke="${t.accent}" stroke-width="2"` : ''
    const weight = b.isCritical ? ' font-weight="600"' : ''
    return `${sel}<text x="0" y="${y + 12}" font-size="11" fill="${t.muted}"${weight} font-family="-apple-system, sans-serif">${esc(clip(b.label, 30))}</text><rect x="${x0.toFixed(1)}" y="${y + 3}" width="${(x1 - x0).toFixed(1)}" height="10" rx="3" fill="${color}" opacity="${b.status === 'running' ? 0.75 : 0.9}"${crit}/>${live}`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${idle}${ticks}${rows}</svg>`
}

// ── the trace: lanes on a shared time axis, arrows between them ──────────────
export type TraceMark = { lane: number; to?: number; at: number; kind: string; text: string; isSelected?: boolean }

// `focus`: the lane of the agent picked elsewhere; the other lanes draw faint.
export function traceSvg(t: DeskTokens, lanes: { label: string; chip: string; status: NodeStatus }[], marks: TraceMark[], from: number, to: number, w: number, focus?: number): string {
  const LABEL = Math.min(170, Math.round(w * 0.24))
  const plot = Math.max(80, w - LABEL - 20)
  const span = Math.max(1, to - from)
  const laneH = 34
  const h = 24 + lanes.length * laneH + 8
  const x = (at: number) => LABEL + ((at - from) / span) * plot
  const yOf = (lane: number) => 24 + lane * laneH + laneH / 2
  const color = (lane: number) => t.lanes[lane % t.lanes.length]!
  const ruler = [0, 0.5, 1].map(f => `<text x="${LABEL + f * plot}" y="12" font-size="9" fill="${t.muted}" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}" font-family="-apple-system, sans-serif">${esc(clockOff(span * f))}</text>`).join('')
  const faint = (lane: number) => (focus !== undefined && focus >= 0 && lane !== focus ? ' opacity=".3"' : '')
  const laneRows = lanes.map((l, i) => {
    const y = yOf(i)
    return `<g${faint(i)}><circle cx="8" cy="${y}" r="4" fill="${statusColor(t, l.status)}"/><text x="18" y="${y + 4}" font-size="11" fill="${t.muted}" font-family="-apple-system, sans-serif">${esc(clip(l.label, 22))}</text><line x1="${LABEL}" y1="${y}" x2="${LABEL + plot}" y2="${y}" stroke="${color(i)}" stroke-opacity=".35" stroke-width="2"/></g>`
  }).join('')
  const arrows = marks.filter(m => m.to !== undefined && m.to !== m.lane).map(m => {
    const x0 = x(m.at)
    const y0 = yOf(m.lane)
    const y1 = yOf(m.to!)
    const dash = m.kind === 'message' ? ' stroke-dasharray="4 3"' : m.kind === 'handback' ? ' stroke-dasharray="1.5 3"' : ''
    return `<path d="M${x0.toFixed(1)} ${y0} L${x0.toFixed(1)} ${y1 + (y1 > y0 ? -5 : 5)}" stroke="${color(m.lane)}" stroke-width="1.5"${dash}/><path d="M${(x0 - 4).toFixed(1)} ${y1 + (y1 > y0 ? -8 : 8)} L${x0.toFixed(1)} ${y1 + (y1 > y0 ? -2 : 2)} L${(x0 + 4).toFixed(1)} ${y1 + (y1 > y0 ? -8 : 8)}" fill="none" stroke="${color(m.lane)}" stroke-width="1.5"/>`
  }).join('')
  const dots = marks.map(m => {
    const cx = x(m.at)
    const cy = yOf(m.lane)
    const c = m.kind === 'fail' ? t.bad : color(m.lane)
    const ring = m.isSelected ? `<circle cx="${cx.toFixed(1)}" cy="${cy}" r="7" fill="none" stroke="${t.accent}" stroke-width="2"/>` : ''
    const shape = m.kind === 'edit'
      ? `<rect x="${(cx - 4).toFixed(1)}" y="${cy - 4}" width="8" height="8" transform="rotate(45 ${cx.toFixed(1)} ${cy})" fill="${c}"/>`
      : m.kind === 'fail'
        ? `<path d="M${(cx - 4).toFixed(1)} ${cy - 4}l8 8m0-8-8 8" stroke="${c}" stroke-width="2"/>`
        : m.kind === 'quiet'
          ? `<rect x="${(cx - 6).toFixed(1)}" y="${cy - 3}" width="12" height="6" fill="${t.rule}" opacity=".6"/>`
          : `<circle cx="${cx.toFixed(1)}" cy="${cy}" r="3.5" fill="${c}"/>`
    return `<g${faint(m.lane)}>${ring}${shape}<title>${esc(m.text)}</title></g>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${ruler}${laneRows}${arrows}${dots}</svg>`
}

// ── a picture to save: a white page with a title, a subtitle and a legend over the drawing ──
// `inner` is a whole <svg> of `innerH` rows; it is placed as a nested svg, so its own
// coordinates stay as they are.
export function pictureSvg(t: DeskTokens, title: string, subtitle: string, legend: string[], inner: string, w: number, innerH: number): string {
  const PAD = 24
  const head = 64
  const foot = legend.length ? 28 : 8
  const h = head + innerH + foot + PAD
  const font = 'font-family="-apple-system, Helvetica, Arial, sans-serif"'
  // legend items one after another, spaced by their own length (about 5.6 px a character at 11 px)
  let lx = PAD
  const keys = legend.map(k => {
    const el = `<text x="${lx}" y="${head + innerH + 22}" font-size="11" fill="${t.muted}" ${font}>${esc(k)}</text>`
    lx += Math.round(k.length * 5.6) + 28
    return el
  }).join('')
  const body = inner.replace(/^<svg /, `<svg x="${PAD}" y="${head}" `)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w + PAD * 2}" height="${h}" viewBox="0 0 ${w + PAD * 2} ${h}">`
    + `<rect width="100%" height="100%" fill="#ffffff"/>`
    + `<text x="${PAD}" y="${PAD + 12}" font-size="17" font-weight="600" fill="#111827" ${font}>${esc(clip(title, 90))}</text>`
    + `<text x="${PAD}" y="${PAD + 32}" font-size="12" fill="${t.muted}" ${font}>${esc(clip(subtitle, 140))}</text>`
    + `${body}${keys}</svg>`
}

// ── helpers ──────────────────────────────────────────────────────────────────
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function clockOff(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `+${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `+${m}m${s % 60 ? ` ${String(s % 60).padStart(2, '0')}s` : ''}`
  return `+${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}
