import type { MouthShape } from "../adhd/mouth";
import type { VisemeName, VisemeWeights } from "./visemes";

/**
 * DOT'S MOUTH, AS NUMBERS. Dot is the cartoon Aria (a violet orb with a drawn mouth). Her mouth is
 * not a set of pictures: it is seven "muscles" that move on their own, so every in-between shape
 * exists. Pure: components/avatar/DotAvatar.tsx draws the result; tests in lib/anim/dotFace.test.ts.
 *
 * WHY IT LOOKS LIKE SPEECH, NOT FLAPPING (measured in the 2026-10-12 Talking Dot demo):
 *  - Each sound has a target shape, and sounds compete for the mouth by how strongly they hold it.
 *    VOWELS OWN THE JAW: an "ah" must actually reach wide open, an "oo" small and round. When the
 *    consonants around a vowel were allowed to pull the jaw back, vowels reached ~40% of their
 *    shape and every syllable became the same half-open flap.
 *  - Consonants only nudge the jaw; a k or an h borrows its neighbours' shape.
 *  - Closures are not a vote: on m/b/p the lips are shut, on f/v the top teeth rest on the lip,
 *    however loud the voice is (an m is a loud hum with the lips closed).
 *  - The voice's loudness only adds emphasis on top.
 */

export type DotMuscles = {
  /** 0 shut .. 1 wide open. */
  jaw: number;
  /** Lips pulled wide ("ee"). */
  spread: number;
  /** Lips pushed into a ring ("oo"). */
  round: number;
  /** Lips pressed shut (m b p). */
  seal: number;
  /** Lower lip under the top teeth (f v). */
  fv: number;
  /** Tongue tip showing (th, l, t d n). */
  tongue: number;
  /** Upper teeth showing (ee, s, ch). */
  teeth: number;
};

export const DOT_REST: DotMuscles = { jaw: 0, spread: 0, round: 0, seal: 0, fv: 0, tongue: 0, teeth: 0 };
const KEYS = Object.keys(DOT_REST) as (keyof DotMuscles)[];
const LIPS: Partial<Record<keyof DotMuscles, true>> = { spread: true, round: true, seal: true, fv: true };

/** Target shape and pull (lips, jaw) for each of the 15 visemes the lip track speaks in. */
type Target = { v: Partial<DotMuscles>; lips: number; jaw: number };
const TARGETS: Record<Exclude<VisemeName, "sil" | "PP" | "FF">, Target> = {
  aa: { v: { jaw: 1, spread: 0.2, teeth: 0.15 }, lips: 1.5, jaw: 3 },
  E: { v: { jaw: 0.62, spread: 0.62, teeth: 0.6 }, lips: 2, jaw: 2.5 },
  I: { v: { jaw: 0.32, spread: 1, teeth: 1 }, lips: 3, jaw: 2.5 },
  O: { v: { jaw: 0.58, round: 0.85 }, lips: 3, jaw: 3 },
  U: { v: { jaw: 0.28, round: 1 }, lips: 3.5, jaw: 2.5 },
  TH: { v: { jaw: 0.22, tongue: 1, teeth: 0.8, spread: 0.35 }, lips: 1, jaw: 1 },
  DD: { v: { jaw: 0.22, tongue: 0.7, teeth: 0.7, spread: 0.4 }, lips: 0.4, jaw: 0.6 },
  nn: { v: { jaw: 0.22, tongue: 0.7, teeth: 0.6, spread: 0.35 }, lips: 0.4, jaw: 0.6 },
  kk: { v: { jaw: 0.3, spread: 0.3, teeth: 0.3 }, lips: 0.15, jaw: 0.3 },
  RR: { v: { jaw: 0.28, round: 0.55, teeth: 0.2 }, lips: 1.5, jaw: 0.5 },
  CH: { v: { jaw: 0.15, round: 0.75, teeth: 1 }, lips: 2, jaw: 1 },
  SS: { v: { jaw: 0.08, spread: 0.65, teeth: 1 }, lips: 1.2, jaw: 1.2 },
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * The mouth for this frame. `weights` are the live viseme weights (already eased in and out over
 * time by the lip track); `voice` is the loudness mouth from the same bus, used for emphasis and
 * as the whole answer when no visemes are live (the plain-shape fallback).
 */
export function dotMuscles(weights: VisemeWeights, voice: MouthShape): DotMuscles {
  const loud = clamp01(voice.open);
  let total = 0;
  for (const name of Object.keys(TARGETS) as (keyof typeof TARGETS)[]) total += weights[name] ?? 0;
  const seal = clamp01((weights.PP ?? 0) * 1.4);
  const fv = clamp01((weights.FF ?? 0) * 1.3);

  if (total < 0.02 && seal < 0.02 && fv < 0.02) {
    // No sound named: the voice alone (how open, how spread vs round).
    if (loud < 0.02) return { ...DOT_REST };
    return {
      ...DOT_REST,
      jaw: clamp01(loud * 0.9),
      spread: clamp01((voice.width - 0.5) * 2),
      round: clamp01((0.5 - voice.width) * 2),
      teeth: clamp01((voice.width - 0.55) * 2.2),
    };
  }

  // Pull-weighted mix of every live sound's target; what no sound holds drifts back to rest.
  const out: DotMuscles = { ...DOT_REST };
  const rest = Math.max(0, 1 - total - seal - fv);
  for (const k of KEYS) {
    if (k === "seal" || k === "fv") continue;
    let acc = 0;
    let sum = rest * 0.6;
    for (const name of Object.keys(TARGETS) as (keyof typeof TARGETS)[]) {
      const w = weights[name] ?? 0;
      if (w <= 0) continue;
      const t = TARGETS[name];
      const pull = w * (LIPS[k] ? t.lips : t.jaw);
      acc += pull * (t.v[k] ?? 0);
      sum += pull;
    }
    out[k] = sum > 0 ? clamp01(acc / sum) : 0;
  }
  // Emphasis: a loud syllable opens a little more, a quiet one a little less.
  out.jaw *= 0.85 + 0.2 * clamp01(loud / 0.85);
  // Closures win over everything.
  out.seal = seal;
  out.jaw *= 1 - seal;
  out.fv = fv;
  out.jaw = out.jaw * (1 - fv) + 0.03 * fv;
  if (fv > 0.3) out.teeth = Math.max(out.teeth, fv);
  out.tongue *= 1 - seal;
  return out;
}

/**
 * Flesh-like easing towards the target, frame-rate independent: quick to move, a touch slower to
 * let go; a closure snaps (lips meet in ~30 ms).
 */
export function easeMuscles(prev: DotMuscles, target: DotMuscles, dt: number): DotMuscles {
  const steps = Math.max(0, dt) * 60;
  const next: DotMuscles = { ...prev };
  for (const k of KEYS) {
    let a = target[k] > prev[k] ? 0.85 : 0.75;
    if (k === "seal" || k === "fv") a = 0.92;
    if (k === "jaw" && target.seal > 0.5) a = 0.92;
    next[k] = prev[k] + (target[k] - prev[k]) * (1 - Math.pow(1 - a, steps));
  }
  return next;
}
