import type { FigureComponent, FigureParams, FigureShape } from "../types";

/** A rate-of-photosynthesis investigation. The measured outcome and distance are explicit. */
export const photosynthesisExperiment: FigureComponent = {
  name: "photosynthesisExperiment",
  title: "Photosynthesis rate investigation: lamp, measured distance, pondweed in water and collected oxygen",
  params: `distanceCm (lamp-to-pondweed distance, default 20), bicarbonate (true by default, labels the carbon-dioxide source). The dependent variable is oxygen produced per unit time; temperature and pondweed length are controlled.`,
  match: /\b(investigat\w*|experiment\w*|practical|method|apparatus|set[- ]?up|measure)\b[^.]{0,100}\b(photosynth\w*|pondweed|elodea|oxygen bubbles?|light intensity)\b|\b(photosynth\w*|pondweed|elodea)\b[^.]{0,100}\b(investigat\w*|experiment\w*|apparatus|light intensity|oxygen bubbles?)\b/i,
  parts: [
    { id: "light-source", name: "Lamp (independent variable)" },
    { id: "ruler", name: "Measured distance" },
    { id: "beaker", name: "Water bath" },
    { id: "pondweed", name: "Pondweed" },
    { id: "oxygen", name: "Oxygen produced per minute" },
    { id: "carbon-dioxide", name: "Carbon dioxide source" },
    { id: "thermometer", name: "Controlled temperature" },
  ],
  build(params: FigureParams) {
    const d = Number.isFinite(Number(params.distanceCm)) ? Math.max(5, Math.min(100, Number(params.distanceCm))) : 20;
    const shapes: FigureShape[] = [
      // Lamp and light rays.
      { t: "circle", part: "light-source", cx: 92, cy: 150, r: 42, fill: "#facc15", stroke: "ink", width: 2.4 },
      { t: "path", part: "light-source", d: "M50 150 H24 M58 116 L38 96 M58 184 L38 204", stroke: "#d97706", width: 3, fill: "none" },
      { t: "path", d: "M138 128 L252 146 M138 150 H252 M138 172 L252 154", stroke: "#f59e0b", width: 2, dash: "8 6", fill: "none" },
      // Ruler and explicit distance.
      { t: "path", part: "ruler", d: "M136 260 H320 M136 252 V268 M320 252 V268", stroke: "ink", width: 2.2, fill: "none" },
      { t: "text", part: "ruler", x: 228, y: 286, text: `${d} cm`, size: 20, anchor: "middle", fill: "ink" },
      // Beaker / water.
      { t: "path", part: "beaker", d: "M330 82 V310 Q330 330 350 330 H548 Q568 330 568 310 V82", stroke: "ink", width: 3, fill: "none" },
      { t: "path", part: "beaker", d: "M332 130 H566 V310 Q566 328 548 328 H350 Q332 328 332 310 Z", fill: "#bfdbfe", stroke: "none", opacity: 0.55 },
      { t: "path", part: "carbon-dioxide", d: "M336 298 H562", stroke: "#60a5fa", width: 8, fill: "none", opacity: 0.7 },
      // Pondweed stem and leaves.
      { t: "path", part: "pondweed", d: "M438 304 C430 262 446 226 438 184 C430 150 444 130 448 112", stroke: "#16a34a", width: 7, fill: "none" },
      { t: "path", part: "pondweed", d: "M438 266 C408 256 404 236 433 244 M441 226 C474 214 478 192 444 204 M439 184 C408 174 410 150 445 166 M445 144 C472 132 472 112 448 124", stroke: "#16a34a", width: 5, fill: "none" },
      // Oxygen bubbles and collection tube.
      { t: "circle", part: "oxygen", cx: 449, cy: 103, r: 6, fill: "none", stroke: "#2563eb", width: 2 },
      { t: "circle", part: "oxygen", cx: 456, cy: 82, r: 8, fill: "none", stroke: "#2563eb", width: 2 },
      { t: "circle", part: "oxygen", cx: 446, cy: 56, r: 10, fill: "none", stroke: "#2563eb", width: 2 },
      { t: "text", part: "oxygen", x: 486, y: 66, text: "O₂ per minute", size: 18, anchor: "start", fill: "#2563eb" },
      // Thermometer.
      { t: "path", part: "thermometer", d: "M524 118 V262", stroke: "#dc2626", width: 4, fill: "none" },
      { t: "circle", part: "thermometer", cx: 524, cy: 270, r: 10, fill: "#dc2626", stroke: "ink", width: 1.4 },
      { t: "text", part: "thermometer", x: 540, y: 196, text: "constant °C", size: 16, anchor: "start", fill: "ink" },
    ];
    return { w: 650, h: 360, shapes, parts: [
      { id: "light-source", name: "Lamp", anchor: { x: 92, y: 150 } },
      { id: "ruler", name: `Distance (${d} cm)`, anchor: { x: 228, y: 260 } },
      { id: "beaker", name: "Water bath", anchor: { x: 348, y: 150 } },
      { id: "pondweed", name: "Pondweed", anchor: { x: 438, y: 220 } },
      { id: "oxygen", name: "Oxygen per minute", anchor: { x: 456, y: 82 } },
      { id: "carbon-dioxide", name: "Sodium hydrogencarbonate", anchor: { x: 390, y: 298 } },
      { id: "thermometer", name: "Constant temperature", anchor: { x: 524, y: 190 } },
    ] };
  },
};
