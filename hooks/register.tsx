import { atom, read, update } from 'claude-code'
import type { EngineInterface as Engine, Register, Timer } from 'claude-code'

import type { AgentNode, EditRecord, NodeStatus, Report, ViewProps } from '../types'
import { themeOf, type ThemeName } from './theme'
import {
  changesLine, cleanTitle, describeTool, diffCounts, editRecords, editedPath, fileRows, firstPrompt, firstSentence, handbackOf, fitProps,
  lineDiff, parseJournal, pipeline, scopeNodes, transcriptEdits,
} from './list'
import { REPORT_SYSTEM, parseReport, partInput, runInput } from './report'

const PANE = 'agent-tree'
// Bumped when the view module's props or state change shape: a new key mounts a
// fresh instance, where the old one would carry its state into the new code.
const VIEW_KEY = 'tree-v7'
const TITLE = 'Agents'
const HISTORY = 'history'
const HISTORY_RUNS = 150
const nodes = atom({ plugin: 'agent-tree', key: 'nodes' } as const, [])
const edits = atom({ plugin: 'agent-tree', key: 'edits' } as const, [])
// The last wheel move over the pane, which the view applies once per seq.
const wheel = atom({ plugin: 'agent-tree', key: 'wheel' } as const, { seq: 0, by: 0 })
// The look chosen in /config, read from the options at each load.
let themeName: ThemeName = 'minimal'
const EDITS = 'edits'
const EDITS_KEPT = 400
const EDIT_TEXT = 6000
// The file the Changes view has open: only its edits travel to the view.
let diffPath: string | null = null
// where this session keeps subagent transcripts, learned from a Stop event or a workflow's folder
let subagentsDir: string | undefined
const backfilled = new Set<string>()

// Agent tool calls seen in any loop. A spawn whose tool_use_id is not here
// came from somewhere else (a workflow run), so it is filed under that run.
const agentCalls = new Set<string>()
// Each Agent call's `isolation`, read when its spawn arrives.
const isolationOf = new Map<string, 'worktree' | 'remote'>()
const digesting = new Set<string>()
let reconciler: Timer | undefined
let poller: Timer | undefined
const titling = new Set<string>()
// The main loop's current turn, from the last prompt it took: its subagents form one group.
let turn: string | undefined
const TITLE_CONCURRENCY = 4

const AGENT_TOOLS = new Set(['Agent', 'Task'])
const excerpt = (s: string | undefined, n = 400) => (s ? s.slice(0, n) : undefined)
const scriptField = (script: string | undefined, field: string) =>
  new RegExp(`${field}:\\s*['"]([^'"]+)['"]`).exec(script ?? '')?.[1]

const runningWorkflow = (list: AgentNode[]) =>
  [...list].reverse().find(n => n.kind === 'workflow' && n.status === 'running')

const patch = ($: Engine, id: string, fn: (n: AgentNode) => AgentNode) =>
  update($, nodes, list => list.map(n => (n.id === id ? fn(n) : n)))

const finish = (status: NodeStatus, at: number) => (n: AgentNode): AgentNode =>
  n.status === 'running' ? { ...n, status, endedAt: at } : n

const statusOf = (word: string | undefined): NodeStatus =>
  word === 'failed' ? 'failed' : word === 'killed' ? 'killed' : 'done'

async function add($: Engine, node: AgentNode) {
  await update($, nodes, list => [...list.filter(n => n.id !== node.id), node].slice(-400))
  ensureTimers($)
  // Unasked opens wait for a wide terminal; a refusal here must not fail the spawn.
  void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
}

function ensureTimers($: Engine) {
  reconciler ??= $.clock.every(5000, () => void reconcile($))
  poller ??= $.clock.every(2000, () => void pollJournals($))
}

// $.agent.list() is the engine's own record of subagent status. It catches
// ends no event reported (a killed background agent). Workflow agents are not listed.
async function reconcile($: Engine) {
  const at = await $.clock.now()
  const listed = new Map((await $.agent.list()).map(a => [a.id, a]))
  await update($, nodes, list =>
    list.map(n => {
      const info = listed.get(n.id)
      if (!info || n.status !== 'running' || info.status === 'running') return n
      return { ...n, status: statusOf(info.status === 'completed' ? 'done' : info.status), endedAt: at }
    }),
  )
  await settleGroups($)
  await archive($)
  if (!(await read($, nodes)).some(n => n.status === 'running')) {
    reconciler?.cancel()
    reconciler = undefined
  }
}

// A workflow's transcript folder says exactly which agents are its own, under
// which script label and phase, on what type and model, and when each ended.
async function pollJournals($: Engine) {
  const wfs = (await read($, nodes)).filter(n => n.kind === 'workflow' && n.status === 'running' && n.transcriptDir)
  if (wfs.length === 0) {
    poller?.cancel()
    poller = undefined
    return
  }
  for (const wf of wfs) await syncJournal($, wf)
  void titleAgents($)
}

async function syncJournal($: Engine, wf: AgentNode) {
  const dir = wf.transcriptDir
  if (!dir) return
  const text = await $.fs.read(`${dir}/journal.jsonl`).catch(() => '')
  const entries = parseJournal(text)
  if (entries.length === 0) return
  const at = await $.clock.now()
  const list = await read($, nodes)
  const known = new Map(list.map(n => [n.id, n]))
  const fresh: AgentNode[] = []
  for (const j of entries) {
    const n = known.get(j.agentId)
    if (n && n.tag !== undefined && n.type !== undefined && n.prompt !== undefined && (!j.isDone || n.status !== 'running')) continue
    const meta = n?.type === undefined
      ? await $.fs.read(`${dir}/agent-${j.agentId}.meta.json`).then(t => JSON.parse(t) as { agentType?: string; model?: string }).catch(() => undefined)
      : undefined
    const prompt = n?.prompt ?? firstPrompt(await $.fs.read(`${dir}/agent-${j.agentId}.jsonl`).catch(() => ''))
    fresh.push({
      ...(n ?? { id: j.agentId, kind: 'agent', label: j.label ?? `agent ${j.agentId.slice(0, 6)}`, status: 'running', startedAt: at, tools: 0 }),
      parentId: wf.id,
      tag: j.label ?? n?.tag,
      phase: j.phase ?? n?.phase,
      type: n?.type ?? meta?.agentType,
      model: n?.model ?? meta?.model,
      prompt: excerpt(prompt),
      ...(j.isDone && n?.status === 'running' ? { status: 'done' as const, endedAt: at } : {}),
      ...(j.isDone && !n ? { status: 'done' as const, endedAt: at } : {}),
    })
  }
  const phases = [...new Set(entries.map(j => j.phase).filter((p): p is string => !!p))]
  await update($, nodes, all => {
    const byId = new Map(fresh.map(f => [f.id, f]))
    const merged = all.map(n => byId.get(n.id) ?? (n.id === wf.id ? { ...n, phases } : n))
    const added = fresh.filter(f => !all.some(n => n.id === f.id))
    return [...merged, ...added].slice(-400)
  })
}

// A group runs while any member runs. When the last one ends, the group ends with
// it, gets one digest of all their reports and one toast, and moves to History.
async function settleGroups($: Engine) {
  const list = await read($, nodes)
  for (const g of list.filter(n => n.kind === 'group' && n.status === 'running')) {
    const kids = list.filter(k => k.parentId === g.id)
    if (kids.length === 0 || kids.some(k => k.status === 'running')) continue
    const status: NodeStatus = kids.some(k => k.status === 'failed') ? 'failed' : kids.every(k => k.status === 'killed') ? 'killed' : 'done'
    const endedAt = Math.max(...kids.map(k => k.endedAt ?? g.startedAt))
    const tokens = kids.reduce((a, k) => a + (k.tokens ?? 0), 0)
    await patch($, g.id, x => ({ ...x, status, endedAt, tokens: tokens || undefined }))
    void digest($, g.id)
    await announce($, g.id)
  }
}

// Subagents the main loop spawns in one turn are one piece of work. Once a turn has
// two, they move into a group; later ones join it. One atomic update, so spawns that
// land together (parallel Agent calls) all end up inside.
async function regroup($: Engine, t: string): Promise<string | undefined> {
  const id = `grp:${t}`
  let isGrouped = false
  await update($, nodes, all => {
    const strays = all.filter(n => n.kind === 'agent' && !n.parentId && n.turn === t)
    const has = all.some(n => n.id === id)
    isGrouped = has || strays.length >= 2
    if (!isGrouped || strays.length === 0) return all
    const moved = all.map(n => (strays.includes(n) ? { ...n, parentId: id } : n))
    if (has) return moved.map(n => (n.id === id && n.status !== 'running' ? { ...n, status: 'running' as const, endedAt: undefined, digested: false } : n))
    const group: AgentNode = {
      id, kind: 'group', label: strays[0]!.label, type: 'group', turn: t, where: strays[0]!.where,
      status: 'running', startedAt: Math.min(...strays.map(f => f.startedAt)), tools: 0, titled: true,
    }
    return [...moved, group]
  })
  return isGrouped ? id : undefined
}

// A group's name says what its members work on together, from their task descriptions.
// Named again when members join while Haiku is naming it.
async function titleGroup($: Engine, id: string) {
  if (titling.has(id)) return
  const list = await read($, nodes)
  const g = list.find(n => n.id === id)
  const kids = list.filter(k => k.parentId === id)
  if (!g || kids.length === 0 || g.titledFor === kids.length) return
  titling.add(id)
  const r = await $.model.complete({
    model: 'haiku',
    maxTokens: 30,
    system: 'You name a batch of AI agents that work toward one goal, so a person can scan a list of runs. Reply with the title only: 3 to 7 words, starting with a verb, naming the shared goal, no quotes, no final period.',
    prompt: `Agents and their tasks:\n${kids.map(k => `- ${k.label}: ${(k.prompt ?? '').slice(0, 300)}`).join('\n')}`,
  }).catch(() => undefined)
  titling.delete(id)
  const title = r?.isAnswered ? cleanTitle(r.text) : undefined
  await patch($, id, x => ({ ...x, label: title ?? x.label, titledFor: kids.length, prompt: kids.map(k => k.label).join('; ') }))
  void titleGroup($, id)
}

// Workflow agents carry script labels ("read:types"); a person wants "Read the type fields".
async function titleAgents($: Engine) {
  const list = await read($, nodes)
  const wfIds = new Set(list.filter(n => n.kind === 'workflow').map(n => n.id))
  const todo = list.filter(n => n.kind === 'agent' && n.parentId && wfIds.has(n.parentId) && !n.titled && n.prompt && !titling.has(n.id))
  for (const n of todo.slice(0, Math.max(0, TITLE_CONCURRENCY - titling.size))) {
    titling.add(n.id)
    void $.model.complete({
      model: 'haiku',
      maxTokens: 30,
      system: 'You name tasks given to AI agents so a person can scan a list of them. Reply with the title only: 3 to 7 words, starting with a verb, no quotes, no final period.',
      prompt: `Task:\n${(n.prompt ?? '').slice(0, 800)}`,
    }).then(async r => {
      const title = r.isAnswered ? cleanTitle(r.text) : undefined
      await patch($, n.id, x => ({ ...x, titled: true, label: title ?? x.label }))
    }).catch(() => patch($, n.id, x => ({ ...x, titled: true }))).finally(() => {
      titling.delete(n.id)
      void titleAgents($)
    })
  }
}

async function endWorkflow($: Engine, taskId: string, word: string | undefined, result?: string) {
  const wf = (await read($, nodes)).find(n => n.kind === 'workflow' && n.status === 'running' && n.taskId === taskId)
  if (!wf) return
  await syncJournal($, wf)
  const at = await $.clock.now()
  const status = statusOf(word)
  // An agent the journal never saw end did not finish: it was cut with the run.
  await update($, nodes, all =>
    all.map(n => (n.id === wf.id ? { ...finish(status, at)(n), result: excerpt(result) ?? n.result } : n.parentId === wf.id ? finish('killed', at)(n) : n)),
  )
  void digest($, wf.id)
  await announce($, wf.id)
  await archive($)
}

// A finished top-level run gets a toast: what it was, how it ended, what it changed.
async function announce($: Engine, id: string) {
  const list = await read($, nodes)
  const n = list.find(x => x.id === id)
  if (!n || n.parentId || n.status === 'running') return
  const rows = fileRows(scopeNodes(list, { kind: 'node', id: n.id }))
  const head = n.status === 'failed' ? '✗ Failed' : n.status === 'killed' ? '■ Stopped' : '✓ Finished'
  $.ui.toast(`${head}: ${n.label} · ${changesLine(rows)}`)
}

// The report: what finished work achieved, in short plain sentences a person
// scans. One Haiku call when it finishes, so the words are there before anyone
// looks. Written bottom-up: an agent from its own report, a workflow phase from
// its agents' reports, a cluster or a workflow from its part reports.
type Completion = { isAnswered: boolean; text?: string; usage?: { input_tokens: number; output_tokens: number } }
// a reply that is not the asked-for JSON still says something: its first sentence is the result
function reportFrom(r: Completion | undefined): Report | undefined {
  if (!r?.isAnswered || !r.text) return undefined
  const fallback = firstSentence(r.text, 300)
  const parsed = parseReport(r.text) ?? (fallback ? { result: fallback } : undefined)
  if (!parsed) return undefined
  const tokens = r.usage ? r.usage.input_tokens + r.usage.output_tokens : 0
  return { ...parsed, model: 'Haiku', ...(tokens ? { tokens } : {}) }
}

async function digest($: Engine, id: string) {
  if (digesting.has(id)) return
  const list = await read($, nodes)
  const n = list.find(x => x.id === id)
  if (!n || n.digested || n.status === 'running') return
  const kids = list.filter(k => k.parentId === id)
  // a cluster's report reads its members' reports: wait until each finished member has one;
  // a workflow waits for the agent reports still being written, then writes what it has
  if (n.kind === 'group' && kids.some(k => k.status !== 'running' && !k.digested && k.result)) return
  if (n.kind === 'workflow' && kids.some(k => digesting.has(k.id))) return
  digesting.add(id)
  if (n.kind === 'workflow') await writeParts($, id, true)
  const now = await read($, nodes)
  const node = now.find(x => x.id === id) ?? n
  const hasInput = node.kind === 'agent' ? !!node.result?.trim() : kids.length > 0 || !!node.result?.trim()
  const r = hasInput
    ? await $.model.complete({ model: 'haiku', maxTokens: 400, system: REPORT_SYSTEM, prompt: runInput(node, now) }).catch(() => undefined)
    : undefined
  const report = reportFrom(r)
  await patch($, id, x => ({
    ...x, digested: true,
    ...(report ? { report, ...(report.result ? { summary: report.result } : {}), ...(report.done ? { points: report.done } : {}) } : {}),
  }))
  // released only once the report is stored, so a second trigger cannot write it twice
  digesting.delete(id)
  await archive($)
  // an agent's report may be what its cluster, its workflow or its phase was waiting for
  const parent = node.parentId ? (await read($, nodes)).find(x => x.id === node.parentId) : undefined
  if (!parent || (parent.kind !== 'group' && parent.kind !== 'workflow')) return
  if (parent.status !== 'running') { if (!parent.digested) void digest($, parent.id) }
  else if (parent.kind === 'workflow') void writeParts($, parent.id, false)
}

// A workflow's phases that have finished get a part report each, read from their
// agents' reports. While the run goes on, a phase waits until each of its agents
// has its own short report; when the run ends (`force`), it is written
// from what there is. A phase that gained agents since its report is written again.
async function writeParts($: Engine, wfId: string, force: boolean) {
  const list = await read($, nodes)
  const wf = list.find(n => n.id === wfId)
  if (!wf) return
  for (const p of pipeline(wf, list)) {
    if (p.running > 0 || p.total === 0) continue
    const agents = list.filter(k => k.parentId === wfId && (k.phase ?? 'Agents') === p.phase)
    if (!force && agents.some(k => !k.digested)) continue
    await partDigest($, wfId, p.phase)
  }
}

async function partDigest($: Engine, wfId: string, phase: string) {
  const key = `${wfId}::${phase}`
  if (digesting.has(key)) return
  const list = await read($, nodes)
  const wf = list.find(n => n.id === wfId)
  const total = list.filter(k => k.parentId === wfId && (k.phase ?? 'Agents') === phase).length
  // read now, not when the caller looked: another trigger may have written it meanwhile
  if (!wf || wf.partReports?.[phase]?.count === total) return
  digesting.add(key)
  const r = await $.model.complete({ model: 'haiku', maxTokens: 300, system: REPORT_SYSTEM, prompt: partInput(wf, phase, list) }).catch(() => undefined)
  const report = reportFrom(r)
  await patch($, wfId, x => ({ ...x, partReports: { ...x.partReports, [phase]: { ...(report ?? {}), count: total } } }))
  digesting.delete(key)
}

type Change = NonNullable<AgentNode['changes']>
const addChange = (prev: AgentNode['changes'], e: { path: string; added: number; removed: number }): Change => {
  const c = prev?.[e.path] ?? { edits: 0, added: 0, removed: 0 }
  return { ...prev, [e.path]: { edits: c.edits + 1, added: c.added + e.added, removed: c.removed + e.removed } }
}

const slim = (n: AgentNode): AgentNode => ({ ...n, prompt: excerpt(n.prompt, 300), result: excerpt(n.result, 600), activity: undefined, act: undefined })

// The session's root folder: where it started, or where /cd moved it. A shell
// cd does not move it, and neither does the folder the mod's commands run in.
async function sessionRepo($: Engine): Promise<string | undefined> {
  return (await $.session.root().catch(() => '')) || undefined
}

// Runs saved before the repo was the root folder get its key from where their
// transcripts are kept: ~/.claude/projects/<root folder key>/..., once.
async function backfillRepos($: Engine) {
  const history = ((await $.store.get(HISTORY)) as AgentNode[] | undefined) ?? []
  const byId = new Map(history.map(n => [n.id, n]))
  const topOf = (n: AgentNode): AgentNode => (n.parentId && byId.has(n.parentId) ? topOf(byId.get(n.parentId)!) : n)
  const tops = history.filter(n => topOf(n) === n && !n.repoTried)
  if (tops.length === 0) return
  const agentsUnder = new Map(tops.map(t => [t.id, history.filter(n => n.kind === 'agent' && topOf(n) === t).map(n => n.id)]))
  const ids = [...new Set([...agentsUnder.values()].flat())]
  const home = await $.env.get('HOME')
  const names = ids.flatMap((id, i) => [...(i ? ['-o'] : []), '-name', `agent-${id}.jsonl`])
  const found = ids.length
    ? await $.process.run(['find', `${home}/.claude/projects`, '-maxdepth', '6', '(', ...names, ')'], { timeoutMs: 20000 }).catch(() => undefined)
    : undefined
  const keyOf = new Map((found?.stdout ?? '').split('\n').filter(Boolean).map(p => [p.replace(/^.*agent-|\.jsonl$/g, ''), p.split('/projects/')[1]?.split('/')[0]]))
  const keys = new Map(tops.map(t => [t.id, (agentsUnder.get(t.id) ?? []).map(id => keyOf.get(id)).find(Boolean)]))
  await $.store.set(HISTORY, history.map(n => {
    if (!keys.has(n.id)) return n
    const key = keys.get(n.id)
    // a key from the transcript's folder wins over a repo recorded from the wrong folder
    const { repo: _repo, ...rest } = n
    return key ? { ...rest, repoKey: key, repoTried: true } : { ...n, repoTried: true }
  }))
}

// The repo as a view prop: left out when there is none, since props hold no undefined.
async function repoProp($: Engine): Promise<{ repo?: string }> {
  const repo = await sessionRepo($)
  return repo ? { repo } : {}
}

// Runs kept before reports were read from SubagentHandback calls get theirs
// from their transcripts, once.
async function backfillReports($: Engine) {
  const history = ((await $.store.get(HISTORY)) as AgentNode[] | undefined) ?? []
  const todo = history.filter(n => n.kind === 'agent' && !n.result && !n.reportTried)
  if (todo.length === 0) return
  const home = await $.env.get('HOME')
  const names = todo.flatMap((n, i) => [...(i ? ['-o'] : []), '-name', `agent-${n.id}.jsonl`])
  const found = await $.process.run(['find', `${home}/.claude/projects`, '-maxdepth', '6', '(', ...names, ')'], { timeoutMs: 20000 }).catch(() => undefined)
  const pathOf = new Map((found?.stdout ?? '').split('\n').filter(Boolean).map(p => [p.replace(/^.*agent-|\.jsonl$/g, ''), p]))
  const reports = new Map<string, string>()
  for (const n of todo) {
    const path = pathOf.get(n.id)
    const report = path ? handbackOf(await $.fs.read(path).catch(() => '')) : undefined
    if (report) reports.set(n.id, report)
  }
  const tried = new Set(todo.map(n => n.id))
  await $.store.set(HISTORY, history.map(n => (tried.has(n.id) ? { ...n, reportTried: true, ...(reports.has(n.id) ? { result: excerpt(reports.get(n.id), 600) } : {}) } : n)))
}

// A finished top-level run, with everything under it, is kept across sessions.
async function archive($: Engine) {
  const list = await read($, nodes)
  const ids = new Set(list.map(n => n.id))
  const tops = list.filter(n => !n.parentId || !ids.has(n.parentId))
  const subtree = (id: string): AgentNode[] => list.filter(n => n.parentId === id).flatMap(k => [k, ...subtree(k.id)])
  const done = tops.map(t => [t, ...subtree(t.id)]).filter(run => run.every(n => n.status !== 'running'))
  if (done.length === 0) return
  const prev = ((await $.store.get(HISTORY)) as AgentNode[] | undefined) ?? []
  const repo = await sessionRepo($)
  const fresh = done.flat().map(slim).map(n => (repo && !n.repo ? { ...n, repo, repoTried: true } : n))
  const freshIds = new Set(fresh.map(n => n.id))
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
  if (fresh.every(f => prev.some(p => p.id === f.id && p.status === f.status && p.label === f.label && p.summary === f.summary && p.parentId === f.parentId
    && same(p.report, f.report) && same(p.partReports, f.partReports)))) return
  const merged = [...prev.filter(p => !freshIds.has(p.id)), ...fresh]
  const runTops = merged.filter(n => !n.parentId || !merged.some(m => m.id === n.parentId))
  const keep = new Set(runTops.slice(-HISTORY_RUNS).map(n => n.id))
  const rootOf = (n: AgentNode): string => {
    const p = n.parentId && merged.find(m => m.id === n.parentId)
    return p ? rootOf(p) : n.id
  }
  await $.store.set(HISTORY, merged.filter(n => keep.has(rootOf(n))))
  // their edits go with them, so History can still show the diffs
  const kept = new Set(merged.filter(n => keep.has(rootOf(n))).map(n => n.id))
  const pastEdits = ((await $.store.get(EDITS)) as EditRecord[] | undefined) ?? []
  const freshEdits = (await read($, edits)).filter(r => freshIds.has(r.agentId)).map(r => ({ ...r, old: r.old.slice(0, 2500), new: r.new.slice(0, 2500) }))
  const known = new Set(pastEdits.map(r => r.id))
  await $.store.set(EDITS, [...pastEdits, ...freshEdits.filter(r => !known.has(r.id))].filter(r => kept.has(r.agentId)).slice(-EDITS_KEPT))
}

export const register: Register = (on, options) => {
  themeName = options?.theme === 'kitty' ? 'kitty' : 'minimal'
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'agent-tree',
      description: 'Show subagents and workflows in a side pane (`clear` empties the history)',
    })
    await archive($)
    await backfillReports($)
    await backfillRepos($)
    if ((await read($, nodes)).some(n => n.status === 'running')) ensureTimers($)

    return next(e)
  })

  on('command.run', { command: 'agent-tree' }, async ($, e) => {
    if (e.args.trim() === 'clear') {
      await update($, nodes, list => list.filter(n => n.status === 'running'))
      await $.store.set(HISTORY, [])
      await $.store.set(EDITS, [])
      await update($, edits, () => [])
      return { text: 'Agent history cleared.' }
    }
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Agents pane opened. Click it; ? shows the keys.' }
  })

  on('tool.call', { tool: 'Agent' }, (_$, e, next) => {
    agentCalls.add(e.tool_use_id)
    if (e.isolation) isolationOf.set(e.tool_use_id, e.isolation)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const startedAt = await $.clock.now()
    const ran = await next(e)
    if (ran.deny !== undefined || !ran.agentId) return ran

    const list = await read($, nodes)
    const fromWorkflow = !agentCalls.has(e.tool_use_id) ? runningWorkflow(list) : undefined
    const fromMain = !e.parentAgentId && !fromWorkflow
    const t = fromMain ? (turn ??= `t${startedAt}`) : undefined
    await add($, {
      id: ran.agentId,
      kind: 'agent',
      parentId: e.parentAgentId ?? fromWorkflow?.id,
      turn: t,
      label: e.name ?? e.description,
      type: e.subagentType,
      model: ran.model,
      where: isolationOf.get(e.tool_use_id) ?? 'main',
      status: 'running',
      startedAt,
      tools: 0,
      act: 'think',
      prompt: excerpt(e.prompt),
      titled: !fromWorkflow,
    })
    const group = t ? await regroup($, t) : undefined
    if (group) void titleGroup($, group)

    return ran
  })

  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    const id = `wf:${e.tool_use_id}`
    const name = e.name ?? scriptField(e.script, 'name') ?? 'workflow'
    const description = scriptField(e.script, 'description')
    await add($, {
      id, kind: 'workflow', parentId: e.agentId, label: description ?? name, tag: name, type: 'workflow',
      status: 'running', startedAt: await $.clock.now(), tools: 0, prompt: description,
    })
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) {
      await patch($, id, finish('failed', await $.clock.now()))
    } else {
      const { taskId, workflowName, transcriptDir } = ran.result
      await patch($, id, n => ({ ...n, taskId, transcriptDir, tag: workflowName ?? n.tag }))
      ensureTimers($)
    }

    return ran
  })

  on('tool.call', async ($, e, next) => {
    if (!e.agentId) return next(e)
    const { agentId, tool } = e
    const input = e as unknown as Record<string, unknown>
    const { act, activity } = describeTool(tool, input)
    const list = await read($, nodes)
    const calledAt = await $.clock.now()
    if (list.some(n => n.id === agentId)) {
      await patch($, agentId, n => ({
        ...n, tools: n.tools + 1, lastTool: tool, lastToolAt: calledAt, act, activity, status: 'running', endedAt: undefined,
        work: act === 'think' ? n.work : { ...n.work, [act]: (n.work?.[act] ?? 0) + 1 },
      }))
      // An agent that hands its report back through a tool ends with no final text.
      // SubagentHandback is not in the typed tool list, so the name is compared as a string.
      if ((tool as string) === 'SubagentHandback' && typeof input.message === 'string') {
        const report = input.message
        await patch($, agentId, n => ({ ...n, result: excerpt(report) }))
      }
      ensureTimers($)
    } else {
      // A workflow agent seen before its journal line: filed under the running
      // workflow now, and corrected by the journal on the next poll.
      const wf = runningWorkflow(list)
      if (!wf) return next(e)
      await add($, {
        id: agentId, kind: 'agent', parentId: wf.id, label: `agent ${agentId.slice(0, 6)}`,
        status: 'running', startedAt: calledAt, tools: 1, lastTool: tool, lastToolAt: calledAt, act, activity,
        work: act === 'think' ? {} : { [act]: 1 },
      })
    }

    // An edit is recorded once it has landed: its before and after text, where it
    // sits in the file, and a true line count of what it added and removed.
    const path = editedPath(tool, input)
    if (!path) return next(e)
    const before = tool === 'Write' ? await $.fs.read(path).catch(() => undefined) : undefined
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError) return ran
    const after = await $.fs.read(path).catch(() => undefined)
    const at = await $.clock.now()
    const recs = editRecords(tool, input, before, after).map((r, i) => ({
      ...r, id: `${e.tool_use_id}:${i}`, agentId, at,
      old: r.old.slice(0, EDIT_TEXT), new: r.new.slice(0, EDIT_TEXT),
    }))
    const stats = recs.map(r => diffCounts(lineDiff(r.old, r.new)))
    await update($, edits, all => [...all, ...recs].slice(-EDITS_KEPT))
    await patch($, agentId, n => {
      let changes = n.changes
      for (const s of stats) changes = addChange(changes, { path, ...s })
      return { ...n, changes }
    })
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const { agentId } = e
    if (agentId) {
      const at = await $.clock.now()
      const u = e.usage
      const tokens = u ? u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens : undefined
      const status: NodeStatus = e.isAborted ? 'killed' : 'done'
      const list = await read($, nodes)
      const wf = runningWorkflow(list)
      if (list.some(n => n.id === agentId)) {
        await patch($, agentId, n => ({
          ...finish(status, at)(n),
          model: n.model ?? u?.model,
          result: excerpt(e.answer) ?? n.result,
          tokens: (n.tokens ?? 0) + (tokens ?? 0),
        }))
      } else if (wf) {
        // A workflow agent that never called a tool is first seen as it ends.
        await add($, {
          id: agentId, kind: 'agent', parentId: wf.id, label: `agent ${agentId.slice(0, 6)}`,
          model: u?.model, status, startedAt: at - e.durationMs, endedAt: at, tools: 0,
          result: excerpt(e.answer), tokens,
        })
      }
      void digest($, agentId)
      await announce($, agentId)
      await settleGroups($)
      await archive($)
    }

    return next(e)
  })

  // A background task's end reaches the main loop as a queued prompt whose
  // origin is `task-notification`, its text naming the task id and status.
  on('prompt.submit', async ($, e, next) => {
    // a prompt taken while idle opens a new turn; one delivered into a running turn
    // (typed ahead, or a background task's notice) stays part of it
    if (!e.turnId) turn = `t${await $.clock.now()}`
    if (e.origin.kind === 'task-notification') {
      const id = /<task-id>\s*([^<\s]+)/.exec(e.text)?.[1]
      if (id) await endWorkflow($, id, /<status>\s*(\w+)/.exec(e.text)?.[1], /<result>([\s\S]*?)<\/result>/.exec(e.text)?.[1]?.trim())
    }
    return next(e)
  })

  // Backstop: at each stop the engine lists the background work still in flight.
  // A running workflow missing from that list has ended.
  on('classic.Stop', async ($, e, next) => {
    if (e.transcript_path) subagentsDir = `${e.transcript_path.replace(/\.jsonl$/, '')}/subagents`
    const inFlight = e.background_tasks
    if (Array.isArray(inFlight)) {
      const live = new Set(inFlight.map(t => t.id))
      const gone = (await read($, nodes)).filter(n => n.kind === 'workflow' && n.status === 'running' && n.taskId && !live.has(n.taskId))
      for (const wf of gone) if (wf.taskId) await endWorkflow($, wf.taskId, 'completed')
    }
    return next(e)
  })

  // The transcript's own Agent and Workflow rows shrink to one line; the pane is the full view.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const { tool, isRunning, isErrored } = e.props
    if (!AGENT_TOOLS.has(tool) && tool !== 'Workflow') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const input = (e.props.input ?? {}) as { description?: string; subagent_type?: string; name?: string; script?: string }
    const label = tool === 'Workflow'
      ? scriptField(input.script, 'description') ?? input.name ?? scriptField(input.script, 'name') ?? 'workflow'
      : input.description ?? 'subagent'
    const kind = tool === 'Workflow' ? 'Workflow' : `${input.subagent_type ?? 'General-purpose'} agent`
    const t = themeOf(themeName)
    const st = t.status[isErrored ? 'failed' : isRunning ? 'running' : 'done']

    return (
      <Box flexDirection="row" gap={1}>
        <Text color={st.color}>{st.icon}</Text>
        {/* one glyph means status; only a workflow adds one for what it is */}
        {tool === 'Workflow' ? <Text>{t.kind.workflow}</Text> : null}
        <Text bold wrap="truncate-end">{label}</Text>
        <Text dimColor>· {kind} · details in the Agents pane</Text>
      </Box>
    )
  })

  // The view asks for a file's diff when it opens one, and lets it go when it closes it.
  on('ui.message', async ($, e, next) => {
    const data = e.data as { type?: unknown; path?: unknown } | null
    if (e.requestId !== PANE || data?.type !== 'diff') return next(e)
    diffPath = typeof data.path === 'string' ? data.path : null
    return { props: await viewProps($) }
  })

  // The pane's rows are the view's own, so the engine has nothing to scroll:
  // each wheel tick is handed to the view, which moves its selection or text.
  on('ui.scroll', { requestId: PANE }, async ($, e, next) => {
    if (e.origin.kind !== 'person') return next(e)
    await update($, wheel, w => ({ seq: (w?.seq ?? 0) + 1, by: e.by }))
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    // the pane body's own height: the viewport is the whole terminal, frame and all
    const rows = Math.max(8, e.props.scroll?.bodyRows ?? (e.viewport?.rows ?? 24) - 4)
    if (!('Client' in els)) return <els.Text dimColor>The Agents pane needs the terminal or desktop.</els.Text>
    const { Client } = els

    return <Client key={VIEW_KEY} module="./view.tsx" props={await viewProps($)} width="100%" height={rows} />
  })
}

async function viewProps($: Engine): Promise<ViewProps> {
  const history = ((await $.store.get(HISTORY)) as AgentNode[] | undefined) ?? []
  const base = { ...fitProps({ nodes: await read($, nodes), history, at: await $.clock.now() }), ...await repoProp($), theme: themeName, wheel: await read($, wheel) }
  if (!diffPath) return base
  await backfill($, diffPath, [...history, ...base.nodes])
  const pastEdits = ((await $.store.get(EDITS)) as EditRecord[] | undefined) ?? []
  const seen = new Set<string>()
  const forFile = [...pastEdits, ...(await read($, edits))]
    .filter(r => r.path === diffPath && !seen.has(r.id) && seen.add(r.id))
    .sort((a, b) => a.at - b.at)
  return { ...base, diff: { path: diffPath, edits: forFile } }
}

// Agents that changed this file but left no edit records (runs from before edits
// were kept) get theirs rebuilt from their transcripts, once, and stored.
async function backfill($: Engine, path: string, all: AgentNode[]) {
  const stored = ((await $.store.get(EDITS)) as EditRecord[] | undefined) ?? []
  const live = await read($, edits)
  const has = new Set([...stored, ...live].filter(r => r.path === path).map(r => r.agentId))
  const byId = new Map(all.map(n => [n.id, n]))
  const todo = [...byId.values()].filter(n => n.changes?.[path] && !has.has(n.id) && !backfilled.has(n.id))
  if (todo.length === 0) return
  const now = await $.fs.read(path).catch(() => undefined)
  const found: EditRecord[] = []
  for (const n of todo) {
    backfilled.add(n.id)
    const dir = n.parentId ? byId.get(n.parentId)?.transcriptDir : undefined
    const sessionAgents = subagentsDir ?? dir?.replace(/\/workflows\/[^/]+$/, '')
    const file = dir ? `${dir}/agent-${n.id}.jsonl` : sessionAgents ? `${sessionAgents}/agent-${n.id}.jsonl` : undefined
    if (!file) continue
    const text = await $.fs.read(file).catch(() => '')
    found.push(...transcriptEdits(text, n.id, now).filter(r => r.path === path)
      .map(r => ({ ...r, old: r.old.slice(0, 2500), new: r.new.slice(0, 2500) })))
  }
  if (found.length === 0) return
  const known = new Set(stored.map(r => r.id))
  await $.store.set(EDITS, [...stored, ...found.filter(r => !known.has(r.id))].slice(-EDITS_KEPT))
}
