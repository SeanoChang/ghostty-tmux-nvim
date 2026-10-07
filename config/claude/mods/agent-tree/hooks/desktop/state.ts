import type { DeskUi } from '../../types'

// The desktop view's own state: which tab, run, item and view are open, and how the
// lists are filtered. It lives in $.state (key "desk"), written by Button presses.
export const DESK_DEFAULT: DeskUi = {
  tab: 'live', run: null, sel: null, view: 'overview', lens: 'tree', onlyRepo: true, file: null,
  query: '', hfilter: 'all', olderOpen: false, flipped: [], zoom: 'story', traceOffset: 0,
  confirm: '', note: '', patternsOpen: true,
}

const oneOf = <T extends string>(x: unknown, all: readonly T[], d: T): T => (all.includes(x as T) ? (x as T) : d)
const str = (x: unknown) => (typeof x === 'string' ? x : null)

// State from an older shape, or none, read with every field checked and defaulted.
export function deskUi(raw: unknown): DeskUi {
  const s = (raw ?? {}) as Partial<Record<keyof DeskUi, unknown>>
  return {
    tab: oneOf(s.tab, ['live', 'history'] as const, 'live'),
    run: str(s.run),
    sel: str(s.sel),
    view: oneOf(s.view, ['overview', 'changes', 'output'] as const, 'overview'),
    lens: oneOf(s.lens, ['tree', 'board', 'timeline', 'trace'] as const, 'tree'),
    onlyRepo: s.onlyRepo !== false,
    file: str(s.file),
    query: typeof s.query === 'string' ? s.query : '',
    hfilter: oneOf(s.hfilter, ['all', 'failed', 'changed'] as const, 'all'),
    olderOpen: s.olderOpen === true,
    flipped: Array.isArray(s.flipped) ? s.flipped.filter((x): x is string => typeof x === 'string') : [],
    zoom: oneOf(s.zoom, ['story', 'steps', 'raw'] as const, 'story'),
    traceOffset: typeof s.traceOffset === 'number' && Number.isFinite(s.traceOffset) ? Math.max(0, Math.floor(s.traceOffset)) : 0,
    confirm: oneOf(s.confirm, ['', 'explain', 'patterns'] as const, ''),
    note: typeof s.note === 'string' ? s.note : '',
    patternsOpen: s.patternsOpen !== false,
  }
}
