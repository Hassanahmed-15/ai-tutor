import { textWidth, type Mark, type PanelLayout, type Rect } from "./layout";
import type { CanvasBoardSpec } from "./types";
import { PANEL_H, PANEL_W } from "./types";

/**
 * LAYOUT QA BY CODE. Most stages are placed by code and cannot collide, but a scene's items sit in
 * grid cells the model chose: two items given overlapping cells print one over the other, and a long
 * label overruns its box. This measures the laid-out board and names each clash for a retry.
 */
export function layoutIssues(layout: PanelLayout, spec?: CanvasBoardSpec, crossing: Set<string> = new Set()): string[] {
  const issues: string[] = [];
  const placed = layout.marks.filter((m): m is Extract<Mark, { type: "box" | "text" }> => m.type === "box" || m.type === "text");
  const area = (r: Rect) => Math.max(0, r.w) * Math.max(0, r.h);
  const shared = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  for (let i = 0; i < placed.length; i++) {
    const a = placed[i];
    if (a.rect.x < -2 || a.rect.y < -2 || a.rect.x + a.rect.w > PANEL_W + 2 || a.rect.y + a.rect.h > PANEL_H + 2) issues.push(`"${a.id}" runs off the board`);
    const text = a.type === "box" ? a.label : a.text;
    if (text && textWidth(text, a.size) > a.rect.w + 24) issues.push(`the label of "${a.id}" is too long for its cell — shorten it or give it a wider span`);
    for (let j = i + 1; j < placed.length; j++) {
      const b = placed[j];
      if (shared(a.rect, b.rect) > 0.15 * Math.min(area(a.rect), area(b.rect))) issues.push(`"${a.id}" and "${b.id}" overlap — give them separate cells`);
    }
  }
  // An arrow drawn through an element it does not join reads as a link to it (audit 2026-10-15: the
  // arrow from "Questionnaire study" to "Reliability" ran straight through "Validity").
  const ends = new Map((spec && (spec.stage.kind === "scene" || spec.stage.kind === "flow") ? spec.stage.arrows : []).map((a) => [a.id, [a.from, a.to]]));
  const solids: Array<{ id: string; r: Rect }> = [];
  for (const m of layout.marks) {
    if (m.type === "box" || m.type === "text") solids.push({ id: m.id, r: m.rect });
    if (m.type === "node") solids.push({ id: m.id, r: { x: m.cx - m.r, y: m.cy - m.r, w: m.r * 2, h: m.r * 2 } });
  }
  for (const m of layout.marks) {
    if (m.type !== "arrow") continue;
    const joined = ends.get(m.id) ?? [];
    for (const { id, r } of solids) {
      if (joined.includes(id)) continue;
      const inset = { x: r.x + 6, y: r.y + 6, w: r.w - 12, h: r.h - 12 };
      for (let i = 2; i <= 18; i++) {
        const t = i / 20;
        const x = (1 - t) * (1 - t) * m.p0.x + 2 * t * (1 - t) * m.c.x + t * t * m.p1.x;
        const y = (1 - t) * (1 - t) * m.p0.y + 2 * t * (1 - t) * m.c.y + t * t * m.p1.y;
        if (x > inset.x && x < inset.x + inset.w && y > inset.y && y < inset.y + inset.h) { issues.push(`the arrow "${m.id}" runs through "${id}" — move the items so it has a clear path`); crossing.add(m.id); break; }
      }
    }
  }
  return [...new Set(issues)].slice(0, 4);
}

/**
 * The last attempt's repair: an arrow drawn through another element is removed rather than shipped —
 * a missing arrow costs the narration nothing, a wrong one teaches a link that does not exist.
 */
export function dropCrossingArrows(spec: CanvasBoardSpec, layout: PanelLayout): CanvasBoardSpec {
  const crossing = new Set<string>();
  layoutIssues(layout, spec, crossing);
  if (!crossing.size || (spec.stage.kind !== "scene" && spec.stage.kind !== "flow")) return spec;
  const stage = { ...spec.stage, arrows: spec.stage.arrows.filter((a) => !crossing.has(a.id)) };
  return { ...spec, stage, cues: spec.cues.filter((c) => !c.target || !crossing.has(c.target)) } as CanvasBoardSpec;
}
