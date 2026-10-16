import type { FigureComponent, FigureParams, FigurePart, FigureShape, Pt } from "../types";
import { BIO, arrowShapes, cleanName, r2, rng, roundedPoly, softShape } from "./bioDraw";

type Process = "diffusion" | "osmosis" | "active-transport" | "facilitated-diffusion";
type Side = "left" | "right";

const W = 560, H = 380, CX = W / 2, MY = H / 2;
const LEAF = 22; // half the bilayer's width, head centre to centre
const LANE = 36; // half-height of the band kept clear of particles for the net-movement arrow
const BOX = { left: { x0: 14, x1: CX - LEAF - 14 }, right: { x0: CX + LEAF + 14, x1: W - 14 } } as const;
const R_SOLUTE = 9, R_WATER = 5, R_SOLUTE_OSMOSIS = 11;

const optNum = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.trim().replace(/%$/, "")) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

export type TransportPlan = {
  process: Process;
  high: Side;
  low: Side;
  /** Solute (or diffusing) particles each side. */
  solute: Record<Side, number>;
  /** Water molecules each side (osmosis only; 0 otherwise). */
  water: Record<Side, number>;
  /** Net movement: from → to, or null when the concentrations are equal (no net movement). */
  net: { from: Side; to: Side; what: "particles" | "water" } | null;
  atp: boolean;
};

/**
 * The science, from the parameters: particle counts follow the concentrations; net diffusion runs down
 * the gradient (high → low); osmosis moves water from the dilute solution (more water) to the more
 * concentrated solution; active transport moves particles against the gradient (low → high) using ATP.
 */
export function transportPlan(params: FigureParams): TransportPlan {
  const p = String(params.process ?? params.type ?? "diffusion").toLowerCase();
  const process: Process = /osmo|water/.test(p) ? "osmosis" : /active|pump|atp/.test(p) ? "active-transport" : /facilit|channel|carrier/.test(p) ? "facilitated-diffusion" : "diffusion";
  const sideWord = String(params.higher ?? params.high ?? params.higherConcentration ?? "left").toLowerCase();
    let high: Side = /right|^2$|^b$/.test(sideWord) ? "right" : "left";
  let cL = optNum(params.left ?? params.concLeft ?? params.leftConcentration);
  let cR = optNum(params.right ?? params.concRight ?? params.rightConcentration);
  if (cL === undefined && cR === undefined) { cL = high === "left" ? 3 : 1; cR = high === "left" ? 1 : 3; }
  else if (cL === undefined) cL = high === "left" ? Math.max(cR! * 3, 1) : cR! / 3;
  else if (cR === undefined) cR = high === "right" ? Math.max(cL * 3, 1) : cL / 3;
  if (cL! !== cR!) high = cL! > cR! ? "left" : "right";
  const low: Side = high === "left" ? "right" : "left";
  const hi = Math.max(cL!, cR!), lo = Math.min(cL!, cR!);
  const max = process === "osmosis" ? 8 : 15;
  const nHigh = hi > 0 ? max : 0;
  const nLow = hi > 0 ? Math.round((max * lo) / hi) : 0;
  const solute = { [high]: nHigh, [low]: nLow } as Record<Side, number>;
  const water = { left: 0, right: 0 };
  if (process === "osmosis") for (const s of ["left", "right"] as Side[]) water[s] = Math.max(6, 30 - 2 * solute[s]);
  const equal = cL === cR;
  const net: TransportPlan["net"] = equal
    ? null
    : process === "osmosis" ? { from: low, to: high, what: "water" }
    : process === "active-transport" ? { from: low, to: high, what: "particles" }
    : { from: high, to: low, what: "particles" };
  return { process, high, low, solute, water, net, atp: process === "active-transport" };
}

/** Particle centres in one side's box, clear of each other, of the arrow's lane and of the protein. */
type Box = { x0: number; y0: number; x1: number; y1: number };
function scatter(side: Side, counts: Array<{ n: number; r: number }>, seed: number, avoid: Box[] = []): Pt[][] {
  const rand = rng(seed);
  const box = BOX[side];
  const placed: Array<{ p: Pt; r: number }> = [];
  return counts.map(({ n, r }) => {
    const out: Pt[] = [];
    for (let tries = 0; out.length < n && tries < 6000; tries++) {
      const p = { x: box.x0 + r + 6 + rand() * (box.x1 - box.x0 - 2 * r - 12), y: 18 + r + rand() * (H - 36 - 2 * r) };
      if (Math.abs(p.y - MY) < LANE + r) continue;
      if (avoid.some((b) => p.x > b.x0 - r && p.x < b.x1 + r && p.y > b.y0 - r && p.y < b.y1 + r)) continue;
      const gap = tries < 3000 ? 7 : 3;
      if (placed.some((o) => Math.hypot(o.p.x - p.x, o.p.y - p.y) < o.r + r + gap)) continue;
      placed.push({ p, r });
      out.push({ x: r2(p.x), y: r2(p.y) });
    }
    return out;
  });
}

/**
 * Transport across a cell membrane: a partially permeable phospholipid bilayer between two
 * solutions, particles drawn at the concentrations given, and the net movement arrow — down the
 * concentration gradient for diffusion and facilitated diffusion (through a channel protein), water
 * towards the more concentrated solution for osmosis (solute too big to cross), and against the
 * gradient through a carrier protein, using ATP, for active transport.
 */
export const membraneTransport: FigureComponent = {
  name: "membraneTransport",
  title: "Transport across a cell membrane: diffusion, osmosis, facilitated diffusion, active transport, with net movement",
  params: `process ("diffusion" — default; "osmosis"; "facilitated-diffusion": through a channel protein; "active-transport": through a carrier protein using ATP); higher (the side with the higher solute concentration: "left" — default — or "right"); sides (optional names of the two sides, left first, e.g. "outside cell, cytoplasm"); left and right (optional relative concentrations, e.g. 5 and 1 — particle counts are drawn in that proportion; equal values show no net movement); solute (the particle's name for its label, e.g. "glucose", "oxygen", "mineral ions"). The arrow's direction is computed: down the gradient, water towards the more concentrated solution, or against the gradient for active transport.`,
  match: /^(?![\s\S]*\b(diffusion of (responsibility|innovations?|ideas|culture)|cultural diffusion|relocation diffusion|expansion diffusion|stimulus diffusion|contagious diffusion)\b)[\s\S]*(\b(osmosis|osmotic|active transport|facilitated diffusion|carrier proteins?|channel proteins?|partially permeable|selectively permeable|semi-?permeable|phospholipid bilayer)\b|\bwater potential\b(?=[\s\S]*\b(membrane|osmosis|osmotic|cells? (gains?|loses?) water|turgid|plasmolys\w*)\b)|\bacross (the|a) (cell )?membrane\b|\bdiffusion\b(?=[\s\S]*\b(molecules?|particles?|concentration|membrane|cells?|gas(es)?|oxygen|solutes?)\b)|\bconcentration gradients?\b)/i,
  parts: [
    { id: "membrane", name: "Partially permeable membrane" },
    { id: "high", name: "High concentration" },
    { id: "low", name: "Low concentration" },
    { id: "net-movement", name: "Net movement" },
    { id: "protein", name: "Carrier protein" },
    { id: "atp", name: "ATP (energy)" },
    { id: "water", name: "Water molecule" },
    { id: "solute", name: "Solute particle" },
  ],
  build(params: FigureParams) {
    const plan = transportPlan(params);
    const soluteName = cleanName(params.solute ?? params.particle ?? params.substance, 16);
    const shapes: FigureShape[] = [];
    const parts: FigurePart[] = [];
    const osmosis = plan.process === "osmosis";
    const protein = plan.process === "facilitated-diffusion" ? "channel" : plan.process === "active-transport" ? "carrier" : null;
    const PROT = { top: MY - 58, bottom: MY + 58 };

    // The two solutions, faintly tinted by concentration (darker = more concentrated).
    for (const side of ["left", "right"] as Side[]) {
      const b = BOX[side], hiSide = side === plan.high;
      const d = roundedPoly([{ x: b.x0 - 8, y: 8 }, { x: b.x1 + 6, y: 8 }, { x: b.x1 + 6, y: H - 8 }, { x: b.x0 - 8, y: H - 8 }], 14);
      shapes.push({ t: "path", part: hiSide ? "high" : "low", d, fill: BIO.amber, stroke: "none", opacity: hiSide ? 0.12 : 0.04 });
    }

    // The bilayer: two rows of phosphate heads, fatty-acid tails pointing inwards; gaps where a protein spans it.
    const step = 15;
    for (let y = 16; y <= H - 14; y += step) {
      if (protein && y > PROT.top - 4 && y < PROT.bottom + 4) continue;
      for (const dir of [-1, 1]) {
        const hx = CX + dir * LEAF;
        for (const off of [-2.6, 2.6]) {
          const x0 = hx - dir * 6, x1 = CX - dir * 2.5;
          const mid = (x0 + x1) / 2;
          shapes.push({ t: "path", part: "membrane", d: `M${r2(x0)} ${r2(y + off)} Q${r2((x0 + mid) / 2)} ${r2(y + off - 2.4)} ${r2(mid)} ${r2(y + off)} T${r2(x1)} ${r2(y + off)}`, stroke: "muted", width: 1.3, fill: "none" });
        }
        shapes.push({ t: "circle", part: "membrane", cx: r2(hx), cy: r2(y), r: 6.4, fill: BIO.violet, stroke: "ink", width: 1.2, opacity: 0.85 });
      }
    }
    parts.push({ id: "membrane", name: osmosis ? "Partially permeable membrane" : "Cell membrane (bilayer)", anchor: { x: CX - LEAF, y: 16 + step * 2 } });

    // Particles, by side. Osmosis: many small water molecules and fewer, larger solute particles.
    const draw = { solute: [] as Pt[], water: [] as Pt[] };
    for (const side of ["left", "right"] as Side[]) {
      const groups = osmosis ? [{ n: plan.solute[side], r: R_SOLUTE_OSMOSIS }, { n: plan.water[side], r: R_WATER }] : [{ n: plan.solute[side], r: R_SOLUTE }];
      const avoid: Box[] = [];
      if (protein) avoid.push({ x0: CX - 56, y0: PROT.top - 6, x1: CX + 56, y1: PROT.bottom + 6 });
      if (plan.atp) { const s = plan.high === "left" ? -1 : 1; avoid.push({ x0: CX + s * 82 - 44, y0: MY + 104, x1: CX + s * 82 + 44, y1: MY + 136 }, s > 0 ? { x0: CX, y0: MY + 62, x1: W, y1: MY + 104 } : { x0: 0, y0: MY + 62, x1: CX, y1: MY + 104 }); }
      const [sol, wat = []] = scatter(side, groups, side === "left" ? 11 : 29, avoid);
      sol.forEach((p) => { draw.solute.push(p); shapes.push({ t: "circle", part: "solute", cx: p.x, cy: p.y, r: osmosis ? R_SOLUTE_OSMOSIS : R_SOLUTE, fill: BIO.amber, stroke: "ink", width: 1.3, opacity: 0.9 }); });
      wat.forEach((p) => { draw.water.push(p); shapes.push({ t: "circle", part: "water", cx: p.x, cy: p.y, r: R_WATER, fill: BIO.blue, stroke: "ink", width: 1, opacity: 0.85 }); });
    }

    // The protein that spans the bilayer.
    if (protein === "channel") {
      for (const dir of [-1, 1]) {
        const xa = CX + dir * 13, xb = CX + dir * 44;
        const pts = [{ x: xa, y: PROT.top + 6 }, { x: xb, y: PROT.top }, { x: xb + dir * 4, y: MY }, { x: xb, y: PROT.bottom }, { x: xa, y: PROT.bottom - 6 }];
        shapes.push(...softShape(roundedPoly(dir < 0 ? pts : [...pts].reverse(), [10, 18, 18, 18, 10]), BIO.green, "protein", { fillOpacity: 0.38 }));
      }
      parts.push({ id: "protein", name: "Channel protein", anchor: { x: CX + 30, y: PROT.top + 10 } });
    } else if (protein === "carrier") {
      // A carrier with its binding site open towards the side it picks particles up from (the low side).
      const s = plan.low === "left" ? -1 : 1;
      const pts = [
        { x: CX - 44, y: PROT.top }, { x: CX + 44, y: PROT.top }, { x: CX + 48, y: MY - 16 },
        { x: CX + 44, y: PROT.bottom }, { x: CX - 44, y: PROT.bottom }, { x: CX - 48, y: MY + 16 },
      ];
      // The binding site: a pocket on the low-concentration face.
      const face = s < 0 ? 5 : 2;
      const pocket = s < 0
        ? [{ x: CX - 46, y: MY + 14 }, { x: CX - 14, y: MY + 14 }, { x: CX - 14, y: MY - 14 }, { x: CX - 46, y: MY - 14 }]
        : [{ x: CX + 46, y: MY - 14 }, { x: CX + 14, y: MY - 14 }, { x: CX + 14, y: MY + 14 }, { x: CX + 46, y: MY + 14 }];
      const outline = [...pts.slice(0, face + 1), ...pocket, ...pts.slice(face + 1)];
      shapes.push(...softShape(roundedPoly(outline, outline.map((_, i) => (i > face && i <= face + 4 ? 5 : 18))), BIO.green, "protein", { fillOpacity: 0.38 }));
      parts.push({ id: "protein", name: "Carrier protein", anchor: { x: CX + 26, y: PROT.top + 10 } });
    }

    // Net movement.
    if (plan.net) {
      const dir = plan.net.to === "right" ? 1 : -1;
      const colour = plan.net.what === "water" ? BIO.blue : plan.process === "active-transport" ? BIO.red : BIO.green;
      const from = { x: CX - dir * 150, y: MY }, to = { x: CX + dir * 150, y: MY };
      if (protein === "carrier") {
        // The particle being carried sits in the binding site, the arrow runs through the protein.
        shapes.push({ t: "circle", part: "solute", cx: CX - dir * 30, cy: MY, r: R_SOLUTE, fill: BIO.amber, stroke: "ink", width: 1.3, opacity: 0.9 });
      }
      shapes.push(...arrowShapes(from, to, colour, 6, "net-movement", { head: 22 }));
      if (protein === "channel") shapes.push({ t: "circle", part: "solute", cx: CX, cy: MY - 20, r: R_SOLUTE - 1.5, fill: BIO.amber, stroke: "ink", width: 1.2, opacity: 0.9 });
      const what = plan.net.what === "water" ? "Net movement of water" : plan.process === "active-transport" ? "Movement against gradient" : "Net movement";
      parts.push({ id: "net-movement", name: what, anchor: { x: r2(to.x - dir * 34), y: MY } });
    } else {
      shapes.push(...arrowShapes({ x: CX - 40, y: MY }, { x: CX - 150, y: MY }, "muted", 3.5, "net-movement", { head: 14 }));
      shapes.push(...arrowShapes({ x: CX + 40, y: MY }, { x: CX + 150, y: MY }, "muted", 3.5, "net-movement", { head: 14 }));
      parts.push({ id: "net-movement", name: "No net movement (equal)", anchor: { x: CX + 120, y: MY } });
    }

    // ATP for active transport: on the inside face of the carrier, splitting to ADP + Pi.
    if (plan.atp) {
      const s = plan.high === "left" ? -1 : 1;
      const c = { x: CX + s * 82, y: MY + 84 };
      shapes.push(...softShape(roundedPoly([{ x: c.x - 28, y: c.y - 15 }, { x: c.x + 28, y: c.y - 15 }, { x: c.x + 28, y: c.y + 15 }, { x: c.x - 28, y: c.y + 15 }], 15), BIO.red, "atp", { fillOpacity: 0.3 }));
      shapes.push({ t: "text", part: "atp", x: c.x, y: c.y + 6.5, text: "ATP", size: 18, anchor: "middle" });
      shapes.push(...arrowShapes({ x: c.x - s * 30, y: c.y - 6 }, { x: CX + s * 40, y: PROT.bottom - 6 }, BIO.red, 2.2, "atp", { head: 10, bend: s * 10 }));
      shapes.push({ t: "text", part: "atp", x: c.x, y: c.y + 40, text: "ADP + Pi", size: 15, anchor: "middle", fill: "muted" });
      parts.push({ id: "atp", name: "ATP (energy from respiration)", anchor: { x: c.x + s * 22, y: c.y - 6 } });
    }

    // Regions: anchored at their outer edges, where a margin label reaches them directly.
    const sideNames = String(params.sides ?? "").split(/[,;|]/).map((x) => cleanName(x, 14));
    const nm = (base: string, side: Side) => {
      const extra = sideNames[side === "left" ? 0 : 1];
      return extra && `${base} (${extra})`.length <= 34 ? `${base} (${extra})` : base;
    };
    const regionName = osmosis ? ["Concentrated solution", "Dilute solution"] : ["High concentration", "Low concentration"];
    parts.push({ id: "high", name: nm(regionName[0], plan.high), anchor: { x: plan.high === "left" ? 8 : W - 8, y: MY - 70 } });
    parts.push({ id: "low", name: nm(regionName[1], plan.low), anchor: { x: plan.low === "left" ? 8 : W - 8, y: MY - 70 } });

    // One solute and one water molecule as their parts' anchors: the outermost, nearest the margin.
    const pick = (pts: Pt[]) => [...pts].sort((a, b) => Math.min(a.x, W - a.x) - Math.min(b.x, W - b.x))[0];
    const sol = pick(draw.solute.filter((p) => p.y > MY));
    if (sol) parts.push({ id: "solute", name: osmosis ? (soluteName ? `Solute (${soluteName})` : "Solute molecule") : soluteName ? `Particle (${soluteName})` : "Particle", anchor: sol });
    const wat = pick(draw.water.filter((p) => p.y > MY));
    if (wat) parts.push({ id: "water", name: "Water molecule", anchor: wat });
    return { w: W, h: H, shapes, parts };
  },
};
