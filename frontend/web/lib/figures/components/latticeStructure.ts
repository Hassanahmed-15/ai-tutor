import type { FigureComponent, FigureParams, Ink, Pt } from "../types";
import { Sketch, PALETTE, dist, lerp } from "./mathsKit";
import { bondingInfo } from "./bonding";

/**
 * GIANT AND SIMPLE STRUCTURES, from their geometry: the sodium chloride lattice is the real rock-salt
 * arrangement (alternating ions on a cube grid, viewed in perspective or as a 2D layer); diamond is
 * the real diamond-cubic cell (every interior atom bonded tetrahedrally to four); graphite is real
 * hexagonal layers; a metal is a regular lattice of cations in delocalised electrons; a simple
 * molecular solid is a regular array of molecules with weak forces between them.
 */

type Kind = "giant-ionic" | "metallic" | "diamond" | "graphite" | "simple-molecular";

export function latticeKind(v: unknown): Kind {
  const s = String(v ?? "").toLowerCase();
  if (/metal/.test(s)) return "metallic";
  if (/diamond|silicon|giant covalent|macromolecul/.test(s)) return "diamond";
  if (/graph/.test(s)) return "graphite";
  if (/\b(simple|molecular|molecules?|iodine|ice|water|bromine|chlorine)\b/.test(s)) return "simple-molecular";
  return "giant-ionic";
}

const METAL_CHARGE: Record<string, [string, number]> = {
  li: ["Li", 1], lithium: ["Li", 1], na: ["Na", 1], sodium: ["Na", 1], k: ["K", 1], potassium: ["K", 1],
  mg: ["Mg", 2], magnesium: ["Mg", 2], ca: ["Ca", 2], calcium: ["Ca", 2], cu: ["Cu", 2], copper: ["Cu", 2],
  zn: ["Zn", 2], zinc: ["Zn", 2], fe: ["Fe", 2], iron: ["Fe", 2], al: ["Al", 3], aluminium: ["Al", 3], aluminum: ["Al", 3],
};
const SUPS: Record<string, string> = { "1": "¹", "2": "²", "3": "³", "+": "⁺", "−": "⁻" };
const chargeText = (c: number) => `${Math.abs(c) === 1 ? "" : Math.abs(c)}${c > 0 ? "+" : "−"}`;
const sup = (t: string) => [...t].map((ch) => SUPS[ch] ?? ch).join("");

/** A small deterministic generator, so a board always draws the same electrons. */
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

type P3 = { x: number; y: number; z: number };
/** Orthographic view: turn about the vertical axis by `yaw`, tip towards the viewer by `pitch`. Depth: larger = nearer. */
function project(p: P3, yaw: number, pitch: number, s: number): { p: Pt; depth: number } {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const x1 = p.x * cy + p.z * sy, z1 = -p.x * sy + p.z * cy;
  const y1 = p.y * cp - z1 * sp, z2 = p.y * sp + z1 * cp;
  return { p: { x: x1 * s, y: -y1 * s }, depth: -z2 };
}

function giantIonic(sk: Sketch, params: FigureParams) {
  const info = bondingInfo({ formula: params.compound ?? params.formula ?? "NaCl" });
  const ok = info.kind === "ionic" && info.cation.count === 1 && info.anion.count === 1;
  const cat = ok ? info.cation : { symbol: "Na", name: "Sodium", charge: 1 };
  const an = ok ? info.anion : { symbol: "Cl", name: "Chloride", charge: -1 };
  const flat = /2d|flat|layer|plane/i.test(String(params.view ?? ""));
  const catInk: Ink = PALETTE.violet, anInk: Ink = PALETTE.green;
  const anchors: Record<string, Pt> = {};
  if (flat) {
    // One layer: touching ions, alternating.
    const rA = 26, rC = 17, step = rA + rC + 2;
    const cols = 6, rows = 4;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const isCat = (i + j) % 2 === 0;
      const c = { x: i * step, y: j * step };
      sk.circle(c, isCat ? rC : rA, { fill: isCat ? catInk : anInk, stroke: "ink", width: 1.6, part: isCat ? "positive-ion" : "negative-ion" }, false);
      sk.text(c, chargeText(isCat ? cat.charge : an.charge), isCat ? 15 : 19, "paper", isCat ? "positive-ion" : "negative-ion");
      if (isCat && j === 0 && i === 0) anchors["positive-ion"] = { x: c.x - rC * 0.7, y: c.y - rC * 0.7 };
      if (!isCat && j === 0 && i === cols - 1) anchors["negative-ion"] = { x: c.x + rA * 0.7, y: c.y - rA * 0.7 };
    }
    // The attraction between neighbouring opposite ions: a double-headed arrow at one contact.
    const a = { x: 2 * step, y: 3 * step }, b = { x: 3 * step, y: 3 * step };
    sk.line([{ x: a.x, y: a.y + 40 }, { x: b.x, y: b.y + 40 }], { stroke: PALETTE.amber, width: 2.4, part: "electrostatic-attraction" }, false);
    for (const [tip, dir] of [[{ x: a.x, y: a.y + 40 }, 1], [{ x: b.x, y: b.y + 40 }, -1]] as const) sk.polygon([tip, { x: tip.x + dir * 10, y: tip.y - 5 }, { x: tip.x + dir * 10, y: tip.y + 5 }], { fill: PALETTE.amber, stroke: PALETTE.amber, width: 1, part: "electrostatic-attraction" }, false);
    sk.line([a, { x: a.x, y: a.y + 34 }], { stroke: PALETTE.amber, width: 1.2, dash: "3 3", part: "electrostatic-attraction" }, false);
    sk.line([b, { x: b.x, y: b.y + 34 }], { stroke: PALETTE.amber, width: 1.2, dash: "3 3", part: "electrostatic-attraction" }, false);
    anchors["electrostatic-attraction"] = { x: (a.x + b.x) / 2, y: a.y + 40 };
  } else {
    // The rock-salt cube, 3 × 3 × 3, ball-and-stick, drawn far to near.
    const s = 92;
    type Item = { depth: number; draw: () => void };
    const items: Item[] = [];
    const pts = new Map<string, { p: Pt; depth: number; cat: boolean }>();
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) {
      // Cabinet (oblique) view: depth runs up and to the right, so no two ions coincide.
      const q = { p: { x: (i - 1 + 0.42 * (k - 1)) * s, y: -(j - 1 + 0.26 * (k - 1)) * s }, depth: -(k - 1) + 0.01 * (i - j) };
      pts.set(`${i},${j},${k}`, { ...q, cat: (i + j + k) % 2 === 1 });
    }
    // The nearest bond on the front face, low down: the labelled attraction.
    let frontBond: { a: Pt; b: Pt; depth: number } | null = null;
    for (const [key, v] of pts) {
      const [i, j, k] = key.split(",").map(Number);
      for (const [di, dj, dk] of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
        const w = pts.get(`${i + di},${j + dj},${k + dk}`);
        if (!w) continue;
        const depth = (v.depth + w.depth) / 2;
        const isFront = j === 0 && dj === 0;
        if (isFront && (!frontBond || depth > frontBond.depth)) frontBond = { a: v.p, b: w.p, depth };
        items.push({ depth, draw: () => sk.line([v.p, w.p], { stroke: "muted", width: 2.4 }, false) });
      }
    }
    const rC = 13, rA = 21;
    const depths = [...pts.values()].map((v) => v.depth);
    const dMin = Math.min(...depths), dMax = Math.max(...depths);
    let catPick: { p: Pt; score: number } | null = null, anPick: { p: Pt; score: number } | null = null;
    for (const v of pts.values()) {
      const near = (v.depth - dMin) / (dMax - dMin || 1);
      const r = (v.cat ? rC : rA) * (0.86 + 0.18 * near);
      items.push({
        depth: v.depth + 0.001,
        draw: () => {
          sk.circle(v.p, r, { fill: v.cat ? catInk : anInk, stroke: "ink", width: 1.4, part: v.cat ? "positive-ion" : "negative-ion" }, false);
          sk.text(v.p, chargeText(v.cat ? cat.charge : an.charge), v.cat ? 13 : 17, "paper", v.cat ? "positive-ion" : "negative-ion");
        },
      });
      // Anchors on near ions at the left and right edges of the picture.
      const score = near * 40 + (v.cat ? -v.p.x : v.p.x);
      if (v.cat && (!catPick || score > catPick.score)) catPick = { p: { x: v.p.x - r * 0.75, y: v.p.y - r * 0.5 }, score };
      if (!v.cat && (!anPick || score > anPick.score)) anPick = { p: { x: v.p.x + r * 0.75, y: v.p.y - r * 0.5 }, score };
    }
    items.sort((a, b) => a.depth - b.depth).forEach((it) => it.draw());
    if (frontBond) {
      // Redraw the labelled bond's stretch between the two balls in amber.
      const fb = frontBond as { a: Pt; b: Pt };
      const p = lerp(fb.a, fb.b, 0.32), q = lerp(fb.a, fb.b, 0.68);
      sk.line([p, q], { stroke: PALETTE.amber, width: 3.2, part: "electrostatic-attraction" }, false);
      anchors["electrostatic-attraction"] = lerp(fb.a, fb.b, 0.5);
    }
    anchors["positive-ion"] = catPick!.p;
    anchors["negative-ion"] = anPick!.p;
  }
  sk.part("positive-ion", `${cat.name} ion, ${cat.symbol}${sup(chargeText(cat.charge))}`, anchors["positive-ion"]);
  sk.part("negative-ion", `${an.name} ion, ${an.symbol}${sup(chargeText(an.charge))}`, anchors["negative-ion"]);
  sk.part("electrostatic-attraction", "Electrostatic attraction", anchors["electrostatic-attraction"]);
}

function metallic(sk: Sketch, params: FigureParams) {
  const key = String(params.metal ?? params.element ?? "").toLowerCase().trim();
  const [sym, charge] = METAL_CHARGE[key] ?? ["", Math.max(1, Math.min(3, Math.round(Number(params.charge) || 1)))];
  const r = 25, gap = 7, step = 2 * r + gap, cols = 6, rows = 4;
  const ions: Pt[] = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) ions.push({ x: i * step, y: j * step });
  // Delocalised electrons: one per unit of charge on each ion (capped), scattered in the gaps.
  const n = Math.min(ions.length * charge, 44);
  const rand = rng(11 + charge);
  const electrons: Pt[] = [];
  for (let tries = 0; electrons.length < n && tries < 20000; tries++) {
    const q = { x: -r + rand() * (cols * step - gap + 2 * 0), y: -r + rand() * ((rows - 1) * step + 2 * r) };
    if (q.x > (cols - 1) * step + r) continue;
    if (ions.every((c) => dist(c, q) > r + 6) && electrons.every((e) => dist(e, q) > 13)) electrons.push(q);
  }
  ions.forEach((c, k) => {
    const part = k === cols * (rows - 1) ? "metal-ion" : k < cols ? "layer" : undefined;
    sk.circle(c, r, { fill: PALETTE.blue, stroke: "ink", width: 1.6, opacity: 0.9, part }, false);
    sk.text(c, chargeText(charge), 18, "paper", part);
  });
  // A dashed outline round the top row: a layer of ions (layers slide — metals are malleable).
  sk.path([{ k: "M", p: { x: -r - 6, y: -r - 6 } }, { k: "L", p: { x: (cols - 1) * step + r + 6, y: -r - 6 } }, { k: "L", p: { x: (cols - 1) * step + r + 6, y: r + 6 } }, { k: "L", p: { x: -r - 6, y: r + 6 } }], true, { stroke: PALETTE.violet, width: 1.6, dash: "6 5", fill: "none", part: "layer" });
  let pick = electrons[0];
  const target = { x: ((cols - 1) * step) / 2 + step / 2, y: ((rows - 1) * step) / 2 + step / 2 };
  for (const e of electrons) if (dist(e, target) < dist(pick, target)) pick = e;
  const pickR = electrons.reduce((b, e) => (e.x > b.x ? e : b), electrons[0]);
  electrons.forEach((e) => sk.circle(e, 4.6, { fill: PALETTE.red, stroke: PALETTE.red, width: 1, part: e === pickR ? "delocalised-electrons" : e === pick ? "electrostatic-attraction" : undefined }, false));
  const ion = ions[cols * (rows - 1)];
  sk.part("metal-ion", sym ? `Positive metal ion, ${sym}${sup(chargeText(charge))}` : "Positive metal ion", { x: ion.x - r * 0.7, y: ion.y + r * 0.5 });
  sk.part("delocalised-electrons", "Sea of delocalised electrons", pickR);
  sk.part("electrostatic-attraction", "Electrostatic attraction", pick);
  sk.part("layer", "Layer of ions (layers can slide)", { x: (cols - 1) * step + r + 6, y: 0 });
}

function diamond(sk: Sketch) {
  // The diamond-cubic cell: fcc points plus the four interior tetrahedral sites.
  const fcc: P3[] = [];
  for (let x = 0; x <= 1; x += 0.5) for (let y = 0; y <= 1; y += 0.5) for (let z = 0; z <= 1; z += 0.5) {
    const twos = [x, y, z].filter((v) => v === 0.5).length;
    if (twos === 0 || twos === 2) fcc.push({ x, y, z });
  }
  const atoms3 = [...fcc, { x: 0.25, y: 0.25, z: 0.25 }, { x: 0.75, y: 0.75, z: 0.25 }, { x: 0.75, y: 0.25, z: 0.75 }, { x: 0.25, y: 0.75, z: 0.75 }];
  const yaw = 0.42, pitch = 0.3, s = 300;
  const proj = atoms3.map((a) => project({ x: a.x - 0.5, y: a.y - 0.5, z: a.z - 0.5 }, yaw, pitch, s));
  const bonds: Array<[number, number]> = [];
  for (let i = 0; i < atoms3.length; i++) for (let j = i + 1; j < atoms3.length; j++) {
    const d = Math.hypot(atoms3[i].x - atoms3[j].x, atoms3[i].y - atoms3[j].y, atoms3[i].z - atoms3[j].z);
    if (Math.abs(d - Math.sqrt(3) / 4) < 1e-6) bonds.push([i, j]);
  }
  // The cube's edges, faint, so the eye reads the depth.
  const corners = [0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1].map((z) => ({ x, y, z }))));
  for (const a of corners) for (const b of corners) {
    const diff = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + Math.abs(a.z - b.z);
    if (diff === 1 && a.x + a.y + a.z < b.x + b.y + b.z) {
      const pa = project({ x: a.x - 0.5, y: a.y - 0.5, z: a.z - 0.5 }, yaw, pitch, s).p, pb = project({ x: b.x - 0.5, y: b.y - 0.5, z: b.z - 0.5 }, yaw, pitch, s).p;
      sk.line([pa, pb], { stroke: "muted", width: 1, dash: "4 5", opacity: 0.6 }, false);
    }
  }
  // The highlighted atom: the nearest interior atom, with its four bonds (the tetrahedron).
  const interior = [14, 15, 16, 17];
  const centre = interior.sort((a, b) => proj[b].depth - proj[a].depth)[0];
  type Item = { depth: number; draw: () => void };
  const items: Item[] = [];
  let labelBond: [number, number] | null = null;
  for (const [i, j] of bonds) {
    const mine = i === centre || j === centre;
    if (mine && (!labelBond || proj[i === centre ? j : i].p.x > proj[labelBond[0] === centre ? labelBond[1] : labelBond[0]].p.x)) labelBond = [i, j];
    items.push({ depth: (proj[i].depth + proj[j].depth) / 2, draw: () => sk.line([proj[i].p, proj[j].p], { stroke: mine ? PALETTE.amber : "ink", width: mine ? 4 : 3, part: mine ? "covalent-bond" : undefined }, false) });
  }
  const dMin = Math.min(...proj.map((p) => p.depth)), dMax = Math.max(...proj.map((p) => p.depth));
  proj.forEach((q, i) => {
    const near = (q.depth - dMin) / (dMax - dMin || 1);
    const r = 12 + 5 * near;
    items.push({ depth: q.depth + 0.01, draw: () => sk.circle(q.p, r, { fill: i === centre ? PALETTE.blue : "metal", stroke: "ink", width: 1.6, part: i === centre ? "atom" : undefined }, false) });
  });
  items.sort((a, b) => a.depth - b.depth).forEach((it) => it.draw());
  const c = proj[centre].p;
  sk.part("atom", "Carbon atom (4 covalent bonds)", { x: c.x - 6, y: c.y + 6 });
  const [i, j] = labelBond!;
  sk.part("covalent-bond", "Strong covalent bond", lerp(proj[i].p, proj[j].p, 0.6));
}

function graphite(sk: Sketch, params: FigureParams) {
  const nLayers = Math.max(2, Math.min(3, Math.round(Number(params.layers) || 3)));
  const b = 28, W = 270, D = 170, gapY = 108;
  // Graphene: lattice vectors a1 = (√3b, 0), a2 = (√3b/2, 1.5b), atoms at the two basis sites.
  const flatAtoms = (shift: number): Pt[] => {
    const out: Pt[] = [];
    for (let i = -8; i < 14; i++) for (let j = -2; j < 8; j++) for (const by of [0, b]) {
      const X = i * Math.sqrt(3) * b + j * (Math.sqrt(3) / 2) * b, Z = j * 1.5 * b + by + shift;
      if (X >= -1 && X <= W + 1 && Z >= -1 && Z <= D + 1) out.push({ x: X, y: Z });
    }
    return out;
  };
  const toScreen = (q: Pt, layer: number): Pt => ({ x: q.x + 0.5 * q.y, y: layer * gapY - 0.42 * q.y });
  // ABAB stacking: alternate layers shifted by one bond length, so half the atoms sit over atoms below.
  const layers = Array.from({ length: nLayers }, (_, L) => flatAtoms(L % 2 ? b : 0));
  // A few stacked atoms along the front edge, well apart: where the weak forces are drawn.
  const forceLines = (upper: Pt[], lower: Pt[]) => {
    const out: Pt[] = [];
    for (const u of upper.filter((a) => a.y < b * 1.6 && lower.some((l) => dist(l, a) < 1)).sort((p, q) => toScreen(p, 0).x - toScreen(q, 0).x))
      if (out.every((o) => Math.abs(toScreen(o, 0).x - toScreen(u, 0).x) > 70)) out.push(u);
    return out;
  };
  // Weak forces between layers: dashed lines between atoms stacked one above the other.
  for (let L = 0; L < nLayers - 1; L++) {
    const upper = layers[L], lower = layers[L + 1];
    forceLines(upper, lower).forEach((u, k) => {
      const part = L === 0 && k === 1 ? "intermolecular-force" : undefined;
      sk.line([toScreen(u, L), toScreen(u, L + 1)], { stroke: PALETTE.violet, width: 1.6, dash: "5 5", part }, false);
    });
  }
  let bondAnchor: Pt | null = null, atomAnchor: Pt | null = null, layerAnchor: Pt | null = null, forceAnchor: Pt | null = null;
  // The labelled atom: a fully bonded one at the left edge of the top layer.
  const leftAtom = layers[0].filter((a) => a.y > D * 0.2 && a.y < D * 0.8 && layers[0].filter((o) => Math.abs(dist(o, a) - b) < 0.5).length === 3).sort((p, q) => toScreen(p, 0).x - toScreen(q, 0).x)[0];
  for (let L = nLayers - 1; L >= 0; L--) {
    const atoms = layers[L];
    for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) {
      if (Math.abs(dist(atoms[i], atoms[j]) - b) > 0.5) continue;
      const p = toScreen(atoms[i], L), q = toScreen(atoms[j], L);
      const isLabel = L === 0 && !bondAnchor && atoms[i].y > D * 0.4 && atoms[i].x > W * 0.8 && Math.abs(atoms[i].x - atoms[j].x) < 1;
      sk.line([p, q], { stroke: "ink", width: 2.6, part: isLabel ? "covalent-bond" : L === nLayers - 1 ? "layer" : undefined }, false);
      if (isLabel) bondAnchor = lerp(p, q, 0.5);
    }
    for (const a of atoms) {
      const p = toScreen(a, L);
      const isAtom = L === 0 && a === leftAtom;
      sk.circle(p, 5.5, { fill: "ink", stroke: "ink", width: 1, part: isAtom ? "atom" : undefined }, false);
      if (isAtom) atomAnchor = p;
    }
    if (L === nLayers - 1) layerAnchor = toScreen({ x: W, y: D * 0.5 }, L);
  }
  // Delocalised electrons: one per carbon, free to move along the layer (shown on the top layer).
  const centres: Pt[] = [];
  const top = layers[0];
  for (const a of top) {
    const ring = top.filter((o) => dist(o, a) < b * 2.01);
    const c = { x: a.x + (Math.sqrt(3) / 2) * b, y: a.y + b / 2 };
    if (ring.length && top.filter((o) => Math.abs(dist(o, c) - b) < 0.5).length === 6) centres.push(c);
  }
  let elAnchor: Pt | null = null;
  centres.forEach((c, k) => {
    const p = toScreen(c, 0);
    const isLabel = k === centres.reduce((m, c2, kk) => (toScreen(c2, 0).x < toScreen(centres[m], 0).x && c2.y > D * 0.3 ? kk : m), 0);
    sk.circle(p, 3.6, { fill: PALETTE.red, stroke: PALETTE.red, width: 1, part: isLabel ? "delocalised-electrons" : undefined }, false);
    if (isLabel) elAnchor = p;
  });
  const fu = forceLines(layers[0], layers[1])[1];
  if (fu) forceAnchor = lerp(toScreen(fu, 0), toScreen(fu, 1), 0.5);
  if (atomAnchor) sk.part("atom", "Carbon atom (3 covalent bonds)", atomAnchor);
  if (bondAnchor) sk.part("covalent-bond", "Strong covalent bond", bondAnchor);
  if (layerAnchor) sk.part("layer", "Layer of hexagons", layerAnchor);
  if (forceAnchor) sk.part("intermolecular-force", "Weak forces between layers", forceAnchor);
  if (elAnchor) sk.part("delocalised-electrons", "Delocalised electrons", elAnchor);
}

function simpleMolecular(sk: Sketch, params: FigureParams) {
  const sub = String(params.substance ?? params.molecule ?? params.compound ?? "iodine").toLowerCase();
  const anchors: Record<string, Pt> = {};
  const names: Record<string, string> = {};
  if (/ice|water|h2o/.test(sub)) {
    // Square ice: every O has two near H (covalent) and is reached by two far H (hydrogen bonds).
    const step = 96, cols = 4, rows = 3, rO = 15, rH = 8.5, oh = 30;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const o = { x: i * step, y: j * step };
      const hs = [{ x: o.x + oh, y: o.y }, { x: o.x, y: o.y + oh }];
      hs.forEach((h, k) => {
        const next = k === 0 ? (i < cols - 1 ? { x: o.x + step, y: o.y } : null) : j < rows - 1 ? { x: o.x, y: o.y + step } : null;
        if (next) {
          const isLabel = i === cols - 2 && j === 0 && k === 0;
          sk.line([{ x: h.x + (k === 0 ? rH : 0), y: h.y + (k === 1 ? rH : 0) }, { x: next.x - (k === 0 ? rO : 0), y: next.y - (k === 1 ? rO : 0) }], { stroke: PALETTE.violet, width: 2, dash: "4 4", part: isLabel ? "hydrogen-bond" : undefined }, false);
          if (isLabel) anchors["hydrogen-bond"] = { x: (h.x + next.x) / 2 + 4, y: h.y };
        }
        const isBond = i === 0 && j === rows - 1 && k === 0;
        sk.line([o, h], { stroke: "ink", width: 3.4, part: isBond ? "covalent-bond" : undefined }, false);
        if (isBond) anchors["covalent-bond"] = { x: o.x + rO + 3, y: o.y };
      });
      const isMol = i === 0 && j === 0;
      sk.circle(o, rO, { fill: PALETTE.red, stroke: "ink", width: 1.6, part: isMol ? "molecule" : undefined }, false);
      sk.text(o, "O", 15, "paper", isMol ? "molecule" : undefined);
      hs.forEach((h) => {
        sk.circle(h, rH, { fill: "paper", stroke: "ink", width: 1.6, part: isMol ? "molecule" : undefined }, false);
        sk.text(h, "H", 11, "ink", isMol ? "molecule" : undefined);
      });
      if (isMol) anchors.molecule = { x: o.x - rO * 0.7, y: o.y - rO * 0.7 };
    }
    names.molecule = "Water molecule, H₂O";
    names["covalent-bond"] = "Covalent bond (O–H, strong)";
    names["hydrogen-bond"] = "Hydrogen bond (intermolecular force)";
  } else {
    const [sym, fill, label]: [string, Ink, string] = /brom/.test(sub) ? ["Br", "#b45309", "Bromine molecule, Br₂"] : /chlor/.test(sub) ? ["Cl", PALETTE.green, "Chlorine molecule, Cl₂"] : ["I", PALETTE.violet, "Iodine molecule, I₂"];
    // Diatomic molecules on a regular grid, in the herringbone of an iodine crystal; weak forces
    // (dashed) between each molecule and its neighbours.
    const r = 17, half = 13, step = 96, cols = 4, rows = 3;
    const reach = half * Math.sin((35 * Math.PI) / 180) + r + 5, reachX = half * Math.cos((35 * Math.PI) / 180) + r + 5;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const c = { x: i * step, y: j * step };
      if (i < cols - 1) {
        const isForce = i === cols - 2 && j === 1;
        sk.line([{ x: c.x + reachX, y: c.y }, { x: c.x + step - reachX, y: c.y }], { stroke: PALETTE.amber, width: 1.8, dash: "4 4", part: isForce ? "intermolecular-force" : undefined }, false);
        if (isForce) anchors["intermolecular-force"] = { x: c.x + step / 2, y: c.y };
      }
      if (j < rows - 1) sk.line([{ x: c.x, y: c.y + reach }, { x: c.x, y: c.y + step - reach }], { stroke: PALETTE.amber, width: 1.8, dash: "4 4" }, false);
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const c = { x: i * step, y: j * step };
      const ang = ((i + j) % 2 ? 35 : -35) * (Math.PI / 180);
      const u = { x: Math.cos(ang), y: Math.sin(ang) };
      const a = { x: c.x - u.x * half, y: c.y - u.y * half }, b = { x: c.x + u.x * half, y: c.y + u.y * half };
      const isMol = i === 0 && j === 1, isAtom = i === cols - 1 && j === 2, isBond = i === cols - 1 && j === 0;
      for (const [p, k] of [[a, 0], [b, 1]] as const) {
        const part = isMol ? "molecule" : isAtom && k === 1 ? "atom" : isBond ? "covalent-bond" : undefined;
        sk.circle(p, r, { fill, stroke: "ink", width: 1.6, part }, false);
        sk.text(p, sym, 14, "paper", part);
      }
      if (isMol) anchors.molecule = { x: a.x - r * 0.6, y: a.y };
      if (isAtom) anchors.atom = { x: b.x + r * 0.6, y: b.y };
      if (isBond) anchors["covalent-bond"] = c;
    }
    names.molecule = label;
    names.atom = `${sym} atom`;
    names["covalent-bond"] = "Covalent bond (strong)";
    names["intermolecular-force"] = "Weak intermolecular forces";
  }
  for (const [id, p] of Object.entries(anchors)) sk.part(id, names[id], p);
}

export const latticeStructure: FigureComponent = {
  name: "latticeStructure",
  title: "Structure and bonding of solids: giant ionic lattice (NaCl), metallic lattice, diamond, graphite layers, simple molecular solid (iodine, ice)",
  params: `type ("giant-ionic" — default; "metallic"; "diamond" — giant covalent; "graphite"; "simple-molecular"), compound (giant-ionic: a 1:1 ionic compound, e.g. "NaCl" — default, "MgO", "KCl"; charges are computed), view (giant-ionic: "3d" — ball-and-stick cube, default — or "2d": one layer of touching ions), metal (metallic: e.g. "sodium", "magnesium", "aluminium", "copper" — sets the ion charge and the number of delocalised electrons), layers (graphite: 2 or 3), substance (simple-molecular: "iodine" — default, "bromine", "chlorine", or "ice" with hydrogen bonds).`,
  match: /\b(giant (ionic |covalent |metallic )?(lattice|structure)s?|ionic lattice|crystal lattice|metallic (bond(ing)?|lattice|structure)|sea of (delocali[sz]ed )?electrons|structure of (diamond|graphite|sodium chloride|a metal|metals|ice|iodine)|diamond and graphite|graphite (layers|structure)|simple molecular (structure|substance|lattice)s?)\b/i,
  parts: [
    { id: "positive-ion", name: "Positive ion" },
    { id: "negative-ion", name: "Negative ion" },
    { id: "electrostatic-attraction", name: "Electrostatic attraction" },
    { id: "metal-ion", name: "Positive metal ion" },
    { id: "delocalised-electrons", name: "Delocalised electrons" },
    { id: "layer", name: "Layer" },
    { id: "atom", name: "Atom" },
    { id: "covalent-bond", name: "Covalent bond" },
    { id: "intermolecular-force", name: "Weak intermolecular forces" },
    { id: "hydrogen-bond", name: "Hydrogen bond" },
    { id: "molecule", name: "Molecule" },
  ],
  build(params: FigureParams) {
    const kind = latticeKind(params.type ?? params.structure ?? params.kind);
    const sk = new Sketch();
    if (kind === "giant-ionic") giantIonic(sk, params);
    else if (kind === "metallic") metallic(sk, params);
    else if (kind === "diamond") diamond(sk);
    else if (kind === "graphite") graphite(sk, params);
    else simpleMolecular(sk, params);
    return sk.finish(14);
  },
};
