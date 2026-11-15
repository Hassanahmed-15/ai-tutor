// The student's mark: how it is drawn, how much of the screen it means, and the two pictures Aria
// gets (a sharp close-up of the mark, and the whole screen with the mark drawn on it). Used by the
// desktop overlay (overlay.js); first built in screen-lab/public.
export const MIN_MARK_PX = 18; // a shorter drag is a click, not a mark

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
 * a point on the page to a pixel of the frame. Returns { crop, context, area } or null (nothing there).
 */
export function shotFrom(frame, toFrame, box, points) {
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
  // The mark on the close-up too, see-through, so Aria knows what was circled, underlined or crossed.
  const kc = crop.width / (x1 - x0);
  const g = crop.getContext("2d");
  g.globalAlpha = 0.55;
  drawStroke(
    g,
    points.map((p) => toFrame(p)).map(([x, y]) => [(x - x0) * kc, (y - y0) * kc]),
    Math.max(2, 3 * kc * perPoint),
  );
  drawStroke(
    context.getContext("2d"),
    points.map((p) => toFrame(p).map((v) => v * k)),
    Math.max(3, 4 * k * perPoint),
  );
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
