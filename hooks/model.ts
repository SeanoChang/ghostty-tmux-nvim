// Turns the show tool's input into a Brief: ids, exhibits parsed and drawn, files read, limits checked.

import { NW, dedent } from './core.js'
import { flowSvg, machineSvg, mockSvg, seqSvg } from './svg.ts'
import { plain, splitTables } from './table.ts'
import type {
  Brief,
  BriefAsk,
  BriefNote,
  BriefOption,
  BriefPin,
  BriefPoint,
  BriefQuote,
  BriefTerm,
  CallRow,
  Exhibit,
  MockExhibit,
  Tone,
} from '../types'

/** A reader answers the text (or base64), undefined when missing, or why it refused (fence, secret). */
export type Refused = { refused: string }
export type ReadFile = (path: string) => Promise<string | Refused | undefined>
export type ReadBytes = (path: string) => Promise<string | Refused | undefined>
const isRefused = (v: unknown): v is Refused => typeof v === 'object' && v !== null && 'refused' in v

type Raw = Record<string, unknown>

const MAX_TOP = 6
const MAX_CHILDREN = 5
const MAX_DEPTH = 3
const EXHIBITS = ['detail', 'code', 'schema', 'calls', 'flow', 'machine', 'seq', 'tree', 'mock', 'svg', 'image', 'table'] as const
/** Svg source is capped at 131072 characters; leave room for the wrapper. */
const MAX_PNG_BASE64 = 130000
const TONES = new Set(['info', 'warn', 'risk', 'ok', 'idea'])

/** From html-plan's pack.mjs: text that looks like a key or token. Names are fenced in register.tsx. */
export const SECRET_TEXT = /sk-ant-|sk-[A-Za-z0-9]{32,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[abeprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.|(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token)["']?\s*[:=]\s*["'][^"'\s$<{]{12,}["']/i
/** The Svg element takes at most 131072 characters. */
const MAX_SVG = 131072

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', py: 'python', go: 'go', rs: 'rust',
  sql: 'sql', sh: 'bash', zsh: 'bash', rb: 'ruby', java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', h: 'c',
  cpp: 'cpp', cs: 'csharp', json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', md: 'markdown', proto: 'protobuf',
  css: 'css', html: 'html',
}

export const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length

const langOf = (path: string | undefined) => (path ? EXT_LANG[path.split('.').pop()?.toLowerCase() ?? ''] : undefined)

/** html-plan diffs mark lines with + - and a leading space; Code wants a unified hunk. */
export function toHunk(source: string, start = 1): string {
  if (/^@@ /m.test(source)) return source
  const lines = source.replace(/\n$/, '').split('\n').map(l => (/^[+\- ]/.test(l) ? l : ` ${l}`))
  const oldCount = lines.filter(l => !l.startsWith('+')).length
  const newCount = lines.filter(l => !l.startsWith('-')).length
  return [`@@ -${start},${oldCount} +${start},${newCount} @@`, ...lines].join('\n')
}

function toPins(raw: unknown): BriefPin[] {
  return (Array.isArray(raw) ? raw : []).filter(isRecord).flatMap(p => {
    const title = text(p.title)
    if (!title) return []
    const tone = text(p.tone)
    return [{ title, text: text(p.text), line: num(p.line), at: text(p.at), tone: tone && TONES.has(tone) ? (tone as Tone) : undefined }]
  })
}

class Ctx {
  errors: string[] = []
  warnings: string[] = []
  files = new Map<string, string | undefined>()
  constructor(
    readonly read: ReadFile,
    readonly readBytes: ReadBytes,
  ) {}

  async file(path: string, at: string): Promise<string | undefined> {
    if (!this.files.has(path)) {
      const got = await this.read(path)
      if (isRefused(got)) {
        this.errors.push(`${at}: ${path} — ${got.refused}`)
        this.files.set(path, '\u0000refused')
        return undefined
      }
      this.files.set(path, got !== undefined && SECRET_TEXT.test(got) ? '\u0000secret' : got)
    }
    const body = this.files.get(path)
    if (body === '\u0000refused') return undefined
    if (body === '\u0000secret') {
      this.errors.push(`${at}: ${path} looks like it holds a secret; no excerpt is taken from it`)
      return undefined
    }
    return body
  }

  /** An SVG the pane can draw, or an error saying how far over the limit it is. */
  svg(svg: string, at: string, what: string): string | undefined {
    if (svg.length <= MAX_SVG) return svg
    this.errors.push(`${at}: the ${what} draws as ${svg.length} characters of SVG; the pane takes ${MAX_SVG}. Cut nodes or text, or render it as an image`)
    return undefined
  }
}


const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Decodes the first bytes of a base64 string (enough to read a PNG header). */
function headBytes(b64: string, n: number): number[] {
  const out: number[] = []
  for (let i = 0; i + 3 < b64.length && out.length < n; i += 4) {
    const v = [0, 1, 2, 3].map(k => B64.indexOf(b64[i + k] ?? 'A'))
    const x = ((v[0] ?? 0) << 18) | ((v[1] ?? 0) << 12) | ((v[2] ?? 0) << 6) | (v[3] ?? 0)
    out.push((x >> 16) & 255, (x >> 8) & 255, x & 255)
  }
  return out.slice(0, n)
}

/** Width and height from a PNG's IHDR chunk, or undefined when it is not a PNG. */
export function pngSize(b64: string): { width: number; height: number } | undefined {
  const h = headBytes(b64, 24)
  const sig = [137, 80, 78, 71, 13, 10, 26, 10]
  if (h.length < 24 || sig.some((s, i) => h[i] !== s)) return undefined
  const u32 = (o: number) => (((h[o] ?? 0) << 24) >>> 0) + ((h[o + 1] ?? 0) << 16) + ((h[o + 2] ?? 0) << 8) + (h[o + 3] ?? 0)
  return { width: u32(16), height: u32(20) }
}

function slice(body: string, from: number, to: number): string {
  return body.split('\n').slice(Math.max(0, from - 1), to).join('\n')
}

function mock(raw: Raw, at: string, ctx: Ctx): MockExhibit | undefined {
  const frameIn = text(raw.frame) ?? 'none'
  const frame = (['none', 'terminal', 'browser', 'phone'].includes(frameIn) ? frameIn : 'none') as MockExhibit['frame']
  const html = typeof raw.html === 'string' ? raw.html : undefined
  if (!html) {
    ctx.errors.push(`${at}: mock needs html`)
    return undefined
  }
  const pins = toPins(raw.pins)
  const title = text(raw.title)
  if (frame === 'terminal') {
    const plain = html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    return { kind: 'mock', frame, title, text: dedent(plain), pins }
  }
  const w = num(raw.w) ?? 440
  const h = num(raw.h) ?? 220
  if (w > 480 && raw.thumbnail !== true) ctx.warnings.push(`${at}: mock is ${w} wide; draw the smallest region that makes the point (480 at most)`)
  if (/<script\b|\son\w+\s*=/i.test(html)) ctx.warnings.push(`${at}: mock scripts and event handlers are stripped; draw states as separate mocks`)
  const svg = ctx.svg(mockSvg(html, w, h, frame, title, pins), at, 'mockup')
  return svg ? { kind: 'mock', frame, title, svg, pins } : undefined
}

async function exhibitOf(item: Raw, at: string, ctx: Ctx): Promise<Exhibit | undefined> {
  const present = EXHIBITS.filter(k => item[k] !== undefined && item[k] !== null && item[k] !== '')
  if (present.length > 1) ctx.errors.push(`point ${at}: ${present.join(' and ')} — one exhibit per claim; a second exhibit is a second claim`)
  const kind = present[0]
  if (!kind) return undefined
  const raw = item[kind]
  const block = isRecord(raw) ? raw : { source: raw }
  const source = typeof block.source === 'string' ? dedent(block.source) : undefined

  if (kind === 'detail') {
    const body = text(raw)
    if (body && body.split(/(?<=[.!?])\s+/).length > 6) ctx.warnings.push(`point ${at}: detail is long; 4 sentences or fewer reads faster`)
    return body ? { kind: 'markdown', text: body } : undefined
  }
  if (kind === 'svg') {
    const svg = text(raw)
    const ok = svg ? ctx.svg(svg, `point ${at}`, 'svg') : undefined
    return ok ? { kind: 'svg', svg: ok, legend: text(item.svgAlt) } : undefined
  }
  if (kind === 'code') {
    const src = text(block.src) ?? text(block.path)
    const isDiff = block.diff === true || block.isDiff === true
    let body = source
    let start = num(block.start) ?? num(block.startLine)
    if (body === undefined && src) {
      const file = await ctx.file(src, `point ${at}`)
      if (file === undefined) {
        if (!ctx.errors.some(e => e.includes(src))) ctx.errors.push(`point ${at}: cannot read ${src}`)
        return undefined
      }
      const m = /^(\d+)(?:-(\d+))?$/.exec(text(block.lines) ?? '')
      const a = m ? Number(m[1]) : 1
      const b = m ? Number(m[2] ?? m[1]) : Math.min(file.split('\n').length, 25)
      body = slice(file, a, b)
      start = a
    }
    if (body === undefined) {
      ctx.errors.push(`point ${at}: code needs source, or src with lines`)
      return undefined
    }
    const n = body.split('\n').length
    if (n > 30) ctx.warnings.push(`point ${at}: code is ${n} lines; 10 to 25 reads best`)
    const path = src ?? text(block.file)
    return {
      kind: 'code',
      title: text(block.title),
      source: isDiff ? toHunk(body, start ?? 1) : body,
      language: text(block.language) ?? text(block.lang) ?? langOf(path),
      path,
      startLine: isDiff ? undefined : start,
      isDiff,
      pins: toPins(block.pins),
    }
  }
  if (kind === 'image') {
    const path = text(block.path) ?? text(block.src) ?? text(raw)
    if (!path) {
      ctx.errors.push(`point ${at}: image needs path (a PNG you rendered)`)
      return undefined
    }
    const png = await ctx.readBytes(path)
    if (isRefused(png)) {
      ctx.errors.push(`point ${at}: ${path} — ${png.refused}`)
      return undefined
    }
    if (png === undefined) {
      ctx.errors.push(`point ${at}: cannot read ${path}`)
      return undefined
    }
    const size = pngSize(png)
    if (!size) {
      ctx.errors.push(`point ${at}: ${path} is not a PNG`)
      return undefined
    }
    if (png.length > MAX_PNG_BASE64) {
      ctx.errors.push(`point ${at}: ${path} is ${Math.round((png.length * 3) / 4 / 1024)} KB; the pane takes about 95 KB. Render it narrower or with fewer colours (e.g. \`magick in.png -resize 900x -colors 64 out.png\`)`)
      return undefined
    }
    return { kind: 'image', png, width: size.width, height: size.height, path, alt: text(block.alt) ?? text(item.claim) ?? 'figure' }
  }
  if (kind === 'mock') return mock(block, `point ${at}`, ctx)
  if (kind === 'table') {
    // A Markdown table, or {title, columns, rows}.
    const md = typeof raw === 'string' ? raw : source
    if (md) {
      const t = splitTables(md).find(c => c.kind === 'table')
      if (t?.kind === 'table') return { kind: 'table', title: text(block.title), ...t.table }
      ctx.errors.push(`point ${at}: table needs a Markdown table (a header row, then a |---| row)`)
      return undefined
    }
    const head = Array.isArray(block.columns) ? block.columns.map(c => plain(String(c))) : []
    const rows = Array.isArray(block.rows) ? block.rows.filter(Array.isArray).map(r => head.map((_, k) => plain(String((r as unknown[])[k] ?? '')))) : []
    if (head.length < 2 || rows.length === 0) {
      ctx.errors.push(`point ${at}: table needs at least 2 columns and 1 row`)
      return undefined
    }
    return { kind: 'table', title: text(block.title), head, rows }
  }
  if (source === undefined) {
    ctx.errors.push(`point ${at}: ${kind} needs source`)
    return undefined
  }
  if (kind === 'schema') {
    const language = text(block.language) ?? text(block.lang)
    if (!language) ctx.errors.push(`point ${at}: schema needs language (ts, sql, proto…): write the shape in the project's own language`)
    const isDiff = block.diff === true || block.isDiff === true
    return { kind: 'schema', title: text(block.title), source: isDiff ? toHunk(source) : source, language: language ?? 'text', isDiff }
  }
  if (kind === 'calls') {
    const m = NW.parseCalls(source)
    m.errors.forEach(e => ctx.errors.push(`point ${at} calls: ${e}`))
    if (m.nodes.length > 15) ctx.warnings.push(`point ${at}: ${m.nodes.length} call rows; keep one tree under about 15`)
    if (!m.nodes.some(nd => nd.mark !== ' ')) ctx.warnings.push(`point ${at}: no + - ~ ? rows; mark what changes`)
    const rows: CallRow[] = []
    for (const [i, nd] of m.nodes.entries()) {
      const row: CallRow = {
        key: `${at}-r${i}`,
        depth: nd.depth,
        mark: (['+', '-', '~', '?'].includes(nd.mark) ? nd.mark : ' ') as CallRow['mark'],
        name: nd.name,
        isNew: nd.isNew,
        isGap: nd.gap,
        loc: nd.loc,
        note: nd.note,
      }
      const line = Number(nd.line)
      if (nd.file && line > 0) {
        const got = await ctx.read(nd.file)
        if (isRefused(got)) ctx.warnings.push(`point ${at} calls: ${nd.file} — ${got.refused}; no excerpt`)
        const file = typeof got === 'string' && !SECRET_TEXT.test(got) ? got : undefined
        if (file !== undefined) row.excerpt = { source: slice(file, line - 6, line + 6), path: nd.file, startLine: Math.max(1, line - 6), language: langOf(nd.file) }
      }
      rows.push(row)
    }
    return { kind: 'calls', title: text(block.title), rows }
  }
  if (kind === 'flow') {
    const m = NW.parseFlow(source)
    m.errors.forEach(e => ctx.errors.push(`point ${at} flow: ${e}`))
    if (m.order.length > 12) ctx.warnings.push(`point ${at}: ${m.order.length} flow nodes; past about 12 a diagram stops being readable`)
    if (m.errors.length > 0 || m.order.length === 0) return undefined
    const svg = ctx.svg(flowSvg(m, NW.layoutFlow(m)), `point ${at}`, 'flow')
    if (!svg) return undefined
    return { kind: 'flow', svg, legend: m.edges.some(e => e.dash) ? `Dashed: ${text(block.dashed) ?? 'async or optional'}.` : undefined }
  }
  if (kind === 'seq') {
    const m = NW.parseSeq(source)
    m.errors.forEach(e => ctx.errors.push(`point ${at} seq: ${e}`))
    if (m.actors.length >= 5) ctx.warnings.push(`point ${at}: ${m.actors.length} participants; about 3 lanes read without panning`)
    if (m.errors.length > 0 || m.steps.length === 0) return undefined
    const svg = ctx.svg(seqSvg(m), `point ${at}`, 'sequence')
    return svg ? { kind: 'seq', svg } : undefined
  }
  if (kind === 'machine') {
    const m = NW.parseMachine(source)
    m.errors.forEach(e => ctx.errors.push(`point ${at} machine: ${e}`))
    if (m.order.length > 8) ctx.warnings.push(`point ${at}: ${m.order.length} states; keep it to 8`)
    const screens: Record<string, MockExhibit> = {}
    if (isRecord(block.screens)) {
      for (const [state, screen] of Object.entries(block.screens)) {
        if (!m.states[state]) ctx.errors.push(`point ${at} machine: screen for unknown state "${state}"`)
        else if (isRecord(screen)) {
          const made = mock(screen, `point ${at} screen ${state}`, ctx)
          if (made) screens[state] = made
        }
      }
    }
    if (m.errors.length > 0 || !ctx.svg(machineSvg(m, NW.layoutMachine(m), m.initial), `point ${at}`, 'state machine')) return undefined
    return { kind: 'machine', source, screens }
  }
  if (kind === 'tree') {
    const m = NW.parseTree(source)
    return { kind: 'tree', rows: m.rows.map(r => ({ depth: r.depth, name: r.name, note: r.note, mark: r.mark, last: r.last })) }
  }
  return undefined
}

async function askOf(raw: unknown, at: string, ctx: Ctx): Promise<BriefAsk | undefined> {
  if (!isRecord(raw)) return undefined
  const kindIn = text(raw.kind) ?? 'one'
  const kind = (['one', 'many', 'text', 'scale', 'rank'].includes(kindIn) ? kindIn : 'one') as BriefAsk['kind']
  const question = text(raw.question)
  const options: BriefOption[] = []
  for (const o of (Array.isArray(raw.options) ? raw.options : []).filter(isRecord)) {
    const value = String(o.value ?? '').trim()
    const label = String(o.label ?? '').trim()
    if (value === '' || label === '') continue
    const list = (v: unknown) => (Array.isArray(v) ? v.map(x => text(x)).filter((x): x is string => !!x) : undefined)
    // An option may carry one exhibit of its own, in the same fields a point uses (detail is its prose).
    const exhibit = await exhibitOf({ ...o, detail: undefined, claim: label }, `${at} option ${value}`, ctx)
    options.push({ value, label, note: text(o.note), detail: text(o.detail), pros: list(o.pros), cons: list(o.cons), exhibit })
  }
  const recommended = typeof raw.recommended === 'number' ? String(raw.recommended) : (text(raw.recommended) ?? '')
  const then = isRecord(raw.then) ? Object.fromEntries(Object.entries(raw.then).flatMap(([k, v]) => (text(v) ? [[k, String(v)]] : []))) : {}
  if (!question) {
    ctx.errors.push(`point ${at}: ask needs a question`)
    return undefined
  }
  if (words(question) > 15) ctx.warnings.push(`point ${at}: the question is ${words(question)} words; 15 at most`)
  if ((kind === 'one' || kind === 'many' || kind === 'rank') && options.length < 2) {
    ctx.errors.push(`point ${at}: a ${kind} ask needs at least 2 options`)
    return undefined
  }
  const values = new Set(options.map(o => o.value))
  const picks = recommended.split(',').map(v => v.trim()).filter(Boolean)
  if (kind === 'one' && !values.has(recommended)) ctx.errors.push(`point ${at}: recommended must be one of the option values`)
  if ((kind === 'many' || kind === 'rank') && picks.some(v => !values.has(v))) ctx.errors.push(`point ${at}: recommended must list option values, separated by commas`)
  const min = num(raw.min)
  const max = num(raw.max)
  if (kind === 'scale' && (min === undefined || max === undefined || max <= min || max - min > 20)) ctx.errors.push(`point ${at}: a scale ask needs min and max, at most 20 apart`)
  const rec = kind === 'rank' && picks.length === 0 ? options.map(o => o.value).join(',') : recommended
  return { kind, question, options, recommended: rec, min, max, then }
}

/** "2=no" shows the point only when decision 2 is "no"; "2!=no" when it is anything else. */
function whenOf(raw: unknown, at: string, ctx: Ctx): BriefPoint['when'] {
  const s = text(raw)
  if (!s) return undefined
  const m = /^\s*([\w.]+)\s*(!?=)\s*(.+?)\s*$/.exec(s)
  if (!m) {
    ctx.errors.push(`point ${at}: when must look like "2=no" or "2!=no"`)
    return undefined
  }
  return { id: m[1] as string, value: m[3] as string, negate: m[2] === '!=' }
}

async function pointsOf(raw: unknown, prefix: string, depth: number, ctx: Ctx): Promise<BriefPoint[]> {
  const list = (Array.isArray(raw) ? raw : []).filter(isRecord)
  const main = list.filter(p => !p.aux)
  const aux = list.filter(p => p.aux)
  const limit = depth === 1 ? MAX_TOP : MAX_CHILDREN
  if (main.length > limit) ctx.errors.push(`${prefix || 'top level'}: ${main.length} points, at most ${limit}`)
  if (depth > MAX_DEPTH && list.length > 0) {
    ctx.errors.push(`${prefix}: points nest ${depth} levels deep, at most ${MAX_DEPTH}`)
    return []
  }
  if (aux.length > 0 && depth > 1) ctx.errors.push(`${prefix}: aux points go at the top level only`)
  const lastMain = list.map(p => !p.aux).lastIndexOf(true)
  if (aux.length > 0 && list.findIndex(p => p.aux) < lastMain) ctx.errors.push('aux points (shared, scope) must come last')

  const out: BriefPoint[] = []
  let n = 0
  for (const item of list) {
    const auxKind = item.aux === 'shared' || item.aux === 'scope' ? item.aux : undefined
    if (item.aux && !auxKind) ctx.errors.push(`aux must be "shared" or "scope", not "${String(item.aux)}"`)
    const id = auxKind ?? (prefix ? `${prefix}.${++n}` : String(++n))
    const claim = text(item.claim)
    if (!claim) ctx.errors.push(`point ${id}: claim is empty`)
    else if (depth < 3 && !auxKind && words(claim) > 15) ctx.warnings.push(`point ${id}: the claim is ${words(claim)} words; about 12 reads at a glance`)
    const noteRaw = isRecord(item.note) ? item.note : undefined
    const noteTone = text(noteRaw?.tone)
    const note: BriefNote | undefined = noteRaw && text(noteRaw.text)
      ? { tone: noteTone && TONES.has(noteTone) ? (noteTone as Tone) : 'info', text: String(noteRaw.text) }
      : undefined
    out.push({
      id,
      claim: claim ?? '',
      aux: auxKind,
      exhibit: await exhibitOf(item, id, ctx),
      caption: text(item.caption),
      ask: await askOf(item.ask, id, ctx),
      when: whenOf(item.when, id, ctx),
      note,
      points: await pointsOf(item.points, id, depth + 1, ctx),
    })
  }
  return out
}

export function flatten(points: BriefPoint[]): BriefPoint[] {
  return points.flatMap(p => [p, ...flatten(p.points)])
}

export type Built = { brief?: Omit<Brief, 'version'>; errors: string[]; warnings: string[] }

export async function buildBrief(input: Raw, read: ReadFile, readBytes: ReadBytes): Promise<Built> {
  const ctx = new Ctx(read, readBytes)
  const title = text(input.title)
  const gist = text(input.gist)
  if (!title) ctx.errors.push('title is empty')
  if (!gist) ctx.errors.push('gist is empty')
  const points = await pointsOf(input.points, '', 1, ctx)
  if (points.filter(p => !p.aux).length === 0) ctx.errors.push('a brief needs at least one point')
  const all = flatten(points)
  for (const p of all) {
    if (!p.when) continue
    const target = all.find(q => q.id === p.when?.id)
    if (!target?.ask) ctx.errors.push(`point ${p.id}: when names ${p.when.id}, which is not a decision`)
    else if (target.ask.options.length > 0 && !target.ask.options.some(o => o.value === p.when?.value))
      ctx.errors.push(`point ${p.id}: when value "${p.when.value}" is not an option of decision ${p.when.id}`)
  }
  const asks = all.filter(p => p.ask).length
  if (asks > 5) ctx.warnings.push(`${asks} decisions; ask only about forks that change what you build (2 to 5)`)

  const why: BriefQuote[] = (Array.isArray(input.why) ? input.why : []).filter(isRecord).flatMap(q => {
    const said = text(q.text)
    return said ? [{ via: text(q.via) ?? 'prompt', from: text(q.from) ?? 'the user', text: said, at: text(q.at) }] : []
  })
  const terms: BriefTerm[] = (Array.isArray(input.terms) ? input.terms : [])
    .filter(isRecord)
    .map(t => ({ term: text(t.term) ?? '', meaning: text(t.meaning) ?? '' }))
    .filter(t => t.term !== '' && t.meaning !== '')
  const ch = isRecord(input.changes) ? input.changes : undefined
  const changes = ch ? { new: num(ch.new), changed: num(ch.changed), deleted: num(ch.deleted) } : undefined

  if (ctx.errors.length > 0) return { errors: ctx.errors, warnings: ctx.warnings }
  return { brief: { title: title as string, gist: gist as string, why, changes, points, terms, gate: input.gate === true ? true : undefined }, errors: [], warnings: ctx.warnings }
}

/** What a point is, for change detection between versions. */
export const signature = (p: BriefPoint) => JSON.stringify([p.claim, p.exhibit, p.ask, p.note, p.when])

// ── patch: change a brief without resending it ─────────────────────────

type RawPoint = Raw & { points?: unknown; __prev?: string; __touched?: boolean }

/** Walks the raw tree in the order buildBrief numbers it, giving each point its id. */
function numberRaw(list: unknown, prefix: string, visit: (node: RawPoint, id: string) => void) {
  let n = 0
  for (const node of (Array.isArray(list) ? list : []).filter(isRecord) as RawPoint[]) {
    const aux = node.aux === 'shared' || node.aux === 'scope' ? (node.aux as string) : undefined
    const id = aux ?? (prefix ? `${prefix}.${++n}` : String(++n))
    visit(node, id)
    numberRaw(node.points, id, visit)
  }
}

export type PatchOp =
  | { op: 'set'; id: string; point: Raw }
  | { op: 'add'; parent?: string; after?: string; point: Raw }
  | { op: 'remove'; id: string }
  | { op: 'meta'; title?: string; gist?: string; why?: unknown; changes?: unknown; terms?: unknown; gate?: boolean }

export type Patched = { raw?: Raw; errors: string[]; map: Record<string, string>; touched: string[] }

/** Applies ops to a copy of the raw input; answers which old ids became which new ids. */
export function patchRaw(raw: Raw, ops: unknown): Patched {
  const errors: string[] = []
  const copy = JSON.parse(JSON.stringify(raw)) as Raw
  if (!Array.isArray(copy.points)) copy.points = []
  const byId = new Map<string, { node: RawPoint; siblings: RawPoint[] }>()
  const index = (list: unknown, prefix: string) => {
    let n = 0
    for (const node of (Array.isArray(list) ? list : []).filter(isRecord) as RawPoint[]) {
      const aux = node.aux === 'shared' || node.aux === 'scope' ? (node.aux as string) : undefined
      const id = aux ?? (prefix ? `${prefix}.${++n}` : String(++n))
      node.__prev = id
      byId.set(id, { node, siblings: list as RawPoint[] })
      if (!Array.isArray(node.points)) node.points = node.points ?? undefined
      index(node.points, id)
    }
  }
  index(copy.points, '')
  const list = (Array.isArray(ops) ? ops : []).filter(isRecord)
  if (list.length === 0) errors.push('ops is empty')
  for (const [i, op] of list.entries()) {
    const at = `op ${i + 1} (${String(op.op)})`
    if (op.op === 'meta') {
      for (const k of ['title', 'gist', 'why', 'changes', 'terms', 'gate'] as const) if (op[k] !== undefined) copy[k] = op[k]
    } else if (op.op === 'set') {
      const hit = byId.get(String(op.id))
      if (!hit || !isRecord(op.point)) {
        errors.push(`${at}: no point ${String(op.id)}, or no point object`)
        continue
      }
      const keepKids = op.point.points === undefined ? hit.node.points : op.point.points
      for (const k of Object.keys(hit.node)) if (k !== '__prev') delete hit.node[k]
      Object.assign(hit.node, op.point, { points: keepKids, __touched: true })
    } else if (op.op === 'add') {
      if (!isRecord(op.point)) {
        errors.push(`${at}: no point object`)
        continue
      }
      const parentId = text(op.parent)
      const parent = parentId ? byId.get(parentId)?.node : undefined
      if (parentId && !parent) {
        errors.push(`${at}: no parent ${parentId}`)
        continue
      }
      const target: RawPoint[] = parent ? (Array.isArray(parent.points) ? (parent.points as RawPoint[]) : (parent.points = [] as RawPoint[])) : (copy.points as RawPoint[])
      const afterId = text(op.after)
      const node: RawPoint = { ...op.point, __touched: true }
      const afterNode = afterId ? byId.get(afterId)?.node : undefined
      let pos = afterNode ? target.indexOf(afterNode) + 1 : target.length
      // A new main point goes before shared/scope at the top level.
      if (!parent && !afterNode && !node.aux) {
        const firstAux = target.findIndex(x => x.aux)
        if (firstAux !== -1) pos = firstAux
      }
      if (afterId && !afterNode) errors.push(`${at}: no point ${afterId} to add after`)
      target.splice(pos, 0, node)
    } else if (op.op === 'remove') {
      const hit = byId.get(String(op.id))
      if (!hit) {
        errors.push(`${at}: no point ${String(op.id)}`)
        continue
      }
      hit.siblings.splice(hit.siblings.indexOf(hit.node), 1)
    } else errors.push(`${at}: op must be set, add, remove or meta`)
  }
  const map: Record<string, string> = {}
  const touched: string[] = []
  numberRaw(copy.points, '', (node, id) => {
    if (node.__prev) map[node.__prev] = id
    if (node.__touched) touched.push(id)
    delete node.__prev
    delete node.__touched
    if (node.points === undefined) delete node.points
  })
  return { raw: errors.length > 0 ? undefined : copy, errors, map, touched }
}
