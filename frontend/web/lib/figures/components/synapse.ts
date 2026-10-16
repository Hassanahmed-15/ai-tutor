import type { FigureComponent, FigurePart, FigureParams, FigureShape, Ink, Pt } from "../types";
import { arrowShapes, r2, rng, roundedPoly, smoothOpen, transform } from "./bioDraw";

/**
 * A CHOLINERGIC SYNAPSE, as the A Level textbooks draw it: the presynaptic knob (mitochondria,
 * vesicles of acetylcholine, voltage-gated Ca²⁺ channels in its membrane), the synaptic cleft, and
 * the postsynaptic membrane with its receptor proteins — ligand-gated Na⁺ channels — and
 * acetylcholinesterase. `step` shows the sequence cumulatively, each event numbered:
 *   0 an action potential arrives · 1 Ca²⁺ channels open, Ca²⁺ diffuses in · 2 vesicles fuse
 *   (exocytosis), acetylcholine crosses the cleft · 3 it binds, Na⁺ channels open, Na⁺ in,
 *   depolarisation · 4 acetylcholinesterase breaks it down; choline is taken back into the knob.
 */

const C = {
  knob: "#e0e7ff" as Ink,
  post: "#dcfce7" as Ink,
  mito: "#fed7aa" as Ink,
  mitoLine: "#c2410c" as Ink,
  vesicle: "#fef9c3" as Ink,
  ach: "#6d28d9" as Ink,
  ca: "#0284c7" as Ink,
  caFill: "#bae6fd" as Ink,
  na: "#be123c" as Ink,
  receptor: "#bbf7d0" as Ink,
  receptorLine: "#16a34a" as Ink,
  enzyme: "#fde68a" as Ink,
  enzymeLine: "#d97706" as Ink,
  step: "#d97706" as Ink,
};

const W = 560, H = 420;
/** Presynaptic membrane (bottom of the knob), postsynaptic membrane, and the figure's centre line. */
const PRE = 226, POST = 300, CX = 280;
const pt = (x: number, y: number): Pt => ({ x, y });
const P = (p: Pt) => `${r2(p.x)} ${r2(p.y)}`;

const STEP_WORDS: Array<[RegExp, number]> = [[/break|acetylcholinesterase|enzyme|recycl/i, 4], [/bind|receptor|sodium|na\+?|depolari/i, 3], [/exocyt|release|vesicle|fuse/i, 2], [/calcium|ca2?\+?|channel/i, 1], [/arriv|impulse|action potential|rest/i, 0]];
function stepOf(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.min(4, Math.round(v)));
  const s = String(v ?? "").trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return Math.max(0, Math.min(4, Math.round(Number(s))));
  for (const [re, n] of STEP_WORDS) if (re.test(s)) return n;
  return 4;
}

/** A membrane as a bilayer: two parallel lines. */
function bilayer(d: string, part: string): FigureShape[] {
  return [
    { t: "path", d, stroke: "ink", width: 7.5, fill: "none", part },
    { t: "path", d, stroke: "paper", width: 3.2, fill: "none", part },
  ];
}

/** A numbered step badge. */
function badge(c: Pt, n: number): FigureShape[] {
  return [
    { t: "circle", cx: c.x, cy: c.y, r: 12, fill: C.step, stroke: "none" },
    { t: "text", x: c.x, y: c.y + 5.5, text: String(n), size: 15, anchor: "middle", fill: "paper" },
  ];
}

export const synapse: FigureComponent = {
  name: "synapse",
  title: "A cholinergic synapse: presynaptic knob with mitochondria and vesicles of acetylcholine, Ca²⁺ channels, the synaptic cleft and receptor proteins (Na⁺ channels) on the postsynaptic membrane, with the steps of transmission",
  params: `step (0–4, default 4; shows the sequence up to that step, numbered 1–5): 0 action potential arrives at the knob · 1 Ca²⁺ channels open and Ca²⁺ diffuses in · 2 vesicles fuse with the membrane (exocytosis), acetylcholine diffuses across the cleft · 3 acetylcholine binds to receptors, Na⁺ channels open, Na⁺ enters and depolarises the postsynaptic membrane · 4 acetylcholinesterase breaks acetylcholine down and choline is taken back into the knob. A step name also works ("exocytosis", "binding").`,
  match: /\bsynap(se|ses|tic)\b(?![\s\S]{0,40}\b(plasticity|pruning)\b)|\bneurotransmitters?\b|\bacetylcholine(sterase)?\b|\bcholinergic\b|\bpresynaptic\b|\bpostsynaptic\b|\bsynaptic (cleft|knob|vesicles?|transmission)\b/i,
  parts: [
    { id: "presynaptic-knob", name: "Presynaptic knob" },
    { id: "vesicle", name: "Vesicle of acetylcholine" },
    { id: "mitochondrion", name: "Mitochondrion" },
    { id: "calcium-channel", name: "Voltage-gated Ca²⁺ channel" },
    { id: "synaptic-cleft", name: "Synaptic cleft" },
    { id: "receptor-protein", name: "Receptor protein" },
    { id: "postsynaptic-membrane", name: "Postsynaptic membrane" },
    { id: "acetylcholine", name: "Acetylcholine" },
    { id: "presynaptic-membrane", name: "Presynaptic membrane" },
    { id: "sodium-channel", name: "Na⁺ channel" },
    { id: "acetylcholinesterase", name: "Acetylcholinesterase" },
    { id: "impulse", name: "Action potential arrives" },
    { id: "calcium-ions", name: "Ca²⁺ ions diffuse in" },
    { id: "exocytosis", name: "Exocytosis" },
    { id: "sodium-ions", name: "Na⁺ ions diffuse in" },
    { id: "depolarisation", name: "Depolarisation (new impulse)" },
    { id: "choline-recycling", name: "Choline taken back up" },
    { id: "postsynaptic-neurone", name: "Postsynaptic neurone" },
  ],
  build(params: FigureParams) {
    const step = stepOf(params?.step ?? params?.stage);
    const s: FigureShape[] = [];
    const top: FigureShape[] = [];
    const parts: FigurePart[] = [];
    const rand = rng(7);

    // ── The postsynaptic neurone below, its membrane facing the knob across the cleft. ──
    const postD = `M${CX - 240} ${H} C${CX - 240} ${POST + 34} ${CX - 226} ${POST} ${CX - 186} ${POST} L${CX + 186} ${POST} C${CX + 226} ${POST} ${CX + 240} ${POST + 34} ${CX + 240} ${H}`;
    s.push({ t: "path", d: `${postD} Z`, fill: C.post, stroke: "none", part: "postsynaptic-neurone" });
    s.push(...bilayer(postD, "postsynaptic-membrane"));
    parts.push({ id: "postsynaptic-neurone", name: "Postsynaptic neurone", anchor: pt(CX - 190, 384) }, { id: "postsynaptic-membrane", name: "Postsynaptic membrane", anchor: pt(CX - 150, POST) });

    // ── The presynaptic knob: the axon widening into a bulb, its flat membrane facing the cleft. ──
    const left = [pt(CX - 40, 0), pt(CX - 44, 34), pt(CX - 92, 72), pt(CX - 144, 116), pt(CX - 160, 164), pt(CX - 144, 202), pt(CX - 106, PRE)];
    const right = left.map((p) => pt(2 * CX - p.x, p.y)).reverse();
    const knobD = `${smoothOpen(left)} L${P(right[0])} ${smoothOpen(right).replace(/^M[^C]+/, "")}`;
    s.push({ t: "path", d: knobD, fill: C.knob, stroke: "none", part: "presynaptic-knob" });
    s.push(...bilayer(smoothOpen(left), "presynaptic-knob"), ...bilayer(smoothOpen(right), "presynaptic-knob"));
    s.push(...bilayer(`M${P(left[left.length - 1])} L${P(right[0])}`, "presynaptic-membrane"));
    parts.push({ id: "presynaptic-knob", name: "Presynaptic knob", anchor: pt(CX - 136, 150) }, { id: "presynaptic-membrane", name: "Presynaptic membrane", anchor: pt(CX - 62, PRE) });
    // The cleft: the fluid-filled gap between the two membranes (drawn behind everything).
    s.unshift({ t: "path", d: roundedPoly([pt(CX - 180, PRE + 5), pt(CX + 180, PRE + 5), pt(CX + 180, POST - 5), pt(CX - 180, POST - 5)], 22), fill: "#bae6fd", stroke: "none", opacity: 0.3, part: "synaptic-cleft" });
    parts.push({ id: "synaptic-cleft", name: "Synaptic cleft", anchor: pt(CX + 140, 262) });

    // ── Mitochondria (cristae inside). ──
    for (const [c, rot] of [[pt(CX - 88, 128), -0.55], [pt(CX + 92, 124), 0.5]] as const) {
      const rx = 36, ry = 15;
      const outline = transform(Array.from({ length: 24 }, (_, i) => pt(c.x + rx * Math.cos((i / 24) * Math.PI * 2), c.y + ry * Math.sin((i / 24) * Math.PI * 2))), c, rot);
      s.push({ t: "path", d: `M${outline.map(P).join(" L")} Z`, fill: C.mito, stroke: "ink", width: 2, part: "mitochondrion" });
      const zig = transform(Array.from({ length: 9 }, (_, i) => pt(c.x - 26 + i * 6.5, c.y + (i % 2 ? 9 : -9))), c, rot);
      s.push({ t: "path", d: `M${zig.map(P).join(" L")}`, stroke: C.mitoLine, width: 1.8, fill: "none", part: "mitochondrion" });
    }
    parts.push({ id: "mitochondrion", name: "Mitochondrion", anchor: pt(CX - 104, 138) });

    // ── Vesicles of acetylcholine. Those at the membrane fuse with it from step 2. ──
    const ach = (c: Pt, r: number, n: number, part: string) => {
      for (let i = 0; i < n; i++) {
        const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * r;
        top.push({ t: "circle", cx: r2(c.x + d * Math.cos(a)), cy: r2(c.y + d * Math.sin(a)), r: 2.8, fill: C.ach, stroke: "none", part });
      }
    };
    const vesicle = (c: Pt) => {
      s.push({ t: "circle", cx: c.x, cy: c.y, r: 15, fill: C.vesicle, stroke: C.ach, width: 2, part: "vesicle" });
      // Its acetylcholine: one molecule at the centre, the rest scattered round it.
      top.push({ t: "circle", cx: c.x, cy: c.y, r: 2.8, fill: C.ach, stroke: "none", part: "acetylcholine" });
      ach(c, 9, 4, "acetylcholine");
    };
    for (const [dx, y] of [[-34, 92], [16, 76], [-6, 128], [42, 118], [-56, 178], [58, 172]] as const) vesicle(pt(CX + dx, y));
    const fusing = [pt(CX - 30, PRE), pt(CX + 30, PRE)];
    if (step >= 2) {
      // Exocytosis: each vesicle open to the cleft, an Ω in the membrane, its acetylcholine spilling out.
      for (const f of fusing) {
        s.push({ t: "path", d: `M${f.x - 18} ${PRE} C${f.x - 10} ${PRE} ${f.x - 18} ${PRE - 30} ${f.x} ${PRE - 30} C${f.x + 18} ${PRE - 30} ${f.x + 10} ${PRE} ${f.x + 18} ${PRE}`, fill: C.vesicle, stroke: C.ach, width: 2.2, part: "exocytosis" });
        ach(pt(f.x, PRE - 14), 7, 3, "exocytosis");
      }
      parts.push({ id: "exocytosis", name: "Exocytosis", anchor: pt(fusing[1].x, PRE - 22) });
    } else {
      for (const f of fusing) vesicle(pt(f.x, PRE - 24));
    }
    parts.push({ id: "vesicle", name: "Vesicle of acetylcholine", anchor: pt(CX + 70, 172) });

    // ── Voltage-gated Ca²⁺ channels near the ends of the presynaptic membrane: closed, or open from step 1. ──
    const caX = [CX - 86, CX + 86];
    for (const x of caX) {
      const gap = step >= 1 ? 5 : 0;
      for (const side of [-1, 1]) {
        const x0 = side < 0 ? x - gap - 11 : x + gap;
        s.push({ t: "path", d: `M${x0} ${PRE - 15} h11 v30 h-11 Z`, fill: C.caFill, stroke: C.ca, width: 2, part: "calcium-channel" });
      }
    }
    parts.push({ id: "calcium-channel", name: "Voltage-gated Ca²⁺ channel", anchor: pt(caX[1] + 9, PRE + 6) });

    // ── Receptor proteins on the postsynaptic membrane: each a Na⁺ channel with a binding site. ──
    const recX = [CX - 58, CX, CX + 58];
    const open = step >= 3;
    for (const x of recX) {
      const gap = open ? 5 : 0;
      for (const side of [-1, 1]) {
        const x0 = side < 0 ? x - gap - 13 : x + gap;
        s.push({ t: "path", d: `M${x0} ${POST - 14} h13 v32 h-13 Z`, fill: C.receptor, stroke: C.receptorLine, width: 2, part: "sodium-channel" });
      }
      // The binding sites: a cup on top of each half.
      for (const side of [-1, 1]) {
        const cx = x + side * (gap + 6.5);
        s.push({ t: "path", d: `M${cx - 7} ${POST - 14} v-8 a7 7 0 0 0 14 0 v8`, fill: C.receptor, stroke: C.receptorLine, width: 2, part: "receptor-protein" });
        if (open) top.push({ t: "circle", cx, cy: POST - 21, r: 3.6, fill: C.ach, stroke: "none", part: "acetylcholine" });
      }
    }
    parts.push({ id: "receptor-protein", name: "Receptor protein", anchor: pt(recX[0] - 6.5 - (open ? 5 : 0), POST - 20) }, { id: "sodium-channel", name: "Na⁺ channel", anchor: pt(recX[2] + 7 + (open ? 5 : 0), POST + 10) });

    // ── Acetylcholine: in the vesicles, then across the cleft. ──
    if (step >= 2) {
      for (const [dx, y] of [[-40, 250], [-12, 258], [14, 246], [40, 256], [-26, 270], [28, 272], [0, 262]] as const) top.push({ t: "circle", cx: CX + dx, cy: y, r: 3.4, fill: C.ach, stroke: "none", part: "acetylcholine" });
      parts.push({ id: "acetylcholine", name: "Acetylcholine", anchor: pt(CX + 14, 246) });
    } else {
      parts.push({ id: "acetylcholine", name: "Acetylcholine", anchor: pt(CX + 16, 76) });
    }

    // ── Acetylcholinesterase in the cleft, on the postsynaptic membrane. ──
    const E = pt(CX + 178, POST - 17);
    s.push({ t: "path", d: `M${E.x + 12} ${E.y - 8} A15 15 0 1 0 ${E.x + 12} ${E.y + 8} L${E.x + 2} ${E.y} Z`, fill: C.enzyme, stroke: C.enzymeLine, width: 2, part: "acetylcholinesterase" });
    parts.push({ id: "acetylcholinesterase", name: "Acetylcholinesterase", anchor: pt(E.x - 6, E.y + 4) });

    // ── The events, numbered. ──
    top.push(...arrowShapes(pt(CX, 4), pt(CX, 58), C.na, 3.4, "impulse", { head: 14 }));
    top.push(...badge(pt(CX + 24, 24), 1));
    parts.push({ id: "impulse", name: "Action potential arrives", anchor: pt(CX, 30) });
    if (step >= 1) {
      // Ca²⁺ from the tissue fluid of the cleft, in through each open channel.
      for (const [x, side] of [[caX[0], -1], [caX[1], 1]] as const) {
        top.push(...arrowShapes(pt(x + side * 22, PRE + 40), pt(x, PRE - 24), C.ca, 2.8, "calcium-ions", { head: 12, bend: side * 14 }));
        top.push({ t: "text", x: x + side * 26, y: PRE + 66, text: "Ca²⁺", size: 18, anchor: "middle", fill: C.ca, part: "calcium-ions" });
      }
      top.push(...badge(pt(caX[0] - 30, PRE - 30), 2));
      parts.push({ id: "calcium-ions", name: "Ca²⁺ ions diffuse in", anchor: pt(caX[0] - 22, PRE + 40) });
    }
    if (step >= 2) {
      top.push(...arrowShapes(pt(CX - 56, 194), pt(CX - 38, PRE - 30), C.ach, 2.4, undefined, { head: 10 }));
      top.push(...badge(pt(CX, PRE - 40), 3));
    }
    if (step >= 3) {
      for (const x of recX) top.push(...arrowShapes(pt(x, POST - 8), pt(x, POST + 44), C.na, 2.8, "sodium-ions", { head: 12 }));
      for (const x of [recX[0] - 26, recX[2] + 26]) top.push({ t: "text", x, y: POST + 46, text: "Na⁺", size: 18, anchor: "middle", fill: C.na, part: "sodium-ions" });
      top.push(...arrowShapes(pt(CX - 70, 384), pt(CX + 110, 384), C.na, 3.4, "depolarisation", { head: 14 }));
      top.push(...badge(pt(CX + 29, POST + 40), 4));
      parts.push({ id: "sodium-ions", name: "Na⁺ ions diffuse in", anchor: pt(recX[0], POST + 32) }, { id: "depolarisation", name: "Depolarisation (new impulse)", anchor: pt(CX + 80, 384) });
    }
    if (step >= 4) {
      // Broken down: the fragments, and choline diffusing back into the knob to be recycled.
      top.push({ t: "circle", cx: E.x + 22, cy: E.y - 4, r: 3.2, fill: C.ach, stroke: "none", part: "acetylcholinesterase" });
      top.push({ t: "path", d: `M${E.x + 24} ${E.y + 6} l7 4`, stroke: C.ach, width: 3, fill: "none", part: "acetylcholinesterase" });
      top.push(...arrowShapes(pt(E.x + 12, E.y - 24), pt(CX + 122, PRE - 12), C.ach, 2.6, "choline-recycling", { head: 12, bend: 16, dash: "6 5" }));
      top.push(...badge(pt(E.x + 36, E.y - 30), 5));
      parts.push({ id: "choline-recycling", name: "Choline taken back up", anchor: pt(E.x - 4, PRE + 6) });
    }

    const order = synapse.parts.map((p) => p.id);
    parts.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    return { w: W, h: H, shapes: [...s, ...top], parts };
  },
};
