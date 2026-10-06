// Every string the model reads from this plugin: tool descriptions, the block reference, the prompt guide.
// Tool descriptions reach the model only up to 2048 characters; tests hold them to that.

import type { BriefMode } from '../types'

export const SHOW = 'mcp__brief__show'
export const NOTE = 'mcp__brief__note'
export const PATCH = 'mcp__brief__patch'
export const GUIDE_TOOL = 'mcp__brief__guide'
export const STATUS = 'mcp__brief__status'

/** The system-prompt section that makes the pane the default, by mode. */
export const GUIDE: Record<Exclude<BriefMode, 'off'>, string> = {
  on: `# The Brief pane
A Brief pane sits beside the chat (tools ${GUIDE_TOOL}, ${SHOW}, ${PATCH}, ${NOTE}, ${STATUS}; load them with ToolSearch if they are deferred, and call ${GUIDE_TOOL} once before your first show). Use it without being asked whenever your answer is something the user will read in parts, explore or decide on: a plan or design, how a system or an area of the code works, a comparison of approaches, a review, a debugging diagnosis, or a "show me", "walk me through" or "what would it take" question. Then keep the chat reply to two or three lines that point at the pane. Keep quick facts, short answers and routine edits in chat. If the user says "in chat" or "just tell me", answer in chat.
Keep one living brief per task. Lay out the design space as sections with decisions (rich options: pros, cons and one exhibit each). Change it with ${PATCH}; never resend a whole brief for a small change. Answer messages tagged [brief <id>] with ${NOTE} on that point. When open decisions change what you build, wait for the user's Respond before building. While building, set each plan point's status with ${STATUS} (running, then review, then done or failed) and attach the evidence (test output, a diff, a figure) to the point it proves; a point is done only with evidence. Put [brief <id>] in a subagent's description so the pane links it to that point. For the discipline itself, use this plugin's skills: test-first, debugging, verification and review.`,
  suggest: `# The Brief pane
A Brief pane sits beside the chat (tools ${GUIDE_TOOL}, ${SHOW}, ${PATCH}, ${NOTE}, ${STATUS}; load them with ToolSearch if they are deferred, and call ${GUIDE_TOOL} once before your first show). Use it when the user asks to see something as a plan, a brief or a diagram, or asks to open an answer as a brief. Change a shown brief with ${PATCH} and answer messages tagged [brief <id>] with ${NOTE}.`,
}

export const SHOW_DESCRIPTION = `Show a brief in the Brief pane beside the chat: a plan, design, explanation, comparison or review the user will read in parts or decide on. Call ${GUIDE_TOOL} once per session before your first show: it returns the block syntax.
Shape: {title (3-7 words), gist (one sentence, the whole answer), why?, changes?, points, terms?, gate?}. points: 2 to 6 top-level claims that tell the whole story when read alone; each claim one true-or-false sentence, about 12 words; split by behaviour, never by file. Children answer "how", then "where" (at most 5 children, 3 levels). End with {aux:"shared"} and {aux:"scope"} when they apply.
Each point has ONE exhibit: detail (markdown), code ({src, lines} reads a real file), schema, calls, flow, seq, machine, tree, table, mock, svg, or image (a PNG you rendered). Then optional caption, note {tone, text}, ask (a decision, 2 to 5 per plan; options may carry pros, cons and an exhibit), when ("2=no": shown only under that answer).
show refuses a brief that breaks the rules and says why. Use ${PATCH} for later changes. Answer messages tagged [brief <id>] with ${NOTE}. Do not build until the reader's Respond when the brief has open decisions that change what you build.`


/** The full block reference. Tool descriptions reach the model only up to 2048 characters, so this is served by the guide tool. */
export const REFERENCE = `Brief pane reference (html-plan's blocks, drawn natively). Read once; then write briefs with show and change them with patch.

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
- table: {title, columns:["Lane","Owner",…], rows:[["a","b",…],…]} or a Markdown table string — for any comparison or list of records. The pane fits it to its width: a grid when the columns fit, one record per row when they do not. Put the row's name in the first column. Use this, not a table inside detail.
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

export const NOTE_DESCRIPTION = `Add your answer, or a question for the reader, under one point of the Brief pane. point: the point id ("1.2", "shared", "scope"), or "top" for the brief as a whole. text: markdown, short.`

export const PATCH_DESCRIPTION = `Change the brief in the Brief pane without resending it. ops, applied in order:
- {op:"set", id, point}: replace point id with point (same fields as show; its children stay unless point.points is given).
- {op:"add", parent?, after?, point}: add a point as a child of parent (top level when absent), after the point "after" or at the end.
- {op:"remove", id}.
- {op:"meta", title?, gist?, why?, changes?, terms?, gate?}.
Ids are the ones the pane shows ("2.1", "shared"). Answers, notes and statuses follow their points when ids shift. Changed and added points are marked for the reader.`

export const STATUS_DESCRIPTION = `Report build progress on brief points. updates: [{point, state, note?, evidence?}]. state: queued, running, review (work finished, not yet proved), done, failed or blocked. evidence proves the point: {title?, text?} or {title?, code: {source, language?, diff?}} (test output, a diff) or {title?, image: "path to a PNG"}. Mark a point done only with evidence; the pane flags done points that have none.`
