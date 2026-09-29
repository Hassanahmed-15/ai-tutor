/**
 * Background speech must not wake Aria (reported 2026-09-29: "whenever I'm using my phone or
 * there's background noise, Aria gets activated that quickly"), and the student must not have to
 * shout her name either ("don't make it like I'm shouting hey Aria and it doesn't listen").
 */
import test from "node:test";
import assert from "node:assert/strict";
import { classifyAddressing } from "../voice/runtime/addressing";

const idle = { expectingAnswer: false, tutorSpeaking: false, topicWords: new Set(["photosynthesis", "chloroplast", "stroma", "light"]) };
const said = (text: string, context = idle) => classifyAddressing(text, context).addressed;

test("a phone or TV sentence that happens to be a question is not for her", () => {
  assert.equal(said("what is going on here?"), false);
  assert.equal(said("can you believe it?"), false);
  assert.equal(said("where are they now"), false);
  assert.equal(said("who won the match yesterday"), false);
});

test("a student's question about the lesson still reaches her without her name", () => {
  assert.equal(said("what does the stroma do?"), true);
  assert.equal(said("why does it need light?"), true);
  assert.equal(said("what does that mean?"), true);
  assert.equal(said("can you explain that again"), true);
  assert.equal(said("pause"), true);
});

test("her name, and the ways recognisers mishear it, still wake her; other names at the edges do not", () => {
  for (const text of ["hey Aria, what is this", "Aria can you slow down", "area, can you repeat that", "hey Arya", "okay aria"]) assert.equal(said(text), true, text);
  for (const text of ["they went to Rio", "look at that ray", "hey Ryan did you see that", "I love Maya"]) assert.equal(said(text), false, text);
});
