import type { FigureComponent, FigureParams, FigurePart, FigureShape } from "../types";
import { r2 } from "./bioDraw";
import { bool, fmt, optNum } from "./mathsKit";

/**
 * CALIBRATING AN EYEPIECE GRATICULE, DRAWN FROM THE READING. The field of view shows the eyepiece
 * graticule (a fine scale of arbitrary "eyepiece units", numbered every ten) lying over a stage
 * micrometer (a slide ruled in known steps, usually 0.01 mm = 10 µm). The board gives how many
 * graticule divisions line up with how many micrometer divisions; the code spaces the micrometer
 * lines so exactly those lines coincide, marks the two coincident lines, and works out the value of
 * one eyepiece unit (micrometer divisions × their size ÷ graticule divisions).
 */

export type GraticuleCalibration = { graticuleDivisions: number; micrometerDivisions: number; micrometerUm: number; total: number; alignFrom: number; spanUm: number; umPerUnit: number };

/** "0.01 mm", "10 µm", "10" (µm) → micrometres. */
function micrometres(v: unknown): number | undefined {
  const s = String(v ?? "").trim().toLowerCase();
  const n = optNum(s.replace(/\s*(µm|um|micrometres?|micrometers?|microns?|mm|millimetres?|millimeters?)$/, ""));
  if (n === undefined || n <= 0) return undefined;
  return /mm|milli/.test(s) ? n * 1000 : n;
}

export function graticuleCalibration(params: FigureParams): GraticuleCalibration {
  const total = Math.round(Math.min(100, Math.max(20, optNum(params.graticuleTotal) ?? 100)));
  const g = Math.round(optNum(params.graticuleDivisions) ?? NaN);
  const graticuleDivisions = Number.isFinite(g) && g >= 1 ? Math.min(total, g) : 40;
  const m = Math.round(optNum(params.micrometerDivisions) ?? NaN);
  // At most four micrometer divisions per eyepiece unit, or the stage scale would be a grey smear.
  const micrometerDivisions = Number.isFinite(m) && m >= 1 ? Math.min(m, graticuleDivisions * 4, 200) : 10;
  const u = micrometres(params.micrometerDivision ?? params.micrometerUnit ?? params.divisionSize);
  const micrometerUm = u !== undefined && u <= 1000 ? u : 10;
  const spanUm = micrometerDivisions * micrometerUm;
  // The first coinciding line: as given, else the span centred on the scale at a numbered line.
  const from = Math.round(optNum(params.alignFrom) ?? NaN);
  const alignFrom = Number.isFinite(from) && from >= 0 ? Math.min(from, total - graticuleDivisions) : Math.floor((total - graticuleDivisions) / 20) * 10;
  return { graticuleDivisions, micrometerDivisions, micrometerUm, total, alignFrom, spanUm, umPerUnit: spanUm / graticuleDivisions };
}

const C = { micrometer: "#2563eb", align: "#d97706" } as const;

export const microscopeGraticule: FigureComponent = {
  name: "microscopeGraticule",
  title: "Calibrating an eyepiece graticule: the graticule scale over a stage micrometer in the field of view, with the lines that coincide marked and the value of one eyepiece unit worked out",
  params: `graticuleDivisions (eyepiece units between the two coinciding lines, default 40); micrometerDivisions (stage micrometer divisions over the same distance, default 10); micrometerDivision (size of one stage micrometer division, default "10 µm" = 0.01 mm; "0.01 mm" also accepted); graticuleTotal (divisions on the graticule, default 100); alignFrom (graticule reading of the first coinciding line, default: the span centred on the scale); showCalculation (true default: a caption works out 1 eyepiece unit in µm). The micrometer spacing and the µm per eyepiece unit are computed — never give them.`,
  match: /\b(eyepiece )?graticules?\b|\bstage micrometers?\b|\beyepiece units?\b|\bcalibrat\w* (the |an |a )?(eyepiece|microscope)\b/i,
  parts: [
    { id: "graticule", name: "Eyepiece graticule" },
    { id: "eyepiece-unit", name: "Eyepiece unit" },
    { id: "stage-micrometer", name: "Stage micrometer" },
    { id: "micrometer-division", name: "Micrometer division" },
    { id: "coinciding-lines", name: "Coinciding lines" },
    { id: "field-of-view", name: "Field of view" },
  ],
  build(params: FigureParams) {
    const cal = graticuleCalibration(params);
    const showCalc = bool(params.showCalculation ?? params.showValue, true);
    const W = 560, cx = W / 2, R = 224, cy = R + 4;
    const shapes: FigureShape[] = [];
    const parts: FigurePart[] = [];

    // The circular field of view.
    // "glass" is a pale tint on paper and on chalk alike, so the scales' ink reads on both.
    shapes.push({ t: "circle", cx, cy, r: R, fill: "glass", stroke: "ink", width: 2.6, part: "field-of-view" });

    // The graticule: `total` divisions, ticks hanging from a baseline, numbered every ten.
    const base = cy - 40;
    const gW = 2 * Math.sqrt(R * R - (base - cy) ** 2) - 44;
    const gp = gW / cal.total; // px per eyepiece unit
    const gx = (k: number) => r2(cx - gW / 2 + k * gp);
    let ticks = `M${gx(0)} ${base} H${gx(cal.total)}`;
    for (let k = 0; k <= cal.total; k++) ticks += ` M${gx(k)} ${base} V${base + (k % 10 === 0 ? 22 : k % 5 === 0 ? 15 : 9)}`;
    shapes.push({ t: "path", d: ticks, stroke: "ink", width: 1.6, fill: "none", part: "graticule" });
    for (let k = 0; k <= cal.total; k += 10) shapes.push({ t: "text", x: gx(k), y: base - 8, text: String(k), size: 14, anchor: "middle", fill: "ink", part: "graticule" });
    // One eyepiece unit picked out, near the right end of the scale.
    const eu = Math.max(1, cal.total - 7);
    shapes.push({ t: "path", d: `M${gx(eu)} ${base + 9} V${base + 15} H${gx(eu + 1)} V${base + 9}`, stroke: C.align, width: 2, fill: "none", part: "eyepiece-unit" });

    // The stage micrometer: lines every `mp` px rising from its own baseline to meet the graticule's
    // ticks; the first coinciding line is at graticule 0, the second `graticuleDivisions` later.
    const mp = (cal.graticuleDivisions * gp) / cal.micrometerDivisions;
    const mBase = cy + 26;
    const half = (y: number) => Math.sqrt(Math.max(0, R * R - (y - cy) ** 2)) - 10;
    const xMin = cx - Math.min(half(mBase), half(cy - 4)), xMax = cx + Math.min(half(mBase), half(cy - 4));
    const x0 = gx(cal.alignFrom);
    let mLines = "";
    const kFrom = Math.ceil((xMin - x0) / mp), kTo = Math.floor((xMax - x0) / mp);
    for (let k = kFrom; k <= kTo; k++) {
      const x = r2(x0 + k * mp);
      mLines += ` M${x} ${mBase} V${mBase - (k % 10 === 0 ? 38 : k % 5 === 0 ? 34 : 30)}`;
    }
    const mx0 = r2(x0 + kFrom * mp), mx1 = r2(x0 + kTo * mp);
    shapes.push({ t: "path", d: `M${mx0} ${mBase} H${mx1}${mLines}`, stroke: C.micrometer, width: 2, fill: "none", part: "stage-micrometer" });
    // One micrometer division outlined, under the scale on the right.
    // One micrometer division outlined just outside the coinciding span (right of it when there is room).
    const md = cal.micrometerDivisions + 1 <= kTo - 1 ? cal.micrometerDivisions + 1 : kFrom <= -3 ? -3 : Math.floor(cal.micrometerDivisions / 2);
    const mdx = r2(x0 + md * mp), mdx2 = r2(x0 + (md + 1) * mp);
    shapes.push({ t: "path", d: `M${mdx} ${mBase + 6} V${mBase + 12} H${mdx2} V${mBase + 6}`, stroke: C.micrometer, width: 2, fill: "none", part: "micrometer-division" });
    shapes.push({ t: "text", x: r2((mdx + mdx2) / 2), y: mBase + 30, text: `${fmt(cal.micrometerUm, 3)} µm`, size: 14, anchor: "middle", fill: C.micrometer, part: "micrometer-division" });

    // The two lines that coincide, ruled through both scales, and the span between them.
    const a1 = gx(cal.alignFrom), a2 = gx(cal.alignFrom + cal.graticuleDivisions);
    for (const x of [a1, a2]) shapes.push({ t: "path", d: `M${x} ${base - 30} V${mBase + 4}`, stroke: C.align, width: 2, dash: "5 4", fill: "none", part: "coinciding-lines" });
    const top = base - 44;
    shapes.push({ t: "path", d: `M${a1} ${top + 6} V${top} H${a2} V${top + 6}`, stroke: C.align, width: 2, fill: "none", part: "coinciding-lines" });
    shapes.push({ t: "text", x: r2((a1 + a2) / 2), y: top - 8, text: `${cal.graticuleDivisions} eyepiece units`, size: 15, anchor: "middle", fill: C.align, part: "coinciding-lines" });
    const low = mBase + 52;
    shapes.push({ t: "path", d: `M${a1} ${low - 6} V${low} H${a2} V${low - 6}`, stroke: C.micrometer, width: 2, fill: "none", part: "stage-micrometer" });
    shapes.push({ t: "text", x: r2((a1 + a2) / 2), y: low + 20, text: `${cal.micrometerDivisions} × ${fmt(cal.micrometerUm, 3)} µm = ${fmt(cal.spanUm, 2)} µm`, size: 15, anchor: "middle", fill: C.micrometer, part: "stage-micrometer" });

    // The calibration itself, in the empty lower part of the field.
    if (showCalc) shapes.push({ t: "text", x: cx, y: r2(low + 62), text: `1 eyepiece unit = ${fmt(cal.spanUm, 2)} µm ÷ ${cal.graticuleDivisions} = ${fmt(cal.umPerUnit, 2)} µm`, size: 16, anchor: "middle", fill: "ink" });

    parts.push({ id: "graticule", name: "Eyepiece graticule", anchor: { x: gx(0), y: base } });
    parts.push({ id: "eyepiece-unit", name: "Eyepiece unit", anchor: { x: r2((gx(eu) + gx(eu + 1)) / 2), y: base + 15 } });
    parts.push({ id: "stage-micrometer", name: "Stage micrometer", anchor: { x: mx0, y: mBase } });
    parts.push({ id: "micrometer-division", name: "Micrometer division", anchor: { x: mdx2, y: mBase + 12 } });
    parts.push({ id: "coinciding-lines", name: "Coinciding lines", anchor: { x: a2, y: base - 30 } });
    parts.push({ id: "field-of-view", name: "Field of view", anchor: { x: r2(cx - R * Math.cos(0.9)), y: r2(cy + R * Math.sin(0.9)) } });
    return { w: W, h: 2 * R + 8, shapes, parts };
  },
};
