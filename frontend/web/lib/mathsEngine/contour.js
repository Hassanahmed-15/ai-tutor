// Marching squares: the boundary of a region (where a value is > 0), or the curve where a value is
// 0, found on a fine grid and joined into polylines. The crossing on each grid edge is placed by
// linear interpolation, so a circle or a curve comes out smooth to a fraction of a pixel.

// For each corner pattern (a = bottom-left, b = bottom-right, c = top-right, d = top-left inside),
// the cell edges each boundary piece joins: s(outh) a–b, e(ast) b–c, n(orth) d–c, w(est) a–d.
const CASES = {
  1: [["w", "s"]], 2: [["s", "e"]], 3: [["w", "e"]], 4: [["e", "n"]], 6: [["s", "n"]], 7: [["w", "n"]],
  8: [["w", "n"]], 9: [["s", "n"]], 11: [["e", "n"]], 12: [["w", "e"]], 13: [["s", "e"]], 14: [["w", "s"]],
};

/**
 * vals[j * nx + i] on an nx × ny grid. Returns polylines in grid coordinates ([i, j], fractional);
 * a closed loop repeats its first point at the end.
 */
export function marchingSquares(vals, nx, ny) {
  const at = (i, j) => vals[j * nx + i];
  const cross = (i0, j0, i1, j1) => {
    const a = at(i0, j0), b = at(i1, j1);
    const t = a === b ? 0.5 : a / (a - b);
    return [i0 + (i1 - i0) * t, j0 + (j1 - j0) * t];
  };
  const pts = new Map(); // edge key → point
  const links = new Map(); // edge key → [edge keys it joins]
  const link = (k1, k2) => {
    if (!links.has(k1)) links.set(k1, []);
    if (!links.has(k2)) links.set(k2, []);
    links.get(k1).push(k2);
    links.get(k2).push(k1);
  };
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = at(i, j) > 0, b = at(i + 1, j) > 0, c = at(i + 1, j + 1) > 0, d = at(i, j + 1) > 0;
      const code = (a ? 1 : 0) | (b ? 2 : 0) | (c ? 4 : 0) | (d ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const key = {
        s: `h${i},${j}`, e: `v${i + 1},${j}`, n: `h${i},${j + 1}`, w: `v${i},${j}`,
      };
      const point = {
        s: () => cross(i, j, i + 1, j), e: () => cross(i + 1, j, i + 1, j + 1),
        n: () => cross(i, j + 1, i + 1, j + 1), w: () => cross(i, j, i, j + 1),
      };
      let pairs = CASES[code];
      if (code === 5 || code === 10) {
        // A saddle: the centre decides whether the two inside corners are joined.
        const centre = (at(i, j) + at(i + 1, j) + at(i + 1, j + 1) + at(i, j + 1)) / 4 > 0;
        if (code === 5) pairs = centre ? [["s", "e"], ["w", "n"]] : [["w", "s"], ["e", "n"]];
        else pairs = centre ? [["w", "s"], ["e", "n"]] : [["s", "e"], ["w", "n"]];
      }
      for (const [e1, e2] of pairs) {
        if (!pts.has(key[e1])) pts.set(key[e1], point[e1]());
        if (!pts.has(key[e2])) pts.set(key[e2], point[e2]());
        link(key[e1], key[e2]);
      }
    }
  }
  // Walk the links into polylines: open ones (ends with one link) first, then closed loops.
  const used = new Set();
  const edgeId = (k1, k2) => (k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`);
  const walk = (start) => {
    const line = [pts.get(start)];
    let prev = null, cur = start;
    for (;;) {
      const next = (links.get(cur) ?? []).find((k) => k !== prev && !used.has(edgeId(cur, k))) ?? (links.get(cur) ?? []).find((k) => !used.has(edgeId(cur, k)));
      if (next === undefined) break;
      used.add(edgeId(cur, next));
      line.push(pts.get(next));
      prev = cur;
      cur = next;
      if (cur === start) break;
    }
    return line;
  };
  const out = [];
  for (const [k, ls] of links) if (ls.length === 1 && !ls.every((n) => used.has(edgeId(k, n)))) out.push(walk(k));
  for (const [k, ls] of links) if (ls.some((n) => !used.has(edgeId(k, n)))) out.push(walk(k));
  return out.filter((l) => l.length > 1);
}

/** Even-odd point-in-polygon. */
export function insidePolygon(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Signed distance to a polygon's outline: positive inside. */
export function polygonSdf(poly, x, y) {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i];
    const dx = bx - ax, dy = by - ay;
    const L = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return insidePolygon(poly, x, y) ? best : -best;
}
