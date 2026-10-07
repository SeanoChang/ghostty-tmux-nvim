// Tables the pane draws itself. The Markdown element lays a table out at its natural width, so in
// a narrow pane every row wraps into a wall of pipes. Here a table is a grid when its columns fit
// the width, and one small record per row when they do not.

export type Table = { head: string[]; rows: string[][] }
export type Chunk = { kind: 'md'; text: string } | { kind: 'table'; table: Table }
export type Layout = { mode: 'grid'; widths: number[] } | { mode: 'stack'; labelWidth: number }

/** Space between grid columns. */
export const COL_GAP = 2

const isRow = (line: string) => /^\s*\|.*\|\s*$/.test(line)
const isRule = (line: string) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) && line.includes('-')

/** Strips the inline marks a plain Text cannot draw. */
export const plain = (s: string) =>
  s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .trim()

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map(c => plain(c.replace(/\\\|/g, '|')))

/** Splits Markdown into prose and GFM tables. Tables inside code fences stay prose. */
export function splitTables(md: string): Chunk[] {
  const lines = md.split('\n')
  const out: Chunk[] = []
  let prose: string[] = []
  let fenced = false
  const flush = () => {
    const text = prose.join('\n').trim()
    if (text) out.push({ kind: 'md', text })
    prose = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    if (!fenced && isRow(line) && isRule(lines[i + 1] ?? '')) {
      const head = cells(line)
      const rows: string[][] = []
      let j = i + 2
      for (; j < lines.length && isRow(lines[j] as string); j++) rows.push(cells(lines[j] as string))
      flush()
      out.push({ kind: 'table', table: { head, rows: rows.map(r => head.map((_, k) => r[k] ?? '')) } })
      i = j - 1
      continue
    }
    prose.push(line)
  }
  flush()
  return out
}

const longestWord = (s: string) => Math.max(1, ...s.split(/\s+/).map(w => w.length))

/**
 * Grid when every column gets at least its longest word; columns share the spare width in
 * proportion to their natural width. Otherwise one record per row.
 */
export function layoutTable(t: Table, width: number): Layout {
  const n = t.head.length
  const all = [t.head, ...t.rows]
  const natural = t.head.map((_, k) => Math.max(...all.map(r => (r[k] ?? '').length), 1))
  const min = t.head.map((_, k) => Math.min(natural[k] as number, Math.max(...all.map(r => longestWord(r[k] ?? '')))))
  const avail = width - COL_GAP * (n - 1)
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
  if (sum(natural) <= avail) return { mode: 'grid', widths: natural }
  if (sum(min) <= avail) {
    const spare = avail - sum(min)
    const extra = natural.map((w, k) => w - (min[k] as number))
    const total = sum(extra) || 1
    const widths = min.map((m, k) => m + Math.floor((spare * (extra[k] as number)) / total))
    // A column that wraps in under 10 cells puts a word or two per line; records read better than that.
    if (widths.every((w, k) => w >= (natural[k] as number) || w >= 10)) return { mode: 'grid', widths }
  }
  return { mode: 'stack', labelWidth: Math.min(Math.max(...t.head.slice(1).map(h => h.length), 1), Math.floor(width / 3)) }
}
