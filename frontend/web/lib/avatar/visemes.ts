import type { FaceFrame } from "./face";

/**
 * FROM VISEMES TO A FACE. HeadAudio (lib/avatar/vendor, MIT) listens to Aria's voice and names the
 * mouth shape it hears, fifteen of them in the Oculus set: the five vowels, and the consonant
 * groups that LOOK different — lips sealed for p/b/m, the lower lip under the teeth for f/v, the
 * tongue at the teeth for th, teeth together for s/z, rounded for sh/ch and r. Each comes with a
 * weight that eases in and out, so several are live at once as one sound becomes the next.
 *
 * This table says what each shape does to the 52 ARKit blendshapes of the head, and `faceFromVisemes`
 * blends them by weight. Pure, tested in lib/anim/avatarVisemes.test.ts. The amplitudes are a
 * speaking face, not a shouting one: the jaw never passes 0.6 from a viseme alone.
 */

export const VISEME_NAMES = ["aa", "E", "I", "O", "U", "PP", "SS", "TH", "DD", "FF", "kk", "nn", "RR", "CH", "sil"] as const;
export type VisemeName = (typeof VISEME_NAMES)[number];
export type VisemeWeights = Partial<Record<VisemeName, number>>;

/** What each viseme does to the face, at full weight. `sil` does nothing: the mouth rests. */
export const VISEME_SHAPES: Record<VisemeName, FaceFrame> = {
  sil: {},
  // Vowels
  aa: { jawOpen: 0.6, mouthLowerDownLeft: 0.3, mouthLowerDownRight: 0.3, mouthUpperUpLeft: 0.2, mouthUpperUpRight: 0.2 },
  E: { jawOpen: 0.35, mouthStretchLeft: 0.3, mouthStretchRight: 0.3, mouthSmileLeft: 0.2, mouthSmileRight: 0.2, mouthUpperUpLeft: 0.2, mouthUpperUpRight: 0.2, mouthLowerDownLeft: 0.15, mouthLowerDownRight: 0.15 },
  I: { jawOpen: 0.2, mouthSmileLeft: 0.35, mouthSmileRight: 0.35, mouthStretchLeft: 0.35, mouthStretchRight: 0.35, mouthUpperUpLeft: 0.15, mouthUpperUpRight: 0.15 },
  O: { jawOpen: 0.45, mouthFunnel: 0.55, mouthPucker: 0.3, mouthLowerDownLeft: 0.1, mouthLowerDownRight: 0.1 },
  U: { jawOpen: 0.2, mouthPucker: 0.65, mouthFunnel: 0.4 },
  // Consonants
  PP: { mouthClose: 0.8, mouthPressLeft: 0.5, mouthPressRight: 0.5, mouthRollLower: 0.2, mouthRollUpper: 0.2, jawOpen: 0.05 },
  FF: { mouthRollLower: 0.55, mouthUpperUpLeft: 0.25, mouthUpperUpRight: 0.25, mouthPressLeft: 0.2, mouthPressRight: 0.2, jawOpen: 0.1 },
  TH: { tongueOut: 0.45, jawOpen: 0.2, mouthUpperUpLeft: 0.15, mouthUpperUpRight: 0.15 },
  DD: { jawOpen: 0.18, mouthUpperUpLeft: 0.2, mouthUpperUpRight: 0.2, mouthLowerDownLeft: 0.1, mouthLowerDownRight: 0.1 },
  kk: { jawOpen: 0.25, mouthLowerDownLeft: 0.1, mouthLowerDownRight: 0.1 },
  nn: { jawOpen: 0.2, mouthUpperUpLeft: 0.15, mouthUpperUpRight: 0.15, tongueOut: 0.1 },
  RR: { mouthFunnel: 0.3, mouthPucker: 0.4, jawOpen: 0.15 },
  CH: { mouthFunnel: 0.45, mouthPucker: 0.35, jawOpen: 0.15, mouthUpperUpLeft: 0.1, mouthUpperUpRight: 0.1 },
  SS: { mouthStretchLeft: 0.3, mouthStretchRight: 0.3, mouthSmileLeft: 0.15, mouthSmileRight: 0.15, jawOpen: 0.1, mouthUpperUpLeft: 0.15, mouthUpperUpRight: 0.15 },
};

/**
 * Blend the live visemes into one mouth. Weights are summed per shape and capped at 1; `loudness`
 * (0..1, the voice's level) scales how far the jaw and lips go, so a whisper and a shout differ even
 * when they are the same vowel. Returns an empty frame for silence.
 */
export function faceFromVisemes(weights: VisemeWeights, loudness = 1): FaceFrame {
  const frame: FaceFrame = {};
  const gain = 0.55 + 0.45 * Math.max(0, Math.min(1, loudness));
  for (const name of VISEME_NAMES) {
    const w = weights[name];
    if (!w || w <= 0.001) continue;
    for (const [shape, v] of Object.entries(VISEME_SHAPES[name])) {
      frame[shape] = Math.min(1, (frame[shape] ?? 0) + v * w * gain);
    }
  }
  return frame;
}

/** True when anything but silence is live — the caller falls back to the loudness mouth otherwise. */
export function visemesActive(weights: VisemeWeights): boolean {
  return VISEME_NAMES.some((n) => n !== "sil" && (weights[n] ?? 0) > 0.02);
}

/** "viseme_PP" (HeadAudio's key) → "PP". Null for a key that is not a viseme. */
export function visemeKey(key: string): VisemeName | null {
  const name = key.startsWith("viseme_") ? key.slice(7) : key;
  return (VISEME_NAMES as readonly string[]).includes(name) ? (name as VisemeName) : null;
}
