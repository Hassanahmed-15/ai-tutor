/**
 * Choosing among parallel board candidates: a pass beats anything, a clean layout beats a richer
 * broken one, and a candidate that cannot run is never chosen.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { candidateTemperatures, pickCandidate, type CandidateVerdict } from "../animationCandidates";

const pass = (score: number, code = `pass${score}`): CandidateVerdict => ({ kind: "pass", code, score });
const soft = (score: number, layoutClean: boolean, code = `soft${score}`): CandidateVerdict => ({ kind: "soft-fail", code, score, layoutClean, issue: "too text-heavy" });
const hard: CandidateVerdict = { kind: "hard-fail", issue: "did not parse" };

test("a candidate that passed every check wins over a richer one that did not", () => {
  assert.equal(pickCandidate([soft(200, true), pass(90), hard])?.code, "pass90");
});

test("among passes, the richest wins", () => {
  assert.equal(pickCandidate([pass(80), pass(120), pass(100)])?.code, "pass120");
});

test("with no pass, a clean layout beats a richer board with broken layout", () => {
  assert.equal(pickCandidate([soft(150, false), soft(100, true), hard])?.code, "soft100");
});

test("with no clean layout either, the richest runnable board ships", () => {
  assert.equal(pickCandidate([soft(90, false), soft(110, false)])?.code, "soft110");
});

test("a candidate that cannot run is never chosen; none runnable means another round", () => {
  assert.equal(pickCandidate([hard, hard, hard]), null);
  assert.equal(pickCandidate([]), null);
});

test("candidates are drawn at different temperatures, capped at 1", () => {
  assert.deepEqual(candidateTemperatures(3), [0.55, 0.75, 0.95]);
  assert.deepEqual(candidateTemperatures(4), [0.55, 0.75, 0.95, 1]);
  assert.deepEqual(candidateTemperatures(0), [0.55]);
});
