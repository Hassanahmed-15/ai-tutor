import { test } from "node:test";
import assert from "node:assert/strict";
import type { FigureComponent, FigureDrawing, FigureParams } from "../figures/types";
import { bonding, bondingInfo, type CovalentInfo, type IonicInfo } from "../figures/components/bonding";
import { latticeStructure, latticeKind } from "../figures/components/latticeStructure";
import { rateGraph, rateModel } from "../figures/components/rateGraph";
import { periodicTable, ELEMENTS, resolveHighlights } from "../figures/components/periodicTable";
import { decayCurve, decayModel } from "../figures/components/decayCurve";

const VARIANTS: Array<[FigureComponent, FigureParams[]]> = [
  [bonding, [{}, { formula: "NaCl" }, { formula: "MgO", style: "full" }, { formula: "CaCl2", show: "transfer" }, { formula: "Na2O" }, { formula: "Al2O3", show: "transfer" }, { formula: "Mg3N2" }, { formula: "Li3N", show: "transfer" },
    { formula: "H2" }, { formula: "Cl2", style: "full" }, { formula: "HCl" }, { formula: "H2O" }, { formula: "NH3", style: "full" }, { formula: "CH4" }, { formula: "CO2" }, { formula: "O2" }, { formula: "N2" }, { formula: "C2H4" }, { formula: "C2H6" }, { formula: "C2H2" }, { formula: "HCN" }, { formula: "CCl4", style: "full" }, { formula: "BF3" }, { compound: "water" }, { formula: "SO3" }]],
  [latticeStructure, [{}, { type: "giant-ionic", view: "2d", compound: "MgO" }, { type: "metallic", metal: "aluminium" }, { type: "metallic" }, { type: "diamond" }, { type: "graphite", layers: 2 }, { type: "graphite" }, { type: "simple-molecular" }, { type: "simple-molecular", substance: "ice" }, { type: "simple-molecular", substance: "bromine" }]],
  [rateGraph, [{}, { curves: "original; faster: higher temperature; slower: lower concentration (half)", tangentAt: 30, initialRate: true }, { y: "reactant", final: 80, tangentAt: 20, duration: 200 }, { y: "mass of flask", final: 180, end: 176, tangentAt: 40 }, { curves: "slower: lumps of marble" }]],
  [periodicTable, [{}, { highlight: "group 1, halogens, noble gases" }, { highlight: "Na, Mg, Cl", upTo: 20, masses: true }, { highlight: "period 3; transition metals", numbering: "18", shading: true }, { upTo: 10, numbering: "roman" }]],
  [decayCurve, [{}, { halfLife: 5, timeUnit: "days", initial: 600, quantity: "count rate", background: 40, readAt: 7, halfLives: 2 }, { halfLife: 8, quantity: "mass", initial: 12, halfLives: 4, readAt: 30 }, { halfLives: 1 }]],
];
const JUNK: FigureParams = { formula: "Xx9", style: 3, show: "maybe", type: "plasma", compound: "", view: 7, metal: "unobtainium", layers: "lots", substance: 4, curves: ";;;", y: 5, final: "x", duration: -4, tangentAt: "soon", initialRate: "perhaps", highlight: "group 99, period 9, Qq", upTo: "all", numbering: 4, halfLife: 0, initial: -10, halfLives: 99, readAt: "noon", background: "lots" };

const centre = (s: FigureDrawing["shapes"][number]) => (s.t === "circle" ? { x: s.cx, y: s.cy } : s.t === "text" ? { x: s.x, y: s.y } : null);

test("chem2 figures: built parts ⊆ declared, ≥2 parts by default, anchors inside, shapes name built parts, every built part has a shape, no NaN", () => {
  for (const [c, sets] of VARIANTS) {
    assert.ok(c.build({}).parts.length >= 2, `${c.name}: at least two parts with no params`);
    for (const params of [...sets, JUNK]) {
      const d = c.build(params);
      const label = `${c.name} ${JSON.stringify(params)}`;
      const declared = new Set(c.parts.map((p) => p.id));
      const built = new Set(d.parts.map((p) => p.id));
      assert.equal(built.size, d.parts.length, `${label}: part ids unique`);
      for (const p of d.parts) {
        assert.ok(declared.has(p.id), `${label}: ${p.id} is declared`);
        assert.ok(p.name.length > 0 && p.name.length <= 60, `${label}: ${p.id} has a name`);
        assert.ok(p.anchor.x >= 0 && p.anchor.x <= d.w && p.anchor.y >= 0 && p.anchor.y <= d.h, `${label}: ${p.id} anchor (${p.anchor.x}, ${p.anchor.y}) inside ${d.w}×${d.h}`);
        assert.ok(d.shapes.some((s) => s.part === p.id), `${label}: ${p.id} has a shape`);
      }
      for (const sh of d.shapes) {
        if (sh.part) assert.ok(built.has(sh.part), `${label}: shape names unbuilt part ${sh.part}`);
        assert.ok(!/NaN|Infinity/.test(JSON.stringify(sh)), `${label}: bad number in ${JSON.stringify(sh).slice(0, 90)}`);
      }
      assert.ok(Number.isFinite(d.w) && Number.isFinite(d.h) && d.w > 50 && d.h > 50, `${label}: size`);
    }
  }
});

/* ── bonding ─────────────────────────────────────────────────────────────────────────────── */

const isDot = (s: FigureDrawing["shapes"][number]) => s.t === "circle" && s.r === 4.6;
const isCross = (s: FigureDrawing["shapes"][number]) => s.t === "path" && s.width === 2.5;

test("bonding NaCl: ionic, Na⁺ and Cl⁻ in brackets, Cl⁻ has 8 outer electrons (7 • + 1 × gained), Na⁺ a full shell of 8 ×", () => {
  const info = bondingInfo({ formula: "NaCl" }) as IonicInfo;
  assert.equal(info.kind, "ionic");
  assert.equal(info.cation.charge, 1);
  assert.equal(info.anion.charge, -1);
  assert.equal(info.anion.ownOuter + info.anion.gained, 8);
  assert.equal(info.cation.outerShell, 8);
  const d = bonding.build({ formula: "NaCl" });
  assert.equal(d.shapes.filter(isDot).length, 7, "Cl's own seven electrons are dots");
  assert.equal(d.shapes.filter(isCross).length, 9, "Na⁺ shell of 8 crosses + the gained cross on Cl⁻");
  const texts = d.shapes.filter((s) => s.t === "text").map((s) => (s.t === "text" ? s.text : ""));
  assert.ok(texts.includes("+") && texts.includes("−"), "charges written");
  assert.ok(d.parts.find((p) => p.id === "negative-ion")!.name.includes("Cl⁻"));
  assert.ok(d.parts.find((p) => p.id === "positive-ion")!.name.includes("Na⁺"));
  assert.ok(d.shapes.filter((s) => s.t === "path" && s.width === 2.6).length >= 4, "square brackets round both ions");
});

test("bonding ionic formulae and charges from the groups", () => {
  const cases: Array<[string, string, number, number, number, number]> = [
    ["MgO", "MgO", 2, -2, 1, 1], ["CaCl2", "CaCl2", 2, -1, 1, 2], ["Na2O", "Na2O", 1, -2, 2, 1], ["Al2O3", "Al2O3", 3, -2, 2, 3], ["magnesium nitride", "Mg3N2", 2, -3, 3, 2], ["NaCl2", "NaCl", 1, -1, 1, 1],
  ];
  for (const [input, formula, cq, aq, cn, an] of cases) {
    const i = bondingInfo({ formula: input }) as IonicInfo;
    assert.equal(i.kind, "ionic", input);
    assert.deepEqual([i.formula, i.cation.charge, i.anion.charge, i.cation.count, i.anion.count], [formula, cq, aq, cn, an], input);
    const d = bonding.build({ formula: input });
    // Every anion: 8 outer electrons; every cation: its full shell. Total electrons drawn add up.
    const expect = cn * i.cation.outerShell + an * 8;
    assert.equal(d.shapes.filter((s) => isDot(s) || isCross(s)).length, expect, `${input}: ${expect} electrons`);
  }
  const t = bonding.build({ formula: "CaCl2", show: "transfer" });
  assert.equal(t.shapes.filter((s) => s.part === "electron-transfer" && s.t === "path" && s.fill === "none").length, 2, "two electrons transferred, one to each Cl");
});

const cov = (f: string) => bondingInfo({ formula: f }) as CovalentInfo;
const orders = (i: CovalentInfo) => i.bonds.map((b) => b.order).sort();

test("bonding covalent: shared pairs, double and triple bonds, lone pairs worked out", () => {
  const w = cov("H2O");
  assert.equal(w.kind, "covalent");
  assert.deepEqual(orders(w), [1, 1], "H2O: two shared pairs");
  assert.equal(w.atoms[0].symbol, "O");
  assert.equal(w.atoms[0].lonePairs, 2, "two lone pairs on O");
  assert.deepEqual(orders(cov("CO2")), [2, 2], "CO2: two double bonds");
  assert.equal(cov("CO2").atoms.find((a) => a.symbol === "O")!.lonePairs, 2);
  assert.deepEqual(orders(cov("N2")), [3], "N2 triple");
  assert.equal(cov("N2").atoms[0].lonePairs, 1);
  assert.deepEqual(orders(cov("O2")), [2]);
  assert.deepEqual(orders(cov("Cl2")), [1]);
  assert.equal(cov("Cl2").atoms[0].lonePairs, 3);
  assert.deepEqual(orders(cov("CH4")), [1, 1, 1, 1]);
  assert.equal(cov("NH3").atoms[0].lonePairs, 1);
  assert.equal(cov("HCl").atoms.find((a) => a.symbol === "Cl")!.lonePairs, 3);
  assert.deepEqual(orders(cov("C2H4")), [1, 1, 1, 1, 2], "ethene: C=C");
  assert.deepEqual(orders(cov("C2H2")), [1, 1, 3], "ethyne: C≡C");
  assert.deepEqual(orders(cov("HCN")), [1, 3]);
  assert.equal(cov("BF3").atoms[0].lonePairs, 0, "boron: no lone pair (six outer electrons)");
  assert.equal(bondingInfo({ compound: "ammonia" }).formula, "NH3");
  // Every atom ends with a full outer shell (2 for H), counting shared electrons.
  for (const f of ["H2O", "CO2", "N2", "CH4", "NH3", "HCl", "C2H4", "C2H6", "HCN", "CCl4", "O2", "H2"]) {
    const i = cov(f);
    i.atoms.forEach((a, k) => {
      const shared = i.bonds.filter((b) => b.a === k || b.b === k).reduce((s, b) => s + 2 * b.order, 0);
      assert.equal(shared + 2 * a.lonePairs + a.single, a.symbol === "H" ? 2 : 8, `${f}: ${a.symbol} full shell`);
    });
  }
  // The drawing: H2O has 4 shared + 4 lone-pair electrons on O = 8 electrons in O's shell + 2 from the Hs... 8 total drawn.
  const d = bonding.build({ formula: "H2O" });
  assert.equal(d.shapes.filter((s) => isDot(s) || isCross(s)).length, 8, "H2O: 8 electrons drawn (4 shared, 4 lone)");
  assert.equal(bonding.build({ formula: "CO2" }).shapes.filter((s) => s.part === "double-bond" || s.part === "shared-pair").filter((s) => isDot(s) || isCross(s)).length, 7, "CO2: 8 bonding electrons, one retagged as a labelled electron");
  assert.equal(bonding.build({ formula: "N2" }).shapes.filter((s) => (s.part === "triple-bond" || s.part === "shared-pair" || s.part === "electron-b") && (isDot(s) || isCross(s))).length, 6, "N2: six electrons in the overlap");
});

/* ── lattice ─────────────────────────────────────────────────────────────────────────────── */

test("lattice: kinds from words; NaCl cube alternates ions; diamond atoms bonded to 4; graphite layers", () => {
  assert.equal(latticeKind("giant ionic lattice"), "giant-ionic");
  assert.equal(latticeKind("metallic bonding"), "metallic");
  assert.equal(latticeKind("diamond"), "diamond");
  assert.equal(latticeKind("graphite"), "graphite");
  assert.equal(latticeKind("simple molecular"), "simple-molecular");
  const cube = latticeStructure.build({});
  const ions = cube.shapes.filter((s) => s.t === "circle");
  assert.equal(ions.length, 27, "3×3×3 ions");
  const big = ions.filter((s) => s.part === "negative-ion").length, small = ions.filter((s) => s.part === "positive-ion").length;
  assert.equal(big + small, 27);
  assert.ok(Math.abs(big - small) === 1, "alternating: 14 and 13");
  const mgo = latticeStructure.build({ view: "2d", compound: "MgO" });
  assert.ok(mgo.shapes.some((s) => s.t === "text" && s.text === "2+") && mgo.shapes.some((s) => s.t === "text" && s.text === "2−"));
  assert.ok(mgo.parts.find((p) => p.id === "positive-ion")!.name.includes("Mg²⁺"));
  const metal = latticeStructure.build({ type: "metallic", metal: "Al" });
  assert.ok(metal.shapes.some((s) => s.t === "text" && s.text === "3+"));
  // Diamond: the highlighted atom has exactly four bonds (the amber ones).
  const dia = latticeStructure.build({ type: "diamond" });
  assert.equal(dia.shapes.filter((s) => s.part === "covalent-bond").length, 4);
  const gr = latticeStructure.build({ type: "graphite", layers: 2 });
  assert.ok(gr.parts.some((p) => p.id === "intermolecular-force") && gr.parts.some((p) => p.id === "delocalised-electrons"));
});

/* ── rate ────────────────────────────────────────────────────────────────────────────────── */

test("rate graph: faster curve steeper, same plateau unless halved; tangent gradient positive and equal to the slope of the curve", () => {
  const M = rateModel({ curves: "original; faster: higher temperature; slower: half the acid (half)" });
  const o = M.curves.find((c) => c.kind === "original")!, f = M.curves.find((c) => c.kind === "faster")!, s = M.curves.find((c) => c.kind === "slower")!;
  assert.ok(f.k > o.k && s.k < o.k);
  assert.equal(f.final, o.final);
  assert.equal(s.final, o.final / 2, "limiting reactant halved → half the product");
  assert.ok(M.gradient(f, 0) > M.gradient(o, 0), "faster: higher initial rate");
  for (const t of [0, 10, 30, 60]) {
    const g = M.gradient(o, t);
    const numeric = (M.value(o, t + 1e-4) - M.value(o, Math.max(0, t - 1e-4))) / (t === 0 ? 1e-4 : 2e-4);
    assert.ok(g > 0, "product: gradient positive");
    assert.ok(Math.abs(g - numeric) / g < 1e-3, `gradient at ${t} = derivative`);
  }
  assert.ok(Math.abs(M.value(o, M.duration) - o.final) / o.final < 0.01, "plateau reached at the final amount");
  const R = rateModel({ y: "reactant" });
  assert.ok(R.gradient(R.curves[0], 10) < 0, "reactant falls");
  assert.equal(rateModel({ curves: "lower temperature" }).curves.find((c) => c.label === "lower temperature")!.kind, "slower");
  assert.equal(rateModel({ curves: "using a catalyst" }).curves.find((c) => c.label === "using a catalyst")!.kind, "faster");
  // The written rate is the gradient.
  const d = rateGraph.build({ tangentAt: 30 });
  const rateText = d.shapes.find((sh) => sh.t === "text" && sh.text.startsWith("rate ="));
  assert.ok(rateText && rateText.t === "text");
  const M2 = rateModel({});
  const expected = M2.gradient(M2.curves[0], 30);
  assert.ok(Math.abs(Number(rateText.text.match(/[\d.]+/)![0]) - expected) / expected < 0.05, `${rateText.text} ≈ ${expected}`);
});

/* ── periodic table ──────────────────────────────────────────────────────────────────────── */

test("periodic table: atomic numbers, groups, metals line, highlights resolve to the right elements", () => {
  assert.equal(ELEMENTS.length, 36);
  const by = (s: string) => ELEMENTS.find((e) => e.symbol === s)!;
  assert.deepEqual([by("Na").z, by("Cl").z, by("Fe").z, by("Kr").z, by("Ca").z, by("Br").z], [11, 17, 26, 36, 20, 35]);
  assert.deepEqual([by("Br").group, by("Br").period, by("Zn").group, by("He").group], [17, 4, 12, 18]);
  assert.ok(by("Al").metal && by("Ge").metal && !by("Si").metal && !by("B").metal && !by("H").metal && by("Cu").metal && !by("As").metal);
  const sym = (zs: number[]) => zs.map((z) => ELEMENTS[z - 1].symbol);
  assert.deepEqual(sym(resolveHighlights("halogens", 36, false)[0].zs), ["F", "Cl", "Br"]);
  assert.deepEqual(sym(resolveHighlights("group 1", 36, false)[0].zs), ["Li", "Na", "K"], "no hydrogen in group 1");
  assert.deepEqual(sym(resolveHighlights("group 3", 36, false)[0].zs), ["B", "Al", "Ga"], "IGCSE group III");
  assert.deepEqual(sym(resolveHighlights("group 3", 36, true)[0].zs), ["Sc"], "IUPAC group 3");
  assert.deepEqual(sym(resolveHighlights("group 0", 36, false)[0].zs), ["He", "Ne", "Ar", "Kr"]);
  assert.deepEqual(sym(resolveHighlights("period 3", 36, false)[0].zs), ["Na", "Mg", "Al", "Si", "P", "S", "Cl", "Ar"]);
  assert.equal(resolveHighlights("transition metals", 36, false)[0].zs.length, 10);
  assert.deepEqual(sym(resolveHighlights("Na, Mg, chlorine", 36, false)[0].zs), ["Na", "Mg", "Cl"]);
  // Drawn: every atomic number and symbol present once, Fe's number in Fe's cell.
  const d = periodicTable.build({});
  const texts = d.shapes.filter((s) => s.t === "text").map((s) => (s.t === "text" ? s.text : ""));
  for (const e of ELEMENTS) assert.ok(texts.includes(e.symbol) && texts.includes(String(e.z)), `${e.symbol} ${e.z}`);
  const fe = d.shapes.find((s) => s.t === "text" && s.text === "Fe")!, fe26 = d.shapes.find((s) => s.t === "text" && s.text === "26")!;
  assert.ok(Math.abs(centre(fe)!.x - centre(fe26)!.x) < 30 && Math.abs(centre(fe)!.y - centre(fe26)!.y) < 30, "26 sits in Fe's cell");
  const k = d.shapes.find((s) => s.t === "text" && s.text === "K")!, kr = d.shapes.find((s) => s.t === "text" && s.text === "Kr")!, he = d.shapes.find((s) => s.t === "text" && s.text === "He")!;
  assert.ok(Math.abs(centre(k)!.y - centre(kr)!.y) < 1 && centre(kr)!.x > centre(k)!.x, "K and Kr on period 4");
  assert.ok(Math.abs(centre(he)!.x - centre(kr)!.x) < 1, "He above Kr in the last column");
  assert.ok(periodicTable.build({ upTo: 20 }).w < d.w, "first 20: compact table");
});

/* ── decay ───────────────────────────────────────────────────────────────────────────────── */

test("decay curve: halves every half-life, 1/4 after two; background corrected; readings exact", () => {
  const M = decayModel({ halfLife: 3, initial: 800 });
  assert.equal(M.value(3), 400);
  assert.equal(M.value(6), 200, "two half-lives: a quarter");
  assert.equal(M.value(9), 100);
  const B = decayModel({ halfLife: 5, initial: 600, background: 40 });
  assert.equal(B.value(5) - 40, (600 - 40) / 2, "corrected count halves");
  assert.equal(B.value(10) - 40, (600 - 40) / 4);
  const d = decayCurve.build({ halfLife: 2, initial: 800, halfLives: 2, readAt: 3 });
  assert.equal(d.parts.find((p) => p.id === "after-n")!.name, "2 half-lives: 200 Bq");
  assert.equal(d.parts.find((p) => p.id === "half-value")!.name, "Halved: 400 Bq");
  assert.equal(d.parts.find((p) => p.id === "reading")!.name, `At 3 hours: ${Math.round(800 * Math.pow(0.5, 1.5))} Bq`);
  // The construction points lie on the curve: the half-value dot is level with 400 on the y scale.
  const init = d.parts.find((p) => p.id === "initial-value")!.anchor, half = d.parts.find((p) => p.id === "half-value")!.anchor, after = d.parts.find((p) => p.id === "after-n")!.anchor;
  const axisY = init.y + (half.y - init.y) * 2; // value 0 is twice as far below 800 as 400 is
  assert.ok(Math.abs((axisY - after.y) / (axisY - init.y) - 0.25) < 0.01, "after two half-lives the dot is at a quarter of the height");
});

/* ── matching ────────────────────────────────────────────────────────────────────────────── */

test("match: each component's words, and not the others'", () => {
  const yes: Array<[FigureComponent, string[]]> = [
    [bonding, ["Draw a dot-and-cross diagram for water", "Ionic bonding in sodium chloride", "covalent bonding in methane", "the double bond in carbon dioxide", "lone pairs on nitrogen", "electron transfer in magnesium oxide"]],
    [latticeStructure, ["the giant ionic lattice of sodium chloride", "metallic bonding: a sea of delocalised electrons", "the structure of diamond", "graphite layers slide", "simple molecular structures like iodine", "diamond and graphite"]],
    [rateGraph, ["rate of reaction graph", "volume of gas against time", "the initial rate from the tangent", "gradient of the tangent gives the rate"]],
    [periodicTable, ["the periodic table", "the alkali metals", "halogens get less reactive down a group", "noble gases are unreactive", "transition metals"]],
    [decayCurve, ["half-life of iodine-131", "a radioactive decay curve", "count rate against time", "the half life"]],
  ];
  const no: Array<[FigureComponent, string[]]> = [
    [bonding, ["the structure of an atom", "energy profile of a reaction", "balancing equations"]],
    [latticeStructure, ["the particle model of a gas", "a covalent bond"]],
    [rateGraph, ["energy profile diagram", "distance-time graph", "rate of photosynthesis in a leaf"]],
    [periodicTable, ["the periodic motion of a pendulum", "a table of results"]],
    [decayCurve, ["the life cycle of a star", "decay of teeth", "rate of reaction"]],
  ];
  for (const [c, list] of yes) for (const s of list) assert.ok(c.match.test(s), `${c.name} should match "${s}"`);
  for (const [c, list] of no) for (const s of list) assert.ok(!c.match.test(s), `${c.name} should not match "${s}"`);
});
