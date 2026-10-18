import { flattenElements, slug, type DiagramElement, type DiagramSpec, type LabelEl, type RepeatEl } from "./spec";
import { validLonLat } from "./project";
import { recordFigureCut } from "../figures/cuts";
import { drawableText } from "./glyphs";
import { nearestParts } from "./ink";
import { compileDiagram } from "./render";

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
  // Recorded, so the rewrite pass (lib/canvas/generate.ts shortenToFit) is told and can rewrite it
  // to fit instead of the student reading a cut phrase.
  recordFigureCut(t, `a diagram label (${max} characters)`, max);
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
/** Content words of a name, for telling which element a label names. */
const words = (t: string) => new Set((t.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !/^(the|and|for|with|from|into|that|this|its)$/.test(w)).map((w) => w.replace(/(ies|es|s)$/, "").slice(0, 6)));

/**
 * Repair a spec against the narration. Always returns a drawable spec. `cutText: false` leaves over-long
 * label text whole (the board writer's words, so the rewrite pass can find and rewrite them); the
 * board validator's own check then fits and records it.
 */
export function checkDiagram(spec: DiagramSpec, narration: string, mustShow: string[] = [], options: { cutText?: boolean } = {}): DiagramCheck {
  const cutText = options.cutText !== false;
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
    // Words the board font can draw ("OM ⟂ AB" rendered as seven boxes, QA 2026-10-17).
    if (el.t === "label") el.text = drawableText(el.text);
    if (el.t === "arrow" && el.label) el.label = drawableText(el.label);
    if (el.t === "map-mark" && el.label) el.label = drawableText(el.label);
    if (el.t === "bands") for (const b of el.bands) b.name = drawableText(b.name);
    if (el.t === "label" && cutText) {
      const fitted = fitText(el.text, 34);
      if (fitted !== el.text) {
        repairs.push(`label "${el.text}" rewritten to fit (${fitted.length} chars)`);
        el.text = fitted;
      }
    }
    if (el.t === "arrow" && el.label && cutText) {
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

  // A free label must point at the thing it names. Its {x, y} is the writer's guess; the element
  // drawn nearest that point is compared with the label's words. A label nearer another element than
  // the one it names is re-pointed at its own element (by id); one that names nothing and lands on
  // nothing is flagged.
  {
    const drawing = compileDiagram(clone);
    const named = flattenElements(clone.elements).filter((el) => el.t !== "label");
    for (const el of flattenElements(clone.elements)) {
      if (el.t !== "label" || !("x" in el.at) || "lon" in el.at || "id" in el.at) continue;
      const want = words(el.text);
      if (!want.size) continue;
      const score = (other: DiagramElement) => { const have = words(`${other.part ?? ""} ${other.id.replace(/-/g, " ")}`); return [...want].filter((w) => have.has(w)).length; };
      const owner = named.map((other) => ({ other, hits: score(other) })).filter((m) => m.hits > 0).sort((a, b) => b.hits - a.hits)[0]?.other;
      const near = nearestParts(drawing, el.at.x, el.at.y).filter((n) => n.part !== el.id);
      const nearest = near[0];
      if (owner && nearest && nearest.part !== owner.id && !(nearest.part.startsWith(`${owner.id}-`)) && (near.find((n) => n.part === owner.id)?.distance ?? Infinity) > nearest.distance + 4) {
        repairs.push(`label "${el.text}" pointed at "${nearest.part}", not at the "${owner.id}" it names — re-pointed at it`);
        el.at = { id: owner.id };
      } else if (!owner && (!nearest || nearest.distance > 40)) {
        repairs.push(`label "${el.text}" points at nothing drawn — give it "at": {"id"} of the part it names`);
      }
    }
  }

  // On-diagram words (no leader) stay inside the canvas and do not overlap. A margin label's {x, y}
  // is not text but the point its leader touches: moving it to clear another label's box drifted
  // the dot off its part (it was nudged down up to 12 times). On-diagram text tries the other side
  // and left/right before moving at all, never moves more than 24 px from its point, and becomes a
  // margin label with a leader when it cannot fit near it.
  const boxes: Array<{ x: number; y: number; w: number; h: number; el: LabelEl }> = [];
  const MAX_DRIFT = 24;
  const place = (el: LabelEl) => {
    if (!("x" in el.at) || "lon" in el.at || "id" in el.at) return;
    const at = clampXY(el.at.x, el.at.y);
    if (at.x !== el.at.x || at.y !== el.at.y) {
      el.at = at;
      repairs.push(`label "${el.text}" moved onto the canvas`);
    }
    if (el.leader !== false) return;
    const w = Math.min(clone.w * 0.4, estimateWidth(el.text) + 8);
    const h = 16;
    const clear = (b: { x: number; y: number; w: number; h: number }) => b.x >= 0 && b.y >= 0 && b.x + b.w <= clone.w && b.y + b.h <= clone.h
      && !boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
    const tries: Array<[number, number]> = [[0, 0], [0, h + 4], [0, -(h + 4)], [w / 2 + 4, 0], [-(w / 2 + 4), 0], [w / 2 + 4, h + 4], [-(w / 2 + 4), h + 4], [w / 2 + 4, -(h + 4)], [-(w / 2 + 4), -(h + 4)]];
    // How far the words end up from their point: the gap between the point and the text's box.
    const gap = (b: { x: number; y: number; w: number; h: number }) => Math.hypot(Math.max(b.x - at.x, 0, at.x - (b.x + b.w)), Math.max(b.y - (at.y - h / 2), 0, at.y - h / 2 - (b.y + b.h)));
    const fit = tries.map(([dx, dy]) => ({ dx, dy, box: { x: at.x - w / 2 + dx, y: at.y - h + dy, w, h } })).find((c) => clear(c.box) && gap(c.box) <= MAX_DRIFT);
    if (!fit) {
      // No room beside its point: a margin label whose leader keeps the point exact.
      el.leader = true;
      repairs.push(`label "${el.text}" had no room beside its point — drawn in the margin with a leader`);
      return;
    }
    if (fit.dx || fit.dy) repairs.push(`label "${el.text}" set beside its point so it does not overlap`);
    el.at = { x: fit.box.x + w / 2, y: fit.box.y + h };
    boxes.push({ ...fit.box, el });
  };
  flattenElements(clone.elements).filter((el): el is LabelEl => el.t === "label").forEach(place);

  // Cap labelled parts at 8 — extra on-diagram labels stay, extra margin parts are dropped.
  const labelled = flattenElements(clone.elements).filter((el) => el.t === "label");
  if (labelled.length > 8) {
    clone.elements = dropExtraLabels(clone.elements, 8, repairs);
  }

  // A part the syllabus requires that the diagram does not name is a reason to write it again (the
  // writer's one retry), not a note: the board's labels — not the narration — must name it.
  const namedText = flattenElements(clone.elements).map((el) => `${el.part ?? ""} ${el.t === "label" ? el.text : ""} ${el.t === "bands" ? el.bands.map((b) => `${b.name} ${b.part ?? ""}`).join(" ") : ""}`).join(" ").toLowerCase();
  for (const need of mustShow) {
    const word = need.toLowerCase().replace(STOP, " ").replace(/[^a-z0-9]+/g, " ").trim();
    if (word.length < 3) continue;
    const key = word.split(/\s+/).filter((w) => w.length >= 4);
    if (key.length && !key.some((w) => namedText.includes(w.replace(/(ies|es|s)$/, "")))) {
      factIssues.push(`the syllabus requires "${need}" but no part or label names it — draw it and label it`);
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
