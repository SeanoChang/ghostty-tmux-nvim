import type { AgentNode, NodeStatus } from '../types'

// Two looks, chosen in /config: minimal works on every terminal (plain Unicode,
// one accent); kitty is warm and playful (emoji cats, which take two cells).
// Colour carries state before it decorates: ok, warn and bad mean status only.
export type ThemeName = 'kitty' | 'minimal'

export type Palette = {
  ink: string; soft: string; muted: string; faint: string; rule: string; frame: string
  accent: string; selBg: string; ok: string; warn: string; bad: string; add: string; del: string
}

export type Theme = {
  name: ThemeName
  c: Palette
  status: Record<NodeStatus, { icon: string; word: string; color: string }>
  // the running glyph's second frame, so a live row breathes
  runningAlt: string
  // One glyph per row means status. A second one appears only for what holds
  // others (a workflow, a cluster) and for files; a plain agent gets none.
  kind: { workflow: string; group: string; file: string }
  bar: { full: string; empty: string }
  // the mark on a warning: a quiet agent, a file two agents edited
  warn: string
  fold: { open: string; closed: string }
  cursor: string
  words: { live: string; history: string; emptyLive: string; emptyHistory: string; emptyHint: string }
  // A trace's lanes: one hue per agent, kept apart from the status colours, which mean state.
  lanes: string[]
  // the mark a failed agent leaves in its trace lane (kitty's takes two cells)
  traceFail: string
  // the words a quiet gap reads in a trace
  quiet: string
}

const MINIMAL: Theme = {
  name: 'minimal',
  c: {
    ink: '#d4d7de', soft: '#b3b8c3', muted: '#8a909c', faint: '#5c626d', rule: '#3a3f48', frame: '#4a505b',
    accent: '#7aa2f7', selBg: '#2a2f38', ok: '#9ece6a', warn: '#e0af68', bad: '#f7768e', add: '#9ece6a', del: '#f7768e',
  },
  status: {
    running: { icon: '●', word: 'Running', color: '#e0af68' },
    done: { icon: '✓', word: 'Done', color: '#9ece6a' },
    failed: { icon: '✗', word: 'Failed', color: '#f7768e' },
    killed: { icon: '■', word: 'Stopped', color: '#8a909c' },
  },
  runningAlt: '○',
  kind: { workflow: '◆', group: '◇', file: '·' },
  bar: { full: '▰', empty: '▱' },
  warn: '⚠',
  fold: { open: '▾', closed: '▸' },
  cursor: '▌',
  words: {
    live: 'Running', history: 'Finished',
    emptyLive: 'Nothing is running right now.', emptyHistory: 'No finished runs yet.',
    emptyHint: 'Subagents and workflows appear here while they run, then move to History.',
  },
  lanes: ['#7aa2f7', '#bb9af7', '#7dcfff', '#73daca', '#ff9e64', '#c0caf5'],
  traceFail: '✗',
  quiet: 'quiet',
}

const KITTY: Theme = {
  name: 'kitty',
  c: {
    ink: '#f4e4d8', soft: '#e3c9b8', muted: '#b8968a', faint: '#7a5f62', rule: '#4a3346', frame: '#ff8f70',
    accent: '#ff8f70', selBg: '#3d2838', ok: '#a6d189', warn: '#f5c27a', bad: '#f38ba8', add: '#a6d189', del: '#f38ba8',
  },
  status: {
    running: { icon: '🐱', word: 'Running', color: '#f5c27a' },
    done: { icon: '😺', word: 'Done', color: '#a6d189' },
    failed: { icon: '😿', word: 'Failed', color: '#f38ba8' },
    killed: { icon: '🙀', word: 'Stopped', color: '#b8968a' },
  },
  runningAlt: '🐈',
  kind: { workflow: '🧶', group: '🐾', file: '🧾' },
  bar: { full: '▰', empty: '▱' },
  warn: '⚠',
  fold: { open: '▾', closed: '▸' },
  cursor: '▌',
  words: {
    live: 'Out exploring', history: 'Back home',
    emptyLive: 'ᓚᘏᗢ zzz · No cats out.', emptyHistory: 'No cats have come home yet.',
    emptyHint: 'Subagents and workflows (🧶) appear here while they run, then move to History.',
  },
  lanes: ['#ff8f70', '#c9a0dc', '#89dceb', '#94e2d5', '#fab387', '#f5e0dc'],
  traceFail: '😿',
  quiet: 'ᓚᘏᗢ zzz',
}

export const THEMES: Record<ThemeName, Theme> = { minimal: MINIMAL, kitty: KITTY }
export const themeOf = (name: unknown): Theme => (name === 'kitty' ? KITTY : MINIMAL)

// The glyph a row shows for what a node is: only what holds others has one.
export function kindGlyph(t: Theme, n: Pick<AgentNode, 'kind'>): string {
  if (n.kind === 'workflow') return t.kind.workflow
  if (n.kind === 'group') return t.kind.group
  return ''
}

// ── display width: how many terminal cells a string takes ──────────────────
const ZERO = (cp: number) => (cp >= 0x300 && cp <= 0x36f) || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)
const WIDE = (cp: number) =>
  cp >= 0x1f000 ||
  (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
  (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6)

export function cellWidth(s: string): number {
  let w = 0
  for (const ch of s) {
    const cp = ch.codePointAt(0)!
    w += ZERO(cp) ? 0 : WIDE(cp) ? 2 : 1
  }
  return w
}

// Cut to a width in cells, ending with … when anything was cut.
export function fit(s: string, width: number): string {
  if (width <= 0) return ''
  if (cellWidth(s) <= width) return s
  let out = ''
  let w = 0
  for (const ch of s) {
    const cw = cellWidth(ch)
    if (w + cw > width - 1) break
    out += ch
    w += cw
  }
  return out + '…'
}

export const padEnd = (s: string, width: number) => s + ' '.repeat(Math.max(0, width - cellWidth(s)))
export const padStart = (s: string, width: number) => ' '.repeat(Math.max(0, width - cellWidth(s))) + s
