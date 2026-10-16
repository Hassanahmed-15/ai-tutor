import type { FigureComponent, FigureParams, Ink, Pt } from "../types";
import { Sketch, PALETTE, add, mul, sub, unit, perp, dist, lerp } from "./mathsKit";

/**
 * DOT-AND-CROSS BONDING, worked out from the formula. Code decides ionic or covalent (a metal with a
 * non-metal is ionic), the ions' charges from the groups and the ion counts from charge balance; for
 * a covalent molecule it finds the bonds that give every atom a full outer shell (single, double,
 * triple) and the lone pairs left over. The model only names the compound and the style.
 */

const SYMBOLS = ["H", "He", "Li", "Be", "B", "C", "N", "O", "F", "Ne", "Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar", "K", "Ca"];
const NAMES = ["hydrogen", "helium", "lithium", "beryllium", "boron", "carbon", "nitrogen", "oxygen", "fluorine", "neon", "sodium", "magnesium", "aluminium", "silicon", "phosphorus", "sulfur", "chlorine", "argon", "potassium", "calcium"];
/** Metals that form ions here (Be is left out: its compounds are taught as covalent). */
const METALS = new Set(["Li", "Na", "Mg", "Al", "K", "Ca"]);
/** Non-metals that form simple anions. */
const ANION_NAMES: Record<string, string> = { N: "Nitride", O: "Oxide", F: "Fluoride", P: "Phosphide", S: "Sulfide", Cl: "Chloride" };

const COMPOUND_NAMES: Record<string, string> = {
  "sodium chloride": "NaCl", "magnesium oxide": "MgO", "calcium chloride": "CaCl2", "sodium oxide": "Na2O", "potassium chloride": "KCl",
  "lithium fluoride": "LiF", "lithium chloride": "LiCl", "sodium fluoride": "NaF", "magnesium chloride": "MgCl2", "magnesium fluoride": "MgF2",
  "calcium oxide": "CaO", "calcium fluoride": "CaF2", "lithium oxide": "Li2O", "potassium oxide": "K2O", "aluminium oxide": "Al2O3", "aluminum oxide": "Al2O3",
  "aluminium fluoride": "AlF3", "magnesium nitride": "Mg3N2", "lithium nitride": "Li3N", "sodium sulfide": "Na2S", "magnesium sulfide": "MgS", "potassium fluoride": "KF",
  "calcium sulfide": "CaS", "potassium sulfide": "K2S", "sodium nitride": "Na3N",
  hydrogen: "H2", chlorine: "Cl2", fluorine: "F2", oxygen: "O2", nitrogen: "N2", "hydrogen chloride": "HCl", "hydrochloric acid": "HCl", "hydrogen fluoride": "HF",
  water: "H2O", ammonia: "NH3", methane: "CH4", "carbon dioxide": "CO2", ethene: "C2H4", ethylene: "C2H4", ethane: "C2H6", ethyne: "C2H2", acetylene: "C2H2",
  "hydrogen sulfide": "H2S", "tetrachloromethane": "CCl4", "carbon tetrachloride": "CCl4", silane: "SiH4", phosphine: "PH3", "boron trifluoride": "BF3",
  "hydrogen cyanide": "HCN", "carbon disulfide": "CS2", "chloromethane": "CH3Cl", "phosphorus trichloride": "PCl3", "nitrogen trichloride": "NCl3",
  "oxygen difluoride": "OF2", "silicon tetrachloride": "SiCl4", "dichlorine monoxide": "Cl2O", "beryllium chloride": "BeCl2",
};

const SUPS: Record<string, string> = { "1": "¹", "2": "²", "3": "³", "+": "⁺", "−": "⁻" };
const SUBS: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆" };
const chargeText = (c: number) => `${Math.abs(c) === 1 ? "" : Math.abs(c)}${c > 0 ? "+" : "−"}`;
const supCharge = (c: number) => [...chargeText(c)].map((ch) => SUPS[ch] ?? ch).join("");
const subFormula = (f: string) => f.replace(/([A-Za-z])(\d+)/g, (_, a: string, d: string) => a + [...d].map((c) => SUBS[c]).join(""));

function shellsOf(electrons: number): number[] {
  const out: number[] = [];
  let left = electrons;
  for (const cap of [2, 8, 8, 2]) {
    if (left <= 0) break;
    out.push(Math.min(cap, left));
    left -= Math.min(cap, left);
  }
  return out;
}
const zOf = (sym: string) => SYMBOLS.indexOf(sym) + 1;
const valence = (sym: string) => shellsOf(zOf(sym)).at(-1) ?? 0;
/** Bonds an atom forms to complete its outer shell (H: 1; B, Be: as many as their electrons). */
const need = (sym: string) => (sym === "H" ? 1 : valence(sym) < 4 ? valence(sym) : 8 - valence(sym));

/** "CaCl2" → [["Ca",1],["Cl",2]]; null when it is not a formula of known elements. */
function parseFormula(f: string): Array<[string, number]> | null {
  const s = f.replace(/[\s₀-₉]/g, (c) => (c.trim() ? String("₀₁₂₃₄₅₆₇₈₉".indexOf(c)) : ""));
  if (!/^([A-Z][a-z]?\d*)+$/.test(s)) return null;
  const counts = new Map<string, number>();
  for (const m of s.matchAll(/([A-Z][a-z]?)(\d*)/g)) {
    if (!SYMBOLS.includes(m[1])) return null;
    counts.set(m[1], (counts.get(m[1]) ?? 0) + Number(m[2] || 1));
  }
  return [...counts.entries()];
}

export type IonicInfo = {
  kind: "ionic";
  formula: string;
  cation: { symbol: string; name: string; charge: number; count: number; outerShell: number };
  anion: { symbol: string; name: string; charge: number; count: number; ownOuter: number; gained: number; outerShell: number };
};
export type CovalentAtom = { symbol: string; cross: boolean; at: Pt; lonePairs: number; single: number };
export type CovalentInfo = {
  kind: "covalent";
  formula: string;
  atoms: CovalentAtom[];
  bonds: Array<{ a: number; b: number; order: number }>;
};
export type BondingInfo = IonicInfo | CovalentInfo;

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

function ionic(metal: string, nonmetal: string): IonicInfo {
  const cq = valence(metal), aq = 8 - valence(nonmetal);
  const l = (cq * aq) / gcd(cq, aq);
  const cn = l / cq, an = l / aq;
  const formula = `${metal}${cn > 1 ? cn : ""}${nonmetal}${an > 1 ? an : ""}`;
  return {
    kind: "ionic",
    formula,
    cation: { symbol: metal, name: `${NAMES[zOf(metal) - 1][0].toUpperCase()}${NAMES[zOf(metal) - 1].slice(1)}`, charge: cq, count: cn, outerShell: shellsOf(zOf(metal) - cq).at(-1) ?? 0 },
    anion: { symbol: nonmetal, name: ANION_NAMES[nonmetal], charge: -aq, count: an, ownOuter: valence(nonmetal), gained: aq, outerShell: 8 },
  };
}

/** The bonds of a simple molecule: a diatomic, one central atom with terminal atoms, or C₂Hₙ. */
function covalent(counts: Array<[string, number]>, formula: string): CovalentInfo | null {
  const total = counts.reduce((s, [, n]) => s + n, 0);
  const atoms: Array<{ symbol: string; cross: boolean }> = [];
  const bonds: Array<{ a: number; b: number; order: number }> = [];
  if (counts.some(([s]) => ["He", "Ne", "Ar"].includes(s))) return null;
  if (total === 2) {
    const [a, b] = counts.length === 1 ? [counts[0][0], counts[0][0]] : [counts[0][0], counts[1][0]];
    if (need(a) !== need(b) || need(a) < 1 || need(a) > 3) return null;
    atoms.push({ symbol: a, cross: true }, { symbol: b, cross: false });
    bonds.push({ a: 0, b: 1, order: need(a) });
  } else if (counts.length === 2 && counts.some(([s, n]) => s === "C" && n === 2) && counts.some(([s, n]) => s === "H" && [2, 4, 6].includes(n))) {
    const h = counts.find(([s]) => s === "H")![1] / 2;
    atoms.push({ symbol: "C", cross: true }, { symbol: "C", cross: true });
    bonds.push({ a: 0, b: 1, order: 4 - h });
    for (const c of [0, 1]) for (let k = 0; k < h; k++) {
      atoms.push({ symbol: "H", cross: false });
      bonds.push({ a: c, b: atoms.length - 1, order: 1 });
    }
  } else {
    // One central atom: the atom that occurs once and needs the most bonds.
    const singles = counts.filter(([, n]) => n === 1).map(([s]) => s).sort((p, q) => need(q) - need(p));
    const central = singles[0];
    if (!central) return null;
    const terminals = counts.flatMap(([s, n]) => Array.from({ length: s === central ? n - 1 : n }, () => s));
    // Distinct terminal atoms first (they take the right-hand place); hydrogens last.
    terminals.sort((p, q) => (p === "H" ? 1 : 0) - (q === "H" ? 1 : 0) || need(q) - need(p));
    if (terminals.length < 2 || terminals.length > 4) return null;
    if (terminals.reduce((s, t) => s + need(t), 0) !== need(central) || terminals.some((t) => need(t) < 1 || need(t) > 3)) return null;
    atoms.push({ symbol: central, cross: true });
    for (const t of terminals) {
      atoms.push({ symbol: t, cross: false });
      bonds.push({ a: 0, b: atoms.length - 1, order: need(t) });
    }
  }
  const info: CovalentInfo = {
    kind: "covalent",
    formula,
    atoms: atoms.map((a, i) => {
      const bonded = bonds.filter((b) => b.a === i || b.b === i).reduce((s, b) => s + b.order, 0);
      const nb = Math.max(0, valence(a.symbol) - bonded);
      return { ...a, at: { x: 0, y: 0 }, lonePairs: Math.floor(nb / 2), single: nb % 2 };
    }),
    bonds,
  };
  return info;
}

/** The compound named by `formula`/`compound` (a formula or a name), worked out; NaCl by default. */
export function bondingInfo(params: FigureParams): BondingInfo {
  const raw = String(params.formula ?? params.compound ?? params.molecule ?? params.substance ?? "").trim().slice(0, 60);
  const lower = raw.toLowerCase().replace(/\s+/g, " ").replace(/\b(molecule|gas|ion(ic)?|compound|bond(ing)?)\b/g, "").trim();
  const known = COMPOUND_NAMES[lower] ?? Object.values(COMPOUND_NAMES).find((f) => f.toLowerCase() === lower.replace(/\s/g, ""));
  const formula = known ?? raw.replace(/\s/g, "");
  const counts = parseFormula(formula);
  if (counts) {
    const metal = counts.find(([s]) => METALS.has(s));
    const others = counts.filter(([s]) => !METALS.has(s));
    if (metal && counts.length === 2 && others.length === 1 && ANION_NAMES[others[0][0]]) return ionic(metal[0], others[0][0]);
    if (!metal) {
      const c = covalent(counts, formula);
      if (c) return c;
    }
  }
  // A compound this figure cannot draw is refused (an empty figure, which the board rejects), never
  // drawn as some other compound: a board about SO₂ must not show NaCl.
  return raw ? ({ ...ionic("Na", "Cl"), unsupported: true } as BondingInfo) : ionic("Na", "Cl");
}

/* ── drawing ─────────────────────────────────────────────────────────────────────────────── */

const CROSS: Ink = PALETTE.blue, DOT: Ink = PALETTE.red;
/** Screen point at `deg` (counter-clockwise from east, as on paper) on a circle. */
const at = (c: Pt, r: number, deg: number): Pt => ({ x: c.x + r * Math.cos((deg * Math.PI) / 180), y: c.y - r * Math.sin((deg * Math.PI) / 180) });
const angleTo = (a: Pt, b: Pt) => (Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI;
const norm = (d: number) => ((d % 360) + 360) % 360;
const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

function electron(sk: Sketch, p: Pt, cross: boolean, part?: string): number {
  if (cross) {
    const s = 5;
    sk.path([{ k: "M", p: { x: p.x - s, y: p.y - s } }, { k: "L", p: { x: p.x + s, y: p.y + s } }, { k: "M", p: { x: p.x + s, y: p.y - s } }, { k: "L", p: { x: p.x - s, y: p.y + s } }], false, { stroke: CROSS, width: 2.5, fill: "none", part });
  } else sk.circle(p, 4.6, { fill: DOT, stroke: DOT, width: 1, part }, false);
  return sk.ops.length - 1;
}
/** Give one drawn electron its own part (the electron a label points at). */
function retag(sk: Sketch, op: number, part: string): boolean {
  const o = sk.ops[op];
  if (!o || o.k === "text") return false;
  // Never take a part's last shape (H₂'s one pair stays the shared pair).
  const from = o.style.part;
  if (from && sk.ops.filter((x) => x.k !== "text" && x.style.part === from).length <= 1) return false;
  o.style = { ...o.style, part };
  return true;
}

/** Two electrons side by side on a shell at `deg` (tangential spacing). */
function pairAt(c: Pt, r: number, deg: number, gap = 6.5): [Pt, Pt] {
  const t = { x: -Math.sin((deg * Math.PI) / 180), y: -Math.cos((deg * Math.PI) / 180) };
  const p = at(c, r, deg);
  return [add(p, mul(t, gap)), add(p, mul(t, -gap))];
}

/** Inner shells (full style): electrons at the compass points, singly then in pairs. */
function innerShells(sk: Sketch, c: Pt, shells: number[], radii: number[], cross: boolean, part?: string) {
  shells.forEach((n, i) => {
    const r = radii[i];
    sk.circle(c, r, { fill: "none", stroke: "ink", width: 1.4, part }, false);
    const per = [0, 1, 2, 3].map((j) => Math.floor(n / 4) + (j < n % 4 ? 1 : 0));
    [90, 270, 0, 180].forEach((deg, j) => {
      if (per[j] === 1) electron(sk, at(c, r, deg), cross, part);
      else if (per[j] === 2) for (const p of pairAt(c, r, deg, 5.5)) electron(sk, p, cross, part);
    });
  });
}

const radiiFor = (sym: string, full: boolean) => {
  const n = shellsOf(zOf(sym)).length;
  if (!full || n === 1) return { outer: sym === "H" || sym === "He" ? 40 : 56, inner: [] as number[] };
  return n === 2 ? { outer: 62, inner: [22] } : { outer: 72, inner: [20, 40] };
};

function drawCovalent(info: CovalentInfo, full: boolean, sk: Sketch) {
  const R = info.atoms.map((a) => radiiFor(a.symbol, full));
  const pos: Pt[] = info.atoms.map(() => ({ x: 0, y: 0 }));
  // Overlapping shells; drawn in full, each shell stays clear of the other atom's inner shells.
  const bondLen = (i: number, j: number) => {
    const base = R[i].outer + R[j].outer - (info.atoms[i].symbol === "H" || info.atoms[j].symbol === "H" ? 32 : 30);
    const clear = Math.max(R[j].outer + (R[i].inner.at(-1) ?? 0) + 8, R[i].outer + (R[j].inner.at(-1) ?? 0) + 8);
    return Math.min(Math.max(base, clear), R[i].outer + R[j].outer - 22);
  };
  const central = info.bonds.length > 1 && info.bonds.every((b) => b.a === 0) ? 0 : -1;
  if (info.atoms.length === 2) {
    const d = bondLen(0, 1);
    pos[0] = { x: -d / 2, y: 0 };
    pos[1] = { x: d / 2, y: 0 };
  } else if (central === 0) {
    const n = info.atoms.length - 1;
    const lp = info.atoms[0].lonePairs + info.atoms[0].single;
    const dirs = n === 2 ? (lp ? [320, 220] : [0, 180]) : n === 3 ? (lp ? [0, 180, 270] : [330, 210, 90]) : [0, 90, 180, 270];
    // Terminals must not overlap each other: lengthen the bonds when they would (CCl₄ drawn in full).
    const minSep = Math.min(...dirs.flatMap((a, i) => dirs.slice(i + 1).map((b) => angDiff(a, b))));
    for (let k = 1; k <= n; k++) {
      const neighbour = Math.max(...info.atoms.slice(1).map((_, j) => R[j + 1].outer));
      let d = bondLen(0, k);
      d = Math.max(d, (R[k].outer + neighbour + 6) / (2 * Math.sin((minSep * Math.PI) / 360)));
      d = Math.min(d, R[0].outer + R[k].outer - 24);
      pos[k] = at({ x: 0, y: 0 }, d, dirs[k - 1]);
    }
  } else {
    // C₂Hₙ: the carbons side by side, their hydrogens fanned outwards.
    const d = bondLen(0, 1);
    pos[0] = { x: -d / 2, y: 0 };
    pos[1] = { x: d / 2, y: 0 };
    const h = (info.atoms.length - 2) / 2;
    const left = h === 1 ? [180] : h === 2 ? [135, 225] : [90, 180, 270];
    info.bonds.slice(1).forEach((b) => {
      const k = info.bonds.slice(1).filter((x) => x.a === b.a).indexOf(b);
      const deg = b.a === 0 ? left[k] : norm(180 - left[k]);
      pos[b.b] = at(pos[b.a], bondLen(b.a, b.b), deg);
    });
  }
  info.atoms.forEach((a, i) => (a.at = pos[i]));

  // Shells and symbols.
  const terminalIdx = info.atoms.length === 2 ? 1 : info.atoms.length - 1;
  info.atoms.forEach((a, i) => {
    sk.circle(pos[i], R[i].outer, { fill: "none", stroke: "ink", width: 2, part: i === terminalIdx ? "outer-shell" : undefined }, false);
    if (full && R[i].inner.length) innerShells(sk, pos[i], shellsOf(zOf(a.symbol)).slice(0, -1), R[i].inner, a.cross, "inner-shells");
    sk.text(pos[i], a.symbol, 22, "ink");
  });

  const anchors: Record<string, Pt> = {};
  const nameOf = (s: string) => s;
  // Shared pairs in each overlap: one electron from each atom, the pairs stacked across the bond.
  const occupied: number[][] = info.atoms.map(() => []);
  const bondEls: Array<{ bi: number; k: number; pa: Pt; pb: Pt; ia: number; ib: number; crossA: boolean; crossB: boolean }> = [];
  const lonePairs: Array<{ c: Pt; els: Array<{ p: Pt; op: number; cross: boolean }>; score: number }> = [];
  info.bonds.forEach((b, bi) => {
    const A = pos[b.a], B = pos[b.b];
    const d = dist(A, B), u = unit(sub(B, A)), n = perp(u);
    const mid = add(A, mul(u, (d - R[b.b].outer + R[b.a].outer) / 2));
    occupied[b.a].push(angleTo(A, B));
    occupied[b.b].push(angleTo(B, A));
    const part = b.order === 3 ? "triple-bond" : b.order === 2 ? "double-bond" : "shared-pair";
    const firstSingle = info.bonds.findIndex((x) => x.order === 1);
    for (let k = 0; k < b.order; k++) {
      const off = (k - (b.order - 1) / 2) * 15;
      const c = add(mid, mul(n, off));
      const pa = add(c, mul(u, -5.5)), pb = add(c, mul(u, 5.5));
      const thisPart = firstSingle < 0 && bi === 0 && k === 0 ? "shared-pair" : part;
      const ia = electron(sk, pa, info.atoms[b.a].cross, thisPart);
      const ib = electron(sk, pb, info.atoms[b.b].cross, thisPart);
      bondEls.push({ bi, k, pa, pb, ia, ib, crossA: info.atoms[b.a].cross, crossB: info.atoms[b.b].cross });
      if (thisPart === "shared-pair" && !anchors["shared-pair"] && (firstSingle < 0 || bi === firstSingle)) anchors["shared-pair"] = c;
      if (thisPart !== "shared-pair" && !anchors[part]) anchors[part] = mid;
    }
  });
  // CO₂: the shared-pair anchor is on the first double bond's first pair; the double-bond anchor goes on the other.
  if (info.bonds.every((b) => b.order === 2) && info.bonds.length > 1) {
    const b = info.bonds[1];
    const A = pos[b.a], B = pos[b.b];
    const u = unit(sub(B, A));
    anchors["double-bond"] = add(A, mul(u, (dist(A, B) - R[b.b].outer + R[b.a].outer) / 2));
  }

  // Lone pairs (and any single non-bonding electron) spread evenly in the widest free arc.
  info.atoms.forEach((a, i) => {
    const domains = a.lonePairs + a.single;
    const occ = occupied[i].map(norm).sort((p, q) => p - q);
    const dirs: number[] = [];
    if (domains) {
      let start = 0, gap = 360;
      if (occ.length) {
        gap = -1;
        occ.forEach((o, k) => {
          const next = k + 1 < occ.length ? occ[k + 1] : occ[0] + 360;
          if (next - o > gap) (gap = next - o), (start = o);
        });
      } else start = 90 - 360 / (domains + 1);
      for (let k = 1; k <= domains; k++) dirs.push(norm(start + (gap * k) / (domains + 1)));
    }
    dirs.forEach((deg, k) => {
      occupied[i].push(deg);
      if (k < a.lonePairs) {
        const [p, q] = pairAt(pos[i], R[i].outer, deg);
        const op1 = electron(sk, p, a.cross, "lone-pair");
        const op2 = electron(sk, q, a.cross, "lone-pair");
        const c = at(pos[i], R[i].outer, deg);
        // The lone pair a leader reaches most easily: high on the figure, on an outer atom.
        lonePairs.push({ c, els: [{ p, op: op1, cross: a.cross }, { p: q, op: op2, cross: a.cross }], score: -c.y + (i === 0 ? 0 : 30) });
      } else electron(sk, at(pos[i], R[i].outer, deg), a.cross, "lone-pair");
    });
  });
  // Anchors spread over different electrons, so their leaders do not converge on one spot.
  lonePairs.sort((p, q) => q.score - p.score);
  if (lonePairs.length) anchors["lone-pair"] = lonePairs[0].c;
  const sharedBond = bondEls.find((e) => anchors["shared-pair"] && dist(lerp(e.pa, e.pb, 0.5), anchors["shared-pair"]) < 1)?.bi ?? 0;
  const otherBond = [...bondEls].reverse().find((e) => e.bi !== sharedBond);
  // × electron: from a second lone pair (farthest from the first), else from another bond, else the shared pair.
  const crossLp = lonePairs.slice(1).filter((l) => l.els[0].cross).sort((p, q) => dist(q.c, lonePairs[0].c) - dist(p.c, lonePairs[0].c))[0];
  const sharedK = bondEls.find((e) => anchors["shared-pair"] && dist(lerp(e.pa, e.pb, 0.5), anchors["shared-pair"]) < 1)?.k ?? 0;
  let aPick: { p: Pt; op: number } | undefined = crossLp ? { p: crossLp.els[0].p, op: crossLp.els[0].op } : undefined;
  if (!aPick) {
    // Another pair of the same multiple bond, else another bond, else the shared pair itself.
    const e = bondEls.find((x) => x.crossA && x.bi === sharedBond && x.k !== sharedK) ?? bondEls.find((x) => x.crossA && x.bi !== sharedBond) ?? bondEls.find((x) => x.crossA) ?? bondEls[0];
    aPick = { p: e.pa, op: e.ia };
  }
  // • electron: from a dot lone pair away from the lone-pair label, else another bond, else the shared pair.
  const dotLp = lonePairs.slice(1).filter((l) => !l.els[0].cross).sort((p, q) => dist(q.c, lonePairs[0].c) - dist(p.c, lonePairs[0].c))[0];
  if (dotLp) {
    if (retag(sk, dotLp.els[1].op, "electron-b")) anchors["electron-b"] = dotLp.els[1].p;
  } else {
    const dotEl = (otherBond && !otherBond.crossB ? otherBond : undefined) ?? bondEls.find((x) => !x.crossB && x.bi === sharedBond) ?? bondEls.find((x) => !x.crossB);
    if (dotEl && retag(sk, dotEl.ib, "electron-b")) anchors["electron-b"] = dotEl.pb;
  }
  if (retag(sk, aPick.op, "electron-a")) anchors["electron-a"] = aPick.p;
  // The outer shell: a bare stretch of a terminal atom's shell, away from every electron.
  const occ = occupied[terminalIdx].map(norm);
  let bestDeg = 45, bestGap = -1;
  for (let deg = 0; deg < 360; deg += 5) {
    const g = Math.min(...occ.map((o) => angDiff(o, deg)));
    const score = g + (Math.sin((deg * Math.PI) / 180) > 0 ? 8 : 0);
    if (score > bestGap) (bestGap = score), (bestDeg = deg);
  }
  anchors["outer-shell"] = at(pos[terminalIdx], R[terminalIdx].outer, bestDeg);
  if (full && R.some((r) => r.inner.length)) {
    const i = R.findIndex((r) => r.inner.length);
    anchors["inner-shells"] = at(pos[i], R[i].inner.at(-1)!, 225);
  }

  const crossAtom = info.atoms.find((a) => a.cross)!.symbol, dotAtom = info.atoms.find((a) => !a.cross)?.symbol ?? crossAtom;
  const sameElement = crossAtom === dotAtom;
  const names: Record<string, string> = {
    "shared-pair": "Shared pair (covalent bond)",
    "double-bond": "Double bond (two shared pairs)",
    "triple-bond": "Triple bond (three shared pairs)",
    "lone-pair": "Lone pair",
    "outer-shell": `Outer shell of ${nameOf(info.atoms[terminalIdx].symbol)}`,
    "inner-shells": "Inner shells",
    "electron-a": sameElement ? `Electron from left ${crossAtom} (×)` : `Electron from ${crossAtom} (×)`,
    "electron-b": sameElement ? `Electron from right ${dotAtom} (•)` : `Electron from ${dotAtom} (•)`,
  };
  for (const [id, p] of Object.entries(anchors)) sk.part(id, names[id], p);
}

function drawIonic(info: IonicInfo, full: boolean, transfer: boolean, sk: Sketch) {
  const { cation, anion } = info;
  // Arrange the ions: one ion with several partners in the middle; otherwise a row, alternating.
  type Ion = { cat: boolean; c: Pt; sym: string };
  const ions: Ion[] = [];
  const nC = cation.count, nA = anion.count;
  const minority = nC <= nA ? "cat" : "an";
  const order: boolean[] = [];
  if (Math.min(nC, nA) === 1) {
    const many = Math.max(nC, nA);
    const centreCat = minority === "cat";
    if (many === 1) order.push(true, false);
    else if (many === 2) order.push(!centreCat, centreCat, !centreCat);
    else order.push(!centreCat, centreCat, !centreCat, !centreCat); // centre, then W, E, S below
  } else {
    // 2:3 or 3:2 — alternate along a row, the larger count at both ends.
    const big = nC > nA;
    for (let k = 0; k < nC + nA; k++) order.push(k % 2 === 0 ? big : !big);
  }
  const rC = radiiFor(cation.symbol, full).outer, rA = radiiFor(anion.symbol, full).outer;
  const step = Math.max(rC, rA) * 2 + (transfer ? 78 : 76);
  if (order.length === 5) {
    // 2:3 — the three in a row, the two between and below them.
    const three = order.filter((c) => c === order[0]).length === 3 ? order[0] : !order[0];
    [0, 1, 2].forEach((k) => ions.push({ cat: three, c: { x: k * step, y: 0 }, sym: "" }));
    [0, 1].forEach((k) => ions.push({ cat: !three, c: { x: (k + 0.5) * step, y: step * 0.92 }, sym: "" }));
  } else if (order.length === 4) {
    ions.push({ cat: order[0], c: { x: -step, y: 0 }, sym: "" }, { cat: order[1], c: { x: 0, y: 0 }, sym: "" }, { cat: order[2], c: { x: step, y: 0 }, sym: "" }, { cat: order[3], c: { x: 0, y: step * 0.9 }, sym: "" });
  } else order.forEach((cat, k) => ions.push({ cat, c: { x: k * step, y: 0 }, sym: "" }));
  ions.forEach((ion) => (ion.sym = ion.cat ? cation.symbol : anion.symbol));

  // Which cation gives how many electrons to which anion: nearest first.
  const left = ions.map((ion) => (ion.cat ? cation.charge : 0));
  const gifts: Array<{ from: number; to: number }> = [];
  ions.forEach((ion, ai) => {
    if (ion.cat) return;
    for (let k = 0; k < anion.gained; k++) {
      const from = ions.map((o, i) => ({ o, i })).filter(({ o, i }) => o.cat && left[i] > 0).sort((p, q) => dist(p.o.c, ion.c) - dist(q.o.c, ion.c))[0];
      if (!from) break;
      left[from.i]--;
      gifts.push({ from: from.i, to: ai });
    }
  });

  const anchors: Record<string, Pt> = {};
  const names: Record<string, string> = {};
  let outerShellAt: Pt | undefined;
  const vacancy = new Map<string, Pt>(); // gift index → where the gained electron sits
  const giftKey = (g: number) => String(g);
  const leftmost = (cat: boolean) => ions.map((o, i) => ({ o, i })).filter(({ o }) => o.cat === cat).sort((p, q) => p.o.c.x - q.o.c.x || p.o.c.y - q.o.c.y);

  ions.forEach((ion, i) => {
    const r = ion.cat ? rC : rA;
    const radii = radiiFor(ion.sym, full);
    const isFirstAnion = !ion.cat && leftmost(false)[0].i === i;
    const isFirstCation = ion.cat && leftmost(true)[0].i === i;
    sk.circle(ion.c, r, { fill: "none", stroke: "ink", width: 2, part: isFirstAnion ? "outer-shell" : ion.cat && isFirstCation ? (transfer ? "metal-atom" : "positive-ion") : undefined }, false);
    sk.text(ion.c, ion.sym, 22, "ink");
    if (ion.cat) {
      const own = transfer ? shellsOf(zOf(ion.sym)) : shellsOf(zOf(ion.sym) - cation.charge);
      const outerN = own.at(-1) ?? 0;
      if (full && radii.inner.length) {
        // The shells below the drawn outer one.
        const innerCount = transfer ? own.slice(0, -1) : own.slice(0, -1);
        innerShells(sk, ion.c, innerCount, radii.inner.slice(-innerCount.length), true, transfer ? "metal-atom" : "positive-ion");
      }
      if (transfer) {
        // The metal's outer electrons, each on the side facing the anion it goes to.
        const mine = gifts.map((g, gi) => ({ g, gi })).filter(({ g }) => g.from === i);
        const byTarget = new Map<number, number[]>();
        mine.forEach(({ g, gi }) => byTarget.set(g.to, [...(byTarget.get(g.to) ?? []), gi]));
        for (const [to, list] of byTarget) {
          const base = angleTo(ion.c, ions[to].c);
          list.forEach((gi, k) => {
            const deg = base + (k - (list.length - 1) / 2) * 34;
            const p = at(ion.c, r, deg);
            const op = electron(sk, p, true, "metal-atom");
            vacancy.set(`from${gi}`, p);
            if (gi === gifts.length - 1) {
              retag(sk, op, "electron-a");
              anchors["electron-a"] = p;
            }
          });
        }
      } else {
        const per = [0, 1, 2, 3].map((j) => Math.floor(outerN / 4) + (j < outerN % 4 ? 1 : 0));
        [90, 270, 0, 180].forEach((deg, j) => {
          if (per[j] === 1) electron(sk, at(ion.c, r, deg), true, "positive-ion");
          else if (per[j] === 2) for (const p of pairAt(ion.c, r, deg)) electron(sk, p, true, "positive-ion");
        });
      }
    } else {
      if (full && radii.inner.length) innerShells(sk, ion.c, shellsOf(zOf(ion.sym)).slice(0, -1), radii.inner, false, "negative-ion");
      // Four sites; the half-filled ones face the cations that give the electrons.
      const mine = gifts.map((g, gi) => ({ g, gi })).filter(({ g }) => g.to === i);
      // Transfer: the gaps face the giving atoms (the arrows are short). Ions: the gained electrons sit
      // on the ion's outer side, where a label's leader reaches them without crossing the other ion.
      const centre = { x: ions.reduce((s2, o) => s2 + o.c.x, 0) / ions.length, y: ions.reduce((s2, o) => s2 + o.c.y, 0) / ions.length };
      const outward = dist(ion.c, centre) < 1 ? 270 : angleTo(centre, ion.c);
      const dirs = mine.map(({ g }, k) => (transfer ? angleTo(ion.c, ions[g.from].c) : outward + (k - (mine.length - 1) / 2) * 60));
      let best: { rot: number; assign: number[]; cost: number } | null = null;
      for (const rot of [0, 45, 22.5, 67.5]) {
        const sites = [90, 0, 270, 180].map((s) => norm(s + rot));
        const perms = (k: number, used: number[]): number[][] => (k === dirs.length ? [used] : sites.flatMap((_, s) => (used.includes(s) ? [] : perms(k + 1, [...used, s]))));
        for (const assign of perms(0, [])) {
          const cost = assign.reduce((s, site, k) => s + angDiff(sites[site], dirs[k]), 0) + (rot % 45 ? 4 : 0);
          if (!best || cost < best.cost) best = { rot, assign, cost };
        }
      }
      const sites = [90, 0, 270, 180].map((s) => norm(s + best!.rot));
      const half = new Set(best!.assign);
      // Sites the cations did not fill but that are half-filled anyway (fewer givers drawn than gaps).
      const extraHalf = anion.gained - half.size;
      for (let s = 0, e = 0; s < 4 && e < extraHalf; s++) if (!half.has(s)) (half.add(s), e++);
      const own: Array<{ p: Pt; op: number; site: number; deg: number }> = [];
      const gainedEls: Array<{ p: Pt; op: number; site: number; deg: number }> = [];
      const basePart = transfer ? "non-metal-atom" : "negative-ion";
      sites.forEach((deg, s) => {
        const [p, q] = pairAt(ion.c, r, deg);
        own.push({ p, op: electron(sk, p, false, basePart), site: s, deg });
        if (!half.has(s)) own.push({ p: q, op: electron(sk, q, false, basePart), site: s, deg });
        else {
          const k = best!.assign.indexOf(s);
          const gi = k >= 0 ? mine[k].gi : -1;
          if (gi >= 0) vacancy.set(giftKey(gi), q);
          if (!transfer) gainedEls.push({ p: q, op: electron(sk, q, true, basePart), site: s, deg });
        }
      });
      if (isFirstAnion) {
        // The labelled electrons and the bare stretch of shell, on the ion's outer side.
        const ext = ions.length > 1 ? (ion.c.x <= Math.min(...ions.filter((o) => o !== ion).map((o) => o.c.x)) ? 180 : ion.c.x >= Math.max(...ions.filter((o) => o !== ion).map((o) => o.c.x)) ? 0 : 270) : 0;
        const byOut = <T extends { deg: number }>(l: T[]) => [...l].sort((x, y) => angDiff(x.deg, ext) - angDiff(y.deg, ext));
        const g = byOut(gainedEls)[0];
        if (g) {
          retag(sk, g.op, "electron-a");
          anchors["electron-a"] = g.p;
        }
        const o = byOut(own.filter((e) => !g || e.site !== g.site))[0] ?? own[0];
        retag(sk, o.op, "electron-b");
        anchors["electron-b"] = o.p;
        const used = [g?.deg, o.deg].filter((d): d is number => d !== undefined);
        const bare = sites.map((d) => norm(d + 45)).sort((x, y) => angDiff(x, ext + 30) - angDiff(y, ext + 30)).find((d) => used.every((u) => angDiff(u, d) > 30)) ?? norm(sites[0] + 45);
        outerShellAt = at(ion.c, r, bare);
      }
    }
    // Brackets and charge (ions only).
    const half = r + 13;
    if (!transfer) {
      const part = ion.cat ? "positive-ion" : "negative-ion";
      const l = ion.c.x - half, rt = ion.c.x + half, t = ion.c.y - half, b = ion.c.y + half;
      sk.path([{ k: "M", p: { x: l + 11, y: t } }, { k: "L", p: { x: l, y: t } }, { k: "L", p: { x: l, y: b } }, { k: "L", p: { x: l + 11, y: b } }], false, { stroke: "ink", width: 2.6, fill: "none", part });
      sk.path([{ k: "M", p: { x: rt - 11, y: t } }, { k: "L", p: { x: rt, y: t } }, { k: "L", p: { x: rt, y: b } }, { k: "L", p: { x: rt - 11, y: b } }], false, { stroke: "ink", width: 2.6, fill: "none", part });
      const charge = ion.cat ? cation.charge : anion.charge;
      const txt = chargeText(charge);
      const tc = { x: rt + 6 + txt.length * 7, y: t + 6 };
      const isCharge = !ion.cat && isFirstAnion;
      sk.text(tc, txt, 24, "ink", isCharge ? "charge" : part);
      if (isCharge) anchors.charge = { x: tc.x - txt.length * 7 - 2, y: tc.y + 10 };
    }
    if (ion.cat && isFirstCation && transfer) anchors["metal-atom"] = at(ion.c, r, 90);
    if (!ion.cat && isFirstAnion) {
      if (transfer) anchors["non-metal-atom"] = at(ion.c, r, ion.c.x <= Math.min(...ions.map((o) => o.c.x)) ? 225 : 315);
      if (outerShellAt) anchors["outer-shell"] = outerShellAt;
    }
  });
  if (!transfer) {
    // Ion anchors on the bracket, on the side a leader comes from.
    const a = ions[leftmost(false)[0].i], c = ions[leftmost(true)[0].i];
    const aLeft = a.c.x <= c.c.x;
    anchors["negative-ion"] = { x: a.c.x + (aLeft ? -(rA + 13) : rA + 13), y: a.c.y + rA * 0.55 };
    anchors["positive-ion"] = { x: c.c.x + (aLeft ? rC + 13 : -(rC + 13)), y: c.c.y + rC * 0.55 };
  }

  // Transfer arrows: from each metal electron to the gap it fills.
  if (transfer) {
    gifts.forEach((g, gi) => {
      const from = vacancy.get(`from${gi}`), to = vacancy.get(giftKey(gi));
      if (!from || !to) return;
      const u = unit(sub(to, from));
      let n = perp(u);
      if (n.y > 0 || (n.y === 0 && n.x < 0)) n = mul(n, -1); // bulge upwards (or rightwards)
      const ctl = add(lerp(from, to, 0.5), mul(n, Math.max(34, dist(from, to) * 0.45)));
      const s = add(from, mul(unit(sub(ctl, from)), 9)), e = add(to, mul(unit(sub(ctl, to)), 9));
      const pts: Pt[] = [];
      for (let k = 0; k <= 24; k++) {
        const t = k / 24;
        pts.push(add(add(mul(s, (1 - t) ** 2), mul(ctl, 2 * t * (1 - t))), mul(e, t * t)));
      }
      sk.line(pts, { stroke: PALETTE.amber, width: 2.4, part: "electron-transfer" }, false);
      const tip = pts[pts.length - 1], back = pts[pts.length - 4];
      const du = unit(sub(tip, back)), dn = perp(du);
      sk.polygon([tip, add(add(tip, mul(du, -11)), mul(dn, 5)), add(add(tip, mul(du, -11)), mul(dn, -5))], { fill: PALETTE.amber, stroke: PALETTE.amber, width: 1, part: "electron-transfer" }, false);
      if (gi === gifts.length - 1) anchors["electron-transfer"] = pts[12];
    });
  }

  const cName = `${cation.name} ${transfer ? "atom" : "ion"}`;
  Object.assign(names, {
    "positive-ion": `${cation.name} ion, ${cation.symbol}${supCharge(cation.charge)}`,
    "negative-ion": `${anion.name} ion, ${anion.symbol}${supCharge(anion.charge)}`,
    "metal-atom": `${cName}, ${cation.symbol}`,
    "non-metal-atom": `${NAMES[zOf(anion.symbol) - 1][0].toUpperCase()}${NAMES[zOf(anion.symbol) - 1].slice(1)} atom, ${anion.symbol}`,
    charge: `Charge ${chargeText(anion.charge)}`,
    "outer-shell": transfer ? `Outer shell (${anion.ownOuter} electrons)` : "Full outer shell (8 electrons)",
    "electron-a": transfer ? `Outer electron of ${cation.symbol} (×)` : `Electron gained from ${cation.symbol} (×)`,
    "electron-b": `Electron from ${anion.symbol} (•)`,
    "electron-transfer": "Electron transferred",
  });
  for (const [id, p] of Object.entries(anchors)) if (names[id]) sk.part(id, names[id], p);
}

export const bonding: FigureComponent = {
  name: "bonding",
  title: "Dot-and-cross bonding diagram: ionic (ions in brackets with charges, or electron transfer) or covalent (shared pairs, double/triple bonds, lone pairs)",
  params: `formula (formula or name of a simple ionic compound or molecule, e.g. "NaCl", "MgO", "CaCl2", "Na2O", "Al2O3", "Mg3N2", "H2", "Cl2", "HCl", "H2O", "NH3", "CH4", "CO2", "O2", "N2", "C2H4", "C2H6", "HCN", "CCl4", "water"; default "NaCl"), style ("outer" — outer shells only, default — or "full": every shell), show (ionic only: "ions" — the ions in square brackets with charges, default — or "transfer": the atoms with arrows for the electrons moving from metal to non-metal). Code decides ionic or covalent, the charges, the ion counts, the bonds and lone pairs; × = electrons of the first (central or metal) atom, • = the other atom's.`,
  match: /^(?![\s\S]*\b(osmosis|water potential|diffusion|active transport)\b)[\s\S]*?\b(dot[- ](and|&)[- ]cross|ionic bond(ing|s)?|covalent bond(ing|s)?|electron transfer (in|between)|shared pairs? of electrons|lone pairs?|(single|double|triple) (covalent )?bonds?|formation of (an? )?ions?|bonding diagram)\b/i,
  parts: [
    { id: "shared-pair", name: "Shared pair of electrons" },
    { id: "double-bond", name: "Double bond" },
    { id: "triple-bond", name: "Triple bond" },
    { id: "lone-pair", name: "Lone pair" },
    { id: "outer-shell", name: "Outer shell" },
    { id: "inner-shells", name: "Inner shells" },
    { id: "electron-a", name: "Electron from atom A (×)" },
    { id: "electron-b", name: "Electron from atom B (•)" },
    { id: "positive-ion", name: "Positive ion" },
    { id: "negative-ion", name: "Negative ion" },
    { id: "charge", name: "Ion charge" },
    { id: "metal-atom", name: "Metal atom" },
    { id: "non-metal-atom", name: "Non-metal atom" },
    { id: "electron-transfer", name: "Electron transferred" },
  ],
  build(params: FigureParams) {
    const info = bondingInfo(params) as BondingInfo & { unsupported?: boolean };
    if (info.unsupported) return { w: 400, h: 300, shapes: [], parts: [] };
    const full = /full|all|every/i.test(String(params.style ?? params.shells ?? ""));
    const transfer = info.kind === "ionic" && /transfer|atoms|arrow|before|form/i.test(String(params.show ?? params.view ?? params.stage ?? ""));
    const sk = new Sketch();
    if (info.kind === "covalent") drawCovalent(info, full, sk);
    else drawIonic(info, full, transfer, sk);
    // The formula beneath, as the notation.
    const b = sk.bounds();
    sk.text({ x: b.x + b.w / 2, y: b.y + b.h + 30 }, subFormula(info.formula), 24, "ink");
    return sk.finish(14);
  },
};
