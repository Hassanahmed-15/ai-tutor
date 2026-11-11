// Label placement. Every label is laid out once, when the board loads, against the FINISHED board:
// every line, curve and point that any step will draw (including transformation images in their
// final place) and every label placed before it. So a label never lands where a line will be drawn
// later. After an animation, labels whose anchor moved are placed again against what is on screen.
// No label position is written by hand in a spec.

const PREF = {
  point: ["ne", "nw", "se", "sw", "n", "s", "e", "w"],
  segment: ["perp+", "perp-", "perp+2", "perp-2", "n", "s", "e", "w"],
  edge: ["perp+", "perp-", "perp+2", "perp-2", "nw", "sw", "w", "n", "s"],
  curve: ["e", "ne", "se", "nw", "n", "w", "s"],
  inside: ["c", "n", "s", "e", "w"],
};
const DIRS = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], ne: [0.75, -0.75], nw: [-0.75, -0.75], se: [0.75, 0.75], sw: [-0.75, 0.75], c: [0, 0] };
const GAP = 8;

let ctx2d = null;
export function textBox(text, size) {
  ctx2d ??= document.createElement("canvas").getContext("2d");
  ctx2d.font = `600 ${size}px "Aria Board", "Nunito", system-ui, sans-serif`;
  // Matches how the board draws text (its line box is taller than the font size).
  return { w: ctx2d.measureText(String(text)).width + 8, h: size * 1.4 };
}

const toScreen = (board, p) => [board.origin.scrCoords[1] + p[0] * board.unitX, board.origin.scrCoords[2] - p[1] * board.unitY];

/** Points along each element's geometry, in board pixels; works for hidden elements too. */
function geometrySamples(board, els) {
  const out = [];
  const W = board.canvasWidth, H = board.canvasHeight;
  let owner = null;
  const along = (a, b) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / 5));
    for (let i = 0; i <= n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, owner]);
  };
  for (const el of els) {
    owner = el;
    if (!el || el.elType === "text") continue;
    // Faint lines (a grid) do not push labels away; a label can sit on squared paper.
    const stroked = (el.visProp.strokeopacity ?? 1) > 0.3 && (el.visProp.strokewidth ?? 1) > 0;
    if (!stroked) continue;
    if (el.elType === "point") {
      const c = el.coords.scrCoords;
      out.push([c[1], c[2], el], [c[1] + 4, c[2], el], [c[1] - 4, c[2], el], [c[1], c[2] + 4, el], [c[1], c[2] - 4, el]);
    } else if (el.points?.length > 1) {
      for (let i = 1; i < el.points.length; i++) {
        const a = el.points[i - 1].scrCoords, b = el.points[i].scrCoords;
        if ([a[1], a[2], b[1], b[2]].every(Number.isFinite)) along([a[1], a[2]], [b[1], b[2]]);
      }
    } else if (el.point1 && el.point2) {
      const a = [el.point1.coords.scrCoords[1], el.point1.coords.scrCoords[2]];
      const b = [el.point2.coords.scrCoords[1], el.point2.coords.scrCoords[2]];
      if (el.elType === "line" && (el.visProp.straightfirst || el.visProp.straightlast)) {
        // An infinite line: sample it right across the board.
        const d = [b[0] - a[0], b[1] - a[1]];
        const n = Math.hypot(...d) || 1;
        const k = (W + H) * 2;
        const from = el.visProp.straightfirst ? [a[0] - (d[0] / n) * k, a[1] - (d[1] / n) * k] : a;
        const to = [a[0] + (d[0] / n) * k, a[1] + (d[1] / n) * k];
        along(from, to);
      } else along(a, b);
    }
  }
  return out.filter(([x, y]) => x > -10 && y > -10 && x < W + 10 && y < H + 10);
}

function overlapArea(a, b) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

function perpOf(board, lab) {
  if (!(lab.kind === "segment" || lab.kind === "edge") || !lab.obj?.line) return [0, -1];
  const [p, q] = lab.obj.line();
  const a = toScreen(board, p), b = toScreen(board, q);
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const n = Math.hypot(dx, dy) || 1;
  // The side that points up the screen first.
  let perp = [-dy / n, dx / n];
  if (perp[1] > 0) perp = [-perp[0], -perp[1]];
  return perp;
}

/** The best offset for one label, given obstacles (sample points and rectangles), in board pixels. */
function inScreenPolygon([x, y], P) {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) if (P[i][1] > y !== P[j][1] > y && x < ((P[j][0] - P[i][0]) * (y - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) inside = !inside;
  return inside;
}

function choose(board, scene, lab, anchor, box, strokes, rects) {
  const own = lab.obj?.id && scene.allElements ? new Set(safeElements(scene, lab.obj.id)) : null;
  const W = board.canvasWidth, H = board.canvasHeight;
  const perp = perpOf(board, lab);
  const pref0 = typeof lab.pref === "function" ? lab.pref() : lab.pref;
  const first = pref0 && pref0 !== "auto" ? [pref0, ...(PREF[lab.kind] ?? PREF.point)] : PREF[lab.kind] ?? PREF.point;
  // When every usual spot is crowded (a thin shape, a busy corner), try further out all round.
  const far = ["n", "s", "e", "w", "ne", "nw", "se", "sw"].map((d) => `${d}~`);
  const pref = [...first, ...far];
  let best = null;
  pref.forEach((name, rank) => {
    let dir;
    let extra = 0;
    if (name.startsWith("perp")) {
      dir = name.includes("-") ? [-perp[0], -perp[1]] : perp;
      if (name.endsWith("2")) extra = 16;
    } else if (name.endsWith("~")) {
      dir = DIRS[name.slice(0, -1)];
      extra = 22;
    } else dir = DIRS[name] ?? DIRS.ne;
    const nx = Math.hypot(dir[0], dir[1]) || 1;
    const ux = dir[0] / nx, uy = dir[1] / nx;
    const reach = name === "c" ? 0 : GAP + extra + Math.abs(ux) * (box.w / 2) + Math.abs(uy) * (box.h / 2);
    const ox = ux * reach, oy = uy * reach;
    const r = { left: anchor[0] + ox - box.w / 2, right: anchor[0] + ox + box.w / 2, top: anchor[1] + oy - box.h / 2, bottom: anchor[1] + oy + box.h / 2 };
    let score = rank * 0.6;
    // Texts keep a small gap between them, not just "not overlapping".
    const padded = { left: r.left - 3, right: r.right + 3, top: r.top - 2, bottom: r.bottom + 2 };
    for (const o of rects) score += overlapArea(padded, o) * 40;
    let hits = 0;
    for (const [x, y] of strokes) if (x > r.left - 2 && x < r.right + 2 && y > r.top - 2 && y < r.bottom + 2) hits++;
    score += hits * 6;
    if (r.left < 2 || r.right > W - 2 || r.top < 2 || r.bottom > H - 2) score += 5000;
    const mid = [(r.left + r.right) / 2, (r.top + r.bottom) / 2];
    // A SIDE'S LABEL IS NEARER ITS OWN SIDE THAN ANY OTHER (2026-11-11: "a" for the bottom side sat in the
    // triangle beside the vertical side, and read as that side's name).
    if (own && (lab.kind === "segment" || lab.kind === "edge")) {
      let mine = Infinity, other = Infinity;
      for (const [x, y, el] of strokes) {
        const d = Math.hypot(x - mid[0], y - mid[1]);
        if (own.has(el)) mine = Math.min(mine, d);
        else other = Math.min(other, d);
      }
      if (other + 6 < mine) score += 250;
      // Never written across its own side.
      if ([...strokes].some(([x, y, el]) => own.has(el) && x > r.left && x < r.right && y > r.top && y < r.bottom)) score += 150;
    }
    // A SHAPE'S NAME STAYS IN THE SHAPE ("Triangle 1" was pushed out of its triangle and named nothing).
    if (lab.kind === "inside" && lab.obj?.poly) {
      const P = lab.obj.poly().map((p) => toScreen(board, p));
      if (P.length > 2 && !inScreenPolygon(mid, P)) score += 220;
    }
    // A circle's name inside a different circle names the wrong one.
    if (lab.obj?.circle) {
      for (const o of scene.objs.values()) {
        if (o === lab.obj || !o.circle) continue;
        const q = o.circle(), mid = toScreen(board, q.c);
        if (Math.hypot((r.left + r.right) / 2 - mid[0], (r.top + r.bottom) / 2 - mid[1]) < q.r * board.unitX) score += 400;
      }
    }
    if (!best || score < best.score) best = { score, ox, oy, rect: r };
  });
  return best;
}

function safeElements(scene, id) {
  try { return scene.allElements(id); } catch { return []; }
}

/** Plain texts already on the board (axis numbers, readouts), as rectangles in board pixels. */
function fixedTextRects(board, els) {
  const out = [];
  for (const el of els) {
    // Only texts the scene made (not JSXGraph's own hover box).
    if (el?.elType !== "text" || el.__label || !el.__content) continue;
    const c = el.coords.scrCoords;
    const box = textBox(el.__content ? el.__content() : el.plaintext ?? "", el.__size ?? el.visProp.fontsize ?? 20);
    out.push({ left: c[1] - box.w / 2, right: c[1] + box.w / 2, top: c[2] - box.h / 2, bottom: c[2] + box.h / 2 });
  }
  return out;
}

/** Lay out every label of the lesson against the finished board, in the order they will appear. */
export function layoutAll(board, scene, finalEls, labels) {
  const saved = [...scene.transforms.values()].map((t) => [t, t.s]);
  for (const [t] of saved) t.s = 1;
  for (const lab of labels) lab.offset = [0, 0];
  board.update();
  const strokes = geometrySamples(board, finalEls.filter((el) => !el.__label));
  const rects = fixedTextRects(board, finalEls);
  // Labels are placed on the finished board too (an image's label goes where the image ends up). The labels of
  // sides, points and angles first: they belong at one place; a shape's name can go anywhere inside its shape.
  const ordered = [...labels.filter((l) => l.kind !== "inside"), ...labels.filter((l) => l.kind === "inside")];
  for (const lab of ordered) {
    let box = textBox(lab.content(), lab.size);
    let best = null;
    // A label with several candidate anchors (along a curve) takes the clearest; earlier ones are preferred.
    const tries = lab.candidates ? lab.candidates.map((f, k) => [k, f()]) : [[0, lab.anchor()]];
    for (const [k, a] of tries) {
      if (!a.every(Number.isFinite)) continue;
      const pick = choose(board, scene, lab, toScreen(board, a), box, strokes, rects);
      pick.score += k * 8;
      if (!best || pick.score < best.score) best = { ...pick, k };
    }
    // A shape's name that cannot sit inside its shape at full size is written smaller there, not outside it.
    if (best && lab.kind === "inside" && best.score >= 60 && lab.obj?.poly) {
      for (const k of [0.85, 0.72, 0.6]) {
        const small = textBox(lab.content(), lab.size * k);
        for (const [i, a] of tries) {
          if (!a.every(Number.isFinite)) continue;
          const pick = choose(board, scene, lab, toScreen(board, a), small, strokes, rects);
          pick.score += i * 8 + (1 - k) * 40;
          if (pick.score < best.score) best = { ...pick, k: i, shrink: k };
        }
        if (best.score < 60) break;
      }
      if (best.shrink) {
        const size = Math.round(lab.size * best.shrink);
        lab.size = size;
        lab.el.__size = size;
        lab.el.setAttribute({ fontSize: size });
        box = textBox(lab.content(), size);
      }
    }
    if (!best) continue;
    lab.pick = best.k;
    lab.offset = [best.ox, best.oy];
    lab.placed = true;
    rects.push(best.rect);
  }
  for (const [t, s] of saved) t.s = s;
  board.update();
}

/** Place one label again against what is on screen now (after its anchor moved). */
export function placeLabel(board, scene, lab) {
  const a = lab.anchor();
  if (!a.every(Number.isFinite)) return;
  const visible = board.objectsList.filter((el) => el.visPropCalc?.visible);
  const strokes = geometrySamples(board, visible.filter((el) => !el.__label));
  const rects = fixedTextRects(board, visible);
  for (const other of scene.labels) {
    if (other === lab || !other.el.visPropCalc?.visible) continue;
    const oa = toScreen(board, other.anchor());
    const box = textBox(other.content(), other.size);
    rects.push({ left: oa[0] + other.offset[0] - box.w / 2, right: oa[0] + other.offset[0] + box.w / 2, top: oa[1] + other.offset[1] - box.h / 2, bottom: oa[1] + other.offset[1] + box.h / 2 });
  }
  const best = choose(board, scene, lab, toScreen(board, a), textBox(lab.content(), lab.size), strokes, rects);
  lab.offset = [best.ox, best.oy];
  lab.placed = true;
  board.update();
}

/** After a board is finished: count pairs of texts that overlap (a check the lab reports). */
export function overlappingTexts(board) {
  const rects = board.objectsList
    .filter((t) => t.elType === "text" && t.visPropCalc?.visible)
    .map((t) => ({ t, r: t.rendNode?.getBoundingClientRect() }))
    .filter((x) => x.r && x.r.width);
  let n = 0;
  const pairs = [];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (overlapArea(rects[i].r, rects[j].r) > 4) { n++; pairs.push([rects[i].t.plaintext ?? "", rects[j].t.plaintext ?? ""]); }
  return { n, pairs };
}

/**
 * Writing the scene placed by hand may land on other writing, across a line or on a pie: each such piece
 * moves the shortest distance that clears it, staying on the board. (Labels were placed clear already.)
 * A piece that only touches a line moves a little at most: inside a Venn diagram, where it sits is its meaning.
 */
export function settleFreeText(board, scene, finalEls) {
  const W = board.canvasWidth, H = board.canvasHeight;
  const strokes = geometrySamples(board, finalEls.filter((el) => !el.__label));
  const rectOf = (el) => {
    const c = el.coords.scrCoords;
    const box = textBox(el.__content(), el.__size ?? 24);
    return { left: c[1] - box.w / 2, right: c[1] + box.w / 2, top: c[2] - box.h / 2, bottom: c[2] + box.h / 2 };
  };
  const others = new Map();
  for (const el of finalEls) if (el?.elType === "text" && el.__content && String(el.__content()).trim()) others.set(el, rectOf(el));
  for (const lab of scene.labels) if (!others.has(lab.el) && lab.placed && finalEls.includes(lab.el)) others.set(lab.el, rectOf(lab.el));
  const solid = [];
  for (const o of scene.objs.values()) {
    if (o.type !== "sector" && o.type !== "pie") continue;
    const P = o.poly?.();
    if (o.type === "sector" && P?.length > 2) solid.push(P.map((p) => toScreen(board, p)));
    if (o.type === "pie" && o.circle) { const { c, r } = o.circle(); solid.push(Array.from({ length: 48 }, (_, i) => toScreen(board, [c[0] + r * Math.cos((i * Math.PI) / 24), c[1] + r * Math.sin((i * Math.PI) / 24)]))); }
  }
  const inPoly = (x, y, P) => {
    let inside = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) if (P[i][1] > y !== P[j][1] > y && x < ((P[j][0] - P[i][0]) * (y - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) inside = !inside;
    return inside;
  };
  // Filled shapes (bars, shaded parts): writing already inside one may stay, writing outside must not move in.
  const fills = [];
  for (const el of finalEls) {
    if (el?.elType !== "curve" || !((el.visProp.fillopacity ?? 0) > 0.05) || !(el.points?.length > 2)) continue;
    const P = el.points.map((c) => [c.scrCoords[1], c.scrCoords[2]]).filter((p) => p.every(Number.isFinite));
    if (P.length > 2) fills.push(P);
  }
  // Every closed shape of the scene: writing placed inside one is about it, and stays inside it.
  const shapes = [];
  for (const o of scene.objs.values()) {
    if (o.type !== "polygon" && o.type !== "sector" && o.type !== "area") continue;
    try { const P = o.poly?.(); if (P?.length > 2) shapes.push(P.map((p) => toScreen(board, p))); } catch { /* not measurable */ }
  }
  const leaves = (el, r) => {
    const home = others.get(el), x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2, hx = (home.left + home.right) / 2, hy = (home.top + home.bottom) / 2;
    return shapes.some((P) => inPoly(hx, hy, P) && !inPoly(x, y, P));
  };
  const enters = (el, r) => {
    const home = others.get(el), x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2, hx = (home.left + home.right) / 2, hy = (home.top + home.bottom) / 2;
    return fills.some((P) => inPoly(x, y, P) && !inPoly(hx, hy, P));
  };
  const covers = (r) => [[r.left, r.top], [r.right, r.top], [r.left, r.bottom], [r.right, r.bottom], [(r.left + r.right) / 2, (r.top + r.bottom) / 2]].some(([x, y]) => solid.some((P) => inPoly(x, y, P)));
  const hits = (el, r) => {
    let writing = 0, line = false;
    for (const [other, o] of others) if (other !== el && overlapArea(r, o) > 0) writing++;
    for (const [x, y] of strokes) if (x > r.left && x < r.right && y > r.top && y < r.bottom) { line = true; break; }
    const cost = writing * 4 + (covers(r) ? 3 : 0) + (enters(el, r) ? 3 : 0) + (leaves(el, r) ? 3 : 0) + (line ? 1 : 0);
    return { cost, hard: writing > 0 || covers(r) };
  };
  let moved = false;
  for (const el of others.keys()) {
    if (!el.__free || !el.__nudge) continue;
    const r = others.get(el);
    const now = hits(el, r);
    if (!now.cost) continue;
    const step = (r.bottom - r.top) / 2;
    let best = null;
    for (let ring = 1; ring <= (now.hard ? 16 : 4) && !(best && best.cost === 0); ring++) {
      for (let k = 0; k < 16; k++) {
        const a = (k * Math.PI) / 8, ox = Math.cos(a) * step * ring, oy = Math.sin(a) * step * ring;
        const q = { left: r.left + ox, right: r.right + ox, top: r.top + oy, bottom: r.bottom + oy };
        if (q.left < 4 || q.right > W - 4 || q.top < 4 || q.bottom > H - 4) continue;
        const { cost } = hits(el, q);
        if (!best || cost < best.cost) best = { cost, ox, oy, q };
        if (cost === 0) break;
      }
    }
    if (best && best.cost < now.cost) {
      el.__nudge.x += best.ox / board.unitX;
      el.__nudge.y -= best.oy / board.unitY;
      others.set(el, best.q);
      moved = true;
    }
  }
  if (moved) board.update();
}
