import { test } from "node:test";
import assert from "node:assert/strict";
import { reflectionRefraction, snell, criticalAngle, tracePrism } from "../figures/components/reflectionRefraction";
import { motionGraph, parseStages, stageArea } from "../figures/components/motionGraph";
import { moments, solveMoments } from "../figures/components/moments";
import { electromagnetism, transformer } from "../figures/components/electromagnetism";
import { sankey, sankeyFlow } from "../figures/components/sankey";
import type { FigureComponent, FigureDrawing, FigureParams } from "../figures/types";

const CASES: Array<[FigureComponent, FigureParams[]]> = [
  [reflectionRefraction, [
    {}, { setup: "plane-mirror", i: 35 }, { setup: "refraction", i: 40, n1: 1, n2: 1.5 }, { setup: "refraction", i: 0 },
    { setup: "refraction", i: 60, n1: 1.5, n2: 1 }, { setup: "total-internal-reflection" }, { setup: "total-internal-reflection", i: 30 },
    { setup: "total-internal-reflection", i: 41.81 }, { setup: "prism" }, { setup: "prism", i: 20, apex: 70, n: 1.9 }, { setup: "dispersion" },
    { setup: "nonsense", i: "x", n1: -4, n2: true },
  ]],
  [motionGraph, [
    {}, { type: "distance-time", segments: "0-4: 0 to 12 curve; 4-8: 12 to 30; 8-12: 30 to 30; 12-16: 30 to 0", tangentAt: 2 },
    { type: "acceleration-time", segments: "0-5: 2 to 2; 5-10: 0 to 0; 10-12: -3 to -3" },
    { type: "velocity-time", segments: "0-3: 6 to 0; 3-6: 0 to -6; 6-8: -6 to -6", gradient: "none", area: "all" },
    { type: "displacement-time", segments: "0-2: 0 to 5 curve down", area: "1", gradient: 1 }, { segments: "garbage", tangentAt: "z" },
  ]],
  [moments, [
    {}, { forces: "4 N at 30 cm left; F at 40 cm right; 2 N at 10 cm left", beamWeight: 5, pivot: 40, showReaction: true },
    { forces: "6 N at 0.5 m left; 3 N at ? m right", units: "m", length: 2 }, { forces: "5 N up at 20 cm right; 2 N at 40 cm right" },
    { forces: "1 N at 10 cm right; ? at 10 cm right" }, { forces: "", pivot: -5, length: "huge" },
  ]],
  [electromagnetism, [
    {}, { current: "clockwise", core: false, turns: 12 }, { device: "dc-motor" }, { device: "dc-motor", reverse: true }, { device: "ac-generator" },
    { device: "transformer", np: 200, ns: 50, vp: 240 }, { device: "transformer", np: 100, vs: 2000, vp: 230, ip: 2 }, { device: "relay" },
    { device: "relay", on: false }, { device: "electric-bell" }, { device: 42 },
  ]],
  [sankey, [
    {}, { flow: "electrical 200 J → useful light 40 J, thermal 150 J" }, { input: "electrical 1000 J", outputs: "useful kinetic 250 J, useful sound 50 J, thermal" },
    { input: "chemical 50 J", outputs: "kinetic 40 J, thermal 30 J" }, { input: "x", outputs: "y" },
  ]],
];

const finite = (d: FigureDrawing) => d.shapes.every((s) => (s.t === "path" ? !/NaN|Infinity/.test(s.d) : s.t === "circle" ? [s.cx, s.cy, s.r].every(Number.isFinite) : [s.x, s.y].every(Number.isFinite)));

test("physics set 2: built parts ⊆ declared, ≥2 with defaults, unique, anchors inside, shapes name real parts, nothing NaN", () => {
  for (const [c, sets] of CASES) {
    assert.ok(c.build({}).parts.length >= 2, `${c.name}: at least two parts with defaults`);
    for (const params of sets) {
      const d = c.build(params);
      const label = `${c.name} ${JSON.stringify(params)}`;
      const declared = new Set(c.parts.map((p) => p.id));
      const ids = d.parts.map((p) => p.id);
      assert.equal(new Set(ids).size, ids.length, `${label}: part ids unique`);
      for (const id of ids) assert.ok(declared.has(id), `${label}: ${id} declared`);
      for (const p of d.parts) assert.ok(p.anchor.x >= 0 && p.anchor.x <= d.w && p.anchor.y >= 0 && p.anchor.y <= d.h, `${label}: ${p.id} anchor inside`);
      for (const s of d.shapes) if (s.part) assert.ok(d.parts.some((p) => p.id === s.part), `${label}: unknown part ${s.part}`);
      assert.ok(finite(d), `${label}: finite geometry`);
      assert.ok(Number.isFinite(d.w) && Number.isFinite(d.h) && d.w > 0 && d.h > 0, `${label}: size`);
    }
  }
});

test("Snell's law and the critical angle", () => {
  for (const [i, n1, n2] of [[40, 1, 1.5], [30, 1.33, 1], [10, 1, 2.42], [0, 1, 1.5]] as const) {
    const r = snell(i, n1, n2)!;
    assert.ok(Math.abs(n1 * Math.sin((i * Math.PI) / 180) - n2 * Math.sin((r * Math.PI) / 180)) < 1e-12, `n1 sin i = n2 sin r for ${i}`);
  }
  assert.ok(Math.abs(criticalAngle(1.5, 1)! - 41.81) < 0.01);
  assert.equal(criticalAngle(1, 1.5), null);
  assert.equal(snell(50, 1.5, 1), null, "beyond c: total internal reflection");
  // The drawing switches to TIR beyond c and refracts below it.
  const tir = reflectionRefraction.build({ setup: "total-internal-reflection", i: 50 });
  assert.match(tir.parts.find((p) => p.id === "reflected-ray")!.name, /totally internally reflected/i);
  assert.ok(!tir.parts.some((p) => p.id === "refracted-ray"));
  assert.match(tir.parts.find((p) => p.id === "critical-angle")!.name, /41\.8°/);
  const below = reflectionRefraction.build({ setup: "total-internal-reflection", i: 30 });
  assert.ok(below.parts.some((p) => p.id === "refracted-ray"));
  assert.match(below.parts.find((p) => p.id === "angle-of-refraction")!.name, /48\.6°/); // asin(1.5 sin 30°)
  // Reflection: equal angles written.
  const m = reflectionRefraction.build({ setup: "plane-mirror", i: 35 });
  assert.match(m.parts.find((p) => p.id === "angle-of-reflection")!.name, /35°/);
});

test("prism: deviation and dispersion order", () => {
  // Minimum deviation for A = 60°, n = 1.5 is 37.18° at i = 48.59°.
  const t = tracePrism(60, 1.5, 48.59);
  assert.ok(t.emerged && Math.abs(t.deviation - 37.18) < 0.05, `deviation ${t.deviation}`);
  assert.ok(Math.abs(t.rIn - 30) < 0.05, "symmetric path: r = A/2 inside");
  // Higher index → larger deviation: violet is deviated more than red.
  assert.ok(tracePrism(60, 1.56, 48).deviation > tracePrism(60, 1.44, 48).deviation);
  const d = reflectionRefraction.build({ setup: "dispersion" });
  const red = d.parts.find((p) => p.id === "red-light")!, violet = d.parts.find((p) => p.id === "violet-light")!;
  assert.ok(red.anchor.y < violet.anchor.y, "red above violet (deviated least)");
});

test("motion graph: stages parsed, area under v–t = distance, gradients named", () => {
  const st = parseStages("0-4: 0 to 8; 4-10: 8 to 8; 10-12: 8 to 0");
  assert.equal(st.length, 3);
  const area = st.reduce((s, x) => s + stageArea(x).signed, 0);
  assert.equal(area, 16 + 48 + 8);
  const d = motionGraph.build({ segments: "0-4: 0 to 8; 4-10: 8 to 8; 10-12: 8 to 0" });
  assert.match(d.parts.find((p) => p.id === "area")!.name, /72 m/);
  assert.match(d.parts.find((p) => p.id === "accelerating")!.name, /2 m\/s²/);
  assert.match(d.parts.find((p) => p.id === "decelerating")!.name, /−4 m\/s²/);
  assert.match(d.parts.find((p) => p.id === "gradient")!.name, /8 ÷ 4 = 2/);
  // Curved stage: exact area (∫ of 8u² over 4 s = 4·8/3).
  assert.ok(Math.abs(stageArea({ t0: 0, t1: 4, y0: 0, y1: 8, curve: "up" }).signed - 32 / 3) < 1e-12);
  // Crossing zero: displacement vs distance.
  const neg = parseStages("0-3: 6 to 0; 3-6: 0 to -6");
  assert.deepEqual(neg.map((s) => [s.y0, s.y1]), [[6, 0], [0, -6]]);
  const cross = stageArea({ t0: 0, t1: 2, y0: 4, y1: -4, curve: null });
  assert.ok(Math.abs(cross.signed) < 1e-12 && Math.abs(cross.unsigned - 4) < 1e-6);
  const dt = motionGraph.build({ type: "distance-time", segments: "0-5: 0 to 20; 5-8: 20 to 20" });
  assert.match(dt.parts.find((p) => p.id === "constant")!.name, /4 m\/s/);
  assert.ok(dt.parts.some((p) => p.id === "stationary"));
  assert.ok(!dt.parts.some((p) => p.id === "area"), "no area by default on a d–t graph");
  const tan = motionGraph.build({ type: "distance-time", segments: "0-4: 0 to 16 curve", tangentAt: 2 });
  assert.match(tan.parts.find((p) => p.id === "tangent")!.name, /gradient 4 m\/s/); // d = t² → 2t
});

test("moments: principle of moments, solving the unknown, arrows to scale", () => {
  const r = solveMoments({ forces: "3 N at 20 cm left; 2 N at 30 cm right" });
  assert.equal(r.clockwise, 60);
  assert.equal(r.anticlockwise, 60);
  assert.equal(r.balanced, true);
  const u = solveMoments({ forces: "4 N at 30 cm left; F at 40 cm right; 2 N at 10 cm left", beamWeight: 5, pivot: 40 });
  assert.ok(Math.abs(u.forces[1].F - 2.25) < 1e-12 && u.balanced, "F = (120 + 20 − 5×10)/40");
  assert.ok(Math.abs(u.reaction - 13.25) < 1e-12);
  const dist = solveMoments({ forces: "6 N at 0.5 m left; 3 N at ? m right", units: "m" });
  assert.ok(Math.abs(dist.forces[1].d - 1) < 1e-12 && dist.lenUnit === "m");
  const off = solveMoments({ forces: "5 N at 20 cm left; 2 N at 20 cm right" });
  assert.equal(off.balanced, false);
  const up = solveMoments({ forces: "5 N up at 20 cm right; 2 N at 40 cm right" });
  assert.equal(up.anticlockwise, 100);
  assert.equal(up.clockwise, 80);
  assert.ok(solveMoments({ forces: "1 N at 10 cm right; ? at 10 cm right" }).unsolvable, "same-side unknown cannot balance");
  // Arrow length ∝ force: 3 N and 2 N arrows (shafts drawn to the beam top).
  const d = moments.build({ forces: "3 N at 20 cm left; 2 N at 30 cm right" });
  const shaftLen = (part: string) => {
    const s = d.shapes.find((x) => x.t === "path" && x.part === part && /^M[\d.]+ [\d.]+ L[\d.]+ [\d.]+$/.test(x.d)) as { d: string };
    const [, , y0, , y1] = s.d.match(/^M([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+)$/)!.map(Number);
    return Math.abs(y1 - y0);
  };
  const tip = 14 * 0.7; // the shaft stops inside the head
  assert.ok(Math.abs((shaftLen("force-1") + tip) / (shaftLen("force-2") + tip) - 1.5) < 0.01);
  assert.match(d.parts.find((p) => p.id === "clockwise-moment")!.name, /60 N cm/);
  assert.match(d.parts.find((p) => p.id === "pivot")!.name, /balanced/);
});

test("electromagnetism: transformer equation, poles by the grip rule, motor forces", () => {
  const t = transformer(200, 50, 240);
  assert.equal(t.vs / 240, 50 / 200);
  assert.equal(t.kind, "step-down");
  const up = transformer(100, 2000, 230, 2);
  assert.equal(up.vs, 4600);
  assert.ok(Math.abs(up.is! - 0.1) < 1e-12 && up.kind === "step-up");
  const d = electromagnetism.build({ device: "transformer", np: 100, vs: 4600, vp: 230 });
  assert.match(d.parts.find((p) => p.id === "secondary-coil")!.name, /2000 turns/);
  assert.match(d.parts.find((p) => p.id === "output")!.name, /4600 V.*step-up/);
  // Solenoid: anticlockwise from the left → left end N; clockwise → right end N.
  const nx = (params: FigureParams) => { const dr = electromagnetism.build(params); return dr.parts.find((p) => p.id === "north-pole")!.anchor.x < dr.parts.find((p) => p.id === "south-pole")!.anchor.x; };
  assert.equal(nx({}), true);
  assert.equal(nx({ current: "clockwise" }), false);
  // Motor: the parts a motor needs, a commutator not slip rings; generator the reverse.
  const motor = electromagnetism.build({ device: "dc-motor" }).parts.map((p) => p.id);
  assert.ok(motor.includes("commutator") && motor.includes("brushes") && motor.includes("force") && !motor.includes("slip-rings"));
  const gen = electromagnetism.build({ device: "ac-generator" }).parts.map((p) => p.id);
  assert.ok(gen.includes("slip-rings") && !gen.includes("commutator"));
  // Fleming's left-hand rule: with the current reversed, the force arrows flip.
  const leftForceUp = (params: FigureParams) => {
    const dr = electromagnetism.build(params);
    const a = dr.parts.find((p) => p.id === "force")!.anchor, c = dr.parts.find((p) => p.id === "coil")!.anchor;
    return a.y < c.y;
  };
  assert.equal(leftForceUp({ device: "dc-motor" }), true);
  assert.equal(leftForceUp({ device: "dc-motor", reverse: true }), false);
});

test("sankey: conservation, widths proportional, efficiency", () => {
  const r = sankeyFlow({ input: "chemical 100 J", outputs: "useful kinetic 30 J, thermal 60 J, sound 10 J" });
  assert.equal(r.efficiency, 0.3);
  assert.equal(r.adjusted, false);
  assert.deepEqual(r.outputs.map((o) => [o.name, o.value, o.useful]), [["kinetic", 30, true], ["thermal", 60, false], ["sound", 10, false]]);
  const short = sankeyFlow({ flow: "electrical 200 J → useful light 40 J, thermal 150 J" });
  assert.ok(short.adjusted && short.outputs.some((o) => o.name === "other" && o.value === 10));
  const rest = sankeyFlow({ input: "electrical 1000 J", outputs: "useful kinetic 250 J, useful sound 50 J, thermal" });
  assert.equal(rest.outputs.find((o) => o.name === "thermal")!.value, 700);
  assert.equal(rest.efficiency, 0.3);
  const over = sankeyFlow({ input: "chemical 50 J", outputs: "kinetic 40 J, thermal 30 J" });
  assert.ok(over.adjusted && over.input.value === 70);
  // Band widths ∝ energy: the input band's height (170) and each band's width at the split.
  const d = sankey.build({ input: "chemical 100 J", outputs: "useful kinetic 30 J, thermal 60 J, sound 10 J" });
  const inputBand = d.shapes.find((s) => s.t === "path" && s.part === "input") as { d: string };
  const ys = [...inputBand.d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => Number(m[2]));
  const H = Math.max(...ys) - Math.min(...ys);
  const usefulBand = d.shapes.find((s) => s.t === "path" && s.part === "useful-output") as { d: string };
  const pts = [...usefulBand.d.matchAll(/[ML]([\d.]+) ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const startX = Math.min(...pts.map((p) => p[0]));
  const atSplit = pts.filter((p) => Math.abs(p[0] - startX) < 1e-6).map((p) => p[1]);
  assert.ok(Math.abs((Math.max(...atSplit) - Math.min(...atSplit)) / H - 0.3) < 1e-3, "useful band is 30% of the input band");
  assert.match(d.parts.find((p) => p.id === "efficiency")!.name, /30%/);
});

test("match: specific positives, unrelated negatives", () => {
  const yes: Array<[FigureComponent, string]> = [
    [reflectionRefraction, "Refraction of light at a glass block and Snell's law"], [reflectionRefraction, "Total internal reflection and the critical angle"],
    [reflectionRefraction, "Dispersion of white light by a triangular prism"], [reflectionRefraction, "The law of reflection in a plane mirror"],
    [motionGraph, "Reading a velocity-time graph"], [motionGraph, "The area under a velocity-time graph gives distance"], [motionGraph, "distance-time graphs"],
    [moments, "The principle of moments"], [moments, "Balancing a see-saw"], [moments, "clockwise and anticlockwise moments"],
    [electromagnetism, "How a d.c. motor works"], [electromagnetism, "Step-up transformers in the National Grid"], [electromagnetism, "The electric bell"],
    [electromagnetism, "Magnetic field of a solenoid"], [electromagnetism, "AC generators and slip rings"],
    [sankey, "Drawing a Sankey diagram"], [sankey, "Useful energy and wasted energy"],
  ];
  const no: Array<[FigureComponent, string]> = [
    [reflectionRefraction, "Sound waves reflecting from a cliff as an echo"], [reflectionRefraction, "Ray diagram for a convex lens"],
    [motionGraph, "Plotting a graph of current against voltage"], [motionGraph, "Velocity of a wave"],
    [moments, "Momentum is conserved in collisions"], [moments, "Moment of a magnetic dipole"],
    [electromagnetism, "Electric field between parallel plates"], [electromagnetism, "A series circuit with two lamps"],
    [sankey, "Energy levels in an atom"], [sankey, "Kinetic energy formula"],
  ];
  for (const [c, s] of yes) assert.ok(c.match.test(s), `${c.name} should match: ${s}`);
  for (const [c, s] of no) assert.ok(!c.match.test(s), `${c.name} should not match: ${s}`);
});
