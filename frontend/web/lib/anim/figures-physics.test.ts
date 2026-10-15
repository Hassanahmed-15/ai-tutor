import { test } from "node:test";
import assert from "node:assert/strict";
import { circuit } from "../figures/components/circuit";
import { rayLens, thinLensImage } from "../figures/components/rayLens";
import { wave } from "../figures/components/wave";
import { fieldLines } from "../figures/components/fieldLines";
import { dnaStructure, complement, hydrogenBonds } from "../figures/components/dnaStructure";
import type { FigureComponent, FigureDrawing, FigureParams } from "../figures/types";

const CASES: Array<[FigureComponent, FigureParams[]]> = [
  [circuit, [{}, { series: "cell:6 V, switch, ammeter, lamp, resistor:4 Ω", voltmeterAcross: "lamp" }, { series: "battery:12 V, switch:closed, ammeter", branch1: "lamp", branch2: "resistor:2 Ω", branch3: "ldr", voltmeterAcross: "resistor" }, { series: "cell, ammeter, switch, fuse, resistor, lamp", branch1: "lamp", branch2: "lamp", voltmeterAcross: "lamp2" }, { series: "nonsense", branch1: 7 }]],
  [rayLens, [{}, { lens: "convex", f: 10, u: 5 }, { lens: "convex", f: 10, u: 10 }, { lens: "concave", f: 10, u: 20 }, { f: -3, u: "x" }]],
  [wave, [{}, { type: "longitudinal" }, { type: "transverse", wavelengths: 1 }, { type: "longitudinal", wavelengths: 4, amplitude: 1 }, { wavelengths: 99 }]],
  [fieldLines, [{}, { setup: "point-charge", sign: "-" }, { setup: "two-charges", signs: "+-" }, { setup: "two-charges", signs: "++" }, { setup: "two-charges", signs: "--" }, { setup: "parallel-plates" }, { setup: "bar-magnet" }, { setup: "earth-gravity" }]],
  [dnaStructure, [{}, { sequence: "ATGC" }, { sequence: "gattaca" }, { sequence: "xyz" }, { sequence: "AAAA" }]],
];

const finite = (d: FigureDrawing) => d.shapes.every((s) => (s.t === "path" ? !/NaN|Infinity/.test(s.d) : s.t === "circle" ? [s.cx, s.cy, s.r].every(Number.isFinite) : [s.x, s.y].every(Number.isFinite)));

test("every physics/biology component: declared parts are the built parts, anchors inside, shapes name real parts, nothing NaN", () => {
  for (const [c, sets] of CASES) {
    for (const params of sets) {
      const d = c.build(params);
      const label = `${c.name} ${JSON.stringify(params)}`;
      assert.deepEqual(d.parts.map((p) => p.id).sort(), c.parts.map((p) => p.id).sort(), label);
      for (const p of d.parts) assert.ok(p.anchor.x >= 0 && p.anchor.x <= d.w && p.anchor.y >= 0 && p.anchor.y <= d.h, `${label}: ${p.id} anchor inside`);
      for (const s of d.shapes) if (s.part) assert.ok(d.parts.some((p) => p.id === s.part), `${label}: unknown part ${s.part}`);
      assert.ok(finite(d), `${label}: finite geometry`);
    }
  }
});

test("thin lens: convex u=30, f=10 gives a real, inverted image at v=15, magnification 0.5", () => {
  const r = thinLensImage(10, 30);
  assert.ok(Math.abs(r.v - 15) < 1e-9);
  assert.ok(Math.abs(Math.abs(r.m) - 0.5) < 1e-9);
  assert.equal(r.real, true);
  assert.equal(r.upright, false);
  const d = rayLens.build({ lens: "convex", f: 10, u: 30 });
  assert.match(d.parts.find((p) => p.id === "image")!.name, /real, inverted, smaller/);
});

test("thin lens: convex u=5, f=10 gives a virtual, upright, magnified image; concave always virtual, upright, smaller", () => {
  const r = thinLensImage(10, 5);
  assert.ok(Math.abs(r.v - -10) < 1e-9);
  assert.equal(r.real, false);
  assert.equal(r.upright, true);
  assert.ok(Math.abs(r.m - 2) < 1e-9);
  assert.match(rayLens.build({ lens: "convex", f: 10, u: 5 }).parts.find((p) => p.id === "image")!.name, /virtual, upright, larger/);
  for (const u of [3, 10, 25, 60]) {
    const c = thinLensImage(-10, u);
    assert.ok(!c.real && c.upright && c.m < 1 && c.v < 0 && -c.v < 10, `concave u=${u}`);
  }
  assert.equal(thinLensImage(10, 10).atInfinity, true);
  // The image arrow is drawn exactly where 1/f = 1/u + 1/v puts it: its foot is on the axis at v.
  const d = rayLens.build({ lens: "convex", f: 10, u: 30 });
  const lensCx = d.shapes.find((s) => s.t === "circle" && s.part === "optical-centre") as { cx: number };
  const objectFoot = Number((d.shapes.find((s) => s.t === "path" && s.part === "object") as { d: string }).d.match(/^M([\d.]+)/)![1]);
  const imageFoot = Number((d.shapes.find((s) => s.t === "path" && s.part === "image") as { d: string }).d.match(/^M([\d.]+)/)![1]);
  assert.ok(Math.abs((imageFoot - lensCx.cx) / (lensCx.cx - objectFoot) - 0.5) < 0.01, "v/u = 15/30 on the drawing");
});

test("DNA: the complement of ATGC is TACG, with 2 hydrogen bonds per A–T and 3 per C–G, drawn as such", () => {
  assert.equal(complement("ATGC"), "TACG");
  assert.equal(hydrogenBonds("A"), 2);
  assert.equal(hydrogenBonds("T"), 2);
  assert.equal(hydrogenBonds("C"), 3);
  assert.equal(hydrogenBonds("G"), 3);
  const d = dnaStructure.build({ sequence: "ATGC" });
  const bonds = d.shapes.filter((s) => s.part === "hydrogen-bonds");
  assert.equal(bonds.length, 2 + 2 + 3 + 3);
  const letters = d.shapes.filter((s): s is Extract<typeof s, { t: "text" }> => s.t === "text" && /^[ATGC]$/.test(s.text));
  const bottomRow = letters.filter((s) => s.y > d.h / 2).sort((a, b) => a.x - b.x).map((s) => s.text).join("");
  const topRow = letters.filter((s) => s.y < d.h / 2).sort((a, b) => a.x - b.x).map((s) => s.text).join("");
  assert.equal(topRow, "ATGC");
  assert.equal(bottomRow, "TACG");
});

/** Arrowhead tips: the first point of each direction-arrow path. */
const arrowTips = (d: FigureDrawing) =>
  d.shapes.filter((s): s is Extract<typeof s, { t: "path" }> => s.t === "path" && s.part === "direction-arrow").map((s) => {
    const nums = s.d.match(/-?[\d.]+/g)!.map(Number);
    const tip = { x: nums[0], y: nums[1] };
    const back = { x: (nums[2] + nums[4]) / 2, y: (nums[3] + nums[5]) / 2 };
    return { tip, back };
  });

test("field arrows point away from a + charge and towards a − charge; N to S; + plate to − plate; into the Earth", () => {
  for (const [sign, out] of [["+", 1], ["-", -1]] as const) {
    const d = fieldLines.build({ setup: "point-charge", sign });
    const c = { x: d.w / 2, y: d.h / 2 };
    const tips = arrowTips(d);
    assert.ok(tips.length >= 8);
    for (const { tip, back } of tips) {
      const radial = Math.hypot(tip.x - c.x, tip.y - c.y) - Math.hypot(back.x - c.x, back.y - c.y);
      assert.ok(radial * out > 0, `${sign} arrow direction`);
    }
  }
  // Opposite charges: every arrow on the axis side between them points from + (left) to − (right).
  const two = fieldLines.build({ setup: "two-charges", signs: "+-" });
  const mid = arrowTips(two).filter(({ tip }) => Math.abs(tip.x - two.w / 2) < 20 && Math.abs(tip.y - two.h / 2) < 120);
  assert.ok(mid.length >= 2);
  for (const { tip, back } of mid) assert.ok(tip.x > back.x, "+ to −");
  // Parallel plates, + on top: the field points down.
  for (const { tip, back } of arrowTips(fieldLines.build({ setup: "parallel-plates", top: "+" }))) assert.ok(tip.y > back.y);
  for (const { tip, back } of arrowTips(fieldLines.build({ setup: "parallel-plates", top: "-" }))) assert.ok(tip.y < back.y);
  // Bar magnet (N on the left): above the magnet's middle, the field runs N→S (left to right).
  const mag = fieldLines.build({ setup: "bar-magnet" });
  const above = arrowTips(mag).filter(({ tip }) => Math.abs(tip.x - mag.w / 2) < 15 && tip.y < mag.h / 2 - 40);
  assert.ok(above.length >= 2);
  for (const { tip, back } of above) assert.ok(tip.x > back.x, "N to S outside the magnet");
  // Gravity: inwards.
  const g = fieldLines.build({ setup: "earth-gravity" });
  for (const { tip, back } of arrowTips(g)) assert.ok(Math.hypot(tip.x - g.w / 2, tip.y - g.h / 2) < Math.hypot(back.x - g.w / 2, back.y - g.h / 2));
});

test("circuit: polarity, a voltmeter in parallel, parallel rungs with junctions, and components from words", () => {
  const d = circuit.build({ series: "cell:6 V, switch, ammeter, lamp", voltmeterAcross: "lamp" });
  const ids = d.parts.map((p) => p.id);
  for (const id of ["cell", "switch", "ammeter", "lamp", "voltmeter"]) assert.ok(ids.indexOf(id) < 6, `${id} is listed first`);
  assert.ok(d.shapes.some((s) => s.t === "text" && s.text === "6 V"));
  assert.ok(d.shapes.some((s) => s.t === "text" && s.part === "voltmeter" && s.text === "V"));
  assert.equal(d.shapes.filter((s) => s.part === "junction").length, 2, "voltmeter joins at two junctions");
  // The cell's long (+) plate is on the side the conventional current leaves (clockwise: to the right on the top wire).
  const plates = d.shapes
    .filter((s): s is Extract<typeof s, { t: "path" }> => s.t === "path" && s.part === "cell")
    .map((s) => s.d.match(/-?[\d.]+/g)!.map(Number))
    .filter((n) => n.length === 4 && n[0] === n[2]) // vertical strokes: the plates
    .map((n) => ({ x: n[0], len: Math.abs(n[3] - n[1]) }));
  const long = plates.find((p) => p.len > 30)!, short = plates.find((p) => p.len < 30)!;
  assert.ok(long && short && long.x > short.x, "+ plate on the right of the cell on the top wire");
  const par = circuit.build({ series: "battery", branch1: "lamp", branch2: "lamp", branch3: "resistor" });
  assert.equal(par.shapes.filter((s) => s.part === "junction").length, 4, "two junctions per inner rung");
  assert.ok(par.shapes.some((s) => s.part === "battery"));
  const words = circuit.build({ series: "light bulb, rheostat, light-dependent resistor, LED reverse" });
  for (const id of ["cell", "lamp", "variable-resistor", "ldr", "led"]) assert.ok(words.shapes.some((s) => s.part === id), id);
});

test("match: each component is chosen by its own words, not by others'", () => {
  const yes: Array<[FigureComponent, string]> = [
    [circuit, "Draw a series circuit with an ammeter and a voltmeter"], [circuit, "a thermistor in a potential divider"],
    [rayLens, "ray diagram for a convex lens"], [rayLens, "how a magnifying glass forms an image"], [rayLens, "the focal length of a diverging lens"],
    [wave, "a transverse wave has crests and troughs"], [wave, "compressions and rarefactions in sound"], [wave, "label the wavelength and amplitude"],
    [fieldLines, "draw the electric field lines around a charge"], [fieldLines, "magnetic field of a bar magnet"], [fieldLines, "uniform field between parallel plates"],
    [dnaStructure, "the structure of DNA"], [dnaStructure, "complementary base pairing"], [dnaStructure, "adenine pairs with thymine"],
  ];
  const no: Array<[FigureComponent, string]> = [
    [circuit, "the circle of life"], [circuit, "a ray diagram for a lens"], [rayLens, "a contact lens is worn on the eye's surface"], [rayLens, "electric circuits"],
    [wave, "people waved goodbye"], [wave, "a microwave oven"], [fieldLines, "a field of wheat"], [fieldLines, "a series circuit"],
    [dnaStructure, "a basic pair of shoes"], [dnaStructure, "light passes through a lens"],
  ];
  for (const [c, text] of yes) assert.ok(c.match.test(text), `${c.name} should match "${text}"`);
  for (const [c, text] of no) assert.ok(!c.match.test(text), `${c.name} should not match "${text}"`);
});
