// SVG drawings for the brief pane: flows, state machines, sequences and HTML mockups.
// Layout comes from html-plan's core.js; the drawing and palette are ours (Apple light/dark).

import { esc } from './core.js'
import type { FlowLayout, FlowModel, MachineLayout, MachineModel, Mark, SeqModel } from './core.js'
import type { BriefPin } from '../types'

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif'
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace'

const STYLE = `<style>
.t{fill:#1d1d1f;font:500 13px ${FONT}}
.s{fill:#6e6e73;font:11px ${FONT}}
.m{font:12px ${MONO};fill:#515154}
.n{fill:#ffffff;stroke:#c7c7cc;stroke-width:1.3}
.g{fill:none;stroke:#d2d2d7;stroke-dasharray:4 4}
.e{fill:none;stroke:#8e8e93;stroke-width:1.4}
.lb{fill:#ffffff}
.ll{fill:#515154;font:11px ${FONT}}
.life{stroke:#d2d2d7;stroke-dasharray:3 4}
.note{fill:#fff8e1;stroke:#e9c46a}
.new .n,.n.new{stroke:#00a63a;stroke-dasharray:5 3}
.e.new{stroke:#00a63a;stroke-dasharray:6 4}
.gone .n,.n.gone{stroke:#d70015;stroke-dasharray:3 3;opacity:.6}
.e.gone{stroke:#d70015;stroke-dasharray:3 3;opacity:.7}
.mod .n,.n.mod{stroke:#d77c00}
.e.mod{stroke:#d77c00}
.n.on{fill:#e8f1fd;stroke:#0071e3;stroke-width:2}
.e.on{stroke:#0071e3;stroke-width:2}
.ll.on{fill:#0071e3}
.e.dash{stroke-dasharray:6 4}
.e.bold{stroke-width:2.4}
.ar{fill:#8e8e93}.arA{fill:#0071e3}.arG{fill:#00a63a}.arR{fill:#d70015}
@media (prefers-color-scheme: dark){
.t{fill:#f5f5f7}.s,.ll{fill:#aeaeb2}.m{fill:#c7c7cc}
.n{fill:#1d1d1f;stroke:#48484a}.lb{fill:#000000}.g,.life{stroke:#3a3a3c}
.note{fill:#2c2410;stroke:#7a6420}
.n.on{fill:#10243b;stroke:#2997ff}.e.on{stroke:#2997ff}.ll.on{fill:#2997ff}.arA{fill:#2997ff}
}
</style>`

const DEFS = `<defs>${(['ar', 'arA', 'arG', 'arR'] as const)
  .map(id => `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="${id}" d="M0,0 L10,5 L0,10 z"/></marker>`)
  .join('')}</defs>`

const svgOpen = (w: number, h: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(w)} ${Math.ceil(h)}" width="${Math.ceil(w)}" height="${Math.ceil(h)}">${STYLE}${DEFS}`

const markClass = (mark: Mark) => (mark === 'new' || mark === 'gone' || mark === 'mod' ? mark : '')
const arrowFor = (cls: string) => (cls.includes('on') ? 'arA' : cls.includes('new') ? 'arG' : cls.includes('gone') ? 'arR' : 'ar')

function textLines(lines: string[], cx: number, top: number, cls: string, step: number): string {
  return lines.map((l, i) => `<text class="${cls}" x="${cx}" y="${top + i * step}" text-anchor="middle">${esc(l)}</text>`).join('')
}

function label(lines: string[], x: number, y: number, w: number, h: number, on = false): string {
  if (lines.length === 0) return ''
  return `<rect class="lb" x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="4"/>${textLines(lines, x, y - (lines.length - 1) * 7 + 4, on ? 'll on' : 'll', 14)}`
}

export function flowSvg(m: FlowModel, L: FlowLayout): string {
  const parts: string[] = [svgOpen(L.W, L.H)]
  for (const g of L.groups) {
    parts.push(`<rect class="g" x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}" rx="12"/><text class="s" x="${g.x + 10}" y="${g.y + 14}">${esc(g.label)}</text>`)
  }
  for (const r of L.routes) {
    const cls = ['e', markClass(r.e.mark), r.e.dash ? 'dash' : '', r.e.bold ? 'bold' : ''].filter(Boolean).join(' ')
    const ar = arrowFor(cls)
    const pts = r.pts.map(p => p.join(',')).join(' ')
    parts.push(`<polyline class="${cls}" points="${pts}" marker-end="url(#${ar})"${r.e.both ? ` marker-start="url(#${ar})"` : ''}/>`)
  }
  for (const r of L.routes) parts.push(label(r.e.lines, r.lx, r.ly, r.e.tw, r.e.th))
  for (const b of Object.values(L.boxes)) {
    const n = b.n
    const cls = `n ${markClass(n.mark)}`
    if (n.shape === 'diamond') {
      parts.push(`<polygon class="${cls}" points="${b.cx},${b.y} ${b.x + b.w},${b.cy} ${b.cx},${b.y + b.h} ${b.x},${b.cy}"/>`)
    } else if (n.shape === 'circle') {
      parts.push(`<ellipse class="${cls}" cx="${b.cx}" cy="${b.cy}" rx="${b.w / 2}" ry="${b.h / 2}"/>`)
    } else {
      const rx = n.shape === 'pill' ? b.h / 2 : n.shape === 'db' ? 4 : 10
      parts.push(`<rect class="${cls}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${rx}"/>`)
      if (n.shape === 'db') parts.push(`<line class="e" x1="${b.x}" y1="${b.y + 8}" x2="${b.x + b.w}" y2="${b.y + 8}"/>`)
    }
    const total = n.lines.length * 16 + n.subLines.length * 14
    const top = b.cy - total / 2 + 12
    parts.push(textLines(n.lines, b.cx, top, 't', 16))
    parts.push(textLines(n.subLines, b.cx, top + n.lines.length * 16, 's', 14))
  }
  parts.push('</svg>')
  return parts.join('')
}

/** Where the line from a box's centre towards (tx, ty) leaves the box. */
function edgePoint(cx: number, cy: number, w: number, h: number, tx: number, ty: number): [number, number] {
  const dx = tx - cx
  const dy = ty - cy
  if (dx === 0 && dy === 0) return [cx, cy]
  const sx = dx === 0 ? Infinity : w / 2 / Math.abs(dx)
  const sy = dy === 0 ? Infinity : h / 2 / Math.abs(dy)
  const s = Math.min(sx, sy)
  return [cx + dx * s, cy + dy * s]
}

export function machineSvg(m: MachineModel, L: MachineLayout, current: string): string {
  const parts: string[] = [svgOpen(L.W, L.H + 10)]
  const centre = (id: string): [number, number] => {
    const p = L.pos[id] ?? [0, 0]
    return [p[0] + L.NW / 2, p[1] + L.NH / 2]
  }
  const labels: string[] = []
  for (const e of m.events) {
    if (e.from === e.to) continue
    const [ax, ay] = centre(e.from)
    const [bx, by] = centre(e.to)
    const back = m.events.some(o => o.from === e.to && o.to === e.from)
    const len = Math.hypot(bx - ax, by - ay) || 1
    const off = back ? 7 : 0
    const ox = (-(by - ay) / len) * off
    const oy = ((bx - ax) / len) * off
    const [sx, sy] = edgePoint(ax + ox, ay + oy, L.NW + 4, L.NH + 4, bx + ox, by + oy)
    const [tx, ty] = edgePoint(bx + ox, by + oy, L.NW + 8, L.NH + 8, ax + ox, ay + oy)
    const on = e.from === current
    const cls = ['e', markClass(e.mark), on ? 'on' : ''].filter(Boolean).join(' ')
    parts.push(`<line class="${cls}" x1="${sx}" y1="${sy}" x2="${tx}" y2="${ty}" marker-end="url(#${arrowFor(cls)})"/>`)
    const text = e.label || e.ev
    const w = Math.max(24, text.length * 6.4 + 12)
    labels.push(label([text], (sx + tx) / 2 + ox, (sy + ty) / 2 + oy, w, 18, on))
  }
  parts.push(...labels)
  for (const id of m.order) {
    const st = m.states[id]
    const p = L.pos[id]
    if (!st || !p) continue
    const on = id === current
    parts.push(`<rect class="n${on ? ' on' : ''}" x="${p[0]}" y="${p[1]}" width="${L.NW}" height="${L.NH}" rx="${L.NH / 2}"/>`)
    if (st.final) parts.push(`<rect class="n${on ? ' on' : ''}" x="${p[0] + 3}" y="${p[1] + 3}" width="${L.NW - 6}" height="${L.NH - 6}" rx="${(L.NH - 6) / 2}" fill="none"/>`)
    if (id === m.initial) parts.push(`<circle class="ar" cx="${p[0] - 9}" cy="${p[1] + L.NH / 2}" r="4"/>`)
    parts.push(`<text class="t" x="${p[0] + L.NW / 2}" y="${p[1] + L.NH / 2 + 4}" text-anchor="middle">${esc(st.label)}</text>`)
  }
  parts.push('</svg>')
  return parts.join('')
}

export function seqSvg(m: SeqModel): string {
  const longest = Math.max(...m.actors.map(a => a.label.length), 4)
  const COL = Math.min(240, Math.max(112, Math.ceil(longest * 7.4 + 44)))
  const PAD = 16
  const HEAD = 34
  const STEP = 38
  const W = PAD * 2 + m.actors.length * COL
  const H = PAD + HEAD + 16 + m.steps.length * STEP + 12
  const xOf = (id: string) => PAD + m.actors.findIndex(a => a.id === id) * COL + COL / 2
  const parts: string[] = [svgOpen(W, H)]
  m.actors.forEach(a => {
    const x = xOf(a.id)
    parts.push(`<line class="life" x1="${x}" y1="${PAD + HEAD}" x2="${x}" y2="${H - 6}"/>`)
    parts.push(`<rect class="n" x="${x - COL / 2 + 8}" y="${PAD}" width="${COL - 16}" height="${HEAD}" rx="8"/>`)
    parts.push(`<text class="t" x="${x}" y="${PAD + HEAD / 2 + 5}" text-anchor="middle">${esc(a.label)}</text>`)
  })
  m.steps.forEach((s, i) => {
    const y = PAD + HEAD + 16 + i * STEP + STEP / 2 + 6
    if (s.kind === 'div') {
      parts.push(`<line class="g" x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}"/>${label([s.text], W / 2, y, s.text.length * 6.4 + 16, 18)}`)
    } else if (s.kind === 'note') {
      const xs = s.over.map(xOf)
      const x0 = Math.min(...xs) - COL / 2 + 14
      const x1 = Math.max(...xs) + COL / 2 - 14
      parts.push(`<rect class="note" x="${x0}" y="${y - 13}" width="${x1 - x0}" height="24" rx="5"/><text class="s" x="${(x0 + x1) / 2}" y="${y + 3}" text-anchor="middle">${esc(s.text)}</text>`)
    } else {
      const a = xOf(s.from)
      const b = xOf(s.to)
      const cls = ['e', markClass(s.mark), s.dash ? 'dash' : ''].filter(Boolean).join(' ')
      const ar = arrowFor(cls)
      if (a === b) {
        parts.push(`<path class="${cls}" d="M${a},${y - 8} h28 v14 h-26" marker-end="url(#${ar})"/><text class="ll" x="${a + 34}" y="${y + 3}">${esc(s.text)}</text>`)
      } else {
        const end = s.lost ? (a + b) / 2 : b + (b > a ? -2 : 2)
        parts.push(`<line class="${cls}" x1="${a}" y1="${y}" x2="${end}" y2="${y}"${s.lost ? '' : ` marker-end="url(#${ar})"`}/>`)
        if (s.lost) parts.push(`<text class="ll" x="${end}" y="${y + 4}" text-anchor="middle">✕</text>`)
        parts.push(`<text class="ll" x="${(a + b) / 2}" y="${y - 6}" text-anchor="middle">${esc(s.text)}</text>`)
      }
    }
  })
  parts.push('</svg>')
  return parts.join('')
}

/** An HTML mockup inside SVG (foreignObject), with numbered pins placed by at="x%,y%". */
export function mockSvg(html: string, w: number, h: number, frame: 'none' | 'browser' | 'phone', title: string | undefined, pins: BriefPin[]): string {
  const chrome = frame === 'browser' ? 30 : frame === 'phone' ? 24 : 0
  const pad = frame === 'phone' ? 10 : 0
  const W = w + pad * 2
  const H = h + chrome + pad * 2
  const parts: string[] = [svgOpen(W, H)]
  if (frame === 'browser') {
    parts.push(`<rect class="n" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10"/>`)
    parts.push(['#ff5f57', '#febc2e', '#28c840'].map((c, i) => `<circle cx="${16 + i * 16}" cy="15" r="5" fill="${c}"/>`).join(''))
    if (title) parts.push(`<text class="s" x="${W / 2}" y="19" text-anchor="middle">${esc(title)}</text>`)
  } else if (frame === 'phone') {
    parts.push(`<rect class="n" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="24"/>`)
  }
  parts.push(
    `<foreignObject x="${pad}" y="${chrome + pad}" width="${w}" height="${h}"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px;overflow:hidden;font:13px ${FONT};color:#1d1d1f">${html}</div></foreignObject>`,
  )
  pins.forEach((pin, i) => {
    const m = /^\s*([\d.]+)%\s*,\s*([\d.]+)%\s*$/.exec(pin.at ?? '')
    if (!m) return
    const x = pad + (Number(m[1]) / 100) * w
    const y = chrome + pad + (Number(m[2]) / 100) * h
    parts.push(`<circle cx="${x}" cy="${y}" r="9" fill="#0071e3" stroke="#ffffff" stroke-width="2"/><text x="${x}" y="${y + 4}" text-anchor="middle" style="font:600 11px ${FONT};fill:#ffffff">${i + 1}</text>`)
  })
  parts.push('</svg>')
  return parts.join('')
}
