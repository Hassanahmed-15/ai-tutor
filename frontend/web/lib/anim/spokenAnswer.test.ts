/**
 * Spoken answers on the planning screen (lib/spokenAnswer.ts): the ways people answer out loud are
 * accepted; room noise and Aria's own echo are not.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { matchSpokenAnswer } from "../spokenAnswer";

const DEPTH = ["Foundation, new to all of this", "Beginner, new to this topic", "Intermediate, I know the basics", "Advanced, I use it already", "Not sure"];
const PREDICT = ["The plant makes more sugar", "Oxygen stops being released", "Nothing changes at all", "Not sure"];
const pick = (text: string, options = DEPTH, echo = "") => {
  const r = matchSpokenAnswer(text, options, echo);
  return r?.kind === "option" ? r.option : r?.kind === "free" ? `free:${r.text}` : null;
};

test("a card is picked by its letter or its position", () => {
  assert.equal(pick("B"), DEPTH[1]);
  assert.equal(pick("option c please"), DEPTH[2]);
  assert.equal(pick("the second one"), DEPTH[1]);
  assert.equal(pick("the last one"), DEPTH[4]);
  assert.equal(pick("number two", PREDICT), PREDICT[1]);
});

test("a card is picked in the student's own words", () => {
  assert.equal(pick("I know the basics"), DEPTH[2]);
  assert.equal(pick("intermediate"), DEPTH[2]);
  assert.equal(pick("I'm totally new to all of this"), DEPTH[0]);
  assert.equal(pick("I think oxygen stops", PREDICT), PREDICT[1]);
  assert.equal(pick("more sugar", PREDICT), PREDICT[0]);
});

test("not knowing and skipping are answers", () => {
  assert.equal(pick("honestly I have no idea", PREDICT), "Not sure");
  assert.equal(pick("I don't know"), "Not sure");
  assert.equal(pick("just teach me"), "free:Just teach me");
});

test("their own sentence counts; a stray word or Aria's echo does not", () => {
  assert.equal(pick("the stomata would close up", PREDICT), "free:the stomata would close up");
  assert.equal(pick("yes please", PREDICT), null, "beside cards, two words that pick nothing are ignored");
  assert.equal(pick("hmm"), null);
  assert.equal(pick("what happens to the plant if the light goes out", PREDICT, "Okay — what happens to the plant if the light goes out?"), null, "her own question echoing back");
  assert.equal(pick("light goes", [], ""), "free:light goes", "an open question takes a short phrase");
});
