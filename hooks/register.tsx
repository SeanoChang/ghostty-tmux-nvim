import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInput } from 'claude-code'

import { NW } from './core.js'
import { buildBrief, flatten, isRecord, patchRaw, pngSize, signature, text, toHunk } from './model.ts'
import type { Built } from './model.ts'
import { findPoint, labelOf, pointName, respondMessage, slug, tag, toMarkdown, toolLine } from './helpers.ts'
import { machineSvg } from './svg.ts'
import { COL_GAP, layoutTable, splitTables, type Table } from './table.ts'
import { GUIDE, GUIDE_TOOL, NOTE, NOTE_DESCRIPTION, PATCH, PATCH_DESCRIPTION, REFERENCE, SHOW, SHOW_DESCRIPTION, STATUS, STATUS_DESCRIPTION } from './text.ts'
import type { Brief, BriefAsk, BriefIndexEntry, BriefMode, BriefPoint, CallRow, DecisionEntry, Evidence, Exhibit, MockExhibit, TaskState, TaskStatus, ThreadNote, Tone } from '../types'

const brief = atom({ plugin: 'brief', key: 'brief' } as const, null)
const open = atom({ plugin: 'brief', key: 'open' } as const, [])
const seen = atom({ plugin: 'brief', key: 'seen' } as const, [])
const changed = atom({ plugin: 'brief', key: 'changed' } as const, [])
const answers = atom({ plugin: 'brief', key: 'answers' } as const, {})
const notes = atom({ plugin: 'brief', key: 'notes' } as const, {})
const struck = atom({ plugin: 'brief', key: 'struck' } as const, [])
const machineAt = atom({ plugin: 'brief', key: 'machineAt' } as const, {})
const replyNonce = atom({ plugin: 'brief', key: 'replyNonce' } as const, 0)
const selected = atom({ plugin: 'brief', key: 'selected' } as const, '')
const rowSel = atom({ plugin: 'brief', key: 'rowSel' } as const, '')
const raw = atom({ plugin: 'brief', key: 'raw' } as const, null)
const key = atom({ plugin: 'brief', key: 'key' } as const, '')
const mode = atom({ plugin: 'brief', key: 'mode' } as const, 'on')
const offer = atom({ plugin: 'brief', key: 'offer' } as const, '')
const busy = atom({ plugin: 'brief', key: 'busy' } as const, false)
const log = atom({ plugin: 'brief', key: 'log' } as const, [])
const status = atom({ plugin: 'brief', key: 'status' } as const, {})
const evidence = atom({ plugin: 'brief', key: 'evidence' } as const, {})
const responded = atom({ plugin: 'brief', key: 'responded' } as const, 0)

const PANE = 'brief'

const block = (props: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties: props, required })
const S = { type: 'string' }
const N = { type: 'number' }
const B = { type: 'boolean' }
const pins = { type: 'array', items: block({ line: N, at: S, tone: S, title: S, text: S }, ['title']) }
const mockSchema = block({ html: S, w: N, h: N, frame: S, title: S, pins }, ['html'])

const pointSchema = block(
  {
    claim: S,
    aux: { type: 'string', enum: ['shared', 'scope'] },
    caption: S,
    detail: S,
    code: block({ src: S, lines: S, source: S, language: S, title: S, start: N, diff: B, file: S, pins }),
    schema: block({ language: S, title: S, source: S, diff: B }, ['language', 'source']),
    calls: block({ title: S, source: S }, ['source']),
    flow: block({ source: S, dashed: S }, ['source']),
    seq: block({ source: S }, ['source']),
    machine: block({ source: S, screens: { type: 'object', additionalProperties: mockSchema } }, ['source']),
    tree: block({ source: S }, ['source']),
    table: {
      description: 'A Markdown table string, or {title, columns, rows}.',
      anyOf: [S, block({ title: S, source: S, columns: { type: 'array', items: S }, rows: { type: 'array', items: { type: 'array', items: S } } })],
    },
    mock: mockSchema,
    svg: S,
    svgAlt: S,
    image: block({ path: S, alt: S }, ['path']),
    when: { type: 'string', description: 'Show only under an answer: "2=no" or "2!=no".' },
    ask: block(
      {
        kind: { type: 'string', enum: ['one', 'many', 'text', 'scale', 'rank'] },
        question: S,
        options: {
          type: 'array',
          items: block(
            { value: S, label: S, note: S, detail: S, pros: { type: 'array', items: S }, cons: { type: 'array', items: S }, image: block({ path: S, alt: S }, ['path']), mock: mockSchema, flow: block({ source: S }, ['source']), table: { anyOf: [S, block({ columns: { type: 'array', items: S }, rows: { type: 'array', items: { type: 'array', items: S } } })] }, code: block({ source: S, language: S }) },
            ['value', 'label'],
          ),
        },
        recommended: S,
        min: N,
        max: N,
        then: { type: 'object', additionalProperties: S },
      },
      ['question'],
    ),
    note: block({ tone: S, text: S }, ['text']),
    points: { type: 'array', items: { type: 'object' }, description: 'Child points, the same shape as this one.' },
  },
  ['claim'],
)

const showSchema = block(
  {
    title: S,
    gist: S,
    why: { type: 'array', items: block({ via: S, from: S, text: S, at: S }, ['text']) },
    changes: block({ new: N, changed: N, deleted: N }),
    points: { type: 'array', items: pointSchema },
    terms: { type: 'array', items: block({ term: S, meaning: S }, ['term', 'meaning']) },
    gate: { type: 'boolean', description: 'True when building must wait for the reader to Respond.' },
  },
  ['title', 'gist', 'points'],
)

const noteSchema = block({ point: S, text: S }, ['point', 'text'])



const patchSchema = block(
  {
    ops: {
      type: 'array',
      items: block({ op: { type: 'string', enum: ['set', 'add', 'remove', 'meta'] }, id: S, parent: S, after: S, point: { type: 'object' }, title: S, gist: S, gate: B }, ['op']),
    },
  },
  ['ops'],
)

const statusSchema = block(
  {
    updates: {
      type: 'array',
      items: block(
        {
          point: S,
          state: { type: 'string', enum: ['queued', 'running', 'review', 'done', 'failed', 'blocked'] },
          note: S,
          evidence: block({ title: S, text: S, code: block({ source: S, language: S, diff: B }, ['source']), image: S }),
        },
        ['point', 'state'],
      ),
    },
  },
  ['updates'],
)


/** From html-plan's pack.mjs: file names that hold secrets. Checked on the real path. */
const SECRET_NAME = new RegExp(
  [
    String.raw`(^|[\\/])\.(git|ssh|aws|azure|gnupg|kube|docker|password-store)([\\/]|$)`,
    String.raw`(^|[\\/])(\.env(\.[^\\/]*)?|\.netrc|\.npmrc|\.yarnrc(\.yml)?|\.pypirc|\.pgpass|\.my\.cnf|\.git-credentials|\.htpasswd)$`,
    String.raw`(^|[\\/])(id_(rsa|dsa|ecdsa|ed25519)[^\\/]*|credentials[^\\/]*|secrets?(\.[^\\/]*)?|[^\\/]*_history|[^\\/]*\.local\.json)$`,
    String.raw`\.(pem|key|p12|pfx|keystore|jks|tfvars|tfstate(\.backup)?|sqlite3?|db|kdbx|ovpn)$`,
  ].join('|'),
  'i',
)
/** Claude's scratch folders, where rendered figures live. */
const SCRATCH_ROOTS = ['/private/tmp/claude-', '/tmp/claude-']

/** Resolves a path and answers why it may not be read, or undefined when it may. */
async function fenceCheck($: EngineInterface, path: string): Promise<string | undefined> {
  const st = await $.fs.stat(path, { resolve: true }).catch(() => undefined)
  const real = st && 'realPath' in st ? (st.realPath as string | undefined) : undefined
  if (!real) return undefined // missing: the reader reports "cannot read"
  const cwd = await $.session.cwd()
  const root = await $.fs
    .stat(cwd, { resolve: true })
    .then(r => ('realPath' in r ? (r.realPath as string | undefined) : undefined) ?? cwd)
    .catch(() => cwd)
  if (SECRET_NAME.test(real)) return 'looks like a secrets file; not reading it'
  const inside = real === root || real.startsWith(root.endsWith('/') ? root : `${root}/`) || SCRATCH_ROOTS.some(r => real.startsWith(r))
  if (!inside) return `outside the project (${root}) and the scratch folder; not reading it`
  return undefined
}

async function send($: EngineInterface, id: string, claim: string, message: string) {
  const note: ThreadNote = { from: 'you', text: message }
  await update($, notes, all => ({ ...all, [id]: [...(all[id] ?? []), note] }))
  await deliver($, `${tag(id, claim)} ${message}`)
}

/** To Claude now: into the running turn when one runs (seen at its next step), else as a new turn. */
async function deliver($: EngineInterface, text: string) {
  if (await read($, busy)) {
    const added = await $.session
      .append({ message: { type: 'user', content: [{ type: 'text', text: `${text}\n(sent from the Brief pane while you were working)` }] } })
      .catch(() => ({ deny: 'refused' }))
    if (!('deny' in added && added.deny)) {
      $.ui.toast('Claude sees this at its next step')
      return
    }
  }
  void $.prompt.submit({ text, asUser: true })
  $.ui.toast('Sent to Claude')
}

/** Focuses a point's section and marks the section and everything under it as read. */
async function select($: EngineInterface, id: string) {
  const b = await read($, brief)
  const section = id.split('.')[0] as string
  const under = b ? flatten(b.points.filter(p => p.id === section)).map(p => p.id) : [id]
  await update($, selected, () => id)
  await update($, rowSel, () => '')
  await update($, seen, list => [...new Set([...list, id, ...under])])
  await persist($)
}

type Snapshot = {
  brief: Brief
  raw: unknown
  answers: Record<string, string>
  struck: string[]
  notes: Record<string, ThreadNote[]>
  seen: string[]
  log: DecisionEntry[]
  status: Record<string, TaskStatus>
  evidence: Record<string, Evidence[]>
  responded: number
}

/** Keeps every brief and the reader's answers past the session, by key; "last" reopens at session start. */
async function persist($: EngineInterface) {
  const b = await read($, brief)
  if (!b) return
  const k = (await read($, key)) || slug(b.title)
  const snap: Snapshot = {
    brief: b,
    raw: await read($, raw),
    answers: await read($, answers),
    struck: await read($, struck),
    notes: await read($, notes),
    seen: await read($, seen),
    log: await read($, log),
    status: await read($, status),
    evidence: await read($, evidence),
    responded: await read($, responded),
  }
  const now = await $.clock.now()
  await $.store.set(`brief:${k}`, snap)
  const index = ((await $.store.get('brief:index')) as BriefIndexEntry[] | undefined) ?? []
  const entry: BriefIndexEntry = { key: k, title: b.title, version: b.version, savedAt: now }
  await $.store.set('brief:index', [entry, ...index.filter(x => x.key !== k)].slice(0, 30))
  await $.store.set(`last:${await $.session.cwd()}`, k)
}

/** Loads a saved brief into the pane, or clears the pane for a new one. */
async function load($: EngineInterface, k: string): Promise<boolean> {
  const snap = (await $.store.get(`brief:${k}`)) as Snapshot | undefined
  await update($, key, () => k)
  await update($, brief, () => snap?.brief ?? null)
  await update($, raw, () => snap?.raw ?? null)
  await update($, answers, () => snap?.answers ?? {})
  await update($, struck, () => snap?.struck ?? [])
  await update($, notes, () => snap?.notes ?? {})
  await update($, seen, () => snap?.seen ?? [])
  await update($, log, () => snap?.log ?? [])
  await update($, status, () => snap?.status ?? {})
  await update($, evidence, () => snap?.evidence ?? {})
  await update($, responded, () => snap?.responded ?? 0)
  await update($, changed, () => [])
  await update($, open, () => [])
  await update($, selected, () => '')
  await update($, rowSel, () => '')
  await update($, machineAt, () => ({}))
  return !!snap
}

type ReadText = (path: string) => Promise<string | { refused: string } | undefined>

function readers($: EngineInterface): { readFile: ReadText; readBytes: ReadText } {
  return {
    readFile: async (path: string) => {
      const why = await fenceCheck($, path)
      if (why) return { refused: why }
      try {
        return await $.fs.read(path)
      } catch {
        return undefined
      }
    },
    readBytes: async (path: string) => {
      const why = await fenceCheck($, path)
      if (why) return { refused: why }
      try {
        const got = await $.fs.read(path, { as: 'bytes' })
        return typeof got === 'string' ? undefined : got.base64
      } catch {
        return undefined
      }
    },
  }
}

/**
 * Puts a built brief in the pane. Without a map, state follows ids by position (show);
 * with one (patch), each old id moves to its new id. Changed points lose their answers.
 */
async function apply($: EngineInterface, built: Built, input: unknown, map?: Record<string, string>) {
  const made = built.brief as Omit<Brief, 'version'>
  const k = slug(made.title)
  if (!map && (await read($, key)) !== k) {
    await persist($)
    await load($, k)
  }
  const before = await read($, brief)
  const next: Brief = { ...made, version: (before?.version ?? 0) + 1 }
  const all = flatten(next.points)
  const ids = new Set(all.map(p => p.id))
  const to = (id: string) => (map ? map[id] : ids.has(id) ? id : undefined)
  const old = new Map(flatten(before?.points ?? []).flatMap(p => (to(p.id) ? [[to(p.id) as string, signature(p)]] : [])))
  const diff = before ? all.filter(p => old.get(p.id) !== signature(p)).map(p => p.id) : []
  const keep = (id: string) => ids.has(id) && !diff.includes(id)
  const rowKeys = new Set(all.flatMap(p => (p.exhibit?.kind === 'calls' ? p.exhibit.rows.map(r => r.key) : [])))
  /** Moves a key whose first part is a point id ("2.1", "2.1-r3", "fold:2.1"). */
  const moveKey = (k2: string) => {
    const m = /^(fold:|where:|compare:)?([\w.]+?)(-r\d+)?$/.exec(k2)
    if (!m) return k2
    const id = to(m[2] as string)
    return id ? `${m[1] ?? ''}${id}${m[3] ?? ''}` : undefined
  }
  const moveRecord = <T,>(rec: Record<string, T>, onlyUnchanged: boolean) =>
    Object.fromEntries(
      Object.entries(rec).flatMap(([id, v]) => {
        if (id === 'top') return [[id, v]]
        const n = to(id)
        return n && (!onlyUnchanged || keep(n)) ? [[n, v]] : []
      }),
    ) as Record<string, T>

  await update($, key, () => k)
  await update($, brief, () => next)
  await update($, raw, () => input)
  await update($, changed, () => diff)
  await update($, open, list => list.flatMap(x => (x === 'why' ? [x] : (moveKey(x) ? [moveKey(x) as string] : []))))
  await update($, selected, id => to(id) ?? all[0]?.id ?? '')
  await update($, rowSel, r => (moveKey(r) && rowKeys.has(moveKey(r) as string) ? (moveKey(r) as string) : ''))
  await update($, seen, list => list.flatMap(id => (to(id) && keep(to(id) as string) ? [to(id) as string] : [])))
  await update($, answers, a => moveRecord(a, true))
  await update($, struck, list => list.flatMap(r => (moveKey(r) && rowKeys.has(moveKey(r) as string) && keep((moveKey(r) as string).replace(/-r\d+$/, '')) ? [moveKey(r) as string] : [])))
  await update($, machineAt, a => moveRecord(a, true))
  await update($, notes, a => moveRecord(a, false))
  await update($, status, a => moveRecord(a, false))
  await update($, evidence, a => moveRecord(a, false))
  await persist($)
  const opened = await $.ui.open({ id: PANE, title: next.title })
  const asks = all.filter(p => p.ask).length
  const where = opened.isPlaced === false ? ' The pane is not seated yet; the user can run /brief to open it.' : ''
  const warn = built.warnings.length > 0 ? `\nWarnings (fix if they matter):\n- ${built.warnings.join('\n- ')}` : ''
  return `Brief v${next.version} shown in the Brief pane: ${all.length} points, ${asks} decisions, ${diff.length} changed since the last version.${where}${warn}`
}

// One meaning per color, each a key of the user's Claude Code theme (so light, dark and
// colour-blind themes all hold), and each paired with a glyph. Frames stay dim except the focus.
const FOCUS = 'suggestion' //  ▸ selected, the focused frame
const AMBER = 'warning' //     ◆ to decide
const GREEN = 'success' //     ✓ + done, new
const RED = 'error' //         − ✕ removed, struck, risk
const PURPLE = 'permission' // ● changed since the last version
const CLAUDE = 'claude' //     ✎ written by Claude
const TONE: Record<Tone, string> = { info: FOCUS, warn: AMBER, risk: RED, ok: GREEN, idea: PURPLE }
const TONE_LABEL: Record<Tone, string> = { info: 'NOTE', warn: 'WARNING', risk: 'RISK', ok: 'OK', idea: 'IDEA' }
const MARK: Record<string, { g: string; c?: string }> = {
  '+': { g: '+', c: GREEN },
  '-': { g: '−', c: RED },
  '~': { g: '~', c: AMBER },
  '?': { g: '?' },
  ' ': { g: '·' },
}
const KIND_LABEL: Record<Exhibit['kind'], string> = {
  markdown: 'DETAIL',
  code: 'CODE',
  schema: 'SCHEMA',
  calls: 'CALLS',
  flow: 'FLOW',
  seq: 'SEQUENCE',
  svg: 'DIAGRAM',
  machine: 'STATES',
  tree: 'FILES',
  mock: 'MOCKUP',
  image: 'FIGURE',
  table: 'TABLE',
}

const trunc = (s: string, n: number) => (n <= 1 ? '' : s.length <= n ? s : `${s.slice(0, n - 1)}…`)
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length))
async function renderPane($: EngineInterface, e: RenderInput<'Pane'>): Promise<RenderElement> {
  const els = $.ui.resolve(e)
  const { Box, Text, Button, Markdown, Code } = els
  // Every table carries every name (a missing element draws nothing), so decide by surface.
  const Svg = e.surface !== 'terminal' && 'Svg' in els ? els.Svg : undefined
  const Select = e.surface !== 'mobile' && 'Select' in els ? els.Select : undefined
  const Input = e.surface !== 'mobile' && 'Input' in els ? els.Input : undefined
  const Image = e.surface === 'terminal' && 'Image' in els ? els.Image : undefined
  const cols = Math.max(40, e.props.bodyColumns || 80)
  // Spacing scale. The desktop's rows are short, so it gets more air; the terminal pays a whole row per step.
  const roomy = e.surface !== 'terminal'
  const SP = { page: roomy ? 3 : 1, card: roomy ? 2 : 1, padY: roomy ? 1 : 0, padX: 2, inner: roomy ? 2 : 1 }
  // The desktop draws a Button's hotkey as a badge, so the label leaves the letter out there.
  const hk = (letter: string, label: string) => (roomy ? label : `${letter} ${label}`)
  /** Text width inside a card's body: the frame, its padding and one level of indent. */
  const inside = cols - 10

  const tableView = (t: Table, k: string, width: number) => {
    const L = layoutTable(t, width)
    if (L.mode === 'grid') {
      const wraps = t.rows.some(r => r.some((c, i) => c.length > (L.widths[i] ?? 0)))
      const line = (r: string[], kk: string, isHead: boolean) => (
        <Box key={kk} flexDirection="row" columnGap={COL_GAP}>
          {r.map((c, i) => (
            <Box key={`${kk}-${i}`} width={L.widths[i]} flexShrink={0}>
              <Text bold={isHead || i === 0} dimColor={isHead}>{c}</Text>
            </Box>
          ))}
        </Box>
      )
      const ruleW = L.widths.reduce((a, b) => a + b, 0) + COL_GAP * (L.widths.length - 1)
      return (
        <Box key={k} flexDirection="column" rowGap={wraps ? 1 : 0}>
          <Box flexDirection="column">
            {line(t.head, `${k}-h`, true)}
            {!roomy && <Text dimColor>{'─'.repeat(ruleW)}</Text>}
          </Box>
          {t.rows.map((r, i) => line(r, `${k}-r${i}`, false))}
        </Box>
      )
    }
    return (
      <Box key={k} flexDirection="column" rowGap={1}>
        {t.rows.map((r, i) => (
          <Box key={`${k}-s${i}`} flexDirection="column">
            <Text bold>{`▸ ${r[0] ?? ''}`}</Text>
            {r.slice(1).map((c, j) => (
              <Box key={`${k}-s${i}-${j}`} flexDirection="row" columnGap={2} marginLeft={2}>
                <Box width={L.labelWidth} flexShrink={0}>
                  <Text dimColor>{t.head[j + 1] ?? ''}</Text>
                </Box>
                <Box flexGrow={1} flexShrink={1}>
                  <Text>{c}</Text>
                </Box>
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    )
  }
  /** Markdown, with its tables drawn by tableView in the terminal (whose Markdown lays them out too wide). */
  const md = (text: string, k: string, width = inside) => {
    const parts = roomy ? [] : splitTables(text)
    if (!parts.some(c => c.kind === 'table')) return <Markdown key={k} text={text} />
    return (
      <Box key={k} flexDirection="column" rowGap={1}>
        {parts.map((c, i) => (c.kind === 'md' ? <Markdown key={`${k}-${i}`} text={c.text} /> : tableView(c.table, `${k}-${i}`, width)))}
      </Box>
    )
  }

  const b = await read($, brief)
  if (!b) {
    return (
      <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={2} paddingY={1} gap={1}>
        <Text bold>Brief</Text>
        <Text dimColor>No brief yet. Ask Claude to "brief me on" a plan or an idea, and it shows up here.</Text>
      </Box>
    )
  }

  const openIds = await read($, open)
  const seenIds = await read($, seen)
  const changedIds = await read($, changed)
  const picked = await read($, answers)
  const threads = await read($, notes)
  const struckKeys = await read($, struck)
  const stateAt = await read($, machineAt)
  const nonce = await read($, replyNonce)
  const sel = await read($, selected)
  const row = await read($, rowSel)
  const decisions = await read($, log)
  const tasks = await read($, status)
  const proofs = await read($, evidence)
  const respondedAt = await read($, responded)
  const currentKey = await read($, key)
  const index = (((await $.store.get('brief:index')) as BriefIndexEntry[] | undefined) ?? []).filter(x => x.key !== currentKey)

  const all = flatten(b.points)
  const sections = b.points
  const sectionOf = (id: string) => id.split('.')[0] as string
  const focusId = sections.some(x => x.id === sectionOf(sel)) ? sectionOf(sel) : (sections[0]?.id ?? '')
  const fi = sections.findIndex(x => x.id === focusId)
  const asks = all.filter(p => p.ask)
  const toAnswer = asks.filter(p => picked[p.id] === undefined).length
  const isOpen = (id: string) => openIds.includes(id)
  const toggle = (id: string) => () => update($, open, list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]))
  const setAnswer = async (id: string, value: string) => {
    await update($, answers, a => ({ ...a, [id]: value }))
    const ask = all.find(p => p.id === id)?.ask
    if (ask) {
      const entry: DecisionEntry = { id, question: ask.question, value, label: labelOf(ask, value), suggested: ask.recommended, at: await $.clock.now() }
      await update($, log, l => [...l, entry].slice(-100))
    }
    await persist($)
  }
  /** A point with `when` shows only while its decision (answer, else suggestion) matches. */
  const shows = (p: BriefPoint) => {
    if (!p.when) return true
    const target = all.find(q => q.id === p.when?.id)
    if (!target?.ask) return true
    const values = (picked[target.id] ?? target.ask.recommended).split(',')
    return values.includes(p.when.value) !== p.when.negate
  }
  const hiddenLine = (p: BriefPoint) => {
    const target = all.find(q => q.id === p.when?.id)
    const label = target?.ask ? labelOf(target.ask, p.when?.value ?? '') : p.when?.value
    return (
      <Text key={`hidden-${p.id}`} dimColor italic>
        {`⋯ ${trunc(p.claim, 48)}  (only if ${p.when?.id} ${p.when?.negate ? 'is not' : 'is'} “${label}”)`}
      </Text>
    )
  }
  const TASK: Record<TaskState, { g: string; c?: string; label: string }> = {
    queued: { g: '○', label: 'queued' },
    running: { g: '◐', c: FOCUS, label: 'running' },
    review: { g: '◎', c: AMBER, label: 'needs review' },
    done: { g: '✓', c: GREEN, label: 'done' },
    failed: { g: '✕', c: RED, label: 'failed' },
    blocked: { g: '⏸', c: AMBER, label: 'blocked' },
  }
  const taskChip = (p: BriefPoint, key: string) => {
    const t = tasks[p.id]
    if (!t) return null
    const look = TASK[t.state]
    const unproved = t.state === 'done' && (proofs[p.id] ?? []).length === 0
    return (
      <Text key={`${key}-task`} color={unproved ? AMBER : look.c} dimColor={!look.c && !unproved}>
        {`${look.g} ${look.label}${unproved ? ' · no evidence' : ''}`}
      </Text>
    )
  }
  const sectionName = (p: BriefPoint) => (p.aux === 'shared' ? 'Shared' : p.aux === 'scope' ? 'Not changing' : p.id)
  const jump = (id: string | undefined) => async () => {
    if (!id) return
    await select($, id)
    await update($, open, list => list.filter(x => x !== `fold:${id}`))
    await $.ui.scroll({ to: { key: `fold-${id}` }, in: PANE, block: 'start' }).catch(() => undefined)
  }
  const marks = (p: BriefPoint, key: string) => {
    const under = flatten([p])
    const pending = under.filter(q => q.ask && picked[q.id] === undefined).length
    return [
      pending > 0 ? <Text key={`${key}-m-ask`} color={AMBER}>{`◆ ${pending}`}</Text> : null,
      under.some(q => changedIds.includes(q.id)) ? <Text key={`${key}-m-ch`} color={PURPLE}>●</Text> : null,
      under.some(q => (threads[q.id] ?? []).some(n => n.from === 'claude')) ? <Text key={`${key}-m-note`} color={CLAUDE}>✎</Text> : null,
      taskChip(p, key),
    ].filter(Boolean)
  }

  const svg = (source: string, alt: string, key: string) =>
    Svg ? <Svg key={key} source={source} alt={alt} isInteractive /> : <Text dimColor>[diagram] {alt}</Text>

  // ── exhibits ────────────────────────────────────────────────────────
  const pinList = (list: { line?: number; at?: string; tone?: Tone; title: string; text?: string }[], key: string) =>
    list.map((pin, i) => (
      <Text key={`${key}-pin-${i}`}>
        <Text bold color={TONE[pin.tone ?? 'info']}>{`${pin.line !== undefined ? `L${pin.line}` : `①②③④⑤⑥⑦⑧⑨`[i] ?? String(i + 1)} `}</Text>
        <Text bold>{pin.title}</Text>
        {pin.text ? <Text dimColor>{` · ${pin.text}`}</Text> : null}
      </Text>
    ))

  const mockView = (m: MockExhibit, key: string) => (
    <Box flexDirection="column">
      {m.frame === 'terminal' ? <Code source={m.text ?? ''} language="console" /> : svg(m.svg ?? '', m.title ?? 'mockup', `${key}-mock`)}
      {pinList(m.pins, key)}
    </Box>
  )

  const callsView = (p: BriefPoint, rows: CallRow[]) => {
    const nameW = Math.min(Math.max(...rows.map(r => r.depth * 2 + r.name.length)) + 1, Math.floor(cols * 0.5))
    const chosen = rows.find(r => r.key === row)
    return (
      <Box flexDirection="column">
        {rows.map(r => {
          const isStruck = struckKeys.includes(r.key)
          const m = isStruck ? { g: '✕', c: RED } : (MARK[r.mark] ?? { g: '·' })
          const label = pad(' '.repeat(r.depth * 2) + trunc(r.name, nameW - r.depth * 2 - 1), nameW)
          const isCur = r.key === row
          return (
            <Box key={`row-${r.key}`} flexDirection="row">
              <Text color={m.c} dimColor={!m.c} bold>{`${m.g} `}</Text>
              {isCur ? (
                <Text inverse bold>
                  {label}
                </Text>
              ) : r.mark === ' ' || r.isGap ? (
                <Text dimColor>{label}</Text>
              ) : (
                <Button key={`row-${r.key}`} plain label={label} dimColor={isStruck} onPress={() => update($, rowSel, () => r.key)} />
              )}
              <Text dimColor wrap="truncate-end">{` ${r.loc}${r.note ? `  — ${r.note}` : ''}`}</Text>
            </Box>
          )
        })}
        {chosen ? (
          <Box flexDirection="column" marginTop={1}>
            <Box flexDirection="row" gap={1} flexWrap="wrap">
              <Text color={FOCUS} bold>{`› ${chosen.name}`}</Text>
              {chosen.excerpt && <Button key="row-code" hotkey="c" label={hk('c', isOpen(chosen.key) ? 'hide code' : 'code')} onPress={toggle(chosen.key)} />}
              <Button
                key="row-strike"
                hotkey="x"
                label={hk('x', struckKeys.includes(chosen.key) ? 'restore' : 'strike')}
                onPress={async () => {
                  const at = rows.indexOf(chosen)
                  const end = rows.findIndex((q, i) => i > at && q.depth <= chosen.depth)
                  const keys = rows.slice(at, end === -1 ? rows.length : end).map(q => q.key)
                  const isOn = struckKeys.includes(chosen.key)
                  await update($, struck, list => (isOn ? list.filter(k => !keys.includes(k)) : [...new Set([...list, ...keys])]))
                  await persist($)
                }}
              />
              <Button
                key="row-ask"
                hotkey="a"
                label={hk('a', 'ask')}
                onPress={() => void $.prompt.fill({ text: `[brief ${p.id} · calls › ${chosen.name}${chosen.loc ? ` @ ${chosen.loc}` : ''}] `, mode: 'insert' })}
              />
            </Box>
            {isOpen(chosen.key) && chosen.excerpt && (
              <Code source={chosen.excerpt.source} path={chosen.excerpt.path} startLine={chosen.excerpt.startLine} language={chosen.excerpt.language} />
            )}
          </Box>
        ) : (
          <Text dimColor>Select a marked row to see its code, strike it or ask about it.</Text>
        )}
      </Box>
    )
  }

  const machineView = (p: BriefPoint, source: string, screens: Record<string, MockExhibit>) => {
    const m = NW.parseMachine(source)
    const L = NW.layoutMachine(m)
    const at = stateAt[p.id] && m.states[stateAt[p.id] as string] ? (stateAt[p.id] as string) : m.initial
    const st = m.states[at]
    const outs = m.events.filter(ev => ev.from === at)
    const screen = screens[at]
    return (
      <Box flexDirection="column" gap={1}>
        {svg(machineSvg(m, L, at), `State machine ${m.name}; ${at} is lit.`, `${p.id}-machine`)}
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          {m.order.map(id => (
            <Button
              key={`${p.id}-st-${id}`}
              variant={id === at ? 'primary' : 'secondary'}
              label={`${id === at ? '●' : '○'} ${m.states[id]?.label ?? id}`}
              onPress={() => update($, machineAt, s => ({ ...s, [p.id]: id }))}
            />
          ))}
        </Box>
        <Box flexDirection="column" borderStyle="single" borderDimColor paddingX={1}>
          <Text>
            <Text bold color={FOCUS}>{st?.label ?? at}</Text>
            {st?.final ? <Text dimColor> · final</Text> : null}
            {st?.bind.say ? <Text>{`  ${st.bind.say}`}</Text> : null}
          </Text>
          {outs.length > 0 && <Text dimColor>{outs.map(ev => `${ev.ev} → ${m.states[ev.to]?.label ?? ev.to}${ev.label ? ` (${ev.label})` : ''}`).join('   ')}</Text>}
          {screen && mockView(screen, `${p.id}-screen-${at}`)}
        </Box>
      </Box>
    )
  }

  const exhibitBody = (p: BriefPoint, x: Exhibit): RenderElement => {
    switch (x.kind) {
      case 'markdown':
        return md(x.text, `${p.id}-md`)
      case 'table':
        return tableView(x, `${p.id}-table`, inside)
      case 'code':
        return (
          <Box flexDirection="column">
            <Code source={x.source} language={x.language} path={x.path} startLine={x.startLine} format={x.isDiff ? 'diff' : 'source'} />
            {pinList(x.pins, `${p.id}-code`)}
          </Box>
        )
      case 'schema':
        return <Code source={x.source} language={x.language} format={x.isDiff ? 'diff' : 'source'} />
      case 'calls':
        return callsView(p, x.rows)
      case 'flow':
      case 'seq':
      case 'svg':
        return (
          <Box flexDirection="column">
            {svg(x.svg, x.legend ?? p.claim, `${p.id}-svg`)}
            {x.legend && <Text dimColor italic>{x.legend}</Text>}
          </Box>
        )
      case 'machine':
        return machineView(p, x.source, x.screens)
      case 'tree':
        return (
          <Box flexDirection="column">
            {x.rows.map((r, i) => {
              const guide = r.last.slice(0, r.depth).map(l => (l ? '   ' : '│  ')).join('') + (r.depth > 0 ? (r.last[r.depth] ? '└─ ' : '├─ ') : '')
              const mark = r.mark === 'new' ? '+ ' : r.mark === 'gone' ? '− ' : r.mark === 'mod' ? '~ ' : ''
              const c = r.mark === 'new' ? GREEN : r.mark === 'gone' ? RED : r.mark === 'mod' ? AMBER : undefined
              return (
                <Text key={`${p.id}-tree-${i}`}>
                  <Text dimColor>{guide}</Text>
                  <Text color={c} strikethrough={r.mark === 'gone'}>{`${mark}${r.name}`}</Text>
                  {r.note ? <Text dimColor>{`  # ${r.note}`}</Text> : null}
                </Text>
              )
            })}
          </Box>
        )
      case 'mock':
        return mockView(x, p.id)
      case 'image': {
        // Terminal: the native Image (kitty graphics in Ghostty). Desktop: the PNG inside an SVG <image>.
        if (Image) {
          const columns = Math.max(20, Math.min(cols - 8, Math.ceil(x.width / 8)))
          const rows = Math.max(4, Math.round((columns * x.height) / x.width / 2))
          return <Image key={`${p.id}-img`} source={{ png: x.png }} columns={columns} rows={rows} alt={x.alt} />
        }
        const wrapped = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x.width} ${x.height}" width="${x.width}" height="${x.height}"><image href="data:image/png;base64,${x.png}" width="${x.width}" height="${x.height}"/></svg>`
        return Svg ? <Svg key={`${p.id}-img`} source={wrapped} alt={x.alt} /> : <Text dimColor>[figure] {x.alt}</Text>
      }
    }
  }

  const exhibitTitle = (x: Exhibit) => {
    const name = 'title' in x && x.title ? ` · ${x.title}` : ''
    const extra = x.kind === 'code' && x.path && !name ? ` · ${x.path}` : ''
    return `${KIND_LABEL[x.kind]}${name}${extra}`
  }

  const exhibitBlock = (p: BriefPoint) => {
    const x = p.exhibit
    if (!x) return null
    const showLabel = x.kind !== 'markdown' && x.kind !== 'mock'
    return (
      <Box flexDirection="column">
        {showLabel && (
          <Box flexDirection="row" columnGap={2}>
            <Text dimColor>{exhibitTitle(x)}</Text>
            {x.kind === 'schema' && (
              <Button
                key={`${p.id}-schema-edit`}
                plain
                dimColor
                label="edit ↗"
                onPress={() =>
                  void $.prompt.fill({
                    text: `[brief ${p.id} · schema edit] Change it to:\n\`\`\`${x.language}\n${x.source.replace(/^@@.*\n/, '').replace(/^[+ ]/gm, '').replace(/^-.*\n?/gm, '')}\n\`\`\`\n`,
                    mode: 'insert',
                  })
                }
              />
            )}
          </Box>
        )}
        {exhibitBody(p, x)}
      </Box>
    )
  }

  // ── decision ────────────────────────────────────────────────────────
  const decision = (p: BriefPoint) => {
    const ask = p.ask as BriefAsk
    const pick = picked[p.id]
    const value = pick ?? ask.recommended
    const values = value.split(',').filter(Boolean)
    const rec = (v: string) => (ask.recommended.split(',').includes(v) ? '  ★ suggested' : '')
    let control: RenderElement
    const rich = ask.kind !== 'scale' && ask.kind !== 'text' && ask.options.some(o => o.detail || o.pros || o.cons || o.exhibit)
    const comparing = isOpen(`compare:${p.id}`)
    if (rich && comparing) {
      // Side by side: one column per option, the trade-offs aligned.
      control = (
        <Box flexDirection={cols >= 100 ? 'row' : 'column'} columnGap={1} rowGap={1}>
          {ask.options.map(o => (
            <Box key={`cmp-${p.id}-${o.value}`} flexDirection="column" flexGrow={1} borderStyle="single" borderColor={values.includes(o.value) ? GREEN : undefined} borderDimColor={!values.includes(o.value)} paddingX={1}>
              <Text bold>{`${o.label}${rec(o.value)}`}</Text>
              {(o.pros ?? []).map((x, i) => <Text key={`cmp-${p.id}-${o.value}-p${i}`} color={GREEN}>{`+ ${x}`}</Text>)}
              {(o.cons ?? []).map((x, i) => <Text key={`cmp-${p.id}-${o.value}-c${i}`} color={RED}>{`− ${x}`}</Text>)}
            </Box>
          ))}
        </Box>
      )
    } else if (rich) {
      control = (
        <Box flexDirection="column" rowGap={SP.inner}>
          {ask.options.map(o => {
            const isPicked = values.includes(o.value)
            const nextValue = ask.kind === 'one' ? o.value : (isPicked ? values.filter(v => v !== o.value) : [...values, o.value]).join(',')
            const box = ask.kind === 'one' ? (isPicked ? '◉' : '○') : isPicked ? '☑' : '☐'
            const fake: BriefPoint = { id: `${p.id}~${o.value}`, claim: o.label, exhibit: o.exhibit, points: [] }
            return (
              <Box key={`opt-${p.id}-${o.value}`} flexDirection="column" borderStyle="round" borderColor={isPicked ? GREEN : undefined} borderDimColor={!isPicked} paddingX={SP.padX} paddingY={SP.padY} rowGap={roomy ? 1 : 0}>
                <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
                  <Button key={`ask-${p.id}-${o.value}`} plain label={`${box} ${o.label}${rec(o.value)}`} onPress={() => setAnswer(p.id, nextValue)} />
                  <Button
                    key={`ask-${p.id}-explore-${o.value}`}
                    plain
                    dimColor
                    label="explore ↗"
                    onPress={() =>
                      send($, p.id, p.claim, `Explore option “${o.label}” for “${ask.question}”: what it takes, its risks, and what changes elsewhere. Add it under point ${p.id} with patch.`)
                    }
                  />
                </Box>
                {o.detail && md(o.detail, `opt-${p.id}-${o.value}-detail`, inside - 4)}
                {(o.pros ?? []).map((x, i) => <Text key={`opt-${p.id}-${o.value}-p${i}`} color={GREEN}>{`+ ${x}`}</Text>)}
                {(o.cons ?? []).map((x, i) => <Text key={`opt-${p.id}-${o.value}-c${i}`} color={RED}>{`− ${x}`}</Text>)}
                {o.note && <Text dimColor>{o.note}</Text>}
                {o.exhibit && exhibitBlock(fake)}
              </Box>
            )
          })}
        </Box>
      )
    } else if ((ask.kind === 'one' || ask.kind === 'scale') && Select) {
      const options =
        ask.kind === 'scale'
          ? Array.from({ length: (ask.max ?? 10) - (ask.min ?? 0) + 1 }, (_, i) => String((ask.min ?? 0) + i)).map(v => ({ value: v, label: `${v}${rec(v)}` }))
          : ask.options.map(o => ({ value: o.value, label: `${o.label}${rec(o.value)}${o.note ? `  · ${o.note}` : ''}` }))
      control = <Select key={`ask-${p.id}`} value={value} options={options} onSelect={v => setAnswer(p.id, v)} />
    } else if (ask.kind === 'one' || ask.kind === 'many') {
      control = (
        <Box flexDirection="column">
          {ask.options.map(o => {
            const isPicked = values.includes(o.value)
            const nextValue = ask.kind === 'one' ? o.value : (isPicked ? values.filter(v => v !== o.value) : [...values, o.value]).join(',')
            const box = ask.kind === 'one' ? (isPicked ? '◉' : '○') : isPicked ? '☑' : '☐'
            return <Button key={`ask-${p.id}-${o.value}`} plain label={`${box} ${o.label}${rec(o.value)}${o.note ? `  · ${o.note}` : ''}`} onPress={() => setAnswer(p.id, nextValue)} />
          })}
        </Box>
      )
    } else if (ask.kind === 'rank') {
      const order = values.length === ask.options.length ? values : ask.options.map(o => o.value)
      control = (
        <Box flexDirection="column">
          {order.map((v, i) => (
            <Box key={`rank-${p.id}-${v}`} flexDirection="row" gap={1}>
              <Text>{`${i + 1}. ${labelOf(ask, v)}`}</Text>
              {i > 0 && (
                <Button
                  key={`ask-${p.id}-up-${v}`}
                  plain
                  label="↑"
                  onPress={() => {
                    const nextOrder = [...order]
                    nextOrder.splice(i - 1, 2, order[i] as string, order[i - 1] as string)
                    return setAnswer(p.id, nextOrder.join(','))
                  }}
                />
              )}
            </Box>
          ))}
        </Box>
      )
    } else if (Input) {
      control = <Input key={`ask-${p.id}-${nonce}`} placeholder={value || 'Type your answer'} submitLabel="Set" onSubmit={v => setAnswer(p.id, v.trim())} />
    } else {
      control = <Text>{labelOf(ask, value)}</Text>
    }
    const color = pick === undefined ? AMBER : GREEN
    const consequence = ask.then[value]
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={SP.padX} paddingY={SP.padY} rowGap={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={color}>
            {pick === undefined ? '◆ DECIDE' : '✓ DECIDED'}
          </Text>
          <Text dimColor>{pick === undefined ? 'suggestion stands until you pick' : pick === ask.recommended ? 'kept the suggestion' : 'changed'}</Text>
        </Box>
        <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
          <Text bold>{ask.question}</Text>
          {rich && <Button key={`compare-${p.id}`} plain dimColor label={comparing ? '▾ cards' : '⇆ compare'} onPress={toggle(`compare:${p.id}`)} />}
        </Box>
        {control}
        {(ask.kind === 'text' || ask.kind === 'scale') && <Text dimColor>{`★ suggested: ${ask.recommended}`}</Text>}
        {consequence && <Text color={AMBER}>{`⚠ then: ${consequence}`}</Text>}
      </Box>
    )
  }

  // ── detail ──────────────────────────────────────────────────────────
  const thread = (id: string) =>
    (threads[id] ?? []).map((n, i) => (
      <Box key={`note-${id}-${i}`} flexDirection="column" paddingX={1} paddingY={SP.padY} borderStyle="single" borderColor={n.from === 'claude' ? CLAUDE : undefined} borderDimColor={n.from === 'you'}>
        <Text bold color={n.from === 'claude' ? CLAUDE : undefined} dimColor={n.from === 'you'}>
          {n.from === 'claude' ? '✎ CLAUDE' : '› YOU'}
        </Text>
        {md(n.text, `note-${id}-${i}-text`)}
      </Box>
    ))

  const askRow = (id: string, claim: string, keys: boolean, withInput: boolean) => (
    <Box flexDirection="column" rowGap={1}>
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">
        <Text dimColor>{`ask about ${id === 'top' ? 'the brief' : id}`}</Text>
        <Button key={`simpler-${id}`} plain hotkey={keys ? 's' : undefined} label={keys ? hk('s', 'simpler') : 'simpler'} onPress={() => send($, id, claim, 'Explain this more simply, in plain words.')} />
        <Button key={`example-${id}`} plain hotkey={keys ? 'e' : undefined} label={keys ? hk('e', 'example') : 'example'} onPress={() => send($, id, claim, 'Give me one concrete example of this.')} />
        <Button key={`why-${id}`} plain hotkey={keys ? 'w' : undefined} label={keys ? hk('w', 'why?') : 'why?'} onPress={() => send($, id, claim, 'Why is this true? What would break if it were not?')} />
        <Button key={`quote-${id}`} plain hotkey={keys ? 'q' : undefined} label={keys ? hk('q', 'quote ↗') : 'quote ↗'} onPress={() => void $.prompt.fill({ text: `${tag(id, claim)} `, mode: 'insert' })} />
      </Box>
      {Input && withInput && (
        <Input
          key={`reply-${id}-${nonce}`}
          placeholder={id === 'top' ? 'Ask Claude about the whole brief…' : `Ask Claude about ${id}…`}
          submitLabel="Send"
          onSubmit={async value => {
            if (value.trim() === '') return
            await send($, id, claim, value.trim())
            await update($, replyNonce, n => n + 1)
          }}
        />
      )}
    </Box>
  )

  /** What a point holds below its claim: exhibit, caption, note, decision, Claude's thread. */
  const body = (p: BriefPoint) => [
    exhibitBlock(p),
    p.caption ? <Text key={`${p.id}-cap`} dimColor italic>{`↳ ${p.caption}`}</Text> : null,
    p.note ? (
      <Box key={`${p.id}-note`} flexDirection="column" paddingX={1} paddingY={SP.padY} borderStyle="single" borderColor={TONE[p.note.tone]}>
        <Text bold color={TONE[p.note.tone]}>{TONE_LABEL[p.note.tone]}</Text>
        {md(p.note.text, `${p.id}-note-text`)}
      </Box>
    ) : null,
    p.ask ? decision(p) : null,
    evidenceBlock(p),
    ...thread(p.id),
  ].filter(Boolean)

  /** The proof attached to a point, newest last. */
  function evidenceBlock(p: BriefPoint) {
    const list = proofs[p.id] ?? []
    const t = tasks[p.id]
    if (list.length === 0 && !t?.note) return null
    return (
      <Box key={`${p.id}-evidence`} flexDirection="column" paddingX={1} paddingY={SP.padY} borderStyle="single" borderColor={t?.state === 'failed' ? RED : GREEN} borderDimColor={!t}>
        <Text bold color={t?.state === 'failed' ? RED : GREEN}>{`EVIDENCE${t ? ` · ${TASK[t.state].label}` : ''}${t?.agent ? ` · ${t.agent}` : ''}`}</Text>
        {t?.note && md(t.note, `${p.id}-ev-note`)}
        {list.map((ev, i) => (
          <Box key={`${p.id}-ev-${i}`} flexDirection="column">
            {ev.title && <Text dimColor>{ev.title}</Text>}
            {ev.kind === 'text' && md(ev.text, `${p.id}-ev-${i}-text`)}
            {ev.kind === 'code' && <Code source={ev.source} language={ev.language} format={ev.isDiff ? 'diff' : 'source'} />}
            {ev.kind === 'image' && exhibitBody(p, { kind: 'image', png: ev.png, width: ev.width, height: ev.height, path: ev.path, alt: ev.title ?? 'evidence' })}
          </Box>
        ))}
      </Box>
    )
  }

  // Level 3 ("where"): one line that opens in place.
  const whereLine = (c: BriefPoint) => {
    if (!shows(c)) return hiddenLine(c)
    const k = `where:${c.id}`
    return (
      <Box key={`where-${c.id}`} flexDirection="column">
        <Box flexDirection="row" columnGap={1}>
          <Button key={`where-${c.id}`} plain dimColor={!isOpen(k)} label={`${isOpen(k) ? '▾' : '▸'} ${c.claim}`} onPress={toggle(k)} />
          {marks(c, `where-${c.id}`)}
        </Box>
        {isOpen(k) && (
          <Box flexDirection="column" marginLeft={2} marginTop={SP.padY} gap={SP.inner}>
            {body(c)}
          </Box>
        )}
      </Box>
    )
  }

  // Level 2 ("how"): a paragraph inside its section, always shown.
  const childBlock = (c: BriefPoint) => !shows(c) ? hiddenLine(c) : (
    <Box key={`child-${c.id}`} flexDirection="column" gap={1} marginTop={SP.padY}>
      <Box flexDirection="row" columnGap={1}>
        <Text bold>{`› ${c.claim}`}</Text>
        {marks(c, `child-${c.id}`)}
        <Button key={`ask-${c.id}-quote`} plain dimColor label="ask ↗" onPress={() => void $.prompt.fill({ text: `${tag(c.id, c.claim)} `, mode: 'insert' })} />
      </Box>
      <Box flexDirection="column" marginLeft={2} gap={SP.inner}>
        {body(c)}
        {c.points.map(whereLine)}
      </Box>
    </Box>
  )

  // Level 1: one card per section; the focused card is the only coloured frame.
  const card = (p: BriefPoint) => {
    if (!shows(p)) return hiddenLine(p)
    const isFocus = p.id === focusId
    const folded = isOpen(`fold:${p.id}`)
    return (
      <Box key={`sec-${p.id}`} flexDirection="column" borderStyle="round" borderColor={isFocus ? FOCUS : undefined} borderDimColor={!isFocus} paddingX={SP.padX} paddingY={SP.padY} gap={SP.card}>
        <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
          <Button
            key={`fold-${p.id}`}
            plain
            label={`${folded ? '▸' : '▾'} ${sectionName(p)}  ${p.claim}`}
            onPress={async () => {
              if (isFocus) await toggle(`fold:${p.id}`)()
              else await jump(p.id)()
            }}
          />
          <Box flexDirection="row" columnGap={1}>
            {marks(p, `sec-${p.id}`)}
          </Box>
        </Box>
        {!folded && [...body(p), ...p.points.map(childBlock), askRow(p.id, p.claim, isFocus, isFocus)]}
      </Box>
    )
  }

  /** Build progress across every point with a status. */
  function buildLine() {
    const states = Object.values(tasks).map(t => t.state)
    const done = states.filter(x => x === 'done').length
    const w = 12
    const f = Math.round((done / states.length) * w)
    const n = (st: TaskState) => states.filter(x => x === st).length
    return (
      <Text>
        <Text dimColor>build </Text>
        <Text color={GREEN}>{'▰'.repeat(f)}</Text>
        <Text dimColor>{'▱'.repeat(w - f)}</Text>
        <Text dimColor>{` ${done}/${states.length} done`}</Text>
        {n('running') > 0 ? <Text color={FOCUS}>{` · ◐ ${n('running')} running`}</Text> : null}
        {n('review') > 0 ? <Text color={AMBER}>{` · ◎ ${n('review')} to review`}</Text> : null}
        {n('failed') > 0 ? <Text color={RED}>{` · ✕ ${n('failed')} failed`}</Text> : null}
        {n('blocked') > 0 ? <Text color={AMBER}>{` · ⏸ ${n('blocked')} blocked`}</Text> : null}
      </Text>
    )
  }

  // ── header ──────────────────────────────────────────────────────────
  const ch = b.changes
  const files = (ch?.new ?? 0) + (ch?.changed ?? 0) + (ch?.deleted ?? 0)
  const why = b.why ?? []
  const header = (
    <Box key="header" flexDirection="column" paddingX={1} gap={1}>
      <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <Text bold>{b.title}</Text>
        <Text>
          <Text dimColor>{`v${b.version}${files > 0 ? ` · ${files} files` : ''}`}</Text>
          {ch?.new ? <Text color={GREEN}>{` +${ch.new}`}</Text> : null}
          {ch?.changed ? <Text color={AMBER}>{` ~${ch.changed}`}</Text> : null}
          {ch?.deleted ? <Text color={RED}>{` −${ch.deleted}`}</Text> : null}
        </Text>
      </Box>
      {md(b.gist, 'gist', cols - 2)}
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={2} flexWrap="wrap">
        <Box flexDirection="row" columnGap={2}>
          {asks.length > 0 && <Text color={toAnswer > 0 ? AMBER : GREEN}>{toAnswer > 0 ? `◆ ${toAnswer} of ${asks.length} decisions open` : `✓ all ${asks.length} decided`}</Text>}
          {changedIds.length > 0 && <Text color={PURPLE}>{`● ${changedIds.length} changed`}</Text>}
          {b.gate && respondedAt < b.version && <Text color={AMBER}>⏸ building waits for Respond</Text>}
          {b.gate && respondedAt >= b.version && <Text color={GREEN}>▶ cleared to build</Text>}
        </Box>
        <Button
          key="respond"
          variant="primary"
          hotkey="r"
          label={hk('r', 'Respond')}
          onPress={async () => {
            const message = respondMessage(b, picked, struckKeys, seenIds)
            // Responding accepts every suggestion still standing, so those decisions are no longer open.
            const now = await $.clock.now()
            const kept = asks.filter(p => picked[p.id] === undefined)
            await update($, answers, a => ({ ...a, ...Object.fromEntries(kept.map(p => [p.id, (p.ask as BriefAsk).recommended])) }))
            await update($, log, l => [
              ...l,
              ...kept.map(p => {
                const ask = p.ask as BriefAsk
                return { id: p.id, question: ask.question, value: ask.recommended, label: labelOf(ask, ask.recommended), suggested: ask.recommended, at: now }
              }),
            ].slice(-100))
            await update($, responded, () => b.version)
            await persist($)
            await deliver($, message)
          }}
        />
      </Box>
      {Object.keys(tasks).length > 0 && buildLine()}
      {index.length > 0 && (
        <Box flexDirection="column">
          <Button key="open-briefs" plain dimColor label={`${isOpen('briefs') ? '▾' : '▸'} other briefs · ${index.length}`} onPress={toggle('briefs')} />
          {isOpen('briefs') &&
            index.slice(0, 10).map(x => (
              <Button
                key={`brief-${x.key}`}
                plain
                label={`  ${x.title}  · v${x.version}`}
                onPress={async () => {
                  await persist($)
                  await load($, x.key)
                  await $.ui.open({ id: PANE, title: x.title })
                }}
              />
            ))}
        </Box>
      )}
      {why.length > 0 && (
        <Box flexDirection="column">
          <Button key="open-why" plain dimColor label={`${isOpen('why') ? '▾' : '▸'} why · ${why.length} ${why.length === 1 ? 'request' : 'requests'}`} onPress={toggle('why')} />
          {isOpen('why') &&
            why.map((q, i) => (
              <Box key={`why-${i}`} flexDirection="column" marginLeft={2}>
                <Text dimColor>{`${q.from} · ${q.via}${q.at ? ` · ${q.at}` : ''}`}</Text>
                <Markdown text={q.text.replace(/^/gm, '> ')} />
              </Box>
            ))}
        </Box>
      )}
    </Box>
  )

  // Contents: one line per section, the focused one marked; a line jumps to its section.
  const toc = (
    <Box key="toc" flexDirection="column" paddingX={1}>
      {sections.map(x => {
        const label = `${pad(sectionName(x), 3)}${trunc(x.claim.replace(/[.。]$/, ''), cols - 12)}`
        return x.id === focusId ? (
          <Text key={`toc-on-${x.id}`} bold color={FOCUS}>{`▸ ${label}`}</Text>
        ) : (
          <Button key={`toc-${x.id}`} plain dimColor label={`  ${label}`} onPress={jump(x.id)} />
        )
      })}
    </Box>
  )

  const endCards = [
    b.terms.length > 0 ? (
      <Box key="terms" flexDirection="column" borderStyle="round" borderDimColor paddingX={SP.padX} paddingY={SP.padY}>
        <Text bold dimColor>Terms</Text>
        {b.terms.map(t => (
          <Text key={`term-${t.term}`}>
            <Text bold>{t.term}</Text>
            <Text dimColor>{`  ${t.meaning}`}</Text>
          </Text>
        ))}
      </Box>
    ) : null,
    decisions.length > 0 ? (
      <Box key="log" flexDirection="column" borderStyle="round" borderDimColor paddingX={SP.padX} paddingY={SP.padY}>
        <Button key="open-log" plain dimColor label={`${isOpen('log') ? '▾' : '▸'} Decision log · ${decisions.length}`} onPress={toggle('log')} />
        {isOpen('log') &&
          decisions.slice(-20).map((d, i) => (
            <Text key={`log-${i}`}>
              <Text dimColor>{`${new Date(d.at).toISOString().slice(11, 16)}  [${d.id}] `}</Text>
              <Text>{`${trunc(d.question, 40)} → `}</Text>
              <Text bold color={d.value === d.suggested ? undefined : PURPLE}>{d.label}</Text>
              {d.value !== d.suggested ? <Text dimColor> (changed)</Text> : null}
            </Text>
          ))}
      </Box>
    ) : null,
    <Box key="top" flexDirection="column" borderStyle="round" borderDimColor paddingX={SP.padX} paddingY={SP.padY} gap={1}>
      <Text bold dimColor>The whole brief</Text>
      {thread('top')}
      {askRow('top', b.title, false, true)}
    </Box>,
  ]

  const footer = (
    <Box key="footer" flexDirection="row" columnGap={3} paddingX={1} flexWrap="wrap">
      <Button key="nav-next" plain dimColor hotkey="j" label={hk('j', 'next section')} onPress={jump(sections[fi + 1]?.id)} />
      <Button key="nav-prev" plain dimColor hotkey="k" label={hk('k', 'previous')} onPress={jump(sections[fi - 1]?.id)} />
      <Text dimColor>{roomy ? 'click a title to fold' : 'click a title to fold · r respond'}</Text>
    </Box>
  )

  return (
    <Box flexDirection="column" gap={SP.page} paddingY={SP.padY}>
      {header}
      {toc}
      {sections.map(card)}
      {endCards}
      {footer}
    </Box>
  )
}

/** True when an answer is long enough that reading it as a brief would help. */
const isLong = (answer: string) => {
  const lines = answer.split('\n').length
  const heads = (answer.match(/^#{1,4} /gm) ?? []).length
  return lines >= 40 || heads >= 3 || answer.length >= 3000
}

const COMMAND_HELP = 'Usage: /brief · /brief auto on|suggest|off · /brief list · /brief open <number or title> · /brief save'

export const register: Register = on => {
  let shownThisTurn = false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'brief', description: 'Open the Brief pane (auto · list · open · save)', argumentHint: '[auto on|suggest|off · list · open <n> · save]' })
    await $.tool.register({ name: 'guide', description: 'The Brief pane block reference: every exhibit\'s syntax, the ask format and the writing rules. Call it once per session before your first show.', inputSchema: { type: 'object', properties: {} } })
    await $.tool.register({ name: 'show', description: SHOW_DESCRIPTION, inputSchema: showSchema })
    await $.tool.register({ name: 'patch', description: PATCH_DESCRIPTION, inputSchema: patchSchema })
    await $.tool.register({ name: 'note', description: NOTE_DESCRIPTION, inputSchema: noteSchema })
    await $.tool.register({ name: 'status', description: STATUS_DESCRIPTION, inputSchema: statusSchema })
    const saved = (await $.store.get('mode')) as BriefMode | undefined
    if (saved === 'on' || saved === 'suggest' || saved === 'off') await update($, mode, () => saved)
    // A new session starts empty: bring back the last brief and the reader's answers.
    if (!(await read($, brief))) {
      const last = await $.store.get(`last:${await $.session.cwd()}`)
      if (typeof last === 'string') await load($, last)
    }
    return next(e)
  })

  // The pane is the default without a cue: a short section of the system prompt says when to use it.
  on('prompt.compose', async ($, e, next) => {
    const res = await next(e)
    const m = await read($, mode)
    if (m === 'off') return res
    return { ...res, sections: [...res.sections, { id: 'brief:guide', text: GUIDE[m], scope: 'session' as const }] }
  })

  on('command.run', { command: 'brief' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/).filter(Boolean)
    const arg = rest.join(' ')
    if (verb === 'auto') {
      if (arg !== 'on' && arg !== 'suggest' && arg !== 'off') return { text: `Brief auto mode is ${await read($, mode)}. ${COMMAND_HELP}` }
      await update($, mode, () => arg)
      await $.store.set('mode', arg)
      const say = { on: 'Claude uses the Brief pane on its own for plans, designs and walkthroughs.', suggest: 'Claude uses the pane when asked; long answers offer "open as brief".', off: 'The pane is used only when you ask.' }
      return { text: `Brief auto mode: ${arg}. ${say[arg]}` }
    }
    if (verb === 'list') {
      const index = ((await $.store.get('brief:index')) as BriefIndexEntry[] | undefined) ?? []
      if (index.length === 0) return { text: 'No saved briefs yet.' }
      return { text: index.map((x, i) => `${i + 1}. ${x.title} · v${x.version} · ${new Date(x.savedAt).toISOString().slice(0, 16).replace('T', ' ')}`).join('\n') }
    }
    if (verb === 'open') {
      const index = ((await $.store.get('brief:index')) as BriefIndexEntry[] | undefined) ?? []
      const n = Number(arg)
      const hit = Number.isInteger(n) && n >= 1 ? index[n - 1] : index.find(x => x.key === slug(arg) || x.title.toLowerCase().includes(arg.toLowerCase()))
      if (!hit) return { text: `No saved brief matches "${arg}". Try /brief list.` }
      await persist($)
      await load($, hit.key)
      await $.ui.open({ id: PANE, title: hit.title, focus: true })
      return { text: `Opened brief: ${hit.title} (v${hit.version}).` }
    }
    if (verb === 'save') {
      const b = await read($, brief)
      if (!b) return { text: 'No brief to save.' }
      const path = `docs/briefs/${(await read($, key)) || slug(b.title)}.md`
      await $.fs.write(path, toMarkdown(b, await read($, answers), await read($, status), await read($, log)))
      return { text: `Saved the brief to ${path}.` }
    }
    if (verb !== '') return { text: COMMAND_HELP }
    const b = await read($, brief)
    await $.ui.open({ id: PANE, title: b?.title ?? 'Brief', focus: true })
    return { text: b ? `Brief pane opened: ${b.title}.` : 'Brief pane opened. It is empty until Claude shows a brief.' }
  })

  on('tool.call', { tool: GUIDE_TOOL }, () => ({ result: REFERENCE }))

  on('tool.call', { tool: SHOW }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const { readFile, readBytes } = readers($)
    const built = await buildBrief(input, readFile, readBytes)
    if (!built.brief) {
      const warn = built.warnings.length > 0 ? `\nAlso:\n- ${built.warnings.join('\n- ')}` : ''
      return { deny: `The brief was not shown. Fix these and call show again:\n- ${built.errors.join('\n- ')}${warn}` }
    }
    shownThisTurn = true
    const { tool: _tool, tool_use_id: _id, consent: _consent, ...clean } = input
    return { result: await apply($, built, clean) }
  })

  on('tool.call', { tool: PATCH }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const current = await read($, raw)
    if (!isRecord(current)) return { deny: 'No brief to patch. Call show first.' }
    const patched = patchRaw(current, input.ops)
    if (!patched.raw) return { deny: `The patch was not applied:\n- ${patched.errors.join('\n- ')}` }
    const { readFile, readBytes } = readers($)
    const built = await buildBrief(patched.raw, readFile, readBytes)
    if (!built.brief) return { deny: `The patched brief does not hold together:\n- ${built.errors.join('\n- ')}` }
    shownThisTurn = true
    return { result: await apply($, built, patched.raw, patched.map) }
  })

  on('tool.call', { tool: STATUS }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const b = await read($, brief)
    if (!b) return { deny: 'No brief is shown. Call show first.' }
    const ids = new Set(flatten(b.points).map(p => p.id))
    const { readBytes } = readers($)
    const now = await $.clock.now()
    const problems: string[] = []
    let n = 0
    for (const u of (Array.isArray(input.updates) ? input.updates : []).filter(isRecord)) {
      const id = text(u.point)
      const state = text(u.state) as TaskState | undefined
      if (!id || !ids.has(id) || !state || !['queued', 'running', 'review', 'done', 'failed', 'blocked'].includes(state)) {
        problems.push(`skipped ${JSON.stringify(u.point)}: needs a known point and a state`)
        continue
      }
      const prev = (await read($, status))[id]
      const st: TaskStatus = { state, note: text(u.note), agent: prev?.agent, at: now }
      await update($, status, all => ({ ...all, [id]: st }))
      const ev = isRecord(u.evidence) ? u.evidence : undefined
      if (ev) {
        const title = text(ev.title)
        let made: Evidence | undefined
        if (isRecord(ev.code) && typeof ev.code.source === 'string') {
          const isDiff = ev.code.diff === true
          made = { kind: 'code', title, source: isDiff ? toHunk(ev.code.source) : ev.code.source, language: text(ev.code.language), isDiff, at: now }
        } else if (text(ev.image)) {
          const path = text(ev.image) as string
          const png = await readBytes(path)
          const size = typeof png === 'string' ? pngSize(png) : undefined
          if (typeof png !== 'string' || !size || png.length > 130000) problems.push(`${id}: image ${path} ${typeof png === 'object' && png ? png.refused : 'is missing, not a PNG, or over 95 KB'}`)
          else made = { kind: 'image', title, png, width: size.width, height: size.height, path, at: now }
        } else if (text(ev.text)) made = { kind: 'text', title, text: text(ev.text) as string, at: now }
        if (made) await update($, evidence, all => ({ ...all, [id]: [...(all[id] ?? []), made as Evidence].slice(-6) }))
      }
      n++
    }
    await persist($)
    const proofsNow = await read($, evidence)
    const unproved = Object.entries(await read($, status)).filter(([id, t]) => t.state === 'done' && (proofsNow[id] ?? []).length === 0)
    return { result: `${n} status update${n === 1 ? '' : 's'} applied.${problems.length ? `\n- ${problems.join('\n- ')}` : ''}${unproved.length ? `\nDone without evidence: ${unproved.map(([id]) => id).join(', ')}.` : ''}` }
  })

  // A subagent whose description carries [brief <id>] is linked to that point while it runs.
  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const tagged = /\[brief ([\w.]+)\]/.exec(`${e.description} ${e.prompt}`)
    const b = tagged ? await read($, brief) : null
    const id = tagged?.[1]
    if (!b || !id || !findPoint(b, id)) return next(e)
    const start: TaskStatus = { state: 'running', note: undefined, agent: e.description.replace(/\[brief [\w.]+\]\s*/, ''), at: await $.clock.now() }
    await update($, status, all => ({ ...all, [id]: start }))
    const res = await next(e)
    const now = (await read($, status))[id]
    if (now?.state === 'running') {
      const after: TaskStatus = { ...now, state: 'review', note: 'The agent finished. Check its work and attach evidence.', at: await $.clock.now() }
      await update($, status, all => ({ ...all, [id]: after }))
    }
    await persist($)
    return res
  })

  on('tool.call', { tool: NOTE }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const id = text(input.point)
    const body = text(input.text)
    const b = await read($, brief)
    if (!b) return { deny: 'No brief is shown. Call show first.' }
    if (!id || !body) return { deny: 'point and text are required.' }
    if (id !== 'top' && !findPoint(b, id)) return { deny: `No point ${id}. The ids are: ${flatten(b.points).map(p => p.id).join(', ')}.` }
    const note: ThreadNote = { from: 'claude', text: body }
    await update($, notes, all => ({ ...all, [id]: [...(all[id] ?? []), note] }))
    if (id !== 'top') {
      await select($, id)
      await update($, open, list => list.filter(x => x !== `fold:${id.split('.')[0]}`))
    }
    await persist($)
    return { result: `Note added under ${id === 'top' ? 'the brief' : `point ${id}`}.` }
  })

  // While a turn runs, pane messages join it; after a long answer, offer to open it as a brief.
  on('turn.start', async ($, e, next) => {
    shownThisTurn = false
    await update($, busy, () => true)
    await update($, offer, () => '')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) {
      await update($, busy, () => false)
      if ((await read($, mode)) !== 'off' && !shownThisTurn && !e.isAborted && isLong(e.answer)) await update($, offer, () => e.turnId)
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const turn = await read($, offer)
    if (!turn || e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" columnGap={2}>
        <Text dimColor>That was a long answer.</Text>
        <Button
          key="brief-offer"
          variant="primary"
          label="↗ open it as a brief"
          onPress={async () => {
            await update($, offer, () => '')
            void $.prompt.submit({ text: 'Show your last answer in the Brief pane: the same content as sections, with exhibits where they help.', asUser: true })
          }}
        />
        <Button key="brief-offer-dismiss" plain dimColor label="✕" onPress={() => update($, offer, () => '')} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => renderPane($, e))

  // A brief tool's row is one line: what it did, not its whole JSON input. The pane shows the rest.
  const BRIEF_TOOLS = new Set([SHOW, PATCH, NOTE, STATUS, GUIDE_TOOL])
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (!BRIEF_TOOLS.has(e.props.tool)) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const p = e.props
    const width = Math.max(30, (e.viewport?.columns ?? 100) - 12)
    const line = toolLine(p.tool, p.input)
    const look = p.isInterrupted ? { g: '⏹', c: undefined } : p.isErrored ? { g: '✕', c: RED } : p.isRunning ? { g: '◐', c: FOCUS } : { g: '◆', c: CLAUDE }
    return (
      <Box flexDirection="row" columnGap={1}>
        <Text color={look.c} dimColor={!look.c}>{look.g}</Text>
        <Text bold>Brief</Text>
        <Text dimColor wrap="truncate-end">{trunc(line, width)}</Text>
        {p.isInterrupted ? <Text dimColor>· interrupted</Text> : null}
      </Box>
    )
  })
}
