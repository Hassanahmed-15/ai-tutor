import test from "node:test";
import assert from "node:assert/strict";
import { ARKIT_NAMES, blinkWeight, composeFrame, easeFrame, expressionTarget, headSway, mouthWeights, nextBlinkDelayMs } from "../avatar/face";

const names = new Set<string>(ARKIT_NAMES);

test("every weight the face produces is a real ARKit blendshape in 0..1", () => {
  for (const state of ["idle", "listening", "thinking", "speaking"] as const) {
    for (const mouth of [{ open: 0, width: 0.5 }, { open: 1, width: 0 }, { open: 1, width: 1 }, { open: 0.4, width: 0.5 }]) {
      const frame = composeFrame(expressionTarget(state), mouthWeights(mouth), blinkWeight(90));
      assert.equal(Object.keys(frame).length, 52, "every shape is sent every frame, so none is left at its last value");
      for (const [k, v] of Object.entries(frame)) {
        assert.ok(names.has(k), `${k} is not an ARKit shape`);
        assert.ok(v >= 0 && v <= 1, `${k}=${v}`);
      }
    }
  }
});

test("a closed mouth is closed; a rounded vowel funnels, a spread one smiles, loudness drops the jaw", () => {
  assert.equal(mouthWeights({ open: 0, width: 0.5 }).jawOpen, 0);
  const oo = mouthWeights({ open: 0.6, width: 0.1 });
  const ee = mouthWeights({ open: 0.6, width: 0.9 });
  assert.ok(oo.mouthFunnel > 0.2 && oo.mouthPucker > 0.2 && ee.mouthFunnel === 0, "rounded vowel funnels");
  assert.ok(ee.mouthSmileLeft > 0.2 && ee.mouthStretchLeft > 0.2 && oo.mouthSmileLeft === 0, "spread vowel smiles");
  assert.ok(oo.jawOpen < ee.jawOpen, "a rounded vowel drops the jaw less");
  assert.ok(mouthWeights({ open: 1, width: 0.5 }).jawOpen > mouthWeights({ open: 0.3, width: 0.5 }).jawOpen);
  assert.ok(mouthWeights({ open: 1, width: 0.5 }).jawOpen <= 0.72, "never a shout");
});

test("a blink shuts fast and opens slower, within its duration", () => {
  assert.equal(blinkWeight(-1), 0);
  assert.equal(blinkWeight(200), 0);
  assert.ok(blinkWeight(63) > 0.99, "fully shut at the end of the closing phase");
  assert.ok(blinkWeight(40) > blinkWeight(140), "closing is quicker than opening");
  const delays = ["idle", "speaking", "thinking"].map((s) => nextBlinkDelayMs(s as never, 0.5));
  assert.ok(delays[1] < delays[0] && delays[2] < delays[1], "blinks come faster while talking and thinking");
});

test("the head sways a little and never a lot; speaking adds a nod that follows the voice", () => {
  const deg = Math.PI / 180;
  for (let t = 0; t < 60; t += 0.37) {
    const [p, y, r] = headSway(t, "speaking", 1);
    assert.ok(Math.abs(y) <= 1.7 * deg && Math.abs(r) <= 0.8 * deg && Math.abs(p) <= 2.0 * deg);
  }
  const still = headSway(3, "speaking", 0)[0];
  const nod = headSway(3, "speaking", 1)[0];
  assert.ok(nod > still, "an open mouth tips the head forward a touch");
});

test("easing moves toward the target and drops keys that reach zero; the blink sits over everything", () => {
  const eased = easeFrame({ browInnerUp: 0.2, eyeSquintLeft: 0.2 }, { browInnerUp: 0.4 }, 0.5);
  assert.ok(Math.abs(eased.browInnerUp - 0.3) < 1e-9);
  assert.ok(Math.abs(eased.eyeSquintLeft - 0.1) < 1e-9);
  const gone = easeFrame({ eyeSquintLeft: 0.001 }, {}, 0.5);
  assert.equal(gone.eyeSquintLeft, undefined);
  const frame = composeFrame({ eyeBlinkLeft: 0.1, mouthSmileLeft: 0.3 }, { mouthSmileLeft: 0.1, jawOpen: 0.5 }, 1);
  assert.equal(frame.eyeBlinkLeft, 1);
  assert.equal(frame.mouthSmileLeft, 0.3, "the mouth never lowers an expression weight");
  assert.equal(frame.jawOpen, 0.5);
});
