import type { CanvasPlanBeat } from "../canvas/types";
import { canvasSentences } from "../canvas/plan";
import { parseDiagramSpec, type DiagramSpec } from "./spec";
import { checkDiagram } from "./check";
import { compileDiagram } from "./render";
import { drawableText } from "./glyphs";
import { fitText } from "../figures/cuts";

/**
 * The board writer's brief for a vector diagram. Code draws every primitive; the model only
 * chooses what the standard textbook diagram contains.
 */
export const DIAGRAM_GUIDE = `DIAGRAM BOARD: return "stage": {"kind": "diagram", "spec": {…}, "parts": [{"id", "name", "s"}]}.
spec is a closed scene the renderer draws exactly. No raw SVG, no scripts.
{"v":1,"w":640,"h":400,"base":"world-map"|"cross-section"|"body"|"plant"|"none","elements":[...]}
Elements (each has "id", "s" = sentence index, optional "part" name for a margin label):
- region: {"t":"region","shape":"rect"|"ellipse"|"polygon"|"rod","x","y","w","h" or "cx","cy","rx","ry" or "points":[{"x","y"}], "fill","stroke"}
- line: {"t":"line","points":[{"x","y"}],"curve":true}
- arrow: {"t":"arrow","from": {id} or {x,y} or {lon,lat}, "to": same, "curved":true, "label", "stroke":"warm"|"cold"|"ink"|hex}
- label: {"t":"label","text","at": {id}|{x,y}|{lon,lat}, "leader": true}
- repeat: {"t":"repeat","n": exact count the narration states, "layout":"row"|"grid"|"ring","x","y","w","h","of": a region (the item)}
- axis: {"t":"axis","id","x","y","w","h","xLabel","yLabel","xMin","xMax","yMin","yMax"}
- series: {"t":"series","axis": axis id, "points":[{"x","y","label"}], "style":"line"|"points"|"both", "stroke"}
- bands: {"t":"bands","orientation":"h"|"v","x","y","w","h","bands":[{"id","name","from","to","fill","s"}]}
- inset: {"t":"inset","x","y","w","h","label"}
- map-mark: {"t":"map-mark","lon","lat","kind":"dot"|"arrow","toLon","toLat","label","stroke":"warm"|"cold"} — lon/lat in degrees; code projects them.
base "world-map" is an equirectangular outline (code-supplied). Positions on it MUST be lon/lat.
RULES:
- Draw the STANDARD TEXTBOOK diagram for this idea.
- Every number drawn is one the narration states. Exact counts use repeat.
- Every label is a part the narration names or the syllabus requires. At most 8 labels.
- Conventional colours: oxygenated blood red, deoxygenated blue; warm ocean currents red, cold blue.
- Define a region before an arrow that joins it.
- Text is real text (never baked into a picture). Never cut a word, never use "…".
- Do not invent data, maps with guessed geography, or counts the narration does not give.`;

export function diagramUserExtra(beat: CanvasPlanBeat): string[] {
  const sentences = canvasSentences(beat.script);
  const must = beat.requiredVisual?.mustShow ?? [];
  return [
    DIAGRAM_GUIDE,
    `Subject: ${beat.title}. Brief: ${beat.brief}`,
    must.length ? `Syllabus parts this board must show: ${must.join("; ")}.` : "",
    "Narration, numbered:",
    ...sentences.map((s, i) => `[${i}] ${s}`),
  ].filter(Boolean);
}

export type WrittenDiagram = {
  spec: DiagramSpec;
  parts: Array<{ id: string; name: string; s: number }>;
  repairs: string[];
  factIssues: string[];
};

/** Parse the model's JSON, repair layout, compile. Never throws. */
export function acceptDiagram(raw: unknown, narration: string, mustShow: string[] = []): WrittenDiagram | null {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const stage = (body.stage && typeof body.stage === "object" ? body.stage : body) as Record<string, unknown>;
  const parsed = parseDiagramSpec(stage.spec ?? stage);
  if (!parsed) return null;
  // Over-long labels stay whole here so the rewrite pass can find the writer's words; the validator's
  // check fits and records them.
  const checked = checkDiagram(parsed, narration, mustShow, { cutText: false });
  const drawing = compileDiagram(checked.spec);
  const parts = (Array.isArray(stage.parts) ? stage.parts : drawing.parts)
    .map((p, i) => {
      const r = (p && typeof p === "object" ? p : { id: p }) as Record<string, unknown>;
      const id = String(r.id ?? drawing.parts[i]?.id ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const known = drawing.parts.find((x) => x.id === id);
      if (!known) return null;
      // In glyphs the board font draws, and ended at a word (recorded), never cut mid-word.
      return { id, name: fitText(drawableText(String(r.name ?? known.name)), 34), s: Math.max(0, Number(r.s) || 0) };
    })
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .slice(0, 8);
  const labelled = parts.length ? parts : drawing.parts.slice(0, 6).map((p, i) => ({ id: p.id, name: p.name, s: i }));
  if (!labelled.length) return null;
  return { spec: checked.spec, parts: labelled, repairs: checked.repairs, factIssues: checked.factIssues };
}
