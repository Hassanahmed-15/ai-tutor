import { test } from "node:test";
import assert from "node:assert/strict";
import { registerFigureComponent } from "../figures/registry";
import { leadersCross } from "../figures/labels";
import type { FigureComponent, FigureParams } from "../figures/types";
import { layoutPanel, type Mark } from "../canvas/layout";
import { validateCanvasSpec } from "../canvas/validate";
import { atomicStructure, atomInfo } from "../figures/components/atomicStructure";
import { particles, particleCentres, changesFor } from "../figures/components/particles";
import { energyProfile, energyLevels } from "../figures/components/energyProfile";
import { punnettSquare, cross } from "../figures/components/punnettSquare";
import { pedigree, parsePedigree } from "../figures/components/pedigree";

const ALL: Array<[FigureComponent, FigureParams[]]> = [
  [atomicStructure, [{ element: "Na" }, { element: "Cl-", style: "dot-cross" }, { element: 20, charge: "2+" }, { element: "H" }, { element: "H", charge: 1 }, { element: "nonsense" }]],
  [particles, [{ states: "solid,liquid" }, { states: "gas", arrows: "none" }, { states: "liquid,gas", arrows: "condensing" }, { states: "solid,gas", arrows: "sublimation" }]],
  [energyProfile, [{ type: "endothermic", dH: 178, Ea: 250, catalysed: false }, { type: "exothermic", dH: -890, Ea: 20 }, { dH: "abc", Ea: -5 }]],
  [punnettSquare, [{ parent1: "Bb", parent2: "bb" }, { parent1: "AaBb", parent2: "AaBb" }, { cross: "Tt x tt" }, { parent1: "Q", parent2: "zz" }]],
  [pedigree, [{ g1: "M=Fc", g2: "Ma Fc=M F=Ma", g3: "Mc F Ma|Fa M", carrierStyle: "half" }, { g1: "Ma" }, { g1: "x y z" }]],
];

test("each component: declared parts are the built parts by default; never more; anchors inside; shapes name real parts", () => {
  for (const [c, sets] of ALL) {
    const d = c.build({});
    assert.deepEqual(d.parts.map((p) => p.id).sort(), c.parts.map((p) => p.id).sort(), c.name);
    for (const params of [{}, ...sets]) {
      const fig = c.build(params);
      const declared = new Set(c.parts.map((p) => p.id));
      for (const p of fig.parts) {
        assert.ok(declared.has(p.id), `${c.name} built undeclared part ${p.id}`);
        assert.ok(p.anchor.x >= 0 && p.anchor.x <= fig.w && p.anchor.y >= 0 && p.anchor.y <= fig.h, `${c.name}.${p.id} anchor inside (${JSON.stringify(params)})`);
        assert.ok(p.name.length > 0 && p.name.length <= 34, `${c.name}.${p.id} name fits a label`);
      }
      assert.equal(new Set(fig.parts.map((p) => p.id)).size, fig.parts.length, `${c.name}: part ids unique`);
      for (const sh of fig.shapes) if (sh.part) assert.ok(fig.parts.some((p) => p.id === sh.part), `${c.name} shape names unbuilt part ${sh.part}`);
      for (const sh of fig.shapes) for (const v of Object.values(sh)) if (typeof v === "number") assert.ok(Number.isFinite(v), `${c.name}: finite geometry`);
    }
  }
});

test("each component lays out on a board: labels end on their anchors, no leaders cross, labels in the margins", () => {
  for (const [c] of ALL) {
    registerFigureComponent(c);
    for (const notes of [[], ["a key note"]]) {
      const d = c.build({});
      const spec = validateCanvasSpec({ heading: c.title.slice(0, 40), notes, cues: [], stage: { kind: "figure", component: c.name, params: {}, parts: d.parts.map((p, i) => ({ id: p.id, s: i })) } }, 9);
      assert.ok(spec && spec.stage.kind === "figure", c.name);
      const layout = layoutPanel(spec!);
      const fig = layout.marks.find((m) => m.type === "figure") as Extract<Mark, { type: "figure" }>;
      const labels = layout.marks.filter((m): m is Extract<Mark, { type: "figure-label" }> => m.type === "figure-label");
      assert.ok(labels.length >= Math.min(8, d.parts.length) - 0, c.name);
      for (const l of labels) {
        const part = fig.drawing.parts.find((p) => p.id === l.part)!;
        const end = l.leader[l.leader.length - 1];
        assert.ok(Math.abs(end.x - (fig.rect.x + part.anchor.x * fig.scale)) < 0.01 && Math.abs(end.y - (fig.rect.y + part.anchor.y * fig.scale)) < 0.01, `${c.name}.${l.part}`);
        assert.ok(l.side === "left" ? l.at.x <= fig.rect.x : l.at.x >= fig.rect.x + fig.rect.w, `${c.name}.${l.part} in a margin`);
      }
      for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) assert.ok(!leadersCross(labels[i].leader, labels[j].leader), `${c.name}: ${labels[i].part} × ${labels[j].part}`);
    }
  }
});

test("atomic structure: protons, neutrons and shells are computed", () => {
  const na = atomInfo({ element: "Na" });
  assert.deepEqual(na.shells, [2, 8, 1]);
  assert.equal(na.protons, 11);
  assert.equal(na.neutrons, 12);
  assert.deepEqual(atomInfo({ element: "Cl-" }).shells, [2, 8, 8]);
  assert.deepEqual(atomInfo({ element: "chlorine", charge: -1 }).shells, [2, 8, 8]);
  assert.deepEqual(atomInfo({ element: "Mg2+" }).shells, [2, 8]);
  assert.deepEqual(atomInfo({ element: 20 }).shells, [2, 8, 8, 2]);
  assert.deepEqual(atomInfo({ element: "O", charge: "2-" }).shells, [2, 8]);
  assert.equal(atomInfo({ element: "Cl", mass: 37 }).neutrons, 20);
  assert.equal(atomInfo({ element: "H", charge: 1 }).electrons, 0);
  const d = atomicStructure.build({ element: "Na" });
  assert.equal(d.shapes.filter((s) => s.t === "circle" && s.fill === "#2563eb").length, 11, "11 electrons drawn");
  assert.ok(d.shapes.some((s) => s.t === "text" && s.text === "11p") && d.shapes.some((s) => s.t === "text" && s.text === "12n"));
  assert.ok(!d.parts.some((p) => p.id === "shell-4"), "no fourth shell for sodium");
  const cl = atomicStructure.build({ element: "Cl-", style: "dot-cross" });
  assert.equal(cl.shapes.filter((s) => s.t === "circle" && s.part === "outer-electrons").length, 1, "one gained electron drawn as a dot");
  assert.equal(cl.parts.find((p) => p.id === "outer-electrons")!.name, "Gained electron");
});

test("particles: lattice, touching liquid, spread gas, no overlaps, correct change names", () => {
  const solid = particleCentres("solid", 1), liquid = particleCentres("liquid", 2), gas = particleCentres("gas", 3);
  for (const [pts, min] of [[solid, 25], [liquid, 25], [gas, 40]] as const)
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) assert.ok(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) >= min - 0.01);
  assert.ok(gas.length >= 5 && gas.length < liquid.length);
  assert.deepEqual(particleCentres("liquid", 2), liquid, "deterministic");
  assert.deepEqual(changesFor(["solid", "liquid", "gas"], "both").map((c) => [c.forward, c.back]), [["Melting", "Freezing"], ["Boiling (evaporating)", "Condensing"]]);
  assert.deepEqual(changesFor(["liquid", "gas"], "condensing"), [{ i: 0, forward: undefined, back: "Condensing" }]);
  assert.equal(changesFor(["solid", "gas"], "forward")[0].forward, "Sublimation");
  assert.equal(changesFor(["gas", "solid"], "none").length, 0);
});

test("energy profile: exothermic products below reactants and ΔH arrow downward; endothermic the reverse", () => {
  const exo = energyLevels({ type: "exothermic", dH: 92, Ea: 230 });
  assert.equal(exo.dH, -92, "the sign follows the type");
  assert.ok(exo.yP > exo.yR && exo.yPeak < exo.yR, "products lower on the page, peak above both");
  const arrowY = (params: FigureParams) => {
    const sh = energyProfile.build(params).shapes.find((s) => s.part === "enthalpy-change" && s.t === "path")!;
    const m = (sh as { d: string }).d.match(/^M[\d.]+ ([\d.]+) L[\d.]+ ([\d.]+)/)!;
    return Number(m[2]) - Number(m[1]);
  };
  assert.ok(arrowY({ type: "exothermic", dH: -92, Ea: 230 }) > 0, "ΔH arrow points down");
  const endo = energyLevels({ type: "endothermic", dH: 178, Ea: 100 });
  assert.ok(endo.yP < endo.yR && endo.yPeak < endo.yP, "endothermic: products higher, peak higher still");
  assert.ok(endo.ea > endo.dH, "an impossible Ea is corrected");
  assert.ok(arrowY({ type: "endothermic", dH: 50 }) < 0, "ΔH arrow points up");
  const cat = energyLevels({ dH: -50, Ea: 120, EaCat: 60 });
  assert.ok(cat.yCat! > cat.yPeak && cat.yCat! < cat.yR, "catalysed peak lower than uncatalysed but above reactants");
  assert.equal(energyLevels({ catalysed: false }).yCat, undefined);
  const texts = energyProfile.build({ dH: -92, Ea: 230 }).shapes.filter((s) => s.t === "text").map((s) => (s as { text: string }).text);
  assert.ok(texts.includes("−92 kJ/mol") && texts.includes("230 kJ/mol"));
  assert.ok(!energyProfile.build({}).shapes.some((s) => s.t === "text" && /kJ/.test(s.text)), "no invented values");
});

test("Punnett square: gametes, offspring and ratios", () => {
  const ratio = (r: ReturnType<typeof cross>) => r.phenotypeRatio.map((p) => p.count).join(":");
  assert.equal(ratio(cross({ parent1: "Bb", parent2: "bb" })), "1:1");
  assert.equal(ratio(cross({ parent1: "Bb", parent2: "Bb" })), "3:1");
  assert.equal(cross({ parent1: "Bb", parent2: "Bb" }).genotypeRatio.map((g) => `${g.count}${g.genotype}`).join(" "), "1BB 2Bb 1bb");
  const di = cross({ parent1: "AaBb", parent2: "AaBb" });
  assert.equal(ratio(di), "9:3:3:1");
  assert.deepEqual(di.gametes1, ["AB", "Ab", "aB", "ab"]);
  assert.equal(di.cells.flat().length, 16);
  assert.equal(ratio(cross({ cross: "TT x tt" })), "1");
  assert.deepEqual(cross({ parent1: "bB", parent2: "bb" }).p1, ["Bb"], "dominant allele written first");
  const d = punnettSquare.build({ parent1: "Bb", parent2: "Bb", dominant: "brown eyes", recessive: "blue eyes" });
  const texts = d.shapes.filter((s) => s.t === "text").map((s) => (s as { text: string }).text);
  assert.ok(texts.includes("1 BB : 2 Bb : 1 bb") && texts.includes("3 : 1") && texts.includes("3 brown eyes") && texts.includes("1 blue eyes"));
  assert.equal(d.parts.find((p) => p.id === "offspring")!.name, "Offspring bb (blue eyes)");
});

test("pedigree: generations, partners, sibships and numbering", () => {
  const rows = parsePedigree({ g1: "Mc=Fc", g2: "Fa Mc=F M", g3: "Ma Fc F" });
  assert.equal(rows.length, 3);
  assert.equal(rows[1].people.length, 4);
  assert.equal(rows[0].couples[0].children.length, 3, "II-1, II-2, II-4 are children; II-3 married in");
  assert.equal(rows[2].people[0].parents, rows[1].couples[0]);
  const d = pedigree.build({ g1: "Mc=Fc", g2: "Fa Mc=F M", g3: "Ma Fc F" });
  const texts = d.shapes.filter((s) => s.t === "text").map((s) => (s as { text: string }).text);
  assert.deepEqual(texts.filter((t) => /^[IV]+$/.test(t)), ["I", "II", "III"]);
  assert.equal(texts.filter((t) => /^\d$/.test(t)).join(""), "1212341" + "23");
  assert.ok(d.shapes.some((s) => s.part === "affected-female" && s.t === "circle" && s.fill === "ink"));
  assert.ok(d.shapes.some((s) => s.part === "affected-male" && s.t === "path" && s.fill === "ink"));
  // Children are centred under their parents: the descent line drops from the middle of the sibship.
  for (const params of [{ g1: "M=F", g2: "M F M" }, { g1: "M=F", g2: "Fc=M Ma" }, { g1: "Mc=Fc", g2: "Fa Mc=F M", g3: "Ma Fc F" }] as FigureParams[]) {
    for (const sh of pedigree.build(params).shapes.filter((x) => x.part === "offspring-line")) {
      const nums = ((sh as { d: string }).d.match(/-?[\d.]+/g) ?? []).map(Number);
      const mid = nums[0];
      const drops = [...(sh as { d: string }).d.matchAll(/M([\d.]+) [\d.]+ V/g)].slice(1).map((m) => Number(m[1]));
      // Siblings only (a married-in partner has no drop line), so their centre is the parents' midpoint.
      assert.ok(Math.abs((Math.min(...drops) + Math.max(...drops)) / 2 - mid) < 0.5, `centred: ${JSON.stringify(params)}`);
    }
  }
});

test("match: each component is chosen by its own subject only", () => {
  const yes: Array<[FigureComponent, string]> = [
    [atomicStructure, "The electronic configuration of sodium"], [atomicStructure, "Draw a Bohr model of chlorine"], [atomicStructure, "electron shells of magnesium"],
    [particles, "The particle model of solids, liquids and gases"], [particles, "Changes of state: melting and boiling"], [particles, "arrangement of particles in a solid"],
    [energyProfile, "Energy profile for an exothermic reaction"], [energyProfile, "How a catalyst lowers the activation energy"], [energyProfile, "Endothermic reactions take in energy"],
    [punnettSquare, "Use a Punnett square to predict offspring"], [punnettSquare, "A monohybrid cross between heterozygous parents"], [punnettSquare, "The dihybrid 9:3:3:1 ratio"],
    [pedigree, "Reading a pedigree chart for cystic fibrosis"], [pedigree, "Family tree showing an autosomal recessive disorder"],
  ];
  const no: Array<[FigureComponent, string]> = [
    [atomicStructure, "Titration of hydrochloric acid"], [atomicStructure, "Photosynthesis in leaves"],
    [particles, "Particle accelerators at CERN"], [particles, "Electrolysis of brine"],
    [energyProfile, "Kinetic energy of a moving car"], [energyProfile, "Energy stores and transfers in a pendulum"],
    [punnettSquare, "The structure of DNA"], [punnettSquare, "Mitosis and the cell cycle"],
    [pedigree, "The history of the Tudor family"], [pedigree, "Ecological food chains"],
  ];
  for (const [c, s] of yes) assert.ok(c.match.test(s), `${c.name} should match "${s}"`);
  for (const [c, s] of no) assert.ok(!c.match.test(s), `${c.name} should not match "${s}"`);
});
