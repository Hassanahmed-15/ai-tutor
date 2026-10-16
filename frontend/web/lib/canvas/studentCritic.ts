import { layoutPanel } from "./layout";
import { slug } from "./validate";
import { figureComponent } from "../figures/registry";
import type { CanvasBoardSpec, CanvasPlanBeat } from "./types";

export type StudentBoardCritique = {
  passed: boolean;
  issues: string[];
  /** Structured, student-view findings for Phase 8 audit reports. */
  findings: Array<{ code: "missing-object" | "unattached-label" | "hidden-relationship" | "not-exam-usable" | "id-label"; severity: "error" | "warning"; message: string; fix: string }>;
  score: number;
  checks: { namedObjectsIdentifiable: boolean; labelsAttached: boolean; relationshipVisible: boolean; examUsable: boolean; labelsReadable: boolean };
};

/** Deterministic student-view gate run after layout, before a generated board is accepted. */
export function critiqueStudentBoard(spec: CanvasBoardSpec, beat: Pick<CanvasPlanBeat, "objects" | "brief" | "script">): StudentBoardCritique {
  const layout = layoutPanel(spec);
  const targetIds = new Set(Object.keys(layout.targets));
  // A named object is identifiable by its element id OR by a visible label that says its name. Code,
  // graph and equation boards have fixed element ids (line-N, curve ids, tokens), so their objects
  // are found by the words on the board, never by id — demanding ids there failed every attempt and
  // shipped the placeholder board (audit 2026-10-15).
  const visibleWords = labelTexts(spec).join(" ").toLowerCase();
  const words = (name: string) => name.toLowerCase().replace(/[-_]+/g, " ").split(/\s+/).filter((w) => w.length > 2);
  // Figures draw every part whether labelled or not; atom maps and molecules have fixed element ids.
  const fixedIds = spec.stage.kind === "code" || spec.stage.kind === "graph" || spec.stage.kind === "equation" || spec.stage.kind === "figure" || spec.stage.kind === "atom-map" || spec.stage.kind === "molecule";
  const figurePartIds = spec.stage.kind === "figure"
    ? new Set((spec.stage.asset?.parts ?? figureComponent(spec.stage.component)?.build(spec.stage.params).parts ?? []).map((part) => part.id))
    : new Set<string>();
  const missing = beat.objects.map((name) => slug(name, "")).filter((id) => {
    if (!id || targetIds.has(id) || fixedIds) return false;
    // A plan may contain conceptual objects that are not physical parts of this component. Ignore
    // those here; but when it names a real drawn part, that part must also have a visible label.
    if (spec.stage.kind === "figure" && !figurePartIds.has(id)) return false;
    const w = words(id);
    return !(w.length && w.every((x) => visibleWords.includes(x)));
  });
  const namedObjectsIdentifiable = missing.length === 0;
  // Labels a student reads must be words, not element ids ("central-atom", "sine-layer").
  const idLabels = labelTexts(spec).filter(looksLikeId);
  const labelsReadable = idLabels.length === 0;

  const visualSkill = /\b(label|identify|diagram|structure|shape|geometry|angle)\b/i.test(`${beat.brief} ${beat.script}`);
  const labelsAttached = spec.stage.kind !== "illustration" || !visualSkill || spec.stage.parts.every((part) => spec.stage.kind === "illustration" && spec.stage.labels.includes(part.id));

  const relationshipVisible = (() => {
    switch (spec.stage.kind) {
      case "flow": return spec.stage.arrows.length > 0;
      case "equation": return spec.stage.steps.some((step) => step.order.length >= 3);
      case "compare": return spec.stage.left.items.length > 0 && spec.stage.right.items.length > 0;
      case "scene": return spec.stage.arrows.length > 0 || !/\b(process|cause|relationship|from|to|becomes)\b/i.test(beat.brief);
      case "molecule": return spec.stage.molecules.every((molecule) => molecule.bonds.length > 0 && Boolean(molecule.geometry));
      case "atom-map": return spec.stage.reactants.length > 0 && spec.stage.products.length > 0;
      default: return true;
    }
  })();
  const examUsable = !visualSkill || spec.stage.kind === "molecule" || spec.stage.kind === "atom-map" || labelsAttached || spec.stage.kind === "equation" || spec.stage.kind === "graph";

  const issues: string[] = [];
  const findings: StudentBoardCritique["findings"] = [];
  if (!namedObjectsIdentifiable) {
    const message = `a student cannot identify these named objects on the rendered board: ${missing.join(", ")}`;
    issues.push(message);
    findings.push({ code: "missing-object", severity: "error", message, fix: "Add a visible, readable element for each named object and keep its id stable." });
  }
  if (!labelsAttached) {
    const message = "the task asks students to label or identify structures, but not every visible part has an attached callout";
    issues.push(message);
    findings.push({ code: "unattached-label", severity: "error", message, fix: "Attach a callout to every required part; do not rely on narration alone." });
  }
  if (!relationshipVisible) {
    const message = "the main relationship is not visible without narration";
    issues.push(message);
    findings.push({ code: "hidden-relationship", severity: "error", message, fix: "Add arrows, equation steps, links or another visible relation between the elements." });
  }
  if (!labelsReadable) {
    const message = `labels must be readable words a student would write, not element ids: ${idLabels.slice(0, 4).join(", ")}`;
    issues.push(message);
    findings.push({ code: "id-label", severity: "error", message, fix: "Write each label as plain words with spaces and proper notation (\"Central atom\", \"NH₄⁺\"), keep the id only in the id field." });
  }
  if (!examUsable) {
    // A warning is reported, never blocking: blocking on it sent good boards to the placeholder.
    const message = "the diagram could not by itself support the stated exam skill";
    findings.push({ code: "not-exam-usable", severity: "warning", message, fix: "Make the requested labels, values, comparison or method visible enough to answer an exam question." });
  }
  const score = Math.round((Object.values({ namedObjectsIdentifiable, labelsAttached, relationshipVisible, examUsable, labelsReadable }).filter(Boolean).length / 5) * 100);
  return { passed: issues.length === 0, issues, findings, score, checks: { namedObjectsIdentifiable, labelsAttached, relationshipVisible, examUsable, labelsReadable } };
}

/** "central-atom", "sine-layer", "nh4": an id shown as a label. A single short lowercase word ("box") is fine. */
export function looksLikeId(text: string): boolean {
  const t = text.trim();
  return /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/.test(t);
}

/** Every piece of text a student can read on the board's stage and notes. */
export function labelTexts(spec: CanvasBoardSpec): string[] {
  const out: string[] = [spec.heading, ...spec.notes.map((n) => n.text)];
  const walk = (v: unknown, key = "") => {
    if (typeof v === "string") { if (/^(label|name|title|text|sub|caption)$/.test(key)) out.push(v); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x, key); return; }
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk(spec.stage);
  return out.filter((s) => typeof s === "string" && s.trim().length > 0);
}
