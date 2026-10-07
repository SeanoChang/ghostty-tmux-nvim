// Parsers and layouts from html-plan's htmlplan.js (lines 10-28 and 30-341),
// copied unchanged. html-plan by Thariq Shihipar: MIT per its plugin.json (the repo LICENSE is Apache-2.0),
// https://github.com/anthropics/claude-plugins-community/tree/main/html-plan
// The DOM-only srcOf() is left out; everything here is pure.
const NW = {};
/* ───────────────────────── utils ───────────────────────── */
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const words = (s, n) => { const w = String(s).trim().split(/\s+/); return w.slice(0, n).join(' ') + (w.length > n ? '…' : ''); };
function dedent(text) {
  const lines = String(text).replace(/\t/g, '  ').split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const ind = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length), 999);
  return lines.map((l) => l.slice(ind === 999 ? 0 : ind)).join('\n');
}
const MARK = { '+': 'new', '-': 'gone', '~': 'mod', '!': 'hl' };
function takeMark(line) { const m = line.match(/^([+\-~!])\s+(?=\S)|^([+\-!])(?=[A-Za-z_])/); return m && !/^--/.test(line) && !/^->/.test(line) ? [MARK[m[1] || m[2]], line.slice(m[0].length)] : [null, line]; }
/* ───────────────────────── parsers (pure) ───────────────────────── */
const SHAPES = new Set(['box', 'pill', 'diamond', 'db', 'circle', 'note', 'hex', 'actor']);
const TONES = new Set(['accent', 'green', 'amber', 'red', 'blue', 'purple', 'muted', 'ink']);
const EDGE_RE = /^(\S+)\s+(<?)(-->|->|=>|==>|-x->|\.\.>)\s*(\S+?)(?:\s*:\s*(.*))?$/;

/** Flow DSL → { nodes:{id:{id,label,sub,shape,tone,mark,href,detail}}, edges:[], grid:[[id|null]], groups:[], dir, errors:[] } */
NW.parseFlow = function parseFlow(text) {
  const m = { nodes: {}, order: [], edges: [], grid: [], groups: [], dir: 'TB', errors: [] };
  const node = (id, ln) => { if (!/^[\w.-]+$/.test(id)) m.errors.push(`line ${ln}: bad node id "${id}"`); if (!m.nodes[id]) { m.nodes[id] = { id, label: id, sub: '', shape: 'box', tone: '', mark: null, href: '', detail: [] }; m.order.push(id); } return m.nodes[id]; };
  let last = null;
  text.split('\n').forEach((raw, i) => {
    const ln = i + 1;
    if (!raw.trim() || /^\s*\/\//.test(raw)) return;
    if (/^\s+\S/.test(raw) && last) { last.detail.push(raw.trim()); return; }   // indented → detail of previous node
    let line = raw.trim(); last = null;
    let [mark, rest] = takeMark(line); line = rest;
    let mm;
    if ((mm = line.match(/^dir\s*[:=]?\s*(LR|TB)$/i))) { m.dir = mm[1].toUpperCase(); return; }
    if (line.startsWith('|')) {                                                     // grid row
      const cells = line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      m.grid.push(cells.map((c) => (c && c !== '.' && c !== '·') ? (node(c, ln), c) : null)); return;
    }
    if ((mm = line.match(/^group\s+(?:"([^"]+)"|([^:]+?))\s*:\s*(.+)$/i))) {
      const ids = mm[3].split(/[\s,]+/).filter(Boolean); ids.forEach((id) => node(id, ln));
      m.groups.push({ label: mm[1] || mm[2], ids, tone: '' }); return;
    }
    if ((mm = line.match(EDGE_RE))) {
      const [, a, back, op, b, label] = mm; node(a, ln); node(b, ln);
      m.edges.push({ from: a, to: b, label: (label || '').trim(), dash: op === '-->' || op === '..>', bold: op === '=>' || op === '==>', both: back === '<', mark, ln }); return;
    }
    if ((mm = line.match(/^([\w.-]+)\s*=\s*(.*)$/))) {                               // node def
      const n = node(mm[1], ln); let body = mm[2];
      const attr = body.match(/\[([^\]]*)\]\s*$/); if (attr) { body = body.slice(0, attr.index).trim();
        attr[1].split(/[\s,]+/).filter(Boolean).forEach((t) => { if (SHAPES.has(t)) n.shape = t; else if (TONES.has(t)) n.tone = t; else if (t.startsWith('#')) n.href = t; else m.errors.push(`line ${ln}: unknown node attribute "${t}" (shapes: ${[...SHAPES].join(' ')}; tones: ${[...TONES].join(' ')})`); }); }
      const parts = body.split(/\s+\/\s+/); n.label = parts[0].replace(/\\n/g, '\n') || n.id; n.sub = parts.slice(1).join(' / ');
      if (mark) n.mark = mark; last = n; return;
    }
    if (/^[\w.-]+$/.test(line)) { const n = node(line, ln); if (mark) n.mark = mark; last = n; return; }
    m.errors.push(`line ${ln}: couldn't parse "${line}" — expected  id = Label [attrs]  |  a -> b : label  |  | a | b |  |  group Name: a b`);
  });
  // grid sanity
  const seen = {}; m.grid.forEach((row, r) => row.forEach((id, c) => { if (!id) return; if (seen[id]) m.errors.push(`grid: "${id}" appears twice (${seen[id]} and ${r},${c})`); seen[id] = `${r},${c}`; }));
  if (m.grid.length) m.order.forEach((id) => { if (!seen[id]) m.errors.push(`grid: node "${id}" is used but has no cell — add it to a | row |`); });
  return m;
};

/** Sequence DSL → { actors:[{id,label}], steps:[{kind:'msg'|'note'|'div', ...}], errors } */
NW.parseSeq = function parseSeq(text) {
  const m = { actors: [], steps: [], errors: [] }; const idx = {};
  const actor = (id, label) => { if (!(id in idx)) { idx[id] = m.actors.length; m.actors.push({ id, label: label || id }); } else if (label) m.actors[idx[id]].label = label; };
  text.split('\n').forEach((raw, i) => {
    const ln = i + 1; let line = raw.trim(); if (!line || line.startsWith('//')) return;
    let mm;
    if ((mm = line.match(/^participants?\s*:\s*(.+)$/i))) { mm[1].match(/[\w.-]+(?:\s+"[^"]*")?/g).forEach((p) => { const q = p.match(/^([\w.-]+)(?:\s+"([^"]*)")?/); actor(q[1], q[2]); }); return; }
    if ((mm = line.match(/^---+\s*(.*?)\s*-*$/))) { m.steps.push({ kind: 'div', text: mm[1] }); return; }
    if ((mm = line.match(/^note\s+(?:over|on)\s+([\w.,\s-]+?)\s*:\s*(.+)$/i))) { const ids = mm[1].split(/[\s,]+/).filter(Boolean); ids.forEach((a) => actor(a)); m.steps.push({ kind: 'note', over: ids, text: mm[2] }); return; }
    let [mark, rest] = takeMark(line);
    if ((mm = rest.match(EDGE_RE))) { const [, a, , op, b, label] = mm; actor(a); actor(b); m.steps.push({ kind: 'msg', from: a, to: b, text: (label || '').trim(), dash: op === '-->' || op === '..>', lost: op === '-x->', mark, ln }); return; }
    m.errors.push(`line ${ln}: couldn't parse "${line}" — expected  a -> b : message  |  a --> b : reply  |  note over a: text  |  --- label ---`);
  });
  return m;
};

/** Schema DSL → { entities:[{name,note,mark,fields:[{name,type,flags,ref,note,mark}]}], errors } */
NW.parseSchema = function parseSchema(text) {
  const m = { entities: [], errors: [] }; let cur = null;
  text.split('\n').forEach((raw, i) => {
    const ln = i + 1; if (!raw.trim() || /^\s*\/\//.test(raw)) return;
    const indented = /^\s/.test(raw); let line = raw.trim();
    let note = ''; const ni = line.indexOf(' // '); if (ni >= 0) { note = line.slice(ni + 4).trim(); line = line.slice(0, ni).trim(); } else if (line.includes('  # ')) { const hi = line.indexOf('  # '); note = line.slice(hi + 4).trim(); line = line.slice(0, hi).trim(); }
    let [mark, rest] = takeMark(line); line = rest;
    const looksField = mark && cur && line.split(/\s+/).length >= 2 && !/^[\w.]+\s*:/.test(line);
    if (!indented && !looksField) { const mm = line.match(/^([\w.]+)\s*(?::\s*(.*))?$/); if (!mm) { m.errors.push(`line ${ln}: bad entity line "${line}" — entities are  Name  or  Name : note ; fields must be indented`); return; } cur = { name: mm[1], note: mm[2] || note, mark, fields: [] }; m.entities.push(cur); return; }
    if (!cur) { m.errors.push(`line ${ln}: field before any entity`); return; }
    const toks = line.split(/\s+/); const f = { name: toks.shift(), type: '', flags: [], ref: '', note, mark };
    while (toks.length) { const t = toks.shift(); if (t === '->' || t === '→') f.ref = toks.shift() || ''; else if (t.startsWith('->')) f.ref = t.slice(2); else if (!f.type && !/^(pk|fk|unique|null|nullable|idx|index|\?|!)$/i.test(t) && !t.includes('=')) f.type = t; else f.flags.push(t); }
    if (f.ref && !f.type) f.type = 'fk';
    cur.fields.push(f);
  });
  const names = new Set(m.entities.map((e) => e.name));
  m.entities.forEach((e) => e.fields.forEach((f) => { if (f.ref) { const t = f.ref.split('.')[0]; if (!names.has(t)) m.errors.push(`${e.name}.${f.name} -> ${f.ref}: no entity "${t}"`); } }));
  return m;
};

/** Tree DSL (indented paths) → { rows:[{depth,name,dir,note,mark,last:[]}], errors } */
NW.parseTree = function parseTree(text) {
  const rows = []; const errors = [];
  text.split('\n').forEach((raw) => {
    if (!raw.trim()) return; const ind = raw.match(/^ */)[0].length; let line = raw.trim();
    let note = ''; const hi = line.search(/\s+#\s/); if (hi >= 0) { note = line.slice(hi).replace(/^\s+#\s/, ''); line = line.slice(0, hi); }
    let [mark, rest] = takeMark(line);
    rows.push({ ind, name: rest, dir: rest.endsWith('/'), note, mark });
  });
  const levels = [...new Set(rows.map((r) => r.ind))].sort((a, b) => a - b);
  rows.forEach((r) => { r.depth = levels.indexOf(r.ind); });
  // compute "is last sibling" chain for guides
  rows.forEach((r, i) => { r.last = []; for (let d = 0; d <= r.depth; d++) { let last = true; for (let j = i + 1; j < rows.length; j++) { if (rows[j].depth < d) break; if (rows[j].depth === d) { last = false; break; } } r.last[d] = last; } });
  return { rows, errors };
};

/** Call-tree diff DSL → { roots:[node], nodes:[node], errors }
 *  node = { id, depth, mark:' '|'+'|'-'|'~'|'?', name, kind, loc, file, line, note, tags:{ui,net,data,cond,new}, children, parent }
 *  line grammar:  [mark] <indent> name  [@ file[:line]]  [-- note]      indent = 2 spaces per level (tabs ok)
 *  name conventions:  <Comp/> → ui · post(/…) | POST … | fetch( → net · if (…) / else → cond · **bold** or *x* → new symbol
 *  a leading `…` line ("… 5 framework frames") is a collapsed gap row */
NW.parseCalls = function parseCalls(text) {
  const m = { roots: [], nodes: [], errors: [] }; const stack = [];
  // pass 1: split mark from body, measure indent of the body; depth is relative to the shallowest line
  const pre = []; text.replace(/\t/g, '  ').split('\n').forEach((raw, i) => {
    if (!raw.trim() || /^\s*\/\//.test(raw)) return;
    // column 0 is the rail: a mark char or a space. Body indent is measured from column 1, so
    //   "+   foo()"  and  "    foo()"  are the same depth (2 spaces per level after the rail).
    let mark = ' ', line = raw; const mm = raw.match(/^([+\-~?·=])(?=[ \t])/); if (mm) { mark = mm[1] === '·' || mm[1] === '=' ? ' ' : mm[1]; line = ' ' + raw.slice(1); }
    pre.push({ ln: i + 1, mark, col: line.match(/^ */)[0].length, marked: !!mm, line });
  });
  // depth 0 = the body column of the shallowest MARKED line (marks sit in column 0, so a root reads "+ foo" / "~ foo");
  // an unmarked root may start at column 0 or at that same column — both are depth 0. 2 spaces per level after that.
  const marked = pre.filter((x) => x.marked); const base = marked.length ? Math.min(...marked.map((x) => x.col)) : Math.min(...pre.map((x) => x.col), 0);
  pre.forEach(({ ln, mark, col, marked: isM, line }) => {
    const rel = isM ? col - base : (col < base ? 0 : col - base);
    const depth = Math.max(0, Math.round(rel / 2));
    let body = line.trim(); let note = '', loc = '';
    const ni = body.search(/\s(--|—|\/\/)\s/); if (ni >= 0) { note = body.slice(ni).replace(/^\s(--|—|\/\/)\s/, '').trim(); body = body.slice(0, ni).trim(); }
    const li = body.search(/\s@\s*\S+$/); if (li >= 0) { loc = body.slice(li).replace(/^\s@\s*/, ''); body = body.slice(0, li).trim(); }
    else { const lm = body.match(/\s((?:[\w.-]+\/)*[\w.-]+\.\w+(?::\d+(?:-\d+)?)?)$/); if (lm && !/^\w+\(/.test(lm[1])) { loc = lm[1]; body = body.slice(0, lm.index).trim(); } }
    const gap = /^…|^\.\.\./.test(body);
    const isNew = /\*\*[^*]+\*\*|\*[^*\s][^*]*\*/.test(body); const name = body.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*\s][^*]*)\*/g, '$1');
    const kind = gap ? 'gap' : /^<[\w.]+\s*\/?>|^<[\w.]+\b/.test(name) ? 'ui' : /^(post|get|put|patch|delete|fetch|http)\s*\(|^(POST|GET|PUT|PATCH|DELETE)\s/i.test(name) && !/^delete[A-Z]/.test(name) ? 'net' : /^(if|else|when|unless|switch|case|catch|try)\b/.test(name) ? 'cond' : /^(write|read|set|save|persist|rm|remove|store)[A-Z(]/.test(name) || /→\s*(record|store|disk)/i.test(name) ? 'data' : /^(useKey|on\s+\w+|onKey|key\s+\w+)/.test(name) ? 'key' : 'fn';
    const [file, lineNo] = loc.split(':');
    const bold = body.match(/\*\*([^*]+)\*\*/); const comp = name.match(/<([\w.]+)/); const lastCall = [...name.matchAll(/([A-Za-z_$][\w$.]*)\s*\(/g)].pop();
    const sym = bold ? bold[1] : comp ? comp[1] : lastCall ? lastCall[1] : name.replace(/\(.*$/, '').trim();
    const node = { id: `n${m.nodes.length + 1}`, depth, mark, name, sym, kind, loc, file: file || '', line: lineNo || '', note, isNew, gap, children: [], parent: null, ln };
    let d = depth; if (d > stack.length) { m.errors.push(`line ${ln}: indented ${d} levels but the line above is at ${stack.length - 1} — indent by exactly 2 spaces per level`); d = stack.length; }
    node.depth = d; stack.length = d;
    if (d === 0 || !stack[d - 1]) { if (d > 0) m.errors.push(`line ${ln}: no parent for indented line`); node.depth = 0; m.roots.push(node); }
    else { node.parent = stack[d - 1]; node.parent.children.push(node); }
    stack[d] = node; m.nodes.push(node);
  });
  if (!m.roots.length) m.errors.push('no calls — first line should be an entrypoint at indent 0');
  m.roots.forEach((r) => { if (r.mark === '+' && r.children.length === 0 && m.roots.length > 1) {} });
  const walk = (n, f) => { f(n); n.children.forEach((c) => walk(c, f)); }; m.walk = (f) => m.roots.forEach((r) => walk(r, f));
  m.find = (key) => m.nodes.find((n) => n.id === key) || m.nodes.find((n) => n.sym === key) || m.nodes.find((n) => n.name === key) || m.nodes.find((n) => n.name.replace(/\(.*$/, '').trim() === key) || null;
  return m;
};

/* ───────────────────────── flow layout + routing (pure) ───────────────────────── */

/** Machine DSL → { name, initial, states:{id:{id,label,final,mark,bind:{shows,code,set,seq,node,say}}}, order:[], events:[{from,ev,to,label,mark}], traces:{name:[ev]}, errors }
 *  machine lifecycle initial queued
 *  state queued  shows #ui-queued  code draftStore.ts:212  set Draft.status=queued  seq 2  node store  [final]  # description
 *  queued -review-> reviewing : /feedback           (+/-/~ prefix marks proposed/removed/changed)
 *  trace happy: review send ok
 */
NW.parseMachine = function parseMachine(text) {
  const m = { name: '', initial: '', states: {}, order: [], events: [], traces: {}, grid: [], errors: [] };
  const state = (id, ln) => { if (!/^[\w.-]+$/.test(id)) m.errors.push(`line ${ln}: bad state id "${id}"`); if (!m.states[id]) { m.states[id] = { id, label: id.replace(/[_-]+/g, ' '), final: false, mark: null, bind: {}, ln }; m.order.push(id); } return m.states[id]; };
  text.split('\n').forEach((raw, i) => {
    const ln = i + 1; let line = raw.trim(); if (!line || line.startsWith('//')) return;
    let say = ''; const hi = line.search(/\s+#\s/); if (hi >= 0) { say = line.slice(hi).replace(/^\s+#\s/, '').trim(); line = line.slice(0, hi).trim(); }
    let mm;
    if (line.startsWith('|')) { m.grid.push(line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()).map((c) => (c && c !== '.' && c !== '·') ? (state(c, ln), c) : null)); return; }
    if ((mm = line.match(/^machine\s+([\w.-]+)(?:\s+initial\s+([\w.-]+))?$/i))) { m.name = mm[1]; if (mm[2]) m.initial = mm[2]; return; }
    if ((mm = line.match(/^initial\s+([\w.-]+)$/i))) { m.initial = mm[1]; return; }
    if ((mm = line.match(/^state\s+([\w.-]+)(?:\s+"([^"]*)")?\s*(.*)$/i))) {
      const st = state(mm[1], ln); if (mm[2]) st.label = mm[2]; if (say) st.bind.say = say;
      const toks = (mm[3] || '').match(/"[^"]*"|\S+/g) || []; let k = 0;
      while (k < toks.length) { const t = toks[k++]; const low = t.toLowerCase();
        if (low === 'final') { st.final = true; continue; } if (low === 'initial') { m.initial = st.id; continue; }
        if (['shows', 'code', 'seq', 'node', 'set', 'hide', 'lit'].includes(low)) { const vals = []; while (k < toks.length && !/^(shows|code|seq|node|set|hide|lit|final|initial)$/i.test(toks[k])) vals.push(toks[k++].replace(/^"(.*)"$/, '$1')); if (!vals.length) m.errors.push(`line ${ln}: state ${st.id}: "${t}" needs a value`); else if (low === 'set') st.bind.set = [...(st.bind.set || []), ...vals]; else if (low === 'shows' || low === 'hide') st.bind[low] = [...(st.bind[low] || []), ...vals]; else st.bind[low] = vals.length === 1 ? vals[0] : vals; continue; }
        m.errors.push(`line ${ln}: state ${st.id}: unknown token "${t}" — expected shows #id · code file:line · set Entity.field=value · seq N · node id · final`); }
      return; }
    if ((mm = line.match(/^trace\s+([\w.-]+)\s*:\s*(.*)$/i))) { m.traces[mm[1]] = mm[2].split(/[\s,]+/).filter(Boolean); return; }
    let mark = null; const mk = line.match(/^([+\-~])\s+/); if (mk) { mark = { '+': 'new', '-': 'gone', '~': 'mod' }[mk[1]]; line = line.slice(mk[0].length); }
    if ((mm = line.match(/^([\w.-]+)\s+-\s*([\w.-]+)\s*->\s+([\w.-]+)\s*(?::\s*(.*))?$/))) { state(mm[1], ln); state(mm[3], ln); m.events.push({ from: mm[1], ev: mm[2], to: mm[3], label: (mm[4] || '').trim(), mark, ln }); return; }
    if ((mm = line.match(/^([\w.-]+)\s*->\s*([\w.-]+)\s*:\s*([\w.-]+)\s*(?:\((.*)\))?$/))) { state(mm[1], ln); state(mm[2], ln); m.events.push({ from: mm[1], ev: mm[3], to: mm[2], label: (mm[4] || '').trim(), mark, ln }); return; }
    m.errors.push(`line ${ln}: couldn't parse "${line}" — expected  state id [shows #id] [code f:l] [set A.b=v] [seq n] [node id] [final]  |  a -event-> b : label  |  trace name: ev ev  |  machine name initial id`);
  });
  if (m.grid.length) { const seen = {}; m.grid.forEach((row) => row.forEach((id) => { if (!id) return; if (seen[id]) m.errors.push(`grid: "${id}" appears twice`); seen[id] = 1; })); m.order.forEach((id) => { if (!seen[id]) m.errors.push(`grid: state "${id}" has no cell — add it to a | row |`); }); }
  if (!m.initial && m.order.length) m.initial = m.order[0];
  if (m.initial && !m.states[m.initial]) m.errors.push(`initial state "${m.initial}" is not defined`);
  const legal = (from, ev) => m.events.find((e) => e.from === from && e.ev === ev);
  Object.entries(m.traces).forEach(([name, evs]) => { let cur = m.initial; evs.forEach((ev, i) => { const e = legal(cur, ev); if (!e) { m.errors.push(`trace ${name}: step ${i + 1} "${ev}" is not a legal event from "${cur}" (legal: ${m.events.filter((x) => x.from === cur).map((x) => x.ev).join(', ') || 'none'})`); cur = null; } else cur = e.to; if (!cur) return; }); });
  const reach = new Set([m.initial]); let grew = true; while (grew) { grew = false; m.events.forEach((e) => { if (reach.has(e.from) && !reach.has(e.to)) { reach.add(e.to); grew = true; } }); }
  m.order.forEach((id) => { if (!reach.has(id)) m.errors.push(`state "${id}" is unreachable from "${m.initial}"`); });
  m.order.forEach((id) => { const st = m.states[id]; if (!st.final && !m.events.some((e) => e.from === id)) m.errors.push(`state "${id}" has no outgoing events and is not marked final`); });
  return m;
};

/** Layer states left→right by BFS distance from initial; branches stack vertically. Returns { W, H, pos:{id:[x,y]}, NW: width, NH } */
NW.layoutMachine = function layoutMachine(m, dir = 'LR') {
  const ids = m.order; if (!ids.length) return { W: 0, H: 0, pos: {} };
  const longest = Math.max(...ids.map((id) => m.states[id].label.length));
  const NWID = clamp(Math.ceil(longest * 7.6 + 30), 90, 180), NH = 36;
  const evLen = Math.max(0, ...m.events.map((e) => (m.short ? (e.label || e.ev) : e.ev + (e.label ? ' · ' + e.label : '')).length));
  const GX = clamp(Math.ceil(evLen * 6.6 + 30), 70, 200), GY = 60, PAD = 20;
  if (m.grid?.length) { const pos = {}; let W = 0, H = 0; m.grid.forEach((row, r) => row.forEach((id, c) => { if (!id) return; const x = PAD + c * (NWID + GX), y = PAD + r * (NH + GY); pos[id] = [x, y]; W = Math.max(W, x + NWID + PAD); H = Math.max(H, y + NH + PAD); })); return { W, H: H + 8, pos, NW: NWID, NH, GX, GY, dir: 'LR', grid: true }; }
  const depth = { [m.initial]: 0 }; const q = [m.initial]; while (q.length) { const u = q.shift(); m.events.forEach((e) => { if (e.from === u && depth[e.to] == null) { depth[e.to] = depth[u] + 1; q.push(e.to); } }); }
  ids.forEach((id) => { if (depth[id] == null) depth[id] = 0; });
  // detours: a state that only bounces back to the state it came from (sending ⇄ failed) sits under its source, not in the next column
  const under = {}; ids.forEach((id) => { const outs = m.events.filter((e) => e.from === id && e.to !== id), ins = m.events.filter((e) => e.to === id && e.from !== id); const srcs = [...new Set(ins.map((e) => e.from))]; if (srcs.length === 1 && outs.length && outs.every((e) => e.to === srcs[0]) && id !== m.initial) { under[id] = srcs[0]; depth[id] = depth[srcs[0]]; } });
  const layers = []; ids.forEach((id) => { if (!under[id]) (layers[depth[id]] ||= []).push(id); });
  Object.entries(under).forEach(([id, src]) => { const l = layers[depth[src]]; const k = l.indexOf(src); l.splice(k + 1, 0, id); });
  // order within a layer: keep the "trunk" (first event's target) on top; finals sink to the bottom-most row after their sources
  for (let li = 1; li < layers.length; li++) { const prevPos = {}; layers[li - 1].forEach((id, k) => (prevPos[id] = k)); layers[li].sort((a, b) => { const pa = m.events.filter((e) => e.to === a && prevPos[e.from] != null).map((e) => prevPos[e.from]); const pb = m.events.filter((e) => e.to === b && prevPos[e.from] != null).map((e) => prevPos[e.from]); const ba = pa.length ? Math.min(...pa) : 99, bb = pb.length ? Math.min(...pb) : 99; const ia = m.events.findIndex((e) => e.to === a && prevPos[e.from] != null), ib = m.events.findIndex((e) => e.to === b && prevPos[e.from] != null); return ba - bb || ia - ib; }); Object.entries(under).forEach(([id, src]) => { const l = layers[li]; if (l.includes(id)) { l.splice(l.indexOf(id), 1); l.splice(l.indexOf(src) + 1, 0, id); } }); }
  const pos = {}; let W = 0, H = 0;
  if (dir === 'TB') { const GXt = clamp(Math.ceil(evLen * 3.4 + 24), 40, 120), GYt = clamp(Math.ceil(evLen * 0 + 56), 56, 80); layers.forEach((l, li) => l.forEach((id, k) => { const x = PAD + k * (NWID + GXt), y = PAD + li * (NH + GYt); pos[id] = [x, y]; W = Math.max(W, x + NWID + PAD); H = Math.max(H, y + NH + PAD); })); return { W, H, pos, NW: NWID, NH, GX: GXt, GY: GYt, dir }; }
  layers.forEach((l, li) => l.forEach((id, k) => { const x = PAD + li * (NWID + GX), y = PAD + k * (NH + GY); pos[id] = [x, y]; W = Math.max(W, x + NWID + PAD); H = Math.max(H, y + NH + PAD); }));
  return { W, H, pos, NW: NWID, NH, GX, GY, dir };
};

NW.layoutFlow = function layoutFlow(m, opt = {}) {
  const ids = m.order; if (!ids.length) return { W: 0, H: 0, boxes: {}, routes: [], groups: [] };
  const wrapAt = 18;
  // wrap labels at ~18 chars; long identifiers soft-break at camelCase / punctuation without inserting spaces
  const soft = (w) => w.length > wrapAt ? w.replace(/([a-z0-9])([A-Z])/g, '$1\u200b$2').replace(/([._/:-])(?=\w)/g, '$1\u200b').split('\u200b').map((t, i) => ({ t, sp: i === 0 })) : [{ t: w, sp: true }];
  const wrap = (s) => { const out = []; String(s).split('\n').forEach((para) => { let cur = ''; para.split(/\s+/).filter(Boolean).flatMap(soft).forEach(({ t, sp }) => { const join = cur ? cur + (sp ? ' ' : '') + t : t; if (join.length > wrapAt && cur) { out.push(cur); cur = t; } else cur = join; }); if (cur) out.push(cur); }); return out.length ? out : ['']; };
  const wrapSub = (t) => { t = String(t || ''); if (t.length <= 24) return t ? [t] : []; const mid = Math.round(t.length / 2); let at = -1; for (let d = 0; d < mid; d++) { if (/[\s/·,]/.test(t[mid - d])) { at = mid - d; break; } if (/[\s/·,]/.test(t[mid + d])) { at = mid + d; break; } } return at > 0 ? [t.slice(0, at + (t[at] === ' ' ? 0 : 1)).trim(), t.slice(at + 1).trim()] : [t]; };
  Object.values(m.nodes).forEach((n) => { n.lines = wrap(n.label); n.subLines = wrapSub(n.sub); });
  const maxLines = Math.max(...Object.values(m.nodes).map((n) => n.lines.length + n.subLines.length * 0.85));
  const longest = Math.max(...Object.values(m.nodes).flatMap((n) => { const pad = n.shape === 'actor' ? 22 : 0; return [...n.lines.map((l) => l.length * 7.3 + pad), ...n.subLines.map((l) => l.length * 6.5 + pad)]; }));
  const splitLbl = (t) => { t = String(t || ''); if (t.length <= 22) return t ? [t] : []; const mid = Math.round(t.length / 2); let at = -1; for (let d = 0; d < mid; d++) { if (t[mid - d] === ' ') { at = mid - d; break; } if (t[mid + d] === ' ') { at = mid + d; break; } } return at > 0 ? [t.slice(0, at), t.slice(at + 1)] : [t]; };
  m.edges.forEach((e) => { e.lines = splitLbl(e.label); e.tw = e.lines.length ? Math.max(24, Math.max(...e.lines.map((l) => l.length)) * 6.4 + 12) : 0; e.th = e.lines.length > 1 ? 30 : 18; });
  const maxLbl = Math.max(0, ...m.edges.map((e) => e.tw ? e.tw + 4 : 0));
  const NWID = opt.nodeW || clamp(Math.ceil(longest + 30), 120, 240), NH = Math.max(50, Math.ceil(20 + maxLines * 16)), GX = clamp(Math.ceil(maxLbl + 22), 56, 92), GY = m.edges.some((e) => e.th > 18) ? 62 : maxLbl > 0 ? 54 : 44, PAD = 28;
  let cells = {}; // id -> {c, r} possibly fractional c for auto layout
  if (m.grid.length) { m.grid.forEach((row, r) => row.forEach((id, c) => { if (id) cells[id] = { c, r }; })); }
  else {
    // longest-path layering over a DAG (back edges ignored via DFS)
    const out = {}, inn = {}; ids.forEach((id) => { out[id] = []; inn[id] = []; });
    const state = {}; const back = new Set();
    m.edges.forEach((e, i) => { if (e.from !== e.to) { out[e.from].push([e.to, i]); inn[e.to].push([e.from, i]); } });
    const dfs = (u) => { state[u] = 1; out[u].forEach(([v, i]) => { if (state[v] === 1) back.add(i); else if (!state[v]) dfs(v); }); state[u] = 2; };
    ids.forEach((id) => { if (!state[id]) dfs(id); });
    const layer = {}; const L = (u) => { if (layer[u] != null) return layer[u]; layer[u] = -1; let best = 0; inn[u].forEach(([p, i]) => { if (!back.has(i)) best = Math.max(best, L(p) + 1); }); return (layer[u] = best); };
    ids.forEach((id) => L(id));
    const layers = []; ids.forEach((id) => { (layers[layer[id]] ||= []).push(id); });
    // barycenter ordering, two down-sweeps
    for (let pass = 0; pass < 2; pass++) for (let i = 1; i < layers.length; i++) { const pos = {}; layers[i - 1].forEach((id, k) => { pos[id] = k; }); layers[i].sort((a, b) => { const pa = inn[a].map(([p]) => pos[p]).filter((x) => x != null), pb = inn[b].map(([p]) => pos[p]).filter((x) => x != null); const ba = pa.length ? pa.reduce((s, x) => s + x, 0) / pa.length : 1e9, bb = pb.length ? pb.reduce((s, x) => s + x, 0) / pb.length : 1e9; return ba - bb; }); }
    const maxN = Math.max(...layers.map((l) => l.length));
    layers.forEach((l, li) => l.forEach((id, k) => { const off = (maxN - l.length) / 2; cells[id] = m.dir === 'LR' ? { c: li, r: k + off } : { c: k + off, r: li }; }));
  }
  const boxes = {}; let W = 0, H = 0;
  ids.forEach((id) => { const cell = cells[id]; if (!cell) return; const n = m.nodes[id]; const x = PAD + cell.c * (NWID + GX), y = PAD + cell.r * (NH + GY); boxes[id] = { id, x, y, w: NWID, h: NH, cx: x + NWID / 2, cy: y + NH / 2, c: cell.c, r: cell.r, n }; W = Math.max(W, x + NWID + PAD); H = Math.max(H, y + NH + PAD); });
  // groups
  const groups = m.groups.map((g) => { const bs = g.ids.map((id) => boxes[id]).filter(Boolean); if (!bs.length) return null; const x0 = Math.min(...bs.map((b) => b.x)) - 14, y0 = Math.min(...bs.map((b) => b.y)) - 22, x1 = Math.max(...bs.map((b) => b.x + b.w)) + 14, y1 = Math.max(...bs.map((b) => b.y + b.h)) + 14; W = Math.max(W, x1 + 8); H = Math.max(H, y1 + 8); return { label: g.label, x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; }).filter(Boolean);
  if (groups.length) { const miny = Math.min(0, ...groups.map((g) => g.y - 6)); if (miny < 0) { Object.values(boxes).forEach((b) => { b.y -= miny; b.cy -= miny; }); groups.forEach((g) => { g.y -= miny; }); H -= miny; } }
  // routing
  const occupied = (x, y, skip) => Object.values(boxes).some((b) => !skip.includes(b.id) && x > b.x - 4 && x < b.x + b.w + 4 && y > b.y - 4 && y < b.y + b.h + 4);
  const segClear = (x1, y1, x2, y2, skip) => { const steps = 24; for (let i = 1; i < steps; i++) { const t = i / steps; if (occupied(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, skip)) return false; } return true; };
  const lane = {}; const laneOff = (key) => { lane[key] = (lane[key] || 0) + 1; const k = lane[key] - 1; return k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 8; };
  // 1) decide each edge's exit/entry sides
  const plans = m.edges.map((e) => {
    const a = boxes[e.from], b = boxes[e.to]; if (!a || !b || a === b) return null;
    const skip = [a.id, b.id]; const dx = b.cx - a.cx, dy = b.cy - a.cy;
    const sameRow = Math.abs(dy) < 2, sameCol = Math.abs(dx) < 2;
    let orient; // 'h' = leave from left/right, 'v' = leave from top/bottom
    if (sameRow) orient = 'h'; else if (sameCol) orient = 'v';
    else {
      const hFirstClear = segClear(dx > 0 ? a.x + a.w : a.x, a.cy, dx > 0 ? b.x - GX / 2 : b.x + b.w + GX / 2, a.cy, skip) && segClear(dx > 0 ? b.x - GX / 2 : b.x + b.w + GX / 2, b.cy, dx > 0 ? b.x : b.x + b.w, b.cy, skip);
      const vFirstClear = segClear(a.cx, dy > 0 ? a.y + a.h : a.y, a.cx, dy > 0 ? b.y - GY / 2 : b.y + b.h + GY / 2, skip) && segClear(b.cx, dy > 0 ? b.y - GY / 2 : b.y + b.h + GY / 2, b.cx, dy > 0 ? b.y : b.y + b.h, skip);
      const cols = Math.abs(dx) / (NWID + GX), rws = Math.abs(dy) / (NH + GY);
      const preferH = Math.abs(cols - rws) < 0.2 ? m.dir === 'LR' : cols > rws;
      orient = preferH ? (hFirstClear ? 'h' : vFirstClear ? 'v' : 'h') : (vFirstClear ? 'v' : hFirstClear ? 'h' : 'v');
    }
    const sideA = orient === 'h' ? (dx >= 0 ? 'r' : 'l') : (dy >= 0 ? 'b' : 't');
    const sideB = orient === 'h' ? (sameRow ? (dx >= 0 ? 'l' : 'r') : (dx >= 0 ? 'l' : 'r')) : (sameCol ? (dy >= 0 ? 't' : 'b') : (dy >= 0 ? 't' : 'b'));
    return { e, a, b, skip, dx, dy, sameRow, sameCol, orient, sideA, sideB };
  }).filter(Boolean);
  // 2) spread ports: several edges on one side of a node get distinct attachment points
  const portList = {}; plans.forEach((p) => { (portList[p.a.id + p.sideA] ||= []).push([p, 'A']); (portList[p.b.id + p.sideB] ||= []).push([p, 'B']); });
  Object.values(portList).forEach((list) => {
    const side = list[0][1] === 'A' ? list[0][0].sideA : list[0][0].sideB; const horizSide = side === 't' || side === 'b';
    list.sort((u, v) => { const ou = u[1] === 'A' ? u[0].b : u[0].a, ov = v[1] === 'A' ? v[0].b : v[0].a; return horizSide ? ou.cx - ov.cx : ou.cy - ov.cy; });
    const n = list.length; list.forEach(([p, end], i) => { const off = (i - (n - 1) / 2) * (horizSide ? Math.min(22, (NWID - 30) / Math.max(1, n - 1)) : Math.min(14, (NH - 16) / Math.max(1, n - 1))); p['off' + end] = n > 1 ? off : 0; });
  });
  const port = (bx, side, off) => side === 'r' ? [bx.x + bx.w, bx.cy + off] : side === 'l' ? [bx.x, bx.cy + off] : side === 'b' ? [bx.cx + off, bx.y + bx.h] : [bx.cx + off, bx.y];
  const placed = []; // label rects for collision avoidance
  const routes = plans.map((p) => {
    const { e, a, b, skip, dx, dy, sameRow, sameCol, orient } = p;
    if (sameRow || sameCol) { const o = ((p.offA || 0) + (p.offB || 0)) / 2; p.offA = p.offB = o; }  // straight edges stay straight
    const [sx, sy] = port(a, p.sideA, p.offA), [tx, ty] = port(b, p.sideB, p.offB); let pts;
    if (orient === 'h') {
      if (sameRow && segClear(sx, sy, tx, ty, skip)) pts = [[sx, sy], [tx, ty]];
      else if (sameRow) { const gy = a.y - GY / 2 + laneOff('h' + a.r + ':' + Math.min(a.c, b.c)); pts = [[a.cx + p.offA, a.y], [a.cx + p.offA, gy], [b.cx + p.offB, gy], [b.cx + p.offB, b.y]]; }
      else { let mx = dx >= 0 ? b.x - GX / 2 : b.x + b.w + GX / 2; mx += laneOff('vx' + Math.round(mx / 10)); pts = [[sx, sy], [mx, sy], [mx, ty], [tx, ty]];
        if (!segClear(sx, sy, mx, sy, skip)) { const gy = (dy > 0 ? a.y + a.h + GY / 2 : a.y - GY / 2) + laneOff('hy' + Math.round((dy > 0 ? a.y + a.h : a.y) / 10)); pts = [[a.cx, dy > 0 ? a.y + a.h : a.y], [a.cx, gy], [mx, gy], [mx, ty], [tx, ty]]; } }
    } else {
      if (sameCol && segClear(sx, sy, tx, ty, skip)) pts = [[sx, sy], [tx, ty]];
      else if (sameCol) { const gx = a.x + a.w + GX / 2 + laneOff('v' + a.c + ':' + Math.min(a.r, b.r)); pts = [[a.x + a.w, a.cy + p.offA], [gx, a.cy + p.offA], [gx, b.cy + p.offB], [b.x + b.w, b.cy + p.offB]]; }
      else { let my = dy >= 0 ? b.y - GY / 2 : b.y + b.h + GY / 2; my += laneOff('hy' + Math.round(my / 10)); pts = [[sx, sy], [sx, my], [tx, my], [tx, ty]];
        if (!segClear(sx, sy, sx, my, skip)) { const gx = (dx > 0 ? a.x + a.w + GX / 2 : a.x - GX / 2) + laneOff('vx' + Math.round((dx > 0 ? a.x + a.w : a.x) / 10)); pts = [[dx > 0 ? a.x + a.w : a.x, a.cy], [gx, a.cy], [gx, my], [tx, my], [tx, ty]]; } }
    }
    // simplify collinear points
    pts = pts.filter((pt, i) => i === 0 || i === pts.length - 1 || !((pts[i - 1][0] === pt[0] && pt[0] === pts[i + 1][0]) || (pts[i - 1][1] === pt[1] && pt[1] === pts[i + 1][1])));
    const segsOut = pts.slice(0, -1).map((pt, i) => [pt[0], pt[1], pts[i + 1][0], pts[i + 1][1]]);
    return { e, pts, lx: 0, ly: 0, segs: segsOut };
  });
  // 3) labels — placed once every route is known: try along own segments (longest first), then just off the line,
  //    avoiding nodes, other labels, and other edges' lines
  routes.forEach((r) => {
    const { e, pts } = r; if (!e.label) return;
    const tw = e.tw, th = e.th; const others = routes.filter((o) => o !== r).flatMap((o) => o.segs);
    const segs = pts.slice(0, -1).map((pt, i) => ({ i, l: Math.hypot(pts[i + 1][0] - pt[0], pts[i + 1][1] - pt[1]) })).sort((u, v) => v.l - u.l);
    const at = (i, t) => [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t];
    const cands = []; segs.forEach(({ i }) => [0.5, 0.33, 0.67, 0.2, 0.8].forEach((t) => cands.push(at(i, t))));
    segs.slice(0, 2).forEach(({ i }) => { const horiz = Math.abs(pts[i + 1][1] - pts[i][1]) < 1; [0.5, 0.35, 0.65].forEach((t) => { const [cx, cy] = at(i, t); if (horiz) { cands.push([cx, cy - th / 2 - 5], [cx, cy + th / 2 + 5]); } else { cands.push([cx - tw / 2 - 6, cy], [cx + tw / 2 + 6, cy]); } }); });
    segs.slice(0, 2).forEach(({ i }) => { const horiz = Math.abs(pts[i + 1][1] - pts[i][1]) < 1; const [cx, cy] = at(i, 0.5); if (horiz) cands.push([cx, cy - NH / 2 - th / 2 - 4], [cx, cy + NH / 2 + th / 2 + 4]); else cands.push([cx - NWID / 2 - tw / 2 - 4, cy], [cx + NWID / 2 + tw / 2 + 4, cy]); });  // last resort: clear of the whole node row/column
    const bad = (x, y) => x - tw / 2 < 2 || y - th / 2 < 2 || placed.some((q) => Math.abs(q.x - x) < (q.w + tw) / 2 + 4 && Math.abs(q.y - y) < (q.h + th) / 2 + 2) || Object.values(boxes).some((bx) => x + tw / 2 > bx.x - 2 && x - tw / 2 < bx.x + bx.w + 2 && y + th / 2 > bx.y - 2 && y - th / 2 < bx.y + bx.h + 2);
    const onOther = (x, y) => others.some(([x1, y1, x2, y2]) => (Math.abs(y1 - y2) < 1 && Math.abs(y - y1) < th / 2 + 1 && x + tw / 2 > Math.min(x1, x2) && x - tw / 2 < Math.max(x1, x2)) || (Math.abs(x1 - x2) < 1 && Math.abs(x - x1) < tw / 2 + 1 && y + th / 2 > Math.min(y1, y2) && y - th / 2 < Math.max(y1, y2)));
    const ok = cands.find(([x, y]) => !bad(x, y) && !onOther(x, y)) || cands.find(([x, y]) => !bad(x, y)) || cands[0];
    [r.lx, r.ly] = ok; placed.push({ x: ok[0], y: ok[1], w: tw, h: th }); W = Math.max(W, ok[0] + tw / 2 + 6); H = Math.max(H, ok[1] + th / 2 + 6);
  });
  return { W, H, boxes, routes, groups, NH, NWID };
};
export { NW, dedent, esc };
