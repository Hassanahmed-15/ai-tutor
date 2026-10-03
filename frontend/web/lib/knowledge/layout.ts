/**
 * WHERE EACH STAR SITS on the knowledge map — a small force layout, pure and deterministic (the same
 * map always looks the same, so a student finds their concepts where they left them). Unit-tested
 * in lib/anim/knowledgeGraph.test.ts.
 *
 * Concepts of one subject pull toward that subject's own region of the sky, linked concepts pull
 * together, every pair pushes apart. A few hundred concepts at most, so plain O(n²) is fine.
 */

export type MapNode = { key: string; subject: string; weight: number };
export type MapLink = { from: string; to: string; strength: number };
export type Placed = { x: number; y: number };

function seeded(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function layoutKnowledgeMap(nodes: MapNode[], links: MapLink[], width = 1600, height = 1000, iterations = 260): Record<string, Placed> {
  const subjects = [...new Set(nodes.map((n) => n.subject))].sort();
  // Each subject gets a home on an ellipse around the centre (one subject: the centre itself).
  const home: Record<string, Placed> = {};
  subjects.forEach((s, i) => {
    const a = (i / Math.max(1, subjects.length)) * Math.PI * 2 - Math.PI / 2;
    const r = subjects.length > 1 ? 0.3 : 0;
    home[s] = { x: width / 2 + Math.cos(a) * width * r, y: height / 2 + Math.sin(a) * height * r };
  });
  const pos: Record<string, Placed> = {};
  for (const n of nodes) {
    const rand = seeded(n.key);
    const h = home[n.subject];
    pos[n.key] = { x: h.x + (rand() - 0.5) * width * 0.25, y: h.y + (rand() - 0.5) * height * 0.25 };
  }
  const keys = nodes.map((n) => n.key);
  const live = links.filter((l) => pos[l.from] && pos[l.to] && l.from !== l.to);
  const ideal = Math.max(110, Math.min(190, Math.sqrt((width * height) / Math.max(1, nodes.length)) * 0.6));
  for (let it = 0; it < iterations; it++) {
    const cool = 1 - it / iterations;
    const force: Record<string, Placed> = Object.fromEntries(keys.map((k) => [k, { x: 0, y: 0 }]));
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const a = pos[keys[i]];
        const b = pos[keys[j]];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = 0.1;
          dy = 0.1;
          d2 = 0.02;
        }
        const d = Math.sqrt(d2);
        const push = (ideal * ideal) / d;
        force[keys[i]].x += (dx / d) * push;
        force[keys[i]].y += (dy / d) * push;
        force[keys[j]].x -= (dx / d) * push;
        force[keys[j]].y -= (dy / d) * push;
      }
    }
    for (const l of live) {
      const a = pos[l.from];
      const b = pos[l.to];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(0.1, Math.hypot(dx, dy));
      const pull = ((d * d) / ideal) * l.strength;
      force[l.from].x += (dx / d) * pull;
      force[l.from].y += (dy / d) * pull;
      force[l.to].x -= (dx / d) * pull;
      force[l.to].y -= (dy / d) * pull;
    }
    for (const n of nodes) {
      const p = pos[n.key];
      const h = home[n.subject];
      force[n.key].x += (h.x - p.x) * 0.9;
      force[n.key].y += (h.y - p.y) * 0.9;
      const f = force[n.key];
      const mag = Math.max(0.01, Math.hypot(f.x, f.y));
      const step = Math.min(mag, 24 * cool + 1);
      p.x = Math.max(40, Math.min(width - 40, p.x + (f.x / mag) * step));
      p.y = Math.max(40, Math.min(height - 40, p.y + (f.y / mag) * step));
    }
  }
  for (const k of keys) pos[k] = { x: Math.round(pos[k].x), y: Math.round(pos[k].y) };
  return pos;
}
