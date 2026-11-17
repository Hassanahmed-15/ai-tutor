// The student's mark: how it is drawn, how much of the screen it means, and the two pictures Aria
// gets (a sharp close-up of the mark, and the whole screen with the mark drawn on it). Used by the
// desktop overlay (overlay.js); first built in screen-lab/public.
export const MIN_MARK_PX = 18; // a shorter drag is a click: it marks what is under the pointer

export function bounds(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}

export function pathLength(points) {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return d;
}

/** Points round a box (a rounded rectangle), so a click or a snip is drawn and read as a box mark. */
export function boxPoints(box, pad = 6, r = 10) {
  const l = box.left - pad;
  const t = box.top - pad;
  const rt = box.right + pad;
  const b = box.bottom + pad;
  const k = Math.min(r, (rt - l) / 2, (b - t) / 2);
  const pts = [];
  const arc = (cx, cy, a0) => {
    for (let i = 0; i <= 6; i++) {
      const a = a0 + (i / 6) * (Math.PI / 2);
      pts.push([cx + k * Math.cos(a), cy + k * Math.sin(a)]);
    }
  };
  arc(rt - k, t + k, -Math.PI / 2);
  arc(rt - k, b - k, 0);
  arc(l + k, b - k, Math.PI / 2);
  arc(l + k, t + k, Math.PI);
  pts.push(pts[0]);
  return pts;
}

/**
 * A drag that is nearly a straight line from one corner to the other (not an underline) is a
 * snip: the box it spans. Returns that box, or null for a circle, a scribble or an underline.
 */
export function snipBox(points) {
  if (points.length < 2) return null;
  const [x0, y0] = points[0];
  const [x1, y1] = points[points.length - 1];
  const straight = Math.hypot(x1 - x0, y1 - y0);
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  if (straight < 40 || w < 24 || h < 24 || pathLength(points) > straight * 1.25) return null;
  return { left: Math.min(x0, x1), right: Math.max(x0, x1), top: Math.min(y0, y1), bottom: Math.max(y0, y1) };
}

/**
 * ONE CLICK = A MARK. Finds what is under the click on the frozen screen: the word, line, formula or
 * picture around that point, as a box in page pixels. Works on the screenshot only: pixels that
 * differ from the background near the click are "ink"; ink close together (a word gap, a few pixels
 * between a fraction and its bar) joins up, and the patch of joined ink under the click is the mark.
 * A paragraph's lines join (a click takes the paragraph), separate blocks stay apart. Null when the
 * click is on empty space.
 */
export function regionAt(frame, scale, x, y, W, H) {
  const CELL = 4; // page pixels per cell
  // The whole screen is searched (a wide paragraph is not cut); the box is capped afterwards.
  const ww = Math.round(W);
  const wh = Math.round(H);
  const left = 0;
  const top = 0;
  const c = document.createElement("canvas");
  c.width = ww;
  c.height = wh;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(frame, left * scale, top * scale, ww * scale, wh * scale, 0, 0, ww, wh);
  const px = g.getImageData(0, 0, ww, wh).data;
  // The background: the commonest colour in a patch round the click.
  const counts = new Map();
  const cx = Math.round(x - left);
  const cy = Math.round(y - top);
  for (let yy = Math.max(0, cy - 70); yy < Math.min(wh, cy + 70); yy += 2)
    for (let xx = Math.max(0, cx - 110); xx < Math.min(ww, cx + 110); xx += 2) {
      const i = (yy * ww + xx) * 4;
      const key = ((px[i] >> 4) << 8) | ((px[i + 1] >> 4) << 4) | (px[i + 2] >> 4);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  let bgKey = 0;
  let most = -1;
  for (const [k, n] of counts) if (n > most) [bgKey, most] = [k, n];
  const bg = [((bgKey >> 8) & 15) * 16 + 8, ((bgKey >> 4) & 15) * 16 + 8, (bgKey & 15) * 16 + 8];
  const gw = Math.ceil(ww / CELL);
  const gh = Math.ceil(wh / CELL);
  const ink = new Uint8Array(gw * gh);
  for (let yy = 0; yy < wh; yy++)
    for (let xx = 0; xx < ww; xx++) {
      const i = (yy * ww + xx) * 4;
      if (Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) > 90) ink[((yy / CELL) | 0) * gw + ((xx / CELL) | 0)] = 1;
    }
  // Join ink across small gaps: 3 cells (12 px) sideways, 1 cell (4 px) up and down.
  const joined = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      if (!ink[gy * gw + gx]) continue;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -3; dx <= 3; dx++) {
          const ny = gy + dy;
          const nx = gx + dx;
          if (ny >= 0 && ny < gh && nx >= 0 && nx < gw) joined[ny * gw + nx] = 1;
        }
    }
  // Start at the click, or the nearest ink within ~36 px of it.
  let start = -1;
  const sx = Math.min(gw - 1, (cx / CELL) | 0);
  const sy = Math.min(gh - 1, (cy / CELL) | 0);
  for (let r = 0; r <= 9 && start < 0; r++)
    for (let dy = -r; dy <= r && start < 0; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = sx + dx;
        const ny = sy + dy;
        if (nx >= 0 && nx < gw && ny >= 0 && ny < gh && joined[ny * gw + nx]) {
          start = ny * gw + nx;
          break;
        }
      }
  // Nothing near the click (empty space): no mark.
  if (start < 0) return null;
  const seen = new Uint8Array(gw * gh);
  const stack = [start];
  seen[start] = 1;
  let [l, r, t, b] = [gw, -1, gh, -1];
  while (stack.length) {
    const k = stack.pop();
    const gx = k % gw;
    const gy = (k / gw) | 0;
    if (ink[k]) {
      l = Math.min(l, gx);
      r = Math.max(r, gx);
      t = Math.min(t, gy);
      b = Math.max(b, gy);
    }
    for (const n of [k - 1, k + 1, k - gw, k + gw]) {
      if (n < 0 || n >= gw * gh || seen[n] || !joined[n]) continue;
      if ((n === k - 1 && gx === 0) || (n === k + 1 && gx === gw - 1)) continue;
      seen[n] = 1;
      stack.push(n);
    }
  }
  if (r < 0) return null;
  const box = { left: left + l * CELL, right: left + (r + 1) * CELL, top: top + t * CELL, bottom: top + (b + 1) * CELL };
  // A patch bigger than this (a busy app, a full-screen picture) is cut to the part round the click.
  const cap = (lo, hi, at, max) => {
    if (box[hi] - box[lo] <= max) return;
    const start = Math.max(box[lo], Math.min(box[hi] - max, at - max / 2));
    box[lo] = start;
    box[hi] = start + max;
  };
  cap("left", "right", x, 1100);
  cap("top", "bottom", y, 600);
  return box;
}

/** The marked box made big enough to hold what was marked: an underline gets the line above it. */
export function markedArea(box) {
  const out = { ...box };
  if (out.bottom - out.top < 30) out.top -= 34;
  const grow = (lo, hi, min) => {
    const extra = Math.max(0, min - (out[hi] - out[lo])) / 2;
    out[lo] -= extra;
    out[hi] += extra;
  };
  grow("left", "right", 140);
  grow("top", "bottom", 70);
  return out;
}

/** The yellow marker stroke. */
export function drawStroke(g, points, width = 4) {
  if (points.length < 2) return;
  g.save();
  g.strokeStyle = "#FFE45C";
  g.lineWidth = width;
  g.lineCap = g.lineJoin = "round";
  g.shadowColor = "rgba(255, 228, 92, 0.8)";
  g.shadowBlur = 8;
  g.beginPath();
  points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  g.restore();
}

/**
 * THE THREE TOOLS (owner, 2026-11-17): pencil (circle, underline, anything drawn), box (a rectangle
 * dragged corner to corner) and highlight (a see-through highlighter band over words). A mark is
 * { tool, points } (a pencil line, a box's outline or a highlighter stroke) or, for a clicked word
 * highlighted, { tool: "highlight", rect }. A student may make several before pressing Explain.
 */
export const HIGHLIGHT_W = 22; // the highlighter's width in page pixels
const HIGHLIGHT_INK = "rgba(255, 224, 64, 0.5)";

/** A pencil-made mark (the selftest, older callers) or a list of marks, always as a list. */
export function asMarks(marks) {
  if (!Array.isArray(marks) || !marks.length) return [];
  return typeof marks[0]?.[0] === "number" ? [{ tool: "pencil", points: marks }] : marks;
}

/** The box round one mark (a highlighter band counts its width). */
export function markBounds(m) {
  if (m.rect) return { ...m.rect };
  const b = bounds(m.points);
  if (m.tool !== "highlight") return b;
  const h = HIGHLIGHT_W / 2;
  return { left: b.left - h, right: b.right + h, top: b.top - h, bottom: b.bottom + h };
}

/** The box round every mark together. */
export function marksBounds(marks) {
  const all = asMarks(marks).map(markBounds);
  if (!all.length) return null;
  return {
    left: Math.min(...all.map((b) => b.left)),
    right: Math.max(...all.map((b) => b.right)),
    top: Math.min(...all.map((b) => b.top)),
    bottom: Math.max(...all.map((b) => b.bottom)),
  };
}

/** The box being dragged, as a rectangle (null while the drag is still too small to be one). */
export function dragRect(points) {
  if (points.length < 2) return null;
  const [x0, y0] = points[0];
  const [x1, y1] = points[points.length - 1];
  if (Math.abs(x1 - x0) < 8 && Math.abs(y1 - y0) < 8) return null;
  return { left: Math.min(x0, x1), right: Math.max(x0, x1), top: Math.min(y0, y1), bottom: Math.max(y0, y1) };
}

/** The live box while it is dragged: a dashed yellow rectangle. */
export function drawDragBox(g, rect) {
  if (!rect) return;
  g.save();
  g.strokeStyle = "#FFE45C";
  g.lineWidth = 3;
  g.setLineDash([9, 6]);
  g.shadowColor = "rgba(255, 228, 92, 0.6)";
  g.shadowBlur = 6;
  g.fillStyle = "rgba(255, 228, 92, 0.07)";
  g.beginPath();
  g.roundRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top, 6);
  g.fill();
  g.stroke();
  g.restore();
}

/**
 * Draws one mark. `map` takes a page point to a point on `g`, `k` is canvas pixels per page pixel,
 * `penW` the pencil's width in page pixels. The highlighter is see-through by itself, so it ignores
 * a faded pencil (the close-up draws the pencil at half strength) but follows `fade` (the mark fading).
 */
export function drawMarkOn(g, m, { map = (p) => p, k = 1, penW = 5, fade = 1 } = {}) {
  if (m.tool !== "highlight") {
    drawStroke(g, m.points.map(map), Math.max(2, penW * k));
    return;
  }
  g.save();
  g.globalAlpha = fade;
  g.fillStyle = g.strokeStyle = HIGHLIGHT_INK;
  if (m.rect) {
    const [x0, y0] = map([m.rect.left, m.rect.top]);
    const [x1, y1] = map([m.rect.right, m.rect.bottom]);
    g.beginPath();
    g.roundRect(x0, y0, x1 - x0, y1 - y0, 4 * k);
    g.fill();
  } else if (m.points.length > 1) {
    // One path stroked once, so where the band crosses itself it is not darker.
    g.lineWidth = HIGHLIGHT_W * k;
    g.lineCap = "butt";
    g.lineJoin = "round";
    g.beginPath();
    m.points.map(map).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
  }
  g.restore();
}

function cut(frame, x, y, w, h, maxSide) {
  const k = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(frame, x, y, w, h, 0, 0, c.width, c.height);
  return c;
}

/**
 * The pictures for one mark. `frame` is the screen at full detail (a canvas or image), `toFrame` maps
 * a point on the page to a pixel of the frame. `marks` is the list of marks (or one pencil line's
 * points); `box` is the box round them all. Returns { crop, context, area } or null (nothing there).
 */
export function shotFrom(frame, toFrame, box, marks) {
  const list = asMarks(marks);
  const width = frame.naturalWidth ?? frame.width;
  const height = frame.naturalHeight ?? frame.height;
  const area = markedArea(box);
  const pad = 22;
  let [x0, y0] = toFrame([area.left - pad, area.top - pad]);
  let [x1, y1] = toFrame([area.right + pad, area.bottom + pad]);
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  x1 = Math.min(width, x1);
  y1 = Math.min(height, y1);
  if (x1 - x0 < 8 || y1 - y0 < 8) return null;
  const crop = cut(frame, x0, y0, x1 - x0, y1 - y0, 1400);
  const context = cut(frame, 0, 0, width, height, 1280);
  const k = context.width / width;
  const perPoint = toFrame([1, 0])[0] - toFrame([0, 0])[0];
  // The marks on the close-up too, see-through, so Aria knows what was circled, boxed or highlighted.
  const kc = crop.width / (x1 - x0);
  const g = crop.getContext("2d");
  const gc = context.getContext("2d");
  for (const m of list) {
    g.save();
    g.globalAlpha = 0.55;
    drawMarkOn(g, m, { map: (p) => toFrame(p).map((v, i) => (v - (i ? y0 : x0)) * kc), k: kc * perPoint, penW: 3 });
    g.restore();
    drawMarkOn(gc, m, { map: (p) => toFrame(p).map((v) => v * k), k: Math.max(0.75, k * perPoint), penW: 4 });
  }
  return { crop: crop.toDataURL("image/jpeg", 0.9), context: context.toDataURL("image/jpeg", 0.72), area };
}

/** Plays a slide (looping) or a full video (once, with Aria's captions) in the big player. */
export function showVideo(el, url, vtt) {
  el.querySelectorAll("track").forEach((t) => t.remove());
  el.loop = !vtt;
  el.muted = false;
  if (vtt) {
    const track = document.createElement("track");
    track.kind = "captions";
    track.label = "Aria";
    track.srclang = "en";
    track.src = vtt;
    track.default = true;
    el.append(track);
  }
  el.src = url;
  el.play().catch(() => {});
}
