import test from "node:test";
import assert from "node:assert/strict";
import { heuristicChunks, iconForText } from "../dyslexiaChunking";

/**
 * The floor under the dyslexia track.
 *
 * These exist because the mode used to freeze: it read its lines from a map keyed by twelve demo
 * beat ids, so any generated lecture (`pdf-1`, `pdf-x2`, …) missed the lookup, the narration effect
 * returned early, and the lesson sat on beat one with no audio forever. `heuristicChunks` is what
 * guarantees a beat is always playable, so the properties asserted here are the ones the freeze fix
 * depends on.
 */

const GRAVITY =
  "Gravity is the attraction between any two masses, and the more mass an object has, the stronger " +
  "its pull. This is why you feel the Earth pulling you down but not the pull of a nearby building; " +
  "the Earth is simply far more massive.";

test("THE FREEZE FIX: any non-empty script yields playable lines", () => {
  for (const level of ["simplest", "simple", "standard"] as const) {
    const chunks = heuristicChunks(GRAVITY, level);
    assert.ok(chunks.length > 0, `${level} produced nothing`);
    for (const chunk of chunks) {
      assert.ok(chunk.text.trim().length > 0);
      assert.ok(chunk.icon.length > 0, "an empty icon renders as a gap");
    }
  }
});

test("no orphan lines — the 'Has.' bug", () => {
  // Counting words alone used to emit a line reading only "Has." after "…an object.", which is
  // harder to read than the sentence it came from.
  for (const level of ["simplest", "simple", "standard"] as const) {
    for (const chunk of heuristicChunks(GRAVITY, level)) {
      const words = chunk.text.split(/\s+/).length;
      assert.ok(words > 2, `orphan line at ${level}: ${JSON.stringify(chunk.text)}`);
    }
  }
});

test("lines do not end mid-phrase on a word that cannot close one", () => {
  /**
   * Deliberately narrower than "any function word". An auxiliary CAN legitimately end a line when
   * that is where the source clause ended — "And the more mass an object has." is exactly what the
   * writer wrote, and forcing a different break there would produce a worse line. What must never
   * appear is a line ending on a word that leaves the reader mid-phrase: an article, a preposition,
   * or a conjunction promising more.
   */
  const midPhrase = /\b(the|a|an|and|but|or|of|to|in|on|at|by|for|with|from|into|than|as)\.$/i;
  for (const level of ["simplest", "simple", "standard"] as const) {
    for (const chunk of heuristicChunks(GRAVITY, level)) {
      assert.ok(!midPhrase.test(chunk.text), `mid-phrase end at ${level}: ${JSON.stringify(chunk.text)}`);
    }
  }
});

test("lower levels show less, not merely smaller", () => {
  const simplest = heuristicChunks(GRAVITY, "simplest");
  const standard = heuristicChunks(GRAVITY, "standard");
  const words = (chunks: { text: string }[]) =>
    chunks.reduce((sum, c) => sum + c.text.split(/\s+/).length, 0);
  assert.ok(
    words(simplest) <= words(standard),
    "the simplest level must not present more text than the standard one",
  );
});

test("a script with no sentence punctuation still produces lines", () => {
  const chunks = heuristicChunks("just some words with no full stop here at all", "simplest");
  assert.ok(chunks.length > 0);
});

test("empty input yields no lines rather than a blank line", () => {
  assert.deepEqual(heuristicChunks("", "simple"), []);
  assert.deepEqual(heuristicChunks("   ", "standard"), []);
});

test("a very long script is capped so it never becomes a wall of text", () => {
  const long = Array.from({ length: 60 }, (_, i) => `This is sentence number ${i} about the topic.`).join(" ");
  assert.ok(heuristicChunks(long, "simplest").length <= 5);
  assert.ok(heuristicChunks(long, "standard").length <= 12);
});

test("icons follow what a line is about, and never come back empty", () => {
  assert.equal(iconForText("The sunlight powers it"), "☀️");
  assert.equal(iconForText("Water travels up the roots"), "💧");
  assert.ok(iconForText("Nothing in particular here").length > 0);
});
