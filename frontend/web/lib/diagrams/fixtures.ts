import type { CanvasBoardSpec } from "../canvas/types";
import { checkDiagram } from "./check";
import { compileDiagram } from "./render";
import { parseDiagramSpec, type DiagramSpec } from "./spec";

export type FixtureBoard = {
  id: string;
  title: string;
  script: string;
  subject: string;
  spec: DiagramSpec;
};

function board(fix: FixtureBoard): CanvasBoardSpec {
  const checked = checkDiagram(fix.spec, fix.script);
  const drawing = compileDiagram(checked.spec);
  const parts = drawing.parts.slice(0, 8).map((p, i) => ({ id: p.id, name: p.name, s: Math.min(i, 4) }));
  return {
    v: 1,
    heading: fix.title.slice(0, 40),
    notes: [],
    stage: { kind: "diagram", spec: checked.spec, parts, drawing },
    cues: parts.slice(0, 4).map((p, i) => ({ s: p.s, at: 0.2, action: "point" as const, target: p.id })),
  };
}

/** Latitude energy surplus / deficit — numbers come from the narration. */
export const ENERGY_BUDGET: FixtureBoard = {
  id: "geo-energy",
  title: "Latitude energy surplus and deficit",
  subject: "geography",
  script: "Incoming solar radiation exceeds outgoing radiation between 40 degrees north and 40 degrees south, a surplus. Poleward of 40 degrees there is a deficit. At the equator the surplus is 80 units. At the poles the deficit is 100 units. Energy is transferred from surplus to deficit by winds and ocean currents.",
  spec: parseDiagramSpec({
    v: 1, w: 640, h: 400, base: "none",
    elements: [
      { t: "axis", id: "energy-axis", s: 0, x: 70, y: 36, w: 520, h: 300, xLabel: "Latitude", yLabel: "Energy units", xMin: -90, xMax: 90, yMin: -120, yMax: 120 },
      { t: "series", id: "budget", s: 0, axis: "energy-axis", stroke: "ink", style: "both", points: [
        { x: -90, y: -100, label: "-100" }, { x: -40, y: 0 }, { x: 0, y: 80, label: "80" }, { x: 40, y: 0 }, { x: 90, y: -100, label: "-100" },
      ] },
      { t: "label", id: "surplus", s: 0, part: "Surplus", text: "Surplus", at: { x: 400, y: 90 }, leader: true },
      { t: "label", id: "deficit-n", s: 1, part: "Deficit", text: "Deficit", at: { x: 560, y: 260 }, leader: true },
    ],
  })!,
};

/** Three-cell atmospheric model with pressure belts and named winds. */
export const THREE_CELL: FixtureBoard = {
  id: "geo-cells",
  title: "The three-cell model",
  subject: "geography",
  script: "Air rises at the equator, a low pressure belt. It sinks at 30 degrees, the subtropical high. The Hadley cell lies between the equator and 30 degrees, and the trade winds blow towards the equator. The Ferrel cell sits between 30 and 60 degrees, with westerlies. The Polar cell lies between 60 degrees and the pole, with polar easterlies and a polar high.",
  spec: parseDiagramSpec({
    v: 1, w: 640, h: 400, base: "cross-section",
    elements: [
      { t: "bands", id: "lats", s: 0, orientation: "v", x: 60, y: 50, w: 520, h: 280, bands: [
        { id: "polar-s", name: "Polar cell", from: -90, to: -60, fill: "#e0f2fe", s: 2 },
        { id: "ferrel-s", name: "Ferrel cell", from: -60, to: -30, fill: "#dbeafe", s: 1 },
        { id: "hadley-s", name: "Hadley cell", from: -30, to: 0, fill: "#fed7aa", s: 0 },
        { id: "hadley-n", name: "Hadley cell", from: 0, to: 30, fill: "#fed7aa", s: 0 },
        { id: "ferrel-n", name: "Ferrel cell", from: 30, to: 60, fill: "#dbeafe", s: 1 },
        { id: "polar-n", name: "Polar cell", from: 60, to: 90, fill: "#e0f2fe", s: 2 },
      ] },
      { t: "label", id: "eq-low", s: 0, part: "Equatorial low", text: "Equatorial low", at: { x: 320, y: 40 }, leader: true },
      { t: "label", id: "sub-high", s: 0, part: "Subtropical high", text: "Subtropical high 30°", at: { x: 500, y: 40 }, leader: true },
      { t: "label", id: "polar-high", s: 2, part: "Polar high", text: "Polar high", at: { x: 600, y: 40 }, leader: true },
      { t: "arrow", id: "trades", s: 0, part: "Trade winds", from: { x: 430, y: 300 }, to: { x: 340, y: 310 }, label: "Trade winds", stroke: "ink" },
      { t: "arrow", id: "westerlies", s: 1, part: "Westerlies", from: { x: 460, y: 300 }, to: { x: 530, y: 300 }, label: "Westerlies", stroke: "ink" },
      { t: "arrow", id: "easterlies", s: 2, part: "Polar easterlies", from: { x: 610, y: 300 }, to: { x: 560, y: 300 }, label: "Polar easterlies", stroke: "ink" },
    ],
  })!,
};

/** World ocean currents: Gulf Stream and North Atlantic Drift warm red; Peru Current cold blue. */
export const OCEAN_CURRENTS: FixtureBoard = {
  id: "geo-currents",
  title: "World ocean currents",
  subject: "geography",
  script: "The Gulf Stream is a warm current off the east of North America. It continues as the North Atlantic Drift towards north-west Europe. The Peru Current is a cold current along the west coast of South America.",
  spec: parseDiagramSpec({
    v: 1, w: 640, h: 400, base: "world-map",
    elements: [
      { t: "map-mark", id: "gulf-stream", s: 0, part: "Gulf Stream", lon: -80, lat: 26, kind: "arrow", toLon: -50, toLat: 40, label: "Gulf Stream", stroke: "warm", width: 3 },
      { t: "map-mark", id: "nad", s: 1, part: "North Atlantic Drift", lon: -40, lat: 45, kind: "arrow", toLon: -8, toLat: 58, label: "North Atlantic Drift", stroke: "warm", width: 3 },
      { t: "map-mark", id: "peru", s: 2, part: "Peru Current", lon: -80, lat: -6, kind: "arrow", toLon: -76, toLat: -22, label: "Peru Current", stroke: "cold", width: 3 },
    ],
  })!,
};

/** ITCZ seasonal shift: July north of the equator, January south. */
export const ITCZ: FixtureBoard = {
  id: "geo-itcz",
  title: "Seasonal shift of the ITCZ",
  subject: "geography",
  script: "The ITCZ is a low pressure belt where the trade winds meet. In July it shifts north, following the overhead sun. In January it shifts south of the equator. The seasonal shift of the ITCZ reverses the winds of the monsoon.",
  spec: parseDiagramSpec({
    v: 1, w: 640, h: 400, base: "world-map",
    elements: [
      { t: "map-mark", id: "itcz-july", s: 1, part: "July ITCZ", lon: -80, lat: 14, kind: "arrow", toLon: 140, toLat: 16, label: "July ITCZ", stroke: "#dc2626", width: 2.6 },
      { t: "map-mark", id: "itcz-jan", s: 2, part: "January ITCZ", lon: -80, lat: -10, kind: "arrow", toLon: 140, toLat: -8, label: "January ITCZ", stroke: "#2563eb", width: 2.6 },
      { t: "label", id: "eq", s: 0, text: "Equator", at: { lon: 0, lat: 0 }, leader: false },
    ],
  })!,
};

/** Haploid n = 23 versus diploid 2n = 46, exact counts via repeat. */
export const CHROMOSOME_SETS: FixtureBoard = {
  id: "bio-chromosomes",
  title: "Chromosome sets n and 2n",
  subject: "biology",
  script: "A haploid nucleus has n chromosomes. In humans n = 23. A diploid nucleus has 2n chromosomes. In humans 2n = 46, arranged as 23 pairs.",
  spec: parseDiagramSpec({
    v: 1, w: 640, h: 400, base: "none",
    elements: [
      { t: "region", id: "hap-box", s: 0, part: "n = 23", shape: "rect", x: 40, y: 50, w: 260, h: 300, fill: "#e0f2fe", stroke: "ink" },
      { t: "repeat", id: "haploid", s: 0, n: 23, layout: "grid", x: 60, y: 80, w: 220, h: 220, of: { t: "region", id: "chr", s: 0, shape: "rod", w: 8, h: 22, fill: "#93c5fd", stroke: "ink" } },
      { t: "region", id: "dip-box", s: 1, part: "2n = 46", shape: "rect", x: 340, y: 50, w: 260, h: 300, fill: "#fee2e2", stroke: "ink" },
      { t: "repeat", id: "diploid", s: 1, n: 46, layout: "grid", x: 360, y: 70, w: 220, h: 240, of: { t: "region", id: "chr2", s: 1, shape: "rod", w: 7, h: 18, fill: "#fca5a5", stroke: "ink" } },
    ],
  })!,
};

/** Estimation / bounds number line with the narration's values. */
export const BOUNDS_LINE: FixtureBoard = {
  id: "maths-bounds",
  title: "Bounds of a rounded length",
  subject: "maths",
  script: "A length of 8 metres is rounded to the nearest metre. The lower bound is 7.5 metres. The upper bound is 8.5 metres. So 7.5 is less than or equal to L, and L is less than 8.5.",
  spec: parseDiagramSpec({
    v: 1, w: 640, h: 280, base: "none",
    elements: [
      { t: "axis", id: "line", s: 0, x: 70, y: 80, w: 500, h: 40, xLabel: "Length / m", yLabel: "", xMin: 7, xMax: 9, yMin: 0, yMax: 1 },
      { t: "series", id: "marks", s: 0, axis: "line", style: "points", stroke: "ink", points: [
        { x: 7.5, y: 0 }, { x: 8, y: 0 }, { x: 8.5, y: 0 },
      ] },
      { t: "label", id: "lb", s: 1, part: "Lower bound 7.5", text: "Lower bound 7.5", at: { x: 195, y: 70 }, leader: true },
      { t: "label", id: "val", s: 0, part: "8 m", text: "8 m", at: { x: 320, y: 70 }, leader: true },
      { t: "label", id: "ub", s: 1, part: "Upper bound 8.5", text: "Upper bound 8.5", at: { x: 445, y: 70 }, leader: true },
      { t: "label", id: "ineq", s: 2, text: "7.5 ≤ L < 8.5", at: { x: 320, y: 200 }, leader: false },
    ],
  })!,
};

/** Alpha-particle scattering: source, gold foil, undeflected, deflected and rebound paths. */
export const ALPHA_SCATTER: FixtureBoard = {
  id: "phys-alpha",
  title: "Alpha-particle scattering",
  subject: "physics",
  script: "Alpha particles from a source strike a thin gold foil. Most pass straight through. Some are deflected by a small angle. A very few bounce back, showing a tiny dense nucleus.",
  spec: parseDiagramSpec({
    v: 1, w: 640, h: 400, base: "none",
    elements: [
      { t: "region", id: "source", s: 0, part: "Source", shape: "rect", x: 40, y: 170, w: 50, h: 60, fill: "#e5e7eb", stroke: "ink" },
      { t: "region", id: "foil", s: 0, part: "Gold foil", shape: "rect", x: 310, y: 80, w: 8, h: 240, fill: "#fde68a", stroke: "ink" },
      { t: "region", id: "screen", s: 0, part: "Screen", shape: "rect", x: 560, y: 60, w: 14, h: 280, fill: "#e0f2fe", stroke: "ink" },
      { t: "arrow", id: "straight-1", s: 1, part: "Most pass through", from: { x: 95, y: 190 }, to: { x: 555, y: 190 }, stroke: "ink" },
      { t: "arrow", id: "straight-2", s: 1, from: { x: 95, y: 210 }, to: { x: 555, y: 210 }, stroke: "ink" },
      { t: "arrow", id: "deflect", s: 2, part: "Deflected", from: { x: 95, y: 230 }, to: { x: 555, y: 90 }, curved: true, stroke: "#d97706" },
      { t: "arrow", id: "back", s: 3, part: "Bounce back", from: { x: 300, y: 200 }, to: { x: 90, y: 120 }, curved: true, stroke: "#dc2626" },
      { t: "region", id: "nucleus", s: 3, part: "Nucleus", shape: "ellipse", cx: 314, cy: 200, rx: 5, ry: 5, fill: "#111827", stroke: "ink" },
    ],
  })!,
};

/** Supply and demand with a rightward supply shift. */
export const SUPPLY_DEMAND: FixtureBoard = {
  id: "econ-sd",
  title: "A supply shift",
  subject: "economics",
  script: "Price is on the vertical axis and quantity on the horizontal. Demand slopes down and supply slopes up, crossing at equilibrium. A fall in costs shifts supply right from S to S2. Equilibrium price falls from 8 to 5 and quantity rises from 4 to 7.",
  spec: parseDiagramSpec({
    v: 1, w: 640, h: 400, base: "none",
    elements: [
      { t: "axis", id: "market", s: 0, x: 80, y: 40, w: 480, h: 300, xLabel: "Quantity", yLabel: "Price", xMin: 0, xMax: 10, yMin: 0, yMax: 12 },
      { t: "series", id: "demand", s: 0, part: "Demand", axis: "market", stroke: "#2563eb", style: "line", points: [{ x: 1, y: 11 }, { x: 9, y: 3 }] },
      { t: "series", id: "supply", s: 0, part: "Supply S", axis: "market", stroke: "#dc2626", style: "line", points: [{ x: 2, y: 4 }, { x: 8, y: 12 }] },
      { t: "series", id: "supply-2", s: 1, part: "Supply S2", axis: "market", stroke: "#f97316", style: "line", dash: true, points: [{ x: 3, y: 1 }, { x: 9, y: 7 }] },
      { t: "label", id: "e1", s: 0, part: "E (4, 8)", text: "E (4, 8)", at: { x: 270, y: 140 }, leader: true },
      { t: "label", id: "e2", s: 1, part: "E2 (7, 5)", text: "E2 (7, 5)", at: { x: 420, y: 210 }, leader: true },
    ],
  })!,
};

export const FIXTURES: FixtureBoard[] = [ENERGY_BUDGET, THREE_CELL, OCEAN_CURRENTS, ITCZ, CHROMOSOME_SETS, BOUNDS_LINE, ALPHA_SCATTER, SUPPLY_DEMAND];

export function fixtureBoard(fix: FixtureBoard): CanvasBoardSpec {
  return board(fix);
}

export function fixtureById(id: string): FixtureBoard | undefined {
  return FIXTURES.find((f) => f.id === id);
}
