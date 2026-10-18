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
  let moved = 0;
  let dropped = 0;
  const seen = new Set<string>();
  const cues: CanvasCue[] = [];
  for (const cue of spec.cues) {
    let target = cue.target;
    // "unzoom" only returns the camera, wherever it was; "visit" names a board, not a target.
    if (target && !onBoard.has(target) && cue.action !== "unzoom" && cue.action !== "visit") {
      const sentence = sentences[cue.s] ?? "";
      const part = labelled.find((p) => namedIn(sentence, p.name, p.aliases));
      const note = spec.notes.find((n) => n.s === cue.s && onBoard.has(n.id));
      target = part?.id ?? note?.id;
      if (!target) { dropped++; continue; }
      moved++;
    }
    // Two cues on one sentence at one target are one pen move.
    const key = `${cue.s}|${cue.action}|${target ?? ""}`;
    if (target && seen.has(key)) { dropped++; continue; }
    seen.add(key);
    cues.push(target === cue.target ? cue : { ...cue, target });
  }
  return { cues, moved, dropped };
}
