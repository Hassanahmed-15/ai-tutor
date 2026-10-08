import { VISEME_NAMES, type VisemeName, type VisemeWeights } from "./visemes";

/**
 * FORCED ALIGNMENT OF THE WORDS TO THE VOICE. We know what Aria is about to say (the transcript
 * arrives before the audio) and we can hear, frame by frame, how far each moment of the audio is
 * from each mouth shape (HeadAudio's phoneme prototypes, run over the chunk before it plays —
 * lib/avatar/headFeatures.ts). Neither alone is right: the words give the exact sequence of
 * shapes but not their timing; the ear gives timing but mistakes b for d and hears vowels in
 * noise. This is the classic answer, the one every forced aligner uses: a dynamic programme that
 * finds the one segmentation of the audio into the words' shapes, in order, with the least total
 * acoustic cost, subject to how long each shape plausibly lasts.
 *
 * Pure and incremental: audio frames only ever append, so a column computed once is final; words
 * only ever append, so a row computed once is final. Tested in lib/anim/avatarAlign.test.ts.
 */

/** One shape the words call for: which, the fewest frames it may take, and how many it is expected to. */
export type Unit = { viseme: VisemeName; minFrames: number; expectFrames: number; maxFrames: number; optional: boolean };

/** Costs per frame, one per VISEME_NAMES entry, lower = more like that shape. Silence frames: sil ≈ 0, the rest high. */
export type FrameCosts = ArrayLike<number>;

export type Segment = { unit: number; viseme: VisemeName; start: number; end: number };

const SIL = VISEME_NAMES.indexOf("sil");
const INF = Number.POSITIVE_INFINITY;
/** Per frame a shape is held beyond twice its expected length. Distances between shapes are ~3–30 per frame. */
const LONG_PENALTY = 1.5;
/** A shape shorter than expected, by the square of the missing frames: squeezing a word flat is dear, a quick one is cheap. */
const SHORT_PENALTY = 0.75;
/** The wildcard's cost above the frame's best-matching shape. */
const WILDCARD_MARGIN = 4;

/** What follows a word: nothing in particular, a clause break (, ; : —) or a sentence end (. ! ?). */
export type PauseAfter = "none" | "clause" | "sentence";

/** The break a word's trailing punctuation calls for. */
export function pauseAfterWord(raw: string): PauseAfter {
  if (/[.!?]["')\]]*$/.test(raw)) return "sentence";
  if (/[,;:—–]["')\]]*$/.test(raw)) return "clause";
  return "none";
}

/**
 * The units a word's visemes become: a skippable breath before it, its shapes, and after it the
 * pause its punctuation promises. A full stop is a real pause (≥ 4 frames); a comma a shorter one.
 * Those pauses are required, which is what pins each sentence to the silence that follows it.
 */
export function unitsForWord(visemes: string[], durations: number[], framesPerUnit = 5, leadingPause = true, pauseAfter: PauseAfter = "none"): Unit[] {
  const out: Unit[] = [];
  if (leadingPause) out.push({ viseme: "sil", minFrames: 1, expectFrames: 2, maxFrames: 400, optional: true });
  for (let i = 0; i < visemes.length; i++) {
    const v = visemes[i] as VisemeName;
    if (!VISEME_NAMES.includes(v) || v === "sil") continue;
    const d = durations[i] ?? 1;
    const last = out[out.length - 1];
    // The same shape twice in a row is one longer shape.
    if (last && last.viseme === v && !last.optional) {
      last.expectFrames += Math.round(d * framesPerUnit * 0.6);
      last.maxFrames = last.expectFrames * 3 + 4;
      continue;
    }
    const expect = Math.max(2, Math.round(d * framesPerUnit));
    out.push({ viseme: v, minFrames: 2, expectFrames: expect, maxFrames: expect * 3 + 4, optional: false });
  }
  if (pauseAfter === "sentence") out.push({ viseme: "sil", minFrames: 4, expectFrames: 12, maxFrames: 400, optional: false });
  else if (pauseAfter === "clause") out.push({ viseme: "sil", minFrames: 2, expectFrames: 6, maxFrames: 400, optional: false });
  return out;
}

/**
 * The aligner. `addFrames` as audio is analysed, `addUnits` as words arrive, `segments()` for the
 * best segmentation so far. Audio may run past the words (a wildcard tail absorbs it at a flat
 * cost) and words may run past the audio (the path ends in whichever unit fits best).
 */
export class Aligner {
  private units: Unit[] = [];
  /** cum[v][f] = sum of costs of viseme v over frames < f, for O(1) segment costs. */
  private cum: number[][] = VISEME_NAMES.map(() => [0]);
  /** flat[f] = cost of the wildcard at frame f, cumulative. */
  private flatCum: number[] = [0];
  /** D[i][f] = least cost of the units ≤ i covering frames < f (f = 0 is "nothing covered"). */
  private D: Float64Array[] = [];
  /** back[i][f] = the length of unit i's segment ending at f, or 0 when unit i was skipped. */
  private back: Int32Array[] = [];
  /** W[f] = least cost of all units then the wildcard covering frames < f. */
  private W: number[] = [INF];
  private wBack: Int32Array = new Int32Array(1);
  private frames = 0;

  get frameCount(): number {
    return this.frames;
  }

  get unitCount(): number {
    return this.units.length;
  }

  addFrames(costs: FrameCosts[]): void {
    for (const c of costs) {
      const f = this.frames;
      // Costs are taken relative to the frame's best shape: a loud frame far from every prototype
      // must not weigh more than a quiet one, only its preferences matter.
      let least = INF;
      for (let v = 0; v < VISEME_NAMES.length; v++) if ((c[v] ?? 30) < least) least = c[v] ?? 30;
      for (let v = 0; v < VISEME_NAMES.length; v++) this.cum[v][f + 1] = this.cum[v][f] + (c[v] ?? 30) - least;
      // The wildcard is "some shape we were not told about": a little dearer than whatever the frame
      // sounds most like, so a unit that fits beats it and one that does not loses to it.
      this.flatCum[f + 1] = this.flatCum[f] + WILDCARD_MARGIN;
      this.frames = f + 1;
      for (let i = 0; i < this.units.length; i++) this.cell(i, f + 1);
      this.wildcard(f + 1);
    }
  }

  addUnits(units: Unit[]): void {
    for (const u of units) {
      const i = this.units.length;
      this.units.push(u);
      this.D.push(new Float64Array(this.frames + 1).fill(INF));
      this.back.push(new Int32Array(this.frames + 1));
      // Zero frames covered is possible only while every unit so far is a skipped pause.
      this.D[i][0] = u.optional ? (i === 0 ? 0 : this.D[i - 1][0]) : INF;
      for (let f = 1; f <= this.frames; f++) this.cell(i, f);
    }
    // The wildcard follows the last unit, so its row is recomputed when units arrive.
    this.W = [INF];
    this.wBack = new Int32Array(this.frames + 1);
    for (let f = 1; f <= this.frames; f++) this.wildcard(f);
  }

  private grow(i: number, f: number) {
    if (this.D[i].length <= f) {
      const d = new Float64Array(Math.max(f + 1, this.D[i].length * 2)).fill(INF);
      d.set(this.D[i]);
      this.D[i] = d;
      const b = new Int32Array(d.length);
      b.set(this.back[i]);
      this.back[i] = b;
    }
  }

  /** D[i][f]: unit i's segment ends at f; it began after unit i−1 ended, k frames earlier. */
  private cell(i: number, f: number) {
    this.grow(i, f);
    const u = this.units[i];
    const prev = i === 0 ? (g: number) => (g === 0 ? 0 : INF) : (g: number) => this.D[i - 1][g];
    const v = VISEME_NAMES.indexOf(u.viseme);
    let best = u.optional ? prev(f) : INF;
    let bestK = 0;
    const kMax = Math.min(u.maxFrames, f);
    for (let k = u.minFrames; k <= kMax; k++) {
      const before = prev(f - k);
      if (before === INF) continue;
      let cost = before + this.cum[v][f] - this.cum[v][f - k];
      // A pause may be any length; a shape held long or cut short is unlikely.
      if (u.viseme !== "sil") {
        if (k > u.expectFrames * 2) cost += (k - u.expectFrames * 2) * LONG_PENALTY;
        else if (k < u.expectFrames) cost += (u.expectFrames - k) ** 2 * SHORT_PENALTY;
      }
      if (cost < best) {
        best = cost;
        bestK = k;
      }
    }
    this.D[i][f] = best;
    this.back[i][f] = bestK;
  }

  private wildcard(f: number) {
    if (this.wBack.length <= f) {
      const b = new Int32Array(Math.max(f + 1, this.wBack.length * 2));
      b.set(this.wBack);
      this.wBack = b;
    }
    const last = this.units.length - 1;
    const fromUnits = last >= 0 ? this.D[last][f - 1] : INF;
    const stay = this.W[f - 1];
    const cost = this.flatCum[f] - this.flatCum[f - 1];
    if (fromUnits <= stay) {
      this.W[f] = fromUnits + cost;
      this.wBack[f] = 1; // entered from the last unit
    } else {
      this.W[f] = stay + cost;
      this.wBack[f] = 0;
    }
  }

  /**
   * The best segmentation of all frames so far. `complete` says the words are all in, so the path
   * must reach the last unit (or the wildcard beyond it); otherwise it may end in any unit.
   */
  segments(complete = false): Segment[] {
    const F = this.frames;
    if (F === 0 || this.units.length === 0) return [];
    let endUnit = -1;
    let best = INF;
    let inWildcard = false;
    const lo = complete ? this.units.length - 1 : 0;
    for (let i = lo; i < this.units.length; i++) {
      if (this.D[i][F] < best) {
        best = this.D[i][F];
        endUnit = i;
      }
    }
    if (this.W[F] < best) {
      best = this.W[F];
      inWildcard = true;
      endUnit = this.units.length - 1;
    }
    if (endUnit < 0 || best === INF) return [];
    const out: Segment[] = [];
    let f = F;
    if (inWildcard) {
      let g = f;
      while (g > 0 && this.wBack[g] === 0) g--;
      // frames [g-1, F) are the wildcard: the sound of words not yet heard about
      if (g >= 1) f = g - 1;
    }
    for (let i = endUnit; i >= 0 && f > 0; i--) {
      const k = this.back[i][f];
      if (k === 0) continue; // skipped
      out.push({ unit: i, viseme: this.units[i].viseme, start: f - k, end: f });
      f -= k;
    }
    return out.reverse();
  }
}

/** Which visemes lead with the lips (JALI): they begin early and linger, and they colour their neighbours. */
const LIP_LED = new Set<VisemeName>(["PP", "FF", "U", "O", "CH", "RR"]);

/**
 * Per-frame weights from the segments: each shape rises over a few frames before its sound
 * (the mouth moves before the voice), holds, and falls after it, so one shape blends into the next.
 */
export function weightsFromSegments(segments: Segment[], frames: number): VisemeWeights[] {
  const out: VisemeWeights[] = Array.from({ length: frames }, () => ({}));
  for (const s of segments) {
    if (s.viseme === "sil") continue;
    const len = s.end - s.start;
    // A short shape ramps briefly, or its neighbours would blur into it.
    const lead = Math.min(LIP_LED.has(s.viseme) ? 4 : 2, Math.max(1, len));
    const tail = Math.min(3, Math.max(1, len));
    for (let f = Math.max(0, s.start - lead); f < Math.min(frames, s.end + tail); f++) {
      let w = 1;
      if (f < s.start) w = (f - (s.start - lead) + 1) / (lead + 1);
      else if (f >= s.end) w = 1 - (f - s.end + 1) / (tail + 1);
      const cur = out[f][s.viseme] ?? 0;
      if (w > cur) out[f][s.viseme] = Math.round(w * 100) / 100;
    }
  }
  return out;
}

/** The index of a viseme in VISEME_NAMES, for callers building frame costs. */
export function visemeIndex(name: VisemeName): number {
  return VISEME_NAMES.indexOf(name);
}

export { SIL as SIL_INDEX };
