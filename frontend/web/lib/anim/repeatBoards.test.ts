import test from "node:test";
import assert from "node:assert/strict";
import { asksToCompare, mathsNoRepeatRule, mergeRepeatedBoards } from "../canvas/repeatBoards";
import type { CanvasPlanBeat } from "../canvas/types";

// "The Proof of Prime Numbers" (2026-10-25), its boards' scripts as planned, shortened.
const PRIMES = [
  ["The route through Euclid's proof", "We will follow one surprising question: can a complete list of primes ever exist? First, we will build a supposedly complete list. Next, we will construct a new number from that list. Then, we will find the contradiction and reach the conclusion."],
  ["What a finite list assumes", "We begin by building the supposed complete list, because Euclid's argument needs something to challenge. A finite list has only a limited number of entries. The symbol n means the list has a final position, and p₁ through pₙ name the entries. Each entry is a prime, and the list claims that no prime exists outside it."],
  ["Multiplying every listed prime", "We now construct the challenge number by combining every listed prime. For the concrete list 2, 3, 5 and 7, multiply the entries to obtain 2 × 3 × 5 × 7 = 210. This product is divisible by every prime in the list, since each one appears as a factor. Adding 1 to this product gives N = 210 + 1 = 211."],
  ["The general construction of N", "We now generalise the concrete calculation, so the argument applies to any finite list. Multiply p₁, p₂, through pₙ, because every listed prime must affect the construction. Add 1 to that product, giving N = p₁ × p₂ × … × pₙ + 1. For 2, 3, 5 and 7, this general rule again gives N = 2 × 3 × 5 × 7 + 1 = 211."],
  ["The contradiction from a new prime", "We now complete the contradiction, using the fact that N must be divisible by a prime. N is not divisible by any pᵢ, because N mod pᵢ = 1 for every listed prime. Therefore, N must be divisible by some prime q not in the list. This contradicts the assumption that p₁, p₂, through pₙ contain all primes."],
  ["The infinite conclusion", "We now state Euclid's proof from its established steps. Assume that there are finitely many primes, listed as p₁, p₂, …, pₙ. Construct N = p₁ × p₂ × … × pₙ + 1. N is not divisible by any pᵢ because N mod pᵢ = 1. Therefore, N must be divisible by some prime q not in the list. This contradicts the assumption that the list contains all primes. Thus, there are infinitely many primes."],
];
const beats = (rows: string[][]): CanvasPlanBeat[] => rows.map(([title, script], i) => ({ id: `b${i + 1}`, title, brief: "", script, stage: "equation", objects: [], carry: [], inside: null, interaction: null, overview: false }) as unknown as CanvasPlanBeat);

test("a board that re-derives what earlier boards said is merged into the board before it; new boards stay", () => {
  const { beats: out, log } = mergeRepeatedBoards(beats(PRIMES));
  assert.deepEqual(out.map((b) => b.title), ["The route through Euclid's proof", "What a finite list assumes", "Multiplying every listed prime", "The general construction of N", "The contradiction from a new prime"], log.join(" | "));
  // The recital's one new sentence closes the board before it.
  assert.match(out.at(-1)!.script, /infinitely many primes/);
});

test("a lesson with no repetition is left exactly as planned, and a short last recap is kept", () => {
  const plain = beats([PRIMES[0], PRIMES[1], PRIMES[2], ["Summary", "So we assumed a finite list, built N and found a new prime."]]);
  const { beats: out, log } = mergeRepeatedBoards(plain);
  assert.equal(out.length, 4, log.join(" | "));
  assert.equal(out, plain);
});

test("the planner's rule asks for a side-by-side comparison only when the student asked for one", () => {
  assert.equal(asksToCompare(["Compare both"]), true);
  assert.equal(asksToCompare(["Concrete examples", "Balanced explanation"]), false);
  assert.match(mathsNoRepeatRule(true), /COMPARED/);
  assert.doesNotMatch(mathsNoRepeatRule(false), /COMPARED/);
  assert.match(mathsNoRepeatRule(false), /SAME board/);
});
