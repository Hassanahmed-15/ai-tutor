import test from "node:test";
import assert from "node:assert/strict";
import { checkNumbers, toExpr } from "../canvas/numberCheck";

test("the audited wrong answer is caught: −(8π)²(0.060) is −37.9, not −121", () => {
  const issues = checkNumbers("We obtain x = 0.060 metres, v = 0 and a = −(8π)²(0.060) = −121 metres per second squared, approximately.");
  assert.equal(issues.length, 1);
  assert.ok(Math.abs(issues[0].computed + 37.9) < 0.1);
});

test("correct worked numbers from real lectures pass", () => {
  for (const ok of [
    "Since ω = 10π radians per second, x = 0.0566 metres and a = −(10π)²(0.0566) = −56 metres per second squared, approximately.",
    "|v| = 4.0√(0.120² − 0.072²) = 0.384 metres per second, so v = ±0.384 metres per second.",
    "f = 12/6.0 = 2.0 hertz, T = 1/f = 0.500 seconds and ω = 2π(2.0) = 12.6 radians per second.",
    "a = −(10π)² × 0.050 ≈ −49.3 m s⁻², and 3.0 × 10⁸ m/s is the speed of light.",
    "so a = g sin 30° = 9.8 × sin 30° = 4.9 m/s².",
    "dy/dx = 4u³(6x²) = 24x²(2x³ − 5)³",
    "The volume ratio is 2 : 1, and 20 cm³ of hydrogen = 2 × 10 cm³.",
  ]) assert.deepEqual(checkNumbers(ok), [], ok);
});

test("printed maths becomes evaluator syntax", () => {
  assert.equal(toExpr("−(8π)²(0.060)"), "-1*(8*pi)^(2)*(0.060)", "a leading minus negates the whole power");
  assert.equal(toExpr("4.0√(0.120² − 0.072²)"), "4.0*sqrt(0.120^(2) - 0.072^(2))");
});

test("a wrong simple product is caught; a stated value with no calculation is not judged", () => {
  assert.equal(checkNumbers("Force = 2.0 × 9.8 = 21 N").length, 1);
  assert.deepEqual(checkNumbers("x = 0.060 m and T = 0.25 s"), []);
});

test("a stated percentage is the fraction times 100", async () => {
  const { checkNumbers } = await import("../canvas/numberCheck");
  assert.deepEqual(checkNumbers("420/600 = 70% of students; 3/4 = 75 %"), []);
  assert.equal(checkNumbers("420/600 = 80% of students").length, 1);
});

test("thousands separators are part of the number", async () => {
  const { checkNumbers } = await import("../canvas/numberCheck");
  assert.deepEqual(checkNumbers("Investment = 1,100 + (−150) = 950 billion dollars; 1,000,000 / 4 = 250,000"), []);
  assert.equal(checkNumbers("−250 + 900 = 750 billion").length, 1);
});

test("standard form: the stated power of ten counts, and 10^-11 is one exponent", async () => {
  const { checkNumbers, toExpr } = await import("../canvas/numberCheck");
  const { evalExpr } = await import("../canvas/expr");
  assert.ok(Math.abs(evalExpr(toExpr("6.67 × 10^-11"), {}) - 6.67e-11) < 1e-15);
  assert.deepEqual(checkNumbers("F_g = (6.67 × 10^-11)(4.0)(3.0)/(2.0)^2 = 2.00 × 10^-10 N"), []);
  assert.deepEqual(checkNumbers("(6.67 × 10⁻¹¹)(4.0)(3.0)/(2.0)² = 2.00 × 10⁻¹⁰ N"), []);
  assert.deepEqual(checkNumbers("g = (6.67 × 10^-11)(6.0 × 10^24)/(6.4 × 10^6)^2 = 9.77 N/kg"), []);
  assert.equal(checkNumbers("(6.67 × 10^-11)(4.0)(3.0)/(2.0)^2 = 2.00 × 10^-9 N").length, 1);
  assert.deepEqual(checkNumbers("8.0 × 10^-10 / 4 = 2.0 × 10^-10 N"), []);
});

test("a chain of working is checked link by link, not against the next link's first number", async () => {
  const { checkNumbers } = await import("../canvas/numberCheck");
  assert.deepEqual(checkNumbers("Check x = 2: 4(4) − 7(2) − 2 = 16 − 14 − 2 = 0."), []);
  assert.deepEqual(checkNumbers("x = (7 ± 9)/8 and 3 × 4 − 2 = 12 − 2 = 10"), []);
  assert.equal(checkNumbers("3 × 4 − 2 = 12 − 2 = 11").length, 1);
  assert.equal(checkNumbers("3 × 4 − 2 = 13 − 2 = 11").length, 1, "only the first link is wrong");
});
