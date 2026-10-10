import test from "node:test";
import assert from "node:assert/strict";
import { Aligner, unitsForWord, weightsFromSegments } from "../avatar/align";
import { VISEME_NAMES, type VisemeName } from "../avatar/visemes";

/** A frame that sounds like `v` (cost 2) and unlike everything else (cost 20); silence is sil ≈ 0. */
function frame(v: VisemeName | "quiet", noise = 0): number[] {
  return VISEME_NAMES.map((n) => {
    if (v === "quiet") return n === "sil" ? 0 : 20;
    if (n === v) return 2 + noise;
    if (n === "sil") return 25;
    return 12 + noise;
  });
}

/** "Peter": PP I DD RR, as the rules hand it over. */
const peter = unitsForWord(["PP", "I", "DD", "RR"], [1.08, 0.92, 1.05, 0.88]);

test("a word's units are its shapes in order with a skippable pause before it", () => {
  assert.equal(peter[0].viseme, "sil");
  assert.equal(peter[0].optional, true);
  assert.deepEqual(peter.slice(1).map((u) => u.viseme), ["PP", "I", "DD", "RR"]);
  assert.ok(peter[1].minFrames >= 2, "a sealed lip must be visible for at least two frames");
  const merged = unitsForWord(["SS", "SS", "aa"], [1, 1, 1], 6, false);
  assert.deepEqual(merged.map((u) => u.viseme), ["SS", "aa"]);
  assert.ok(merged[0].expectFrames > 6 && merged[0].expectFrames < 12);
});

test("the shapes land where they sound, and silence before the word is a pause", () => {
  const a = new Aligner();
  a.addUnits(peter);
  const frames = [
    ...Array.from({ length: 5 }, () => frame("quiet")),
    ...Array.from({ length: 4 }, () => frame("PP")),
    ...Array.from({ length: 7 }, () => frame("I")),
    ...Array.from({ length: 4 }, () => frame("DD")),
    ...Array.from({ length: 6 }, () => frame("RR")),
  ];
  a.addFrames(frames);
  const segs = a.segments(true);
  assert.deepEqual(segs.map((s) => s.viseme), ["sil", "PP", "I", "DD", "RR"]);
  assert.deepEqual(segs.map((s) => [s.start, s.end]), [[0, 5], [5, 9], [9, 16], [16, 20], [20, 26]]);
});

test("the ear's mistakes do not reorder the words: a heard d inside 'Peter' stays a p", () => {
  const a = new Aligner();
  a.addUnits(peter);
  // The lips seal (p), but the model hears d for a couple of frames, then the vowel.
  a.addFrames([
    ...Array.from({ length: 2 }, () => frame("PP")),
    ...Array.from({ length: 2 }, () => frame("DD")),
    ...Array.from({ length: 7 }, () => frame("I")),
    ...Array.from({ length: 4 }, () => frame("DD")),
    ...Array.from({ length: 5 }, () => frame("RR")),
  ]);
  const segs = a.segments(true);
  assert.deepEqual(segs.map((s) => s.viseme), ["PP", "I", "DD", "RR"]);
  assert.equal(segs[0].start, 0);
  assert.ok(segs[0].end >= 2 && segs[0].end <= 4, `p covers its frames (${segs[0].end})`);
});

test("audio ahead of the words ends in the wildcard; words ahead of the audio end mid-list", () => {
  const a = new Aligner();
  a.addUnits(peter);
  a.addFrames([
    ...Array.from({ length: 4 }, () => frame("PP")),
    ...Array.from({ length: 6 }, () => frame("I")),
    ...Array.from({ length: 4 }, () => frame("DD")),
    ...Array.from({ length: 5 }, () => frame("RR")),
    // Then a shape no unit expects, for a while: words still to arrive.
    ...Array.from({ length: 12 }, () => frame("aa")),
  ]);
  let segs = a.segments();
  assert.equal(segs[segs.length - 1].viseme, "RR");
  assert.ok(segs[segs.length - 1].end <= 21, `the r does not swallow the unexpected vowel (ends ${segs[segs.length - 1].end})`);
  // Now the next word arrives: "and" → aa nn DD. The vowel claims those frames.
  a.addUnits(unitsForWord(["aa", "nn", "DD"], [1, 0.9, 0.9]));
  segs = a.segments();
  const aa = segs.find((s) => s.viseme === "aa");
  assert.ok(aa && aa.start >= 18 && aa.start <= 20, `the vowel starts where it sounds (${aa?.start})`);
  assert.equal(segs[segs.length - 1].viseme, "aa", "the words after it have not been heard yet");

  // Words far ahead of the audio: only the first shape has sounded.
  const b = new Aligner();
  b.addUnits(peter);
  b.addFrames(Array.from({ length: 3 }, () => frame("PP")));
  const early = b.segments();
  assert.deepEqual(early.map((s) => s.viseme), ["PP"]);
});

test("frames then words, or words then frames, give the same alignment", () => {
  const frames = [
    ...Array.from({ length: 3 }, () => frame("quiet")),
    ...Array.from({ length: 4 }, () => frame("PP")),
    ...Array.from({ length: 6 }, () => frame("I")),
    ...Array.from({ length: 4 }, () => frame("DD")),
    ...Array.from({ length: 5 }, () => frame("RR")),
  ];
  const a = new Aligner();
  a.addUnits(peter);
  for (const f of frames) a.addFrames([f]);
  const b = new Aligner();
  b.addFrames(frames);
  b.addUnits(peter);
  assert.deepEqual(a.segments(true), b.segments(true));
});

test("weights rise before a shape's sound, hold, and fall after; the lips lead on p and oo", () => {
  const w = weightsFromSegments([{ unit: 0, viseme: "PP", start: 6, end: 10 }, { unit: 1, viseme: "I", start: 10, end: 16 }], 20);
  assert.equal(w[1].PP, undefined, "nothing long before");
  assert.ok((w[3].PP ?? 0) > 0 && (w[3].PP ?? 0) < 1, "the seal begins to form four frames early");
  assert.equal(w[6].PP, 1);
  assert.equal(w[9].PP, 1);
  assert.ok((w[10].PP ?? 0) < 1 && (w[10].PP ?? 0) > 0, "and releases after its sound");
  assert.equal(w[14].PP, undefined);
  assert.ok((w[8].I ?? 0) > 0 && (w[8].I ?? 0) < 1, "the vowel is already forming two frames before");
  assert.equal(w[12].I, 1);
  assert.equal(w[19].I, undefined);
  assert.deepEqual(weightsFromSegments([{ unit: 0, viseme: "sil", start: 0, end: 5 }], 5)[2], {}, "silence draws nothing");
});
