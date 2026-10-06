export type NodeStatus = 'running' | 'done' | 'failed' | 'killed'

/** What an agent is doing now, which picks its icon's prop. */
export type Act = 'think' | 'read' | 'write' | 'run' | 'web'

export type AgentNode = {
  id: string
  /** A group holds the subagents the main loop spawned in one turn, named as one piece of work. */
  kind: 'agent' | 'workflow' | 'group'
  parentId?: string
  /** What a person reads: a subagent's description, a workflow's description, a Haiku title. */
  label: string
  /** The machine name beside it: a workflow agent's script label, a workflow's meta.name. */
  tag?: string
  /** A workflow agent's phase, from the run's journal. */
  phase?: string
  /** A workflow's phases in the order its agents started. */
  phases?: string[]
  type?: string
  model?: string
  /** Where it runs: the main checkout, its own git worktree, or a remote environment. */
  where?: 'main' | 'worktree' | 'remote'
  status: NodeStatus
  startedAt: number
  endedAt?: number
  tools: number
  lastTool?: string
  /** When it last called a tool: a running agent quiet for long is worth a look. */
  lastToolAt?: number
  /** Tool calls by kind, for "Read 3 files, ran 2 commands". */
  work?: { read?: number; write?: number; run?: number; web?: number }
  /** Files it edited or wrote, each with its edit count and lines added and removed. */
  changes?: Record<string, { edits: number; added: number; removed: number }>
  act?: Act
  activity?: string
  taskId?: string
  transcriptDir?: string
  prompt?: string
  result?: string
  /** One plain sentence on what it found or did, from the digest Haiku writes when it finishes. */
  summary?: string
  /** Up to three key findings from the same digest. */
  points?: string[]
  /** The main-loop turn that spawned it: subagents from one turn form a group. */
  turn?: string
  /** How many members a group had when Haiku last named it. */
  titledFor?: number
  /** Set once the digest was tried, so it is asked once. */
  digested?: boolean
  tokens?: number
  /** Set once Haiku has titled it (or the attempt failed), so it is asked once. */
  titled?: boolean
  /** The root folder of the session that ran it ($.session.root()). */
  repo?: string
  /** The root folder as Claude Code's projects folder names it, for runs saved before repo was the root. */
  repoKey?: string
  /** Set once the root folder was looked for in the transcript's location. */
  repoTried?: boolean
  /** Set once a missing report was looked for in the transcript, so it is looked for once. */
  reportTried?: boolean
  /** The finished report, written once by Haiku in plain short sentences. */
  report?: Report
  /** A workflow's part reports, one per phase, written as each phase finishes. */
  partReports?: Record<string, Report>
}

/** One change one agent made to one file: its text before and after, and where it sits. */
/**
 * The short report a person reads when a run, a part of it or an agent finishes.
 * The model writes these fields; what changed and the totals come from records.
 */
export type Report = {
  /** One or two sentences: what it achieved. */
  result?: string
  /** What was done, at most three items (small runs, which have no parts). */
  done?: string[]
  /** Design choices the agents made, each with the agent or phase it came from. */
  decisions?: { text: string; source?: string }[]
  /** What went wrong or is still open, each with its source. */
  problems?: { text: string; source?: string }[]
  /** The next step, one sentence. */
  next?: string
  /** Who wrote it and what writing it cost, shown beside it. */
  model?: string
  tokens?: number
  /** A part report: how many agents it covered, so a part that grew is written again. */
  count?: number
}

export type EditRecord = {
  id: string
  agentId: string
  path: string
  at: number
  /** The 1-based line the change starts at in the file after it. */
  line: number
  old: string
  new: string
  isNew?: boolean
}

export type ViewProps = {
  nodes: AgentNode[]
  history: AgentNode[]
  at: number
  /** The edits to the file the Changes view has open, oldest first; absent when none is open. */
  diff?: { path: string; edits: EditRecord[] }
  /** This session's repository, for the History view's This repo filter. */
  repo?: string
  /** The look chosen in /config: 'kitty' or 'minimal'. */
  theme?: 'kitty' | 'minimal'
  /** The last wheel move over the pane: a new seq means a move the view has not applied yet. */
  wheel?: Wheel
  /** The trace the view asked for: a window of its rows, read from transcripts by the hooks. */
  trace?: TraceView
}

/** A wheel move over the pane, forwarded from ui.scroll: rows asked for, signed. */
export type Wheel = { seq: number; by: number }

/** How close a trace reads: a few beats per agent, grouped tool calls, or every call. */
export type TraceZoom = 'story' | 'steps' | 'raw'

/** One lane of a trace: an agent, or the main session that started the run. */
export type TraceLane = {
  id: string
  label: string
  /** Two letters the lane is known by in rows. */
  chip: string
  status: NodeStatus
  /** The first and last rows (absolute) that touch this lane, so the gutter draws it between them. */
  from: number
  to: number
}

/** One row of a trace, as the view draws it. Short, and never holding undefined. */
export type TraceRow = {
  kind: 'spawn' | 'tool' | 'edit' | 'message' | 'handback' | 'report' | 'fail' | 'quiet' | 'note'
  /** The lane it happens in, and the lane an arrow goes to (a spawn's child, a hand-back's parent). */
  lane: number
  to?: number
  /** Where an arrow goes when that is no lane here: another session, an agent outside the run. */
  target?: string
  /** Who sent a message that arrived. */
  from?: string
  at: number
  end?: number
  text: string
  count?: number
  name?: string
  input?: string
  output?: string
  tokens?: number
  path?: string
  added?: number
  removed?: number
  error?: boolean
}

/** The trace the view shows: which run, how close, and a window of its rows. */
export type TraceView = {
  run: string
  zoom: TraceZoom
  lanes: TraceLane[]
  total: number
  offset: number
  rows: TraceRow[]
  /** Agents whose transcript is no longer on disk. */
  missing: number
  /** True while the transcripts are still being read. */
  loading?: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'agent-tree': { nodes: AgentNode[]; edits: EditRecord[]; wheel: Wheel; trace: { seq: number } }
  }
}
