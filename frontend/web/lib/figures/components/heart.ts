import type { FigureComponent, FigureParams } from "../types";
import { BIO, r2, roundedPoly } from "./bioDraw";
import type { FigureShape, Pt } from "../types";

/**
 * Cambridge O/A Level heart: four chambers in the standard frontal view (the heart's right is on
 * the student's left), the septum, the four great vessels and the valves a labelling question names.
 * Side (left/right of the heart) is a parameter so a "right side of the heart" board can highlight it.
 */

type Side = "both" | "left" | "right";

function sideOf(v: unknown): Side {
  const s = String(v ?? "").toLowerCase();
  if (/\bright\b/.test(s) && !/\bleft\b/.test(s)) return "right";
  if (/\bleft\b/.test(s) && !/\bright\b/.test(s)) return "left";
  return "both";
}

const fade = (which: "left" | "right", side: Side) => (side !== "both" && side !== which ? 0.22 : 1);

export const heart: FigureComponent = {
  name: "heart",
  title: "Labelled frontal diagram of the heart: four chambers, septum, vena cava, pulmonary artery and vein, aorta and the atrioventricular and semilunar valves",
  params: `side ("both" default, "left" or "right" of the HEART — the right chambers sit on the student's left). highlight (optional chamber or vessel id to emphasise).`,
  match: /\bheart\b(?!\s+rate)(?=[\s\S]{0,240}\b(chamber|atrium|atria|ventricle|aorta|vena cava|pulmonary|valve|septum|cardiac)\b)|\b(right|left) (atrium|ventricle)\b|\baorta\b(?=[\s\S]{0,80}\b(heart|ventricle|valve)\b)|\bvessel\w* (of|from|to) the heart\b|\bheart (structure|diagram|chambers?|valves?)\b/i,
  parts: [
    { id: "right-atrium", name: "Right atrium" },
    { id: "right-ventricle", name: "Right ventricle" },
    { id: "left-atrium", name: "Left atrium" },
    { id: "left-ventricle", name: "Left ventricle" },
    { id: "septum", name: "Septum" },
    { id: "vena-cava", name: "Vena cava" },
    { id: "pulmonary-artery", name: "Pulmonary artery" },
    { id: "pulmonary-vein", name: "Pulmonary vein" },
    { id: "aorta", name: "Aorta" },
    { id: "tricuspid", name: "Tricuspid valve" },
    { id: "bicuspid", name: "Bicuspid (mitral) valve" },
    { id: "semilunar", name: "Semilunar valves" },
  ],
  build(params: FigureParams) {
    const side = sideOf(params.side ?? params.highlight);
    const ra = fade("right", side), rv = fade("right", side), la = fade("left", side), lv = fade("left", side);
    const shapes: FigureShape[] = [];
    const poly = (part: string, pts: Pt[], fill: string, opacity: number, radii: number | number[]) => {
      shapes.push({ t: "path", part, d: roundedPoly(pts, radii), fill: fill as never, stroke: "ink", width: 2.4, opacity });
    };
    // Chambers: student-left is the heart's right.
    poly("right-atrium", [{ x: 210, y: 168 }, { x: 268, y: 148 }, { x: 300, y: 188 }, { x: 268, y: 228 }, { x: 208, y: 218 }], "#fecaca", ra, 18);
    poly("right-ventricle", [{ x: 200, y: 236 }, { x: 292, y: 230 }, { x: 318, y: 300 }, { x: 286, y: 368 }, { x: 210, y: 348 }, { x: 186, y: 286 }], "#fca5a5", rv, 22);
    poly("left-atrium", [{ x: 368, y: 148 }, { x: 430, y: 158 }, { x: 448, y: 210 }, { x: 404, y: 228 }, { x: 360, y: 188 }], "#bfdbfe", la, 18);
    poly("left-ventricle", [{ x: 348, y: 228 }, { x: 454, y: 220 }, { x: 478, y: 292 }, { x: 450, y: 372 }, { x: 352, y: 358 }, { x: 332, y: 292 }], "#93c5fd", lv, [18, 22, 26, 24, 20, 16]);
    // Septum (the wall between left and right).
    shapes.push({ t: "path", part: "septum", d: "M318 188 L338 188 L352 360 L318 360 Z", fill: "#e2e8f0", stroke: "ink", width: 2 });
    // Great vessels.
    shapes.push({ t: "path", part: "vena-cava", d: "M232 70 V148", stroke: "#7f1d1d", width: 16, fill: "none" });
    shapes.push({ t: "path", part: "aorta", d: "M368 70 C368 70 368 108 392 124 C416 140 430 128 430 108 V70", stroke: "#1d4ed8", width: 14, fill: "none" });
    shapes.push({ t: "path", part: "pulmonary-artery", d: "M268 132 C230 108 200 118 186 96", stroke: "#b91c1c", width: 12, fill: "none" });
    shapes.push({ t: "path", part: "pulmonary-vein", d: "M430 132 C468 112 492 118 508 96", stroke: "#2563eb", width: 10, fill: "none" });
    // Valves as short paired flaps.
    const flap = (part: string, a: Pt, b: Pt) => {
      shapes.push({ t: "path", part, d: `M${r2(a.x)} ${r2(a.y)} Q${r2((a.x + b.x) / 2)} ${r2(Math.min(a.y, b.y) - 10)} ${r2(b.x)} ${r2(b.y)}`, stroke: BIO.amber, width: 3.2, fill: "none" });
    };
    flap("tricuspid", { x: 240, y: 228 }, { x: 276, y: 232 });
    flap("bicuspid", { x: 384, y: 220 }, { x: 424, y: 224 });
    flap("semilunar", { x: 300, y: 140 }, { x: 328, y: 148 });
    flap("semilunar", { x: 360, y: 128 }, { x: 388, y: 136 });
    return {
      w: 640,
      h: 430,
      shapes,
      parts: [
        { id: "right-atrium", name: "Right atrium", anchor: { x: 244, y: 188 } },
        { id: "right-ventricle", name: "Right ventricle", anchor: { x: 250, y: 300 } },
        { id: "left-atrium", name: "Left atrium", anchor: { x: 404, y: 184 } },
        { id: "left-ventricle", name: "Left ventricle", anchor: { x: 412, y: 304 } },
        { id: "septum", name: "Septum", anchor: { x: 334, y: 274 } },
        { id: "vena-cava", name: "Vena cava", anchor: { x: 232, y: 96 } },
        { id: "pulmonary-artery", name: "Pulmonary artery", anchor: { x: 214, y: 118 } },
        { id: "pulmonary-vein", name: "Pulmonary vein", anchor: { x: 470, y: 118 } },
        { id: "aorta", name: "Aorta", anchor: { x: 392, y: 92 } },
        { id: "tricuspid", name: "Tricuspid valve", anchor: { x: 258, y: 224 } },
        { id: "bicuspid", name: "Bicuspid valve", anchor: { x: 404, y: 216 } },
        { id: "semilunar", name: "Semilunar valves", anchor: { x: 344, y: 138 } },
      ],
    };
  },
};
