import type { FigureComponent, FigureShape } from "../types";

/**
 * Cambridge O Level leaf as a photosynthesis organ: a transverse section with cuticle, palisade,
 * spongy mesophyll, stomata and a vascular bundle (xylem above phloem).
 */
export const leafCrossSection: FigureComponent = {
  name: "leafCrossSection",
  title: "Transverse section of a leaf: cuticle, palisade, spongy mesophyll, stoma, xylem and phloem",
  params: `view ("section" default). Parts are the tissues a labelling question names.`,
  match: /\bleaf\b(?=[\s\S]{0,200}\b(cross[- ]section|palisade|spongy|mesophyll|stomata?|cuticle|xylem|phloem|epidermis|photosynthes)\b)|\b(palisade|spongy mesophyll|structure of (a |the )?leaf)\b/i,
  parts: [
    { id: "cuticle", name: "Cuticle" },
    { id: "upper-epidermis", name: "Upper epidermis" },
    { id: "palisade", name: "Palisade mesophyll" },
    { id: "spongy", name: "Spongy mesophyll" },
    { id: "stoma", name: "Stoma" },
    { id: "xylem", name: "Xylem" },
    { id: "phloem", name: "Phloem" },
    { id: "lower-epidermis", name: "Lower epidermis" },
  ],
  build() {
    const shapes: FigureShape[] = [];
    shapes.push({ t: "path", part: "cuticle", d: "M40 48 H600", stroke: "#166534", width: 6, fill: "none" });
    shapes.push({ t: "path", part: "upper-epidermis", d: "M40 52 H600 V88 H40 Z", fill: "#dcfce7", stroke: "ink", width: 1.6 });
    for (let i = 0; i < 7; i++) {
      const x = 70 + i * 76;
      shapes.push({ t: "path", part: "palisade", d: `M${x} 96 H${x + 52} V210 H${x} Z`, fill: "#86efac", stroke: "ink", width: 1.6 });
    }
    shapes.push({ t: "path", part: "spongy", d: "M40 218 H600 V330 H40 Z", fill: "#bbf7d0", stroke: "ink", width: 1.4 });
    for (const [cx, cy] of [[110, 250], [190, 290], [270, 255], [430, 288], [510, 248], [560, 292]] as const) {
      shapes.push({ t: "circle", part: "spongy", cx, cy, r: 22, fill: "#4ade80", stroke: "ink", width: 1.2, opacity: 0.85 });
    }
    shapes.push({ t: "path", part: "xylem", d: "M320 236 H400 V268 H320 Z", fill: "#93c5fd", stroke: "ink", width: 1.8 });
    shapes.push({ t: "path", part: "phloem", d: "M320 272 H400 V304 H320 Z", fill: "#fdba74", stroke: "ink", width: 1.8 });
    shapes.push({ t: "path", part: "lower-epidermis", d: "M40 332 H600 V368 H40 Z", fill: "#dcfce7", stroke: "ink", width: 1.6 });
    shapes.push({ t: "path", part: "stoma", d: "M248 338 H292 V362 H248 Z", fill: "none", stroke: "ink", width: 2.2 });
    shapes.push({ t: "path", part: "stoma", d: "M252 350 Q270 342 288 350", stroke: "#166534", width: 2, fill: "none" });
    return {
      w: 640,
      h: 400,
      shapes,
      parts: [
        { id: "cuticle", name: "Cuticle", anchor: { x: 320, y: 48 } },
        { id: "upper-epidermis", name: "Upper epidermis", anchor: { x: 120, y: 70 } },
        { id: "palisade", name: "Palisade mesophyll", anchor: { x: 180, y: 150 } },
        { id: "spongy", name: "Spongy mesophyll", anchor: { x: 190, y: 270 } },
        { id: "xylem", name: "Xylem", anchor: { x: 360, y: 252 } },
        { id: "phloem", name: "Phloem", anchor: { x: 360, y: 288 } },
        { id: "stoma", name: "Stoma", anchor: { x: 270, y: 350 } },
        { id: "lower-epidermis", name: "Lower epidermis", anchor: { x: 480, y: 350 } },
      ],
    };
  },
};
