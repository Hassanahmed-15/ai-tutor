import test from "node:test";
import assert from "node:assert/strict";
import { DOT_REST, dotMuscles, easeMuscles } from "../avatar/dotFace";

const VOICE = { open: 0.7, width: 0.5 };

test("each vowel reaches its own shape: ah open, ee spread, oo small and round", () => {
  const ah = dotMuscles({ aa: 1 }, VOICE);
  const ee = dotMuscles({ I: 1 }, VOICE);
  const oo = dotMuscles({ U: 1 }, VOICE);
  assert.ok(ah.jaw > 0.8, `ah opens wide (${ah.jaw})`);
  assert.ok(ee.spread > 0.9 && ee.jaw < 0.4 && ee.teeth > 0.9, "ee spreads with teeth");
  assert.ok(oo.round > 0.9 && oo.jaw < 0.35, "oo is small and round");
});

test("a vowel next to a consonant still reaches most of its opening (vowels own the jaw)", () => {
  // Mid-transition from "t" into "ah": the ah must dominate, not average with the t.
  const m = dotMuscles({ DD: 0.5, aa: 0.5 }, VOICE);
  assert.ok(m.jaw > 0.7, `jaw ${m.jaw}`);
});

test("closures win: m/b/p shut the lips even while the voice is loud", () => {
  const m = dotMuscles({ PP: 1, aa: 0.4 }, { open: 1, width: 0.5 });
  assert.equal(m.jaw, 0);
  assert.equal(m.seal, 1);
  const f = dotMuscles({ FF: 1 }, VOICE);
  assert.ok(f.fv > 0.99 && f.jaw < 0.05 && f.teeth > 0.9, "f/v: teeth on the lip");
});

test("silence rests; no visemes falls back to the loudness mouth", () => {
  assert.deepEqual(dotMuscles({}, { open: 0, width: 0.5 }), DOT_REST);
  const v = dotMuscles({}, { open: 0.6, width: 0.9 });
  assert.ok(v.jaw > 0.4 && v.spread > 0.7);
});

test("easing: frame-rate independent and a closure snaps", () => {
  const target = dotMuscles({ PP: 1 }, VOICE);
  const open = { ...DOT_REST, jaw: 1 };
  const a = easeMuscles(open, target, 1 / 60);
  let b = open;
  for (let i = 0; i < 4; i++) b = easeMuscles(b, target, 1 / 240);
  assert.ok(Math.abs(a.jaw - b.jaw) < 0.02, `60 fps ${a.jaw} vs 240 fps ${b.jaw}`);
  assert.ok(a.seal > 0.9 && a.jaw < 0.1, "shut within one frame");
});
