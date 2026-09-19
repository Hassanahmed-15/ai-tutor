/**
 * The bench's numbers decide which model ships, so the scoring has to be wrong in known directions
 * or not at all. These tests pin the two judgements that are easy to get backwards: a contract
 * violation must cost a model even when its drawing is pretty, and a subject the vision critic
 * cannot judge must not be scored as if it failed.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { compositeScore, scoreSlideSource, stripCodeFences } from "../slidebench/scoring";
import { slidePrompt, SLIDE_BENCH_CASES } from "../slidebench/cases";
import { SLIDE_BENCH_MODELS, apiKeyFingerprint, slideBenchCost } from "../slidebench/models";

const GOOD = `
export default function Animation({ progress }) {
  const rise = Math.min(1, progress * 2);
  const fade = progress > 0.5 ? 1 : 0;
  const x = 100 + progress * 300;
  const r = 20 + progress * 5;
  return (
    <svg viewBox="0 0 1000 560">
      <defs><linearGradient id="g" /></defs>
      <rect x={x} y={rise * 10} width="80" height="40" />
      <circle cx={x} cy={200} r={r} opacity={fade} />
      <path d="M0 0 L10 10" />
      <line x1="0" y1="0" x2="5" y2="5" />
      <text x="10" y="20">Chloroplast</text>
      <text x="10" y="40">Water</text>
    </svg>
  );
}
`;

test("a conforming component compiles and registers its animated values", () => {
  const scores = scoreSlideSource(GOOD, false);
  assert.equal(scores.compiles, true, scores.issues.join("; "));
  assert.equal(scores.labelCount, 2);
  assert.ok(scores.progressDrivenValues >= 4, `expected several progress-driven values, got ${scores.progressDrivenValues}`);
  assert.ok(scores.shapeVariety >= 5);
});

test("a timer is a correctness failure, however good the drawing looks", () => {
  // The caller scrubs progress backwards; anything on its own clock desynchronises from narration.
  const scores = scoreSlideSource(GOOD.replace("const fade =", "setInterval(() => {}, 16); const fade ="), false);
  assert.deepEqual(scores.forbiddenClockUses, ["setInterval"]);
  assert.equal(scores.compiles, false);
});

test("a component that never reads progress is reported as unanimated", () => {
  const still = `export default function Animation() { return (<svg viewBox="0 0 1000 560"><text>x</text></svg>); }`;
  const scores = scoreSlideSource(still, false);
  assert.equal(scores.compiles, false);
  assert.ok(scores.issues.some((i) => i.includes("progress")));
});

test("an empty response is a failure, not a zero-variety success", () => {
  const scores = scoreSlideSource("", false);
  assert.equal(scores.compiles, false);
  assert.equal(scores.sourceChars, 0);
});

test("an unjudgeable abstract subject is not scored as if it failed the vision check", () => {
  // Abstract boards are deliberately never shown to the shape critic. Treating null as 0 would
  // punish the test case rather than the model.
  const scores = scoreSlideSource(GOOD, false);
  const abstained = compositeScore(scores, null);
  const failed = compositeScore(scores, 1);
  assert.ok(abstained > failed, `abstain ${abstained} should outrank a real failure ${failed}`);
});

test("a broken board scores zero no matter how it is judged by eye", () => {
  const broken = scoreSlideSource("export default function Animation() {", false);
  assert.equal(compositeScore(broken, 5), 0);
});

test("a better vision score raises the composite, all else equal", () => {
  const scores = scoreSlideSource(GOOD, false);
  assert.ok(compositeScore(scores, 5) > compositeScore(scores, 3));
});

test("markdown fences are stripped, and the fact is remembered", () => {
  // Fence compliance is reported separately: an unstripped fence is a syntax error, but scoring a
  // model's DRAWING on its formatting would put instruction-following in the wrong column.
  const wrapped = "```jsx\nexport default function Animation() {}\n```";
  const { code, hadFences } = stripCodeFences(wrapped);
  assert.equal(hadFences, true);
  assert.equal(code, "export default function Animation() {}");
  assert.equal(stripCodeFences("export default x").hadFences, false);
});

test("every model gets a byte-identical prompt for a given case", () => {
  // The entire comparison rests on this. If prompts ever diverge per provider, the bench is
  // measuring prompts, not models.
  const [first] = SLIDE_BENCH_CASES;
  const prompts = SLIDE_BENCH_MODELS.map(() => slidePrompt(first));
  assert.equal(new Set(prompts).size, 1);
  assert.ok(prompts[0].includes(first.teachingPoint));
});

test("the registry has at least six contestants and includes Gemini 3.8 Flash", () => {
  assert.ok(SLIDE_BENCH_MODELS.length >= 6);
  assert.ok(SLIDE_BENCH_MODELS.some((m) => m.id === "gemini-3.8-flash"));
  assert.ok(SLIDE_BENCH_MODELS.some((m) => m.provider === "gemini"));
  assert.ok(SLIDE_BENCH_MODELS.some((m) => m.provider === "openai"));
});

test("cost is priced per model, so two models never share a price by accident", () => {
  const luna = SLIDE_BENCH_MODELS.find((m) => m.id === "gpt-5.6-luna")!;
  const sol = SLIDE_BENCH_MODELS.find((m) => m.id === "gpt-5.6-sol")!;
  assert.ok(slideBenchCost(sol, 1000, 1000) > slideBenchCost(luna, 1000, 1000));
  assert.equal(slideBenchCost(luna, 1_000_000, 0), luna.price.input);
});

test("the key fingerprint identifies a key without revealing it", () => {
  const secret = "sk-proj-abcdefghijklmnop";
  const id = apiKeyFingerprint(secret);
  assert.ok(!secret.includes(id.replace("k-", "")) || id.length < 10);
  assert.equal(id, apiKeyFingerprint(secret), "same key must fingerprint the same");
  assert.notEqual(id, apiKeyFingerprint("sk-proj-different"));
  assert.equal(apiKeyFingerprint(undefined), "absent");
});

test("hitting the token ceiling is reported as truncation, not as bad code", () => {
  // Measured: Gemini 3.5 Flash spent 7,677 of 8,000 tokens thinking and had ~300 left to write
  // the component. Calling that "writes broken code" would be a lie about the model.
  const cut = scoreSlideSource("export default function Animation({ progress }) { return (<svg", false, {
    outputTokens: 7_996,
    maxTokens: 8_000,
  });
  assert.equal(cut.likelyTruncated, true);
  assert.ok(cut.issues.some((i) => i.includes("ceiling")));
});

test("a short answer well inside the budget is not called truncated", () => {
  const fine = scoreSlideSource(GOOD, false, { outputTokens: 900, maxTokens: 16_000 });
  assert.equal(fine.likelyTruncated, false);
  assert.equal(fine.compiles, true);
});
