import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInput } from 'claude-code'

import { NW } from './core.js'
import { buildBrief, flatten, signature, text } from './model.ts'
import { findPoint, labelOf, pointName, respondMessage, tag } from './helpers.ts'
import { machineSvg } from './svg.ts'
import type { Brief, BriefAsk, BriefPoint, CallRow, Exhibit, MockExhibit, ThreadNote, Tone } from '../types'

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

const PANE = 'brief'
const SHOW = 'mcp__brief__show'
const NOTE = 'mcp__brief__note'

const SHOW_DESCRIPTION = `Show a brief in the Brief pane beside the chat: a plan, design, explanation or review the user must understand or decide on. Use it when the user asks for a plan, an RFC, a design or a brief. It is html-plan, drawn natively.

How the reader reads it: the gist, then the closed list of top-level claims, then one point at a time.
- title: the change and the place, 3 to 7 words. gist: one sentence with the whole answer.
- why: the user's own words, quoted, never reworded: [{via:"prompt", from:"the user", text}].
- changes: files the plan touches: {new, changed, deleted}.
- points: 2 to 6 claims. Read alone, the closed list tells the whole change. Split by behaviour, never by file or by order of work. Level 1: what someone can now do or see. Level 2: how it works. Level 3: where ("file.ts:18 · symbol"). At most 5 children and 3 levels. A claim at levels 1-2 is one sentence that can be true or false, about 12 words.
- End with {aux:"shared"} for a record several claims use (if any) and {aux:"scope"} for what does not change.
- Each point has ONE exhibit (a second exhibit is a second claim), then an optional ask and note, then child points. caption: one sentence, what to notice.

Exhibits (html-plan block syntax; + new, - removed, ~ changed):
- detail: markdown, 4 sentences at most.
- code: {src:"path", lines:"20-34"} reads the real file (paths from the working directory). Or {source, language, title:"x.ts · sketch"} for code that does not exist. {diff:true, file, source} for a change: lines start with + - or a space. pins:[{line, tone:"info|warn|risk|ok", title, text}].
- schema: {language:"ts|sql|proto…", title, source, diff?} — the shape in the project's own language, 5 to 10 members.
- calls: {title, source} — one call per line, column 0 is the mark (+ new, - removed, ~ changed entrypoint, ? proposed, space = context), 2 spaces per level, **bold** = new symbol, end with "@ path:line" and optional "-- note". Under 15 rows.
- flow: {source} — "id = Label / sub [db|pill|diamond|circle] [green|red…]", "a -> b : label" (--> dashed, => bold), grid rows "| a | b |" place nodes, "group Name: a b". 12 nodes at most, 2-3 columns.
- seq: {source} — "participants: a "A" b "B"", "a -> b : call", "b --> a : reply", "note over a: text", "--- phase ---". 3 lanes reads best.
- machine: {source, screens:{state: mock}} — "machine m initial s", "state s final  # one sentence", "a -event-> b : label", grid rows "| a | b |". 8 states at most; every state reachable, every dead end final. The reader taps states to see each one's screen.
- tree: {source} — indented paths, "+ new/", "~ changed.ts  # note".
- mock: {html, w:440, h, frame:"none|browser|phone|terminal", title, pins:[{at:"70%,40%", title, text}]} — the smallest region that makes the point, w 480 at most, inline styles. terminal: the text output.
- svg: raw SVG with svgAlt (what to notice), for anything else.
- image: {path, alt} — a PNG you render yourself, for charts and for flows too big or too tangled for the flow block. Render first, then show:
  · flow or architecture: write a .d2 file, then \`d2 --pad 24 --theme 0 in.d2 out.svg && rsvg-convert -w 900 out.svg -o out.png\` (not ImageMagick: it drops SVG text here).
  · sequence or state chart: \`mmdc -i in.mmd -o out.png -w 900 -b white\`.
  · data chart: matplotlib, figsize about (9, 4), dpi 100, savefig(..., facecolor="white"); label the axes and the extremes; derive the y range from the data.
  Keep each PNG under 95 KB (900 px wide is plenty), give it an opaque white background so it reads on dark themes, and save it in the scratchpad. alt says what to notice.

ask (a decision on the point it changes, 2 to 5 per plan): {kind:"one|many|text|scale|rank", question (15 words at most), options:[{value,label,note}], recommended (your pick; many/rank: values joined by commas; scale: a number), min/max for scale, then:{value:"what follows if picked"}}. If an option removes a claim, say so in its note.
note: {tone:"info|warn|risk|ok|idea", text} — a risk to weigh, under the exhibit.
terms: define each piece of jargon once.

Write the prose in plain, short sentences: active voice, one idea each, no filler.
show refuses a brief that breaks the rules and lists why; fix it and call again. Calling show again replaces the brief; keep the order of unchanged points so their ids stay; the pane marks changed points.
The reader's questions arrive as user messages starting "[brief <id>". Answer each with ${NOTE} on that point, then reply in chat with one line. The reader's Respond message lists decisions and struck calls: apply them, refer to points by id, and do not start building until it arrives.`

const NOTE_DESCRIPTION = `Add your answer, or a question for the reader, under one point of the Brief pane. point: the point id ("1.2", "shared", "scope"), or "top" for the brief as a whole. text: markdown, short.`

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
    mock: mockSchema,
    svg: S,
    svgAlt: S,
    image: block({ path: S, alt: S }, ['path']),
    ask: block(
      {
        kind: { type: 'string', enum: ['one', 'many', 'text', 'scale', 'rank'] },
        question: S,
        options: { type: 'array', items: block({ value: S, label: S, note: S }, ['value', 'label']) },
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
  },
  ['title', 'gist', 'points'],
)

const noteSchema = block({ point: S, text: S }, ['point', 'text'])


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
  void $.prompt.submit({ text: `${tag(id, claim)} ${message}`, asUser: true })
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

/** Keeps the brief and the reader's answers past the session (restored at session start). */
async function persist($: EngineInterface) {
  const b = await read($, brief)
  if (!b) return
  await $.store.set('last', {
    brief: b,
    answers: await read($, answers),
    struck: await read($, struck),
    notes: await read($, notes),
    seen: await read($, seen),
    savedAt: await $.clock.now(),
  })
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

  const b = await read($, brief)
  if (!b) {
    return (
      <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
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
    await persist($)
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
              {chosen.excerpt && <Button key="row-code" hotkey="c" label={isOpen(chosen.key) ? 'c hide code' : 'c code'} onPress={toggle(chosen.key)} />}
              <Button
                key="row-strike"
                hotkey="x"
                label={struckKeys.includes(chosen.key) ? 'x restore' : 'x strike'}
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
                label="a ask"
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
        return <Markdown text={x.text} />
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
    if ((ask.kind === 'one' || ask.kind === 'scale') && Select) {
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
      <Box flexDirection="column" borderStyle="round" borderColor={color} paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={color}>
            {pick === undefined ? '◆ DECIDE' : '✓ DECIDED'}
          </Text>
          <Text dimColor>{pick === undefined ? 'suggestion stands until you pick' : pick === ask.recommended ? 'kept the suggestion' : 'changed'}</Text>
        </Box>
        <Text bold>{ask.question}</Text>
        {control}
        {(ask.kind === 'text' || ask.kind === 'scale') && <Text dimColor>{`★ suggested: ${ask.recommended}`}</Text>}
        {consequence && <Text color={AMBER}>{`⚠ then: ${consequence}`}</Text>}
      </Box>
    )
  }

  // ── detail ──────────────────────────────────────────────────────────
  const thread = (id: string) =>
    (threads[id] ?? []).map((n, i) => (
      <Box key={`note-${id}-${i}`} flexDirection="column" paddingLeft={1} borderStyle="single" borderColor={n.from === 'claude' ? CLAUDE : undefined} borderDimColor={n.from === 'you'}>
        <Text bold color={n.from === 'claude' ? CLAUDE : undefined} dimColor={n.from === 'you'}>
          {n.from === 'claude' ? '✎ CLAUDE' : '› YOU'}
        </Text>
        <Markdown text={n.text} />
      </Box>
    ))

  const askRow = (id: string, claim: string, keys: boolean, withInput: boolean) => (
    <Box flexDirection="column">
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">
        <Text dimColor>{`ask about ${id === 'top' ? 'the brief' : id}`}</Text>
        <Button key={`simpler-${id}`} plain hotkey={keys ? 's' : undefined} label={keys ? 's simpler' : 'simpler'} onPress={() => send($, id, claim, 'Explain this more simply, in plain words.')} />
        <Button key={`example-${id}`} plain hotkey={keys ? 'e' : undefined} label={keys ? 'e example' : 'example'} onPress={() => send($, id, claim, 'Give me one concrete example of this.')} />
        <Button key={`why-${id}`} plain hotkey={keys ? 'w' : undefined} label={keys ? 'w why?' : 'why?'} onPress={() => send($, id, claim, 'Why is this true? What would break if it were not?')} />
        <Button key={`quote-${id}`} plain hotkey={keys ? 'q' : undefined} label={keys ? 'q quote ↗' : 'quote ↗'} onPress={() => void $.prompt.fill({ text: `${tag(id, claim)} `, mode: 'insert' })} />
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
      <Box key={`${p.id}-note`} flexDirection="column" paddingLeft={1} borderStyle="single" borderColor={TONE[p.note.tone]}>
        <Text bold color={TONE[p.note.tone]}>{TONE_LABEL[p.note.tone]}</Text>
        <Markdown text={p.note.text} />
      </Box>
    ) : null,
    p.ask ? decision(p) : null,
    ...thread(p.id),
  ].filter(Boolean)

  // Level 3 ("where"): one line that opens in place.
  const whereLine = (c: BriefPoint) => {
    const k = `where:${c.id}`
    return (
      <Box key={`where-${c.id}`} flexDirection="column">
        <Box flexDirection="row" columnGap={1}>
          <Button key={`where-${c.id}`} plain dimColor={!isOpen(k)} label={`${isOpen(k) ? '▾' : '▸'} ${c.claim}`} onPress={toggle(k)} />
          {marks(c, `where-${c.id}`)}
        </Box>
        {isOpen(k) && (
          <Box flexDirection="column" marginLeft={2} gap={1}>
            {body(c)}
          </Box>
        )}
      </Box>
    )
  }

  // Level 2 ("how"): a paragraph inside its section, always shown.
  const childBlock = (c: BriefPoint) => (
    <Box key={`child-${c.id}`} flexDirection="column" gap={1}>
      <Box flexDirection="row" columnGap={1}>
        <Text bold>{`› ${c.claim}`}</Text>
        {marks(c, `child-${c.id}`)}
        <Button key={`ask-${c.id}-quote`} plain dimColor label="ask ↗" onPress={() => void $.prompt.fill({ text: `${tag(c.id, c.claim)} `, mode: 'insert' })} />
      </Box>
      <Box flexDirection="column" marginLeft={2} gap={1}>
        {body(c)}
        {c.points.map(whereLine)}
      </Box>
    </Box>
  )

  // Level 1: one card per section; the focused card is the only coloured frame.
  const card = (p: BriefPoint) => {
    const isFocus = p.id === focusId
    const folded = isOpen(`fold:${p.id}`)
    return (
      <Box key={`sec-${p.id}`} flexDirection="column" borderStyle="round" borderColor={isFocus ? FOCUS : undefined} borderDimColor={!isFocus} paddingX={1} gap={1}>
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

  // ── header ──────────────────────────────────────────────────────────
  const ch = b.changes
  const files = (ch?.new ?? 0) + (ch?.changed ?? 0) + (ch?.deleted ?? 0)
  const why = b.why ?? []
  const header = (
    <Box key="header" flexDirection="column" paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between" columnGap={2}>
        <Text bold>{b.title}</Text>
        <Text>
          <Text dimColor>{`v${b.version}${files > 0 ? ` · ${files} files` : ''}`}</Text>
          {ch?.new ? <Text color={GREEN}>{` +${ch.new}`}</Text> : null}
          {ch?.changed ? <Text color={AMBER}>{` ~${ch.changed}`}</Text> : null}
          {ch?.deleted ? <Text color={RED}>{` −${ch.deleted}`}</Text> : null}
        </Text>
      </Box>
      <Markdown text={b.gist} />
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={2} flexWrap="wrap">
        <Box flexDirection="row" columnGap={2}>
          {asks.length > 0 && <Text color={toAnswer > 0 ? AMBER : GREEN}>{toAnswer > 0 ? `◆ ${toAnswer} of ${asks.length} decisions open` : `✓ all ${asks.length} decided`}</Text>}
          {changedIds.length > 0 && <Text color={PURPLE}>{`● ${changedIds.length} changed`}</Text>}
        </Box>
        <Button
          key="respond"
          variant="primary"
          hotkey="r"
          label="Respond  r"
          onPress={() => {
            void $.prompt.submit({ text: respondMessage(b, picked, struckKeys, seenIds), asUser: true })
            $.ui.toast('Response sent to Claude')
          }}
        />
      </Box>
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

  // Contents strip: one line, jumps to a section.
  const toc = (
    <Box key="toc" flexDirection="row" flexWrap="wrap" paddingX={1}>
      {sections.map((x, i) => {
        const label = `${sectionName(x)} ${trunc(x.claim.replace(/[.。]$/, ''), 24)}`
        return [
          i > 0 ? <Text key={`toc-sep-${x.id}`} dimColor>{'  ·  '}</Text> : null,
          x.id === focusId ? (
            <Text key={`toc-on-${x.id}`} bold color={FOCUS}>{label}</Text>
          ) : (
            <Button key={`toc-${x.id}`} plain dimColor label={label} onPress={jump(x.id)} />
          ),
        ]
      })}
    </Box>
  )

  const endCards = [
    b.terms.length > 0 ? (
      <Box key="terms" flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
        <Text bold dimColor>Terms</Text>
        {b.terms.map(t => (
          <Text key={`term-${t.term}`}>
            <Text bold>{t.term}</Text>
            <Text dimColor>{`  ${t.meaning}`}</Text>
          </Text>
        ))}
      </Box>
    ) : null,
    <Box key="top" flexDirection="column" borderStyle="round" borderDimColor paddingX={1} gap={1}>
      <Text bold dimColor>The whole brief</Text>
      {thread('top')}
      {askRow('top', b.title, false, true)}
    </Box>,
  ]

  const footer = (
    <Box key="footer" flexDirection="row" columnGap={3} paddingX={1} flexWrap="wrap">
      <Button key="nav-next" plain dimColor hotkey="j" label="j next section" onPress={jump(sections[fi + 1]?.id)} />
      <Button key="nav-prev" plain dimColor hotkey="k" label="k previous" onPress={jump(sections[fi - 1]?.id)} />
      <Text dimColor>click a title to fold · r respond</Text>
    </Box>
  )

  return (
    <Box flexDirection="column" gap={1}>
      {header}
      <Text dimColor>{'─'.repeat(Math.max(10, cols - 1))}</Text>
      {toc}
      {sections.map(card)}
      {endCards}
      {footer}
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'brief', description: 'Open the Brief pane' })
    await $.tool.register({ name: 'show', description: SHOW_DESCRIPTION, inputSchema: showSchema })
    await $.tool.register({ name: 'note', description: NOTE_DESCRIPTION, inputSchema: noteSchema })
    // A new session starts empty: bring back the last brief and the reader's answers.
    if (!(await read($, brief))) {
      const last = (await $.store.get('last')) as
        | { brief?: Brief; answers?: Record<string, string>; struck?: string[]; notes?: Record<string, ThreadNote[]>; seen?: string[] }
        | undefined
      if (last?.brief) {
        await update($, brief, () => last.brief as Brief)
        await update($, answers, () => last.answers ?? {})
        await update($, struck, () => last.struck ?? [])
        await update($, notes, () => last.notes ?? {})
        await update($, seen, () => last.seen ?? [])
      }
    }
    return next(e)
  })

  on('command.run', { command: 'brief' }, async $ => {
    const b = await read($, brief)
    await $.ui.open({ id: PANE, title: b?.title ?? 'Brief', focus: true })
    return { text: b ? `Brief pane opened: ${b.title}.` : 'Brief pane opened. It is empty until Claude shows a brief.' }
  })

  on('tool.call', { tool: SHOW }, async ($, e) => {
    const input = e as unknown as Record<string, unknown>
    const readFile = async (path: string) => {
      const why = await fenceCheck($, path)
      if (why) return { refused: why }
      try {
        return await $.fs.read(path)
      } catch {
        return undefined
      }
    }
    const readBytes = async (path: string) => {
      const why = await fenceCheck($, path)
      if (why) return { refused: why }
      try {
        const got = await $.fs.read(path, { as: 'bytes' })
        return typeof got === 'string' ? undefined : got.base64
      } catch {
        return undefined
      }
    }
    const built = await buildBrief(input, readFile, readBytes)
    if (!built.brief) {
      const warn = built.warnings.length > 0 ? `\nAlso:\n- ${built.warnings.join('\n- ')}` : ''
      return { deny: `The brief was not shown. Fix these and call show again:\n- ${built.errors.join('\n- ')}${warn}` }
    }
    const before = await read($, brief)
    const next: Brief = { ...built.brief, version: (before?.version ?? 0) + 1 }
    const all = flatten(next.points)
    const ids = new Set(all.map(p => p.id))
    const old = new Map(flatten(before?.points ?? []).map(p => [p.id, signature(p)]))
    const diff = before ? all.filter(p => old.get(p.id) !== signature(p)).map(p => p.id) : []
    const rowKeys = new Set(all.flatMap(p => (p.exhibit?.kind === 'calls' ? p.exhibit.rows.map(r => r.key) : [])))
    const keep = (id: string) => ids.has(id) && !diff.includes(id)

    await update($, brief, () => next)
    await update($, changed, () => diff)
    await update($, open, list => list.filter(id => id === 'why' || id.startsWith('fold:') || id.startsWith('where:') || rowKeys.has(id)))
    await update($, selected, id => (ids.has(id) ? id : (all[0]?.id ?? '')))
    await update($, rowSel, key => (rowKeys.has(key) ? key : ''))
    await update($, seen, list => list.filter(keep))
    await update($, answers, picked => Object.fromEntries(Object.entries(picked).filter(([id]) => keep(id))))
    await update($, struck, list => list.filter(k => rowKeys.has(k)))
    await update($, machineAt, at => Object.fromEntries(Object.entries(at).filter(([id]) => keep(id))))
    await update($, notes, all => Object.fromEntries(Object.entries(all).filter(([id]) => id === 'top' || ids.has(id))))
    await persist($)
    const opened = await $.ui.open({ id: PANE, title: next.title })

    const asks = all.filter(p => p.ask).length
    const where = opened.isPlaced === false ? ' The pane is not seated yet; the user can run /brief to open it.' : ''
    const warn = built.warnings.length > 0 ? `\nWarnings (fix if they matter):\n- ${built.warnings.join('\n- ')}` : ''
    return {
      result: `Brief v${next.version} shown in the Brief pane: ${all.length} points, ${asks} decisions, ${diff.length} changed since the last version.${where}${warn}`,
    }
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

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => renderPane($, e))
}
