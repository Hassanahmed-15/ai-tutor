import { test } from "node:test";
import assert from "node:assert/strict";
import type { FigureComponent, FigureDrawing, FigureParams } from "../figures/types";
import { registerFigureComponent } from "../figures/registry";
import { partBounds, shapeBoxes } from "../figures/bounds";
import { leadersCross } from "../figures/labels";
import { layoutPanel, type Mark } from "../canvas/layout";
import { validateCanvasSpec } from "../canvas/validate";
import { bloodVessels } from "../figures/components/bloodVessels";
import { bloodCells, bloodCellKinds } from "../figures/components/bloodCells";
import { villus } from "../figures/components/villus";
import { teeth } from "../figures/components/teeth";
import { placenta } from "../figures/components/placenta";

/** Every variant of every component in this kit (human transport and structures). */
const VARIANTS: Array<[FigureComponent, FigureParams[]]> = [
  [bloodVessels, [{}, { show: "all", valve: true }, { show: "artery" }, { show: "vein" }, { show: "capillary" }]],
  [bloodCells, [{}, { show: "red" }, { show: "white" }, { show: "red, platelets" }, { show: "lymphocyte" }, { show: "phagocyte, monocyte" }, { show: "neutrophil; lymphocyte; monocyte; platelets" }]],
  [villus, [{}, { count: 1, inset: false }, { count: 2 }, { count: 3 }]],
  [teeth, [{}, { view: "section" }, { view: "types" }]],
  [placenta, [{}, { inset: true }]],
];

const HOSTILE: FigureParams[] = [
  { show: "<script>", view: 42, count: -7, inset: "maybe", valve: "nonsense" },
  { show: "", view: "", count: "", inset: "" },
  { show: 1e9, view: "πρ", count: 1e9, inset: 0 },
  { count: Number.NaN as never, show: "artery vein", view: "types section" },
  { count: "2.6", show: "white, red, blue", inset: "yes" },
];

function checkDrawing(c: FigureComponent, d: FigureDrawing, label: string) {
  const declared = new Map(c.parts.map((p) => [p.id, p.name]));
  const built = d.parts.map((p) => p.id);
  assert.ok(d.w >= 560 && d.w <= 760 && d.h >= 260 && d.h <= 460, `${label}: size ${d.w}×${d.h} within 560–760 × 260–460`);
  assert.ok(built.length >= 2, `${label}: at least two parts`);
  assert.equal(new Set(built).size, built.length, `${label}: part ids are unique`);
  for (const p of d.parts) {
    assert.ok(declared.has(p.id), `${label}: ${p.id} is declared`);
    assert.equal(p.name, declared.get(p.id), `${label}: ${p.id} keeps its declared name (so a board can rename it)`);
    assert.ok(/^[a-z]+(-[a-z]+)*$/.test(p.id), `${label}: ${p.id} is kebab-case`);
    assert.ok(Number.isFinite(p.anchor.x) && Number.isFinite(p.anchor.y), `${label}: ${p.id} anchor finite`);
    assert.ok(p.anchor.x >= 0 && p.anchor.x <= d.w && p.anchor.y >= 0 && p.anchor.y <= d.h, `${label}: ${p.id} anchor inside ${d.w}×${d.h}`);
    assert.ok(p.name.length > 0 && p.name.length <= 34, `${label}: ${p.id} name fits a label`);
    // The anchor lies on one of the part's own shapes (within the stroke's reach for lines).
    assert.ok(d.shapes.some((sh) => sh.part === p.id), `${label}: ${p.id} has shapes`);
    const on = d.shapes.some((sh) => {
      if (sh.part !== p.id) return false;
      const tol = Math.max(3, (sh.width ?? 1) / 2 + 2);
      if (sh.t === "circle") return Math.hypot(p.anchor.x - sh.cx, p.anchor.y - sh.cy) <= sh.r + tol;
      const b = partBounds({ ...d, shapes: [{ ...sh, part: "x" }] }).get("x");
      if (!b) return false;
      return p.anchor.x >= b.x - tol && p.anchor.x <= b.x + b.w + tol && p.anchor.y >= b.y - tol && p.anchor.y <= b.y + b.h + tol;
    });
    assert.ok(on, `${label}: ${p.id} anchor (${p.anchor.x}, ${p.anchor.y}) is on its own shapes`);
  }
  for (const s of d.shapes) {
    if (s.part) assert.ok(built.includes(s.part), `${label}: shape names an unbuilt part ${s.part}`);
    if (s.t === "path") assert.ok(s.d.length > 0 && !/NaN|Infinity|undefined/.test(s.d), `${label}: path has finite numbers`);
    if (s.t === "circle") assert.ok([s.cx, s.cy, s.r].every(Number.isFinite) && s.r > 0, `${label}: circle finite`);
    if (s.t === "text") {
      assert.ok(s.size >= 14, `${label}: text "${s.text}" is at least 14`);
      assert.ok(s.x >= 0 && s.x <= d.w && s.y >= 0 && s.y <= d.h && !/NaN|undefined/.test(s.text), `${label}: text "${s.text}" inside and finite`);
      // Part names are the label engine's job, never written into the art.
      for (const name of declared.values()) assert.ok(!s.text.toLowerCase().includes(name.toLowerCase()), `${label}: "${s.text}" repeats the part name ${name}`);
    }
  }
}

test("kit-transport: every variant builds, every built part is anchored on its own shapes", () => {
  for (const [c, variants] of VARIANTS) {
    const seen = new Set<string>();
    for (const params of variants) {
      const d = c.build(params);
      checkDrawing(c, d, `${c.name} ${JSON.stringify(params)}`);
      for (const p of d.parts) seen.add(p.id);
    }
    // Every declared part is drawn by at least one variant.
    for (const p of c.parts) assert.ok(seen.has(p.id), `${c.name}: declared part ${p.id} is built by some variant`);
  }
});

test("kit-transport: hostile or odd params never throw and still draw", () => {
  for (const [c] of VARIANTS) for (const p of HOSTILE) checkDrawing(c, c.build(p), `${c.name} ${JSON.stringify(p)}`);
});

test("kit-transport: variants draw what they say", () => {
  const ids = (c: FigureComponent, p: FigureParams) => c.build(p).parts.map((x) => x.id);
  assert.ok(["artery", "vein", "capillary"].every((id) => ids(bloodVessels, {}).includes(id)), "all three vessels by default");
  assert.ok(!ids(bloodVessels, {}).includes("valve") && ids(bloodVessels, { valve: true }).includes("valve"), "valve inset on request");
  assert.ok(ids(bloodVessels, { show: "vein" }).includes("valve") && !ids(bloodVessels, { show: "vein" }).includes("artery"), "vein view: valve, no artery");
  assert.ok(ids(bloodVessels, { show: "capillary" }).includes("pore") && ids(bloodVessels, { show: "capillary" }).includes("red-blood-cell"));
  // An artery's lumen is narrower than a vein's, and its wall thicker: the defining contrast.
  const all = bloodVessels.build({});
  const ext = (part: string) => {
    const xs = shapeBoxes({ ...all, shapes: all.shapes.filter((s) => s.part === part && s.t === "path" && s.fill && s.fill !== "none") });
    return Math.max(...xs.map((b) => b.box.w));
  };
  assert.ok(ext("artery-lumen") * 2 < ext("vein-lumen"), "artery lumen much narrower than vein lumen");
  assert.deepEqual(bloodCellKinds("white blood cells"), ["neutrophil", "lymphocyte", "monocyte"]);
  assert.deepEqual(bloodCellKinds("phagocytes and platelets"), ["neutrophil", "platelets"]);
  assert.deepEqual(bloodCellKinds("erythrocytes"), ["red"]);
  assert.equal(bloodCellKinds("unicorns").length, 5, "nothing recognised → the full smear");
  assert.ok(!ids(bloodCells, { show: "lymphocyte" }).includes("red-blood-cell"));
  assert.ok(ids(villus, {}).includes("mitochondria") && !ids(villus, { count: 3 }).includes("mitochondria"), "inset only with one villus");
  assert.equal(villus.build({ count: 3 }).shapes.filter((s) => s.part === "lacteal" && s.t === "path" && s.fill === "#fef9c3").length >= 3, true, "three villi, three lacteals");
  assert.ok(ids(teeth, {}).includes("pulp-cavity") && !ids(teeth, {}).includes("canine"), "section by default");
  assert.ok(["incisor", "canine", "premolar", "molar"].every((id) => ids(teeth, { view: "types" }).includes(id)));
  assert.ok(!ids(placenta, {}).includes("maternal-blood") && ids(placenta, { inset: true }).includes("exchange-in"));
  const inset = placenta.build({ inset: true }).shapes.flatMap((s) => (s.t === "text" ? [s.text] : []));
  assert.deepEqual(inset.sort(), ["CO₂", "O₂", "glucose", "urea"].sort(), "exchange inset names only the substances");
});

test("kit-transport: on a board, leaders end on their anchors, labels stand in the margins, no two leaders cross", () => {
  for (const [c, variants] of VARIANTS) {
    registerFigureComponent(c);
    // A board labels at most eight parts: try the first eight and the last eight of each variant.
    for (const params of variants) for (const notes of [[], ["a key note"]]) for (const end of [false, true]) {
      const d = c.build(params);
      const chosen = end ? d.parts.slice(-8) : d.parts.slice(0, 8);
      const spec = validateCanvasSpec({ heading: "Kit transport", notes, cues: [], stage: { kind: "figure", component: c.name, params, parts: chosen.map((p, i) => ({ id: p.id, s: i })) } }, 9);
      const where = `${c.name} ${JSON.stringify(params)} notes=${notes.length} ${end ? "last" : "first"} 8`;
      assert.ok(spec && spec.stage.kind === "figure", where);
      const layout = layoutPanel(spec!);
      const fig = layout.marks.find((m) => m.type === "figure") as Extract<Mark, { type: "figure" }>;
      const labels = layout.marks.filter((m): m is Extract<Mark, { type: "figure-label" }> => m.type === "figure-label");
      assert.equal(labels.length, chosen.length, where);
      for (const l of labels) {
        const part = fig.drawing.parts.find((p) => p.id === l.part)!;
        const end = l.leader[l.leader.length - 1];
        assert.ok(Math.abs(end.x - (fig.rect.x + part.anchor.x * fig.scale)) < 0.01 && Math.abs(end.y - (fig.rect.y + part.anchor.y * fig.scale)) < 0.01, `${where}: ${l.part} leader ends on its anchor`);
        assert.ok(l.side === "left" ? l.at.x <= fig.rect.x : l.at.x >= fig.rect.x + fig.rect.w, `${where}: ${l.part} in a margin`);
      }
      for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) assert.ok(!leadersCross(labels[i].leader, labels[j].leader), `${where}: ${labels[i].part} × ${labels[j].part}`);
    }
  }
});

test("kit-transport: match fires on boards about the structure and not on other biology", () => {
  const yes: Array<[FigureComponent, string]> = [
    [bloodVessels, "Arteries, veins and capillaries compared"],
    [bloodVessels, "The structure of an artery: thick elastic walls"],
    [bloodVessels, "Blood vessels and their functions"],
    [bloodVessels, "Veins have a wide lumen and valves; capillary walls are one cell thick"],
    [bloodCells, "Red blood cells carry oxygen using haemoglobin"],
    [bloodCells, "White blood cells: phagocytes and lymphocytes"],
    [bloodCells, "Platelets help the blood to clot"],
    [bloodCells, "The components of blood"],
    [villus, "Villi in the small intestine increase the surface area"],
    [villus, "Structure of a villus: lacteal and capillaries"],
    [villus, "Absorption of digested food in the ileum"],
    [teeth, "Types of human teeth"],
    [teeth, "The structure of a tooth: enamel, dentine and pulp"],
    [teeth, "Incisors bite and molars grind food"],
    [placenta, "The placenta and umbilical cord"],
    [placenta, "The fetus develops in the uterus surrounded by amniotic fluid"],
    [placenta, "Exchange of substances across the placenta"],
  ];
  for (const [c, text] of yes) assert.ok(c.match.test(text), `${c.name} should match "${text}"`);
  const no: Array<[FigureComponent, string]> = [
    [bloodVessels, "Capillary action moves water up a narrow tube"],
    [bloodVessels, "The veins of a leaf carry water and sugars"],
    [bloodVessels, "Blood glucose is controlled by insulin"],
    [bloodVessels, "The pulmonary vein carries blood to the left atrium"],
    [bloodCells, "Animal cell structure: nucleus, cytoplasm and membrane"],
    [bloodCells, "The cell surface membrane controls what enters a cell"],
    [bloodCells, "Blood pressure in the arteries"],
    [villus, "Chorionic villi in the placenta"],
    [villus, "Microvilli on a root hair cell increase surface area"],
    [villus, "Digestion of starch by amylase in the mouth"],
    [teeth, "Molar mass of carbon dioxide"],
    [teeth, "Gear teeth turn the wheel"],
    [teeth, "Canine distemper in dogs"],
    [placenta, "Placental mammals and marsupials"],
    [placenta, "Pollen tube growth and fertilisation in flowers"],
    [placenta, "The menstrual cycle and hormones"],
  ];
  for (const [c, text] of no) assert.ok(!c.match.test(text), `${c.name} should not match "${text}"`);
  // Each kit component also stays off the other kit components' boards.
  const kit = [bloodVessels, bloodCells, villus, teeth, placenta];
  const own: Record<string, string> = {
    bloodCells: "A blood smear with neutrophils and monocytes",
    villus: "The villus epithelium and its microvilli",
    teeth: "Dentine and the pulp cavity of a tooth",
    placenta: "Amniotic sac and amniotic fluid protect the fetus",
  };
  for (const c of kit) for (const [name, text] of Object.entries(own)) if (c.name !== name) assert.ok(!c.match.test(text), `${c.name} should not match the ${name} board "${text}"`);
});
