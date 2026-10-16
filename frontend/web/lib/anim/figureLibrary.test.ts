import { test } from "node:test";
import assert from "node:assert/strict";
import { analyseSvg, serializeSvg } from "../figures/svgExtract";
import { fileLanguage, licenceGate, pickLibraryAsset, stageAsset, type LibraryAsset } from "../figures/libraryIndex";
import { validateCanvasSpec } from "../canvas/validate";
import { layoutPanel, type Mark } from "../canvas/layout";
import { fallbackSpec } from "../canvas/fallback";
import { applyLessonVisualPolicy } from "../canvas/visualPolicy";
import type { CanvasPlanBeat } from "../canvas/types";

test("licence gate keeps PD, CC0, CC BY and CC BY-SA, and rejects NC, ND, fair use and unknown", () => {
  for (const ok of ["Public domain", "PD-self", "CC0", "CC BY 4.0", "CC BY 2.5", "CC BY-SA 3.0", "CC BY-SA 4.0", "CC-BY-SA-2.0"]) assert.ok(licenceGate(ok).ok, ok);
  for (const no of ["CC BY-NC 4.0", "CC BY-NC-SA 3.0", "CC BY-ND 4.0", "CC BY-NC-ND 2.0", "Fair use", "GFDL", "", "Copyrighted free use? maybe"]) assert.equal(licenceGate(no).ok, false, no);
  const sa = licenceGate("CC BY-SA 3.0");
  assert.ok(sa.ok && sa.licence === "CC BY-SA 3.0");
  assert.equal(fileLanguage("Heart diagram-en.svg"), "en");
  assert.equal(fileLanguage("Heart diagram-fr.svg"), "other");
  assert.equal(fileLanguage("Animal cell structure zhtw.svg"), "other");
});

// A hand-made labelled diagram: a group transform, a CSS-styled leader, an elbowed leader drawn as two
// lines, a <switch> with an English choice, a two-line label, a label sitting on its part with no
// leader, an axis number, and a script that must not survive.
const FIXTURE = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 400 300" onload="alert(1)">
  <style>.leader{fill:none;stroke:#333;stroke-width:1}</style>
  <script>alert(1)</script>
  <metadata>junk</metadata>
  <g transform="translate(100 50)">
    <ellipse cx="100" cy="100" rx="90" ry="70" fill="#f9c"/>
    <circle cx="140" cy="80" r="15" fill="#c33"/>
    <rect x="40" y="110" width="30" height="20" fill="#3c3"/>
  </g>
  <text x="20" y="40" font-size="12">Nucleus</text>
  <line class="leader" x1="70" y1="36" x2="240" y2="130"/>
  <switch transform="translate(330 60)">
    <text systemLanguage="de" font-size="12">Zellmembran</text>
    <text systemLanguage="en" font-size="12">Cell membrane</text>
  </switch>
  <path d="M328 56 L300 56" stroke="#333" fill="none"/>
  <path d="M300 56 L282 108" stroke="#333" fill="none"/>
  <text x="20" y="200" font-size="12"><tspan x="20" y="200">Rough endoplasmic</tspan><tspan x="20" y="214">reticulum</tspan></text>
  <polyline points="120,203 150,203 155,170" stroke="#333" fill="none"/>
  <text x="200" y="160" font-size="11">Cytoplasm</text>
  <text x="380" y="290" font-size="9">10</text>
  <a xlink:href="https://evil.example/"><path d="M0 0 L1 1" stroke="red"/></a>
  <image xlink:href="https://evil.example/x.png" x="0" y="0" width="1" height="1"/>
</svg>`;

test("label extraction: each label's anchor is its leader's far end; no leader → low confidence; words and leaders leave the art", () => {
  const a = analyseSvg(FIXTURE);
  const by = new Map(a.labels.map((l) => [l.id, l]));
  assert.deepEqual([...by.keys()].sort(), ["cell-membrane", "cytoplasm", "nucleus", "rough-endoplasmic-reticulum"]);
  const nucleus = by.get("nucleus")!;
  assert.equal(nucleus.confidence, "high");
  assert.deepEqual(nucleus.anchor, { x: 240, y: 130 });
  // An elbowed leader drawn as two separate paths is followed to its end.
  assert.deepEqual(by.get("cell-membrane")!.anchor, { x: 282, y: 108 });
  assert.equal(by.get("cell-membrane")!.confidence, "high");
  // Two tspan lines are one label, its polyline leader ends on the part.
  assert.equal(by.get("rough-endoplasmic-reticulum")!.name, "Rough endoplasmic reticulum");
  assert.deepEqual(by.get("rough-endoplasmic-reticulum")!.anchor, { x: 155, y: 170 });
  // No leader: the words sat on the cell, so the anchor is where they sat — flagged for review.
  const cyto = by.get("cytoplasm")!;
  assert.equal(cyto.confidence, "low");
  assert.ok(cyto.anchor && Math.abs(cyto.anchor.x - 226) < 15 && Math.abs(cyto.anchor.y - 156) < 8, JSON.stringify(cyto.anchor));

  const out = serializeSvg(a, { x: 10, y: 20, w: 380, h: 270 });
  for (const gone of ["Nucleus", "Cell membrane", "Zellmembran", "reticulum", "Cytoplasm", "<script", "alert", "onload", "metadata", "evil.example", "<line", "M328 56", "polyline"]) assert.ok(!out.includes(gone), `${gone} removed`);
  assert.ok(out.includes(">10</text>"), "an axis number stays in the art");
  assert.ok(out.includes('viewBox="10 20 380 270"') && out.includes('width="380"'), "the root is sized to the crop");
  assert.ok(out.includes("<ellipse") && out.includes("<circle"), "the art stays");
});

const asset = (id: string, seed: string, keywords: string[], parts: string[], extra: Partial<LibraryAsset> = {}): LibraryAsset => ({
  id,
  title: `${seed} diagram`,
  keywords,
  seed,
  source: { url: `https://commons.wikimedia.org/wiki/File:${id}.svg`, author: "LadyofHats", licence: "Public domain", licenceUrl: "", revision: 1 },
  credit: "LadyofHats, Public domain, via Wikimedia Commons",
  w: 400,
  h: 300,
  parts: parts.map((name, i) => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), name, anchor: { x: 40 + i * 50, y: 60 + (i % 3) * 70 }, confidence: "high" as const })),
  reviewed: false,
  ...extra,
});
const INDEX: LibraryAsset[] = [
  asset("heart-diagram", "heart", ["heart", "cardiac", "ventricle", "atrium"], ["Right atrium", "Left atrium", "Right ventricle", "Left ventricle", "Aorta", "Pulmonary artery", "Vena cava"]),
  asset("animal-cell", "animal cell", ["animal cell", "organelle"], ["Nucleus", "Mitochondrion", "Cell membrane", "Cytoplasm"]),
  asset("eye-diagram", "eye", ["human eye", "eye", "retina", "cornea"], ["Retina", "Cornea", "Lens", "Iris", "Optic nerve"]),
  asset("heart-old", "heart", ["heart"], ["Aorta", "Valve", "Septum"], { rejected: true }),
];

test("retrieval: a heart board finds the heart; a board that never names a subject finds nothing", () => {
  const heart = pickLibraryAsset(INDEX, "The heart pumps blood. Blood enters the right atrium, then the right ventricle pumps it to the lungs through the pulmonary artery.");
  assert.equal(heart?.asset.id, "heart-diagram");
  assert.ok(heart!.parts.includes("right-atrium") && heart!.parts.includes("pulmonary-artery"));
  assert.equal(pickLibraryAsset(INDEX, "Calculate the resultant force on the trolley."), null);
  // One passing word is not enough: "the naked eye" on a board about stars.
  assert.equal(pickLibraryAsset(INDEX, "Some stars are visible to the naked eye on a clear night."), null);
  // What the syllabus says the board must show counts too.
  assert.equal(pickLibraryAsset(INDEX, "Structure of the eye", ["retina", "cornea"])?.asset.id, "eye-diagram");
  // A rejected asset is never offered.
  assert.notEqual(pickLibraryAsset(INDEX, "heart aorta valve septum")?.asset.id, "heart-old");
});

test("a library figure stage validates against its asset's parts and its labels land on the asset's anchors", () => {
  const a = stageAsset(INDEX[0]);
  const spec = validateCanvasSpec({
    heading: "Inside the heart",
    notes: [],
    cues: [{ s: 1, action: "point", target: "left-ventricle" }],
    stage: { kind: "figure", component: "library", asset: a, parts: [{ id: "right-atrium", name: "Right atrium", s: 0 }, { id: "left-ventricle", name: "Left ventricle (thick wall)", s: 1 }, { id: "aorta", s: 2 }, { id: "made-up", s: 2 }] },
  }, 4);
  assert.ok(spec && spec.stage.kind === "figure" && spec.stage.asset?.id === "heart-diagram");
  if (spec?.stage.kind !== "figure") return;
  assert.deepEqual(spec.stage.parts.map((p) => p.id), ["right-atrium", "left-ventricle", "aorta"], "a part the asset does not have is dropped");
  assert.equal(spec.stage.parts.find((p) => p.id === "aorta")!.name, "Aorta", "a part with no name takes the asset's");
  // An asset with an unsafe id (it becomes a URL) is refused.
  assert.equal(validateCanvasSpec({ heading: "x", notes: [], cues: [], stage: { kind: "figure", component: "library", asset: { ...a, id: "../etc/passwd" }, parts: [{ id: "aorta", s: 0 }] } }, 2), null);

  const layout = layoutPanel(spec);
  const fig = layout.marks.find((m) => m.type === "figure") as Extract<Mark, { type: "figure" }>;
  assert.equal(fig.asset, "heart-diagram");
  assert.ok(Math.abs(fig.rect.w / fig.rect.h - a.w / a.h) < 0.01, "the diagram keeps its aspect");
  const labels = layout.marks.filter((m): m is Extract<Mark, { type: "figure-label" }> => m.type === "figure-label");
  assert.equal(labels.length, 3);
  for (const l of labels) {
    const anchor = a.parts.find((p) => p.id === l.part)!.anchor;
    const end = l.leader[l.leader.length - 1];
    assert.ok(Math.abs(end.x - (fig.rect.x + anchor.x * fig.scale)) < 0.01 && Math.abs(end.y - (fig.rect.y + anchor.y * fig.scale)) < 0.01, `${l.part} leader ends on its anchor`);
  }
});

const beat = (over: Partial<CanvasPlanBeat>): CanvasPlanBeat => ({
  id: "b1", title: "Inside the heart", script: "The heart has four chambers. The right atrium receives blood from the body. The left ventricle pumps blood into the aorta.", stage: "illustration",
  brief: "a labelled diagram of the heart", objects: [], inside: null, carry: [], interaction: null, overview: false, ...over,
});

test("the visual policy gives a heart picture board the code-drawn heart; library is used when no component exists", () => {
  const find = (text: string, mustShow: string[] = []) => { const m = pickLibraryAsset(INDEX, text, mustShow); return m ? stageAsset(m.asset) : null; };
  const { beats } = applyLessonVisualPolicy([beat({}), beat({ id: "b2", title: "Resultant force", script: "Add the forces to find the resultant.", brief: "forces", stage: "equation" })], { mode: "prompt", findAsset: find });
  assert.equal(beats[0].stage, "figure");
  assert.equal(beats[0].figure, "heart", "a kit component beats a harvested SVG when both match");
  assert.equal(beats[1].stage, "equation", "other boards are untouched");
  const eye = beat({ title: "The human eye", script: "Label the retina, cornea, lens, iris and optic nerve of the eye.", brief: "a labelled diagram of the eye" });
  const eyed = applyLessonVisualPolicy([eye], { mode: "prompt", findAsset: find }).beats[0];
  assert.equal(eyed.stage, "figure");
  assert.equal(eyed.figure, "library");
  assert.equal(eyed.figureAsset?.id, "eye-diagram");
  // Strict source mode never adds a library or kit picture.
  assert.notEqual(applyLessonVisualPolicy([beat({})], { mode: "strict", findAsset: find }).beats[0].stage, "figure");
  // Without a library diagram, a physical subject with no kit component is a vector diagram.
  assert.equal(applyLessonVisualPolicy([eye], { mode: "prompt", aiPictures: false }).beats[0].stage, "diagram");

  const spec = fallbackSpec(beats[0]);
  assert.ok(spec.stage.kind === "figure" && spec.stage.component === "heart");
  if (spec.stage.kind !== "figure") return;
  assert.ok(spec.stage.parts.some((p) => p.id === "right-atrium" || p.id === "aorta"));
  assert.ok(validateCanvasSpec(spec, 3), "the fallback board validates");
});
