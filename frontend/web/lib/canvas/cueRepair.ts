import { canvasSentences } from "./plan";
import { namedIn } from "./labelPolicy";
import type { CanvasBoardSpec, CanvasCue, CanvasPlanBeat } from "./types";

/**
 * THE PEN NEVER POINTS AT NOTHING. A board writer cues the pen at what the sentence talks about, but
 * by the time the board ships that thing may not be on it: a picture could not locate the aorta, a
 * label was left off, an equation's terms got other ids. A heart board pointed at the aorta, the
 * pulmonary artery and the pulmonary vein — none drawn — so half its pen moments did nothing (prompt
 * bench, 2026-10-17). A cue whose target is not on the board goes to what that sentence names that IS
 * on it — a labelled part, else the note written for that sentence — or is dropped.
 *
 * `onBoard` is every id the pen can find (the layout's targets and any graph markers).
 */
export function repairCues(spec: CanvasBoardSpec, beat: Pick<CanvasPlanBeat, "script">, onBoard: Set<string>): { cues: CanvasCue[]; moved: number; dropped: number } {
  const sentences = canvasSentences(beat.script);
  const stage = spec.stage as { kind: string; parts?: Array<{ id: string; name: string; aliases?: string[] }>; labels?: string[] };
  const labelled = (stage.parts ?? []).filter((p) => onBoard.has(p.id) && (stage.kind !== "illustration" || (stage.labels ?? []).includes(p.id)));
  const names = targetNames(spec);
  let moved = 0;
  let dropped = 0;
  const seen = new Set<string>();
  const pointedAt = new Set<string>();
  const cues: CanvasCue[] = [];
  for (const cue of spec.cues) {
    let target = cue.target;
    const sentence = sentences[cue.s] ?? "";
    // "unzoom" only returns the camera, wherever it was; "visit" names a board, not a target.
    if (target && !onBoard.has(target) && cue.action !== "unzoom" && cue.action !== "visit") {
      const part = labelled.find((p) => namedIn(sentence, p.name, p.aliases));
      const note = spec.notes.find((n) => n.s === cue.s && onBoard.has(n.id));
      target = part?.id ?? note?.id;
      if (!target) { dropped++; continue; }
      moved++;
    }
    // DOT GOES WHERE THE SENTENCE IS (owner, 2026-10-21: "Dot points wrong"). Dot flies to every
    // point, circle and underline, so one at something the sentence does not name sends her to the
    // wrong thing: "…connect the theorem with vectors" at "Four copies of the right triangle", three
    // sentences in a row at "Point A", a bare "=" sign (Pythagoras lecture).
    if (target && (cue.action === "point" || cue.action === "circle" || cue.action === "underline")) {
      const own = names.get(target);
      const said = own ? namedIn(sentence, own.name, own.aliases) : true;
      if (own && /^\s*[=+\-−×÷<>≤≥]\s*$/.test(own.name)) { dropped++; continue; }
      if (own && !said && /[a-z]{3,}/i.test(own.name)) {
        const part = labelled.find((p) => p.id !== target && namedIn(sentence, p.name, p.aliases));
        if (part) {
          target = part.id;
          moved++;
        } else if (pointedAt.has(target)) {
          // Back at the same thing on a sentence that no longer names it.
          dropped++;
          continue;
        }
      }
      pointedAt.add(target);
    }
    // Two cues on one sentence at one target are one pen move.
    const key = `${cue.s}|${cue.action}|${target ?? ""}`;
    if (target && seen.has(key)) { dropped++; continue; }
    seen.add(key);
    cues.push(target === cue.target ? cue : { ...cue, target });
  }
  return { cues, moved, dropped };
}

/** What each target on the board is called: a stage part's name, a note's or a row's text. */
function targetNames(spec: CanvasBoardSpec): Map<string, { name: string; aliases?: string[] }> {
  const out = new Map<string, { name: string; aliases?: string[] }>();
  const walk = (o: unknown): void => {
    if (!o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach(walk);
    const r = o as Record<string, unknown>;
    const name = [r.name, r.label, r.text, r.tex].find((v): v is string => typeof v === "string" && v.trim().length > 0);
    if (typeof r.id === "string" && name && !out.has(r.id)) out.set(r.id, { name, aliases: Array.isArray(r.aliases) ? r.aliases.filter((a): a is string => typeof a === "string") : undefined });
    for (const v of Object.values(r)) walk(v);
  };
  walk(spec.stage);
  walk(spec.notes);
  return out;
}
