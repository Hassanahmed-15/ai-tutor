import { test } from "node:test";
import assert from "node:assert/strict";
import type { FigureComponent, FigureDrawing, FigureParams, FigureShape } from "../figures/types";
import { partBounds, shapeBoxes } from "../figures/bounds";
import { gametes } from "../figures/components/gametes";
import { chromosome } from "../figures/components/chromosome";
import { sarcomere, sarcomereBands, sarcomereLength, THICK_UM } from "../figures/components/sarcomere";
import { gelElectrophoresis, gelData, migration, parseSamples, parseSizes } from "../figures/components/gelElectrophoresis";
import { microscopeGraticule, graticuleCalibration } from "../figures/components/microscopeGraticule";

const COMPONENTS: FigureComponent[] = [gametes, chromosome, sarcomere, gelElectrophoresis, microscopeGraticule];

const VARIANTS: Array<[FigureComponent, FigureParams]> = [
  [gametes, {}], [gametes, { show: "sperm" }], [gametes, { show: "egg" }], [gametes, { show: "both" }],
  [chromosome, {}], [chromosome, { duplicated: false }], [chromosome, { inset: false }], [chromosome, { duplicated: "false", inset: "no" }],
  [sarcomere, {}], [sarcomere, { state: "contracted" }], [sarcomere, { state: "relaxed", values: false }], [sarcomere, { length: 2.0 }], [sarcomere, { length: "3.0 µm" }],
  [gelElectrophoresis, {}], [gelElectrophoresis, { samples: "Sample X: 600, 200" }], [gelElectrophoresis, { direction: "up" }],
  [gelElectrophoresis, { ladder: "1500; 1000; 700; 500; 300; 100", samples: "Crime scene: 700, 300; Suspect A: 1000, 500; Suspect B: 700, 300; Victim: 1500, 100; Child: 1.5 kb, 300; Parent: 100" }],
  [microscopeGraticule, {}], [microscopeGraticule, { graticuleDivisions: 100, micrometerDivisions: 25, micrometerDivision: "0.01 mm" }],
  [microscopeGraticule, { graticuleDivisions: 20, micrometerDivisions: 2, showCalculation: false }], [microscopeGraticule, { graticuleDivisions: 7, micrometerDivisions: 3, alignFrom: 90 }],
];

/** The anchor lies on one of that part's own shapes (its box, or within a circle). */
function onOwnShape(d: FigureDrawing, id: string, a: { x: number; y: number }): boolean {
  const pad = 4;
  return d.shapes.some((sh) => {
    if (sh.part !== id) return false;
    if (sh.t === "circle") return Math.hypot(a.x - sh.cx, a.y - sh.cy) <= sh.r + pad;
    // Each shape measured on its own, so a thin line (zero-width box) counts too.
    const box = partBounds({ ...d, shapes: [sh] }).get(id);
    return Boolean(box && a.x >= box.x - pad && a.x <= box.x + box.w + pad && a.y >= box.y - pad && a.y <= box.y + box.h + pad);
  });
}

function checkDrawing(c: FigureComponent, d: FigureDrawing, label: string) {
  const declared = c.parts.map((p) => p.id);
  const built = d.parts.map((p) => p.id);
  for (const id of built) assert.ok(declared.includes(id), `${label}: ${id} is declared`);
  assert.equal(new Set(built).size, built.length, `${label}: part ids are unique`);
  for (const p of d.parts) {
    assert.ok(Number.isFinite(p.anchor.x) && Number.isFinite(p.anchor.y), `${label}: ${p.id} anchor finite`);
    assert.ok(p.anchor.x >= 0 && p.anchor.x <= d.w && p.anchor.y >= 0 && p.anchor.y <= d.h, `${label}: ${p.id} anchor inside ${d.w}×${d.h}`);
    assert.ok(p.name.length > 0 && p.name.length <= 34, `${label}: ${p.id} name fits a label (${p.name})`);
    assert.ok(onOwnShape(d, p.id, p.anchor), `${label}: ${p.id} anchor (${p.anchor.x}, ${p.anchor.y}) is on its own shape`);
  }
  for (const s of d.shapes) {
    if (s.part) assert.ok(built.includes(s.part), `${label}: shape names an unbuilt part ${s.part}`);
    if (s.t === "text") {
      assert.ok(s.x >= 0 && s.x <= d.w && s.y >= 0 && s.y <= d.h && !/NaN|undefined|Infinity/.test(s.text), `${label}: text "${s.text}" inside and finite`);
      assert.ok(s.size >= 14, `${label}: text "${s.text}" is at least 14 (${s.size})`);
      // No part's name written into the art: labels come from the label engine.
      for (const p of c.parts) assert.ok(!new RegExp(`^${p.name.replace(/[()]/g, "\\$&")}$`, "i").test(s.text), `${label}: "${s.text}" is a part name in the art`);
    }
    if (s.t === "path") assert.ok(s.d.length > 0 && !/NaN|Infinity|undefined/.test(s.d), `${label}: path has finite numbers`);
    if (s.t === "circle") assert.ok([s.cx, s.cy, s.r].every(Number.isFinite), `${label}: circle finite`);
    if (s.width !== undefined && s.t !== "text") assert.ok(s.width >= 1 && s.width <= 2.6, `${label}: stroke width ${s.width}`);
  }
  assert.ok(d.w >= 560 && d.w <= 760 && d.h >= 260 && d.h <= 460, `${label}: size ${d.w}×${d.h} within 560–760 × 260–460`);
}
const texts = (d: FigureDrawing) => d.shapes.flatMap((s) => (s.t === "text" ? [s.text] : []));
const ofPart = (d: FigureDrawing, id: string) => d.shapes.filter((s) => s.part === id);
const boxesOf = (d: FigureDrawing, id: string) => shapeBoxes(d).filter((b) => b.part === id).map((b) => b.box);
/** A path's first point. */
const startOf = (s: FigureShape) => {
  const m = s.t === "path" ? /^M(-?[\d.]+) (-?[\d.]+)/.exec(s.d) : null;
  return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: NaN, y: NaN };
};

test("every variant builds cleanly: declared parts, anchors on their own shapes, text ≥ 14, no part names in the art", () => {
  for (const [c, p] of VARIANTS) checkDrawing(c, c.build(p), `${c.name} ${JSON.stringify(p)}`);
});

test("the default drawing of each component builds every declared part", () => {
  for (const c of COMPONENTS) {
    const d = c.build({});
    assert.deepEqual(d.parts.map((p) => p.id).sort(), c.parts.map((p) => p.id).sort(), `${c.name}: all parts`);
  }
});

test("hostile params never throw and still draw", () => {
  const junk: FigureParams[] = [
    { show: 42, duplicated: "maybe", state: "<script>", values: "x" },
    { length: -9, sarcomereLength: "NaN", state: 7 },
    { ladder: "", samples: "" },
    { ladder: "abc; -5; 1e99", samples: ": ; ::; Sample: ; X: zero" },
    { ladder: 300, samples: 12, direction: 5 },
    { samples: "A: 1; B: 99999999; C: 50000, 50000, 50000" },
    { graticuleDivisions: 0, micrometerDivisions: -4, micrometerDivision: "lots", graticuleTotal: 1e9 },
    { graticuleDivisions: "1e9", micrometerDivisions: 1e9, alignFrom: -50 },
    { graticuleDivisions: 3, micrometerDivisions: 900 },
    { inset: "maybe", show: "" },
  ];
  for (const c of COMPONENTS) for (const p of junk) checkDrawing(c, c.build(p), `${c.name} ${JSON.stringify(p)}`);
});

test("gametes: sperm, egg or both, and a size note only when they stand side by side", () => {
  const sperm = gametes.build({ show: "sperm" });
  assert.deepEqual(sperm.parts.map((p) => p.id).sort(), ["acrosome", "flagellum", "midpiece", "mitochondria", "sperm-nucleus"]);
  const egg = gametes.build({ show: "egg cell" });
  assert.deepEqual(egg.parts.map((p) => p.id).sort(), ["cytoplasm", "egg-membrane", "egg-nucleus", "jelly-coat", "yolk"]);
  const both = gametes.build({});
  assert.equal(both.parts.length, 10);
  assert.ok(texts(both).some((t) => /not to scale/i.test(t) && /0\.1 mm/.test(t)), "the note gives the egg's real size");
  assert.equal(texts(sperm).length + texts(egg).length, 0, "single cells carry no text");
  // The egg is drawn far larger than the sperm head; the midpiece holds several mitochondria.
  const eggBox = boxesOf(both, "jelly-coat")[0], headBox = boxesOf(both, "sperm-nucleus")[0];
  assert.ok(eggBox.w > 5 * headBox.w, "egg much wider than the sperm's nucleus");
  assert.ok(ofPart(both, "mitochondria").length >= 5, "a spiral of mitochondria");
  assert.ok(ofPart(both, "yolk").length >= 15, "energy stores scattered through the cytoplasm");
  // Two haploid nuclei, each pointed at its own cell.
  assert.ok(both.parts.find((p) => p.id === "sperm-nucleus")!.anchor.x < both.w / 2 && both.parts.find((p) => p.id === "egg-nucleus")!.anchor.x > both.w / 2);
});

test("chromosome: two sister chromatids with four telomeres, or one chromatid with two", () => {
  const dup = chromosome.build({});
  assert.equal(ofPart(dup, "chromatid").length, 2);
  assert.equal(ofPart(dup, "telomere").length, 4);
  assert.equal(ofPart(dup, "centromere").length, 1);
  assert.ok(ofPart(dup, "histone").length + ofPart(dup, "nucleosome").filter((s) => s.t === "circle").length >= 4, "beads of histones in the inset");
  const single = chromosome.build({ duplicated: false });
  assert.equal(ofPart(single, "chromatid").length, 1);
  assert.equal(ofPart(single, "telomere").length, 2);
  assert.match(single.parts.find((p) => p.id === "chromatid")!.name, /one chromatid/);
  const bare = chromosome.build({ inset: false });
  assert.deepEqual(bare.parts.map((p) => p.id).sort(), ["centromere", "chromatid", "telomere"]);
  // The centromere is where the sisters meet: between their two boxes' centres.
  const [a, b] = boxesOf(dup, "chromatid");
  const cen = dup.parts.find((p) => p.id === "centromere")!.anchor;
  assert.ok(cen.y > a.y && cen.y < a.y + a.h && Math.min(a.x, b.x) < cen.x && cen.x < Math.max(a.x + a.w, b.x + b.w));
});

test("sarcomere: contraction shortens the I band and H zone, never the A band", () => {
  const relaxed = sarcomereBands(sarcomereLength({ state: "relaxed" }));
  const contracted = sarcomereBands(sarcomereLength({ state: "contracted" }));
  assert.equal(relaxed.sarcomere, 2.8);
  assert.equal(contracted.sarcomere, 2.2);
  assert.equal(relaxed.aBand, contracted.aBand);
  assert.equal(relaxed.aBand, THICK_UM);
  assert.ok(contracted.iBand < relaxed.iBand && contracted.hZone < relaxed.hZone);
  assert.ok(Math.abs(relaxed.iBand - 1.2) < 1e-9 && Math.abs(relaxed.hZone - 0.9) < 1e-9);
  assert.ok(Math.abs(contracted.iBand - 0.6) < 1e-9 && Math.abs(contracted.hZone - 0.3) < 1e-9);
  // Sarcomere = A band + I band (half an I band at each end).
  for (const b of [relaxed, contracted]) assert.ok(Math.abs(b.aBand + b.iBand - b.sarcomere) < 1e-9);
  assert.equal(sarcomereLength({ length: "2.5 µm", state: "contracted" }), 2.5, "an explicit length wins");
  assert.equal(sarcomereLength({ length: 9 }), 3.0, "held to a physiological range");

  // The drawn brackets agree: measure each band's first bracket in both drawings (same scale).
  const width = (d: FigureDrawing, id: string) => {
    const bracket = d.shapes.find((s) => s.part === id && s.t === "path" && s.stroke === "ink")!;
    return shapeBoxes({ ...d, shapes: [bracket] })[0].box.w;
  };
  const R = sarcomere.build({ state: "relaxed" }), Cn = sarcomere.build({ state: "contracted" });
  assert.ok(Math.abs(width(R, "a-band") - width(Cn, "a-band")) < 0.01, "A band unchanged");
  assert.ok(width(Cn, "i-band") < width(R, "i-band") - 30, "I band shorter");
  assert.ok(width(Cn, "h-zone") < width(R, "h-zone") - 30, "H zone shorter");
  assert.ok(width(Cn, "sarcomere") < width(R, "sarcomere") - 30, "Z lines closer");
  assert.ok(Math.abs(width(R, "i-band") / width(R, "a-band") - 1.2 / 1.6) < 0.01, "drawn to scale");
  assert.ok(texts(Cn).includes("0.6 µm") && texts(Cn).includes("1.6 µm") && texts(Cn).includes("0.3 µm") && texts(Cn).includes("2.2 µm"));
  assert.equal(texts(sarcomere.build({ values: false })).length, 0);
});

test("gel electrophoresis: bands placed by size on a log scale — shorter fragments run farther from the wells", () => {
  assert.deepEqual(parseSizes("1000; 800 bp, 1.5 kb, junk, 5"), [1500, 1000, 800]);
  assert.deepEqual(parseSamples("Sample X: 600, 200; Sample Y: 800"), [{ name: "Sample X", sizes: [600, 200] }, { name: "Sample Y", sizes: [800] }]);
  assert.deepEqual(parseSamples("400, 100").map((l) => l.name), ["Sample 1"]);
  const data = gelData({});
  assert.deepEqual(data.ladder, [1000, 800, 600, 400, 200]);
  assert.ok(migration(200, data.hi, data.lo) > migration(600, data.hi, data.lo));
  // Log scale: equal size ratios give equal distances.
  const d1 = migration(400, data.hi, data.lo) - migration(800, data.hi, data.lo), d2 = migration(200, data.hi, data.lo) - migration(400, data.hi, data.lo);
  assert.ok(Math.abs(d1 - d2) < 1e-9);

  for (const direction of ["down", "up"]) {
    const d = gelElectrophoresis.build({ samples: "Sample X: 600, 200", direction });
    const wellY = startOf(ofPart(d, "wells")[0]).y;
    const bands = ofPart(d, "band").map((s) => startOf(s).y + 4); // each band's centre line
    assert.equal(bands.length, 2);
    const [y600, y200] = bands;
    assert.ok(Math.abs(y200 - wellY) > Math.abs(y600 - wellY), `${direction}: 200 bp farther from the wells than 600 bp`);
    // The ladder's 600 bp band lies level with the sample's 600 bp band.
    const ladder600 = ofPart(d, "ladder").filter((s) => s.t === "path" && s.fill === "#6d28d9").map((s) => startOf(s).y + 4);
    assert.ok(ladder600.some((y) => Math.abs(y - y600) < 0.01));
    // The negative electrode is at the wells' end, the positive at the far end.
    const neg = d.parts.find((p) => p.id === "negative-electrode")!.anchor.y, pos = d.parts.find((p) => p.id === "positive-electrode")!.anchor.y;
    assert.ok(Math.abs(neg - wellY) < Math.abs(pos - wellY));
    assert.ok(texts(d).includes("−") && texts(d).includes("+") && texts(d).includes("600 bp") && texts(d).includes("Sample X"));
  }
  const long = gelElectrophoresis.build({ samples: "Crime scene sample: 700; Suspect A: 500" });
  assert.ok(texts(long).every((t) => t.length <= 13), "long lane names wrap rather than run into the next lane");
});

test("graticule: 40 eyepiece units = 10 × 10 µm, so one eyepiece unit is 2.5 µm, and the drawn lines coincide", () => {
  const cal = graticuleCalibration({});
  assert.equal(cal.umPerUnit, 2.5);
  assert.equal(graticuleCalibration({ graticuleDivisions: 100, micrometerDivisions: 25, micrometerDivision: "0.01 mm" }).umPerUnit, 2.5);
  assert.equal(graticuleCalibration({ graticuleDivisions: 20, micrometerDivisions: 2 }).umPerUnit, 1);
  assert.equal(graticuleCalibration({ micrometerDivision: "0.1 mm" }).micrometerUm, 100);
  const d = microscopeGraticule.build({});
  assert.ok(texts(d).some((t) => t === "1 eyepiece unit = 100 µm ÷ 40 = 2.5 µm"));
  assert.ok(texts(d).includes("40 eyepiece units") && texts(d).includes("10 µm"));
  // Both coinciding lines carry a graticule tick and a micrometer line at the same x.
  const xs = (id: string) => ofPart(d, id).filter((s) => s.t === "path").flatMap((s) => [...(s as { d: string }).d.matchAll(/M(-?[\d.]+) /g)].map((m) => Number(m[1])));
  const coincide = ofPart(d, "coinciding-lines").filter((s) => s.t === "path" && s.dash).map((s) => startOf(s).x);
  assert.equal(coincide.length, 2);
  for (const x of coincide) {
    assert.ok(xs("graticule").some((g) => Math.abs(g - x) < 0.02), `graticule tick at ${x}`);
    assert.ok(xs("stage-micrometer").some((m) => Math.abs(m - x) < 0.02), `micrometer line at ${x}`);
  }
  // 10 micrometer divisions between them.
  const between = xs("stage-micrometer").filter((m) => m > coincide[0] + 0.5 && m < coincide[1] - 0.5);
  assert.equal(new Set(between.map((m) => m.toFixed(1))).size, 9, "nine lines strictly between = ten divisions");
  assert.ok(!texts(microscopeGraticule.build({ showCalculation: false })).some((t) => /= .*µm$/.test(t) && t.startsWith("1 eyepiece")));
});

test("match: these figures fire on their own boards and not on other biology", () => {
  const yes: Array<[FigureComponent, string]> = [
    [gametes, "Adaptations of the sperm cell and the egg cell"], [gametes, "Gametes are haploid sex cells"], [gametes, "The acrosome releases enzymes to digest the jelly coat"],
    [chromosome, "Structure of a chromosome: sister chromatids and the centromere"], [chromosome, "DNA is wound round histone proteins"], [chromosome, "Telomeres protect the ends of chromosomes"],
    [sarcomere, "The sliding filament model of muscle contraction"], [sarcomere, "Structure of a sarcomere"], [sarcomere, "Actin and myosin filaments overlap in the A band"],
    [gelElectrophoresis, "Separating DNA fragments by gel electrophoresis"], [gelElectrophoresis, "Reading a DNA ladder"], [gelElectrophoresis, "Genetic fingerprinting at a crime scene"],
    [microscopeGraticule, "Calibrating an eyepiece graticule with a stage micrometer"], [microscopeGraticule, "Measuring cells in eyepiece units"], [microscopeGraticule, "Using a stage micrometer"],
  ];
  for (const [c, text] of yes) assert.ok(c.match.test(text), `${c.name} should match "${text}"`);
  const no: Array<[FigureComponent, string]> = [
    [gametes, "The structure of a plant cell"], [gametes, "Muscle contraction needs ATP"], [gametes, "Sperm whales dive to great depths"], [gametes, "Egg-laying in birds and reptiles"],
    [chromosome, "Cell membrane structure"], [chromosome, "DNA replication is semi-conservative"], [chromosome, "Photosynthesis in the leaf"],
    [sarcomere, "Muscle tissue and movement"], [sarcomere, "The heart pumps blood"], [sarcomere, "Bands of the electromagnetic spectrum"], [sarcomere, "Smooth muscle in the gut wall"],
    [gelElectrophoresis, "The structure of DNA"], [gelElectrophoresis, "Paper chromatography of plant pigments"], [gelElectrophoresis, "Habitat fragmentation threatens species"], [gelElectrophoresis, "Silica gel keeps samples dry"],
    [microscopeGraticule, "Using a light microscope to view onion cells"], [microscopeGraticule, "Magnification = image size ÷ actual size"], [microscopeGraticule, "Enzymes and the active site"],
  ];
  for (const [c, text] of no) assert.ok(!c.match.test(text), `${c.name} should not match "${text}"`);
});
