import test from "node:test";
import assert from "node:assert/strict";
import type { Beat } from "../lessonContent";
import { boardSummary, incomingSummary } from "./boardTagline";

const beat = (title: string, ops: unknown[]): Beat => ({ id: title, title, script: "One. Two.", draw: { ops } } as unknown as Beat);
const illustrated = beat("Inside a Chloroplast", [{ kind: "reactAnimation", code: 'const ILLUSTRATION_ID = "0123456789abcdef0123456789abcdef";', model: "gpt-image-1", trial: { costUsd: 0.0731, ms: 30853 } }]);
const motion = beat("Markov State", [{ kind: "reactAnimation", code: "export default function Animation({ sentence }) {}", model: "gpt-5.6-terra", trial: { costUsd: 0.214, ms: 48200 } }]);
const pending = beat("Ventilation Mechanics", [{ kind: "reactAnimation" }]);
const chart = beat("Linear Regression", [{ kind: "plotBoard" }]);

test("the tagline names what drew this board, its cost and how long it took", () => {
  assert.equal(boardSummary(illustrated), "Illustrated · Motion · gpt-image-1 · $0.073 · 31s");
  assert.equal(boardSummary(motion), "Motion · GPT-5.6 Terra · $0.214 · 48s");
  assert.equal(boardSummary(pending), "Motion · drawing…");
  assert.equal(boardSummary(chart), "Chart");
});

test("the tagline says what is coming next and whether it is ready", () => {
  assert.deepEqual(incomingSummary([illustrated, motion], 0, 2), { text: "next: Markov State · ready", state: "ready" });
  assert.deepEqual(incomingSummary([illustrated, pending], 0, 2), { text: "next: Ventilation Mechanics · drawing…", state: "drawing" });
  // A progressive lecture that has planned more boards than have arrived.
  assert.deepEqual(incomingSummary([illustrated], 0, 8), { text: "next: board 2 of 8 · being written…", state: "writing" });
  assert.deepEqual(incomingSummary([illustrated, motion], 1, 2), { text: "last board", state: "last" });
});
