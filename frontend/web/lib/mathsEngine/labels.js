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
function textBox(text, size) {
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
  const along = (a, b) => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / 5));
    for (let i = 0; i <= n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]);
  };
  for (const el of els) {
    if (!el || el.elType === "text") continue;
    // Faint lines (a grid) do not push labels away; a label can sit on squared paper.
    const stroked = (el.visProp.strokeopacity ?? 1) > 0.3 && (el.visProp.strokewidth ?? 1) > 0;
    if (!stroked) continue;
    if (el.elType === "point") {
      const c = el.coords.scrCoords;
      out.push([c[1], c[2]], [c[1] + 4, c[2]], [c[1] - 4, c[2]], [c[1], c[2] + 4], [c[1], c[2] - 4]);
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
function choose(board, lab, anchor, box, strokes, rects) {
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
    if (!best || score < best.score) best = { score, ox, oy, rect: r };
  });
  return best;
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
  // Labels are placed on the finished board too (an image's label goes where the image ends up).
  for (const lab of labels) {
    const box = textBox(lab.content(), lab.size);
    let best = null;
    // A label with several candidate anchors (along a curve) takes the clearest; earlier ones are preferred.
    const tries = lab.candidates ? lab.candidates.map((f, k) => [k, f()]) : [[0, lab.anchor()]];
    for (const [k, a] of tries) {
      if (!a.every(Number.isFinite)) continue;
      const pick = choose(board, lab, toScreen(board, a), box, strokes, rects);
      pick.score += k * 8;
      if (!best || pick.score < best.score) best = { ...pick, k };
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
  const best = choose(board, lab, toScreen(board, a), textBox(lab.content(), lab.size), strokes, rects);
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
