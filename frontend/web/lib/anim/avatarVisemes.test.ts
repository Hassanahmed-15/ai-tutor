import test from "node:test";
import assert from "node:assert/strict";
import { ARKIT_NAMES } from "../avatar/face";
import { VISEME_NAMES, VISEME_SHAPES, faceFromVisemes, visemeKey, visemesActive } from "../avatar/visemes";

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
  assert.ok((pp.mouthClose ?? 0) > 0.6 && (pp.jawOpen ?? 0) < 0.1, "p/b/m: lips sealed");
  const ff = faceFromVisemes({ FF: 1 });
  assert.ok((ff.mouthRollLower ?? 0) > 0.4 && (ff.mouthUpperUpLeft ?? 0) > 0.2, "f/v: lower lip under the teeth");
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
