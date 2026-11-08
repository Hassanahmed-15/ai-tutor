/**
 * Dev-only boards for the lab engines on Aria's board (lib/canvas/labDrawing.ts): a pencil scene beside
 * notes, and a 3-D model. `/canvas-lab?fixture=lab` — free, no model calls.
 */
import trig from "../mathsEngine/examples/trig.json";
import type { CanvasBoardSpec } from "./types";

export const LAB_FIXTURES: Array<{ id: string; script: string; spec: CanvasBoardSpec }> = [
  {
    id: "lab1",
    script: "Here is a right-angled triangle. The right angle is at B. Join A to C. The side opposite the right angle is the hypotenuse. The angle at A is 35 degrees. The side next to it, AB, is 5 centimetres. We want BC. It is opposite the angle, so call it x. Opposite and adjacent. That is tan. So tan 35 degrees equals x over 5. Multiply both sides by 5. x is 5 times tan 35 degrees, which is 3.50 centimetres.",
    spec: { v: 1, heading: "Finding a side with tan", notes: [{ id: "n1", text: "tan = opposite ÷ adjacent", s: 4 }, { id: "n2", text: "x = 5 × tan 35° = 3.50 cm", s: 5 }], stage: { kind: "illustration", subject: "drawing", parts: [], labels: [] } as never, cues: [], lab: { kind: "pencil", scene: trig as Record<string, unknown>, sentenceMs: [3000, 3000, 3500, 3000, 3500, 4000] } },
  },
  {
    id: "lab2",
    script: "Here are two points in space, A and B. Go along x, then y, then up z. The straight line from A to B is the 3-D Pythagoras distance.",
    spec: { v: 1, heading: "Distance in 3-D", notes: [{ id: "n1", text: "d² = Δx² + Δy² + Δz²", s: 2 }], stage: { kind: "illustration", subject: "drawing", parts: [], labels: [] } as never, cues: [], lab: { kind: "view3d", template: "points_distance_3d", args: { A: [1, 2, 3], B: [4, 0, 1] }, stepSentence: [0, 1, 2], alt: "Two points A and B in 3-D and the distance between them" } },
  },
];
