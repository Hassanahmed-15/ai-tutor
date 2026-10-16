import type { FigureComponent, FigureParams, Ink, Pt } from "../types";
import { Sketch, add, mul, sub, unit, perp, dist, textW } from "./mathsKit";

/**
 * α- AND β-GLUCOSE, DRAWN AS TEXTBOOK HAWORTH RINGS. The ring is the conventional flattened hexagon —
 * ring oxygen at the back right, carbon 1 on the right, the front edge (C2–C3) drawn bold — with every
 * H and OH on the carbon it belongs to (D-glucose: C2 OH down, C3 OH up, C4 OH down, C5 CH₂OH up).
 * The only difference between the isomers is carbon 1: α has its OH below the ring, β above, and that
 * group is highlighted. "maltose" draws two α-glucose condensing: the C1 OH of one and the H of the
 * other's C4 OH leave as water, and the α-1,4 glycosidic bond (C1–O–C4) joins the rings.
 *
 * The small molecule-drawing helpers here (an atom group placed with its bonding letter on a point,
 * a bond trimmed clear of the letters it joins) are shared by the other molecule figures.
 */

export const CHEM = { hiText: "#d97706", O: "#be123c", N: "#2563eb", P: "#d97706", hi: "#d97706", soft: "#fde68a", num: "#2563eb", water: "#0284c7", S: "#ca8a04" } as const;

/** Writes `text` so that its `at`-th character (the atom that bonds) is centred on `p`. Returns the text's centre. */
export function atomText(sk: Sketch, p: Pt, text: string, size: number, fill: Ink = "ink", part?: string, at: "first" | "last" | "center" = "first"): Pt {
  const w = textW(text, size);
  const chars = [...text];
  const first = textW(chars[0] ?? "", size), last = textW(chars[chars.length - 1] ?? "", size);
  const dx = at === "center" ? 0 : at === "first" ? w / 2 - first / 2 : -(w / 2 - last / 2);
  const c = { x: p.x + dx, y: p.y };
  sk.text(c, text, size, fill, part);
  return c;
}

/**
 * A bond from a to b, stopped `ra`/`rb` short of each end (0 for a bare skeletal vertex, about 0.6 of
 * the font size for a lettered atom). `double` draws the second line on the given side (or both sides
 * of the centre); `width` > 3 is the bold front edge of a Haworth ring.
 */
export function bond(sk: Sketch, a: Pt, b: Pt, o: { ra?: number; rb?: number; width?: number; part?: string; stroke?: Ink; double?: "left" | "right" | "center"; gap?: number; dash?: string } = {}) {
  const u = unit(sub(b, a));
  const A = add(a, mul(u, o.ra ?? 0)), B = sub(b, mul(u, o.rb ?? 0));
  if (dist(A, B) < 2) return;
  const style = { stroke: o.stroke ?? ("ink" as Ink), width: o.width ?? 2.2, part: o.part, dash: o.dash };
  const g = o.gap ?? 5;
  if (!o.double) return sk.line([A, B], style);
  const n = perp(u);
  if (o.double === "center") {
    sk.line([add(A, mul(n, g / 2)), add(B, mul(n, g / 2))], style);
    sk.line([add(A, mul(n, -g / 2)), add(B, mul(n, -g / 2))], style);
    return;
  }
  const s = o.double === "left" ? -1 : 1;
  sk.line([A, B], style);
  // The inner line is a little shorter, as drawn in textbooks.
  const k = Math.min(4, dist(A, B) * 0.12);
  sk.line([add(add(A, mul(u, k)), mul(n, s * g)), add(sub(B, mul(u, k)), mul(n, s * g))], style);
}

/** An arrow with a filled head ending exactly at `to`. */
export function chemArrow(sk: Sketch, from: Pt, to: Pt, o: { stroke?: Ink; width?: number; part?: string; head?: number } = {}) {
  const u = unit(sub(to, from)), n = perp(u);
  const L = Math.min(o.head ?? 12, dist(from, to) * 0.45);
  const base = sub(to, mul(u, L));
  sk.line([from, add(base, mul(u, 2))], { stroke: o.stroke ?? "ink", width: o.width ?? 2.4, part: o.part });
  sk.polygon([to, add(base, mul(n, L * 0.45)), add(base, mul(n, -L * 0.45))], { fill: o.stroke ?? "ink", stroke: o.stroke ?? "ink", width: 1, part: o.part });
}

/** A highlight behind a group of atoms (drawn first so letters sit on it). */
export function softBox(sk: Sketch, c: Pt, w: number, h: number, fill: Ink | "none", part?: string, opts: { stroke?: Ink; dash?: string; opacity?: number } = {}) {
  const r = Math.min(10, h / 2, w / 2);
  const x0 = c.x - w / 2, y0 = c.y - h / 2, x1 = c.x + w / 2, y1 = c.y + h / 2;
  sk.path(
    [
      { k: "M", p: { x: x0 + r, y: y0 } },
      { k: "L", p: { x: x1 - r, y: y0 } },
      { k: "A", c: { x: x1 - r, y: y0 + r }, r, to: { x: x1, y: y0 + r }, large: false, sweep: true },
      { k: "L", p: { x: x1, y: y1 - r } },
      { k: "A", c: { x: x1 - r, y: y1 - r }, r, to: { x: x1 - r, y: y1 }, large: false, sweep: true },
      { k: "L", p: { x: x0 + r, y: y1 } },
      { k: "A", c: { x: x0 + r, y: y1 - r }, r, to: { x: x0, y: y1 - r }, large: false, sweep: true },
      { k: "L", p: { x: x0, y: y0 + r } },
      { k: "A", c: { x: x0 + r, y: y0 + r }, r, to: { x: x0 + r, y: y0 }, large: false, sweep: true },
    ],
    true,
    // A highlight is see-through, so the atoms on it stay readable on paper and on the chalkboard.
    { fill, stroke: opts.stroke ?? "none", width: 1.6, dash: opts.dash, opacity: opts.opacity ?? (fill === CHEM.soft ? 0.55 : 1), part },
  );
}

/** The parameter `show`, read forgivingly. */
export function pick<T extends string>(v: unknown, options: ReadonlyArray<[T, RegExp]>, fallback: T): T {
  const s = typeof v === "string" ? v.toLowerCase() : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
  for (const [k, re] of options) if (re.test(s)) return k;
  return fallback;
}

type Anomer = "alpha" | "beta";
type Show = "both" | "alpha" | "beta" | "maltose";

const F = 18; // atom letters
const NUM = 14; // carbon numbers
const R_ATOM = 9.5; // a bond stops this far from a lettered atom's centre

/** Ring atom positions of one Haworth ring centred on c (scale s). */
export function haworth(c: Pt, s = 1) {
  const P = (x: number, y: number): Pt => ({ x: c.x + x * s, y: c.y + y * s });
  return { C1: P(100, 0), C2: P(55, 48), C3: P(-55, 48), C4: P(-100, 0), C5: P(-55, -48), O: P(55, -48) };
}

type RingOpts = {
  anomer: Anomer;
  ringPart: string;
  s?: number;
  /** Leave out C1's group below the ring / C4's OH (they are drawn by the caller as a bond or as leaving atoms). */
  c1Down?: "OH" | "none";
  c4Down?: "OH" | "none";
  /** Part ids for highlighted pieces (only on the ring that carries the label). */
  parts?: { c1OH?: string; ringO?: string; c1?: string; c4?: string; c6?: string };
  highlightC1?: boolean;
};

/** One glucose ring (α or β), every H and OH on its own carbon; returns the points callers bond to. */
function glucoseRing(sk: Sketch, c: Pt, o: RingOpts) {
  const s = o.s ?? 1;
  const R = haworth(c, s);
  const L = 36 * s; // substituent stick
  const Li = 28 * s; // the shorter sticks drawn up into the ring from C2 / C3
  const part = o.ringPart;
  const p = o.parts ?? {};
  // C1's OH highlight goes behind everything.
  const c1Up = o.anomer === "beta" ? "OH" : "H";
  const c1Dn = o.anomer === "alpha" ? (o.c1Down ?? "OH") : "H";
  const ohAt = o.anomer === "alpha" ? { x: R.C1.x, y: R.C1.y + L } : { x: R.C1.x, y: R.C1.y - L };
  const ohShown = o.anomer === "beta" || c1Dn === "OH";
  if (o.highlightC1 && ohShown) {
    const w = textW("OH", F);
    softBox(sk, { x: ohAt.x + w / 2 - 6, y: ohAt.y + (o.anomer === "alpha" ? 2 : -2) }, w + 16, F + 12, CHEM.soft, p.c1OH, { stroke: CHEM.hi });
  }
  // Ring carbons (lettered), ring O, and the six ring bonds; the front three edges bold.
  const ringAtoms: Array<[keyof typeof R, string]> = [["C1", "C"], ["C2", "C"], ["C3", "C"], ["C4", "C"], ["C5", "C"], ["O", "O"]];
  const order: Array<keyof typeof R> = ["C1", "C2", "C3", "C4", "C5", "O"];
  for (let i = 0; i < 6; i++) {
    const a = order[i], b = order[(i + 1) % 6];
    const front = a === "C1" || a === "C2" || a === "C3";
    bond(sk, R[a], R[b], { ra: R_ATOM, rb: R_ATOM, width: front ? (a === "C2" ? 6 : 4.2) : 2.4, part: b === "O" || a === "O" ? (p.ringO ?? part) : part });
  }
  for (const [k, t] of ringAtoms) {
    const id = k === "O" ? p.ringO ?? part : k === "C1" ? p.c1 ?? part : k === "C4" ? p.c4 ?? part : part;
    atomText(sk, R[k], t, F, k === "O" ? CHEM.O : "ink", id, "center");
  }
  // Carbon numbers beside each carbon, outside the ring.
  const nums: Array<[string, Pt]> = [
    ["1", { x: R.C1.x + 14 * s, y: R.C1.y - 12 * s }],
    ["2", { x: R.C2.x + 17 * s, y: R.C2.y + 13 * s }],
    ["3", { x: R.C3.x - 17 * s, y: R.C3.y + 13 * s }],
    ["4", { x: R.C4.x - 14 * s, y: R.C4.y - 12 * s }],
    ["5", { x: R.C5.x - 16 * s, y: R.C5.y - 13 * s }],
  ];
  for (const [t, at] of nums) sk.text(at, t, NUM, CHEM.num, part);
  // Substituents: [carbon, up group, down group, up stick length]
  const subs: Array<[keyof typeof R, string, string, number]> = [
    ["C1", c1Up, c1Dn, L],
    ["C2", "H", "OH", Li],
    ["C3", "OH", "H", Li],
    ["C4", "H", o.c4Down ?? "OH", L],
  ];
  const ends: { c1Down: Pt; c4Down: Pt } = { c1Down: { x: R.C1.x, y: R.C1.y + L }, c4Down: { x: R.C4.x, y: R.C4.y + L } };
  for (const [k, up, dn, upL] of subs) {
    const C = R[k];
    for (const [g, dir, len] of [[up, -1, upL], [dn, 1, L]] as Array<[string, number, number]>) {
      if (g === "none") continue;
      const end = { x: C.x, y: C.y + dir * len };
      const isC1OH = k === "C1" && g === "OH";
      const id = isC1OH ? p.c1OH ?? part : part;
      bond(sk, C, end, { ra: R_ATOM, rb: R_ATOM, part: id, width: isC1OH ? 2.6 : 2.2 });
      // Groups on the outer left are written HO (the O bonds); elsewhere OH (C3's OH points up into the ring).
      const leftSide = k === "C4" || (k === "C3" && dir > 0);
      const text = g === "OH" && leftSide ? "HO" : g;
      atomText(sk, end, text, F, isC1OH && o.highlightC1 ? CHEM.hiText : g === "OH" ? CHEM.O : "ink", id, leftSide ? "last" : "first");
    }
  }
  // C5: H down, C6 (CH₂OH) up.
  bond(sk, R.C5, { x: R.C5.x, y: R.C5.y + Li }, { ra: R_ATOM, rb: R_ATOM, part });
  atomText(sk, { x: R.C5.x, y: R.C5.y + Li }, "H", F, "ink", part, "first");
  const c6 = { x: R.C5.x, y: R.C5.y - L };
  bond(sk, R.C5, c6, { ra: R_ATOM, rb: R_ATOM, part: p.c6 ?? part });
  const c6c = atomText(sk, c6, "CH₂OH", F, "ink", p.c6 ?? part, "first");
  sk.text({ x: c6.x, y: c6.y - 17 }, "6", NUM, CHEM.num, p.c6 ?? part);
  void c6c;
  return { R, ends, ohAt, c6 };
}

export const glucoseRings: FigureComponent = {
  name: "glucoseRings",
  title: "Glucose rings: α- and β-glucose ring structures (Haworth), carbons 1–6 numbered, the C1 OH below (α) or above (β) the ring; or two α-glucose condensing into maltose by an α-1,4 glycosidic bond",
  params: `show ("both" default: α- and β-glucose side by side with the carbon-1 OH highlighted | "alpha" | "beta" | "maltose": two α-glucose → maltose + H₂O, condensation forming the α-1,4 glycosidic bond). The atoms on every carbon are fixed by the chemistry of D-glucose — never give them.`,
  match: /(?<![A-Za-z])(α|β|alpha|beta)[- ]?(d-)?glucose\b|\bglycosidic (bonds?|links?|linkages?)\b|\bmaltose\b|\b(ring|structural|haworth) (structures?|formulae?|forms?) of glucose\b|\bglucose (isomers?|ring structures?)\b|\b(isomers?|ring forms?) of glucose\b/i,
  parts: [
    { id: "alpha-glucose", name: "α-glucose" },
    { id: "beta-glucose", name: "β-glucose" },
    { id: "alpha-hydroxyl", name: "OH below the ring (α)" },
    { id: "beta-hydroxyl", name: "OH above the ring (β)" },
    { id: "carbon-1", name: "Carbon 1" },
    { id: "carbon-4", name: "Carbon 4" },
    { id: "carbon-6", name: "Carbon 6 (CH₂OH)" },
    { id: "ring-oxygen", name: "Ring oxygen" },
    { id: "glycosidic-bond", name: "α-1,4 glycosidic bond" },
    { id: "water", name: "Water released (H₂O)" },
    { id: "condensation", name: "Condensation reaction" },
    { id: "maltose", name: "Maltose" },
  ],
  build(params: FigureParams) {
    const show = pick<Show>(params.show ?? params.view ?? params.form, [["maltose", /malt|glycosid|disacch|condens/], ["both", /both|compar|vs|and/], ["alpha", /alpha|α|^a$/], ["beta", /beta|β|^b$/]], "both");
    const sk = new Sketch();
    if (show === "alpha" || show === "beta") {
      const ring = glucoseRing(sk, { x: 0, y: 0 }, {
        anomer: show, ringPart: `${show}-glucose`, highlightC1: true,
        parts: { c1OH: `${show}-hydroxyl`, ringO: "ring-oxygen", c1: "carbon-1", c4: "carbon-4", c6: "carbon-6" },
      });
      // Anchors on each part's own atoms; the ring itself at its bold front edge.
      // The ring at its C4–C5 edge: a leader reaches it between C4's H and the "4".
      sk.part(`${show}-glucose`, show === "alpha" ? "α-glucose" : "β-glucose", { x: (ring.R.C5.x + ring.R.C4.x) / 2, y: (ring.R.C5.y + ring.R.C4.y) / 2 });
      sk.part(`${show}-hydroxyl`, show === "alpha" ? "OH below the ring (α)" : "OH above the ring (β)", { x: ring.ohAt.x + textW("OH", F) + 1, y: ring.ohAt.y + (show === "alpha" ? 2 : -2) });
      sk.part("carbon-1", "Carbon 1", { x: ring.R.C1.x + 6, y: ring.R.C1.y });
      sk.part("carbon-4", "Carbon 4", { x: ring.R.C4.x - 7, y: ring.R.C4.y });
      sk.part("ring-oxygen", "Ring oxygen", { x: ring.R.O.x + 6, y: ring.R.O.y });
      sk.part("carbon-6", "Carbon 6 (CH₂OH)", { x: ring.c6.x - 7, y: ring.c6.y });
      return sk.finish(16, { w: 560, h: 260 });
    }
    if (show === "both") {
      // α above β: carbon 1 (where they differ) is the right-hand vertex of both, one under the other.
      const s = 0.86;
      const a = glucoseRing(sk, { x: 0, y: 0 }, { anomer: "alpha", s, ringPart: "alpha-glucose", highlightC1: true, parts: { c1OH: "alpha-hydroxyl", ringO: "ring-oxygen", c6: "carbon-6" } });
      const b = glucoseRing(sk, { x: 0, y: 196 }, { anomer: "beta", s, ringPart: "beta-glucose", highlightC1: true, parts: { c1OH: "beta-hydroxyl", c1: "carbon-1" } });
      // The two C1 groups compared: a dashed guide marks the ring's level at carbon 1.
      sk.part("alpha-glucose", "α-glucose", { x: a.R.C4.x - 7, y: a.R.C4.y });
      sk.part("beta-glucose", "β-glucose", { x: b.R.C4.x - 7, y: b.R.C4.y });
      sk.part("alpha-hydroxyl", "OH below the ring (α)", { x: a.ohAt.x + textW("OH", F) + 1, y: a.ohAt.y + 2 });
      sk.part("beta-hydroxyl", "OH above the ring (β)", { x: b.ohAt.x + textW("OH", F) + 1, y: b.ohAt.y - 2 });
      sk.part("carbon-1", "Carbon 1", { x: b.R.C1.x + 5, y: b.R.C1.y });
      sk.part("ring-oxygen", "Ring oxygen", { x: a.R.O.x + 6, y: a.R.O.y - 3 });
      sk.part("carbon-6", "Carbon 6 (CH₂OH)", { x: a.c6.x - 7, y: a.c6.y });
      return sk.finish(16, { w: 560, h: 260 });
    }
    // Maltose: two α-glucose (top) → maltose + H₂O (bottom).
    const s = 0.82, dx = 150, top = 0, bot = 234;
    // (Carbons 1 and 4 are numbered beside the bond; a margin label could not reach them without crossing a ring.)
    const left = glucoseRing(sk, { x: -dx, y: top }, { anomer: "alpha", ringPart: "alpha-glucose", s, c1Down: "none" });
    const right = glucoseRing(sk, { x: dx, y: top }, { anomer: "alpha", ringPart: "alpha-glucose", s, c4Down: "none" });
    // The atoms that leave: C1's OH (left) and the H of C4's OH (right); C4's O stays.
    const L = 36 * s;
    const o1 = left.ends.c1Down, o4 = right.ends.c4Down;
    bond(sk, left.R.C1, o1, { ra: R_ATOM, rb: R_ATOM });
    bond(sk, right.R.C4, o4, { ra: R_ATOM, rb: R_ATOM });
    const hW = textW("H", F);
    // A dashed ring round the three atoms that leave as water: O and H from carbon 1, H from carbon 4's OH.
    const hx = o4.x - 20, bx0 = o1.x - 13, bx1 = o4.x - 9;
    softBox(sk, { x: (bx0 + bx1) / 2, y: o1.y + 1 }, bx1 - bx0, F + 12, "none", "water", { stroke: CHEM.water, dash: "5 4" });
    atomText(sk, o1, "OH", F, CHEM.water, "water", "first");
    atomText(sk, { x: hx, y: o4.y }, "H", F, CHEM.water, "water", "center");
    void hW;
    atomText(sk, o4, "O", F, CHEM.O, undefined, "center");
    // Condensation arrow, with water leaving to the side.
    const a0 = { x: 0, y: o1.y + 22 }, a1 = { x: 0, y: bot - 70 * s - 26 };
    chemArrow(sk, a0, a1, { part: "condensation", width: 2.6 });
    const mid = { x: 0, y: (a0.y + a1.y) / 2 };
    sk.path([{ k: "M", p: { x: 0, y: mid.y - 10 } }, { k: "A", c: { x: 34, y: mid.y - 10 }, r: 34, to: { x: 34, y: mid.y + 24 }, large: false, sweep: false }], false, { stroke: CHEM.water, width: 2.2, fill: "none", part: "water" });
    sk.polygon([{ x: 46, y: mid.y + 24 }, { x: 34, y: mid.y + 18 }, { x: 34, y: mid.y + 30 }], { fill: CHEM.water, stroke: CHEM.water, width: 1, part: "water" });
    const wC = atomText(sk, { x: 56, y: mid.y + 24 }, "H₂O", F, CHEM.water, "water", "first");
    // Maltose: C1 (left ring) — O — C4 (right ring), the bond in the α (down) position.
    const ml = glucoseRing(sk, { x: -dx, y: bot }, { anomer: "alpha", ringPart: "maltose", s, c1Down: "none" });
    const mr = glucoseRing(sk, { x: dx, y: bot }, { anomer: "alpha", ringPart: "maltose", s, c4Down: "none" });
    // The bridging O sits below the substituents' level, so the bond reads clearly and a label can reach it.
    const gO = { x: 0, y: bot + 100 * s };
    const k1 = { x: ml.R.C1.x, y: ml.R.C1.y + 36 * s }, k4 = { x: mr.R.C4.x, y: mr.R.C4.y + 36 * s };
    const gw = textW("O", F);
    softBox(sk, gO, gw + 20, F + 14, CHEM.soft, "glycosidic-bond", { stroke: CHEM.hi });
    bond(sk, ml.R.C1, k1, { ra: R_ATOM, part: "glycosidic-bond", width: 2.8, stroke: CHEM.hi });
    bond(sk, k1, gO, { rb: R_ATOM + 2, part: "glycosidic-bond", width: 2.8, stroke: CHEM.hi });
    bond(sk, gO, k4, { ra: R_ATOM + 2, part: "glycosidic-bond", width: 2.8, stroke: CHEM.hi });
    bond(sk, k4, mr.R.C4, { rb: R_ATOM, part: "glycosidic-bond", width: 2.8, stroke: CHEM.hi });
    atomText(sk, gO, "O", F, CHEM.O, "glycosidic-bond", "center");
    sk.part("alpha-glucose", "α-glucose", { x: left.R.C4.x - 7, y: left.R.C4.y });
    sk.part("water", "Water released (H₂O)", { x: wC.x + textW("H₂O", F) / 2 + 4, y: wC.y });
    sk.part("condensation", "Condensation reaction", { x: 0, y: mid.y - 22 });
    sk.part("maltose", "Maltose", { x: ml.R.C4.x - 7, y: ml.R.C4.y });
    sk.part("glycosidic-bond", "α-1,4 glycosidic bond", { x: gO.x - 15, y: gO.y + 2 });
    void L;
    return sk.finish(16, { w: 560, h: 260 });
  },
};
