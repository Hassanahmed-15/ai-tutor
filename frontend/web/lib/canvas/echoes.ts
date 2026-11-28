import { canvasSentences } from "./plan";

/**
 * A SENTENCE SAID TWICE IN A ROW (QA report 2026-11-27 #17, and again in the PDF test of 2026-11-28: "For an ohmic
 * conductor at constant temperature, current is directly proportional to voltage. For an ohmic conductor at constant
 * temperature, the current through it is directly proportional to the voltage across it."). A strict plan paraphrases
 * a passage and then gives its exact words too; nothing caught two neighbours saying the same thing.
 *
 * Run on the PLAN, before any board is drawn, so dropping a sentence costs no timing: the board is written for the
 * script as it leaves here. The fuller of the two is kept (in a strict lesson that is usually the source's own
 * words); the sentence-indexed fields — the passage each sentence boxes, the notes, the teaching cycle — move with
 * the sentences. Pure, so it is unit-tested (lib/anim/echoes.test.ts).
 */

const STOP = new Set("the a an and or of to in on for with by as at from is are be that this which it its into than then so we you they their there these those was were has have had can will would does do not".split(" "));
const contentWords = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 3 && !STOP.has(w)));

/** Two neighbouring sentences that say the same thing: most of the shorter one's words are in the other. */
export function echoes(a: string, b: string): boolean {
  const x = contentWords(a), y = contentWords(b);
  const small = Math.min(x.size, y.size);
  if (small < 4) return false;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / small >= 0.75;
}

type Beatish = { script: string; sentenceBlocks?: string[]; boardNotes?: Array<{ s: number; text: string }>; teachingCycle?: { teach: number; predict: number; reveal: number; transfer: number } };

export function dropEchoedSentences<T extends Beatish>(beat: T): { beat: T; dropped: string[] } {
  const sentences = canvasSentences(beat.script);
  if (sentences.length < 2) return { beat, dropped: [] };
  const keep = sentences.map(() => true);
  for (let i = 1; i < sentences.length; i++) {
    // The sentence before, among those still kept.
    let j = i - 1;
    while (j >= 0 && !keep[j]) j--;
    if (j < 0 || !echoes(sentences[j], sentences[i])) continue;
    if (sentences[i].length > sentences[j].length) keep[j] = false;
    else keep[i] = false;
  }
  const dropped = sentences.filter((_, i) => !keep[i]);
  if (!dropped.length) return { beat, dropped };
  // Old sentence index → new: a dropped sentence's things move to the kept sentence that says the same.
  // (the kept sentence before it, or the first kept one when it was the first).
  const map = sentences.map((_, i) => {
    const before = keep.slice(0, i).filter(Boolean).length;
    return keep[i] ? before : Math.max(0, before - 1);
  });
  const last = keep.filter(Boolean).length - 1;
  const at = (s: number) => Math.min(last, map[Math.max(0, Math.min(sentences.length - 1, s))] ?? last);
  const out: T = { ...beat, script: sentences.filter((_, i) => keep[i]).join(" ") };
  if (beat.sentenceBlocks) {
    // The passage of the kept sentence wins; a dropped sentence's passage goes when its twin kept its own.
    out.sentenceBlocks = beat.sentenceBlocks.filter((_, i) => keep[i] ?? true);
  }
  if (beat.boardNotes) out.boardNotes = beat.boardNotes.map((n) => ({ ...n, s: at(n.s) }));
  if (beat.teachingCycle) {
    const c = beat.teachingCycle;
    out.teachingCycle = { teach: at(c.teach), predict: at(c.predict), reveal: at(c.reveal), transfer: at(c.transfer) };
  }
  return { beat: out, dropped };
}
