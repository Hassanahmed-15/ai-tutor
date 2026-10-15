import type { FigureComponent, FigureParams, FigurePart, FigureShape, Pt } from "../types";

/** Z = index + 1: symbol, name, mass number of the commonest isotope (the GCSE/IGCSE table values; Cl as 35). */
const ELEMENTS: Array<[string, string, number]> = [
  ["H", "hydrogen", 1], ["He", "helium", 4], ["Li", "lithium", 7], ["Be", "beryllium", 9], ["B", "boron", 11],
  ["C", "carbon", 12], ["N", "nitrogen", 14], ["O", "oxygen", 16], ["F", "fluorine", 19], ["Ne", "neon", 20],
  ["Na", "sodium", 23], ["Mg", "magnesium", 24], ["Al", "aluminium", 27], ["Si", "silicon", 28], ["P", "phosphorus", 31],
  ["S", "sulfur", 32], ["Cl", "chlorine", 35], ["Ar", "argon", 40], ["K", "potassium", 39], ["Ca", "calcium", 40],
];
const ALIASES: Record<string, number> = { aluminum: 13, sulphur: 16 };
const ORDINAL = ["First", "Second", "Third", "Fourth"];
const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "+": "⁺", "-": "⁻", "−": "⁻" };
const sup = (s: string) => [...s].map((c) => SUP[c] ?? c).join("");

export type AtomInfo = { z: number; symbol: string; name: string; mass: number; protons: number; neutrons: number; charge: number; electrons: number; shells: number[] };

/** Which element (symbol, name or atomic number, optionally with an ion charge written on it: "Cl-", "Mg2+"). */
function parseElement(v: unknown): { z: number; charge?: number } | null {
  if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= ELEMENTS.length) return { z: v };
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^([A-Za-z]+|\d+)\s*(?:(\d?)\s*([+\-−])|([+\-−])\s*(\d?))?(?:\s*ion)?$/);
  if (!m) return null;
  const key = m[1];
  let z = -1;
  if (/^\d+$/.test(key)) z = Number(key);
  else {
    const lower = key.toLowerCase();
    z = ELEMENTS.findIndex(([sym, name]) => sym.toLowerCase() === lower && (key.length <= 2) || name === lower) + 1;
    if (z <= 0) z = ALIASES[lower] ?? -1;
    if (z <= 0) z = ELEMENTS.findIndex(([, name]) => lower.startsWith(name.slice(0, 5)) && lower.length > 3) + 1; // "chloride", "sodium ion"
  }
  if (!(z >= 1 && z <= ELEMENTS.length)) return null;
  const sign = m[3] ?? m[4];
  if (!sign) return { z };
  const n = Number(m[2] || m[5] || 1);
  return { z, charge: (sign === "+" ? 1 : -1) * n };
}

function parseCharge(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v !== "string" || !v.trim()) return undefined;
  const s = v.trim().replace("−", "-");
  let m = s.match(/^([+-])\s*(\d*)$/);
  if (m) return (m[1] === "+" ? 1 : -1) * Number(m[2] || 1);
  m = s.match(/^(\d+)\s*([+-])$/);
  if (m) return (m[2] === "+" ? 1 : -1) * Number(m[1]);
  return Number.isFinite(Number(s)) ? Math.round(Number(s)) : undefined;
}

/** The atom's science: protons from Z, neutrons = A − Z, electrons = Z − charge, shells filled 2, 8, 8, then the 4th. */
export function atomInfo(params: FigureParams): AtomInfo {
  const parsed = parseElement(params.element ?? params.atomicNumber ?? params.symbol) ?? { z: 19 };
  const [symbol, name, tableMass] = ELEMENTS[parsed.z - 1];
  const z = parsed.z;
  const massParam = Number(params.mass);
  const mass = Number.isInteger(massParam) && massParam >= z && massParam <= 3 * z + 2 ? massParam : tableMass;
  let charge = parseCharge(params.charge) ?? parsed.charge ?? 0;
  charge = Math.max(-3, Math.min(Math.min(3, z), charge));
  const electrons = Math.max(0, Math.min(20, z - charge));
  charge = z - electrons;
  const shells: number[] = [];
  let left = electrons;
  for (const cap of [2, 8, 8, 18]) {
    if (left <= 0) break;
    shells.push(Math.min(cap, left));
    left -= Math.min(cap, left);
  }
  return { z, symbol, name, mass, protons: z, neutrons: mass - z, charge, electrons, shells };
}

const chargeText = (c: number) => (c === 0 ? "" : `${Math.abs(c) === 1 ? "" : Math.abs(c)}${c > 0 ? "+" : "−"}`);

/**
 * An atom or simple ion (Z 1–20): a nucleus with its proton and neutron counts, the electron shells
 * filled 2, 8, 8, 2 as GCSE draws them (electrons at the four compass points, singly then in pairs),
 * the arrangement written beneath. Ions in square brackets with their charge; in dot-and-cross style
 * the electrons are crosses and any gained electrons dots.
 */
export const atomicStructure: FigureComponent = {
  name: "atomicStructure",
  title: "Atomic structure (Bohr model): nucleus with protons and neutrons, electron shells filled 2,8,8,2, or a dot-and-cross ion",
  params: `element (symbol, name or atomic number 1-20, e.g. "Na", "chlorine", 12; may carry an ion charge: "Cl-", "Mg2+"), charge (optional ion charge, e.g. 1, -1, "2+"; electrons = protons − charge), mass (optional mass number for an isotope, e.g. 37 for Cl-37), style ("shells": dots on shells with p/n counts in the nucleus — default; "dot-cross": crosses for the atom's own electrons, dots for gained ones, symbol in the nucleus). Code computes protons, neutrons and the electron arrangement.`,
  match: /\b(atomic structure|electron(ic)? (arrangement|configuration|shells?)|electron shells?|bohr (model|diagram)|energy levels? of (an )?atom|protons?,? neutrons? and electrons|dot[- ]and[- ]cross diagram of an? (ion|atom))\b/i,
  parts: [
    { id: "nucleus", name: "Nucleus" },
    { id: "nucleons", name: "Protons and neutrons" },
    { id: "shell-1", name: "First shell" },
    { id: "shell-2", name: "Second shell" },
    { id: "shell-3", name: "Third shell" },
    { id: "shell-4", name: "Fourth shell" },
    { id: "outer-electrons", name: "Outer electrons" },
  ],
  build(params: FigureParams) {
    const a = atomInfo(params);
    const dotCross = String(params.style ?? "").toLowerCase().replace(/[^a-z]/g, "").startsWith("dot");
    const nucleusR = dotCross ? 26 : 32;
    const radii = a.shells.map((_, i) => 66 + i * 40);
    const outerR = radii.length ? radii[radii.length - 1] : nucleusR;
    const ion = a.charge !== 0;
    const pad = 22, bracket = ion ? 12 : 0;
    const half = Math.max(outerR + pad + bracket, 120);
    const w = 2 * half + (ion ? 30 : 0), h = 2 * half + 50;
    const c: Pt = { x: half, y: half };
    const shapes: FigureShape[] = [];
    const parts: FigurePart[] = [];

    // Nucleus.
    shapes.push({ t: "circle", part: "nucleus", cx: c.x, cy: c.y, r: nucleusR, fill: "#dc2626", stroke: "ink", width: 2, opacity: 0.9 });
    shapes.push({ t: "circle", part: "nucleus", cx: c.x, cy: c.y, r: nucleusR, fill: "none", stroke: "ink", width: 2 });
    if (dotCross) shapes.push({ t: "text", part: "nucleons", x: c.x, y: c.y + 8, text: a.symbol, size: 23, anchor: "middle", fill: "paper" });
    else {
      shapes.push({ t: "text", part: "nucleons", x: c.x, y: c.y - 3, text: `${a.protons}p`, size: 16, anchor: "middle", fill: "paper" });
      shapes.push({ t: "text", part: "nucleons", x: c.x, y: c.y + 15, text: `${a.neutrons}n`, size: 16, anchor: "middle", fill: "paper" });
    }
    const at = (r: number, deg: number): Pt => ({ x: c.x + r * Math.cos((deg * Math.PI) / 180), y: c.y - r * Math.sin((deg * Math.PI) / 180) });
    parts.push({ id: "nucleus", name: "Nucleus", anchor: at(nucleusR * 0.86, 240) });
    parts.push({ id: "nucleons", name: `${a.protons} proton${a.protons === 1 ? "" : "s"}, ${a.neutrons} neutron${a.neutrons === 1 ? "" : "s"}`, anchor: dotCross ? { x: c.x + 2, y: c.y + 2 } : { x: c.x + 22, y: c.y + 6 } });

    // Shells and electrons: compass sites N, S, E, W filled singly, then paired. Gained electrons (an anion's
    // extra ones) are the last placed on the outer shell.
    const sites = [90, 270, 0, 180];
    const anchorAngles = [225, 45, 315, 135];
    let placed = 0;
    const own = Math.min(a.electrons, a.z);
    const outerIndex = a.shells.length - 1;
    a.shells.forEach((n, i) => {
      const r = radii[i];
      const id = `shell-${i + 1}`;
      shapes.push({ t: "circle", part: id, cx: c.x, cy: c.y, r, fill: "none", stroke: "ink", width: 1.8 });
      parts.push({ id, name: `${ORDINAL[i]} shell`, anchor: at(r, anchorAngles[i]) });
      // Electron k goes to site k mod 4; a site's electrons sit side by side along the shell.
      const count = sites.map((_, j) => Math.floor(n / 4) + (j < n % 4 ? 1 : 0));
      const spread = (19 / r) * (180 / Math.PI);
      const positions: number[] = [];
      for (let k = 0; k < n; k++) {
        const j = k % 4, slot = Math.floor(k / 4);
        positions.push(sites[j] + (slot - (count[j] - 1) / 2) * spread);
      }
      positions.forEach((deg, k) => {
        const p = at(r, deg);
        const gained = placed >= own;
        placed++;
        const part = i === outerIndex ? "outer-electrons" : id;
        if (dotCross && !gained) {
          const s = 6.5;
          shapes.push({ t: "path", part, d: `M${p.x - s} ${p.y - s} L${p.x + s} ${p.y + s} M${p.x + s} ${p.y - s} L${p.x - s} ${p.y + s}`, stroke: "#2563eb", width: 2.6, fill: "none" });
        } else if (dotCross) {
          shapes.push({ t: "circle", part, cx: p.x, cy: p.y, r: 6.5, fill: "#dc2626", stroke: "ink", width: 1.2 });
        } else {
          shapes.push({ t: "circle", part, cx: p.x, cy: p.y, r: 7.5, fill: "#2563eb", stroke: "ink", width: 1.4 });
        }
        const gainedHere = gained && dotCross;
        if (i === outerIndex && (gainedHere ? placed === own + 1 : k === 0 && !(dotCross && a.electrons > own))) {
          const name = gainedHere ? `Gained electron${a.electrons - own > 1 ? "s" : ""}` : ion ? `${n === 8 || (i === 0 && n === 2) ? "Full outer" : "Outer"} shell (${n} electrons)` : `${n} outer electron${n === 1 ? "" : "s"}`;
          parts.push({ id: "outer-electrons", name, anchor: p });
        }
      });
    });

    // An ion: square brackets and its charge.
    if (ion) {
      const top = c.y - outerR - pad, bottom = c.y + outerR + pad, l = c.x - outerR - pad, r = c.x + outerR + pad;
      shapes.push({ t: "path", d: `M${l + 12} ${top} H${l} V${bottom} H${l + 12} M${r - 12} ${top} H${r} V${bottom} H${r - 12}`, stroke: "ink", width: 2.6, fill: "none" });
      shapes.push({ t: "text", x: r + 6, y: top + 18, text: chargeText(a.charge), size: 24, anchor: "start" });
    }
    // The arrangement, written as the notation: "Na  2,8,1".
    const notation = `${a.symbol}${sup(chargeText(a.charge))}   ${a.shells.length ? a.shells.join(",") : "0 electrons"}`;
    shapes.push({ t: "text", x: c.x, y: h - 12, text: notation, size: 28, anchor: "middle" });
    return { w, h, shapes, parts };
  },
};
