/**
 * The RSA signing board (2026-11-11): "65^2753" set as 65² 753, "mod" dropped so a row read "n = 65^2753",
 * notes with the wrong value (2200 for 588); and "slow down" said to Aria changing nothing.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { equationTerms, malformedRow, plainTex, writtenEquations } from "../canvas/equationRepair";
import { noteTex } from "../canvas/mathNotes";
import { modPowProblem } from "../canvas/csLessons";
import { speedRequestOf } from "../useGeminiLiveTutor";

test("a modular power is one expression, never cut at mod", () => {
  const said = "To sign message m = 65, so s = m^d mod n = 65^2753 mod 3233 = 588.";
  const eqs = writtenEquations(said);
  assert.ok(eqs.some((e) => e.includes("65^2753 mod 3233 = 588")), eqs.join(" | "));
  assert.ok(!eqs.some((e) => /^n = 65/.test(e)), eqs.join(" | "));
  assert.deepEqual(equationTerms("65^2753 mod 3233 = 588"), ["65^2753", "mod", "3233", "=", "588"]);
  assert.equal(malformedRow(["65^2753", "mod", "3233", "=", "588"]), false);
});

test("a power of several digits is one superscript, and mod is the operator", () => {
  assert.equal(plainTex("65^2753"), "65^{2753}");
  assert.equal(plainTex("mod"), "\\bmod");
  const tex = noteTex("s = 65^2753 mod 3233 = 588") ?? "";
  assert.ok(tex.includes("65^{2753}") && tex.includes("\\bmod"), tex);
});

test("every a^b mod n = r is computed", () => {
  const wrong = modPowProblem(["s = 65^2753 mod 3233 = 2200", "m' = 2200^17 mod 3233 = 65"]) ?? "";
  assert.match(wrong, /65\^2753 mod 3233 is 588, not 2200/);
  assert.match(wrong, /2200\^17 mod 3233 is 2668, not 65/);
  assert.equal(modPowProblem(["s = 65^2753 mod 3233 = 588", "588^17 mod 3233 = 65", "c = 65¹⁷ mod 3233 = 2790"]), null);
  assert.equal(modPowProblem(["Encrypt with the public key"]), null);
});

test("asking Aria to slow down or speed up is recognised", () => {
  for (const said of ["Can you slow down?", "Arya, you're going too fast", "Can you explain me this concept slowly?", "slower please", "slow it down"]) {
    assert.equal(speedRequestOf(said), "slower", said);
  }
  for (const said of ["Can you speed up?", "go faster", "this is too slow"]) assert.equal(speedRequestOf(said), "faster", said);
  for (const said of ["What is a pipeline hazard?", "Explain the fetch stage", "Why is a load slow to return?"]) assert.equal(speedRequestOf(said), null, said);
});

test("a unit after a number is set upright", () => {
  const tex = noteTex("5 × 2 ns = 10 ns") ?? "";
  assert.ok(tex.includes("\\text{ns}") && !/\dns/.test(tex), tex);
});
