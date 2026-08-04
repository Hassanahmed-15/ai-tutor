/**
 * Tests for the animation library and the LiveSketch features built on it.
 *
 * Run with `npm run test:anim` (compiles via tsconfig.test.json, then `node --test`).
 *
 * Three things are worth testing here and nothing else really is:
 *  1. Timing invariants — a stagger where some element never reaches 1 leaves part of the
 *     board permanently invisible, and that is silent. Curves are asserted at their endpoints.
 *  2. Geometry stays on the board — every arrangement and placement is clamped, and the whole
 *     point of the layout helpers is that they degrade rather than overflow.
 *  3. Parity between rate.ts/compose.ts and the ES5 copy in sandboxRuntime.ts. That copy is
 *     hand-synced because the sandbox iframe has no module loader, so drift is a real risk and
 *     would show up only as generated animations easing differently from the host board.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import {
  clamp01,
  lerp,
  smooth,
  rushInto,
  rushFrom,
  slowInto,
  doubleSmooth,
  easeInOutCubic,
  easeOutBack,
  springPop,
  thereAndBack,
  thereAndBackWithPause,
  wiggle,
  stepEnd,
  withReducedMotion,
} from "./rate";
import { phase, lagged, laggedRange, succession, successionRanges, group } from "./compose";
import { arrangeRow, arrangeColumn, arrangeRadial, arrangeGrid, arrangeFlow, SAFE } from "./arrange";
import { nextTo, nextToAvoiding, intersects, unionBounds, DIRECTIONS, isDirection, type Bounds } from "./nextTo";
import { ANIM_SANDBOX_RUNTIME } from "./sandboxRuntime";
import { nextSeekTarget } from "./seek";
import { isManimWorthy } from "../manimRouting";
import { isGsapWorthy, selectAnimationRenderer } from "../animationRouting";
import { validateManimSceneSpec } from "../manimSceneSpec";
import { validateStructureSpec } from "../structureSpec";
import { BOARD_H, BOARD_W, layoutStructure } from "../structureLayout";
import { LiveSketch } from "../../components/sketch/LiveSketch";

const SAMPLES = [0, 0.05, 0.17, 0.33, 0.5, 0.66, 0.83, 0.95, 1];
const inSafe = (p: { x: number; y: number }) =>
  p.x >= SAFE.minX - 1e-9 && p.x <= SAFE.maxX + 1e-9 && p.y >= SAFE.minY - 1e-9 && p.y <= SAFE.maxY + 1e-9;

/* ------------------------------------------------------------------ rate */

test("monotonic rate functions start at 0, end at 1, and never go backwards", () => {
  const monotonic = { smooth, rushInto, rushFrom, slowInto, doubleSmooth, easeInOutCubic };
  for (const [name, fn] of Object.entries(monotonic)) {
    assert.equal(fn(0), 0, `${name}(0)`);
    assert.ok(Math.abs(fn(1) - 1) < 1e-9, `${name}(1) was ${fn(1)}`);
    let prev = -Infinity;
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const v = fn(t);
      assert.ok(Number.isFinite(v), `${name}(${t}) not finite`);
      assert.ok(v >= prev - 1e-9, `${name} went backwards at ${t}`);
      prev = v;
    }
  }
});

test("overshoot curves land exactly on 1 even though they pass it", () => {
  // springPop and easeOutBack are deliberately non-monotonic — the overshoot IS the pop.
  for (const [name, fn] of Object.entries({ springPop, easeOutBack })) {
    assert.equal(fn(0), 0, `${name}(0)`);
    assert.ok(Math.abs(fn(1) - 1) < 1e-9, `${name}(1) was ${fn(1)}`);
    const peak = Math.max(...Array.from({ length: 101 }, (_, i) => fn(i / 100)));
    assert.ok(peak > 1, `${name} should overshoot, peaked at ${peak}`);
  }
});

test("emphasis curves return to zero so a mark never becomes permanent ink", () => {
  assert.ok(Math.abs(thereAndBack(1)) < 1e-9);
  assert.ok(Math.abs(thereAndBackWithPause(1)) < 1e-9);
  assert.ok(Math.abs(wiggle(0)) < 1e-9 && Math.abs(wiggle(1)) < 1e-9);
  assert.equal(thereAndBack(0.5), 1, "peaks at the midpoint");
});

test("thereAndBackWithPause actually holds, giving the eye time to land", () => {
  assert.equal(thereAndBackWithPause(0.45), 1);
  assert.equal(thereAndBackWithPause(0.5), 1);
  assert.equal(thereAndBackWithPause(0.55), 1);
  assert.ok(thereAndBackWithPause(0.2) < 1 && thereAndBackWithPause(0.2) > 0);
});

test("rate functions clamp out-of-range input instead of extrapolating", () => {
  assert.equal(smooth(-5), 0);
  assert.equal(smooth(5), 1);
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(2), 1);
  assert.equal(lerp(10, 20, 0.5), 15);
});

test("reduced motion collapses any curve to its end state", () => {
  assert.equal(stepEnd(0), 0);
  assert.equal(stepEnd(0.01), 1);
  assert.equal(withReducedMotion(smooth, true)(0.3), 1, "reduced: jump to finished");
  assert.equal(withReducedMotion(smooth, false)(0.3), smooth(0.3), "normal: unchanged");
});

/* --------------------------------------------------------------- compose */

test("phase handles a zero-width window without producing NaN", () => {
  assert.equal(phase(0.5, 0.5, 0.5), 1);
  assert.equal(phase(0.4, 0.5, 0.5), 0);
  assert.ok(Number.isFinite(phase(0.5, 0.2, 0.8)));
});

test("every lagged element completes — nothing is left permanently invisible", () => {
  for (const n of [1, 2, 5, 12]) {
    for (const lagRatio of [0, 0.25, 0.5, 1]) {
      for (let i = 0; i < n; i++) {
        assert.ok(Math.abs(lagged(1, i, n, { lagRatio }) - 1) < 1e-9, `n=${n} lag=${lagRatio} i=${i} incomplete`);
        assert.equal(lagged(0, i, n, { lagRatio }), 0, `n=${n} lag=${lagRatio} i=${i} started early`);
      }
    }
  }
});

test("lagRatio means what Manim means by it", () => {
  const simultaneous = [0, 1, 2].map((i) => lagged(0.4, i, 3, { lagRatio: 0 }));
  assert.equal(new Set(simultaneous.map((v) => v.toFixed(9))).size, 1, "lagRatio 0 = all together");
  assert.equal(lagged(1 / 3, 1, 3, { lagRatio: 1 }), 0, "lagRatio 1 = strictly sequential");
  const staggered = [0, 1, 2].map((i) => lagged(0.5, i, 3, { lagRatio: 0.3 }));
  assert.ok(staggered[0] > staggered[1] && staggered[1] > staggered[2], "earlier elements lead");
});

test("lagged keeps a constant per-element pace as the group grows", () => {
  // The bug in the old stagger(): its slot was window/n, so adding items sped every item up.
  const three = laggedRange(0, 3, { lagRatio: 0.3 });
  const twelve = laggedRange(0, 12, { lagRatio: 0.3 });
  assert.ok(three.end - three.start > twelve.end - twelve.start, "a bigger group spreads over more of the timeline");
  assert.ok(twelve.end - twelve.start > 0.05, "but each element still gets a usable slice");
});

test("succession tiles the timeline exactly, with no gap or overlap", () => {
  for (const weights of [[1], [1, 1, 1], [0.35, 3, 1, 1], [5, 0.35]]) {
    const ranges = successionRanges(weights);
    assert.equal(ranges[0].start, 0);
    assert.ok(Math.abs(ranges[ranges.length - 1].end - 1) < 1e-9);
    for (let i = 1; i < ranges.length; i++) {
      assert.ok(Math.abs(ranges[i].start - ranges[i - 1].end) < 1e-12, "gap or overlap between steps");
    }
    const state = succession(1, weights);
    assert.ok(state.locals.every((v) => Math.abs(v - 1) < 1e-9), "all steps finish");
    assert.equal(state.index, weights.length - 1);
  }
});

test("succession survives degenerate weights rather than producing NaN", () => {
  for (const r of successionRanges([0, 0, 0])) {
    assert.ok(Number.isFinite(r.start) && Number.isFinite(r.end));
  }
  for (const r of successionRanges([-4, 2])) {
    assert.ok(Number.isFinite(r.start) && Number.isFinite(r.end));
  }
});

test("group runs everything on one shared alpha", () => {
  assert.equal(group(0), 0);
  assert.equal(group(1), 1);
  assert.equal(group(0.5), smooth(0.5));
});

/* -------------------------------------------------------------- arrange */

test("every arrangement stays on the board at any group size", () => {
  const layouts: Record<string, (n: number) => { x: number; y: number }[]> = {
    row: (n) => arrangeRow(n),
    column: (n) => arrangeColumn(n),
    radial: (n) => arrangeRadial(n),
    grid: (n) => arrangeGrid(n),
    flow: (n) => arrangeFlow(n),
  };
  for (const [name, fn] of Object.entries(layouts)) {
    for (const n of [0, 1, 2, 3, 7, 20, 60]) {
      const pts = fn(n);
      assert.equal(pts.length, n, `${name}(${n}) wrong count`);
      for (const p of pts) {
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${name}(${n}) non-finite`);
        assert.ok(inSafe(p), `${name}(${n}) escaped the board: ${JSON.stringify(p)}`);
      }
    }
  }
});

test("an over-long row compresses instead of running off the board", () => {
  const pts = arrangeRow(30, { buff: 20 });
  assert.ok(pts.every(inSafe));
  assert.ok(pts[0].x < pts[29].x, "left-to-right order preserved");
});

test("radial puts item 0 at twelve o'clock and runs clockwise", () => {
  const ring = arrangeRadial(4, { center: { x: 50, y: 50 }, radius: 30 });
  assert.ok(Math.abs(ring[0].x - 50) < 1e-9, "item 0 centred horizontally");
  assert.ok(ring[0].y < 50, "item 0 above centre");
  assert.ok(ring[1].x > 50, "item 1 to the right — clockwise");
  assert.ok(ring[2].y > 50, "item 2 below centre");
});

test("flow switches to a column once a row would stop fitting", () => {
  const short = arrangeFlow(3);
  const long = arrangeFlow(8);
  assert.ok(short[0].y === short[2].y, "few items share a row");
  assert.ok(long[0].x === long[7].x, "many items share a column");
});

/* --------------------------------------------------------------- nextTo */

test("nextTo clears the target's edge on every side", () => {
  const target: Bounds = { x: 50, y: 50, w: 10, h: 5 };
  const self = { w: 4, h: 2 };
  assert.ok(nextTo(target, "up", 4, self).y < target.y - target.h);
  assert.ok(nextTo(target, "down", 4, self).y > target.y + target.h);
  assert.ok(nextTo(target, "left", 4, self).x < target.x - target.w);
  assert.ok(nextTo(target, "right", 4, self).x > target.x + target.w);
  assert.equal(nextTo(target, "center").x, 50);
  assert.equal(nextTo(target, "center").y, 50);
});

test("nextTo clamps to the board even for a target in the corner", () => {
  for (const dir of DIRECTIONS) {
    assert.ok(inSafe(nextTo({ x: 91, y: 91, w: 8, h: 8 }, dir, 6, { w: 10, h: 3 })), `${dir} escaped`);
    assert.ok(inSafe(nextTo({ x: 9, y: 9, w: 8, h: 8 }, dir, 6, { w: 10, h: 3 })), `${dir} escaped`);
  }
});

test("isDirection rejects junk", () => {
  assert.ok(isDirection("up"));
  assert.ok(!isDirection("sideways"));
  assert.ok(!isDirection(undefined));
});

test("intersects respects the required clearance", () => {
  assert.ok(intersects({ x: 0, y: 0, w: 5, h: 5 }, { x: 4, y: 0, w: 5, h: 5 }));
  assert.ok(!intersects({ x: 0, y: 0, w: 5, h: 5 }, { x: 11, y: 0, w: 5, h: 5 }));
  assert.ok(intersects({ x: 0, y: 0, w: 5, h: 5 }, { x: 10.5, y: 0, w: 5, h: 5 }, 1));
});

test("nextToAvoiding places four labels around one target without overlap", () => {
  // This is the whole point of the exercise: the prompt used to ask the model to do this
  // arithmetic in its head, and the prompt itself called the resulting overlap "a very
  // common failure".
  const target: Bounds = { x: 50, y: 50, w: 8, h: 4 };
  const self = { w: 7, h: 2 };
  const occupied: Bounds[] = [];
  for (let i = 0; i < 4; i++) {
    const p = nextToAvoiding(target, occupied, "up", 4, self);
    const box: Bounds = { x: p.x, y: p.y, w: self.w, h: self.h };
    for (const other of occupied) {
      assert.ok(!intersects(box, other, 1.5), `label ${i} overlapped an earlier one`);
    }
    occupied.push(box);
  }
  assert.equal(new Set(occupied.map((b) => `${b.x.toFixed(2)},${b.y.toFixed(2)}`)).size, 4);
});

test("unionBounds spans both boxes", () => {
  const u = unionBounds({ x: 0, y: 0, w: 1, h: 1 }, { x: 10, y: 0, w: 1, h: 1 });
  assert.equal(u.x, 5);
  assert.equal(u.w, 6);
});

/* ------------------------------------------- sandbox runtime parity */

/** The sandbox runtime is plain source text, so evaluating it is the only way to test it. */
interface SandboxRuntime {
  clamp01: (t: number) => number;
  lerp: (a: number, b: number, t: number) => number;
  smooth: (t: number) => number;
  rushInto: (t: number) => number;
  rushFrom: (t: number) => number;
  thereAndBack: (t: number) => number;
  thereAndBackWithPause: (t: number) => number;
  phase: (progress: number, start: number, end: number) => number;
  lagged: (progress: number, i: number, n: number, options?: { lagRatio?: number; delay?: number }) => number;
  successionRanges: (weights: number[]) => { start: number; end: number }[];
}

function loadSandboxRuntime(): SandboxRuntime {
  const names: (keyof SandboxRuntime)[] = [
    "clamp01", "lerp", "smooth", "rushInto", "rushFrom",
    "thereAndBack", "thereAndBackWithPause", "phase", "lagged", "successionRanges",
  ];
  return new Function(`${ANIM_SANDBOX_RUNTIME}\nreturn { ${names.join(", ")} };`)() as SandboxRuntime;
}

test("the injected sandbox runtime parses as valid ES5", () => {
  assert.doesNotThrow(() => loadSandboxRuntime());
});

test("sandbox runtime matches the TypeScript helpers at every sampled point", () => {
  // Hand-synced copy (the iframe has no module loader). Drift here would mean generated
  // animations ease differently from the host board, which is invisible until you compare them.
  const sb = loadSandboxRuntime();
  const unary = { smooth, rushInto, rushFrom, thereAndBack, thereAndBackWithPause, clamp01 };
  for (const [name, fn] of Object.entries(unary) as [keyof typeof unary, (t: number) => number][]) {
    for (const t of SAMPLES) {
      assert.ok(Math.abs(fn(t) - sb[name](t)) < 1e-9, `${name}(${t}): ts=${fn(t)} sandbox=${sb[name](t)}`);
    }
  }
  for (const t of SAMPLES) {
    for (const [s, e] of [[0, 1], [0.2, 0.7], [0.5, 0.5]]) {
      assert.ok(Math.abs(phase(t, s, e) - sb.phase(t, s, e)) < 1e-9, `phase(${t},${s},${e})`);
    }
  }
  for (const n of [1, 3, 8]) {
    for (let i = 0; i < n; i++) {
      for (const t of SAMPLES) {
        const opts = { lagRatio: 0.34, delay: 0.08 };
        assert.ok(Math.abs(lagged(t, i, n, opts) - sb.lagged(t, i, n, opts)) < 1e-9, `lagged(${t},${i},${n})`);
      }
    }
  }
  for (const w of [[1], [1, 2, 1], [0.35, 3, 1, 1]]) {
    assert.deepEqual(successionRanges(w), sb.successionRanges(w), `successionRanges(${w})`);
  }
});

/* ------------------------------------------------- LiveSketch rendering */

type AnyScript = Parameters<typeof LiveSketch>[0]["script"];
const render = (script: AnyScript, progress: number) =>
  renderToStaticMarkup(createElement(LiveSketch, { script, progress }));
const viewBox = (html: string) => {
  const m = html.match(/viewBox="([^"]+)"/);
  assert.ok(m, "no viewBox in output");
  return m![1].split(" ").map(Number);
};

test("a legacy script with literal coordinates still renders (regression floor)", () => {
  const html = render(
    {
      caption: "Test",
      durationMs: 10000,
      ops: [
        { kind: "label", text: "Photosynthesis", x: 50, y: 20, size: "lg", at: 0 },
        { kind: "shape", shape: "leaf", x: 30, y: 55, w: 20, h: 16, at: 0.2 },
        { kind: "arrow", x1: 42, y1: 55, x2: 62, y2: 55, at: 0.4 },
        { kind: "note", text: "Sunlight drives the reaction", x: 70, y: 55, at: 0.5 },
        { kind: "motion", motion: "flow", x1: 20, y1: 80, x2: 80, y2: 80, at: 0.6, endAt: 0.9 },
      ],
    } as AnyScript,
    1,
  );
  assert.ok(html.includes("Photosynthesis"));
  assert.ok(html.includes("Sunlight"));
  assert.deepEqual(viewBox(html), [0, 0, 1000, 560], "no focus op means the full board");
  assert.ok((html.match(/<path/g) ?? []).length > 3, "shapes and arrows drew paths");
});

test("anchorTo positions a label against its target instead of its literal coords", () => {
  const html = render(
    {
      durationMs: 10000,
      ops: [
        { kind: "shape", id: "leaf", shape: "leaf", x: 30, y: 60, w: 20, h: 16, at: 0 },
        { kind: "label", text: "Chloroplast", anchorTo: "leaf", anchorDir: "up", anchorBuff: 5, x: 99, y: 99, at: 0.2 },
      ],
    } as AnyScript,
    1,
  );
  const y = Number(html.match(/<text[^>]*\by="([\d.]+)"/)?.[1]);
  assert.ok(Number.isFinite(y), "label rendered with a y");
  assert.ok(y < 336, `label should sit above the target (y=336), got ${y}`);
  assert.ok(y > 0, "label stayed on the board");
});

test("an unresolvable anchorTo falls back to literal coords instead of throwing", () => {
  const html = render(
    { durationMs: 10000, ops: [{ kind: "label", text: "Orphan", anchorTo: "nope", x: 40, y: 40, at: 0.1 }] } as AnyScript,
    1,
  );
  assert.ok(html.includes("Orphan"));
});

test("emphasis marks appear at their peak and release afterwards", () => {
  for (const kind of ["indicate", "circumscribe", "flash"] as const) {
    const script = {
      durationMs: 10000,
      ops: [
        { kind: "label", id: "law", text: "F = ma", x: 50, y: 40, at: 0 },
        { kind, targetId: "law", x: 0, y: 0, at: 0.3, endAt: 0.5, color: "#ff0000" },
      ],
    } as AnyScript;
    assert.ok(!render(script, 0.2).includes("#ff0000"), `${kind} visible before its window`);
    assert.ok(render(script, 0.4).includes("#ff0000"), `${kind} missing at its peak`);
    assert.ok(!render(script, 0.8).includes("#ff0000"), `${kind} left permanent ink`);
  }
});

test("focus pushes the camera in and a targetless focus restores the full board", () => {
  const script = {
    durationMs: 10000,
    ops: [
      { kind: "shape", id: "cell", shape: "circle", x: 25, y: 30, w: 12, h: 12, at: 0 },
      { kind: "focus", targetId: "cell", scale: 0.5, at: 0.2, endAt: 0.35 },
      { kind: "focus", at: 0.7, endAt: 0.85 },
    ],
  } as AnyScript;

  assert.deepEqual(viewBox(render(script, 0.1)), [0, 0, 1000, 560], "starts wide");

  const zoomed = viewBox(render(script, 0.5));
  assert.ok(Math.abs(zoomed[2] - 500) < 1, `scale 0.5 should halve the width, got ${zoomed[2]}`);
  assert.ok(zoomed[0] <= 250 && 250 <= zoomed[0] + zoomed[2], "target x inside the frame");
  assert.ok(zoomed[1] <= 168 && 168 <= zoomed[1] + zoomed[3], "target y inside the frame");

  const mid = viewBox(render(script, 0.26));
  assert.ok(mid[2] < 1000 && mid[2] > 500, "camera interpolates rather than cutting");

  assert.deepEqual(viewBox(render(script, 0.95)), [0, 0, 1000, 560], "targetless focus restores");

  for (const [name, v] of [["zoomed", zoomed], ["mid", mid]] as const) {
    assert.ok(v[0] >= -1e-3 && v[1] >= -1e-3, `${name} frame left the board`);
    assert.ok(v[0] + v[2] <= 1000.001 && v[1] + v[3] <= 560.001, `${name} frame left the board`);
  }
});

test("arrows can follow named endpoints", () => {
  const html = render(
    {
      durationMs: 10000,
      ops: [
        { kind: "shape", id: "a", shape: "circle", x: 20, y: 30, w: 10, h: 10, at: 0 },
        { kind: "shape", id: "b", shape: "circle", x: 80, y: 70, w: 10, h: 10, at: 0.1 },
        { kind: "arrow", fromId: "a", toId: "b", x1: 0, y1: 0, x2: 0, y2: 0, at: 0.2 },
      ],
    } as AnyScript,
    1,
  );
  assert.ok(html.length > 0);
});

test("empty and degenerate scripts render rather than crashing", () => {
  assert.ok(render({ ops: [] } as AnyScript, 0.5).length > 0);
  assert.ok(render({ ops: [{ kind: "focus", at: 0.5 }] } as AnyScript, 0.8).length > 0);
});

/* ------------------------------------------------- Manim routing */

test("a real generated notes beat is NOT routed to Manim", () => {
  // This is the exact shape of every beat found in the render cache: a heading, two note
  // lines, and three vertical rule marks. Nothing moves, so Manim would spend seconds of CPU
  // and lose LiveSketch's word-by-word handwriting in exchange for nothing.
  const notesBeat = {
    surface: "paper",
    durationMs: 18000,
    ops: [
      { kind: "label", text: "Concurrency Recap", x: 50, y: 9, at: 0.03 },
      { kind: "label", text: "Concurrency overview", x: 17, y: 34, at: 0.16 },
      { kind: "shape", shape: "line", x: 12, y: 34, points: [{ x: 12, y: 29 }, { x: 12, y: 38 }], at: 0.19 },
      { kind: "note", text: "Key concepts and tools", x: 17, y: 51, at: 0.29 },
      { kind: "shape", shape: "line", x: 12, y: 51, points: [{ x: 12, y: 46 }, { x: 12, y: 55 }], at: 0.32 },
      { kind: "note", text: "recap our journey", x: 17, y: 68, at: 0.42 },
      { kind: "shape", shape: "line", x: 12, y: 68, points: [{ x: 12, y: 63 }, { x: 12, y: 72 }], at: 0.45 },
    ],
  };
  assert.equal(isManimWorthy(notesBeat), false, "three rule marks are not a diagram");
});

test("a beat with real geometry and motion IS routed to Manim", () => {
  const diagramBeat = {
    durationMs: 12000,
    ops: [
      { kind: "label", text: "Photosynthesis", x: 50, y: 12, at: 0.02 },
      { kind: "shape", shape: "circle", x: 30, y: 48, at: 0.14 },
      { kind: "arrow", x1: 44, y1: 48, x2: 62, y2: 48, at: 0.4 },
      { kind: "shape", shape: "rect", x: 74, y: 48, at: 0.5 },
      { kind: "circumscribe", targetId: "sugar", x: 0, y: 0, at: 0.7 },
      { kind: "motion", motion: "flow", x1: 20, y1: 82, x2: 80, y2: 82, at: 0.8, endAt: 0.92 },
    ],
  };
  assert.equal(isManimWorthy(diagramBeat), true);
});

test("each route-to-Manim trigger works on its own", () => {
  const withOps = (ops: object[]) => isManimWorthy({ ops });
  for (const kind of ["motion", "morph", "indicate", "circumscribe", "flash"]) {
    assert.equal(withOps([{ kind, x: 1, y: 1 }]), true, `${kind} alone should qualify`);
  }
  assert.equal(withOps([{ kind: "shape", shape: "circle" }, { kind: "shape", shape: "rect" }]), true, "two real shapes");
  assert.equal(withOps([{ kind: "shape", shape: "circle" }, { kind: "arrow" }]), true, "shape + arrow is a relationship");
  assert.equal(withOps([{ kind: "shape", shape: "circle" }]), false, "one lone shape is not a diagram");
  assert.equal(withOps([{ kind: "arrow" }]), false, "an arrow pointing at nothing is not a diagram");
});

test("rule marks never count as diagram geometry, however many there are", () => {
  const rules = Array.from({ length: 8 }, () => ({ kind: "shape", shape: "line" }));
  assert.equal(isManimWorthy({ ops: rules }), false, "eight rule marks are still page furniture");
  assert.equal(isManimWorthy({ ops: [...rules, { kind: "shape", shape: "chain" }] }), false, "chains too");
  // ...but mixed with genuine shapes the real ones still count.
  assert.equal(
    isManimWorthy({ ops: [...rules, { kind: "shape", shape: "circle" }, { kind: "shape", shape: "hexagon" }] }),
    true,
  );
});

test("beats owned by another renderer are never taken", () => {
  assert.equal(isManimWorthy({ ops: [{ kind: "reactAnimation" }, { kind: "motion" }] }), false);
  assert.equal(isManimWorthy({ ops: [{ kind: "chalkBoard" }, { kind: "motion" }] }), false);
});

test("a filled manimScene op routes to Manim; an unfilled one does not", () => {
  assert.equal(isManimWorthy({ ops: [{ kind: "manimScene", spec: { kind: "graph" } }] }), true);
  // No spec yet means the second generation call has not landed — rendering it would produce
  // an empty video, so the beat must stay on the live board until it has.
  assert.equal(isManimWorthy({ ops: [{ kind: "manimScene", sceneBrief: "a curve" }] }), false);
});

/* -------------------------------------------- unified animation routing */

test("generated React/SVG owns its board instead of leaking into another renderer", () => {
  assert.deepEqual(
    selectAnimationRenderer({ ops: [{ kind: "reactAnimation", code: "export default function Animation(){}" }] }, { manimEnabled: true }),
    { renderer: "react-svg", reason: "generated-react-svg" },
  );
});

test("a fully supported path morph uses live GSAP before Manim", () => {
  const morph = {
    ops: [
      { kind: "shape", shape: "circle", x: 20, y: 50, at: 0 },
      { kind: "morph", shape: "droplet", toShape: "leaf", x: 30, y: 50, toX: 70, toY: 50, at: 0.2, morphAt: 0.8 },
      { kind: "label", text: "state change", x: 50, y: 80, at: 0.85 },
    ],
  };
  assert.equal(isGsapWorthy(morph), true);
  assert.deepEqual(selectAnimationRenderer(morph, { gsapEnabled: true, manimEnabled: true }), {
    renderer: "gsap",
    reason: "scrubbable-svg-morph",
  });
});

test("GSAP never accepts a script containing an op or shape it would drop", () => {
  assert.equal(isGsapWorthy({ ops: [{ kind: "morph", shape: "sun", toShape: "leaf" }] }), false);
  assert.equal(
    isGsapWorthy({ ops: [{ kind: "morph", shape: "circle", toShape: "leaf" }, { kind: "image" }] }),
    false,
  );
});

test("explicit Manim specs beat heuristics, while notes remain live SVG", () => {
  assert.deepEqual(
    selectAnimationRenderer({ ops: [{ kind: "manimScene", spec: { kind: "graph" } }] }, { manimEnabled: true }),
    { renderer: "manim", reason: "explicit-manim-scene" },
  );
  assert.deepEqual(
    selectAnimationRenderer({ ops: [{ kind: "label", text: "Definition", at: 0 }] }, { manimEnabled: true }),
    { renderer: "live-svg", reason: "handwriting-or-unsupported" },
  );
});

test("turning GSAP off hands a morph to enabled Manim without losing the beat", () => {
  const morph = { ops: [{ kind: "morph", shape: "circle", toShape: "leaf", at: 0, morphAt: 1 }] };
  assert.deepEqual(selectAnimationRenderer(morph, { gsapEnabled: false, manimEnabled: true }), {
    renderer: "manim",
    reason: "diagram-or-motion",
  });
});

/* --------------------------------------------------------- seek coalescing */

test("an in-flight seek is never interrupted — it is recorded instead", () => {
  // This is the bug: assigning currentTime while seeking CANCELS the pending seek. At 60Hz
  // the seek never completed, nothing repainted, and the board sat on frame 0.
  const d = nextSeekTarget({ current: 0, target: 9, seeking: true });
  assert.equal(d.seekTo, null, "must not assign while seeking");
  assert.equal(d.pending, 9, "but must remember where to go");
});

test("when idle, the seek is issued", () => {
  const d = nextSeekTarget({ current: 0, target: 9, seeking: false });
  assert.equal(d.seekTo, 9);
  assert.equal(d.pending, null);
});

test("sub-frame moves are ignored — they cannot change the picture", () => {
  // 30fps => one frame is 33ms; half a frame is the threshold.
  assert.equal(nextSeekTarget({ current: 5, target: 5.005, seeking: false, fps: 30 }).seekTo, null);
  assert.equal(nextSeekTarget({ current: 5, target: 5.05, seeking: false, fps: 30 }).seekTo, 5.05);
  // A higher frame rate means a smaller move is worth making.
  assert.equal(nextSeekTarget({ current: 5, target: 5.005, seeking: false, fps: 120 }).seekTo, 5.005);
});

test("the latest target wins while seeking, so scrubbing converges", () => {
  let pending: number | null = null;
  for (const target of [2, 4, 6, 8]) {
    pending = nextSeekTarget({ current: 0, target, seeking: true }).pending;
  }
  assert.equal(pending, 8, "converges on the most recent progress, not the first");
  // ...and once the seek lands, the follow-up hop is issued.
  assert.equal(nextSeekTarget({ current: 2, target: pending!, seeking: false }).seekTo, 8);
});

test("seek decisions survive non-finite input", () => {
  for (const [current, target] of [[NaN, 5], [0, NaN], [Infinity, 5], [0, Infinity]]) {
    const d = nextSeekTarget({ current, target, seeking: false });
    assert.equal(d.seekTo, null);
    assert.equal(d.pending, null);
  }
});

/* ------------------------------------------------ manimScene spec validator */

/** The spec is an open record by design, so tests read fields through one narrow helper. */
function field<T>(spec: unknown, key: string): T {
  assert.ok(spec && typeof spec === "object", `expected a spec, got ${JSON.stringify(spec)}`);
  return (spec as Record<string, unknown>)[key] as T;
}

test("a well-formed spec of each kind survives validation", () => {
  const graph = validateManimSceneSpec({
    kind: "graph", title: "Growth", xMin: 0, xMax: 10, yMin: 0, yMax: 100,
    curves: [{ fn: "exponentialGrowth", a: 2, b: 0.3, label: "compound", color: "#14b8a6", trackPoint: true }],
  });
  assert.ok(graph, "graph rejected");
  assert.equal(graph!.kind, "graph");

  assert.ok(validateManimSceneSpec({ kind: "transform", stages: [{ shape: "square" }, { shape: "circle" }] }));
  assert.ok(validateManimSceneSpec({ kind: "flow", stages: ["in", "out"] }));
  assert.ok(validateManimSceneSpec({ kind: "geometry", mode: "angle", degrees: 60 }));
  assert.ok(validateManimSceneSpec({ kind: "geometry", mode: "vector", vectors: [{ dx: 2, dy: 1 }] }));
});

test("an expression string can never become a curve", () => {
  // The safety property that makes the whole template approach work: `fn` is matched against
  // a fixed family, so there is no path from model text to evaluated code.
  for (const fn of [
    "1000 * 1.08**x",
    "x => x * 2",
    "__import__('os').system('rm -rf /')",
    "eval('1+1')",
    "sin",          // close to valid but not in the family
    "",
    null,
  ]) {
    const spec = validateManimSceneSpec({
      kind: "graph", xMin: 0, xMax: 10, yMin: 0, yMax: 10, curves: [{ fn, a: 1 }],
    });
    assert.equal(spec, null, `"${fn}" should have produced no renderable spec`);
  }
});

test("degenerate graphs are rejected rather than rendered wrong", () => {
  const base = { kind: "graph", curves: [{ fn: "linear", a: 1 }] };
  assert.equal(validateManimSceneSpec({ ...base, xMin: 5, xMax: 5, yMin: 0, yMax: 10 }), null, "zero x range");
  assert.equal(validateManimSceneSpec({ ...base, xMin: 10, xMax: 0, yMin: 0, yMax: 10 }), null, "inverted x range");
  assert.equal(validateManimSceneSpec({ ...base, xMin: 0, xMax: 10, yMin: 10, yMax: 10 }), null, "zero y range");
  assert.equal(validateManimSceneSpec({ kind: "graph", xMin: 0, xMax: 10, yMin: 0, yMax: 10, curves: [] }), null, "no curves");
});

test("counts are capped and numbers clamped so a spec cannot blow up the renderer", () => {
  const graph = validateManimSceneSpec({
    kind: "graph", xMin: 0, xMax: 10, yMin: 0, yMax: 10,
    curves: Array.from({ length: 40 }, () => ({ fn: "linear", a: 1e30 })),
  });
  assert.equal(field<unknown[]>(graph, "curves").length, 2, "curves capped at 2");
  assert.ok(Math.abs(field<{ a: number }[]>(graph, "curves")[0].a) <= 1e6, "coefficient clamped");

  const flow = validateManimSceneSpec({ kind: "flow", stages: ["a", "b", "c", "d", "e", "f", "g"] });
  assert.equal(field<string[]>(flow, "stages").length, 4, "flow stages capped at 4");

  const angle = validateManimSceneSpec({ kind: "geometry", mode: "angle", degrees: 5000 });
  assert.ok(field<number>(angle, "degrees") <= 175, "angle clamped to something drawable");
});

test("a transformation needs at least two stages, and shapes must be known", () => {
  assert.equal(validateManimSceneSpec({ kind: "transform", stages: [{ shape: "circle" }] }), null, "one stage");
  assert.equal(validateManimSceneSpec({ kind: "transform", stages: [{ shape: "dodecahedron" }, { shape: "circle" }] }), null,
    "unknown shape drops the stage, leaving too few");
});

test("only real hex colours survive; anything else is dropped, not guessed", () => {
  const spec = validateManimSceneSpec({
    kind: "graph", xMin: 0, xMax: 10, yMin: 0, yMax: 10,
    curves: [{ fn: "linear", a: 1, color: "url(#x)" }, { fn: "sine", a: 1, color: "#14b8a6" }],
  });
  const curves = field<{ color?: string }[]>(spec, "curves");
  assert.equal(curves[0].color, undefined, "a non-hex colour is dropped");
  assert.equal(curves[1].color, "#14b8a6");
});

test("the validator rejects junk instead of throwing", () => {
  for (const junk of [null, undefined, {}, { kind: "nope" }, { kind: "" }, "graph", 7, []]) {
    assert.doesNotThrow(() => validateManimSceneSpec(junk));
    assert.equal(validateManimSceneSpec(junk), null);
  }
});

test("routing survives junk input instead of throwing", () => {
  for (const junk of [null, undefined, {}, { ops: null }, { ops: [] }, { ops: [null, undefined] }, "nope", 42]) {
    assert.doesNotThrow(() => isManimWorthy(junk), `threw on ${JSON.stringify(junk)}`);
    assert.equal(isManimWorthy(junk), false);
  }
});

/* ── TYPE F: structural diagrams ──────────────────────────────────────────────
 * These are the tests that could not be written for any other board type. Every other renderer
 * takes coordinates from the model, so "does anything overlap?" can only be answered by looking
 * at a rendered image. Here the geometry is computed, so overlap and out-of-frame are ordinary
 * assertions — which is the entire argument for this board existing.
 */

const ROCK_CYCLE = {
  kind: "cycle",
  title: "The Rock Cycle",
  nodes: [
    { id: "magma", label: "Magma" },
    { id: "igneous", label: "Igneous rock" },
    { id: "sediment", label: "Sediment" },
    { id: "sedimentary", label: "Sedimentary rock" },
    { id: "metamorphic", label: "Metamorphic rock" },
  ],
  edges: [
    { from: "magma", to: "igneous", label: "cools" },
    { from: "igneous", to: "sediment", label: "weathers" },
    { from: "sediment", to: "sedimentary", label: "compacts" },
    { from: "sedimentary", to: "metamorphic", label: "heat + pressure" },
    { from: "metamorphic", to: "magma", label: "melts" },
  ],
};

test("a structure spec survives validation with its nodes and edges intact", () => {
  const spec = validateStructureSpec(ROCK_CYCLE);
  assert.ok(spec);
  assert.equal(spec.nodes.length, 5);
  assert.equal(spec.edges.length, 5);
  assert.equal(spec.kind, "cycle");
});

test("junk is rejected rather than half-accepted", () => {
  for (const junk of [null, 42, {}, [], "cycle", { kind: "nope", nodes: [], edges: [] }]) {
    assert.equal(validateStructureSpec(junk), null);
  }
});

test("a spec that validates is always renderable: dangling edges are dropped, not kept", () => {
  const spec = validateStructureSpec({
    ...ROCK_CYCLE,
    edges: [...ROCK_CYCLE.edges, { from: "atlantis", to: "magma", label: "nowhere" }],
  });
  assert.ok(spec);
  assert.equal(spec.edges.length, 5, "the edge naming a node that does not exist must be gone");
  for (const e of spec.edges) {
    assert.ok(spec.nodes.some((n) => n.id === e.from), `edge from ${e.from} resolves`);
    assert.ok(spec.nodes.some((n) => n.id === e.to), `edge to ${e.to} resolves`);
  }
});

test("too few nodes, or nodes with no relationships, are not a structure", () => {
  assert.equal(validateStructureSpec({ kind: "flow", nodes: [{ id: "a", label: "A" }], edges: [] }), null);
  assert.equal(
    validateStructureSpec({ kind: "flow", nodes: ROCK_CYCLE.nodes, edges: [] }),
    null,
    "five boxes and no arrows is a list, not a diagram",
  );
});

test("computed layout never overlaps and never leaves the board", async () => {
  const specs = [
    ROCK_CYCLE,
    {
      kind: "state",
      nodes: [
        { id: "closed", label: "CLOSED" },
        { id: "syn", label: "SYN sent" },
        { id: "estab", label: "ESTABLISHED" },
      ],
      edges: [
        { from: "closed", to: "syn", label: "client SYN" },
        { from: "syn", to: "estab", label: "client ACK" },
      ],
    },
  ];

  for (const raw of specs) {
    const spec = validateStructureSpec(raw);
    assert.ok(spec);
    const layout = await layoutStructure(spec);
    assert.ok(layout, "layout must be produced");

    for (const n of layout.nodes) {
      assert.ok(n.x >= 0 && n.y >= 0, `${n.label} starts inside the board`);
      assert.ok(n.x + n.w <= BOARD_W, `${n.label} does not run off the right edge`);
      assert.ok(n.y + n.h <= BOARD_H, `${n.label} does not run off the bottom edge`);
    }

    for (let i = 0; i < layout.nodes.length; i++) {
      for (let j = i + 1; j < layout.nodes.length; j++) {
        const a = layout.nodes[i];
        const b = layout.nodes[j];
        const dx = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const dy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        assert.ok(dx <= 0 || dy <= 0, `${a.label} and ${b.label} must not overlap`);
      }
    }

    for (const e of layout.edges) {
      assert.ok(e.points.length >= 2, `the ${e.from}->${e.to} edge has a drawable route`);
    }
  }
});

test("a structureScene op with a spec wins the renderer selection", () => {
  const beat = { ops: [{ kind: "structureScene", spec: validateStructureSpec(ROCK_CYCLE), at: 0, endAt: 1 }] };
  assert.equal(selectAnimationRenderer(beat, { gsapEnabled: true, manimEnabled: true }).renderer, "structure");
  // Without a filled spec there is nothing to lay out, so it must NOT claim the beat.
  const unfilled = { ops: [{ kind: "structureScene", at: 0, endAt: 1 }] };
  assert.notEqual(selectAnimationRenderer(unfilled, { gsapEnabled: true, manimEnabled: true }).renderer, "structure");
});
