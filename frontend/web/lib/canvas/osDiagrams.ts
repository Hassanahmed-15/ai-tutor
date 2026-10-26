/**
 * OPERATING-SYSTEMS BOARDS (owner, 2026-10-25: "precision was literally zero … this is the type of visuals
 * req in OS", with GeeksforGeeks' process-state diagram and a stack/heap/data/text memory layout).
 *
 * A multithreading lecture was classed as a data-structures lesson, so seven of its eight boards were
 * forced into a graph or a queue. Thread states and "what threads share" are neither: the writer failed,
 * fell back to free sketches whose shapes it placed itself, and the boards shipped with arrows from
 * nowhere into a CPU box and labels like "Mon" and "RES". These are the three pictures OS texts draw,
 * and code places every part of them:
 *   - "states": a lifecycle — states as ovals joined by curved, labelled transitions, and a process chip
 *     that moves from state to state as Aria speaks;
 *   - "memory": an address space — segments stacked top to bottom (Stack, free, Heap, Data, Text) with
 *     growth arrows, or a process's shared parts above each thread's own registers and stack;
 *   - "gantt": a CPU schedule — each process's time slots along one bar, arrivals above, the ready queue under it.
 */
import type { GanttStage, MappingStage, MemorySegment, MemoryStage, StatesStage } from "./types";

type Raw = Record<string, unknown>;
type Pt = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };
type Measure = (t: string, size: number) => number;
type Sentence = (v: unknown, f?: number) => number;
type Unique = (v: unknown, f: string) => string;

/** Why the last OS board was refused, for the writer's next attempt (lib/canvas/generate.ts). */
let lastProblem = "";
export function takeOsProblem(): string {
  const p = lastProblem;
  lastProblem = "";
  return p;
}
const refuse = (why: string): null => {
  lastProblem = why;
  return null;
};

const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string => (typeof v === "string" || typeof v === "number" ? String(v).replace(/\s+/g, " ").trim() : "");
const slugOf = (v: unknown, fallback: string): string => (text(v).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || fallback);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const hit = (a: Rect, b: Rect, pad = 0) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

// Colours from the renderer's own list (lib/canvas/theme.ts), so the chalk board lifts them.
const STATE_COLORS: Array<[RegExp, string]> = [
  [/\b(?:new|start|created?|admitted)\b/i, "#475569"],
  [/\b(?:ready|runnable)\b/i, "#d97706"],
  [/\b(?:running|run|executing)\b/i, "#15803d"],
  [/\b(?:wait\w*|blocked|sleep\w*|suspended)\b/i, "#2563eb"],
  [/\b(?:terminated|exit\w*|done|finished|dead|zombie)\b/i, "#7c3aed"],
];
const SPARE = ["#0f766e", "#be123c", "#0369a1", "#b45309", "#6d28d9", "#c2410c"];
export const OS_PROCESS_COLORS = ["#2563eb", "#d97706", "#15803d", "#be123c", "#7c3aed", "#0f766e", "#c2410c", "#0369a1"];

// ── States ─────────────────────────────────────────────────────────────────────────────────────

const STATE_LABEL_MAX = 18;
const TRANSITION_LABEL_MAX = 26;
const COLS = 4;
const ROWS = 3;

/**
 * A lifecycle board from the writer's JSON, or null (with the reason kept for the rewrite): fewer than two
 * states, a transition between states that are not drawn, or a process that moves where no arrow goes.
 */
export function validateStatesStage(r: Raw, sentence: Sentence, unique: Unique): StatesStage | null {
  const states: StatesStage["states"] = [];
  const wanted: Array<{ col: number | null; row: number | null }> = [];
  for (const [i, raw] of arr(r.states).entries()) {
    const st = obj(raw);
    const label = text(st.label ?? st.name ?? raw);
    if (!label || label.length > STATE_LABEL_MAX) return refuse(`a state needs a name of at most ${STATE_LABEL_MAX} characters (got "${label}")`);
    const id = slugOf(st.id ?? label, `state-${i + 1}`);
    if (states.some((x) => x.id === id)) continue;
    states.push({ id, label, s: sentence(st.s ?? st.sentence, 0), col: 0, row: 0 });
    const col = num(st.col ?? st.x), row = num(st.row ?? st.y);
    wanted.push({ col: col === null ? null : Math.max(0, Math.min(COLS - 1, Math.round(col))), row: row === null ? null : Math.max(0, Math.min(ROWS - 1, Math.round(row))) });
  }
  if (states.length < 2 || states.length > 7) return refuse(`a lifecycle has 2 to 7 states (got ${states.length}): give "states" as [{"id", "label", "col", "row", "s"}]`);
  // Each state its own cell: one asked for a taken cell (or none) goes to the nearest free one.
  const taken = new Set<string>();
  states.forEach((st, i) => {
    const want = wanted[i];
    const col = want.col ?? i % COLS, row = want.row ?? Math.floor(i / COLS);
    let best = { col, row, d: Infinity };
    for (let c = 0; c < COLS; c++) for (let rr = 0; rr < ROWS; rr++) {
      if (taken.has(`${c},${rr}`)) continue;
      const d = Math.abs(c - col) * 1.01 + Math.abs(rr - row);
      if (d < best.d) best = { col: c, row: rr, d };
    }
    taken.add(`${best.col},${best.row}`);
    st.col = best.col;
    st.row = best.row;
  });
  const stateOf = (v: unknown) => {
    const want = slugOf(v, "");
    return states.find((st) => st.id === want || slugOf(st.label, "") === want);
  };
  const transitions: StatesStage["transitions"] = [];
  for (const [i, raw] of arr(r.transitions ?? r.arrows).entries()) {
    const t = obj(raw);
    const from = stateOf(t.from), to = stateOf(t.to);
    if (!from || !to) return refuse(`transition ${i + 1} needs "from" and "to" naming state ids (${states.map((st) => st.id).join(", ")})`);
    const label = text(t.label ?? t.event);
    if (label.length > TRANSITION_LABEL_MAX) return refuse(`transition ${i + 1}'s label is at most ${TRANSITION_LABEL_MAX} characters — the event, not a description ("${label}")`);
    if (transitions.some((x) => x.from === from.id && x.to === to.id)) continue;
    // A transition is never drawn before both of its states.
    const s = Math.max(sentence(t.s ?? t.sentence, 0), from.s, to.s);
    transitions.push({ id: slugOf(t.id ?? `${from.id}-${to.id}`, `t${i + 1}`), from: from.id, to: to.id, ...(label ? { label } : {}), s });
  }
  if (!transitions.length || transitions.length > 10) return refuse(`a lifecycle has 1 to 10 transitions (got ${transitions.length})`);
  const seen = new Set<string>();
  for (const t of transitions) {
    let id = t.id;
    for (let k = 2; seen.has(id) || states.some((st) => st.id === id); k++) id = `${t.id}-${k}`;
    t.id = id;
    seen.add(id);
  }
  const tokens: NonNullable<StatesStage["tokens"]> = [];
  for (const [i, raw] of arr(r.tokens ?? r.processes).slice(0, 2).entries()) {
    const tk = obj(raw);
    const label = text(tk.label ?? tk.name);
    if (!label || label.length > 6) return refuse(`a moving process needs a short name of at most 6 characters ("P1", "T1"), got "${label}"`);
    const path: Array<{ state: string; s: number }> = [];
    for (const step of arr(tk.path)) {
      const p = obj(step);
      const st = stateOf(p.state ?? p.to);
      if (!st) return refuse(`${label}'s path names a state that is not drawn (${text(p.state ?? p.to)}): use the state ids`);
      const s = Math.max(sentence(p.s ?? p.sentence, 0), st.s, path.at(-1)?.s ?? 0);
      if (path.at(-1)?.state === st.id) continue;
      path.push({ state: st.id, s });
    }
    if (!path.length) continue;
    // A process only moves along an arrow the board draws (Ready → Running needs the dispatch arrow). A path that
    // jumps where no arrow goes loses its chip, not the whole diagram: refusing it threw away a good six-state
    // lifecycle twice (2026-10-25).
    const jumps = path.some((p, k) => k > 0 && !transitions.some((t) => t.from === path[k - 1].state && t.to === p.state));
    if (jumps) continue;
    for (let k = 1; k < path.length; k++) {
      const arrow = transitions.find((t) => t.from === path[k - 1].state && t.to === path[k].state)!;
      arrow.s = Math.min(arrow.s, path[k].s);
    }
    tokens.push({ id: slugOf(tk.id ?? label, `p${i + 1}`), label, path });
  }
  unique("states", "states");
  for (const st of states) unique(`state-${st.id}`, `state-${st.id}`);
  for (const t of transitions) unique(`tr-${t.id}`, `tr-${t.id}`);
  for (const tk of tokens) unique(`token-${tk.id}`, `token-${tk.id}`);
  return { kind: "states", states, transitions, ...(tokens.length ? { tokens } : {}) };
}

export type StatesGeometry = {
  states: Array<{ id: string; label: string; s: number; cx: number; cy: number; rx: number; ry: number; size: number; color: string; labelY: number }>;
  transitions: Array<{ id: string; from: string; to: string; label?: string; s: number; d: string; labelAt?: Pt; labelSize: number; labelBox?: Rect; samples: Pt[] }>;
  tokens: Array<{ id: string; label: string; w: number; h: number; size: number; color: string; stops: Array<{ s: number; state: string; x: number; y: number; via?: string }> }>;
};

/** A point on an ellipse's edge, in the direction (dx, dy) from its centre. */
function onEllipse(cx: number, cy: number, rx: number, ry: number, dx: number, dy: number, gap = 0): Pt {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const t = 1 / Math.sqrt((ux / rx) ** 2 + (uy / ry) ** 2);
  return { x: cx + ux * (t + gap), y: cy + uy * (t + gap) };
}
const quad = (p0: Pt, c: Pt, p1: Pt, t: number): Pt => ({ x: (1 - t) ** 2 * p0.x + 2 * (1 - t) * t * c.x + t * t * p1.x, y: (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * c.y + t * t * p1.y });
const quadTangent = (p0: Pt, c: Pt, p1: Pt, t: number): Pt => ({ x: 2 * (1 - t) * (c.x - p0.x) + 2 * t * (p1.x - c.x), y: 2 * (1 - t) * (c.y - p0.y) + 2 * t * (p1.y - c.y) });

/**
 * Where everything goes. States sit on the grid cells they asked for, spread over the stage; a pair of
 * opposite transitions (Ready ⇄ Running) bow apart so both are seen; a transition whose straight line
 * would cross another state bows around it; each label takes the clearest spot beside its curve.
 */
export function statesGeometry(stage: StatesStage, area: Rect, measure: Measure): StatesGeometry {
  const cols = stage.states.map((st) => st.col), rows = stage.states.map((st) => st.row);
  const c0 = Math.min(...cols), c1 = Math.max(...cols), r0 = Math.min(...rows), r1 = Math.max(...rows);
  const nc = c1 - c0, nr = r1 - r0;
  const hasTokens = Boolean(stage.tokens?.length);
  const cellW = (area.w - 40) / (nc + 1);
  const cellH = (area.h - 30) / (nr + 1);
  let rx = Math.max(50, Math.min(88, cellW * 0.36));
  const ry = Math.max(26, Math.min(hasTokens ? 40 : 32, cellH * 0.28));
  // Wide enough for the longest name at 15 px or more.
  const longest = Math.max(...stage.states.map((st) => measure(st.label, 15)));
  rx = Math.max(rx, Math.min(cellW * 0.46, longest / 1.6 + 10));
  const mx = rx + 14, my = ry + 34;
  const xAt = (c: number) => (nc ? area.x + mx + ((c - c0) / nc) * (area.w - 2 * mx) : area.x + area.w / 2);
  const yAt = (r: number) => (nr ? area.y + my + ((r - r0) / nr) * (area.h - 2 * my) : area.y + area.h / 2);
  let spare = 0;
  const states = stage.states.map((st) => {
    const color = STATE_COLORS.find(([re]) => re.test(st.label))?.[1] ?? SPARE[spare++ % SPARE.length];
    let size = 19;
    while (size > 13 && measure(st.label, size) > rx * 1.6) size -= 1;
    const cy = yAt(st.row);
    return { id: st.id, label: st.label, s: st.s, cx: xAt(st.col), cy, rx, ry, size, color, labelY: hasTokens ? cy - ry * 0.32 : cy };
  });
  const byId = new Map(states.map((st) => [st.id, st]));
  const insideOther = (p: Pt, except: string[]) => states.some((st) => !except.includes(st.id) && ((p.x - st.cx) / (st.rx + 10)) ** 2 + ((p.y - st.cy) / (st.ry + 10)) ** 2 < 1);
  const ovalBox = (st: (typeof states)[number]): Rect => ({ x: st.cx - st.rx, y: st.cy - st.ry, w: st.rx * 2, h: st.ry * 2 });

  const curves = stage.transitions.map((t) => {
    const a = byId.get(t.from)!, b = byId.get(t.to)!;
    if (a.id === b.id) {
      // A loop over the top of its state.
      const p0 = onEllipse(a.cx, a.cy, a.rx, a.ry, -0.55, -1, 2), p1 = onEllipse(a.cx, a.cy, a.rx, a.ry, 0.55, -1, 4);
      const k0 = { x: a.cx - a.rx * 0.9, y: a.cy - a.ry - 62 }, k1 = { x: a.cx + a.rx * 0.9, y: a.cy - a.ry - 62 };
      const samples = Array.from({ length: 13 }, (_, i) => {
        const u = i / 12;
        return { x: (1 - u) ** 3 * p0.x + 3 * (1 - u) ** 2 * u * k0.x + 3 * (1 - u) * u * u * k1.x + u ** 3 * p1.x, y: (1 - u) ** 3 * p0.y + 3 * (1 - u) ** 2 * u * k0.y + 3 * (1 - u) * u * u * k1.y + u ** 3 * p1.y };
      });
      return { t, a, b, p0, c: k0, p1, d: `M${p0.x} ${p0.y} C${k0.x} ${k0.y} ${k1.x} ${k1.y} ${p1.x} ${p1.y}`, tangent: { x: p1.x - k1.x, y: p1.y - k1.y }, samples, normal: { x: 0, y: -1 }, mid: { x: a.cx, y: a.cy - a.ry - 46 } };
    }
    const dx = b.cx - a.cx, dy = b.cy - a.cy, len = Math.hypot(dx, dy) || 1;
    const n = { x: -dy / len, y: dx / len };
    const mid = { x: (a.cx + b.cx) / 2, y: (a.cy + b.cy) / 2 };
    const reverse = stage.transitions.some((o) => o.from === t.to && o.to === t.from);
    let bend = reverse ? Math.min(70, len * 0.2) : 0;
    if (!reverse) {
      const crosses = (k: number) => Array.from({ length: 19 }, (_, i) => quad({ x: a.cx, y: a.cy }, { x: mid.x + n.x * k, y: mid.y + n.y * k }, { x: b.cx, y: b.cy }, (i + 1) / 20)).filter((p) => insideOther(p, [a.id, b.id])).length;
      if (crosses(0)) {
        const k = Math.min(140, len * 0.38);
        bend = crosses(k) <= crosses(-k) ? k : -k;
      }
    }
    const c = { x: mid.x + n.x * bend, y: mid.y + n.y * bend };
    const p0 = onEllipse(a.cx, a.cy, a.rx, a.ry, c.x - a.cx || dx, c.y - a.cy || dy, 2);
    const p1 = onEllipse(b.cx, b.cy, b.rx, b.ry, c.x - b.cx || -dx, c.y - b.cy || -dy, 4);
    const cc = bend ? c : { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
    const samples = Array.from({ length: 13 }, (_, i) => quad(p0, cc, p1, i / 12));
    return { t, a, b, p0, c: cc, p1, d: `M${p0.x} ${p0.y} Q${cc.x} ${cc.y} ${p1.x} ${p1.y}`, tangent: quadTangent(p0, cc, p1, 1), samples, normal: bend < 0 ? { x: -n.x, y: -n.y } : n, mid: quad(p0, cc, p1, 0.5) };
  });

  const labelBoxes: Rect[] = [];
  const transitions: StatesGeometry["transitions"] = curves.map((cv) => {
    const { t } = cv;
    // The arrowhead is part of the same stroke, so the pen draws it last.
    const ang = Math.atan2(cv.tangent.y, cv.tangent.x);
    const arm = (k: number) => `${cv.p1.x - Math.cos(ang + k) * 13} ${cv.p1.y - Math.sin(ang + k) * 13}`;
    const d = `${cv.d} L${arm(0.42)} M${cv.p1.x} ${cv.p1.y} L${arm(-0.42)}`;
    if (!t.label) return { id: t.id, from: t.from, to: t.to, s: t.s, d, labelSize: 14, samples: cv.samples };
    let size = 15;
    const w = () => measure(t.label!, size) + 6;
    const h = () => size * 1.25;
    // Candidate spots: beside the curve's middle on its outer side, then the inner side, then nearer either end.
    const spots: Array<{ at: Pt; n: Pt }> = [];
    const isLoop = cv.a.id === cv.b.id;
    if (isLoop) spots.push({ at: cv.mid, n: { x: 0, y: -1 } });
    else for (const u of [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]) for (const side of [1, -1]) {
      const p = quad(cv.p0, cv.c, cv.p1, u);
      const tg = quadTangent(cv.p0, cv.c, cv.p1, u);
      const l = Math.hypot(tg.x, tg.y) || 1;
      let nn = { x: -tg.y / l, y: tg.x / l };
      if (nn.x * cv.normal.x + nn.y * cv.normal.y < 0) nn = { x: -nn.x, y: -nn.y };
      spots.push({ at: p, n: { x: nn.x * side, y: nn.y * side } });
    }
    const score = (box: Rect) => {
      let bad = 0;
      for (const st of states) if (hit(box, ovalBox(st), 3)) bad += 3;
      for (const lb of labelBoxes) if (hit(box, lb, 3)) bad += 3;
      for (const other of curves) if (other.t.id !== t.id) for (const p of other.samples) if (p.x > box.x && p.x < box.x + box.w && p.y > box.y && p.y < box.y + box.h) bad += 1;
      if (box.x < area.x - 30 || box.x + box.w > area.x + area.w + 30 || box.y < area.y - 24 || box.y + box.h > area.y + area.h + 10) bad += 2;
      return bad;
    };
    let best: { box: Rect; at: Pt; bad: number; size: number } | null = null;
    // Smaller text, then a little further from the curve, before a label is allowed to sit on something.
    search: for (const attempt of [15, 13, 12]) {
      size = attempt;
      for (const away of [5, 16]) for (const sp of spots) {
        const off = Math.abs(sp.n.x) * (w() / 2) + Math.abs(sp.n.y) * (h() / 2) + away;
        const at = { x: sp.at.x + sp.n.x * off, y: sp.at.y + sp.n.y * off };
        const box = { x: at.x - w() / 2, y: at.y - h() / 2, w: w(), h: h() };
        const bad = score(box);
        if (!best || bad < best.bad) best = { box, at, bad, size };
        if (bad === 0) break search;
      }
    }
    labelBoxes.push(best!.box);
    return { id: t.id, from: t.from, to: t.to, label: t.label, s: t.s, d, labelAt: best!.at, labelSize: best!.size, labelBox: best!.box, samples: cv.samples };
  });

  const tokens: StatesGeometry["tokens"] = (stage.tokens ?? []).map((tk, k, all) => {
    const size = 14;
    const w = measure(tk.label, size) + 18, h = 22;
    const shift = (k - (all.length - 1) / 2) * (w + 6);
    const stops = tk.path.map((p, i) => {
      const st = byId.get(p.state)!;
      const prev = tk.path[i - 1]?.state;
      const via = prev ? stage.transitions.find((t) => t.from === prev && t.to === p.state)?.id : undefined;
      return { s: p.s, state: p.state, x: st.cx + shift, y: st.cy + st.ry * 0.42, ...(via ? { via } : {}) };
    });
    return { id: tk.id, label: tk.label, w, h, size, color: OS_PROCESS_COLORS[k % OS_PROCESS_COLORS.length], stops };
  });
  return { states, transitions, tokens };
}

/** What would be unreadable on a lifecycle board, named for a rewrite (layout is by code; this guards crowded cases). */
export function statesOverlaps(g: StatesGeometry): string[] {
  const issues: string[] = [];
  const ovals = g.states.map((st) => ({ label: st.label, box: { x: st.cx - st.rx, y: st.cy - st.ry, w: st.rx * 2, h: st.ry * 2 } }));
  const labels = g.transitions.filter((t) => t.labelBox).map((t) => ({ label: t.label!, box: t.labelBox! }));
  for (const l of labels) {
    for (const o of ovals) if (hit(l.box, o.box, -2)) issues.push(`the transition label "${l.label}" sits on the state "${o.label}" — shorter labels, or the states further apart (other cols/rows)`);
    for (const m of labels) if (m !== l && labels.indexOf(m) > labels.indexOf(l) && hit(l.box, m.box, -1)) issues.push(`the transition labels "${l.label}" and "${m.label}" overlap — shorter labels, or fewer transitions on this board`);
  }
  for (let i = 0; i < ovals.length; i++) for (let j = i + 1; j < ovals.length; j++) if (hit(ovals[i].box, ovals[j].box, 4)) issues.push(`the states "${ovals[i].label}" and "${ovals[j].label}" touch — put them in cells further apart`);
  return [...new Set(issues)];
}

export function describeStates(stage: StatesStage): string {
  const name = (id: string) => stage.states.find((st) => st.id === id)?.label ?? id;
  const lines = [
    `State diagram with states ${stage.states.map((st) => `${st.label} [sentence ${st.s}]`).join(", ")}.`,
    `Transitions: ${stage.transitions.map((t) => `${name(t.from)} → ${name(t.to)}${t.label ? ` "${t.label}"` : ""} [sentence ${t.s}]`).join("; ")}.`,
  ];
  for (const tk of stage.tokens ?? []) lines.push(`${tk.label} moves: ${tk.path.map((p) => `${name(p.state)} [sentence ${p.s}]`).join(" → ")}.`);
  return lines.join("\n");
}

export const STATES_GUIDE = `STATE DIAGRAM BOARD — a lifecycle drawn the way OS textbooks draw it (the process-state diagram): each state an oval, each transition a curved arrow labelled with the event that causes it, and the process itself as a chip that moves from state to state as Aria speaks. Return "stage": {"kind": "states", "states": [{"id": "new", "label": "New", "col": 0, "row": 0, "s": 0}, {"id": "ready", "label": "Ready", "col": 1, "row": 1, "s": 1}, {"id": "running", "label": "Running", "col": 3, "row": 1, "s": 2}, {"id": "waiting", "label": "Waiting", "col": 2, "row": 2, "s": 3}, {"id": "terminated", "label": "Terminated", "col": 3, "row": 0, "s": 4}], "transitions": [{"from": "new", "to": "ready", "label": "admitted", "s": 1}, {"from": "ready", "to": "running", "label": "scheduler dispatch", "s": 2}, {"from": "running", "to": "ready", "label": "interrupt", "s": 2}, {"from": "running", "to": "waiting", "label": "I/O or event wait", "s": 3}, {"from": "waiting", "to": "ready", "label": "I/O done", "s": 3}, {"from": "running", "to": "terminated", "label": "exit", "s": 4}], "tokens": [{"label": "P1", "path": [{"state": "new", "s": 0}, {"state": "ready", "s": 1}, {"state": "running", "s": 2}, {"state": "waiting", "s": 3}]}]}.
- 2 to 7 states, each named as the textbook names it (at most 18 characters). "col" (0 to 3) and "row" (0 to 2) place it on a 4 × 3 grid; code draws it exactly there, so lay it out like the textbook figure — the main path left to right, a waiting state below it, the end at the top right. Never give pixel positions.
- Up to 10 transitions, each labelled with its EVENT (at most 26 characters: "admitted", "scheduler dispatch", "interrupt", "I/O wait"), each drawn on the sentence that names it ("s"). Both directions between two states are two transitions; code bows them apart.
- "tokens" (optional, at most 2): a process or thread ("P1", "T1") and the state it is in from each sentence on. It only moves along a transition you drew, and each move is said in that sentence ("P1 asks for the disk, so it moves to Waiting").
- No other shapes: everything Aria says beyond the states and events is a note.`;

// ── Memory ─────────────────────────────────────────────────────────────────────────────────────

const SEGMENT_LABEL_MAX = 20;
const NOTE_MAX = 30;

function segmentsOf(v: unknown, sentence: Sentence, where: string, used: Set<string>): MemorySegment[] | string {
  const out: MemorySegment[] = [];
  for (const [i, raw] of arr(v).entries()) {
    const sg = obj(raw);
    const free = sg.free === true || /^(?:free|unused|empty|gap|free space)$/i.test(text(sg.label));
    const label = text(sg.label ?? sg.name ?? raw);
    if (!free && !label) return `${where} segment ${i + 1} needs a "label"`;
    if (label.length > SEGMENT_LABEL_MAX) return `${where} segment "${label}" is at most ${SEGMENT_LABEL_MAX} characters — the segment's name, its contents go in "note"`;
    const note = text(sg.note ?? sg.holds);
    if (note.length > NOTE_MAX) return `the note "${note}" is at most ${NOTE_MAX} characters`;
    let id = slugOf(sg.id ?? (label || `free-${i + 1}`), `seg-${i + 1}`);
    for (let k = 2; used.has(id); k++) id = `${slugOf(sg.id ?? label, "seg")}-${k}`;
    used.add(id);
    const size = num(sg.size);
    out.push({ id, label: free ? (label && !/^(?:free|unused|empty|gap)$/i.test(label) ? label : "") : label, s: sentence(sg.s ?? sg.sentence, 0), ...(size !== null ? { size: Math.max(1, Math.min(3, size)) } : {}), ...(free ? { free: true } : {}), ...(note ? { note } : {}) });
  }
  return out;
}

/** An address-space board from the writer's JSON, or null (with the reason kept for the rewrite). */
export function validateMemoryStage(r: Raw, sentence: Sentence, unique: Unique): MemoryStage | null {
  const used = new Set<string>();
  const columns: MemoryStage["columns"] = [];
  const rawCols = arr(r.columns).length ? arr(r.columns) : arr(r.segments).length ? [{ id: "memory", segments: r.segments, label: r.label }] : [];
  for (const [i, raw] of rawCols.entries()) {
    const c = obj(raw);
    const label = text(c.label ?? c.name);
    if (label.length > 22) return refuse(`a column's name is at most 22 characters (got "${label}")`);
    const segments = segmentsOf(c.segments, sentence, label || `column ${i + 1}`, used);
    if (typeof segments === "string") return refuse(segments);
    if (!segments.length || segments.length > 6) return refuse(`each column holds 1 to 6 segments, top to bottom (got ${segments.length})`);
    let id = slugOf(c.id ?? (label || `col-${i + 1}`), `col-${i + 1}`);
    for (let k = 2; used.has(id); k++) id = `${slugOf(c.id ?? label, "col")}-${k}`;
    used.add(id);
    columns.push({ id, ...(label ? { label } : {}), s: Math.min(sentence(c.s ?? c.sentence, 0), ...segments.map((sg) => sg.s)), segments });
  }
  if (!columns.length || columns.length > 4) return refuse(`an address-space board has 1 to 4 columns (got ${columns.length}): give "columns": [{"id", "label", "segments": [{"id", "label", "s"}]}]`);
  const shared = r.shared === undefined ? [] : segmentsOf(r.shared, sentence, "shared", used);
  if (typeof shared === "string") return refuse(shared);
  if (shared.length > 4) return refuse(`at most 4 shared segments (got ${shared.length})`);
  const sharedLabel = text(r.sharedLabel);
  const all = [...shared, ...columns.flatMap((c) => c.segments)];
  const growth: NonNullable<MemoryStage["growth"]> = [];
  for (const raw of arr(r.growth)) {
    const g = obj(raw);
    const want = slugOf(g.segment, "");
    const seg = columns.flatMap((c) => c.segments).find((sg) => sg.id === want || slugOf(sg.label, "") === want);
    const dir = g.dir === "up" || g.dir === "down" ? g.dir : null;
    if (!seg || !dir) return refuse(`a growth arrow needs "segment" (a segment id in a column) and "dir": "up" or "down"`);
    if (growth.some((x) => x.segment === seg.id)) continue;
    const label = text(g.label).slice(0, 14);
    growth.push({ segment: seg.id, dir, ...(label ? { label } : {}), s: Math.max(sentence(g.s ?? g.sentence, 0), seg.s) });
  }
  const a = obj(r.addresses);
  const top = text(a.top).slice(0, 16), bottom = text(a.bottom).slice(0, 16);
  unique("memory", "memory");
  for (const c of columns) unique(`col-${c.id}`, `col-${c.id}`);
  for (const sg of all) unique(`seg-${sg.id}`, `seg-${sg.id}`);
  return { kind: "memory", ...(shared.length ? { shared } : {}), ...(shared.length && sharedLabel ? { sharedLabel: sharedLabel.slice(0, 40) } : {}), columns, ...(growth.length ? { growth } : {}), ...(top && bottom ? { addresses: { top, bottom } } : {}) };
}

export type MemoryBlock = { id: string; label: string; note?: string; s: number; rect: Rect; free: boolean; size: number; noteSize: number; noteAt: "inside" | "right" | null; color: string };
export type MemoryGeometry = {
  blocks: MemoryBlock[];
  columns: Array<{ id: string; label?: string; s: number; rect: Rect; labelAt: Pt; size: number }>;
  sharedLabel?: { text: string; at: Pt; s: number };
  growth: Array<{ segment: string; s: number; p0: Pt; p1: Pt; label?: string; labelAt: Pt }>;
  addresses?: { top: string; bottom: string; x: number; topY: number; bottomY: number; s: number };
  outline?: Rect;
};

const SEGMENT_COLORS: Array<[RegExp, string]> = [
  [/\bstack\b/i, "#2563eb"],
  [/\bheap\b/i, "#d97706"],
  [/\b(?:data|bss|globals?|static)\b/i, "#15803d"],
  [/\b(?:text|code|instructions?)\b/i, "#7c3aed"],
  [/\b(?:registers?|pc|program counter)\b/i, "#be123c"],
  [/\b(?:files?|resources?)\b/i, "#0f766e"],
  [/\bkernel\b/i, "#475569"],
];

/**
 * Where everything goes. Segments fill their column top to bottom by size; a shared row spans every
 * column above them inside one outline (the process); a growth arrow points into the free gap beside its
 * segment; addresses are written at the column's top and bottom on the left.
 */
export function memoryGeometry(stage: MemoryStage, area: Rect, measure: Measure): MemoryGeometry {
  const n = stage.columns.length;
  const single = n === 1;
  const anyNote = stage.columns.some((c) => c.segments.some((sg) => sg.note));
  const left = stage.addresses ? Math.max(...[stage.addresses.top, stage.addresses.bottom].map((t) => measure(t, 13))) + 18 : 0;
  // One column with notes keeps room on its right for them (local variables, malloc'd objects…).
  const right = single && anyNote ? Math.min(220, Math.max(...stage.columns[0].segments.map((sg) => (sg.note ? measure(sg.note, 14) : 0))) + 30) : 0;
  const shared = stage.shared ?? [];
  const gap = 18;
  const colW = Math.min(single ? 250 : 210, (area.w - left - right - gap * (n - 1) - (shared.length ? 24 : 0)) / n);
  const totalW = colW * n + gap * (n - 1);
  const x0 = area.x + left + (area.w - left - right - totalW) / 2;
  const labelH = stage.columns.some((c) => c.label) ? 30 : 0;
  const sharedH = shared.length ? 62 : 0;
  const sharedCaption = shared.length ? 22 : 0;
  const pad = shared.length ? 12 : 0;
  const top = area.y + 6 + sharedCaption + pad;
  const blocks: MemoryBlock[] = [];
  let spare = 0;
  const colorOf = (label: string, free: boolean) => (free ? "#64748b" : SEGMENT_COLORS.find(([re]) => re.test(label))?.[1] ?? SPARE[spare++ % SPARE.length]);
  const fit = (label: string, w: number, max: number, min: number) => {
    let size = max;
    while (size > min && measure(label, size) > w - 14) size -= 1;
    return size;
  };
  if (shared.length) {
    const sw = (totalW - 0) / shared.length;
    shared.forEach((sg, i) => {
      const rect = { x: x0 + i * sw, y: top, w: sw, h: sharedH };
      blocks.push({ id: sg.id, label: sg.label, ...(sg.note ? { note: sg.note } : {}), s: sg.s, rect, free: false, size: fit(sg.label, sw, 17, 12), noteSize: sg.note ? fit(sg.note, sw, 13, 10) : 0, noteAt: sg.note ? "inside" : null, color: colorOf(sg.label, false) });
    });
  }
  const colTop = top + sharedH + (shared.length ? 16 : 0);
  const colH = area.y + area.h - colTop - labelH - pad - 4;
  const columns: MemoryGeometry["columns"] = [];
  stage.columns.forEach((c, ci) => {
    const x = x0 + ci * (colW + gap);
    const weights = c.segments.map((sg) => sg.size ?? (sg.free ? 1.6 : 1));
    const sum = weights.reduce((a, b) => a + b, 0);
    let y = colTop;
    c.segments.forEach((sg, i) => {
      const h = (colH * weights[i]) / sum;
      const rect = { x, y, w: colW, h };
      const size = sg.label ? fit(sg.label, colW, h < 44 ? 15 : 18, 11) : 0;
      const noteSize = sg.note ? fit(sg.note, colW, 13, 10) : 0;
      const roomInside = h >= size * 1.2 + noteSize * 1.2 + 14 && measure(sg.note ?? "", noteSize) <= colW - 12;
      blocks.push({ id: sg.id, label: sg.label, ...(sg.note ? { note: sg.note } : {}), s: sg.s, rect, free: Boolean(sg.free), size, noteSize: single && !roomInside ? 14 : noteSize, noteAt: !sg.note ? null : single && (right > 0) ? "right" : roomInside ? "inside" : null, color: colorOf(sg.label, Boolean(sg.free)) });
      y += h;
    });
    const label = c.label;
    columns.push({ id: c.id, ...(label ? { label } : {}), s: c.s, rect: { x, y: colTop, w: colW, h: colH }, labelAt: { x: x + colW / 2, y: colTop + colH + pad + 18 }, size: label ? fit(label, colW + gap, 16, 11) : 16 });
  });
  const growth: MemoryGeometry["growth"] = (stage.growth ?? []).map((g) => {
    const col = stage.columns.find((c) => c.segments.some((sg) => sg.id === g.segment))!;
    const idx = col.segments.findIndex((sg) => sg.id === g.segment);
    const b = blocks.find((bl) => bl.id === g.segment)!;
    const nextSeg = col.segments[idx + (g.dir === "down" ? 1 : -1)];
    const next = nextSeg && blocks.find((bl) => bl.id === nextSeg.id);
    // Into the free gap at the column's centre; beside a labelled neighbour, at its right edge.
    const x = next && !next.free ? b.rect.x + b.rect.w - 20 : b.rect.x + b.rect.w / 2;
    const len = Math.max(18, Math.min(46, (next?.rect.h ?? 40) * 0.6));
    const y0 = g.dir === "down" ? b.rect.y + b.rect.h + 3 : b.rect.y - 3;
    const y1 = g.dir === "down" ? y0 + len : y0 - len;
    const label = g.label;
    return { segment: g.segment, s: g.s, p0: { x, y: y0 }, p1: { x, y: y1 }, ...(label ? { label } : {}), labelAt: { x: x + 10, y: (y0 + y1) / 2 } };
  });
  const firstCol = columns[0];
  return {
    blocks,
    columns,
    ...(shared.length ? { sharedLabel: { text: stage.sharedLabel ?? "Shared by every thread", at: { x: x0, y: area.y + 6 + 14 }, s: Math.min(...shared.map((sg) => sg.s)) } } : {}),
    growth,
    ...(stage.addresses ? { addresses: { top: stage.addresses.top, bottom: stage.addresses.bottom, x: x0 - 10, topY: (shared.length ? top : firstCol.rect.y) + 10, bottomY: firstCol.rect.y + firstCol.rect.h - 6, s: Math.min(...stage.columns.map((c) => c.s)) } } : {}),
    ...(shared.length ? { outline: { x: x0 - 12, y: top - 12, w: totalW + 24, h: colTop + colH - top + 24 } } : {}),
  };
}

/** Words that would not fit their block, named for a rewrite. */
export function memoryOverlaps(g: MemoryGeometry, measure: Measure): string[] {
  const issues: string[] = [];
  for (const b of g.blocks) {
    if (b.label && measure(b.label, b.size) > b.rect.w - 8) issues.push(`the segment name "${b.label}" does not fit its block — a shorter name`);
    if (b.label && b.rect.h < b.size * 1.25) issues.push(`the segment "${b.label}" is too thin to hold its name — give it "size": 2, or fewer segments in the column`);
    if (b.note && !b.noteAt) issues.push(`the note "${b.note}" has no room in its block — a shorter note, or make the block bigger ("size": 2)`);
  }
  return [...new Set(issues)];
}

export function describeMemory(stage: MemoryStage): string {
  const seg = (sg: MemorySegment) => `${sg.free ? `(free space${sg.label ? `: ${sg.label}` : ""})` : sg.label}${sg.note ? ` — ${sg.note}` : ""} [sentence ${sg.s}]`;
  const lines = [`Memory layout, each column top to bottom${stage.addresses ? ` (${stage.addresses.top} at the top, ${stage.addresses.bottom} at the bottom)` : ""}:`];
  if (stage.shared?.length) lines.push(`${stage.sharedLabel ?? "Shared by every thread"}: ${stage.shared.map(seg).join(", ")}.`);
  for (const c of stage.columns) lines.push(`${c.label ?? "Column"}: ${c.segments.map(seg).join(", ")}.`);
  for (const g of stage.growth ?? []) lines.push(`Arrow: ${g.segment} grows ${g.dir}${g.label ? ` ("${g.label}")` : ""} [sentence ${g.s}].`);
  return lines.join("\n");
}

export const MEMORY_GUIDE = `MEMORY LAYOUT BOARD — memory drawn the way OS textbooks draw it: blocks stacked top to bottom, each named, revealed on the sentence that names it. Return "stage": {"kind": "memory", "columns": [{"id": "process", "label": "Process", "segments": [{"id": "stack", "label": "Stack", "note": "local variables, calls", "s": 1}, {"id": "free", "label": "", "free": true, "size": 2, "s": 1}, {"id": "heap", "label": "Heap", "note": "dynamic memory", "s": 2}, {"id": "data", "label": "Data", "note": "global variables", "s": 3}, {"id": "text", "label": "Text", "note": "program code", "s": 3}]}], "growth": [{"segment": "stack", "dir": "down", "label": "grows", "s": 1}, {"segment": "heap", "dir": "up", "label": "grows", "s": 2}], "addresses": {"top": "high address", "bottom": "low address"}}.
- A process's address space is ONE column: Stack at the top, the free gap ("free": true), Heap, Data, Text at the bottom. "growth" draws the stack growing down and the heap growing up into the gap.
- What threads share and what each keeps (a multithreaded process): "shared" is the row every thread shares — [{"id": "code", "label": "Code"}, {"id": "data", "label": "Data"}, {"id": "files", "label": "Files"}] — and one column per thread ("label": "Thread 1") holding its own [{"label": "Registers"}, {"label": "Stack"}]; at most 4 columns. A single-threaded process is one column with code, data, files, registers and stack.
- Names at most 20 characters; "note" (optional, at most 30 characters) says what the block holds; "size" (1 to 3) makes a block taller. 1 to 6 blocks a column. Code places everything: give no positions.
- Use the processes and threads of the lesson's example, the same on every board.`;

// ── Gantt ──────────────────────────────────────────────────────────────────────────────────────

/** A schedule board from the writer's JSON, or null (with the reason kept for the rewrite). */
export function validateGanttStage(r: Raw, sentence: Sentence, unique: Unique): GanttStage | null {
  // One CPU bar, or up to three compared on one time axis ("rows": FCFS / SJF / RR, or interleaved / block /
  // simultaneous). The writer's own key names are accepted: a multithreading board's schedule came back
  // under another key twice and was refused as "0 slots" (2026-10-25).
  const listOf = (o: Raw) => arr(o.slots ?? o.blocks ?? o.bars ?? o.schedule ?? o.timeline ?? o.segments);
  const rawRows = arr(r.rows ?? r.charts ?? r.timelines ?? r.lanes ?? r.schedules);
  const grouped = rawRows.length > 0 && rawRows.every((x) => listOf(obj(x)).length > 0);
  const groups = grouped ? rawRows.map((x) => ({ label: text(obj(x).label ?? obj(x).name ?? obj(x).algorithm ?? obj(x).title), slots: listOf(obj(x)) })) : [{ label: "", slots: listOf(r) }];
  if (groups.length > 3) return refuse(`at most 3 schedules compared on one board (got ${groups.length}): show the rest on the next board`);
  const rows: string[] = [];
  const slots: GanttStage["slots"] = [];
  for (const [ri, g] of groups.entries()) {
    if (grouped && (!g.label || g.label.length > 12)) return refuse(`each row needs a short name of at most 12 characters ("FCFS", "RR", "SMT"), got "${g.label}"`);
    rows.push(g.label);
    const mine: GanttStage["slots"] = [];
    for (const [i, raw] of g.slots.entries()) {
      const sl = obj(raw);
      const label = text(sl.label ?? sl.process ?? sl.thread ?? sl.name ?? sl.task);
      const start = num(sl.start ?? sl.from ?? sl.begin);
      const duration = num(sl.duration ?? sl.length);
      const end = num(sl.end ?? sl.to ?? sl.finish) ?? (start !== null && duration !== null ? start + duration : null);
      if (!label || label.length > 8) return refuse(`slot ${i + 1}${grouped ? ` of ${g.label}` : ""} needs the process's short name as "label" (at most 8 characters: "P1", "T2", "idle")`);
      if (start === null || end === null || end <= start) return refuse(`slot ${i + 1} (${label}) needs numbers "start" < "end"`);
      mine.push({ id: "", label, start, end, s: sentence(sl.s ?? sl.sentence, i), ...(grouped ? { row: ri } : {}) });
    }
    mine.sort((a, b) => a.start - b.start);
    for (let i = 1; i < mine.length; i++) if (mine[i].start < mine[i - 1].end) return refuse(`slots ${mine[i - 1].label} (${mine[i - 1].start}–${mine[i - 1].end}) and ${mine[i].label} (${mine[i].start}–${mine[i].end}) overlap: one CPU runs one process at a time`);
    // Time runs left to right: a slot is never drawn before the one to its left.
    let lastS = 0;
    for (const sl of mine) { sl.s = Math.max(lastS, sl.s); lastS = sl.s; }
    slots.push(...mine);
  }
  if (!slots.length || slots.length > 30 || groups.some((g) => !g.slots.length)) return refuse(`give "slots": [{"label", "start", "end", "s"}] — 1 to 14 for one CPU bar, or "rows": [{"label": "FCFS", "slots": [...]}] for up to 3 schedules (got ${slots.length} slots)`);
  if (groups.some((g) => g.slots.length > 14)) return refuse(`a schedule row has 1 to 14 slots: a longer one continues on the next board`);
  slots.forEach((sl, i) => { sl.id = `slot-${i + 1}`; });
  const t0 = Math.min(...slots.map((sl) => sl.start)), t1 = Math.max(...slots.map((sl) => sl.end));
  if (t1 - t0 > 80) return refuse(`the schedule spans ${t1 - t0} time units: keep it to 80 or fewer (smaller burst times)`);
  const arrivals: NonNullable<GanttStage["arrivals"]> = [];
  for (const raw of arr(r.arrivals)) {
    const a = obj(raw);
    const label = text(a.label ?? a.process).slice(0, 8);
    const at = num(a.at ?? a.time);
    if (!label || at === null) continue;
    const same = arrivals.find((x) => x.at === at);
    if (same) { if (same.label.length + label.length < 14) same.label = `${same.label}, ${label}`; continue; }
    arrivals.push({ label, at: Math.max(t0, Math.min(t1, at)), s: sentence(a.s ?? a.sentence, 0) });
  }
  // The ready queue belongs to one CPU's schedule: a comparison of schedules has none.
  const queue: NonNullable<GanttStage["queue"]> = [];
  if (!grouped) for (const raw of arr(r.queue)) {
    const q = obj(raw);
    const items = arr(q.items).map((x) => text(x).slice(0, 8)).filter(Boolean).slice(0, 7);
    queue.push({ s: sentence(q.s ?? q.sentence, 0), items });
  }
  queue.sort((a, b) => a.s - b.s);
  const unit = text(r.unit).slice(0, 6);
  unique("gantt", "gantt");
  for (const sl of slots) unique(sl.id, sl.id);
  if (queue.length) unique("queue", "queue");
  return { kind: "gantt", ...(unit ? { unit } : {}), ...(grouped ? { rows } : {}), slots, ...(arrivals.length ? { arrivals } : {}), ...(queue.length ? { queue } : {}) };
}

export type GanttGeometry = {
  bars: Array<{ label: string; rect: Rect; labelAt: Pt; size: number; s: number }>;
  slots: Array<{ id: string; label: string; s: number; rect: Rect; color: string; idle: boolean; size: number; start: number; end: number }>;
  ticks: Array<{ value: number; x: number; y: number; top: number; s: number }>;
  arrivals: Array<{ label: string; s: number; x: number; top: number; bottom: number }>;
  queue?: { caption: Pt; y: number; x0: number; chipH: number; states: Array<{ s: number; chips: Array<{ label: string; x: number; w: number; color: string }> }> };
  unit?: { text: string; at: Pt };
};

export function ganttGeometry(stage: GanttStage, area: Rect, measure: Measure): GanttGeometry {
  const t0 = Math.min(...stage.slots.map((sl) => sl.start)), t1 = Math.max(...stage.slots.map((sl) => sl.end));
  const rowNames = stage.rows?.length ? stage.rows : ["CPU"];
  const n = rowNames.length;
  const labelW = Math.min(118, Math.max(58, ...rowNames.map((l) => measure(l, 16) + 16)));
  const x0 = area.x + labelW, x1 = area.x + area.w - 24;
  const scale = (x1 - x0) / (t1 - t0 || 1);
  const xOf = (t: number) => x0 + (t - t0) * scale;
  const hasArrivals = Boolean(stage.arrivals?.length);
  const hasQueue = Boolean(stage.queue?.length);
  const barH = n === 1 ? 66 : n === 2 ? 54 : 44;
  const tickRoom = 44, rowGap = 12, arrivalRoom = hasArrivals ? 62 : 0, queueRoom = hasQueue ? 104 : 0, unitRoom = stage.unit ? 20 : 0;
  const total = arrivalRoom + n * (barH + tickRoom) + (n - 1) * rowGap + queueRoom + unitRoom;
  const top = area.y + Math.max(8, (area.h - total) / 2) + arrivalRoom;
  const rowY = (i: number) => top + i * (barH + tickRoom + rowGap);
  const names = [...new Set(stage.slots.filter((sl) => !/^idle$/i.test(sl.label)).map((sl) => sl.label))];
  const colorOf = (label: string) => (/^idle$/i.test(label) ? "#64748b" : OS_PROCESS_COLORS[Math.max(0, names.indexOf(label)) % OS_PROCESS_COLORS.length]);
  const bars = rowNames.map((label, i) => {
    const rowSlots = stage.slots.filter((sl) => (sl.row ?? 0) === i);
    let size = 17;
    while (size > 12 && measure(label, size) > labelW - 12) size -= 1;
    return { label, rect: { x: x0, y: rowY(i), w: x1 - x0, h: barH }, labelAt: { x: area.x + labelW / 2 - 4, y: rowY(i) + barH / 2 }, size, s: Math.min(...rowSlots.map((sl) => sl.s)) };
  });
  const slots = stage.slots.map((sl) => {
    const rect = { x: xOf(sl.start), y: rowY(sl.row ?? 0), w: (sl.end - sl.start) * scale, h: barH };
    let size = n === 1 ? 18 : 16;
    while (size > 11 && measure(sl.label, size) > rect.w - 6) size -= 1;
    return { id: sl.id, label: sl.label, s: sl.s, rect, color: colorOf(sl.label), idle: /^idle$/i.test(sl.label), size, start: sl.start, end: sl.end };
  });
  // A tick at every boundary of each row, written when the slot that ends (or starts) there is drawn; close ticks step down.
  const ticks: GanttGeometry["ticks"] = [];
  rowNames.forEach((_, i) => {
    const rowSlots = stage.slots.filter((sl) => (sl.row ?? 0) === i);
    const bounds = [...new Set(rowSlots.flatMap((sl) => [sl.start, sl.end]))].sort((a, b) => a - b);
    const bottom = rowY(i) + barH;
    let lastRight = -Infinity, lastLow = false;
    for (const v of bounds) {
      const x = xOf(v);
      const w = measure(String(v), 14);
      const low: boolean = x - w / 2 < lastRight + 4 && !lastLow;
      const s = Math.min(...rowSlots.filter((sl) => sl.start === v || sl.end === v).map((sl) => sl.s));
      ticks.push({ value: v, x, y: bottom + (low ? 36 : 20), top: bottom, s });
      if (!low) lastRight = x + w / 2;
      lastLow = low;
    }
  });
  const arrivals = (stage.arrivals ?? []).map((a) => ({ label: a.label, s: a.s, x: xOf(a.at), top: rowY(0) - 44, bottom: rowY(0) - 4 }));
  const lastBottom = rowY(n - 1) + barH + tickRoom;
  let queue: GanttGeometry["queue"];
  if (hasQueue) {
    const y = lastBottom + 30;
    const qx0 = area.x + 132;
    queue = {
      caption: { x: area.x + 4, y: y + 15 },
      y,
      x0: qx0,
      chipH: 30,
      states: stage.queue!.map((q) => {
        let x = qx0;
        const chips = q.items.map((label) => {
          const w = Math.max(44, measure(label, 15) + 22);
          const chip = { label, x, w, color: colorOf(label) };
          x += w + 8;
          return chip;
        });
        return { s: q.s, chips };
      }),
    };
  }
  return { bars, slots, ticks, arrivals, ...(queue ? { queue } : {}), ...(stage.unit ? { unit: { text: `time (${stage.unit})`, at: { x: x1, y: lastBottom + 8 } } } : {}) };
}

/** Words that would not fit, named for a rewrite. */
export function ganttOverlaps(g: GanttGeometry, measure: Measure, area: Rect): string[] {
  const issues: string[] = [];
  for (const sl of g.slots) if (measure(sl.label, sl.size) > sl.rect.w - 4) issues.push(`the slot "${sl.label}" (${sl.start}–${sl.end}) is too narrow for its name — the schedule is too long for one board: fewer slots, or split it over two boards`);
  const sorted = [...g.arrivals].sort((a, b) => a.x - b.x);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].x - sorted[i - 1].x < (measure(sorted[i].label, 13) + measure(sorted[i - 1].label, 13)) / 2 + 4) issues.push(`the arrivals "${sorted[i - 1].label}" and "${sorted[i].label}" are too close to read — give arrivals only where Aria names them`);
  for (const q of g.queue?.states ?? []) {
    const last = q.chips.at(-1);
    if (last && last.x + last.w > area.x + area.w + 4) issues.push(`the ready queue at sentence ${q.s} is too long for the board — at most 5 or 6 processes in it`);
  }
  for (const b of g.bars) if (b.rect.y < area.y - 2 || b.rect.y + b.rect.h > area.y + area.h + 2) issues.push(`the schedules do not fit the board — fewer rows, or no ready queue`);
  return [...new Set(issues)];
}

export function describeGantt(stage: GanttStage): string {
  const u = stage.unit ? ` ${stage.unit}` : "";
  const rowsOf = stage.rows?.length ? stage.rows : [""];
  const lines = rowsOf.map((row, i) => `${row ? `${row} schedule` : "CPU schedule"} (Gantt chart): ${stage.slots.filter((sl) => (sl.row ?? 0) === i).map((sl) => `${sl.label} ${sl.start}–${sl.end}${u} [sentence ${sl.s}]`).join(", ")}.`);
  if (stage.arrivals?.length) lines.push(`Arrivals: ${stage.arrivals.map((a) => `${a.label} at ${a.at}${u} [sentence ${a.s}]`).join(", ")}.`);
  if (stage.queue?.length) lines.push(`Ready queue: ${stage.queue.map((q) => `[sentence ${q.s}] ${q.items.join(", ") || "empty"}`).join("; ")}.`);
  return lines.join("\n");
}

export const GANTT_GUIDE = `GANTT CHART BOARD — CPU time drawn the way OS textbooks draw it: a bar along the time axis, each process's or thread's turn on the CPU a block from its start to its end time, the times written under the boundaries. Return "stage": {"kind": "gantt", "unit": "ms", "slots": [{"label": "P1", "start": 0, "end": 4, "s": 1}, {"label": "P2", "start": 4, "end": 7, "s": 2}, {"label": "P1", "start": 7, "end": 9, "s": 3}], "arrivals": [{"label": "P1", "at": 0, "s": 0}, {"label": "P2", "at": 1, "s": 0}], "queue": [{"s": 1, "items": ["P2", "P3"]}, {"s": 2, "items": ["P3", "P1"]}]}.
- To COMPARE schedules (FCFS against SJF and round robin; interleaved, blocked and simultaneous multithreading), give "rows" instead of "slots", up to 3 on one time axis: "rows": [{"label": "FCFS", "slots": [...]}, {"label": "RR", "slots": [...]}] (row names at most 12 characters). The same processes are the same colour in every row.
- Each slot is drawn on the sentence that says it runs ("s"), in time order; slots in a row never overlap, and a gap with nothing to run is a slot labelled "idle". Compute the times exactly from the lesson's arrival and burst times (and the quantum for round robin) — the same processes and numbers on every board.
- "label" is the process's or thread's short name (at most 8 characters: "P1", "T2"). At most 14 slots a row and 80 time units; a longer schedule continues on the next board.
- "arrivals" (optional): when each process arrives, drawn as a small arrow above the bar. "queue" (optional, one bar only): the ready queue, front first, as it is from that sentence on — the student watches processes join and leave it.
- No other shapes: waiting and turnaround times are notes.`;

// ── Which picture an OS board needs ────────────────────────────────────────────────────────────

const GANTT_WORDS = /\b(?:(?:interleaved|fine[- ]grained|coarse[- ]grained|block(?:ed)?|simultaneous|temporal|hardware) multithreading|smt|hyper-?threading|fcfs|first[- ]come,? first[- ]served|round[- ]robin|sjf|srtf|shortest[- ](?:job|remaining)[- ]\w+|priority scheduling|time (?:quantum|slice)|quantum|burst times?|gantt|turnaround|waiting times?|scheduling algorithms?|preemptive scheduling|non-?preemptive)\b/i;
const STATE_WORDS = /\b(?:states?|life ?cycles?|transitions?|moves? (?:to|from|into|between))\b/i;
const STATE_NAMES = /\b(?:new|ready|running|runnable|blocked|waiting|terminated|suspended|zombie|sleeping)\b/gi;
const MEMORY_WORDS = /\b(?:address spaces?|memory layout|stack|heap|text segment|code segment|data segment|bss|segments?|registers?|program counter|share[sd]?|sharing|private|own (?:stack|registers)|global variables)\b/gi;
// A memory layout needs a part of memory named (stack, heap, a segment, registers): "share" and "private" alone
// made a producer–consumer board into a "memory layout" of steps (2026-10-25).
const MEMORY_PARTS = /\b(?:address spaces?|memory layout|stacks?|heap|segments?|bss|registers?|program counter)\b/i;
const SYNC_WORDS = /\b(?:race conditions?|producers?|consumers?|bounded buffer|lost (?:update|increment)s?|critical sections?|mutex(?:es)?|lock(?:s|ed|ing)?|unlock\w*|acquir\w*|releas\w*|semaphores?|wait\(\)|signal\(\))\b/i;
const TWO_THREADS = /\b(?:T1\b[\s\S]*\bT2|thread (?:1|a)\b[\s\S]*\bthread (?:2|b)|producer\b[\s\S]*\bconsumer|consumer\b[\s\S]*\bproducer|two threads)\b/i;

/**
 * The OS picture a board's words call for, or null (the board keeps the planner's choice): a scheduling
 * algorithm is a Gantt chart, a lifecycle a state diagram, two threads racing a sequence, an address space
 * a memory layout. Typed OS lessons only (lib/canvas/visualPolicy.ts).
 */
export function osStageFor(boardText: string, headline?: string): OsStage | null {
  // The planner names the picture at the start of the brief (OS_PLAN_RULE): it read the whole board, so it wins.
  const tag = PICTURE_TAGS.find(([re]) => re.test((headline ?? "").trim()));
  if (tag) return tag[1];
  // Then the board's title and brief, and only then its narration: one passing "race condition" in a script about
  // what threads share made that board a sequence (2026-10-25).
  if (headline) return wordsStage(headline) ?? wordsStage(boardText);
  return wordsStage(boardText);
}

type OsStage = "gantt" | "states" | "sequence" | "memory" | "mapping";
const PICTURE_TAGS: Array<[RegExp, OsStage]> = [
  [/^(?:[^:]*\b)?state diagram\s*:/i, "states"],
  [/^(?:[^:]*\b)?memory layout\s*:/i, "memory"],
  [/^(?:[^:]*\b)?gantt chart\s*:/i, "gantt"],
  [/^(?:[^:]*\b)?mapping\s*:/i, "mapping"],
  [/^(?:[^:]*\b)?sequence\s*:/i, "sequence"],
];
const MAPPING_WORDS = /\b(?:many[- ]to[- ]one|one[- ]to[- ]one|many[- ]to[- ]many|two[- ]level model|(?:multi)?threading models?|user[- ]level threads? (?:to|onto) kernel|page tables?|virtual pages? (?:to|onto|map\w*))\b/i;

function wordsStage(boardText: string): OsStage | null {
  if (GANTT_WORDS.test(boardText)) return "gantt";
  if (MAPPING_WORDS.test(boardText)) return "mapping";
  const stateNames = new Set((boardText.match(STATE_NAMES) ?? []).map((w) => w.toLowerCase()));
  if (STATE_WORDS.test(boardText) && stateNames.size >= 2) return "states";
  if (SYNC_WORDS.test(boardText) && TWO_THREADS.test(boardText)) return "sequence";
  const memory = new Set((boardText.match(MEMORY_WORDS) ?? []).map((w) => w.toLowerCase().replace(/s$/, "")));
  if (memory.size >= 2 && MEMORY_PARTS.test(boardText)) return "memory";
  return null;
}

/** What the writer of an OS sequence board is told: the threads and what they share, not client and server. */
export const OS_SEQUENCE_HINT = `THIS SEQUENCE IS TWO THREADS AND WHAT THEY SHARE: the lanes are the threads and the shared variable or lock between them ("T1", "counter", "T2"; "T1", "mutex", "T2"; "Producer", "buffer", "Consumer"); each message is ONE read, write, lock or unlock with its value as the detail ("read", "count=5"; "write", "count=6"; "lock", "granted"), in the order they really interleave. A thread never sends a lock to another thread: a lock request goes to the lock or resource itself. DEADLOCK: the lanes are the two threads with the two resources between them ("Thread A", "R1", "R2", "Thread B"); each lock request is one message to its resource, "granted" or "blocked" as the detail, so the circular wait is seen.`;

/** The planner's rule for a typed operating-systems lesson: each board's brief names exactly what its picture holds. */
export const OS_PLAN_RULE = [
  "THE PICTURES AN OPERATING-SYSTEMS LESSON NEEDS — each board's brief STARTS with the name of its picture and a colon (\"STATE DIAGRAM:\", \"MEMORY LAYOUT:\", \"GANTT CHART:\", \"SEQUENCE:\", \"MAPPING:\"; none for the opening map or a board of reasons), then names exactly what is drawn, with the lesson's own processes and values:",
  "- A LIFECYCLE (process or thread states): a state diagram — name every state and every transition with the event that causes it (\"New → Ready: admitted\", \"Ready → Running: scheduler dispatch\", \"Running → Waiting: I/O request\"), and the one process (P1) that moves through them.",
  "- WHAT IS IN MEMORY (an address space; what threads share and what each keeps): a memory layout — the segments top to bottom (Stack, free, Heap, Data, Text), or the shared code, data and files with each thread's own registers and stack.",
  "- A SCHEDULING ALGORITHM: a Gantt chart — the processes with their arrival and burst times (and the quantum), and the blocks in order with their start and end times. Comparing algorithms, or the kinds of hardware multithreading (interleaved, blocked, simultaneous), is up to three Gantt rows on one time axis.",
  "- TWO THREADS RACING OR SYNCHRONISING: a sequence — the two threads and the shared variable or lock, each read, write, lock or unlock in the order it happens.",
  "- THREADING MODELS (many-to-one, one-to-one, many-to-many) and A PAGE TABLE: a mapping — user threads above kernel threads (or virtual pages above physical frames), one arrow per mapping, up to three models side by side.",
  "- PAGE REPLACEMENT: the frames as an array, one page loaded per sentence. DEADLOCK: processes and resources as a graph (P1 waits for R1, R1 held by P2).",
  "- Never a free sketch, and never a graph of abbreviations (\"P\", \"MEM\", \"RES\"): every box is named in full.",
].join("\n");

// ── Mapping ────────────────────────────────────────────────────────────────────────────────────

/**
 * A MAPPING, top row to bottom row (the second multithreading lecture, 2026-10-25: its threading-models
 * board was a flow chart whose arrows found no path and it shipped as a fallback). The textbook picture is
 * user threads above, kernel threads below, a line for each mapping — many-to-one, one-to-one and
 * many-to-many side by side. Pages mapped to frames by a page table are the same picture.
 */
export function validateMappingStage(r: Raw, sentence: Sentence, unique: Unique): MappingStage | null {
  const rawGroups = arr(r.groups ?? r.models ?? r.mappings).length ? arr(r.groups ?? r.models ?? r.mappings) : [r];
  if (rawGroups.length > 3) return refuse(`at most 3 mappings side by side (got ${rawGroups.length}): show the rest on the next board`);
  const used = new Set<string>();
  const groups: MappingStage["groups"] = [];
  for (const [gi, raw] of rawGroups.entries()) {
    const g = obj(raw);
    const label = text(g.label ?? g.name ?? g.model);
    if (label.length > 18) return refuse(`a mapping's name is at most 18 characters ("Many-to-one", "Page table"), got "${label}"`);
    const items = (v: unknown, where: string) => {
      const out: Array<{ id: string; label: string; s: number }> = [];
      for (const [i, x] of arr(v).entries()) {
        const it = obj(x);
        const l = text(it.label ?? it.name ?? x);
        if (!l || l.length > 8) return `each ${where} item needs a short name of at most 8 characters ("U1", "K1", "Page 0"), got "${l}"`;
        let id = slugOf(it.id ?? `${gi}-${l}`, `${where}-${gi}-${i}`);
        for (let k = 2; used.has(id); k++) id = `${slugOf(it.id ?? `${gi}-${l}`, "item")}-${k}`;
        used.add(id);
        out.push({ id, label: l, s: sentence(it.s ?? it.sentence, 0) });
      }
      return out;
    };
    const top = items(g.top ?? g.from ?? g.user, "top");
    if (typeof top === "string") return refuse(top);
    const bottom = items(g.bottom ?? g.to ?? g.kernel, "bottom");
    if (typeof bottom === "string") return refuse(bottom);
    if (!top.length || !bottom.length || top.length > 6 || bottom.length > 6) return refuse(`each mapping has 1 to 6 items in its top row and 1 to 6 in its bottom row (got ${top.length} and ${bottom.length})`);
    const find = (list: typeof top, v: unknown) => {
      const t = text(v);
      const n = num(v);
      return list.find((it) => it.id === slugOf(v, "") || it.label === t || it.id === slugOf(`${gi}-${t}`, "")) ?? (n !== null && Number.isInteger(n) ? list[n] : undefined);
    };
    const links: MappingStage["groups"][number]["links"] = [];
    for (const [i, x] of arr(g.links ?? g.maps ?? g.arrows).entries()) {
      const l = Array.isArray(x) ? { from: x[0], to: x[1] } : obj(x);
      const from = find(top, l.from), to = find(bottom, l.to);
      if (!from || !to) return refuse(`link ${i + 1}${label ? ` of ${label}` : ""} needs "from" naming a top item (${top.map((t) => t.label).join(", ")}) and "to" naming a bottom item (${bottom.map((b) => b.label).join(", ")})`);
      if (links.some((k) => k.from === from.id && k.to === to.id)) continue;
      links.push({ from: from.id, to: to.id, s: Math.max(sentence((l as Raw).s ?? (l as Raw).sentence, 0), from.s, to.s) });
    }
    let id = slugOf(g.id ?? (label || `map-${gi + 1}`), `map-${gi + 1}`);
    for (let k = 2; used.has(id); k++) id = `${slugOf(g.id ?? label, "map")}-${k}`;
    used.add(id);
    groups.push({ id, ...(label ? { label } : {}), top, bottom, links });
  }
  const topLabel = text(r.topLabel).slice(0, 16), bottomLabel = text(r.bottomLabel).slice(0, 16);
  unique("mapping", "mapping");
  for (const g of groups) {
    unique(`map-${g.id}`, `map-${g.id}`);
    for (const it of [...g.top, ...g.bottom]) unique(`item-${it.id}`, `item-${it.id}`);
  }
  return { kind: "mapping", ...(topLabel ? { topLabel } : {}), ...(bottomLabel ? { bottomLabel } : {}), groups };
}

export type MappingGeometry = {
  groups: Array<{ id: string; label?: string; labelAt: Pt; s: number; frame: Rect }>;
  items: Array<{ id: string; label: string; s: number; rect: Rect; row: "top" | "bottom"; color: string; size: number }>;
  links: Array<{ id: string; s: number; d: string; p0: Pt; p1: Pt }>;
  rowLabels: Array<{ text: string; at: Pt; s: number }>;
};

export function mappingGeometry(stage: MappingStage, area: Rect, measure: Measure): MappingGeometry {
  const left = stage.topLabel || stage.bottomLabel ? Math.min(130, Math.max(measure(stage.topLabel ?? "", 14), measure(stage.bottomLabel ?? "", 14)) + 18) : 0;
  const n = stage.groups.length;
  const gap = 22;
  const gw = (area.w - left - gap * (n - 1)) / n;
  const itemH = 38;
  const topY = area.y + 26, bottomY = area.y + area.h - itemH - 52;
  const groups: MappingGeometry["groups"] = [];
  const items: MappingGeometry["items"] = [];
  const links: MappingGeometry["links"] = [];
  stage.groups.forEach((g, gi) => {
    const x = area.x + left + gi * (gw + gap);
    const row = (list: typeof g.top, y: number, which: "top" | "bottom") => {
      const w = Math.min(84, (gw - 10 * (list.length + 1)) / list.length);
      const span = list.length * w + (list.length - 1) * 10;
      list.forEach((it, i) => {
        let size = 16;
        while (size > 11 && measure(it.label, size) > w - 8) size -= 1;
        items.push({ id: it.id, label: it.label, s: it.s, rect: { x: x + (gw - span) / 2 + i * (w + 10), y, w, h: itemH }, row: which, color: which === "top" ? "#2563eb" : "#15803d", size });
      });
    };
    row(g.top, topY, "top");
    row(g.bottom, bottomY, "bottom");
    for (const l of g.links) {
      const a = items.find((it) => it.id === l.from)!, b = items.find((it) => it.id === l.to)!;
      const p0 = { x: a.rect.x + a.rect.w / 2, y: a.rect.y + a.rect.h + 3 }, p1 = { x: b.rect.x + b.rect.w / 2, y: b.rect.y - 4 };
      const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      const arm = (k: number) => `${p1.x - Math.cos(ang + k) * 12} ${p1.y - Math.sin(ang + k) * 12}`;
      links.push({ id: `${l.from}-${l.to}`, s: l.s, p0, p1, d: `M${p0.x} ${p0.y} L${p1.x} ${p1.y} L${arm(0.42)} M${p1.x} ${p1.y} L${arm(-0.42)}` });
    }
    const s = Math.min(...[...g.top, ...g.bottom].map((it) => it.s));
    groups.push({ id: g.id, ...(g.label ? { label: g.label } : {}), labelAt: { x: x + gw / 2, y: bottomY + itemH + 30 }, s, frame: { x: x - 6, y: topY - 14, w: gw + 12, h: bottomY + itemH - topY + 28 } });
  });
  const first = Math.min(...items.map((it) => it.s));
  const rowLabels = [
    ...(stage.topLabel ? [{ text: stage.topLabel, at: { x: area.x, y: topY + itemH / 2 }, s: first }] : []),
    ...(stage.bottomLabel ? [{ text: stage.bottomLabel, at: { x: area.x, y: bottomY + itemH / 2 }, s: first }] : []),
  ];
  return { groups, items, links, rowLabels };
}

/** Words that would not fit, named for a rewrite. */
export function mappingOverlaps(g: MappingGeometry, measure: Measure): string[] {
  const issues: string[] = [];
  for (const it of g.items) if (measure(it.label, it.size) > it.rect.w - 4) issues.push(`"${it.label}" does not fit its box — shorter names, or fewer items in the row`);
  for (const gr of g.groups) if (gr.label && measure(gr.label, 15) > gr.frame.w) issues.push(`the mapping name "${gr.label}" is wider than its column — a shorter name`);
  return [...new Set(issues)];
}

export function describeMapping(stage: MappingStage): string {
  const lines = [`Mapping from ${stage.topLabel ?? "the top row"} to ${stage.bottomLabel ?? "the bottom row"}:`];
  for (const g of stage.groups) {
    const name = (id: string) => [...g.top, ...g.bottom].find((it) => it.id === id)?.label ?? id;
    lines.push(`${g.label ?? "Mapping"}: top ${g.top.map((it) => it.label).join(", ")}; bottom ${g.bottom.map((it) => it.label).join(", ")}; links ${g.links.map((l) => `${name(l.from)} → ${name(l.to)} [sentence ${l.s}]`).join(", ") || "none"}.`);
  }
  return lines.join("\n");
}

export const MAPPING_GUIDE = `MAPPING BOARD — one row mapped onto another, drawn the way OS textbooks draw it: the top row's items (user threads, virtual pages) above, the bottom row's (kernel threads, physical frames) below, an arrow for each mapping, drawn on the sentence that says it. Return "stage": {"kind": "mapping", "topLabel": "user threads", "bottomLabel": "kernel threads", "groups": [{"label": "Many-to-one", "top": [{"id": "u1", "label": "U1", "s": 1}, {"id": "u2", "label": "U2", "s": 1}, {"id": "u3", "label": "U3", "s": 1}], "bottom": [{"id": "k1", "label": "K1", "s": 1}], "links": [{"from": "u1", "to": "k1", "s": 1}, {"from": "u2", "to": "k1", "s": 1}, {"from": "u3", "to": "k1", "s": 1}]}, {"label": "One-to-one", "top": [...], "bottom": [...], "links": [...]}]}.
- 1 to 3 groups side by side (threading models: many-to-one, one-to-one, many-to-many; or ONE page table). Each group 1 to 6 items a row, names at most 8 characters ("U1", "K2", "Page 0", "Frame 5"); group names at most 18 characters.
- A page table is one group: "topLabel": "virtual pages", "bottomLabel": "physical frames", each link a page → its frame, in the lesson's own numbers.
- Code places everything: give no positions, and no other shapes.`;
