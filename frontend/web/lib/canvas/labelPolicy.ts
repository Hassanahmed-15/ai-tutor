import { figureComponent } from "../figures/registry";
import { canvasSentences } from "./plan";
import type { CanvasBoardSpec, CanvasPlanBeat } from "./types";

/**
 * ONLY THE LABELS THAT MATTER. A diagram is not a labelling exercise: the owner asked for labels on
 * the parts that are mandatory, not on everything drawn (2026-10-17). A part is labelled when
 *   - the syllabus requires this board to show it (the curriculum visual contract's mustShow), or
 *   - Aria names it in what she says over this board.
 * Every other part stays drawn (and tappable in a picture's explore mode) but is not written.
 */

// A syllabus point can list eight structures to identify (a dicot leaf: cuticle, stomata, guard cells,
// mesophyll, air spaces, vascular bundles, chloroplasts, epidermis); six left two of them unlabelled.
const MAX_LABELS = 8;

const core = (name: string) => name.replace(/\s*\(.*?\)\s*/g, " ").toLowerCase().replace(/[^a-z0-9α-ω'’ -]+/g, " ").replace(/\s+/g, " ").trim();
const words = (t: string) => core(t).split(/[\s-]+/).filter((w) => w.length >= 4 && !/^(with|from|into|that|this|their|layers?|parts?)$/.test(w));

/** Does the narration name this part? Its whole name, or most of its distinctive words. */
export function namedIn(script: string, name: string): boolean {
  const said = ` ${core(script)} `;
  const whole = core(name);
  if (whole && said.includes(` ${whole} `)) return true;
  const ws = words(name);
  if (!ws.length) return false;
  // The words must be said together — within a few words of each other — so "right side" in one
  // sentence and "left ventricle" in another do not name the right ventricle.
  const need = Math.max(1, Math.ceil(ws.length * 0.67));
  const matches = (token: string, w: string) => token.startsWith(w.replace(/s$/, ""));
  for (const sentence of script.split(/(?<=[.!?;])\s+/)) {
    const tokens = core(sentence).split(/[\s-]+/);
    for (let i = 0; i < tokens.length; i++) {
      if (!ws.some((w) => matches(tokens[i], w))) continue;
      const window = tokens.slice(i, i + ws.length + 3);
      if (ws.filter((w) => window.some((t) => matches(t, w))).length >= need) return true;
    }
  }
  return false;
}

/** The sentence (numbered as the player numbers them) that first names a part; 0 when none does. */
function firstNamed(script: string, name: string): number {
  return Math.max(0, canvasSentences(script).findIndex((sentence) => namedIn(sentence, name)));
}

/** Is this part required by the board's curriculum contract? */
function required(beat: Pick<CanvasPlanBeat, "requiredVisual">, id: string, name: string): boolean {
  return (beat.requiredVisual?.mustShow ?? []).some((m) => {
    const want = core(m);
    return want === id.toLowerCase() || want === core(name) || (want.length > 3 && core(name).includes(want));
  });
}

/** The labelled parts, in the order the narration first names them; required ones always kept. */
export function mandatoryLabels(beat: Pick<CanvasPlanBeat, "script" | "requiredVisual">, parts: Array<{ id: string; name: string }>): string[] {
  const at = (name: string) => {
    const said = core(beat.script);
    const i = said.indexOf(core(name));
    return i >= 0 ? i : Number.MAX_SAFE_INTEGER;
  };
  const must = parts.filter((p) => required(beat, p.id, p.name));
  const named = parts.filter((p) => !must.includes(p) && namedIn(beat.script, p.name)).sort((a, b) => at(a.name) - at(b.name));
  return [...must, ...named].slice(0, Math.max(MAX_LABELS, must.length)).map((p) => p.id);
}

/**
 * The board with only its mandatory labels written. A picture keeps every located part (still
 * tappable) but writes only those labels; a drawn figure labels only those parts, and pen cues that
 * pointed at an unlabelled part are dropped.
 */
export function withMandatoryLabels(spec: CanvasBoardSpec, beat: Pick<CanvasPlanBeat, "script" | "requiredVisual">): CanvasBoardSpec {
  const stage = spec.stage;
  if (stage.kind === "illustration") {
    const keep = new Set(mandatoryLabels(beat, stage.parts));
    return { ...spec, stage: { ...stage, labels: stage.parts.filter((p) => keep.has(p.id)).map((p) => p.id) } };
  }
  if (stage.kind === "figure") {
    // Every part the figure CAN label is a candidate, not only those the board writer chose: Aria
    // named chloroplasts, air spaces, phloem and guard cells over a leaf section that labelled three
    // other parts (audit 2026-10-17). A named part the writer left out is added on the sentence that
    // first names it.
    const available = stage.asset?.parts ?? figureComponent(stage.component)?.parts ?? [];
    const candidates = [...stage.parts, ...available.filter((a) => !stage.parts.some((p) => p.id === a.id)).map((a) => ({ id: a.id, name: a.name, s: firstNamed(beat.script, a.name) }))];
    const keep = new Set(mandatoryLabels(beat, candidates));
    // A labelled diagram needs a few labels: when Aria names fewer than three parts, the writer's own
    // choices fill it up to three. Keeping only one made every attempt fail "a figure needs at least two
    // labelled parts" and sent two boards of a biology lesson to the backup (audit 2026-10-17).
    const parts = candidates.filter((p) => keep.has(p.id));
    const minimum = Math.min(3, stage.parts.length);
    const kept = parts.length >= minimum ? parts : [...parts, ...stage.parts.filter((p) => !parts.some((q) => q.id === p.id))].slice(0, Math.max(minimum, parts.length));
    const ids = new Set(kept.map((p) => p.id));
    return { ...spec, stage: { ...stage, parts: kept }, cues: spec.cues.filter((c) => !c.target || !stage.parts.some((p) => p.id === c.target) || ids.has(c.target)) };
  }
  return spec;
}
