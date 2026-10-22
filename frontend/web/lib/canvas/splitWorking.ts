import { canvasSentences } from "./plan";
import type { CanvasPlanBeat } from "./types";

/**
 * A LONG PIECE OF WORKING CONTINUES ON THE NEXT BOARD. Boards were 4 to 6 sentences, so a derivation
 * of eight steps was squeezed into "this gives the result" — the owner saw Aria "derive complete
 * things without actually showing something on the board" (2026-10-22: "switch to two boards or clear
 * that board to fit it in"). A maths or computer-science board now says one sentence per step, as many
 * as the working needs; its board wipes to a fresh page when full (lib/canvas/layout.ts), and a script
 * longer than WORKING_MAX sentences is cut here, where a sentence ends nearest the middle, into two
 * consecutive boards: the second continues the same working, with the same visual.
 */
export const WORKING_MAX = 10;

const CONTINUE = "We continue the same working from the last board.";

export function splitLongWorking(beats: CanvasPlanBeat[]): { beats: CanvasPlanBeat[]; count: number } {
  let count = 0;
  const out: CanvasPlanBeat[] = [];
  for (const beat of beats) {
    const sentences = canvasSentences(beat.script);
    if (sentences.length <= WORKING_MAX || beat.refresher || beat.overview || beat.stage === "exam") {
      out.push(beat);
      continue;
    }
    const cut = Math.ceil(sentences.length / 2);
    const notes = beat.boardNotes ?? [];
    // The check card stays at the end of the working; sentence-numbered teaching cycles no longer fit either half.
    out.push({ ...beat, script: sentences.slice(0, cut).join(" "), boardNotes: notes.filter((n) => n.s < cut), interaction: null, teachingCycle: undefined });
    out.push({
      ...beat,
      id: `${beat.id}-continued`,
      title: `${beat.title} (continued)`.slice(0, 80),
      script: [CONTINUE, ...sentences.slice(cut)].join(" "),
      boardNotes: notes.filter((n) => n.s >= cut).map((n) => ({ ...n, s: n.s - cut + 1 })),
      inside: null,
      carry: [],
      teachingCycle: undefined,
    });
    count++;
  }
  if (!count) return { beats, count };
  // Boards are numbered again in order (b1, b2, …); a board "inside" another follows its new id.
  const ids = new Map<string, string>();
  const numbered = out.map((b, i) => { ids.set(b.id, `b${i + 1}`); return { ...b, id: `b${i + 1}` }; });
  return { beats: numbered.map((b) => (b.inside ? { ...b, inside: { ...b.inside, beat: ids.get(b.inside.beat) ?? b.inside.beat } } : b)), count };
}
