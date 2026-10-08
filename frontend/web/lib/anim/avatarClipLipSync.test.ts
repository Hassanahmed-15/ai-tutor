import test from "node:test";
import assert from "node:assert/strict";
import { alignUnits, envelopeCosts, frameLoudness, jawFromLoudness, sentenceUnits, withLoudnessPriors } from "../avatar/clipLipSync";
import { HOP_S } from "../avatar/headFeatures";

const SR = 24000;

/** A synthetic sentence: voiced bursts (a 180 Hz buzz) at the given [start, end] seconds, silence between. */
function speech(bursts: Array<[number, number]>, total: number): Float32Array {
  const out = new Float32Array(Math.round(total * SR));
  for (const [a, b] of bursts) {
    for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) out[i] = 0.3 * Math.sin((2 * Math.PI * 180 * i) / SR) * Math.sin((Math.PI * (i - a * SR)) / ((b - a) * SR));
  }
  return out;
}

/** "Peter bought. Figs" as the English rules hand it over. */
const words = [
  { word: "Peter", visemes: ["PP", "I", "DD", "RR"], durations: [1.08, 0.92, 1.05, 0.88] },
  { word: "bought.", visemes: ["PP", "aa", "DD"], durations: [1.08, 1.2, 1.05] },
  { word: "Figs", visemes: ["FF", "I", "kk", "SS"], durations: [1, 0.92, 1.2, 1.23] },
];
const frameOf = (s: number) => Math.round(s / HOP_S);

test("loudness and jaw: quiet is closed, the voice opens it relative to the clip's own level", () => {
  const rms = frameLoudness(speech([[0.2, 0.6]], 1), SR);
  assert.ok(Math.abs(rms.length - Math.floor((1 - 0.032) / HOP_S + 1)) <= 1);
  const jaw = jawFromLoudness(rms);
  assert.equal(jaw[frameOf(0.05)], 0, "silence: closed");
  assert.ok(jaw[frameOf(0.39)] > 0.6, `mid-word: open (${jaw[frameOf(0.39)]})`);
  // A clip twice as quiet opens the jaw the same: the level is the clip's own.
  const quiet = jawFromLoudness(frameLoudness(speech([[0.2, 0.6]], 1).map((v) => v * 0.5), SR));
  assert.ok(Math.abs(quiet[frameOf(0.39)] - jaw[frameOf(0.39)]) < 0.05);
});

test("a sentence's units: every word's shapes in order, the full stop a required pause", () => {
  const units = sentenceUnits(words);
  const shapes = units.filter((u) => !u.optional).map((u) => u.viseme);
  assert.deepEqual(shapes, ["PP", "I", "DD", "RR", "PP", "aa", "DD", "sil", "FF", "I", "kk", "SS"]);
});

test("aligned to the voice: each word lands in its own burst, in order, and the pauses stay closed", () => {
  // Peter 0.10–0.55, bought 0.70–1.10, (full stop) Figs 1.55–2.05.
  const samples = speech([[0.1, 0.55], [0.7, 1.1], [1.55, 2.05]], 2.3);
  const rms = frameLoudness(samples, SR);
  const weights = alignUnits(sentenceUnits(words), envelopeCosts(rms));
  const shapeAt = (s: number) => Object.entries(weights[frameOf(s)] ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "rest";
  const firstFrameOf = (v: string, from: number, to: number) => {
    for (let f = frameOf(from); f < frameOf(to); f++) if ((weights[f]?.[v as "PP"] ?? 0) >= 1) return f * HOP_S;
    return -1;
  };
  // "Peter" opens with a sealed lip inside its burst; "bought" with its own; "Figs" with the lip on the teeth.
  const p1 = firstFrameOf("PP", 0, 0.6);
  const p2 = firstFrameOf("PP", 0.6, 1.2);
  const f = firstFrameOf("FF", 1.2, 2.2);
  assert.ok(p1 >= 0.08 && p1 < 0.25, `Peter's p at its start (${p1})`);
  assert.ok(p2 >= 0.65 && p2 < 0.85, `bought's b at its start (${p2})`);
  assert.ok(f >= 1.5 && f < 1.7, `Figs's f after the full stop (${f})`);
  // The pause after "bought." and the end of the clip are closed.
  assert.equal(shapeAt(1.32), "rest", "the full stop is a pause");
  assert.equal(shapeAt(2.25), "rest", "after the last word");
  // Words in order: the vowel of bought ("aa") sits between the two p/b closures and before the f.
  const aa = firstFrameOf("aa", 0.6, 1.2);
  assert.ok(aa > p2 && aa < f, `order (${p2} < ${aa} < ${f})`);
});

test("a closure goes where the sound stops: 'amber' seals its lips in the quiet between its vowels", () => {
  // a (0.10–0.34) · m closure, near-silent (0.34–0.44) · ber (0.44–0.80)
  const samples = speech([[0.1, 0.34], [0.44, 0.8]], 1.0);
  const rms = frameLoudness(samples, SR);
  const amber = [{ word: "amber", visemes: ["aa", "PP", "E", "RR"], durations: [1.2, 1.08, 1, 0.9] }];
  const weights = alignUnits(sentenceUnits(amber), withLoudnessPriors(envelopeCosts(rms), rms));
  const sealed = weights.map((w, f) => ((w.PP ?? 0) >= 1 ? f * HOP_S : -1)).filter((t) => t >= 0);
  assert.ok(sealed.length >= 2, "the lips seal");
  for (const t of sealed) assert.ok(t >= 0.3 && t <= 0.48, `sealed at ${t.toFixed(3)}s: inside the quiet, not over a vowel`);
});
