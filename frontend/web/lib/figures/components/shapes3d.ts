import type { FigureComponent, FigureParams, Pt } from "../types";
import { PALETTE, Sketch, add, bool, clamp, fmt, lerp, mul, optNum, perp, rad, str, sub, unit } from "./mathsKit";

/**
 * 3D SOLIDS, DRAWN BY CODE. The board names the solid and its dimensions; the code draws it in
 * oblique projection (cuboid, cube, triangular prism, square-based pyramid) or with the textbook
 * ellipse convention (cylinder, cone, sphere, hemisphere), works out which edges are hidden — faces
 * turned away from the viewer — and dashes them, labels each dimension on its own edge, computes the
 * derived ones (a cone's slant height √(r² + h²), a pyramid's slant height) and can unfold the net
 * to scale beside it.
 */

export const SOLIDS = ["cuboid", "cube", "triangular-prism", "square-pyramid", "cylinder", "cone", "sphere", "hemisphere"] as const;
export type Solid = (typeof SOLIDS)[number];
type V3 = { x: number; y: number; z: number };
type Dim = "length" | "width" | "height" | "radius" | "slant-height";

export function parseSolid(v: unknown): Solid {
  const s = String(v ?? "").toLowerCase();
  if (/hemi/.test(s)) return "hemisphere";
  if (/sphere|ball/.test(s)) return "sphere";
  if (/cone/.test(s)) return "cone";
  if (/cylind|tube|can\b/.test(s)) return "cylinder";
  if (/pyramid/.test(s)) return "square-pyramid";
  if (/tri|wedge|(?<!rect\w*\s)prism/.test(s)) return "triangular-prism";
  if (/cube(?!oid)/.test(s)) return "cube";
  return "cuboid";
}

/** A cone's slant height from r and h (or its height from r and l). */
export const coneSlant = (r: number, h: number) => Math.sqrt(r * r + h * h);
/** A square-based pyramid's slant height up the middle of the face on a `base`-long edge, the other base edge `across` long. */
export const pyramidSlant = (across: number, h: number) => Math.sqrt(h * h + (across / 2) ** 2);

/* ── oblique projection and hidden faces ───────────────────────────────────────────────────── */

const K = 0.5, ALPHA = rad(35);
const proj = (p: V3): Pt => ({ x: p.x + p.z * K * Math.cos(ALPHA), y: -(p.y + p.z * K * Math.sin(ALPHA)) });
const TOWARD_VIEWER: V3 = { x: K * Math.cos(ALPHA), y: K * Math.sin(ALPHA), z: -1 };
const sub3 = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross3 = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot3 = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const mean3 = (ps: V3[]): V3 => ({ x: ps.reduce((t, p) => t + p.x, 0) / ps.length, y: ps.reduce((t, p) => t + p.y, 0) / ps.length, z: ps.reduce((t, p) => t + p.z, 0) / ps.length });

/** Which faces of a convex polyhedron face the viewer, and so which edges are hidden (both faces away). */
export function visibility(verts: V3[], faces: number[][]) {
  const c = mean3(verts);
  const faceVisible = faces.map((f) => {
    let n = cross3(sub3(verts[f[1]], verts[f[0]]), sub3(verts[f[2]], verts[f[0]]));
    if (dot3(n, sub3(mean3(f.map((i) => verts[i])), c)) < 0) n = { x: -n.x, y: -n.y, z: -n.z };
    return dot3(n, TOWARD_VIEWER) > 1e-9;
  });
  const edges = new Map<string, { a: number; b: number; visible: boolean }>();
  faces.forEach((f, fi) => f.forEach((a, i) => {
    const b = f[(i + 1) % f.length];
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    const e = edges.get(key) ?? { a: Math.min(a, b), b: Math.max(a, b), visible: false };
    e.visible ||= faceVisible[fi];
    edges.set(key, e);
  }));
  return { faceVisible, edges: [...edges.values()] };
}

const PARTS = [
  { id: "length", name: "Length" },
  { id: "width", name: "Width" },
  { id: "height", name: "Height" },
  { id: "radius", name: "Radius" },
  { id: "slant-height", name: "Slant height" },
  { id: "face", name: "Face" },
  { id: "hidden-edge", name: "Hidden edge (dashed)" },
  { id: "apex", name: "Apex" },
  { id: "net", name: "Net" },
];

const DEFAULTS: Record<Solid, Partial<Record<Dim, number>>> = {
  cuboid: { length: 8, width: 5, height: 4 },
  cube: { length: 5, width: 5, height: 5 },
  "triangular-prism": { length: 10, width: 6, height: 4 },
  "square-pyramid": { length: 6, width: 6, height: 7 },
  cylinder: { radius: 3, height: 8 },
  cone: { radius: 3, height: 7 },
  sphere: { radius: 5 },
  hemisphere: { radius: 5 },
};
const LETTER: Record<Dim, string> = { length: "l", width: "w", height: "h", radius: "r", "slant-height": "l" };

export const shapes3d: FigureComponent = {
  name: "shapes3d",
  title: "A 3D solid drawn by code — cuboid, cube, triangular prism, square-based pyramid (oblique view), cylinder, cone, sphere or hemisphere — with hidden edges dashed, each dimension labelled on its edge, derived slant heights computed, and optionally its net to scale",
  params: `solid ("cuboid" default | "cube" | "triangular-prism" | "square-pyramid" | "cylinder" | "cone" | "sphere" | "hemisphere"); length, width, height (cuboid: length along the front, width the depth, height up; prism: width and height are the triangle's base and height, length the prism's length; pyramid: base length × width and perpendicular height); side (a cube's edge); radius (or diameter); slant (a cone's or pyramid's slant height — given with the radius/base and no height, the code computes the height; otherwise the code computes the slant); triangle ("isosceles" default | "right": the prism's cross-section); units (e.g. "cm"); show ("values" default | "letters": l, w, h, r | "none"); unknown (a dimension written as x instead of its value, e.g. "height" or "slant=l"); hidden (true default: hidden edges dashed; false hides them); view ("solid" default | "net" | "both": the net unfolded to scale beside the solid; sphere/hemisphere have no net).`,
  match: /^(?![\s\S]*\b(brain|cerebral|left|right|northern|southern|eastern|western) hemispheres?\b)[\s\S]*(\b3[- ]?d (shapes?|solids?)\b|\bcuboids?\b|\b(square|rectangular)[- ]based pyramids?\b|\btriangular prisms?\b|\bslant height\b|\bnets? of (a |the )?(cubes?|cuboids?|prisms?|pyramids?|cylinders?|cones?|3d shapes?|solids?)\b|\b(volume|surface area|faces,? edges|edges and vertices) of (a |an |the )?(right )?(cubes?|cuboids?|prisms?|pyramids?|cylinders?|cones?|spheres?|hemispheres?)\b|\bhemispheres?\b(?! of the (brain|earth|cerebrum))|\b(cylinder|cone|sphere|pyramid|prism)s?\b[^.]{0,40}\b(volume|surface area|cross[- ]section)\b)/i,
  parts: PARTS,
  build(params: FigureParams) {
    const solid = parseSolid(params.solid ?? params.shape);
    const units = str(params.units, "", 6);
    const showMode = /letter|symbol/i.test(String(params.show ?? "")) ? "letters" : /none|hide|off/i.test(String(params.show ?? "")) ? "none" : "values";
    const showHidden = bool(params.hidden, true);
    const viewRaw = String(params.view ?? (bool(params.net, false) ? "both" : "")).toLowerCase();
    const view = /both|and|with/.test(viewRaw) ? "both" : /net/.test(viewRaw) ? "net" : "solid";
    const D = DEFAULTS[solid];
    const pos = (v: unknown) => {
      const n = optNum(v);
      return n !== undefined && n > 0 ? clamp(n, 0.01, 1e4) : undefined;
    };
    const given: Partial<Record<Dim, number>> = {
      length: pos(params.length) ?? pos(params.side) ?? pos(params.base),
      width: pos(params.width) ?? pos(params.depth) ?? pos(params.side),
      height: pos(params.height),
      radius: pos(params.radius) ?? (pos(params.diameter) !== undefined ? pos(params.diameter)! / 2 : undefined),
      "slant-height": pos(params.slant ?? params.slantHeight),
    };
    if (solid === "cube") {
      const side = given.length ?? given.width ?? given.height ?? D.length!;
      given.length = given.width = given.height = side;
    }
    const dim = { ...D } as Record<Dim, number>;
    for (const k of Object.keys(given) as Dim[]) if (given[k] !== undefined) dim[k] = given[k]!;
    // Derived values: a slant height from the height, or the height from a slant height.
    if (solid === "cone") {
      if (given["slant-height"] !== undefined && given.height === undefined && given["slant-height"]! > dim.radius) dim.height = Math.sqrt(given["slant-height"]! ** 2 - dim.radius ** 2);
      dim["slant-height"] = coneSlant(dim.radius, dim.height);
    }
    if (solid === "square-pyramid") {
      if (given["slant-height"] !== undefined && given.height === undefined && given["slant-height"]! > dim.width / 2) dim.height = Math.sqrt(given["slant-height"]! ** 2 - (dim.width / 2) ** 2);
      dim["slant-height"] = pyramidSlant(dim.width, dim.height);
    }
    // Unknowns: "height", "slant=l", "r".
    const unknown = new Map<Dim, string>();
    for (const item of String(params.unknown ?? "").split(/[,;]/)) {
      const [k, sym] = item.split(/\s*[=:]\s*/).map((s) => s.trim().toLowerCase());
      const key: Dim | undefined = /slant/.test(k) ? "slant-height" : /^(l|len|length)/.test(k) ? "length" : /^(w|width|depth)/.test(k) ? "width" : /^(h|height)/.test(k) ? "height" : /^(r|rad|radius|d|diam)/.test(k) ? "radius" : undefined;
      if (key) unknown.set(key, (sym || (unknown.size ? "y" : "x")).slice(0, 3));
    }
    const label = (d: Dim) => unknown.get(d) ?? (showMode === "letters" ? LETTER[d] : showMode === "none" ? "" : `${fmt(dim[d], 2)}${units ? ` ${units}` : ""}`);
    const ink = (d: Dim) => (unknown.has(d) ? PALETTE.red : PALETTE.blue);

    // The solid (and the net) each fit this box; side by side they share the board.
    const BOX = view === "both" ? { w: 290, h: 250 } : { w: 380, h: 290 };
    const sk = new Sketch();
    const anchors: Partial<Record<string, Pt>> = {};
    const names: Partial<Record<string, string>> = {};
    const dimName = (d: Dim, title: string) => `${title} ${unknown.get(d) ?? `${fmt(dim[d], 2)}${units ? ` ${units}` : ""}`}`;

    // Drawn proportions: no dimension thinner than a sixth of the largest, so a 1 × 50 box still reads.
    const drawn = (d: Dim, ref: Dim[]) => Math.max(dim[d], Math.max(...ref.map((r) => dim[r])) / 6);

    /** A dimension written beside an edge, outward from the solid's middle. */
    const edgeLabel = (p: Pt, q: Pt, mid: Pt, d: Dim) => {
      const text = label(d);
      if (!text) return;
      const m = lerp(p, q, 0.5);
      let n = perp(unit(sub(q, p)));
      if ((m.x - mid.x) * n.x + (m.y - mid.y) * n.y < 0) n = mul(n, -1);
      const spot = sk.findText(text, 20, m, n, { min: 5, max: 60, slide: unit(sub(q, p)) });
      sk.text(spot.c, text, 20, ink(d), d);
    };

    const drawSolid = () => {
      if (solid === "cuboid" || solid === "cube" || solid === "triangular-prism" || solid === "square-pyramid") {
        let verts: V3[], faces: number[][], front: number[];
        const L = drawn("length", ["length", "width", "height"]), W = drawn("width", ["length", "width", "height"]), H = drawn("height", ["length", "width", "height"]);
        let dims: Array<{ a: number; b: number; d: Dim }>;
        let apex: number | undefined;
        if (solid === "triangular-prism") {
          // Cross-section in the front face (base = width, height up); the prism runs back by its length.
          const right = /right/i.test(String(params.triangle ?? params.crossSection ?? ""));
          const ax = right ? 0 : W / 2;
          const tri: Array<[number, number]> = [[0, 0], [W, 0], [ax, H]];
          verts = [...tri.map(([x, y]) => ({ x, y, z: 0 })), ...tri.map(([x, y]) => ({ x, y, z: L }))];
          faces = [[0, 1, 2], [3, 4, 5], [0, 1, 4, 3], [1, 2, 5, 4], [2, 0, 3, 5]];
          front = [0, 1, 2];
          dims = [{ a: 0, b: 1, d: "width" }, { a: 1, b: 4, d: "length" }];
          if (right) dims.push({ a: 0, b: 2, d: "height" });
        } else if (solid === "square-pyramid") {
          verts = [{ x: 0, y: 0, z: 0 }, { x: L, y: 0, z: 0 }, { x: L, y: 0, z: W }, { x: 0, y: 0, z: W }, { x: L / 2, y: H, z: W / 2 }];
          faces = [[0, 1, 2, 3], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]];
          front = [0, 1, 4];
          dims = [{ a: 0, b: 1, d: "length" }, { a: 1, b: 2, d: "width" }];
          apex = 4;
        } else {
          verts = [];
          for (const z of [0, W]) for (const [x, y] of [[0, 0], [L, 0], [L, H], [0, H]]) verts.push({ x, y, z });
          faces = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
          front = [0, 1, 2, 3];
          dims = [{ a: 0, b: 1, d: "length" }, { a: 1, b: 5, d: "width" }, { a: 0, b: 3, d: "height" }];
        }
        const ext = verts.map(proj);
        const w = Math.max(...ext.map((p) => p.x)) - Math.min(...ext.map((p) => p.x)), h = Math.max(...ext.map((p) => p.y)) - Math.min(...ext.map((p) => p.y));
        const s = Math.min(BOX.w / w, BOX.h / h);
        const P = verts.map((v) => mul(proj(v), s));
        const { faceVisible, edges } = visibility(verts, faces);
        // Visible faces tinted (the front a little darker), then hidden edges, then visible ones.
        faces.forEach((f, i) => {
          if (!faceVisible[i]) return;
          const isFront = f.length === front.length && f.every((x, j) => x === front[j]);
          sk.polygon(f.map((k) => P[k]), { fill: PALETTE.blue, opacity: isFront ? 0.13 : 0.07, stroke: "none", ...(isFront ? { part: "face" } : {}) }, false);
        });
        const hidden = edges.filter((e) => !e.visible);
        if (showHidden) for (const e of hidden) sk.line([P[e.a], P[e.b]], { stroke: "ink", width: 1.8, dash: "7 6", opacity: 0.75, part: "hidden-edge" });
        const dimOf = (e: { a: number; b: number }) => dims.find((x) => (x.a === e.a && x.b === e.b) || (x.a === e.b && x.b === e.a))?.d;
        for (const e of edges.filter((x) => x.visible)) {
          const d = dimOf(e);
          sk.line([P[e.a], P[e.b]], { stroke: "ink", width: 2.6, ...(d ? { part: d } : {}) });
        }
        const mid = mul(P.reduce((t, p) => add(t, p), { x: 0, y: 0 }), 1 / P.length);
        // A pyramid's height runs, dashed, from the apex to the centre of the base (with its right angle);
        // its slant height runs up the middle of the front face.
        if (solid === "square-pyramid") {
          const foot = mul(proj({ x: L / 2, y: 0, z: W / 2 }), s), top = P[4];
          sk.line([top, foot], { stroke: PALETTE.blue, width: 1.8, dash: "6 5", part: "height" });
          const e1 = sub(mul(proj({ x: L / 2 + 0.07 * Math.min(L, W), y: 0, z: W / 2 }), s), foot);
          const e2 = mul(unit(sub(top, foot)), Math.hypot(e1.x, e1.y) * 1.3);
          sk.line([add(foot, e1), add(add(foot, e1), e2), add(foot, e2)], { stroke: PALETTE.blue, width: 1.5, part: "height" }, false);
          const fm = mul(proj({ x: L / 2, y: 0, z: 0 }), s);
          sk.line([top, fm], { stroke: PALETTE.green, width: 1.8, part: "slant-height" });
          anchors.height = lerp(top, foot, 0.55);
          anchors["slant-height"] = lerp(top, fm, 0.6);
          names.height = dimName("height", "Perpendicular height");
          names["slant-height"] = dimName("slant-height", "Slant height");
        }
        if (solid === "triangular-prism" && !/right/i.test(String(params.triangle ?? params.crossSection ?? ""))) {
          const top = P[2], foot = lerp(P[0], P[1], 0.5);
          sk.line([top, foot], { stroke: PALETTE.blue, width: 1.8, dash: "6 5", part: "height" });
          const k = 10;
          sk.line([add(foot, { x: k, y: 0 }), add(foot, { x: k, y: -k }), add(foot, { x: 0, y: -k })], { stroke: PALETTE.blue, width: 1.5, part: "height" }, false);
          anchors.height = lerp(top, foot, 0.6);
        }
        for (const dd of dims) {
          edgeLabel(P[dd.a], P[dd.b], mid, dd.d);
          anchors[dd.d] = lerp(P[dd.a], P[dd.b], 0.3);
        }
        // The pyramid's and prism's internal heights are written beside their dashed lines.
        if (solid === "square-pyramid") {
          const foot = mul(proj({ x: L / 2, y: 0, z: W / 2 }), s);
          for (const [d, a, b] of [["height", P[4], foot], ["slant-height", P[4], mul(proj({ x: L / 2, y: 0, z: 0 }), s)]] as Array<[Dim, Pt, Pt]>) {
            const text = label(d);
            if (text) sk.placeText(text, 19, lerp(a, b, 0.45), d === "height" ? { x: 1, y: 0 } : { x: -1, y: 0 }, { min: 6, max: 90, fill: d === "height" ? ink(d) : unknown.has(d) ? PALETTE.red : PALETTE.green, part: d, slide: { x: 0, y: 1 } });
          }
        }
        if (solid === "triangular-prism" && anchors.height && !dims.some((x) => x.d === "height")) {
          const text = label("height");
          if (text) sk.placeText(text, 19, lerp(P[2], lerp(P[0], P[1], 0.5), 0.5), { x: -1, y: 0 }, { min: 6, max: 60, fill: ink("height"), part: "height", slide: { x: 0, y: 1 } });
        }
        names.length ??= dimName("length", solid === "triangular-prism" ? "Length" : solid === "square-pyramid" ? "Base length" : "Length");
        names.width ??= dimName("width", solid === "triangular-prism" ? "Base of triangle" : solid === "square-pyramid" ? "Base width" : "Width");
        names.height ??= dimName("height", solid === "triangular-prism" ? "Height of triangle" : "Height");
        anchors.face = mul(front.reduce((t, k) => add(t, P[k]), { x: 0, y: 0 }), 1 / front.length);
        names.face = solid === "triangular-prism" ? "Cross-section (triangle)" : solid === "square-pyramid" ? "Triangular face" : "Face";
        if (showHidden && hidden.length) {
          anchors["hidden-edge"] = lerp(P[hidden[0].a], P[hidden[0].b], 0.5);
          names["hidden-edge"] = "Hidden edge (dashed)";
        }
        if (apex !== undefined) {
          anchors.apex = P[apex];
          names.apex = "Apex";
        }
        if (solid === "cube") for (const d of ["length", "width", "height"] as Dim[]) names[d] = dimName(d, "Edge");
        return;
      }

      // Curved solids: base ellipses squashed to 0.32 of the radius (the usual textbook view).
      const R = dim.radius;
      const Hh = solid === "cylinder" || solid === "cone" ? Math.max(dim.height, dim.radius / 3) : 0;
      const sq = 0.32;
      const extentW = 2 * R, extentH = solid === "sphere" ? 2 * R : solid === "hemisphere" ? R + R * sq : Hh + 2 * R * sq;
      const s = Math.min((BOX.w * 0.84) / extentW, BOX.h / extentH);
      const a = R * s, b = R * s * sq, H = Hh * s;
      const ell = (c: Pt, t0: number, t1: number, n = 48): Pt[] => Array.from({ length: n + 1 }, (_, i) => {
        const t = t0 + ((t1 - t0) * i) / n;
        return { x: c.x + a * Math.cos(t), y: c.y + b * Math.sin(t) };
      });
      const O = { x: 0, y: 0 };
      const dashed = { stroke: "ink" as const, width: 1.8, dash: "7 6", opacity: 0.75, part: "hidden-edge" };
      if (solid === "cylinder") {
        const T = { x: 0, y: -H };
        sk.polygon([...ell(O, 0, Math.PI), ...ell(T, Math.PI, 0).map((p) => p)], { fill: PALETTE.blue, opacity: 0.08, stroke: "none", part: "face" }, false);
        sk.polygon(ell(T, 0, 2 * Math.PI, 72), { fill: PALETTE.blue, opacity: 0.12, stroke: "none" }, false);
        if (showHidden) sk.line(ell(O, Math.PI, 2 * Math.PI), dashed);
        sk.line(ell(O, 0, Math.PI), { stroke: "ink", width: 2.6 });
        sk.line(ell(T, 0, 2 * Math.PI, 72), { stroke: "ink", width: 2.6 });
        sk.line([{ x: a, y: 0 }, { x: a, y: -H }], { stroke: "ink", width: 2.6 });
        sk.line([{ x: -a, y: 0 }, { x: -a, y: -H }], { stroke: "ink", width: 2.6 });
        sk.line([T, { x: a, y: -H }], { stroke: PALETTE.blue, width: 2, part: "radius" });
        sk.circle(T, 3.5, { fill: "ink", stroke: "ink", width: 1, part: "radius" }, false);
        const rt = label("radius");
        if (rt) sk.placeText(rt, 20, { x: a / 2, y: -H }, { x: 0, y: -1 }, { min: 4, max: 50, fill: ink("radius"), part: "radius", slide: { x: 1, y: 0 } });
        // Beside a net the height goes on the left side, so its leader need not cross the net.
        const side = view === "both" ? -a : a;
        edgeLabel({ x: side, y: 0 }, { x: side, y: -H }, { x: 0, y: -H / 2 }, "height");
        anchors.radius = { x: a * 0.6, y: -H };
        anchors.height = { x: side, y: -H * 0.35 };
        anchors.face = { x: -side * 0.45, y: -H * 0.45 };
        names.face = "Curved surface";
        if (showHidden) (anchors["hidden-edge"] = { x: -a * 0.5, y: -b * Math.sin(Math.PI / 3) }), (names["hidden-edge"] = "Hidden edge (dashed)");
        names.radius = dimName("radius", "Radius");
        names.height = dimName("height", "Height");
      } else if (solid === "cone") {
        const A = { x: 0, y: -H };
        // The sides touch the base ellipse where they are tangent to it (exactly, from the apex).
        const yT = -(b * b) / H, xT = a * Math.sqrt(Math.max(0, 1 - (yT * yT) / (b * b)));
        const tR = Math.asin(clamp(yT / b, -1, 1)), tL = Math.PI - tR;
        sk.polygon([A, ...ell(O, tR, tL)], { fill: PALETTE.blue, opacity: 0.09, stroke: "none", part: "face" }, false);
        if (showHidden) sk.line(ell(O, tL, tR + 2 * Math.PI), dashed);
        sk.line(ell(O, tR, tL), { stroke: "ink", width: 2.6 });
        sk.line([A, { x: -xT, y: yT }], { stroke: "ink", width: 2.6 });
        sk.line([A, { x: xT, y: yT }], { stroke: "ink", width: 2.6, part: "slant-height" });
        sk.line([A, O], { stroke: PALETTE.blue, width: 1.8, dash: "6 5", part: "height" });
        sk.line([{ x: 10, y: 0 }, { x: 10, y: -10 }, { x: 0, y: -10 }], { stroke: PALETTE.blue, width: 1.5, part: "height" }, false);
        sk.line([O, { x: a, y: 0 }], { stroke: PALETTE.blue, width: 2, part: "radius" });
        sk.circle(O, 3.5, { fill: "ink", stroke: "ink", width: 1, part: "radius" }, false);
        const rt = label("radius");
        if (rt) sk.placeText(rt, 20, { x: a * 0.6, y: 0 }, { x: 0, y: 1 }, { min: 4, max: 50, fill: ink("radius"), part: "radius", slide: { x: 1, y: 0 } });
        const ht = label("height");
        if (ht) sk.placeText(ht, 20, { x: 0, y: -H * 0.45 }, { x: -1, y: 0 }, { min: 6, max: 80, fill: ink("height"), part: "height", slide: { x: 0, y: 1 } });
        edgeLabel(A, { x: xT, y: yT }, { x: 0, y: -H / 2 }, "slant-height");
        anchors.radius = { x: a * 0.75, y: 0 };
        anchors.height = { x: 0, y: -H * 0.7 };
        anchors["slant-height"] = lerp(A, { x: xT, y: yT }, 0.72);
        anchors.apex = A;
        anchors.face = { x: -a * 0.35, y: -H * 0.3 };
        names.face = "Curved surface";
        names.apex = "Apex (vertex)";
        if (showHidden) (anchors["hidden-edge"] = { x: -a * 0.5, y: -b * 0.87 }), (names["hidden-edge"] = "Hidden edge (dashed)");
        names.radius = dimName("radius", "Radius");
        names.height = dimName("height", "Perpendicular height");
        names["slant-height"] = dimName("slant-height", "Slant height");
      } else {
        // Sphere: outline, the equator (front solid, back dashed), a radius. Hemisphere: the flat face on top.
        const hemi = solid === "hemisphere";
        if (hemi) {
          const bowl = Array.from({ length: 49 }, (_, i) => ({ x: a * Math.cos((Math.PI * i) / 48), y: a * Math.sin((Math.PI * i) / 48) }));
          sk.polygon([...bowl, ...ell(O, Math.PI, 2 * Math.PI)], { fill: PALETTE.blue, opacity: 0.08, stroke: "none", part: "face" }, false);
          sk.polygon(ell(O, 0, 2 * Math.PI, 72), { fill: PALETTE.blue, opacity: 0.12, stroke: "none" }, false);
          sk.line(bowl, { stroke: "ink", width: 2.6 });
          sk.line(ell(O, 0, 2 * Math.PI, 72), { stroke: "ink", width: 2.6 });
        } else {
          sk.circle(O, a, { fill: PALETTE.blue, opacity: 0.08, stroke: "none", part: "face" }, false);
          sk.circle(O, a, { fill: "none", stroke: "ink", width: 2.6 });
          if (showHidden) sk.line(ell(O, Math.PI, 2 * Math.PI), dashed);
          sk.line(ell(O, 0, Math.PI), { stroke: "ink", width: 1.8, opacity: 0.85 });
        }
        sk.line([O, { x: a, y: 0 }], { stroke: PALETTE.blue, width: 2, part: "radius" });
        sk.circle(O, 3.5, { fill: "ink", stroke: "ink", width: 1, part: "radius" }, false);
        const rt = label("radius");
        if (rt) sk.placeText(rt, 20, { x: a * 0.5, y: 0 }, { x: 0, y: -1 }, { min: 4, max: 50, fill: ink("radius"), part: "radius", slide: { x: 1, y: 0 } });
        anchors.radius = { x: a * 0.75, y: 0 };
        anchors.face = hemi ? { x: -a * 0.3, y: a * 0.55 } : { x: -a * 0.35, y: -a * 0.5 };
        names.face = hemi ? "Curved surface" : "Surface";
        if (showHidden && !hemi) (anchors["hidden-edge"] = { x: -a * 0.5, y: -b * 0.87 }), (names["hidden-edge"] = "Equator (back, dashed)");
        names.radius = dimName("radius", "Radius");
      }
    };

    /** The net, to scale, starting at x0 (top aligned with y0). */
    const drawNet = (x0: number, y0: number) => {
      const face = (pts: Pt[], main = false) => sk.polygon(pts, { fill: PALETTE.green, opacity: main ? 0.16 : 0.09, stroke: "none", ...(main ? { part: "net" } : {}) }, false);
      const edge = (pts: Pt[], close = true) => (close ? sk.polygon(pts, { fill: "none", stroke: PALETTE.green, width: 2.2, part: "net" }) : sk.line(pts, { stroke: PALETTE.green, width: 2.2, part: "net" }));
      const fit = (w: number, h: number) => Math.min(BOX.w / w, (BOX.h + 30) / h);
      const rect = (x: number, y: number, w: number, h: number): Pt[] => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
      const T = (p: Pt, k: number): Pt => ({ x: x0 + p.x * k, y: y0 + p.y * k });
      if (solid === "cuboid" || solid === "cube") {
        const { length: L, width: W, height: H } = dim;
        const k = fit(2 * W + 2 * L, 2 * W + H);
        // A row of side, front, side, back, with the top and bottom on the front.
        const faces = [rect(0, W, W, H), rect(W, W, L, H), rect(W + L, W, W, H), rect(2 * W + L, W, L, H), rect(W, 0, L, W), rect(W, W + H, L, W)];
        faces.forEach((f, i) => face(f.map((p) => T(p, k)), i === 1));
        faces.forEach((f) => edge(f.map((p) => T(p, k))));
        anchors.net = T({ x: W + L / 2, y: W + H / 2 }, k);
      } else if (solid === "triangular-prism") {
        const right = /right/i.test(String(params.triangle ?? params.crossSection ?? ""));
        const bw = dim.width, h = dim.height, L = dim.length, ax = right ? 0 : bw / 2;
        const s1 = Math.hypot(ax, h), s2 = Math.hypot(bw - ax, h);
        const k = fit(s1 + bw + s2, L + 2 * h);
        const faces = [rect(0, h, s1, L), rect(s1, h, bw, L), rect(s1 + bw, h, s2, L)];
        const tris = [[{ x: s1, y: h }, { x: s1 + bw, y: h }, { x: s1 + ax, y: 0 }], [{ x: s1, y: h + L }, { x: s1 + bw, y: h + L }, { x: s1 + ax, y: 2 * h + L }]];
        [...faces, ...tris].forEach((f, i) => face(f.map((p) => T(p, k)), i === 1));
        [...faces, ...tris].forEach((f) => edge(f.map((p) => T(p, k))));
        anchors.net = T({ x: s1 + bw / 2, y: h + L / 2 }, k);
      } else if (solid === "square-pyramid") {
        const L = dim.length, W = dim.width, H = dim.height;
        const sL = pyramidSlant(W, H), sW = pyramidSlant(L, H);
        const k = fit(L + 2 * sW, W + 2 * sL);
        const sqr = rect(sW, sL, L, W);
        const tris = [
          [{ x: sW, y: sL }, { x: sW + L, y: sL }, { x: sW + L / 2, y: 0 }],
          [{ x: sW, y: sL + W }, { x: sW + L, y: sL + W }, { x: sW + L / 2, y: 2 * sL + W }],
          [{ x: sW, y: sL }, { x: sW, y: sL + W }, { x: 0, y: sL + W / 2 }],
          [{ x: sW + L, y: sL }, { x: sW + L, y: sL + W }, { x: 2 * sW + L, y: sL + W / 2 }],
        ];
        [sqr, ...tris].forEach((f, i) => face(f.map((p) => T(p, k)), i === 0));
        [sqr, ...tris].forEach((f) => edge(f.map((p) => T(p, k))));
        anchors.net = T({ x: sW + L / 2, y: sL + W / 2 }, k);
      } else if (solid === "cylinder") {
        const r = dim.radius, h = dim.height, C = 2 * Math.PI * r;
        const k = fit(C, h + 4 * r);
        const body = rect(0, 2 * r, C, h);
        face(body.map((p) => T(p, k)), true);
        edge(body.map((p) => T(p, k)));
        for (const cy of [r, 3 * r + h]) {
          const c = T({ x: C / 2, y: cy }, k);
          sk.circle(c, r * k, { fill: PALETTE.green, opacity: 0.09, stroke: "none" }, false);
          sk.circle(c, r * k, { fill: "none", stroke: PALETTE.green, width: 2.2, part: "net" });
        }
        if (showMode !== "none") {
          const text = showMode === "letters" ? "2πr" : `${fmt(C, 1)}${units ? ` ${units}` : ""}`;
          sk.placeText(text, 18, T({ x: C * 0.2, y: 2 * r + h }, k), { x: 0, y: 1 }, { min: 4, max: 40, fill: PALETTE.green, part: "net", slide: { x: 1, y: 0 } });
        }
        anchors.net = T({ x: C * 0.75, y: 2 * r + h / 2 }, k);
      } else if (solid === "cone") {
        const r = dim.radius, l = dim["slant-height"], theta = (2 * Math.PI * r) / l; // the sector's angle
        const half = Math.min(theta, 2 * Math.PI - 1e-3) / 2;
        const arcPts = Array.from({ length: 65 }, (_, i) => {
          const t = Math.PI / 2 - half + (2 * half * i) / 64;
          return { x: l * Math.cos(t), y: l * Math.sin(t) };
        });
        const pts = [{ x: 0, y: 0 }, ...arcPts];
        const xs = [...pts.map((p) => p.x), -r, r], ys = [...pts.map((p) => p.y), l + 2 * r];
        const minX = Math.min(...xs), minY = Math.min(...ys);
        const k = fit(Math.max(...xs) - minX, Math.max(...ys) - minY);
        const Tn = (p: Pt) => T({ x: p.x - minX, y: p.y - minY }, k);
        face(pts.map(Tn), true);
        edge(pts.map(Tn));
        const c = Tn({ x: 0, y: l + r });
        sk.circle(c, r * k, { fill: PALETTE.green, opacity: 0.09, stroke: "none" }, false);
        sk.circle(c, r * k, { fill: "none", stroke: PALETTE.green, width: 2.2, part: "net" });
        const apex = Tn({ x: 0, y: 0 });
        sk.placeText(`${fmt((theta * 180) / Math.PI, 1)}°`, 18, apex, { x: 0, y: 1 }, { min: 22, max: 90, fill: PALETTE.green, part: "net" });
        anchors.net = Tn({ x: l * 0.35 * Math.cos(Math.PI / 2 - half * 0.6), y: l * 0.75 });
      }
    };

    const hasNet = solid !== "sphere" && solid !== "hemisphere";
    if (view !== "net" || !hasNet) drawSolid();
    if (view !== "solid" && hasNet) {
      const b = sk.ops.length ? sk.bounds() : { x: 0, y: 0, w: 0, h: 0 };
      drawNet(sk.ops.length ? b.x + b.w + 60 : 0, sk.ops.length ? b.y + Math.max(0, (b.h - BOX.h - 30) / 2) : 0);
      names.net = `Net of the ${solid.replace("square-pyramid", "pyramid").replace("triangular-prism", "prism")}`;
    }
    for (const p of PARTS) {
      const a = anchors[p.id], n = names[p.id];
      if (a && n) sk.part(p.id, n.slice(0, 34), a);
    }
    return sk.finish(14);
  },
};
