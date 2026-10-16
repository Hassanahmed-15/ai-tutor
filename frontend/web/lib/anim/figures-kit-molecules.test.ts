import { test } from "node:test";
import assert from "node:assert/strict";
import type { FigureComponent, FigureDrawing, FigureParams } from "../figures/types";
import { partBounds } from "../figures/bounds";
import { glucoseRings } from "../figures/components/glucoseRings";
import { lipids } from "../figures/components/lipids";
import { aminoAcid, rGroup } from "../figures/components/aminoAcid";
import { atpNucleotide, parseBase } from "../figures/components/atpNucleotide";
import { oxygenDissociation, saturation, pressureAt, dissociationModel } from "../figures/components/oxygenDissociation";

const COMPONENTS: FigureComponent[] = [glucoseRings, lipids, aminoAcid, atpNucleotide, oxygenDissociation];

/** Every variant each component draws. */
const VARIANTS: Array<[FigureComponent, FigureParams]> = [
  [glucoseRings, {}], [glucoseRings, { show: "both" }], [glucoseRings, { show: "alpha" }], [glucoseRings, { show: "beta" }], [glucoseRings, { show: "maltose" }],
  [lipids, {}], [lipids, { show: "triglyceride", unsaturated: 0 }], [lipids, { show: "triglyceride", unsaturated: 2 }], [lipids, { show: "triglyceride", unsaturated: 3 }],
  [lipids, { show: "phospholipid" }], [lipids, { show: "phospholipid", unsaturated: 0 }], [lipids, { show: "bilayer" }],
  [aminoAcid, {}], [aminoAcid, { r: "serine" }], [aminoAcid, { r: "CH3" }], [aminoAcid, { show: "peptide" }], [aminoAcid, { show: "peptide", r1: "glycine", r2: "alanine" }], [aminoAcid, { show: "hydrolysis" }],
  [atpNucleotide, {}], [atpNucleotide, { sugar: "ribose", base: "U" }], [atpNucleotide, { base: "guanine" }], [atpNucleotide, { base: "C" }], [atpNucleotide, { show: "atp" }], [atpNucleotide, { show: "atp", hydrolysis: false }],
  [oxygenDissociation, {}], [oxygenDissociation, { bohr: true, lungs: true, tissues: true }], [oxygenDissociation, { fetal: true, myoglobin: true }], [oxygenDissociation, { p50Marker: true, steep: true, lungs: false, tissues: false }],
];

function checkDrawing(c: FigureComponent, d: FigureDrawing, label: string) {
  const declared = c.parts.map((p) => p.id);
  const built = d.parts.map((p) => p.id);
  for (const id of built) assert.ok(declared.includes(id), `${label}: ${id} is declared`);
  assert.equal(new Set(built).size, built.length, `${label}: part ids are unique`);
  assert.ok(d.w >= 560 && d.w <= 760 && d.h >= 260 && d.h <= 460, `${label}: size ${d.w}×${d.h} within 560–760 × 260–460`);
  // Each shape's own box (a straight vertical or horizontal line counts too).
  const boxes = d.shapes.flatMap((s) => {
    const b = s.part ? partBounds({ ...d, shapes: [s] }).get(s.part) : undefined;
    return b ? [{ part: s.part!, box: b }] : [];
  });
  for (const p of d.parts) {
    assert.ok(Number.isFinite(p.anchor.x) && Number.isFinite(p.anchor.y), `${label}: ${p.id} anchor finite`);
    assert.ok(p.anchor.x >= 0 && p.anchor.x <= d.w && p.anchor.y >= 0 && p.anchor.y <= d.h, `${label}: ${p.id} anchor inside ${d.w}×${d.h}`);
    assert.ok(p.name.length > 0 && p.name.length <= 34, `${label}: ${p.id} name fits a label (${p.name})`);
    // The anchor is on (or within a few units of) one of that part's own shapes.
    const tol = 8;
    const on = boxes.some(({ part, box: b }) => part === p.id && p.anchor.x >= b.x - tol && p.anchor.x <= b.x + b.w + tol && p.anchor.y >= b.y - tol && p.anchor.y <= b.y + b.h + tol);
    assert.ok(on, `${label}: ${p.id} anchor (${p.anchor.x}, ${p.anchor.y}) lies on a shape of that part`);
    assert.ok(d.shapes.some((s) => s.part === p.id), `${label}: ${p.id} has shapes to highlight`);
  }
  for (const s of d.shapes) {
    if (s.part) assert.ok(built.includes(s.part), `${label}: shape names an unbuilt part ${s.part}`);
    if (s.t === "text") {
      assert.ok(s.x >= 0 && s.x <= d.w && s.y >= 0 && s.y <= d.h && !/NaN|undefined/.test(s.text), `${label}: text "${s.text}" inside and finite`);
      assert.ok(s.size >= 14, `${label}: text "${s.text}" is at least 14 (${s.size})`);
    }
    if (s.t === "path") assert.ok(!/NaN|Infinity|undefined/.test(s.d), `${label}: path has finite numbers`);
    if (s.t === "circle") assert.ok([s.cx, s.cy, s.r].every(Number.isFinite), `${label}: circle finite`);
  }
}
const texts = (d: FigureDrawing) => d.shapes.flatMap((s) => (s.t === "text" ? [s.text] : []));
const part = (d: FigureDrawing, id: string) => d.parts.find((p) => p.id === id);

test("every component and variant builds, without NaN, every part anchored on its own shapes", () => {
  for (const [c, params] of VARIANTS) {
    const d = c.build(params);
    checkDrawing(c, d, `${c.name} ${JSON.stringify(params)}`);
    assert.ok(d.parts.length >= 3, `${c.name} ${JSON.stringify(params)}: ≥3 parts`);
  }
});

test("hostile or odd params never throw and still draw", () => {
  const junk: FigureParams[] = [
    { show: "nonsense", unsaturated: -9, r: "<script>", base: "Z", sugar: 7 },
    { show: 42, r1: "x".repeat(500), r2: "DROP TABLE", n: "abc", p50: -3 },
    { show: true, lungs: 999, tissues: -1, bohr: "maybe", fetal: "yes", myoglobin: 1 },
    { show: "", unsaturated: 1e9, hydrolysis: "nah", p50: 1e9, n: 1e9 },
    { show: "MALTOSE", unsaturated: "two", base: "uracil", sugar: "deoxyribose" },
    { lungs: "12", tissues: "3.5", p50Marker: "true", steep: 1, shift: 99 },
  ];
  for (const c of COMPONENTS) for (const p of junk) checkDrawing(c, c.build(p), `${c.name} ${JSON.stringify(p).slice(0, 80)}`);
});

test("glucose: α has the carbon-1 OH below the ring, β above; maltose joins C1–O–C4 and releases water", () => {
  const ohY = (d: FigureDrawing, id: string) => {
    const s = d.shapes.find((x) => x.t === "text" && x.part === id && x.text === "OH");
    assert.ok(s && s.t === "text", `${id} OH drawn`);
    return (s as Extract<typeof s, { t: "text" }>).y;
  };
  const a = glucoseRings.build({ show: "alpha" }), b = glucoseRings.build({ show: "beta" });
  assert.ok(ohY(a, "alpha-hydroxyl") > part(a, "carbon-1")!.anchor.y + 20, "α: OH on C1 is below the ring");
  assert.ok(ohY(b, "beta-hydroxyl") < part(b, "carbon-1")!.anchor.y - 20, "β: OH on C1 is above the ring");
  assert.ok(!a.parts.some((p) => p.id === "beta-hydroxyl") && !b.parts.some((p) => p.id === "alpha-hydroxyl"));
  // Both rings carry the same atoms otherwise: 5 OH (incl. CH₂OH) + ring O, carbons numbered 1–6.
  for (const d of [a, b]) {
    const t = texts(d);
    assert.equal(t.filter((x) => x === "OH" || x === "HO").length, 4, "four ring OH groups");
    assert.ok(t.includes("CH₂OH") && t.includes("O"));
    for (const n of ["1", "2", "3", "4", "5", "6"]) assert.ok(t.includes(n), `carbon ${n} numbered`);
  }
  const both = glucoseRings.build({ show: "both" });
  assert.ok(ohY(both, "alpha-hydroxyl") > part(both, "alpha-glucose")!.anchor.y, "α OH below its ring in the comparison");
  assert.ok(ohY(both, "beta-hydroxyl") < part(both, "beta-glucose")!.anchor.y, "β OH above its ring in the comparison");
  const m = glucoseRings.build({ show: "maltose" });
  assert.ok(["glycosidic-bond", "water", "condensation", "maltose", "alpha-glucose"].every((id) => part(m, id)));
  assert.ok(texts(m).includes("H₂O"));
  assert.ok(m.shapes.some((s) => s.t === "text" && s.part === "glycosidic-bond" && s.text === "O"), "the bridging O belongs to the glycosidic bond");
});

test("lipids: ester bonds, kinks only on unsaturated chains, a polar phosphate head, a full fluid mosaic", () => {
  const sat = lipids.build({ show: "triglyceride", unsaturated: 0 });
  assert.ok(!part(sat, "double-bond") && !part(sat, "unsaturated-chain") && part(sat, "saturated-chain"));
  const all = lipids.build({ show: "triglyceride", unsaturated: 3 });
  assert.ok(part(all, "double-bond") && part(all, "unsaturated-chain") && !part(all, "saturated-chain"));
  const tg = lipids.build({});
  assert.ok(["glycerol", "ester-bond", "saturated-chain", "unsaturated-chain", "double-bond", "water"].every((id) => part(tg, id)));
  assert.ok(texts(tg).includes("3H₂O"));
  assert.equal(tg.shapes.filter((s) => s.t === "text" && s.part === "ester-bond" && s.text === "O").length, 6, "three ester links, each –O–C(=O)–");
  const pl = lipids.build({ show: "phospholipid" });
  assert.ok(["phosphate-group", "glycerol", "hydrophilic-head", "hydrophobic-tails", "ester-bond"].every((id) => part(pl, id)));
  assert.ok(texts(pl).includes("P"));
  const bl = lipids.build({ show: "bilayer" });
  assert.ok(["hydrophilic-head", "hydrophobic-tails", "channel-protein", "carrier-protein", "glycoprotein", "glycolipid", "cholesterol"].every((id) => part(bl, id)));
  // Heads on both faces: the outer layer's heads above the tails, the inner layer's below.
  const heads = bl.shapes.filter((s) => s.t === "circle" && s.part === "hydrophilic-head") as Array<Extract<FigureDrawing["shapes"][number], { t: "circle" }>>;
  const ys = [...new Set(heads.map((h) => h.cy))];
  assert.equal(ys.length, 2, "two layers of heads");
  assert.ok(heads.length >= 30);
  assert.ok(texts(bl).filter((t) => t === "H₂O").length >= 4, "water on both sides");
});

test("amino acids: the general groups, R groups from names, condensation and hydrolysis of a peptide bond", () => {
  const g = aminoAcid.build({});
  assert.ok(["amine-group", "carboxyl-group", "r-group", "alpha-carbon", "hydrogen"].every((id) => part(g, id)));
  const t = texts(g);
  for (const s of ["N", "C", "OH", "O", "R", "H"]) assert.ok(t.includes(s), `general structure has ${s}`);
  assert.equal(rGroup("glycine", "R").text, "H");
  assert.equal(rGroup("Alanine", "R").text, "CH₃");
  assert.equal(rGroup("CH3", "R").text, "CH₃");
  assert.equal(rGroup("<b>bad</b>", "R").text, "R");
  assert.ok(texts(aminoAcid.build({ r: "serine" })).includes("CH₂OH"));
  const pep = aminoAcid.build({ show: "peptide", r1: "glycine", r2: "alanine" });
  assert.ok(["peptide-bond", "dipeptide", "water", "condensation", "amino-acid"].every((id) => part(pep, id)));
  assert.ok(texts(pep).includes("H₂O") && texts(pep).includes("CH₃"));
  assert.ok(part(pep, "water")!.name.includes("released"));
  const hyd = aminoAcid.build({ show: "hydrolysis" });
  assert.ok(part(hyd, "hydrolysis") && !part(hyd, "condensation") && part(hyd, "water")!.name.includes("added"));
  assert.ok(texts(hyd).includes("R₁") && texts(hyd).includes("R₂"));
});

test("nucleotides and ATP: the 2′ group follows the sugar, bases follow DNA/RNA, ATP → ADP + Pᵢ", () => {
  const c2Text = (d: FigureDrawing) => d.shapes.filter((s) => s.t === "text" && s.part === "c2-group").map((s) => (s as { text: string }).text);
  const dna = atpNucleotide.build({});
  assert.deepEqual(c2Text(dna), ["H"], "deoxyribose: only H on carbon 2′");
  assert.match(part(dna, "pentose-sugar")!.name, /Deoxyribose/);
  const rna = atpNucleotide.build({ sugar: "ribose" });
  assert.deepEqual(c2Text(rna), ["OH"], "ribose: OH on carbon 2′");
  assert.equal(parseBase("uracil"), "U");
  assert.equal(parseBase("Guanine"), "G");
  assert.equal(parseBase("Q"), undefined);
  assert.match(part(atpNucleotide.build({ base: "U" }), "pentose-sugar")!.name, /^Ribose/, "uracil → ribose");
  assert.match(part(atpNucleotide.build({ base: "T", sugar: "ribose" }), "nitrogenous-base")!.name, /uracil/, "no thymine in RNA");
  assert.match(part(atpNucleotide.build({ base: "G" }), "nitrogenous-base")!.name, /purine/);
  assert.match(part(atpNucleotide.build({ base: "C" }), "nitrogenous-base")!.name, /pyrimidine/);
  // A purine is two rings (5 + 6), a pyrimidine one.
  const rings = (d: FigureDrawing) => d.shapes.filter((s) => s.part === "nitrogenous-base" && s.t === "path" && s.d.endsWith("Z")).length;
  assert.equal(rings(atpNucleotide.build({ base: "A" })), 2);
  assert.equal(rings(atpNucleotide.build({ base: "C" })), 1);
  const atp = atpNucleotide.build({ show: "atp" });
  assert.ok(["adenine", "ribose", "phosphate-groups", "hydrolysed-bond", "water", "energy", "adp", "inorganic-phosphate"].every((id) => part(atp, id)));
  assert.equal(texts(atp).filter((x) => x === "P").length, 3 + 2, "ATP has three phosphates, ADP two");
  assert.ok(texts(atp).includes("Pᵢ") && texts(atp).includes("H₂O"));
  const alone = atpNucleotide.build({ show: "atp", hydrolysis: false });
  assert.equal(texts(alone).filter((x) => x === "P").length, 3);
  assert.ok(!part(alone, "adp") && !part(alone, "energy"));
});

test("oxygen dissociation: Hill-equation curve is sigmoid, 50% at P50; Bohr lower, fetal and myoglobin higher", () => {
  const n = 2.8, p50 = 3.5;
  let prev = -1;
  for (let p = 0; p <= 14.0001; p += 0.25) {
    const s = saturation(p, n, p50);
    assert.ok(s > prev || (p === 0 && s === 0), `rises monotonically at ${p}`);
    assert.ok(s >= 0 && s <= 100);
    prev = s;
  }
  assert.ok(Math.abs(saturation(p50, n, p50) - 50) < 1e-9, "50% at P50");
  assert.ok(Math.abs(pressureAt(50, n, p50) - p50) < 1e-9 && Math.abs(saturation(pressureAt(80, n, p50), n, p50) - 80) < 1e-6, "pressureAt inverts saturation");
  // Sigmoid: the gradient rises then falls (steepest in the middle, not at the start).
  const grad = (p: number) => saturation(p + 0.01, n, p50) - saturation(p, n, p50);
  assert.ok(grad(0.5) < grad(3) && grad(3) > grad(10));
  assert.ok(Math.abs(saturation(12, n, p50) - 96.9) < 0.3, "≈97% in the lungs at 12 kPa");
  const M = dissociationModel({ bohr: true, fetal: true, myoglobin: true });
  for (const p of [1, 2, 3, 4, 6, 8]) {
    const hb = saturation(p, M.hb.n, M.hb.p50);
    assert.ok(saturation(p, M.bohr!.n, M.bohr!.p50) < hb, `Bohr curve lower at ${p} kPa`);
    assert.ok(saturation(p, M.fetal!.n, M.fetal!.p50) > hb, `fetal curve higher at ${p} kPa`);
    assert.ok(saturation(p, M.myoglobin!.n, M.myoglobin!.p50) > hb, `myoglobin higher at ${p} kPa`);
  }
  // The marker names carry the computed readings.
  const d = oxygenDissociation.build({ lungs: 12, tissues: 3 });
  assert.match(part(d, "lungs")!.name, /12 kPa, 97% saturated/);
  assert.match(part(d, "tissues")!.name, /3 kPa, 39% saturated/);
  assert.ok(texts(d).includes("97%") && texts(d).includes("39%"));
  const b = oxygenDissociation.build({ bohr: true, tissues: 3 });
  assert.ok(part(b, "bohr-curve") && part(b, "bohr-shift"));
  assert.ok(texts(b).includes(`${Math.round(saturation(3, n, 5.1))}%`), "the Bohr curve's saturation at the tissues is written");
  assert.ok(texts(b).some((t) => /kPa/.test(t)), "axis has its unit");
  const half = oxygenDissociation.build({ p50Marker: true, p50: 3.8 });
  assert.match(part(half, "p50")!.name, /3\.8 kPa/);
  // Comparison curves: shifted the right way on the drawing too (anchor at the same saturation).
  const cmp = oxygenDissociation.build({ fetal: true });
  assert.ok(part(cmp, "fetal-curve") && part(cmp, "hb-curve") && !part(cmp, "lungs"), "markers off by default on a comparison");
});

test("match: the right boards ask for these figures, and others do not", () => {
  const yes: Array<[FigureComponent, string]> = [
    [glucoseRings, "The structure of α-glucose and β-glucose"], [glucoseRings, "Alpha glucose vs beta glucose"], [glucoseRings, "Forming maltose: the glycosidic bond"],
    [lipids, "Triglycerides are formed by condensation"], [lipids, "Structure of a phospholipid"], [lipids, "The fluid mosaic model of membranes"], [lipids, "Saturated and unsaturated fatty acids"],
    [aminoAcid, "The general structure of an amino acid"], [aminoAcid, "Two amino acids join by a peptide bond"], [aminoAcid, "Forming a dipeptide by condensation"],
    [atpNucleotide, "The structure of ATP and its hydrolysis to ADP"], [atpNucleotide, "Structure of a nucleotide: phosphate, pentose sugar and base"], [atpNucleotide, "ATP hydrolase releases energy"],
    [oxygenDissociation, "The oxygen dissociation curve of haemoglobin"], [oxygenDissociation, "The Bohr effect"], [oxygenDissociation, "Fetal haemoglobin has a higher affinity for oxygen"],
  ];
  for (const [c, text] of yes) assert.ok(c.match.test(text), `${c.name} should match "${text}"`);
  const unrelated = ["Mitosis and the cell cycle", "Photosynthesis in the chloroplast", "Natural selection and evolution"];
  const no: Array<[FigureComponent, string]> = [
    ...COMPONENTS.flatMap((c) => unrelated.map((t) => [c, t] as [FigureComponent, string])),
    [glucoseRings, "Blood glucose is controlled by insulin"], [glucoseRings, "Glucose is used in respiration"], [glucoseRings, "Starch is stored in amyloplasts"],
    [lipids, "Fats in a balanced diet"], [lipids, "Esters are made from an alcohol and a carboxylic acid"], [lipids, "Cell membranes control what enters the cell"],
    [aminoAcid, "Proteins are made of amino acids"], [aminoAcid, "tRNA carries amino acids to the ribosome"], [aminoAcid, "Enzymes are proteins"],
    [atpNucleotide, "Aerobic respiration produces ATP in mitochondria"], [atpNucleotide, "Energy transfers in food chains"], [atpNucleotide, "The nucleotide sequence codes for a protein"],
    [oxygenDissociation, "The acid dissociation constant Ka"], [oxygenDissociation, "Red blood cells have no nucleus"], [oxygenDissociation, "Arteries, veins and capillaries"],
  ];
  for (const [c, text] of no) assert.ok(!c.match.test(text), `${c.name} should not match "${text}"`);
});
