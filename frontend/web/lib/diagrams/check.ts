import { flattenElements, slug, type DiagramElement, type DiagramSpec, type LabelEl, type RepeatEl } from "./spec";
import { validLonLat } from "./project";

/**
 * Deterministic checks that REPAIR. A failed check becomes a message and an automatic fix; the
 * diagram is never silently rejected. Only invented facts/numbers are listed as factIssues (those
 * may trigger one writer retry). Overlap, overflow, missing arrows and bad coordinates are fixed.
 */

export type DiagramCheck = {
  spec: DiagramSpec;
  repairs: string[];
  factIssues: string[];
};

const STOP = /\b(the|a|an|and|of|to|in|on|at|for|with|by|from)\b/gi;

function numbersIn(text: string): number[] {
  const plain = text.replace(/(\d),(\d{3})/g, "$1$2");
  return (plain.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

function fitText(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const breaks = [" — ", " – ", "; ", ": ", ", ", " and ", " or ", " of ", " "];
  let at = -1;
  for (const b of breaks) {
    const i = head.lastIndexOf(b);
    if (i >= max * 0.4 && i > at) at = i;
  }
  return (at > 0 ? head.slice(0, at) : head.replace(/\s+\S*$/, "")).trim() || head.slice(0, max);
}

function estimateWidth(text: string, size = 13): number {
  return Math.max(8, text.length * size * 0.58);
}

function idsOf(spec: DiagramSpec): Set<string> {
  const ids = new Set<string>();
  const walk = (el: DiagramElement) => {
    ids.add(el.id);
    if (el.t === "group") el.elements.forEach(walk);
    if (el.t === "bands") el.bands.forEach((b) => ids.add(b.id));
  };
  spec.elements.forEach(walk);
  return ids;
}

function near(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= Math.max(tol, Math.abs(b) * 0.05, 0.5);
}

/**
 * Repair a spec against the narration. Always returns a drawable spec.
 */
export function checkDiagram(spec: DiagramSpec, narration: string, mustShow: string[] = []): DiagramCheck {
  const repairs: string[] = [];
  const factIssues: string[] = [];
  const said = numbersIn(narration);
  const clone: DiagramSpec = JSON.parse(JSON.stringify(spec)) as DiagramSpec;
  clone.w = Math.max(200, Math.min(800, clone.w));
  clone.h = Math.max(150, Math.min(600, clone.h));

  const clampXY = (x: number, y: number) => ({
    x: Math.max(0, Math.min(clone.w, x)),
    y: Math.max(0, Math.min(clone.h, y)),
  });

  const keep: DiagramElement[] = [];
  for (const el of clone.elements) {
    if (el.t === "map-mark") {
      if (!validLonLat(el.lon, el.lat)) {
        el.lon = Math.max(-180, Math.min(180, el.lon || 0));
        el.lat = Math.max(-90, Math.min(90, el.lat || 0));
        repairs.push(`map mark "${el.id}" coordinates clamped to a valid lon/lat`);
      }
      if (el.kind === "arrow") {
        if (el.toLon == null || el.toLat == null) {
          el.kind = "dot";
          repairs.push(`map arrow "${el.id}" had no destination, drawn as a point`);
        } else if (!validLonLat(el.toLon, el.toLat)) {
          el.toLon = Math.max(-180, Math.min(180, el.toLon));
          el.toLat = Math.max(-90, Math.min(90, el.toLat));
          repairs.push(`map arrow "${el.id}" destination clamped`);
        }
      }
    }
    if (el.t === "label") {
      const fitted = fitText(el.text, 34);
      if (fitted !== el.text) {
        repairs.push(`label "${el.text}" rewritten to fit (${fitted.length} chars)`);
        el.text = fitted;
      }
    }
    if (el.t === "arrow" && el.label) {
      const fitted = fitText(el.label, 28);
      if (fitted !== el.label) {
        repairs.push(`arrow label "${el.label}" rewritten to fit`);
        el.label = fitted;
      }
    }
    if (el.t === "repeat") {
      const nSaid = said.filter((n) => n >= 2 && n <= 80);
      if (nSaid.length && !nSaid.some((n) => n === el.n)) {
        const closest = nSaid.reduce((a, b) => (Math.abs(b - el.n) < Math.abs(a - el.n) ? b : a));
        if (Math.abs(closest - el.n) / Math.max(el.n, 1) <= 0.25 || Math.abs(closest - el.n) <= 2) {
          repairs.push(`repeat count ${el.n} snapped to the narration's ${closest}`);
          el.n = closest;
        } else {
          factIssues.push(`repeat count ${el.n} is not a number the narration states (${nSaid.slice(0, 6).join(", ")})`);
        }
      }
    }
    keep.push(el);
  }
  clone.elements = keep;

  // Arrows must join existing elements (or explicit points). Dangling id-refs are dropped.
  const known = idsOf(clone);
  clone.elements = clone.elements.filter((el) => {
    if (el.t !== "arrow") return true;
    const fromId = "id" in el.from ? el.from.id : null;
    const toId = "id" in el.to ? el.to.id : null;
    if (fromId && !known.has(fromId)) {
      repairs.push(`arrow "${el.id}" dropped (from "${fromId}" does not exist)`);
      return false;
    }
    if (toId && !known.has(toId)) {
      repairs.push(`arrow "${el.id}" dropped (to "${toId}" does not exist)`);
      return false;
    }
    return true;
  });

  // Drawn numbers must appear in the narration. Invented ones are stripped from labels (a fact
  // issue, so the writer may retry once); the diagram still ships.
  if (said.length) {
    const walk = (el: DiagramElement) => {
      const scrub = (text: string): string => {
        const extras = numbersIn(text).filter((n) => !said.some((s) => near(n, s, 0.05) || near(Math.abs(n), s, 0.05)) && Math.abs(n) > 1);
        if (!extras.length) return text;
        factIssues.push(`drawn number ${extras.join(", ")} is not in the narration`);
        let out = text;
        for (const n of extras) out = out.replace(new RegExp(`(?<!\\d)${String(n).replace(".", "\\.")}(?!\\d)`), "").replace(/\s+/g, " ").trim();
        return out || text;
      };
      if (el.t === "label") el.text = scrub(el.text);
      if (el.t === "arrow" && el.label) el.label = scrub(el.label);
      if (el.t === "map-mark" && el.label) el.label = scrub(el.label);
      if (el.t === "series") {
        for (const p of el.points) {
          if (p.label) p.label = scrub(p.label);
          const extras = [p.x, p.y].filter((n) => Math.abs(n) > 1 && !said.some((s) => near(n, s, Math.max(1, Math.abs(s) * 0.08)) || near(Math.abs(n), s, Math.max(1, Math.abs(s) * 0.08))));
          // A graph's sampled curve may use in-between x values; only y-labels are facts.
          if (extras.length && p.label) factIssues.push(`series point labelled with ${extras.join(", ")} which the narration does not state`);
        }
        // Snap series points onto stated (x, y) pairs when the narration names both.
        if (said.length >= 2) {
          for (const p of el.points) {
            const xt = Math.max(1, Math.abs(p.x) * 0.08);
            const yt = Math.max(1, Math.abs(p.y) * 0.08);
            const sx = said.find((s) => near(p.x, s, xt) || near(p.x, -s, xt));
            const sy = said.find((s) => near(p.y, s, yt) || near(p.y, -s, yt));
            if (sx != null) {
              const x = near(p.x, -sx, xt) && !near(p.x, sx, xt) ? -sx : sx;
              if (Math.abs(x - p.x) > 1e-6) { p.x = x; repairs.push(`series x snapped to stated ${x}`); }
            }
            if (sy != null) {
              const y = near(p.y, -sy, yt) && !near(p.y, sy, yt) ? -sy : sy;
              if (Math.abs(y - p.y) > 1e-6) { p.y = y; repairs.push(`series y snapped to stated ${y}`); }
            }
          }
        }
      }
      if (el.t === "group") el.elements.forEach(walk);
    };
    clone.elements.forEach(walk);
  }

  // Labels stay inside the canvas and do not overlap. Positions we can edit are explicit {x,y}.
  const boxes: Array<{ x: number; y: number; w: number; h: number; el: LabelEl }> = [];
  const place = (el: LabelEl) => {
    if (!("x" in el.at) || "lon" in el.at || "id" in el.at) return;
    const at = clampXY(el.at.x, el.at.y);
    if (at.x !== el.at.x || at.y !== el.at.y) {
      el.at = at;
      repairs.push(`label "${el.text}" moved onto the canvas`);
    }
    const w = Math.min(clone.w * 0.4, estimateWidth(el.text) + 8);
    const h = 16;
    let box = { x: at.x - w / 2, y: at.y - h, w, h, el };
    for (let k = 0; k < 12; k++) {
      const hit = boxes.find((b) => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y);
      if (!hit) break;
      box = { ...box, y: hit.y + hit.h + 4 };
      if (box.y + box.h > clone.h) box = { ...box, y: Math.max(0, hit.y - h - 4) };
      repairs.push(`label "${el.text}" nudged so it does not overlap`);
    }
    box.x = Math.max(0, Math.min(clone.w - box.w, box.x));
    box.y = Math.max(12, Math.min(clone.h - 4, box.y + h)) - h;
    el.at = { x: box.x + box.w / 2, y: box.y + h };
    boxes.push(box);
  };
  flattenElements(clone.elements).filter((el): el is LabelEl => el.t === "label").forEach(place);

  // Cap labelled parts at 8 — extra on-diagram labels stay, extra margin parts are dropped.
  const labelled = flattenElements(clone.elements).filter((el) => el.t === "label");
  if (labelled.length > 8) {
    clone.elements = dropExtraLabels(clone.elements, 8, repairs);
  }

  // Syllabus mustShow names that never appear become a repair note, not a rejection.
  for (const need of mustShow) {
    const word = need.toLowerCase().replace(STOP, " ").replace(/[^a-z0-9]+/g, " ").trim();
    if (word.length < 3) continue;
    const hay = JSON.stringify(clone).toLowerCase() + narration.toLowerCase();
    if (!word.split(/\s+/).every((w) => w.length < 4 || hay.includes(w))) {
      repairs.push(`syllabus part "${need}" is not yet labelled — name it if the diagram shows it`);
    }
  }

  return { spec: clone, repairs: [...new Set(repairs)], factIssues: [...new Set(factIssues)] };
}

function dropExtraLabels(elements: DiagramElement[], max: number, repairs: string[]): DiagramElement[] {
  let kept = 0;
  const walk = (list: DiagramElement[]): DiagramElement[] => {
    const out: DiagramElement[] = [];
    for (const el of list) {
      if (el.t === "label") {
        if (kept >= max) {
          repairs.push(`extra label "${el.text}" dropped (at most 8)`);
          continue;
        }
        kept++;
      }
      if (el.t === "group") {
        out.push({ ...el, elements: walk(el.elements) });
        continue;
      }
      out.push(el);
    }
    return out;
  };
  return walk(elements);
}

export function repeatCountOf(el: RepeatEl): number {
  return el.n;
}

export { fitText, slug };
