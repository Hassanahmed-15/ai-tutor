import test from "node:test";
import assert from "node:assert/strict";
import { mandatoryLabels, namedIn, partNameKey, samePartName, withMandatoryLabels } from "../canvas/labelPolicy";
import { anchorFit, drawnFigure } from "../figures/drawn";
import { FIGURE_COMPONENTS } from "../figures/registry";
import type { CanvasBoardSpec } from "../canvas/types";
import type { FigureComponent, FigureDrawing, FigureShape } from "../figures/types";

/** A w×h picture on off-white paper, with dark discs (cx, cy, r) drawn on it. */
function picture(w: number, h: number, discs: Array<[number, number, number]>): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < px.length; i += 4) { px[i] = 250; px[i + 1] = 248; px[i + 2] = 240; px[i + 3] = 255; }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!discs.some(([cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r)) continue;
      const i = (y * w + x) * 4;
      px[i] = 40; px[i + 1] = 60; px[i + 2] = 120;
    }
  }
  return px;
}
const inDisc = (p: { x: number; y: number }, [cx, cy, r]: [number, number, number]) => (p.x - cx) ** 2 + (p.y - cy) ** 2 <= r * r;

test("a point between two parts snaps to its OWN part, never onto the neighbour", async () => {
  const { snapPoint, snapToInk } = await import("../illustratedBoard");
  const left: [number, number, number] = [100, 100, 20];
  const right: [number, number, number] = [150, 100, 20];
  const px = picture(300, 200, [left, right]);
  // On the gap, a little nearer the RIGHT disc — but this point is the left part's: the right part's
  // own point is at the right disc's centre. The old nearest-ink snap took the right disc.
  const own = snapPoint(px, 300, 200, 126, 100, { others: [{ x: 150, y: 100 }] });
  assert.ok(own.onInk && inDisc(own, left), `lands on its own (left) part, got ${own.x.toFixed(0)},${own.y.toFixed(0)}`);
  // Without the neighbour's point it would have taken the nearer, wrong disc.
  assert.ok(inDisc(snapToInk(px, 300, 200, 126, 100), right));
});

test("a point far from any ink is not dragged across the picture: it stays and is marked off-ink", async () => {
  const { snapPoint } = await import("../illustratedBoard");
  const px = picture(300, 200, [[200, 100, 20]]);
  const far = snapPoint(px, 300, 200, 140, 100); // 40 px from the disc's edge (the old 70 px search reached it)
  assert.deepEqual(far, { x: 140, y: 100, onInk: false });
});

test("located parts: the snap is part-aware, and an unsure part is labelled only if the second look vouches for it", async () => {
  const { placeOnInk, applyChecks, trustedParts } = await import("../illustratedBoard");
  const a: [number, number, number] = [100, 100, 20];
  const b: [number, number, number] = [150, 100, 20];
  const px = picture(300, 200, [a, b]);
  const placed = placeOnInk(px, 300, 200, [
    { name: "atrium", x: 126, y: 100, confident: true },
    { name: "ventricle", x: 150, y: 100, confident: false },
  ]);
  assert.ok(inDisc({ x: placed[0].x * 300, y: placed[0].y * 200 }, a), "the atrium point stays on the atrium");
  assert.equal(placed[0].sure, true);
  assert.equal(placed[1].sure, false, "the locator was not confident");
  // No second look (timed out, failed): only the sure part is kept.
  assert.deepEqual(trustedParts(placed, null).map((p) => p.name), ["atrium"]);
  assert.deepEqual(trustedParts(placed, { parts: placed, verified: false }).map((p) => p.name), ["atrium"]);
  // The second look confirms the ventricle: both kept.
  const confirmed = applyChecks(px, 300, 200, placed, [{ n: 1, ok: true }, { n: 2, ok: true }]);
  assert.deepEqual(confirmed.parts.map((p) => p.name), ["atrium", "ventricle"]);
  // It rejects a part without saying where it is: that part is dropped, never labelled.
  const rejected = applyChecks(px, 300, 200, placed, [{ n: 1, ok: true }, { n: 2, ok: false }]);
  assert.deepEqual(rejected.parts.map((p) => p.name), ["atrium"]);
  assert.deepEqual(rejected.rejected, ["ventricle"]);
  // It moves a part onto bare paper far from any ink: dropped too.
  const lost = applyChecks(px, 300, 200, placed, [{ n: 1, ok: true }, { n: 2, ok: false, x: 260, y: 30 }]);
  assert.deepEqual(lost.parts.map((p) => p.name), ["atrium"]);
  // Not checked at all: an unsure part is dropped, a sure one kept.
  assert.deepEqual(applyChecks(px, 300, 200, placed, [{ n: 1, ok: true }]).parts.map((p) => p.name), ["atrium"]);
});

test("samePartName ignores case, punctuation, a leading 'the', bracketed asides and plurals", () => {
  assert.ok(samePartName("The Alveoli", "alveoli"));
  assert.ok(samePartName("Guard cells", "guard cell"));
  assert.ok(samePartName("pulmonary arteries", "Pulmonary artery"));
  assert.ok(samePartName("left-ventricle", "Left ventricle"));
  assert.ok(samePartName("Burette (hydrochloric acid)", "burette"));
  assert.ok(samePartName("right ventricle's wall", "Right ventricle wall"));
  assert.ok(!samePartName("left ventricle", "right ventricle"));
  assert.ok(!samePartName("", ""));
  assert.equal(partNameKey("  The   Xylem  Vessels. "), "xylem vessel");
});

test("a synonym or alias names a part: 'the main artery' is the aorta, 'leaf stalk' the petiole", () => {
  assert.ok(namedIn("Blood leaves through the main artery.", "Aorta"));
  assert.ok(namedIn("The leaf stalk joins the stem.", "Petiole (leaf stalk)"));
  assert.ok(namedIn("Oxygen crosses into the bloodstream here.", "Capillary network", ["bloodstream"]));
  assert.ok(!namedIn("The stomach churns food.", "Stomata"), "a prefix of another word is not a name");
  // A part's head noun alone names it when no other part shares it, and it is said bare.
  const parts = [{ id: "pa", name: "Pulmonary artery" }, { id: "lv", name: "Left ventricle" }, { id: "rv", name: "Right ventricle" }];
  assert.deepEqual(mandatoryLabels({ script: "Blood goes up the artery to the lungs." }, parts), ["pa"]);
  assert.deepEqual(mandatoryLabels({ script: "The coronary artery feeds the heart muscle." }, parts), [], "another artery is not this one");
  assert.deepEqual(mandatoryLabels({ script: "The ventricle contracts." }, parts), [], "ventricle names neither of two");
});

test("a figure's labels come from the parts it DRAWS for its params, not every part it could draw", () => {
  // A component with an optional part: "lid" is drawn only when lid=true.
  const fake: FigureComponent = {
    name: "test-jar",
    title: "A jar",
    params: "lid: boolean",
    match: /\bjar\b/,
    parts: [{ id: "lid", name: "Lid" }, { id: "body", name: "Jar body" }, { id: "base", name: "Base" }, { id: "label", name: "Paper band" }],
    build(params): FigureDrawing {
      const parts = [
        { id: "body", name: "Jar body", anchor: { x: 50, y: 50 } },
        { id: "base", name: "Base", anchor: { x: 50, y: 90 } },
        { id: "label", name: "Paper band", anchor: { x: 50, y: 60 } },
        ...(params.lid ? [{ id: "lid", name: "Lid", anchor: { x: 50, y: 10 } }] : []),
      ];
      return { w: 100, h: 100, shapes: [], parts };
    },
  };
  FIGURE_COMPONENTS.push(fake);
  try {
    // Aria names the lid, which these params do not draw: it is not labelled, and the three-label
    // minimum is met from parts that ARE drawn (the writer's "lid" choice is not one of them).
    const spec = { v: 1, heading: "Jar", notes: [], cues: [{ s: 0, action: "point", target: "lid" }], stage: { kind: "figure", component: "test-jar", params: { lid: false }, parts: [{ id: "lid", name: "Lid", s: 0 }, { id: "body", name: "Jar body", s: 0 }] } } as unknown as CanvasBoardSpec;
    const out = withMandatoryLabels(spec, { script: "The lid seals the jar. The base sits flat." });
    const ids = out.stage.kind === "figure" ? out.stage.parts.map((p) => p.id) : [];
    assert.ok(!ids.includes("lid"), `lid is not drawn, so not labelled (got ${ids.join(",")})`);
    assert.equal(ids.length, 2, "three labels, all on drawn parts");
    assert.equal(ids[0], "base", "the named, drawn part is labelled first");
    assert.equal(out.cues.length, 0, "the pen cue on the undrawn part is dropped");
    // With the lid drawn, the named lid IS labelled.
    const withLid = withMandatoryLabels({ ...spec, stage: { ...(spec.stage as object), params: { lid: true } } } as unknown as CanvasBoardSpec, { script: "The lid seals the jar. The base sits flat." });
    assert.ok(withLid.stage.kind === "figure" && withLid.stage.parts.some((p) => p.id === "lid"));
  } finally {
    FIGURE_COMPONENTS.splice(FIGURE_COMPONENTS.indexOf(fake), 1);
  }
  // A library diagram: its asset's parts are what is drawn.
  const lib = { v: 1, heading: "Leaf", notes: [], cues: [], stage: { kind: "figure", component: "library", params: {}, parts: [{ id: "ghost", name: "Ghost", s: 0 }], asset: { id: "x", w: 10, h: 10, credit: "", parts: [{ id: "cuticle", name: "Cuticle", anchor: { x: 1, y: 1 } }, { id: "xylem", name: "Xylem", anchor: { x: 2, y: 2 } }] } } } as unknown as CanvasBoardSpec;
  const out = withMandatoryLabels(lib, { script: "Water rises in the xylem." });
  assert.deepEqual(out.stage.kind === "figure" ? out.stage.parts.map((p) => p.id) : [], ["xylem", "cuticle"]);
});

test("a drawn figure's anchor must be on its part's own ink, not just inside its bounding box", () => {
  // A curved river (an open curve) bends round a town (a closed disc). The river's bounding box
  // covers the town; the old box check let the river's anchor sit on the town.
  const base = {
    w: 400, h: 300,
    shapes: [
      { t: "curve", points: [[20, 50], [200, 260], [380, 50]], width: 3, stroke: "blue", part: "river" },
      { t: "circle", cx: 200, cy: 110, r: 30, fill: "sand", part: "town" },
      { t: "rect", x: 300, y: 200, w: 60, h: 40, fill: "green", part: "field" },
    ],
    parts: [
      { id: "river", name: "River", anchor: { x: 200, y: 110 } },
      { id: "town", name: "Town", anchor: { x: 200, y: 110 } },
      { id: "field", name: "Field", anchor: { x: 330, y: 220 } },
    ],
  };
  const bad = drawnFigure(base);
  assert.match(bad.issues.join(" "), /river.*not on its own shapes/, "the river's anchor on the town is rejected");
  assert.doesNotMatch(bad.issues.join(" "), /"town"'s anchor|"field"'s anchor/, "anchors inside their own filled shapes pass");
  // A few pixels off its own line is fixed by code, onto the line.
  const near = { ...base, shapes: [...base.shapes, { t: "line", x1: 20, y1: 280, x2: 380, y2: 280, part: "road" }], parts: [...base.parts.filter((p) => p.id !== "river"), { id: "road", name: "Road", anchor: { x: 100, y: 290 } }] };
  const fixed = drawnFigure(near);
  assert.deepEqual(fixed.issues, []);
  const road = fixed.drawing!.parts.find((p) => p.id === "road")!;
  assert.ok(Math.abs(road.anchor.y - 280) < 0.5, `moved onto the road (y=${road.anchor.y})`);
  // Inside a part's closed shape but on a smaller part drawn inside it: not on the part.
  const nested: FigureShape[] = [
    { t: "circle", cx: 100, cy: 100, r: 80, fill: "#bbf7d0", part: "cell" },
    { t: "circle", cx: 100, cy: 100, r: 25, fill: "#ddd6fe", part: "nucleus" },
  ];
  assert.equal(anchorFit(nested, "cell", { x: 100, y: 100 })!.distance > 3, true, "the nucleus covers the cell there");
  assert.equal(anchorFit(nested, "cell", { x: 150, y: 100 })!.distance, 0, "the cytoplasm is the cell");
  assert.equal(anchorFit(nested, "nucleus", { x: 100, y: 100 })!.distance, 0);
});
