import type { FigureComponent, FigureParams, FigurePart, FigureShape, Pt } from "../types";

type State = "solid" | "liquid" | "gas";
const STATES: State[] = ["solid", "liquid", "gas"];
const STATE_NAME: Record<State, string> = { solid: "Solid", liquid: "Liquid", gas: "Gas" };

/** The change of state from one state to another: the science is in this table, never in the model's words. */
const CHANGE: Record<string, string> = {
  "solid>liquid": "Melting", "liquid>solid": "Freezing",
  "liquid>gas": "Boiling (evaporating)", "gas>liquid": "Condensing",
  "solid>gas": "Sublimation", "gas>solid": "Deposition",
};
/** Words a board may use for each change, so "arrows":"melting,condensing" picks exactly those arrows. */
const CHANGE_WORDS: Record<string, RegExp> = {
  "solid>liquid": /melt/, "liquid>solid": /freez|solidif/,
  "liquid>gas": /boil|evapor|vapori/, "gas>liquid": /condens/,
  "solid>gas": /sublim/, "gas>solid": /depos|desublim/,
};

/** A small deterministic generator (mulberry32), so the same board always draws the same particles. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function parseStates(v: unknown): State[] {
  const words = String(v ?? "").toLowerCase().match(/solid|liquid|gas/g) as State[] | null;
  const list = (words ?? []).slice(0, 3);
  return list.length ? list : [...STATES];
}

/** Which arrows to draw between each neighbouring pair: forward (left → right) and/or back. */
export function changesFor(states: State[], arrows: unknown): Array<{ i: number; forward?: string; back?: string }> {
  const a = String(arrows ?? "both").toLowerCase().trim();
  const named = Object.values(CHANGE_WORDS).some((re) => re.test(a));
  const mode = named ? "named" : a === "none" || a === "false" ? "none" : a === "forward" ? "forward" : a === "back" || a === "backward" || a === "reverse" ? "back" : "both";
  const out: Array<{ i: number; forward?: string; back?: string }> = [];
  for (let i = 0; i < states.length - 1; i++) {
    const fKey = `${states[i]}>${states[i + 1]}`, bKey = `${states[i + 1]}>${states[i]}`;
    if (!CHANGE[fKey]) continue;
    const forward = mode === "both" || mode === "forward" || (mode === "named" && CHANGE_WORDS[fKey].test(a)) ? CHANGE[fKey] : undefined;
    const back = mode === "both" || mode === "back" || (mode === "named" && CHANGE_WORDS[bKey].test(a)) ? CHANGE[bKey] : undefined;
    if (forward || back) out.push({ i, forward, back });
  }
  return out;
}

const B = 176, GAP = 74, R = 12.5, TOP = 74;

/** Particle centres inside a box (0..B), by state: a lattice, a close jumble, or far apart. */
export function particleCentres(state: State, seed: number): Pt[] {
  const rand = rng(seed);
  const d = 2 * R;
  if (state === "solid") {
    const cols = 6, rows = 5;
    const x0 = (B - cols * d) / 2 + R;
    return Array.from({ length: rows * cols }, (_, k) => ({ x: x0 + (k % cols) * d, y: B - 8 - R - Math.floor(k / cols) * d }));
  }
  if (state === "liquid") {
    // Random close packing by deposition: each particle drops at the best of several random columns and
    // stops on the floor or on the particles below — touching, disordered, filling the lower part.
    const pts: Pt[] = [];
    const floor = B - 8 - R;
    const restY = (x: number) => pts.reduce((y, o) => (Math.abs(o.x - x) < d ? Math.min(y, o.y - Math.sqrt(d * d - (o.x - x) ** 2)) : y), floor);
    for (let n = 0; n < 27; n++) {
      let best: Pt | null = null;
      for (let k = 0; k < 14; k++) {
        const x = R + 6 + rand() * (B - 2 * R - 12);
        const y = restY(x);
        if (!best || y > best.y) best = { x, y };
      }
      pts.push(best!);
    }
    return pts;
  }
  // Gas: few particles, far apart, anywhere in the box.
  const pts: Pt[] = [];
  for (let tries = 0; pts.length < 7 && tries < 4000; tries++) {
    const q = { x: R + 10 + rand() * (B - 2 * R - 20), y: R + 24 + rand() * (B - 2 * R - 34) };
    if (pts.every((o) => Math.hypot(o.x - q.x, o.y - q.y) >= 3.8 * R)) pts.push(q);
  }
  return pts;
}

function arrowHead(tip: Pt, from: Pt, size = 11): string {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  const l = { x: tip.x - size * Math.cos(a - 0.45), y: tip.y - size * Math.sin(a - 0.45) };
  const r = { x: tip.x - size * Math.cos(a + 0.45), y: tip.y - size * Math.sin(a + 0.45) };
  return `M${tip.x} ${tip.y} L${l.x} ${l.y} L${r.x} ${r.y} Z`;
}

/**
 * The particle model of solids, liquids and gases: one closed box per state, the same particles
 * (same size) in each — a regular touching lattice in a solid, touching but disordered in a liquid,
 * far apart in a gas — with curved arrows for the changes of state between neighbouring boxes
 * (heating changes over the top in red, cooling changes underneath in blue).
 */
export const particles: FigureComponent = {
  name: "particles",
  title: "Particle model of the states of matter: solid lattice, liquid, gas, with change-of-state arrows",
  params: `states (1-3 of solid, liquid, gas in left-to-right order, comma-separated, e.g. "solid,liquid,gas" — default; "liquid,gas"), arrows ("both" — default: heating changes over the top, cooling changes underneath; "forward"; "back"; "none"; or the changes by name, e.g. "melting,boiling", "condensing"). Change names (melting, freezing, boiling, condensing, sublimation, deposition) are computed from the neighbouring states.`,
  match: /\b(particle (model|theory|diagram|arrangement)s?|arrangement of particles|states of matter|kinetic (particle|molecular) (model|theory)|changes? of state|state changes?)\b/i,
  parts: [
    { id: "solid", name: "Solid" },
    { id: "liquid", name: "Liquid" },
    { id: "gas", name: "Gas" },
    { id: "particle", name: "Particle" },
    { id: "change-1", name: "Melting" },
    { id: "change-2", name: "Boiling (evaporating)" },
    { id: "reverse-1", name: "Freezing" },
    { id: "reverse-2", name: "Condensing" },
  ],
  build(params: FigureParams) {
    const states = parseStates(params.states ?? params.state);
    const changes = changesFor(states, params.arrows ?? params.changes);
    const hasTop = changes.some((c) => c.forward), hasBottom = changes.some((c) => c.back);
    const top = hasTop ? TOP : 20;
    const w = states.length * B + (states.length - 1) * GAP + 40;
    const h = top + B + (hasBottom ? TOP : 20);
    const shapes: FigureShape[] = [];
    const parts: FigurePart[] = [];
    const boxX = (i: number) => 20 + i * (B + GAP);
    const seen = new Set<State>();
    let particleAnchor: Pt | null = null;
    states.forEach((state, i) => {
      const x = boxX(i);
      const id = seen.has(state) ? null : state;
      seen.add(state);
      for (const [k, p] of particleCentres(state, 7 + i * 31).entries()) {
        const c = { x: x + p.x, y: top + p.y };
        const isAnchor = !particleAnchor && (state === "solid" || i === states.length - 1 || !states.includes("solid")) && k === (state === "solid" ? 24 : 0);
        shapes.push({ t: "circle", part: isAnchor ? "particle" : id ?? undefined, cx: c.x, cy: c.y, r: R, fill: "#2563eb", stroke: "ink", width: 1.4, opacity: 0.92 });
        if (isAnchor) particleAnchor = c;
        if (state === "gas") {
          // Each gas particle's direction of motion: a short arrow from its edge.
          // Pointing roughly away from the walls, so every arrow stays inside the box.
          const toCentre = Math.atan2(top + B / 2 - c.y, x + B / 2 - c.x);
          const tip = (t: number) => ({ x: c.x + (R + 19) * Math.cos(t), y: c.y + (R + 19) * Math.sin(t) });
          const inBox = (q: Pt) => q.x > x + 6 && q.x < x + B - 6 && q.y > top + 6 && q.y < top + B - 6;
          let ang = toCentre + Math.sin(k * 2.39996 + i) * 1.4;
          for (let turn = 0; turn < 8 && !inBox(tip(ang)); turn++) ang = toCentre + Math.sin(k * 2.39996 + i) * 1.4 * (1 - (turn + 1) / 8);
          const s = { x: c.x + (R + 3) * Math.cos(ang), y: c.y + (R + 3) * Math.sin(ang) };
          const e = { x: c.x + (R + 19) * Math.cos(ang), y: c.y + (R + 19) * Math.sin(ang) };
          shapes.push({ t: "path", part: id ?? undefined, d: `M${s.x} ${s.y} L${e.x} ${e.y}`, stroke: "muted", width: 1.6, fill: "none" });
          shapes.push({ t: "path", part: id ?? undefined, d: arrowHead(e, s, 6), stroke: "muted", width: 1, fill: "muted" });
        }
      }
      shapes.push({ t: "path", part: id ?? undefined, d: `M${x} ${top} h${B} v${B} h${-B} Z`, stroke: "ink", width: 2.4, fill: "none" });
      if (id) parts.push({ id, name: STATE_NAME[state], anchor: i === 0 ? { x, y: top + B * 0.3 } : i === states.length - 1 ? { x: x + B, y: top + B * 0.3 } : { x: x + B * 0.5, y: top + 12 } });
    });
    if (particleAnchor) parts.push({ id: "particle", name: "Particle", anchor: particleAnchor });

    // Change arrows: forward (left → right) arcs over the top, back arcs underneath.
    const heat = "#dc2626", cool = "#2563eb";
    let f = 0, b = 0;
    for (const c of changes) {
      const x1 = boxX(c.i) + B * 0.62, x2 = boxX(c.i + 1) + B * 0.38, mid = (x1 + x2) / 2;
      if (c.forward) {
        const s = { x: x1, y: top - 8 }, e = { x: x2, y: top - 8 }, ctl = { x: mid, y: top - 8 - 2 * (TOP - 22) };
        shapes.push({ t: "path", part: `change-${++f}`, d: `M${s.x} ${s.y} Q${ctl.x} ${ctl.y} ${e.x} ${e.y}`, stroke: heat, width: 2.6, fill: "none" });
        shapes.push({ t: "path", part: `change-${f}`, d: arrowHead(e, ctl), stroke: heat, width: 1.5, fill: heat });
        parts.push({ id: `change-${f}`, name: c.forward, anchor: { x: mid, y: top - 8 - (TOP - 22) } });
      }
      if (c.back) {
        const s = { x: x2, y: top + B + 8 }, e = { x: x1, y: top + B + 8 }, ctl = { x: mid, y: top + B + 8 + 2 * (TOP - 22) };
        shapes.push({ t: "path", part: `reverse-${++b}`, d: `M${s.x} ${s.y} Q${ctl.x} ${ctl.y} ${e.x} ${e.y}`, stroke: cool, width: 2.6, fill: "none" });
        shapes.push({ t: "path", part: `reverse-${b}`, d: arrowHead(e, ctl), stroke: cool, width: 1.5, fill: cool });
        parts.push({ id: `reverse-${b}`, name: c.back, anchor: { x: mid, y: top + B + 8 + (TOP - 22) } });
      }
    }
    return { w, h, shapes, parts };
  },
};
