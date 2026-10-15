import type { FigureComponent, FigureParams, FigureShape, Pt } from "../types";

const SUB: Record<string, string> = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉" };
/** A name or formula; digits after an element or bracket become subscripts (N2 + 3H2 → N₂ + 3H₂). */
const formula = (v: unknown, fallback: string) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, 34).replace(/([A-Z][a-z]?|\))(\d+)/g, (_, el: string, d: string) => el + [...d].map((c) => SUB[c]).join("")) : fallback;
const num = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return undefined;
  const m = v.replace(/−/g, "-").replace(/\s+/g, "").match(/^[+-]?\d+(\.\d+)?/);
  return m ? Number(m[0]) : undefined;
};
const fmt = (n: number, sign = false) => `${n < 0 ? "−" : sign ? "+" : ""}${Math.abs(Math.round(n * 10) / 10)} kJ/mol`;

export type EnergyLevels = { exothermic: boolean; dH: number; ea: number; eaCat?: number; dHGiven: boolean; eaGiven: boolean; yR: number; yP: number; yPeak: number; yCat?: number };

/**
 * The reaction's energies, made consistent: the sign of ΔH follows the type (exothermic → negative,
 * products below reactants), the activation energy clears both levels, a catalyst's peak lies between
 * the higher level and the uncatalysed peak. Heights are proportional to energy, with minimum gaps so
 * every arrow is long enough to read.
 */
export function energyLevels(params: FigureParams): EnergyLevels {
  const typeWord = String(params.type ?? "").toLowerCase();
  const dHRaw = num(params.dH ?? params.deltaH ?? params.enthalpy);
  const exothermic = /endo/.test(typeWord) ? false : /exo/.test(typeWord) ? true : dHRaw !== undefined ? dHRaw < 0 || dHRaw === 0 : true;
  const mag = dHRaw !== undefined && Math.abs(dHRaw) > 0 ? Math.min(Math.abs(dHRaw), 100000) : 100;
  const dH = exothermic ? -mag : mag;
  const eaRaw = num(params.Ea ?? params.ea ?? params.activationEnergy);
  // Activation energy is measured from the reactants and must top the higher of the two levels.
  const floor = Math.max(0, dH);
  const eaGiven = eaRaw !== undefined && eaRaw > floor;
  const ea = eaGiven ? eaRaw! : Math.round(floor + Math.max(60, mag * 0.6));
  const catalysed = params.catalysed !== false && params.catalyzed !== false && !/^(false|no|none)$/i.test(String(params.catalysed ?? ""));
  const catRaw = num(params.EaCat ?? params.eaCat ?? params.catalysedEa);
  const eaCat = !catalysed ? undefined : catRaw !== undefined && catRaw > floor && catRaw < ea ? catRaw : floor + (ea - floor) * 0.5;

  // Pixel heights above the lowest level: proportional, with minimum gaps.
  const k = 1 / (ea - Math.min(0, dH));
  const pR = 0;
  const pP = Math.sign(dH) * Math.max(Math.abs(dH) * k, 0.24);
  const top = Math.max(pR, pP);
  const pPeak = Math.max(ea * k, top + 0.22);
  const lo = Math.min(pR, pP);
  const span = pPeak - lo;
  const Y_BOTTOM = 372, Y_TOP = 86;
  const y = (p: number) => Y_BOTTOM - ((p - lo) / span) * (Y_BOTTOM - Y_TOP);
  let yCat: number | undefined;
  if (eaCat !== undefined) {
    const pCat = Math.min(Math.max(eaCat * k, top + (pPeak - top) * 0.3), pPeak - (pPeak - top) * 0.3);
    yCat = y(pCat);
  }
  return { exothermic, dH, ea, eaCat, dHGiven: dHRaw !== undefined && dHRaw !== 0, eaGiven, yR: y(pR), yP: y(pP), yPeak: y(pPeak), yCat };
}

function arrow(from: Pt, to: Pt, colour: `#${string}`, part: string, both = false): FigureShape[] {
  const head = (tip: Pt, tail: Pt) => {
    const dir = Math.sign(tip.y - tail.y) || 1;
    return `M${tip.x} ${tip.y} l-6 ${-dir * 11} h12 Z`;
  };
  const out: FigureShape[] = [{ t: "path", part, d: `M${from.x} ${from.y} L${to.x} ${to.y}`, stroke: colour, width: 2.4, fill: "none" }];
  out.push({ t: "path", part, d: head(to, from), stroke: colour, width: 1, fill: colour });
  if (both) out.push({ t: "path", part, d: head(from, to), stroke: colour, width: 1, fill: colour });
  return out;
}

/**
 * Reaction energy profile: energy against progress of reaction, reactants and products as level
 * plateaus joined by a hump through the transition state; the activation energy arrow from the
 * reactants up to the peak, the ΔH arrow from reactants to products (down when exothermic, up when
 * endothermic), with their values; optionally the lower dashed catalysed path.
 */
export const energyProfile: FigureComponent = {
  name: "energyProfile",
  title: "Reaction energy profile diagram: reactants and products levels, activation energy hump, ΔH arrow, optional catalysed path",
  params: `type ("exothermic" — default — or "endothermic"), reactants and products (names or formulas, e.g. "N2 + 3H2", "2NH3"), dH (ΔH in kJ/mol, e.g. -92; its sign follows the type), Ea (activation energy in kJ/mol from the reactants, e.g. 230), catalysed (true — default — adds the lower dashed catalysed hump; false for none), EaCat (optional catalysed activation energy). Values are only written when given; code keeps levels and arrows consistent with the signs.`,
  match: /\b(energy (level |profile )?diagrams?|reaction (energy )?profiles?|energy profiles?|activation energy|exothermic|endothermic|enthalpy (change|diagram)|transition state)\b/i,
  parts: [
    { id: "reactants", name: "Reactants" },
    { id: "products", name: "Products" },
    { id: "activation-energy", name: "Activation energy" },
    { id: "enthalpy-change", name: "Enthalpy change (ΔH)" },
    { id: "transition-state", name: "Transition state" },
    { id: "catalysed-path", name: "Catalysed pathway" },
  ],
  build(params: FigureParams) {
    const L = energyLevels(params);
    const reactants = formula(params.reactants, "Reactants");
    const products = formula(params.products, "Products");
    const w = 640, h = 448;
    const O = { x: 50, y: 404 };
    const xs = { r0: 70, r1: 200, peak: 330, p0: 460, p1: 600, ea: 122, dH: 560 };
    const shapes: FigureShape[] = [];
    // Axes, with their titles (axis titles are part of the graph's notation).
    shapes.push({ t: "path", d: `M${O.x} 30 V${O.y} H${w - 16}`, stroke: "ink", width: 2.4, fill: "none" });
    shapes.push({ t: "path", d: `M${O.x} 22 l-6 12 h12 Z M${w - 8} ${O.y} l-12 -6 v12 Z`, stroke: "ink", width: 1, fill: "ink" });
    shapes.push({ t: "text", x: O.x + 12, y: 30, text: "Energy", size: 21, anchor: "start" });
    shapes.push({ t: "text", x: (O.x + w) / 2, y: O.y + 32, text: "Progress of reaction", size: 21, anchor: "middle" });

    const hump = (yPk: number) => `M${xs.r1} ${L.yR} C${xs.r1 + 70} ${L.yR} ${xs.peak - 60} ${yPk} ${xs.peak} ${yPk} C${xs.peak + 60} ${yPk} ${xs.p0 - 70} ${L.yP} ${xs.p0} ${L.yP}`;
    // Guide lines: the reactants' level carried across (ΔH and Ea are measured from it), the peak's height.
    shapes.push({ t: "path", d: `M${xs.r1} ${L.yR} H${xs.dH + 14}`, stroke: "muted", width: 1.4, dash: "6 5", fill: "none" });
    shapes.push({ t: "path", d: `M${xs.ea - 10} ${L.yPeak} H${xs.peak}`, stroke: "muted", width: 1.4, dash: "6 5", fill: "none" });
    // The catalysed path under the uncatalysed one.
    if (L.yCat !== undefined) shapes.push({ t: "path", part: "catalysed-path", d: hump(L.yCat), stroke: "#2563eb", width: 2.6, dash: "9 6", fill: "none" });
    shapes.push({ t: "path", part: "transition-state", d: hump(L.yPeak), stroke: "ink", width: 3, fill: "none" });
    shapes.push({ t: "path", part: "reactants", d: `M${xs.r0} ${L.yR} H${xs.r1}`, stroke: "ink", width: 4, fill: "none" });
    shapes.push({ t: "path", part: "products", d: `M${xs.p0} ${L.yP} H${xs.p1}`, stroke: "ink", width: 4, fill: "none" });

    // Activation energy: reactants up to the peak.
    shapes.push(...arrow({ x: xs.ea, y: L.yR }, { x: xs.ea, y: L.yPeak }, "#d97706", "activation-energy"));
    const eaMid = (L.yR + L.yPeak) / 2;
    shapes.push({ t: "text", part: "activation-energy", x: xs.ea + 10, y: eaMid + (L.eaGiven ? -2 : 6), text: "Ea", size: 23, anchor: "start", fill: "#d97706" });
    if (L.eaGiven) shapes.push({ t: "text", part: "activation-energy", x: xs.ea + 10, y: eaMid + 20, text: fmt(L.ea), size: 18, anchor: "start", fill: "#d97706" });
    // Enthalpy change: reactants to products (down when exothermic).
    shapes.push(...arrow({ x: xs.dH, y: L.yR }, { x: xs.dH, y: L.yP }, "#16a34a", "enthalpy-change"));
    const dHMid = (L.yR + L.yP) / 2;
    shapes.push({ t: "text", part: "enthalpy-change", x: xs.dH - 10, y: dHMid + (L.dHGiven ? -2 : 6), text: "ΔH", size: 23, anchor: "end", fill: "#16a34a" });
    if (L.dHGiven) shapes.push({ t: "text", part: "enthalpy-change", x: xs.dH - 10, y: dHMid + 20, text: fmt(L.dH, true), size: 18, anchor: "end", fill: "#16a34a" });

    const parts = [
      { id: "reactants", name: reactants, anchor: { x: 84, y: L.yR } },
      { id: "products", name: products, anchor: { x: 590, y: L.yP } },
      { id: "activation-energy", name: "Activation energy", anchor: { x: xs.ea, y: eaMid + (L.yR - L.yPeak) * 0.3 } },
      { id: "enthalpy-change", name: "Enthalpy change, ΔH", anchor: { x: xs.dH, y: dHMid + (L.yP - L.yR) * 0.3 } },
      { id: "transition-state", name: "Transition state", anchor: { x: xs.peak, y: L.yPeak } },
    ];
    if (L.yCat !== undefined) {
      // A point on the descending side of the catalysed curve, clear of the uncatalysed one.
      parts.push({ id: "catalysed-path", name: "With a catalyst", anchor: { x: xs.peak, y: L.yCat } });
    }
    return { w, h, shapes, parts };
  },
};
