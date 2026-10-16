import type { FigureComponent, FigureParams, FigurePart, FigureShape } from "../types";
import { r2 } from "./bioDraw";
import { bool, clamp, fmt, optNum } from "./mathsKit";

/**
 * STRIATED MUSCLE SARCOMERE, DRAWN FROM ITS LENGTH. A longitudinal view of one sarcomere (Z line to
 * Z line) with the neighbouring half I bands: thin actin filaments anchored on the zig-zag Z lines,
 * thick bipolar myosin filaments (heads pointing away from the bare zone) centred on the M line.
 * The filaments keep their real lengths (thick 1.6 µm, thin 0.95 µm) and slide: the code works out
 * the bands from the sarcomere length — A band = thick-filament length (constant), I band =
 * sarcomere − A band, H zone = sarcomere − 2 × thin — so a contracted board shows the I band and
 * H zone shorter and the A band unchanged, exactly as the sliding filament model says.
 */

/** Filament lengths in µm (vertebrate skeletal muscle, textbook values). */
export const THICK_UM = 1.6;
export const THIN_UM = 0.95;
const STUB_UM = 0.3; // the neighbouring sarcomeres' thick filaments, shown as short stubs
const PX = 118; // px per µm — fixed, so relaxed and contracted boards are drawn at the same scale

export type SarcomereBands = { sarcomere: number; aBand: number; iBand: number; hZone: number; overlap: number };

/** Band widths (µm) for a sarcomere length; the length is held where thin filaments do not yet collide (2.0–3.0 µm). */
export function sarcomereBands(length: number): SarcomereBands {
  const S = clamp(Number.isFinite(length) ? length : 2.8, 2.0, 3.0);
  const hZone = Math.max(0, S - 2 * THIN_UM);
  return { sarcomere: S, aBand: THICK_UM, iBand: S - THICK_UM, hZone, overlap: (THICK_UM - hZone) / 2 };
}

/** "contracted" → 2.2 µm, "relaxed" → 2.8 µm; an explicit length (µm) wins. */
export function sarcomereLength(params: FigureParams): number {
  const given = optNum(String(params.length ?? params.sarcomereLength ?? "").replace(/\s*(µm|um|micrometres?|microns?)$/i, ""));
  if (given !== undefined && given > 0) return sarcomereBands(given).sarcomere;
  return /contract|shorten/i.test(String(params.state ?? "")) ? 2.2 : 2.8;
}

const C = { actin: "#2563eb", actinFill: "#bfdbfe", myosin: "#dc2626", myosinFill: "#fecaca", aShade: "#fde68a" } as const;

export const sarcomere: FigureComponent = {
  name: "sarcomere",
  title: "Striated muscle sarcomere: Z lines, M line, overlapping thin actin and thick myosin filaments, with the A band, I band, H zone and sarcomere length bracketed",
  params: `state ("relaxed" default | "contracted"); length (optional sarcomere length in µm, 2.0–3.0, overrides state); values (true default: print each band's length in µm). Filament lengths are fixed (thick 1.6 µm, thin 0.95 µm) and every band width is computed from the sarcomere length — never give band widths. Contracted: I band and H zone shorter, A band unchanged.`,
  match: /\bsarcomeres?\b|\b(actin|myosin) (filaments?|heads?)\b|\b(thick|thin) filaments?\b|\bsliding[- ]filament\b|\b(A|I)[- ]bands?\b(?=[\s\S]{0,160}\b(muscle|sarcomere|myosin|actin|H[- ]zone|Z[- ]lines?)\b)|\bH[- ]zone\b|\bZ[- ](lines?|discs?)\b(?=[\s\S]{0,160}\b(muscle|sarcomere|myosin|actin)\b)|\bmyofibrils?\b|\bstriated muscle (structure|fibres?|banding)\b/i,
  parts: [
    { id: "sarcomere", name: "Sarcomere" },
    { id: "z-line", name: "Z line" },
    { id: "m-line", name: "M line" },
    { id: "actin", name: "Actin (thin filament)" },
    { id: "myosin", name: "Myosin (thick filament)" },
    { id: "a-band", name: "A band" },
    { id: "i-band", name: "I band" },
    { id: "h-zone", name: "H zone" },
  ],
  build(params: FigureParams) {
    const b = sarcomereBands(sarcomereLength(params));
    const values = bool(params.values ?? params.showValues, true);
    const W = 600;
    const mid = W / 2;
    const X = (um: number) => r2(mid + um * PX); // µm from the M line → x
    const half = b.sarcomere / 2;
    const zL = X(-half), zR = X(half);
    const edge = half + b.iBand / 2 + STUB_UM; // drawn to the neighbours' thick-filament stubs
    const left = X(-edge), right = X(edge);
    const shapes: FigureShape[] = [];
    const parts: FigurePart[] = [];

    // Rows: thin filaments outermost and between the thick ones, as in a longitudinal section.
    const top = 26, pitch = 32;
    const rowY = (j: number) => top + 14 + j * pitch;
    const actinRows = [0, 2, 4, 6].map(rowY), myosinRows = [1, 3, 5].map(rowY);
    const blockTop = rowY(0) - 6, blockBot = rowY(6) + 6;

    // The A band, lightly shaded behind the filaments (the dark band of striated muscle).
    shapes.push({ t: "path", d: `M${X(-THICK_UM / 2)} ${blockTop - 4} H${X(THICK_UM / 2)} V${blockBot + 4} H${X(-THICK_UM / 2)} Z`, fill: C.aShade, stroke: "none", opacity: 0.3, part: "a-band" });

    // Thin filaments: from each Z line 0.95 µm both ways, cut at the drawing's edges.
    const thin = (x1: number, x2: number, y: number) => {
      const a = Math.max(left, Math.min(x1, x2)), z = Math.min(right, Math.max(x1, x2));
      if (z - a < 2) return;
      shapes.push({ t: "path", d: `M${r2(a)} ${y - 3.5} H${r2(z)} V${y + 3.5} H${r2(a)} Z`, fill: C.actinFill, stroke: C.actin, width: 1.6, part: "actin" });
    };
    for (const y of actinRows) {
      for (const z of [-half, half]) { thin(X(z - THIN_UM), X(z), y); thin(X(z), X(z + THIN_UM), y); }
    }

    // Thick filaments: this sarcomere's, centred on the M line, and the neighbours' stubs at the edges.
    const thick = (from: number, to: number, y: number, centre: number) => {
      const a = Math.max(left, X(from)), z = Math.min(right, X(to));
      shapes.push({ t: "path", d: `M${a} ${y - 7} H${z} V${y + 7} H${a} Z`, fill: C.myosinFill, stroke: C.myosin, width: 1.8, part: "myosin" });
      // Heads along both edges, pointing away from the bare zone at the filament's centre.
      let d = "";
      for (let u = from + 0.05; u <= to - 0.03; u += 0.075) {
        if (Math.abs(u - centre) < 0.12) continue;
        const x = X(u);
        if (x < left + 3 || x > right - 3) continue;
        const dir = u > centre ? 1 : -1;
        d += `M${r2(x)} ${y - 7} l${dir * 4} -6 M${r2(x)} ${y + 7} l${dir * 4} 6 `;
      }
      if (d) shapes.push({ t: "path", d: d.trim(), stroke: C.myosin, width: 1.8, fill: "none", part: "myosin" });
    };
    for (const y of myosinRows) {
      thick(-THICK_UM / 2, THICK_UM / 2, y, 0);
      thick(-b.sarcomere - THICK_UM / 2, -b.sarcomere + THICK_UM / 2, y, -b.sarcomere);
      thick(b.sarcomere - THICK_UM / 2, b.sarcomere + THICK_UM / 2, y, b.sarcomere);
    }

    // Z lines (zig-zag discs holding the thin filaments) and the M line through the thick filaments' centres.
    const zig = (x: number) => {
      let d = `M${x} ${blockTop}`;
      for (let y = blockTop + 10, k = 0; y <= blockBot; y += 10, k++) d += ` L${r2(x + (k % 2 ? -4 : 4))} ${y}`;
      return d + ` L${x} ${blockBot}`;
    };
    shapes.push({ t: "path", d: zig(zL), stroke: "ink", width: 2.6, fill: "none", part: "z-line" });
    shapes.push({ t: "path", d: zig(zR), stroke: "ink", width: 2.6, fill: "none", part: "z-line" });
    shapes.push({ t: "path", d: `M${X(0)} ${blockTop} V${blockBot}`, stroke: "ink", width: 2.4, fill: "none", part: "m-line" });

    // Brackets under the filaments, each band's ends dropped to it by a faint guide. The I band row is
    // last, so the Z lines' guides (which stop at the sarcomere row) never cut through its values.
    const guides = new Map<number, number>(); // x → the lowest bracket end at that x
    const bracket = (x1: number, x2: number, y: number, part: string, value: number) => {
      shapes.push({ t: "path", d: `M${r2(x1)} ${y - 7} V${y + 7} M${r2(x1)} ${y} H${r2(x2)} M${r2(x2)} ${y - 7} V${y + 7}`, stroke: "ink", width: 2, fill: "none", part });
      for (const x of [r2(x1), r2(x2)]) guides.set(x, Math.max(guides.get(x) ?? 0, y));
      if (values) shapes.push({ t: "text", x: r2((x1 + x2) / 2), y: y + 24, text: `${fmt(value, 2)} µm`, size: 17, anchor: "middle", fill: "muted", part });
    };
    const rows = values ? { h: blockBot + 30, a: blockBot + 76, s: blockBot + 122, i: blockBot + 168 } : { h: blockBot + 24, a: blockBot + 50, s: blockBot + 76, i: blockBot + 102 };
    if (b.hZone > 0.02) bracket(X(-b.hZone / 2), X(b.hZone / 2), rows.h, "h-zone", b.hZone);
    bracket(X(-THICK_UM / 2), X(THICK_UM / 2), rows.a, "a-band", THICK_UM);
    bracket(X(-b.sarcomere / 2 - b.iBand / 2), X(-THICK_UM / 2), rows.i, "i-band", b.iBand);
    bracket(X(THICK_UM / 2), X(b.sarcomere / 2 + b.iBand / 2), rows.i, "i-band", b.iBand);
    bracket(zL, zR, rows.s, "sarcomere", b.sarcomere);
    for (const [x, to] of guides) shapes.unshift({ t: "path", d: `M${x} ${blockBot + 6} V${to - 8}`, stroke: "muted", width: 1, dash: "3 4", fill: "none" });

    // Anchors: each on its own shape, placed so a margin leader reaches it without crossing the art.
    parts.push({ id: "sarcomere", name: "Sarcomere", anchor: { x: zL, y: rows.s } });
    parts.push({ id: "z-line", name: "Z line", anchor: { x: zL, y: blockTop } });
    parts.push({ id: "m-line", name: "M line", anchor: { x: X(0), y: blockTop } });
    parts.push({ id: "actin", name: "Actin (thin filament)", anchor: { x: r2(left + 8), y: actinRows[0] } });
    // On the next sarcomere's thick filament at the edge: every thick filament inside this one lies
    // behind a Z line and thin filaments, so a leader to it would cross the art.
    parts.push({ id: "myosin", name: "Myosin (thick filament)", anchor: { x: r2(right - 10), y: myosinRows[0] } });
    parts.push({ id: "a-band", name: "A band", anchor: { x: X(THICK_UM / 2), y: rows.a } });
    parts.push({ id: "i-band", name: "I band", anchor: { x: X(-b.sarcomere / 2 - b.iBand / 2), y: rows.i } });
    if (b.hZone > 0.02) parts.push({ id: "h-zone", name: "H zone", anchor: { x: X(b.hZone / 2), y: rows.h } });
    return { w: W, h: rows.i + (values ? 34 : 14), shapes, parts };
  },
};
