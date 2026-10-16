import { test } from "node:test";
import assert from "node:assert/strict";
import type { FigureComponent, FigureDrawing, FigureParams, FigureShape, Pt } from "../figures/types";
import { nephron } from "../figures/components/nephron";
import { reflexArc } from "../figures/components/reflexArc";
import { synapse } from "../figures/components/synapse";
import { skinSection } from "../figures/components/skinSection";
import { endocrineGlands } from "../figures/components/endocrineGlands";

/** Every component with each of its variants. */
const VARIANTS: Array<[FigureComponent, FigureParams[]]> = [
  [nephron, [{}, { processes: "none" }, { processes: "ultrafiltration" }, { processes: "reabsorption" }, { processes: "all" }]],
  [reflexArc, [{}, { effector: "gland" }, { effector: "muscle", arrows: false }]],
  [synapse, [{}, { step: 0 }, { step: 1 }, { step: 2 }, { step: 3 }, { step: 4 }, { step: "exocytosis" }]],
  [skinSection, [{}, { response: "none" }, { response: "hot" }, { response: "cold" }]],
  [endocrineGlands, [{}, { sex: "both" }, { sex: "female" }, { sex: "male" }]],
];

/* ── geometry: is an anchor ON one of its part's shapes? ─────────────────────────────────── */

/** A path flattened to polylines (absolute and relative M L H V C Q A Z), one per subpath. */
function flatten(d: string): Pt[][] {
  const tokens = d.match(/[MLHVCQAZmlhvcqaz]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  let i = 0, cmd = "M", x = 0, y = 0, sx = 0, sy = 0;
  const n = () => Number(tokens[i++]);
  const isNum = () => i < tokens.length && !/^[A-Za-z]$/.test(tokens[i]);
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    if (C === "Z") { cur.push({ x: sx, y: sy }); x = sx; y = sy; continue; }
    if (!isNum()) { i++; continue; }
    const P = (): Pt => { const a = n(), b = n(); return rel ? { x: x + a, y: y + b } : { x: a, y: b }; };
    if (C === "M") { if (cur.length) out.push(cur); const p = P(); cur = [p]; x = sx = p.x; y = sy = p.y; cmd = rel ? "l" : "L"; }
    else if (C === "L") { const p = P(); cur.push(p); x = p.x; y = p.y; }
    else if (C === "H") { const a = n(); x = rel ? x + a : a; cur.push({ x, y }); }
    else if (C === "V") { const a = n(); y = rel ? y + a : a; cur.push({ x, y }); }
    else if (C === "C" || C === "Q") {
      const c1 = P(), c2 = C === "C" ? P() : c1, e = P(), s = { x, y };
      for (let k = 1; k <= 16; k++) {
        const t = k / 16, u = 1 - t;
        cur.push(C === "C"
          ? { x: u ** 3 * s.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * e.x, y: u ** 3 * s.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * e.y }
          : { x: u * u * s.x + 2 * u * t * c1.x + t * t * e.x, y: u * u * s.y + 2 * u * t * c1.y + t * t * e.y });
      }
      x = e.x; y = e.y;
    } else if (C === "A") {
      let rx = Math.abs(n()), ry = Math.abs(n());
      const rot = (n() * Math.PI) / 180, large = n() !== 0, sweep = n() !== 0;
      const e = P(), s = { x, y };
      // Endpoint → centre parameterisation (SVG 1.1 F.6.5), sampled.
      const cs = Math.cos(rot), sn = Math.sin(rot);
      const dx = (s.x - e.x) / 2, dy = (s.y - e.y) / 2;
      const x1 = cs * dx + sn * dy, y1 = -sn * dx + cs * dy;
      const lam = (x1 * x1) / (rx * rx || 1) + (y1 * y1) / (ry * ry || 1);
      if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
      const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1, den = rx * rx * y1 * y1 + ry * ry * x1 * x1 || 1;
      const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
      const cx1 = (k * rx * y1) / (ry || 1), cy1 = (-k * ry * x1) / (rx || 1);
      const cx = cs * cx1 - sn * cy1 + (s.x + e.x) / 2, cy = sn * cx1 + cs * cy1 + (s.y + e.y) / 2;
      const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
      let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
      if (!sweep && dt > 0) dt -= 2 * Math.PI;
      if (sweep && dt < 0) dt += 2 * Math.PI;
      for (let j = 1; j <= 24; j++) {
        const t = t1 + (dt * j) / 24;
        cur.push({ x: cx + rx * Math.cos(t) * cs - ry * Math.sin(t) * sn, y: cy + rx * Math.cos(t) * sn + ry * Math.sin(t) * cs });
      }
      x = e.x; y = e.y;
    } else i++;
  }
  if (cur.length) out.push(cur);
  return out;
}

function distToPolyline(p: Pt, pts: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return pts.length === 1 ? Math.hypot(p.x - pts[0].x, p.y - pts[0].y) : best;
}

function inside(p: Pt, poly: Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-9) + a.x) hit = !hit;
  }
  return hit;
}

/** Is the point on the shape: inside its fill, or within its stroke (plus a little slack)? */
function onShape(p: Pt, s: FigureShape): boolean {
  const slack = 5;
  if (s.t === "circle") return Math.hypot(p.x - s.cx, p.y - s.cy) <= s.r + (s.width ?? 0) / 2 + slack;
  if (s.t === "text") return Math.abs(p.y - (s.y - s.size / 2)) <= s.size && Math.abs(p.x - s.x) <= s.text.length * s.size;
  const subs = flatten(s.d);
  const reach = (s.stroke && s.stroke !== "none" ? (s.width ?? 1) / 2 : 0) + slack;
  return subs.some((pts) => distToPolyline(p, pts) <= reach || (s.fill && s.fill !== "none" && pts.length > 2 && inside(p, pts)));
}

function checkDrawing(c: FigureComponent, d: FigureDrawing, label: string) {
  const declared = c.parts.map((p) => p.id);
  const built = d.parts.map((p) => p.id);
  for (const id of built) assert.ok(declared.includes(id), `${label}: ${id} is declared`);
  assert.equal(new Set(built).size, built.length, `${label}: part ids are unique`);
  for (const id of declared) assert.match(id, /^[a-z]+(-[a-z]+)*$/, `${label}: ${id} is kebab-case`);
  for (const p of d.parts) {
    assert.ok(Number.isFinite(p.anchor.x) && Number.isFinite(p.anchor.y), `${label}: ${p.id} anchor finite`);
    assert.ok(p.anchor.x >= 0 && p.anchor.x <= d.w && p.anchor.y >= 0 && p.anchor.y <= d.h, `${label}: ${p.id} anchor inside ${d.w}×${d.h}`);
    assert.ok(p.name.length > 0 && p.name.length <= 34, `${label}: ${p.id} name fits a label (${p.name})`);
    const own = d.shapes.filter((s) => s.part === p.id);
    assert.ok(own.length > 0, `${label}: ${p.id} has shapes`);
    assert.ok(own.some((s) => onShape(p.anchor, s)), `${label}: ${p.id} anchor (${p.anchor.x}, ${p.anchor.y}) lies on one of its own shapes`);
  }
  for (const s of d.shapes) {
    if (s.part) assert.ok(built.includes(s.part), `${label}: shape names an unbuilt part ${s.part}`);
    if (s.t === "text") {
      assert.ok(s.x >= 0 && s.x <= d.w && s.y >= 0 && s.y <= d.h && !/NaN|undefined/.test(s.text), `${label}: text "${s.text}" inside and finite`);
      assert.ok(s.size >= 14, `${label}: text "${s.text}" is at least 14`);
      // Text in the art is only symbols and numbers, never a part's name.
      for (const p of d.parts) assert.ok(!s.text.toLowerCase().includes(p.name.toLowerCase()), `${label}: "${s.text}" repeats the label ${p.name}`);
    }
    if (s.t === "path") assert.ok(!/NaN|Infinity|undefined/.test(s.d), `${label}: path has finite numbers`);
    if (s.t === "circle") assert.ok([s.cx, s.cy, s.r].every(Number.isFinite), `${label}: circle finite`);
  }
  assert.ok(d.w >= 560 && d.w <= 760 && d.h >= 260 && d.h <= 460, `${label}: size ${d.w}×${d.h} within 560–760 × 260–460`);
}

const ids = (d: FigureDrawing) => d.parts.map((p) => p.id);
const widthOf = (d: FigureDrawing, part: string) => Math.max(...d.shapes.filter((s) => s.part === part && s.t === "path").map((s) => s.width ?? 0));

test("every component and variant builds cleanly, with every anchor on its own part", () => {
  for (const [c, variants] of VARIANTS) for (const v of variants) checkDrawing(c, c.build(v), `${c.name} ${JSON.stringify(v)}`);
});

test("between them, a component's variants build every part it declares", () => {
  for (const [c, variants] of VARIANTS) {
    const seen = new Set(variants.flatMap((v) => ids(c.build(v))));
    for (const p of c.parts) assert.ok(seen.has(p.id), `${c.name}: ${p.id} is built by some variant`);
    assert.ok(c.title.length > 20 && !/\n/.test(c.title), `${c.name}: one-line title`);
    assert.ok(/default/i.test(c.params), `${c.name}: params name their defaults`);
  }
});

test("hostile or odd params never throw and still draw", () => {
  const junk: FigureParams[] = [
    { processes: "<script>", step: -9, response: 42, sex: "", effector: true },
    { step: 99, processes: 7, response: "boiling hot!!", sex: "MALE", arrows: "maybe" },
    { step: "NaN", response: "freezing cold", sex: "female and male", effector: "salivary gland" },
    { step: 2.6, processes: "ultrafiltration and reabsorption", response: "", arrows: 0 },
    { step: "Infinity", processes: "", response: null as never, sex: undefined as never },
  ];
  for (const [c] of VARIANTS) {
    for (const p of junk) checkDrawing(c, c.build(p), `${c.name} ${JSON.stringify(p)}`);
    checkDrawing(c, c.build(undefined as never), `${c.name} undefined params`);
  }
});

test("nephron: processes add their arrows; the afferent arteriole is wider than the efferent", () => {
  const none = nephron.build({});
  assert.ok(!["ultrafiltration", "selective-reabsorption", "water-reabsorption", "urine"].some((id) => ids(none).includes(id)));
  assert.ok(["glomerulus", "bowmans-capsule", "pct", "loop-of-henle", "dct", "collecting-duct", "peritubular-capillaries", "afferent-arteriole", "efferent-arteriole", "cortex", "medulla"].every((id) => ids(none).includes(id)));
  assert.ok(ids(nephron.build({ processes: "ultrafiltration" })).includes("ultrafiltration"));
  const re = ids(nephron.build({ processes: "reabsorption" }));
  assert.ok(re.includes("selective-reabsorption") && re.includes("water-reabsorption") && !re.includes("ultrafiltration"));
  assert.ok(["ultrafiltration", "selective-reabsorption", "water-reabsorption", "urine"].every((id) => ids(nephron.build({ processes: "all" })).includes(id)));
  assert.ok(widthOf(none, "afferent-arteriole") > widthOf(none, "efferent-arteriole"));
  // The glomerulus and both convoluted tubules lie in the cortex, the loop's bend in the medulla.
  const at = (id: string) => none.parts.find((p) => p.id === id)!.anchor;
  const boundary = (at("cortex").y + at("medulla").y) / 2;
  for (const id of ["glomerulus", "bowmans-capsule", "pct", "dct"]) assert.ok(at(id).y < boundary, `${id} in the cortex`);
  assert.ok(at("loop-of-henle").y > boundary, "the loop dips into the medulla");
});

test("reflex arc: receptor → sensory → relay → motor → effector, with the cell body in the ganglion", () => {
  const d = reflexArc.build({});
  const at = (id: string) => d.parts.find((p) => p.id === id)!.anchor;
  for (const id of ["receptor", "sensory-neurone", "dorsal-root-ganglion", "cell-body", "relay-neurone", "motor-neurone", "effector", "grey-matter", "white-matter", "synapse", "impulse"]) assert.ok(ids(d).includes(id), id);
  // The sensory cell body sits inside the ganglion's swelling.
  const ganglion = d.shapes.find((s) => s.part === "dorsal-root-ganglion" && s.t === "path")!;
  assert.ok(onShape(at("cell-body"), ganglion), "cell body inside the dorsal root ganglion");
  // The relay neurone is inside the grey matter.
  const grey = d.shapes.find((s) => s.part === "grey-matter")!;
  assert.ok(onShape(at("relay-neurone"), grey), "relay neurone in the grey matter");
  assert.equal(reflexArc.build({ effector: "gland" }).parts.find((p) => p.id === "effector")!.name, "Effector (gland)");
  assert.ok(!ids(reflexArc.build({ arrows: false })).includes("impulse"));
});

test("synapse: each step adds its event, cumulatively", () => {
  const steps = [0, 1, 2, 3, 4].map((step) => ids(synapse.build({ step })));
  for (let i = 1; i < steps.length; i++) for (const id of steps[i - 1]) assert.ok(steps[i].includes(id), `step ${i} keeps ${id}`);
  assert.ok(steps[0].includes("impulse") && !steps[0].includes("calcium-ions"));
  assert.ok(steps[1].includes("calcium-ions") && !steps[1].includes("exocytosis"));
  assert.ok(steps[2].includes("exocytosis") && !steps[2].includes("sodium-ions"));
  assert.ok(steps[3].includes("sodium-ions") && steps[3].includes("depolarisation") && !steps[3].includes("choline-recycling"));
  assert.ok(steps[4].includes("choline-recycling"));
  assert.deepEqual(ids(synapse.build({})), steps[4], "default shows the whole sequence");
  assert.deepEqual(ids(synapse.build({ step: "binding" })), steps[3]);
  const texts = synapse.build({ step: 4 }).shapes.flatMap((s) => (s.t === "text" ? [s.text] : []));
  assert.ok(texts.includes("Ca²⁺") && texts.includes("Na⁺"));
});

test("skin: hot dilates the surface arterioles and closes the shunt; cold the reverse", () => {
  const hot = skinSection.build({ response: "hot" }), cold = skinSection.build({ response: "cold" }), none = skinSection.build({});
  assert.ok(widthOf(hot, "capillaries") > widthOf(none, "capillaries") && widthOf(none, "capillaries") > widthOf(cold, "capillaries"));
  assert.ok(widthOf(cold, "shunt-vessel") > widthOf(none, "shunt-vessel") && widthOf(none, "shunt-vessel") > widthOf(hot, "shunt-vessel"));
  assert.ok(ids(hot).includes("sweat") && ids(hot).includes("heat-loss") && !ids(hot).includes("shivering"));
  assert.ok(ids(cold).includes("shivering") && !ids(cold).includes("sweat"));
  // Hairs lie flat when hot and stand up when cold: the hair's tip is higher above the surface.
  const tipY = (d: FigureDrawing) => d.parts.find((p) => p.id === "hair")!.anchor.y;
  assert.ok(tipY(cold) < tipY(none) && tipY(none) < tipY(hot));
});

test("endocrine glands: placed top to bottom in anatomical order; sex chooses the gonads", () => {
  const d = endocrineGlands.build({});
  const y = (id: string) => d.parts.find((p) => p.id === id)!.anchor.y;
  assert.ok(y("pituitary") < y("thyroid") && y("thyroid") < y("adrenal-glands") && y("adrenal-glands") < y("pancreas") && y("pancreas") < y("ovaries") && y("ovaries") < y("testes"));
  assert.ok(ids(endocrineGlands.build({ sex: "female" })).includes("ovaries") && !ids(endocrineGlands.build({ sex: "female" })).includes("testes"));
  assert.ok(ids(endocrineGlands.build({ sex: "male" })).includes("testes") && !ids(endocrineGlands.build({ sex: "male" })).includes("ovaries"));
  assert.equal(d.parts.find((p) => p.id === "ovaries")!.name, "Ovaries (female)");
});

test("match: these boards ask for these figures, and other biology does not", () => {
  const yes: Array<[FigureComponent, string]> = [
    [nephron, "The structure of a nephron"], [nephron, "Ultrafiltration in Bowman’s capsule produces the glomerular filtrate"], [nephron, "How the loop of Henle concentrates urine"], [nephron, "Selective reabsorption in the proximal convoluted tubule"],
    [reflexArc, "The reflex arc"], [reflexArc, "A relay neurone connects the sensory neurone to the motor neurone"], [reflexArc, "Reflex actions: receptor, spinal cord and effector"],
    [synapse, "Transmission across a cholinergic synapse"], [synapse, "Acetylcholine is broken down by acetylcholinesterase"], [synapse, "Neurotransmitters cross the synaptic cleft"],
    [skinSection, "Sweat glands and vasodilation in temperature control"], [skinSection, "A section through human skin"], [skinSection, "Thermoregulation: shivering and the hair erector muscles"],
    [endocrineGlands, "The endocrine system"], [endocrineGlands, "The positions of the main endocrine glands"], [endocrineGlands, "The pituitary gland controls the thyroid and adrenal glands"],
  ];
  for (const [c, text] of yes) assert.ok(c.match.test(text), `${c.name} should match "${text}"`);
  const no: Array<[FigureComponent, string]> = [
    [nephron, "The kidney and the urinary system"], [nephron, "Tissue fluid forms by filtration from capillaries"], [nephron, "Structure of the heart"],
    [reflexArc, "Structure of a motor neurone"], [reflexArc, "The nervous system and the brain"], [reflexArc, "The pupil reflex and the iris"],
    [synapse, "Protein synthesis at the ribosome"], [synapse, "The structure of a nerve and the myelin sheath"], [synapse, "Photosynthesis in the chloroplast"],
    [skinSection, "Skin as a barrier to pathogens"], [skinSection, "The structure of a leaf"], [skinSection, "Blood glucose control by insulin"],
    [endocrineGlands, "The pancreas secretes insulin and glucagon"], [endocrineGlands, "The thyroid gland makes thyroxine"], [endocrineGlands, "The human body's digestive system"],
  ];
  for (const [c, text] of no) assert.ok(!c.match.test(text), `${c.name} should not match "${text}"`);
  // Generic words alone never call these figures.
  for (const [c] of VARIANTS) for (const word of ["kidney", "nerve", "body", "skin", "gland", "hormone", "neurone"]) assert.ok(!c.match.test(word), `${c.name} should not fire on "${word}"`);
});
