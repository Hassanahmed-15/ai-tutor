import test from "node:test";
import assert from "node:assert/strict";
import { chosenVoiceId, chosenVoiceKey, cleanVoiceKey, voiceCatalog, withVoice } from "../voices";

/* Aria's voices (owner 2026-11-28): only configured voices are offered; a request's choice is held for it alone. */
const env = { GEMINI_TTS_VOICE: "voice_aria", GEMINI_TTS_VOICE_MINAHIL: "voice_minahil" };
// (the Minahil voice is the teacher Zara, lib/teachers.ts)

test("only voices with an id are offered, Aria first", () => {
  assert.deepEqual(voiceCatalog(env).map((v) => v.key), ["aria", "zara"]);
  assert.deepEqual(voiceCatalog({ GEMINI_TTS_VOICE: "voice_aria" }).map((v) => v.key), ["aria"]);
  assert.deepEqual(voiceCatalog({}), []);
});

test("a request's voice is its own; no choice or an unknown one is Aria's (her stored clips keep their paths)", async () => {
  assert.equal(chosenVoiceId(env), "voice_aria");
  assert.equal(withVoice("zara", () => chosenVoiceId(env)), "voice_minahil");
  assert.equal(withVoice("nobody", () => chosenVoiceKey(env)), "aria");
  assert.equal(withVoice(undefined, () => chosenVoiceId(env)), "voice_aria");
  // held across awaits, and not leaked to work outside it
  const inside = await withVoice("zara", async () => { await new Promise((r) => setTimeout(r, 5)); return chosenVoiceId(env); });
  assert.equal(inside, "voice_minahil");
  assert.equal(chosenVoiceId(env), "voice_aria");
  assert.equal(withVoice("zara", () => chosenVoiceKey({ GEMINI_TTS_VOICE: "voice_aria" })), "aria");
  assert.equal(cleanVoiceKey("Minahil "), "minahil");
  assert.equal(cleanVoiceKey("<script>"), undefined);
});

test("the teachers: Aria unchanged (no style), Zara and Kai each with a style; the planning card puts the remembered one first", async () => {
  const { teacherQuestion, teacherStyleLine, TEACHERS } = await import("../teachers");
  assert.equal(teacherStyleLine("aria"), "");
  assert.equal(teacherStyleLine(undefined), "");
  assert.match(teacherStyleLine("zara"), /FUNNY AND ENERGETIC/);
  assert.match(teacherStyleLine("kai"), /STRICT AND FOCUSED/);
  assert.deepEqual(TEACHERS.map((t) => t.name), ["Aria", "Zara", "Kai"]);
  const q = teacherQuestion(["aria", "zara", "kai"], "kai");
  assert.equal(q.question, "Who would you like to learn with?");
  assert.deepEqual(q.options.map((o) => o.value), ["kai", "aria", "zara"]);
  assert.match(q.options[0].description, /your teacher last time/);
  assert.deepEqual(teacherQuestion(["aria", "zara"]).options.map((o) => o.label), ["Aria", "Zara"]);
  // the voice catalogue is the teachers, each on its own voice
  assert.deepEqual(voiceCatalog({ GEMINI_TTS_VOICE: "a", GEMINI_TTS_VOICE_MINAHIL: "m", GEMINI_TTS_VOICE_HASSAN: "h" }).map((v) => `${v.key}:${v.voiceId}`), ["aria:a", "zara:m", "kai:h"]);
});
