import { test } from "node:test";
import assert from "node:assert/strict";
import type { FigureComponent, FigureDrawing, FigureParams, Pt } from "../figures/types";
import { partBounds } from "../figures/bounds";
import { rootHairCell } from "../figures/components/rootHairCell";
import { xylemPhloem } from "../figures/components/xylemPhloem";
import { guardCells } from "../figures/components/guardCells";
import { seedStructure } from "../figures/components/seedStructure";
import { windFlower } from "../figures/components/windFlower";

/** Every component and variant, with the parts that variant must build. */
const VARIANTS: Array<{ c: FigureComponent; params: FigureParams; parts: string[] }> = [
  { c: rootHairCell, params: {}, parts: ["root-hair", "cell-wall", "cell-membrane", "cytoplasm", "vacuole", "nucleus", "mitochondrion", "soil-particle", "water-uptake", "ion-uptake", "soil-water"] },
  { c: rootHairCell, params: { showUptake: false }, parts: ["root-hair", "cell-wall", "cell-membrane", "cytoplasm", "vacuole", "nucleus", "mitochondrion"] },
  { c: xylemPhloem, params: {}, parts: ["xylem-vessel", "lignin", "lumen", "pit", "end-wall", "water-flow", "sieve-tube", "sieve-plate", "companion-cell", "plasmodesmata", "translocation"] },
  { c: xylemPhloem, params: { view: "ts-stem" }, parts: ["epidermis", "cortex", "vascular-bundle", "phloem", "cambium", "xylem", "pith"] },
  { c: xylemPhloem, params: { view: "ts-root" }, parts: ["root-hair", "epidermis", "cortex", "endodermis", "xylem", "phloem"] },
  { c: guardCells, params: {}, parts: ["guard-cell", "stoma", "inner-wall", "outer-wall", "chloroplast", "vacuole", "nucleus", "epidermal-cell", "potassium", "water"] },
  { c: guardCells, params: { state: "closed" }, parts: ["guard-cell", "stoma", "inner-wall", "outer-wall", "chloroplast", "vacuole", "nucleus", "epidermal-cell", "potassium", "water"] },
  { c: guardCells, params: { state: "closed", showArrows: false }, parts: ["guard-cell", "stoma", "inner-wall", "outer-wall", "chloroplast", "vacuole", "nucleus", "epidermal-cell"] },
  { c: seedStructure, params: {}, parts: ["testa", "cotyledon", "radicle", "plumule", "micropyle", "hilum"] },
  { c: seedStructure, params: { view: "germinating" }, parts: ["testa", "cotyledon", "plumule", "radicle", "root-hair"] },
  { c: windFlower, params: {}, parts: ["anther", "filament", "stigma", "ovary", "bract", "pollen", "wind"] },
  { c: windFlower, params: { showPollen: false }, parts: ["anther", "filament", "stigma", "ovary", "bract"] },
];
const COMPONENTS = [rootHairCell, xylemPhloem, guardCells, seedStructure, windFlower];

/** The boxes of each shape of a part (one per shape, so a part drawn in several places is not one big box). */
function shapeBoxesOf(d: FigureDrawing, part: string) {
  return d.shapes.filter((s) => s.part === part).map((s) => partBounds({ ...d, shapes: [{ ...s, part: "x" }] }).get("x")!).filter(Boolean);
}
const inBox = (p: Pt, b: { x: number; y: number; w: number; h: number }, pad = 3) => p.x >= b.x - pad && p.x <= b.x + b.w + pad && p.y >= b.y - pad && p.y <= b.y + b.h + pad;

function checkDrawing(c: FigureComponent, d: FigureDrawing, label: string) {
  const declared = c.parts.map((p) => p.id);
  const built = d.parts.map((p) => p.id);
  for (const id of built) assert.ok(declared.includes(id), `${label}: ${id} is declared`);
  assert.equal(new Set(built).size, built.length, `${label}: part ids are unique`);
  assert.ok(d.w >= 560 && d.w <= 760 && d.h >= 260 && d.h <= 460, `${label}: size ${d.w}×${d.h} in 560–760 × 260–460`);
  for (const p of d.parts) {
    assert.ok(Number.isFinite(p.anchor.x) && Number.isFinite(p.anchor.y), `${label}: ${p.id} anchor finite`);
    assert.ok(p.anchor.x >= 0 && p.anchor.x <= d.w && p.anchor.y >= 0 && p.anchor.y <= d.h, `${label}: ${p.id} anchor inside ${d.w}×${d.h}`);
    assert.ok(p.name.length > 0 && p.name.length <= 34, `${label}: ${p.id} name fits a label (${p.name})`);
    assert.ok(/^[a-z]+(-[a-z]+)*$/.test(p.id), `${label}: ${p.id} is kebab-case`);
    // The leader must end ON the part: inside the box of one of that part's own shapes.
    const boxes = shapeBoxesOf(d, p.id);
    assert.ok(boxes.length > 0, `${label}: ${p.id} has shapes`);
    assert.ok(boxes.some((b) => inBox(p.anchor, b)), `${label}: ${p.id} anchor (${p.anchor.x}, ${p.anchor.y}) lies on one of its shapes`);
  }
  for (const s of d.shapes) {
    if (s.part) assert.ok(built.includes(s.part), `${label}: shape names an unbuilt part ${s.part}`);
    if (s.t === "text") {
      assert.ok(s.x >= 0 && s.x <= d.w && s.y >= 0 && s.y <= d.h && !/NaN|undefined/.test(s.text), `${label}: text "${s.text}" inside and finite`);
      assert.ok(s.size >= 14, `${label}: text "${s.text}" is at least 14`);
      // Text in the art is only symbols and values — never a part's name (the label engine names parts).
      assert.ok(!c.parts.some((p) => s.text.toLowerCase().includes(p.name.toLowerCase().replace(/ \(.*\)$/, ""))), `${label}: "${s.text}" is not a part name`);
    }
    if (s.t === "path") assert.ok(s.d.length > 0 && !/NaN|Infinity|undefined/.test(s.d), `${label}: path has finite numbers`);
    if (s.t === "circle") assert.ok([s.cx, s.cy, s.r].every(Number.isFinite), `${label}: circle finite`);
  }
}

test("every component and variant builds its parts, each anchored on its own shapes", () => {
  for (const v of VARIANTS) {
    const label = `${v.c.name} ${JSON.stringify(v.params)}`;
    const d = v.c.build(v.params);
    checkDrawing(v.c, d, label);
    assert.deepEqual(d.parts.map((p) => p.id).sort(), [...v.parts].sort(), `${label}: the expected parts`);
  }
  // Across its variants, every declared part of every component is drawn somewhere.
  for (const c of COMPONENTS) {
    const seen = new Set(VARIANTS.filter((v) => v.c === c).flatMap((v) => c.build(v.params).parts.map((p) => p.id)));
    for (const p of c.parts) assert.ok(seen.has(p.id), `${c.name}: ${p.id} is built by some variant`);
  }
});

test("missing, odd and hostile params never throw and still draw", () => {
  const junk: FigureParams[] = [
    {},
    { view: "banana", state: 42, showUptake: "maybe", showPollen: "no", showArrows: -1 },
    { view: "<script>alert(1)</script>", state: "", section: "TS ROOT" },
    { view: 1e9, state: "CLOSED!!", showUptake: 0, stage: "germinating seedling" },
    { state: "night", view: "Transverse section of the stem" },
  ];
  for (const c of COMPONENTS) for (const p of junk) {
    const d = c.build(p);
    checkDrawing(c, d, `${c.name} ${JSON.stringify(p)}`);
    assert.ok(d.parts.length >= 4 && d.shapes.length >= 8, `${c.name}: still a full drawing`);
  }
  // Hostile input cannot reach the art as text.
  for (const c of COMPONENTS) for (const s of c.build({ view: "<script>", state: "<b>" }).shapes) if (s.t === "text") assert.ok(!/[<>]/.test(s.text));
});

test("root hair cell: no chloroplasts; soil, water and ions only with showUptake", () => {
  assert.ok(!rootHairCell.parts.some((p) => /chloroplast/.test(p.id)), "a root cell has no chloroplasts");
  const withSoil = rootHairCell.build({});
  const alone = rootHairCell.build({ showUptake: "false" });
  assert.ok(withSoil.shapes.filter((s) => s.part === "soil-particle").length >= 6, "several soil particles");
  assert.ok(!alone.shapes.some((s) => s.part === "soil-particle" || s.part === "water-uptake"));
  // The hair is long: it reaches well over half the figure's width.
  const hair = partBounds(withSoil).get("root-hair")!;
  assert.ok(hair.w > withSoil.w * 0.5, "a long root hair");
  const texts = withSoil.shapes.flatMap((s) => (s.t === "text" ? [s.text] : []));
  assert.ok(texts.includes("H₂O"));
});

test("xylem and phloem: the plan diagrams put the tissues in the right places", () => {
  const stem = xylemPhloem.build({ view: "ts-stem" });
  const centre = { x: stem.w / 2, y: stem.h / 2 };
  const r = (id: string, d: FigureDrawing) => { const a = d.parts.find((p) => p.id === id)!.anchor; return Math.hypot(a.x - centre.x, a.y - centre.y); };
  assert.ok(r("phloem", stem) > r("cambium", stem) && r("cambium", stem) > r("xylem", stem), "stem bundle: phloem outside, cambium between, xylem inside");
  assert.ok(r("pith", stem) < r("xylem", stem), "pith in the middle");
  assert.equal(stem.shapes.filter((s) => s.part === "xylem").length, 8, "a ring of vascular bundles");
  const root = xylemPhloem.build({ view: "ts-root" });
  const xylem = partBounds(root).get("xylem")!;
  assert.ok(inBox(centre, xylem, 0), "root: xylem at the centre");
  assert.ok(!root.parts.some((p) => p.id === "pith"), "a dicot root has no pith");
  const cells = xylemPhloem.build({});
  assert.equal(cells.shapes.filter((s) => s.part === "sieve-plate" && s.t === "path" && s.stroke !== "none" && s.fill !== "none").length >= 2, true, "at least two sieve plates");
  assert.ok(cells.shapes.filter((s) => s.part === "lignin").length >= 8, "spiral lignin along the vessel");
});

test("guard cells: open is turgid with a wide pore and K⁺/water moving in; closed is the reverse", () => {
  const open = guardCells.build({ state: "open" });
  const closed = guardCells.build({ state: "closed" });
  const name = (d: FigureDrawing, id: string) => d.parts.find((p) => p.id === id)!.name;
  assert.match(name(open, "guard-cell"), /turgid/);
  assert.match(name(closed, "guard-cell"), /flaccid/);
  assert.match(name(open, "potassium"), /in/);
  assert.match(name(closed, "potassium"), /out/);
  assert.match(name(open, "water"), /enters/);
  assert.match(name(closed, "water"), /leaves/);
  const poreW = (d: FigureDrawing) => partBounds(d).get("stoma")!.w;
  assert.ok(poreW(open) > 60 && poreW(closed) < 10, `pore ${poreW(open)} open vs ${poreW(closed)} closed`);
  // The arrowheads (filled triangles; the tip is the first point) point into the cells when opening.
  const tipX = (d: FigureDrawing, part: string) => {
    const head = d.shapes.find((s) => s.part === part && s.t === "path" && s.fill !== "none" && /^M[\d.]+ [\d.]+ L[\d.]+ [\d.]+ L/.test(s.d));
    return Number(/^M([\d.]+)/.exec((head as { d: string }).d)![1]);
  };
  const mid = open.w / 2;
  for (const part of ["potassium", "water"]) assert.ok(Math.abs(tipX(open, part) - mid) < Math.abs(tipX(closed, part) - mid), `${part}: in when open, out when closed`);
  assert.equal(stateName(guardCells.build({ state: "flaccid" })), "flaccid");
  assert.equal(stateName(guardCells.build({ state: "turgid" })), "turgid");
});
const stateName = (d: FigureDrawing) => (/turgid/.test(d.parts.find((p) => p.id === "guard-cell")!.name) ? "turgid" : "flaccid");

test("seed: the embryo lies inside the testa, the radicle points at the micropyle", () => {
  const d = seedStructure.build({});
  const testa = partBounds(d).get("testa")!;
  for (const id of ["radicle", "plumule", "cotyledon", "micropyle", "hilum"]) assert.ok(inBox(d.parts.find((p) => p.id === id)!.anchor, testa, 0), `${id} inside the seed`);
  const radicle = partBounds(d).get("radicle")!;
  const mic = d.parts.find((p) => p.id === "micropyle")!.anchor;
  assert.ok(inBox(mic, radicle, 16), "micropyle at the radicle's tip");
  const g = seedStructure.build({ view: "germinating" });
  const root = partBounds(g).get("radicle")!, shoot = partBounds(g).get("plumule")!;
  assert.ok(root.y + root.h > g.h * 0.85, "the root grows down");
  assert.ok(shoot.y < g.h * 0.12, "the shoot grows up");
  const hairs = partBounds(g).get("root-hair")!;
  assert.ok(hairs.y > root.y + root.h * 0.4 && hairs.y + hairs.h < root.y + root.h, "root hairs behind the tip, not at it");
});

test("wind flower: anthers and stigmas hang outside the bracts; no petals", () => {
  const d = windFlower.build({});
  assert.ok(!windFlower.parts.some((p) => /petal/.test(p.id)), "no petal part");
  const b = partBounds(d);
  const bracts = shapeBoxesOf(d, "bract").reduce((u, x) => ({ x0: Math.min(u.x0, x.x), x1: Math.max(u.x1, x.x + x.w), y0: Math.min(u.y0, x.y) }), { x0: Infinity, x1: -Infinity, y0: Infinity });
  for (const a of shapeBoxesOf(d, "anther")) assert.ok(a.x + a.w < bracts.x0 || a.x > bracts.x1, "each anther hangs outside the flower");
  assert.ok(b.get("stigma")!.y < bracts.y0 - 80, "stigmas reach well above the bracts");
  assert.ok(shapeBoxesOf(d, "anther").length >= 6, "three stamens, two pollen sacs each");
  assert.ok(d.shapes.filter((s) => s.part === "pollen" && s.t === "circle").length >= 6, "pollen grains");
});

test("match: the right boards ask for these figures, and others do not", () => {
  const yes: Array<[FigureComponent, string]> = [
    [rootHairCell, "Root hair cells and the uptake of water"], [rootHairCell, "How a root hair absorbs mineral ions by active transport"], [rootHairCell, "Absorption of water by the roots"],
    [xylemPhloem, "Structure of xylem vessels and phloem sieve tubes"], [xylemPhloem, "Companion cells and sieve plates"], [xylemPhloem, "Transverse section of a dicot stem"], [xylemPhloem, "Translocation of sucrose from source to sink"],
    [guardCells, "How guard cells open and close the stomata"], [guardCells, "Stomatal opening and potassium ions"], [guardCells, "Opening of stomata in the light"],
    [seedStructure, "Structure of a bean seed"], [seedStructure, "The radicle and plumule of the embryo"], [seedStructure, "Conditions needed for the germination of seeds"],
    [windFlower, "Features of wind-pollinated flowers"], [windFlower, "Grass flowers are pollinated by the wind"], [windFlower, "Why the stigmas are feathery: anemophily"],
  ];
  for (const [c, text] of yes) assert.ok(c.match.test(text), `${c.name} should match "${text}"`);
  const no: Array<[FigureComponent, string]> = [
    [rootHairCell, "Structure of an animal cell"], [rootHairCell, "Water potential and osmosis in potato cylinders"], [rootHairCell, "Plant cell organelles: chloroplasts and the cell wall"], [rootHairCell, "Hair follicles in the skin"],
    [xylemPhloem, "The structure of the heart"], [xylemPhloem, "Blood vessels: arteries, veins and capillaries"], [xylemPhloem, "Translation of mRNA at the ribosome"], [xylemPhloem, "Plant cell structure"],
    [guardCells, "Digestion in the stomach"], [guardCells, "The structure of a leaf: palisade mesophyll"], [guardCells, "White blood cells and phagocytosis"], [guardCells, "Closing the gap between rich and poor"],
    [seedStructure, "Seed dispersal by animals"], [seedStructure, "Monocotyledons and dicotyledons compared"], [seedStructure, "The pollen grain germinates and a pollen tube grows to the ovule"], [seedStructure, "Mitosis in cells"],
    [windFlower, "Insect-pollinated flowers have large bright petals"], [windFlower, "Wind turbines and renewable energy"], [windFlower, "Seed dispersal by the wind"], [windFlower, "Self-pollination and cross-pollination"],
  ];
  for (const [c, text] of no) assert.ok(!c.match.test(text), `${c.name} should not match "${text}"`);
});
