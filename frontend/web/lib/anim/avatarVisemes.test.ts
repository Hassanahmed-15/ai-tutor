import test from "node:test";
import assert from "node:assert/strict";
import { ARKIT_NAMES } from "../avatar/face";
import { VISEME_NAMES, VISEME_SHAPES, faceFromVisemes, speakingFace, visemeKey, visemesActive } from "../avatar/visemes";

const names = new Set<string>(ARKIT_NAMES);

test("every viseme shape names real ARKit blendshapes within a speaking range", () => {
  for (const v of VISEME_NAMES) {
    for (const [k, val] of Object.entries(VISEME_SHAPES[v])) {
      assert.ok(names.has(k), `${v}: ${k} is not an ARKit shape`);
      assert.ok(val > 0 && val <= 0.8, `${v}.${k}=${val}`);
    }
  }
  assert.ok((VISEME_SHAPES.aa.jawOpen ?? 0) <= 0.6, "the jaw never passes 0.6 from a viseme alone");
});

test("the consonants that look different do look different", () => {
  const pp = faceFromVisemes({ PP: 1 });
  assert.ok((pp.mouthPressLeft ?? 0) > 0.4 && (pp.jawOpen ?? 0) === 0 && (pp.mouthClose ?? 0) === 0, "p/b/m: jaw shut, lips pressed, no mouthClose smear");
  const ff = faceFromVisemes({ FF: 1 });
  assert.ok((ff.mouthRollLower ?? 0) > 0.25 && (ff.mouthUpperUpLeft ?? 0) > 0.2, "f/v: lower lip under the teeth");
  const th = faceFromVisemes({ TH: 1 });
  assert.ok((th.tongueOut ?? 0) > 0.3, "th: tongue at the teeth");
  const ss = faceFromVisemes({ SS: 1 });
  assert.ok((ss.mouthStretchLeft ?? 0) > 0.2 && (ss.jawOpen ?? 0) <= 0.12, "s: teeth together, lips spread");
  const oo = faceFromVisemes({ U: 1 });
  assert.ok((oo.mouthPucker ?? 0) > 0.5 && (oo.mouthSmileLeft ?? 0) === 0, "oo: puckered, no smile");
  const ee = faceFromVisemes({ I: 1 });
  assert.ok((ee.mouthSmileLeft ?? 0) > 0.3 && (ee.mouthPucker ?? 0) === 0, "ee: spread, no pucker");
  assert.ok((faceFromVisemes({ aa: 1 }).jawOpen ?? 0) > (faceFromVisemes({ E: 1 }).jawOpen ?? 0), "ah drops the jaw more than eh");
});

test("visemes blend by weight and the voice's loudness scales the mouth", () => {
  const half = faceFromVisemes({ aa: 0.5, O: 0.5 });
  assert.ok((half.jawOpen ?? 0) > 0.4 && (half.jawOpen ?? 0) < 0.6, `blended jaw ${half.jawOpen}`);
  assert.ok((half.mouthFunnel ?? 0) > 0.2, "the O's funnel comes through at half weight");
  const quiet = faceFromVisemes({ aa: 1 }, 0);
  const loud = faceFromVisemes({ aa: 1 }, 1);
  assert.ok((quiet.jawOpen ?? 0) < (loud.jawOpen ?? 0), "a whisper opens less than a shout");
  assert.ok((quiet.jawOpen ?? 0) > 0.3, "but a whispered 'ah' is still an 'ah'");
  for (const v of Object.values(faceFromVisemes({ aa: 1, E: 1, I: 1, O: 1, U: 1 }))) assert.ok(v <= 1);
  assert.deepEqual(faceFromVisemes({ sil: 1 }), {}, "silence is a resting mouth");
});

test("active means a mouth shape is live, and HeadAudio's keys resolve", () => {
  assert.equal(visemesActive({ sil: 0.8 }), false);
  assert.equal(visemesActive({ sil: 0.2, PP: 0.05 }), true);
  assert.equal(visemeKey("viseme_PP"), "PP");
  assert.equal(visemeKey("aa"), "aa");
  assert.equal(visemeKey("viseme_zz"), null);
});

test("a speaking face: the jaw follows the voice, the lips follow the words", () => {
  // The same vowel, loud and between syllables: the jaw opens and closes with the voice.
  const loud = speakingFace({ aa: 1 }, 1);
  const between = speakingFace({ aa: 1 }, 0);
  assert.ok((loud.jawOpen ?? 0) > 0.55, `open on the syllable (${loud.jawOpen})`);
  assert.equal(between.jawOpen, 0, "shut between syllables");
  // A consonant shape with a loud voice still opens; the table's own half-open jaw is not used.
  assert.equal(speakingFace({ DD: 1 }, 0).jawOpen, 0, "no jaw held open by a consonant in the quiet");
  // Lip shape from the words: oo rounds, ee spreads, at the same loudness.
  const oo = speakingFace({ U: 1 }, 0.6), ee = speakingFace({ I: 1 }, 0.6);
  assert.ok((oo.mouthPucker ?? 0) > 0.5 && (ee.mouthPucker ?? 0) === 0);
  assert.ok((ee.mouthSmileLeft ?? 0) > 0.3 && (oo.mouthSmileLeft ?? 0) === 0);
  assert.ok((oo.jawOpen ?? 0) < (speakingFace({ aa: 1 }, 0.6).jawOpen ?? 0), "a rounded vowel drops the jaw less");
  // p/b/m seals the lips and shuts the jaw even if the voice is loud there.
  const p = speakingFace({ PP: 1 }, 0.8);
  assert.ok((p.mouthPressLeft ?? 0) > 0.4 && (p.jawOpen ?? 1) < 0.01);
  // Lip shapes fade with the voice, but a closure holds in the quiet (that is where it happens).
  assert.ok((speakingFace({ U: 1 }, 0).mouthPucker ?? 0) === 0);
  assert.ok((speakingFace({ PP: 1 }, 0).mouthPressLeft ?? 0) > 0.4);
});
