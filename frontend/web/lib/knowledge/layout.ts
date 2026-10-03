/**
 * WHERE EACH STAR SITS on the knowledge map — pure and deterministic (the same map always looks the
 * same), unit-tested in lib/anim/knowledgeGraph.test.ts.
 *
 * Each SUBJECT is a sunflower: its concepts on a golden-angle spiral, which spaces any number of
 * points evenly with no clumps and no edges to pile against. The spiral is filled in link order
 * (a breadth-first walk from the best-connected concept), so linked concepts sit side by side.
 * Subjects are packed in rows, biggest first, and a short relaxation then pulls linked stars a
 * little closer and pushes any two that touch apart. Nothing is clamped to a frame: the page fits
 * its view to whatever the stars cover (`mapBounds`).
 *
 * (A plain force layout was used first. With a student's 200 mostly unlinked concepts the
 * repulsion threw them against the frame, where the clamp lined them up in rows along the edges.)
 */

export type MapNode = { key: string; subject: string; weight: number };
export type MapLink = { from: string; to: string; strength: number };
export type Placed = { x: number; y: number };

/** Distance between neighbouring stars on a spiral, in map units. */
export const STAR_SPACING = 110;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** How far apart a spiral's rings are, as a share of STAR_SPACING — room for labels between stars. */
const SPIRAL = 0.95;

/** The order to place one subject's concepts in: best-connected first, then outward along links. */
function linkOrder(keys: string[], links: MapLink[], weight: Record<string, number>): string[] {
  const neighbours = new Map<string, string[]>(keys.map((k) => [k, []]));
  for (const l of links) {
    if (neighbours.has(l.from) && neighbours.has(l.to)) {
      neighbours.get(l.from)!.push(l.to);
      neighbours.get(l.to)!.push(l.from);
    }
  }
  const byWeight = [...keys].sort((a, b) => (weight[b] ?? 0) - (weight[a] ?? 0) || a.localeCompare(b));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const start of byWeight) {
    if (seen.has(start)) continue;
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const k = queue.shift()!;
      out.push(k);
      for (const n of (neighbours.get(k) ?? []).sort((a, b) => (weight[b] ?? 0) - (weight[a] ?? 0) || a.localeCompare(b))) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
  }
  return out;
}

export function layoutKnowledgeMap(nodes: MapNode[], links: MapLink[]): Record<string, Placed> {
  const weight = Object.fromEntries(nodes.map((n) => [n.key, n.weight]));
  const subjects = new Map<string, string[]>();
  for (const n of nodes) subjects.set(n.subject, [...(subjects.get(n.subject) ?? []), n.key]);
  // Biggest subject first, then by name, so the layout never depends on input order.
  const clusters = [...subjects.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

  const pos: Record<string, Placed> = {};
  // Pack the sunflowers in rows about as wide as the biggest few.
  const radiusOf = (count: number) => STAR_SPACING * SPIRAL * Math.sqrt(count) + STAR_SPACING;
  const rowWidth = Math.max(...clusters.slice(0, 3).map(([, k]) => radiusOf(k.length) * 2)) * Math.max(1, Math.min(3, clusters.length)) * 1.05;
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const [, keys] of clusters) {
    const r = radiusOf(keys.length);
    if (x > 0 && x + 2 * r > rowWidth) {
      x = 0;
      y += rowH + STAR_SPACING * 0.6;
      rowH = 0;
    }
    const cx = x + r;
    const cy = y + r;
    linkOrder(keys, links, weight).forEach((k, i) => {
      const d = STAR_SPACING * SPIRAL * Math.sqrt(i + 0.5);
      pos[k] = { x: cx + Math.cos(i * GOLDEN) * d, y: cy + Math.sin(i * GOLDEN) * d };
    });
    x += 2 * r + STAR_SPACING * 0.6;
    rowH = Math.max(rowH, 2 * r);
  }

  // A light relaxation: links pull a little, touching stars push apart. Bounded steps, no frame.
  const keys = nodes.map((n) => n.key);
  const live = links.filter((l) => pos[l.from] && pos[l.to] && l.from !== l.to);
  const minGap = STAR_SPACING * 0.85;
  for (let it = 0; it < 60; it++) {
    const move: Record<string, Placed> = Object.fromEntries(keys.map((k) => [k, { x: 0, y: 0 }]));
    for (const l of live) {
      const a = pos[l.from];
      const b = pos[l.to];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d <= STAR_SPACING * 1.6) continue;
      const pull = Math.min(6, (d - STAR_SPACING * 1.6) * 0.015 * l.strength);
      move[l.from].x += (dx / d) * pull;
      move[l.from].y += (dy / d) * pull;
      move[l.to].x -= (dx / d) * pull;
      move[l.to].y -= (dy / d) * pull;
    }
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = pos[keys[i]];
        const b = pos[keys[j]];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d = Math.hypot(dx, dy);
        if (d >= minGap) continue;
        const push = (minGap - d) / 2;
        const ux = d > 0.01 ? dx / d : 1;
        const uy = d > 0.01 ? dy / d : 0;
        move[keys[i]].x += ux * push;
        move[keys[i]].y += uy * push;
        move[keys[j]].x -= ux * push;
        move[keys[j]].y -= uy * push;
      }
    }
    for (const k of keys) {
      pos[k].x += move[k].x;
      pos[k].y += move[k].y;
    }
  }
  for (const k of keys) pos[k] = { x: Math.round(pos[k].x), y: Math.round(pos[k].y) };
  return pos;
}

/** The rectangle the stars cover, padded — what the map's view fits to. */
export function mapBounds(pos: Record<string, Placed>, pad = STAR_SPACING): { x: number; y: number; w: number; h: number } {
  const pts = Object.values(pos);
  if (pts.length === 0) return { x: 0, y: 0, w: 1600, h: 1000 };
  // Twice the room at the sides: labels are wider than stars, and an edge star's name must fit.
  const x0 = Math.min(...pts.map((p) => p.x)) - pad * 2;
  const y0 = Math.min(...pts.map((p) => p.y)) - pad;
  const x1 = Math.max(...pts.map((p) => p.x)) + pad * 2;
  const y1 = Math.max(...pts.map((p) => p.y)) + pad;
  return { x: x0, y: y0, w: Math.max(400, x1 - x0), h: Math.max(300, y1 - y0) };
}

/**
 * WHICH LABELS TO WRITE: in order of importance (the selected star, then due, then brightest and
 * best-connected), a label is written only if it does not overlap one already written, at the
 * current zoom. Zooming in makes room, so more appear. `scale` is map units per screen pixel.
 */
export function visibleLabels(
  stars: Array<{ key: string; x: number; y: number; r: number; text: string; priority: number }>,
  scale: number,
  fontPx = 13,
): Set<string> {
  // Every star is an obstacle too: a label never sits under another star.
  const placed: Array<{ x0: number; y0: number; x1: number; y1: number }> = stars.map((s) => ({ x0: s.x - s.r - 2 * scale, y0: s.y - s.r - 2 * scale, x1: s.x + s.r + 2 * scale, y1: s.y + s.r + 2 * scale }));
  const out = new Set<string>();
  const size = fontPx * scale;
  for (const s of [...stars].sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key))) {
    const w = s.text.length * size * 0.56;
    const box = { x0: s.x - w / 2 - 4 * scale, y0: s.y + s.r + 4 * scale, x1: s.x + w / 2 + 4 * scale, y1: s.y + s.r + size * 1.5 };
    if (placed.some((p) => box.x0 < p.x1 && p.x0 < box.x1 && box.y0 < p.y1 && p.y0 < box.y1)) continue;
    placed.push(box);
    out.add(s.key);
  }
  return out;
}

/** A label short enough to sit under a star; the full name is in the star's panel. */
export function shortLabel(text: string, max = 26): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
}
