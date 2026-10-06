export type Tone = 'info' | 'warn' | 'risk' | 'ok' | 'idea'

export type BriefPin = { line?: number; at?: string; tone?: Tone; title: string; text?: string }

export type CodeExhibit = {
  kind: 'code'
  title?: string
  source: string
  language?: string
  path?: string
  startLine?: number
  isDiff?: boolean
  pins: BriefPin[]
}

export type SchemaExhibit = { kind: 'schema'; title?: string; source: string; language: string; isDiff: boolean }

export type CallRow = {
  key: string
  depth: number
  mark: ' ' | '+' | '-' | '~' | '?'
  name: string
  isNew: boolean
  isGap: boolean
  loc: string
  note: string
  excerpt?: { source: string; path: string; startLine: number; language?: string }
}

export type CallsExhibit = { kind: 'calls'; title?: string; rows: CallRow[] }

export type SvgExhibit = { kind: 'flow' | 'seq' | 'svg'; svg: string; legend?: string }

export type MachineExhibit = { kind: 'machine'; source: string; screens: Record<string, MockExhibit> }

export type TreeRow = { depth: number; name: string; note: string; mark: string | null; last: boolean[] }

export type TreeExhibit = { kind: 'tree'; rows: TreeRow[] }

export type MockExhibit = {
  kind: 'mock'
  frame: 'none' | 'terminal' | 'browser' | 'phone'
  title?: string
  svg?: string
  text?: string
  pins: BriefPin[]
}

export type MarkdownExhibit = { kind: 'markdown'; text: string }

/** A PNG Claude rendered (d2, mermaid, matplotlib), carried as base64. */
export type ImageExhibit = { kind: 'image'; png: string; width: number; height: number; path: string; alt: string }

export type Exhibit =
  | CodeExhibit
  | SchemaExhibit
  | CallsExhibit
  | SvgExhibit
  | MachineExhibit
  | TreeExhibit
  | MockExhibit
  | MarkdownExhibit
  | ImageExhibit

export type BriefOption = { value: string; label: string; note?: string }

export type BriefAsk = {
  kind: 'one' | 'many' | 'text' | 'scale' | 'rank'
  question: string
  options: BriefOption[]
  recommended: string
  min?: number
  max?: number
  then: Record<string, string>
}

export type BriefNote = { tone: Tone; text: string }

export type BriefPoint = {
  id: string
  claim: string
  aux?: 'shared' | 'scope'
  exhibit?: Exhibit
  caption?: string
  ask?: BriefAsk
  note?: BriefNote
  points: BriefPoint[]
}

export type BriefQuote = { via: string; from: string; text: string; at?: string }

export type BriefTerm = { term: string; meaning: string }

export type Brief = {
  title: string
  gist: string
  why: BriefQuote[]
  changes?: { new?: number; changed?: number; deleted?: number }
  points: BriefPoint[]
  terms: BriefTerm[]
  version: number
}

export type ThreadNote = { from: 'claude' | 'you'; text: string }

declare module 'claude-code' {
  interface PluginState {
    brief: {
      brief: Brief | null
      open: string[]
      seen: string[]
      changed: string[]
      answers: Record<string, string>
      notes: Record<string, ThreadNote[]>
      struck: string[]
      machineAt: Record<string, string>
      replyNonce: number
      selected: string
      rowSel: string
    }
  }
}
