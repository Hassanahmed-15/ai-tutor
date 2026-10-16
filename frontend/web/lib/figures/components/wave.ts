import type { FigureComponent, FigureParams, FigurePart, FigureShape, Ink, Pt } from "../types";

const fmt = (n: number) => Number(n.toFixed(2));
const num = (v: unknown, fallback: number, lo: number, hi: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};

/** An arrow from a to b (head at b; at both ends when double). */
function arrow(part: string, a: Pt, b: Pt, ink: Ink, width = 2.4, double = false, head = 11): FigureShape[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  const tip = (p: Pt, s: 1 | -1): FigureShape => ({
    t: "path", part, fill: ink, stroke: ink, width: 1,
    d: `M${fmt(p.x)} ${fmt(p.y)} L${fmt(p.x - s * ux * head - uy * head * 0.45)} ${fmt(p.y - s * uy * head + ux * head * 0.45)} L${fmt(p.x - s * ux * head + uy * head * 0.45)} ${fmt(p.y - s * uy * head - ux * head * 0.45)} Z`,
  });
  const a2 = double ? { x: a.x + ux * head * 0.8, y: a.y + uy * head * 0.8 } : a;
  const b2 = { x: b.x - ux * head * 0.8, y: b.y - uy * head * 0.8 };
  return [{ t: "path", part, d: `M${fmt(a2.x)} ${fmt(a2.y)} L${fmt(b2.x)} ${fmt(b2.y)}`, stroke: ink, width, fill: "none" }, tip(b, 1), ...(double ? [tip(a, -1)] : [])];
}

/**
 * A TRANSVERSE wave (a sinusoid about its rest position: crests, troughs, the wavelength between two
 * crests, the amplitude from the rest position to a trough) or a LONGITUDINAL wave (a
 * row of coils displaced along the direction of travel, x = x₀ + s·sin(kx₀) with s·k < 1, so they
 * bunch into compressions at kx₀ = π and spread into rarefactions at kx₀ = 0; the wavelength between
 * two compression centres). Both show the direction of travel and the direction the particles vibrate.
 */
export const wave: FigureComponent = {
  name: "wave",
  title: "Transverse or longitudinal wave: crests and troughs or compressions and rarefactions, wavelength, amplitude, direction of travel and of vibration",
  params: `type ("transverse", default; or "longitudinal"), wavelengths (how many wavelengths are drawn, 1-4, default 2), amplitude (0.2-1 of the room, default 0.7). Transverse shows crest, trough, wavelength (crest to crest, λ), amplitude (A), travel and vibration (perpendicular). Longitudinal shows compressions, rarefactions, wavelength (compression to compression), travel and vibration (parallel).`,
  match: /^(?![\s\S]*\b(colorimet\w*|spectrophotomet\w*|absorbance)\b)[\s\S]*?(?:\b(transverse|longitudinal) waves?\b|\bcompressions? and rarefactions?\b|\brarefactions?\b|\bwavelength\b(?!.*\bfunctions?\b)|\bamplitude of (a|the) wave\b|\b(crests?|troughs?) (and|of) (a |the )?(waves?|troughs?|crests?)\b)/i,
  parts: [
    { id: "crest", name: "Crest" },
    { id: "trough", name: "Trough" },
    { id: "wavelength", name: "Wavelength (λ)" },
    { id: "amplitude", name: "Amplitude (A)" },
    { id: "rest-position", name: "Rest position" },
    { id: "compression", name: "Compression" },
    { id: "rarefaction", name: "Rarefaction" },
    { id: "direction-of-travel", name: "Direction of travel" },
    { id: "direction-of-vibration", name: "Direction of vibration" },
  ],
  // Arrow anchors sit on an arrow's outer tip, so a leader never runs along (and hides) the arrow it names.
  build(params: FigureParams) {
    const longitudinal = typeof params.type === "string" && /long/i.test(params.type);
    const n = Math.round(num(params.wavelengths, 2, 1, 4) * 2) / 2;
    const amp = num(params.amplitude, 0.7, 0.2, 1);
    const W = 660, x0 = 40, x1 = W - 40;
    const lambda = (x1 - x0) / n;
    const shapes: FigureShape[] = [];
    const parts: FigurePart[] = [];

    if (!longitudinal) {
      const H = 370, y0 = 185;
      const A = 105 * amp;
      // Rest position, then the wave: y = −A·sin(2π(x − x0)/λ) (svg y points down, so it rises first).
      shapes.push({ t: "path", part: "rest-position", d: `M${x0 - 20} ${y0} H${x1 + 20}`, stroke: "muted", width: 1.6, dash: "8 6", fill: "none" });
      let d = "";
      for (let i = 0; i <= 240 * n; i++) {
        const x = x0 + (i / (240 * n)) * (x1 - x0);
        d += `${i ? "L" : "M"}${fmt(x)} ${fmt(y0 - A * Math.sin((2 * Math.PI * (x - x0)) / lambda))}`;
      }
      shapes.push({ t: "path", d, stroke: "#2563eb", width: 3.2, fill: "none" });
      const crest = (k: number) => ({ x: x0 + (k + 0.25) * lambda, y: y0 - A });
      const trough = (k: number) => ({ x: x0 + (k + 0.75) * lambda, y: y0 + A });
      // Wavelength: crest to crest (or one full cycle from the start when only one crest is drawn).
      const [wa, wb] = n >= 1.5 ? [crest(0), crest(1)] : [{ x: x0, y: y0 }, { x: x0 + lambda, y: y0 }];
      const wy = y0 - A - 30;
      shapes.push({ t: "path", part: "wavelength", d: `M${fmt(wa.x)} ${fmt(wa.y - 6)} V${fmt(wy - 8)} M${fmt(wb.x)} ${fmt(wb.y - 6)} V${fmt(wy - 8)}`, stroke: "muted", width: 1.4, dash: "4 4", fill: "none" });
      shapes.push(...arrow("wavelength", { x: wa.x, y: wy }, { x: wb.x, y: wy }, "ink", 2.2, true));
      shapes.push({ t: "text", part: "wavelength", x: fmt((wa.x + wb.x) / 2), y: fmt(wy - 9), text: "λ", size: 22, anchor: "middle", fill: "ink" });
      // Amplitude: rest position to the first trough.
      const tr = trough(0);
      const ax = tr.x;
      shapes.push(...arrow("amplitude", { x: ax, y: y0 }, { x: ax, y: tr.y }, "#d97706", 2.4, true, 10));
      shapes.push({ t: "text", part: "amplitude", x: fmt(ax + 10), y: fmt(y0 + A / 2 + 7), text: "A", size: 20, anchor: "start", fill: "#d97706" });
      // A particle on the wave, and the way it moves: up and down, perpendicular to the travel.
      const px = x0 + (n - 0.5) * lambda; // a rest-position crossing
      const vib = Math.min(A, 55);
      shapes.push(...arrow("direction-of-vibration", { x: px - 22, y: y0 - vib }, { x: px - 22, y: y0 + vib }, "#7c3aed", 2.4, true, 10));
      shapes.push({ t: "circle", part: "direction-of-vibration", cx: fmt(px), cy: y0, r: 6, fill: "#7c3aed", stroke: "paper", width: 1.5 });
      // Direction of travel.
      const ty = H - 22;
      shapes.push(...arrow("direction-of-travel", { x: x1 - 190, y: ty }, { x: x1, y: ty }, "#16a34a", 3, false, 14));
      const lastCrest = crest(Math.max(0, Math.ceil(n) - 1));
      parts.push(
        { id: "crest", name: "Crest", anchor: { x: lastCrest.x, y: lastCrest.y + 2 } },
        { id: "trough", name: "Trough", anchor: { x: trough(Math.max(0, Math.floor(n - 0.75))).x, y: y0 + A - 2 } },
        { id: "wavelength", name: "Wavelength (λ)", anchor: { x: wb.x > W / 2 ? wb.x - 3 : wa.x + 3, y: wy } },
        { id: "amplitude", name: "Amplitude (A)", anchor: { x: ax, y: y0 + A * 0.7 } },
        { id: "rest-position", name: "Rest position", anchor: { x: x0 - 14, y: y0 } },
        { id: "direction-of-travel", name: "Direction of travel", anchor: { x: x1 - 3, y: ty } },
        { id: "direction-of-vibration", name: "Direction of vibration", anchor: { x: px - 22, y: y0 - vib * 0.6 } },
        // Not features of a transverse wave: kept on the wave, listed last.
        { id: "compression", name: "Compression", anchor: lastCrest },
        { id: "rarefaction", name: "Rarefaction", anchor: trough(0) },
      );
      return { w: W, h: H, shapes, parts };
    }

    // Longitudinal: coils displaced along the line of travel.
    const H = 330, y0 = 150, half = 70;
    const k = (2 * Math.PI) / lambda;
    const per = 16; // coils per wavelength
    const s = (amp * 0.78) / k; // s·k < 1: coils never pass each other
    const count = Math.round(n * per);
    const xs: number[] = [];
    for (let i = 0; i <= count; i++) {
      const xe = x0 + (i / count) * (x1 - x0);
      // x = xe + s·sin(k(xe−x0)): spacing ∝ 1 + s·k·cos(k(xe−x0)), least (a compression) at k(xe−x0) = π, most (a rarefaction) at 0, 2π.
      xs.push(xe + s * Math.sin(k * (xe - x0)));
    }
    const marked = Math.round(per * 0.25 + per * Math.floor(n - 1)); // a coil a quarter-wave into the last wavelength
    xs.forEach((x, i) => {
      shapes.push({ t: "path", ...(i === marked ? { part: "direction-of-vibration" } : {}), d: `M${fmt(x)} ${y0 - half} V${y0 + half}`, stroke: i === marked ? "#7c3aed" : "#2563eb", width: i === marked ? 3.4 : 2.6, fill: "none" });
    });
    shapes.push({ t: "path", part: "rest-position", d: `M${x0 - 20} ${y0} H${x1 + 20}`, stroke: "muted", width: 1.2, dash: "8 6", fill: "none", opacity: 0.6 });
    const comp = (j: number) => x0 + (j + 0.5) * lambda;
    const rare = (j: number) => x0 + j * lambda;
    // Wavelength: compression centre to compression centre.
    const [wa, wb] = n >= 1.5 ? [comp(0), comp(1)] : [rare(0), rare(1)];
    const wy = y0 - half - 30;
    shapes.push({ t: "path", part: "wavelength", d: `M${fmt(wa)} ${y0 - half - 6} V${wy - 8} M${fmt(wb)} ${y0 - half - 6} V${wy - 8}`, stroke: "muted", width: 1.4, dash: "4 4", fill: "none" });
    shapes.push(...arrow("wavelength", { x: wa, y: wy }, { x: wb, y: wy }, "ink", 2.2, true));
    shapes.push({ t: "text", part: "wavelength", x: fmt((wa + wb) / 2), y: wy - 9, text: "λ", size: 22, anchor: "middle", fill: "ink" });
    // The marked coil vibrates back and forth along the line of travel.
    const mx = xs[marked];
    const vy = y0 + half + 30;
    shapes.push(...arrow("direction-of-vibration", { x: mx - 34, y: vy }, { x: mx + 34, y: vy }, "#7c3aed", 2.4, true, 10));
    const ty = H - 26;
    shapes.push(...arrow("direction-of-travel", { x: x1 - 190, y: ty }, { x: x1, y: ty }, "#16a34a", 3, false, 14));
    parts.push(
      { id: "compression", name: "Compression", anchor: { x: comp(0), y: y0 - half * 0.45 } },
      { id: "rarefaction", name: "Rarefaction", anchor: { x: rare(1), y: y0 + half * 0.45 } },
      { id: "wavelength", name: "Wavelength (λ)", anchor: { x: wb > W / 2 ? wb - 3 : wa + 3, y: wy } },
      { id: "direction-of-travel", name: "Direction of travel", anchor: { x: x1 - 3, y: ty } },
      { id: "direction-of-vibration", name: "Direction of vibration", anchor: { x: mx > W / 2 ? mx + 31 : mx - 31, y: vy } },
      { id: "rest-position", name: "Rest position", anchor: { x: x0 - 14, y: y0 } },
      // Not features of a longitudinal wave: kept on the coils, listed last.
      { id: "amplitude", name: "Amplitude (A)", anchor: { x: mx, y: y0 + half * 0.6 } },
      { id: "crest", name: "Crest", anchor: { x: comp(0), y: y0 - half * 0.45 } },
      { id: "trough", name: "Trough", anchor: { x: rare(1), y: y0 + half * 0.45 } },
    );
    return { w: W, h: H, shapes, parts };
  },
};
