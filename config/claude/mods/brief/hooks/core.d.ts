// Types for the parts of core.js (html-plan's parsers and layouts) that the mod uses.

export type Mark = 'new' | 'gone' | 'mod' | 'hl' | null

export type FlowNode = {
  id: string
  label: string
  sub: string
  shape: string
  tone: string
  mark: Mark
  lines: string[]
  subLines: string[]
}
export type FlowEdge = { from: string; to: string; label: string; dash: boolean; bold: boolean; both: boolean; mark: Mark; lines: string[]; tw: number; th: number }
export type FlowModel = { nodes: Record<string, FlowNode>; order: string[]; edges: FlowEdge[]; grid: (string | null)[][]; dir: string; errors: string[] }
export type FlowBox = { id: string; x: number; y: number; w: number; h: number; cx: number; cy: number; n: FlowNode }
export type FlowLayout = {
  W: number
  H: number
  boxes: Record<string, FlowBox>
  routes: { e: FlowEdge; pts: [number, number][]; lx: number; ly: number }[]
  groups: { label: string; x: number; y: number; w: number; h: number }[]
}

export type SeqStep =
  | { kind: 'msg'; from: string; to: string; text: string; dash: boolean; lost: boolean; mark: Mark }
  | { kind: 'note'; over: string[]; text: string }
  | { kind: 'div'; text: string }
export type SeqModel = { actors: { id: string; label: string }[]; steps: SeqStep[]; errors: string[] }

export type MachineState = { id: string; label: string; final: boolean; bind: { say?: string } }
export type MachineEvent = { from: string; ev: string; to: string; label: string; mark: Mark }
export type MachineModel = { name: string; initial: string; states: Record<string, MachineState>; order: string[]; events: MachineEvent[]; grid: (string | null)[][]; errors: string[] }
export type MachineLayout = { W: number; H: number; pos: Record<string, [number, number]>; NW: number; NH: number }

export type CallNode = { depth: number; mark: string; name: string; isNew: boolean; gap: boolean; loc: string; file: string; line: string; note: string }
export type CallsModel = { nodes: CallNode[]; errors: string[] }

export type TreeModel = { rows: { depth: number; name: string; note: string; mark: Mark; last: boolean[] }[]; errors: string[] }

export const NW: {
  parseFlow: (text: string) => FlowModel
  layoutFlow: (m: FlowModel, opt?: { nodeW?: number }) => FlowLayout
  parseSeq: (text: string) => SeqModel
  parseMachine: (text: string) => MachineModel
  layoutMachine: (m: MachineModel, dir?: 'LR' | 'TB') => MachineLayout
  parseCalls: (text: string) => CallsModel
  parseTree: (text: string) => TreeModel
}
export const dedent: (text: string) => string
export const esc: (text: unknown) => string
