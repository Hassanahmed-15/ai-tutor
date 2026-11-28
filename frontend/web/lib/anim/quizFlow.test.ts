import test from "node:test";
import assert from "node:assert/strict";
import { inCheckBlock, isThinkPrompt, tapHotspots, veiledBlocks } from "../canvas/quizFlow";
import { checkCardBoards, practiceSpacing, spaceCheckCards } from "../canvas/checkCardPlan";
import { PRACTICE_QUESTION, practiceValue, sanitizeTeachingQuestions, teachingChoices, teachingSettings, withPracticeQuestion, type TeachingQuestion } from "../teachingQuestions";
import { uniquePartTitles } from "../outlineTitles";
import { slideReview } from "../testReview";
import { planningWaitLine } from "../planningWait";
import type { BoardBlock } from "../canvas/blocks";
import type { CanvasBoardSpec, CanvasPlanBeat } from "../canvas/types";

/* The owner's QA brief, 2026-11-28: quizzes and lesson flow. */

const beat = (over: Partial<CanvasPlanBeat> = {}) => ({ title: "b", script: "s", stage: "flow", objects: [], interaction: null, overview: false, ...over }) as unknown as CanvasPlanBeat;
const plan = (n: number) => Array.from({ length: n }, () => beat());
const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);

test("the Practice answer sets how many quick questions: none 0, a few ≈ 1 per 3 boards, lots ≈ 1 per 2", () => {
  for (const n of [6, 9, 12, 16]) {
    assert.equal(checkCardBoards(plan(n), false, "none").size, 0);
    const some = checkCardBoards(plan(n), false, "some").size;
    const lots = checkCardBoards(plan(n), false, "lots").size;
    assert.equal(some, Math.floor(n / 3), `some, ${n} boards`);
    assert.equal(lots, Math.floor(n / 2), `lots, ${n} boards`);
  }
  // A 16-board lesson with "A few" is no longer capped at three.
  assert.deepEqual(sorted(checkCardBoards(plan(16), false, "some")), [2, 5, 8, 11, 14]);
  assert.deepEqual(sorted(checkCardBoards(plan(8), false, "lots")), [1, 3, 5, 7]);
  // Not asked: the old default, every third board and at most three.
  assert.deepEqual(sorted(checkCardBoards(plan(16), false)), [2, 5, 8]);
  assert.deepEqual(practiceSpacing(undefined, 16), { every: 3, most: 3 });
  // A strict PDF lesson still gets none.
  assert.equal(checkCardBoards(plan(9), true, "lots").size, 0);
});

test("the player keeps the cards a lesson was written with (lots = every 2 boards); only an old card-on-every-board lecture is thinned", () => {
  const card = { kind: "quiz" as const, question: "q", check: true, options: [{ text: "a", correct: true, feedback: "f" }, { text: "b", correct: false, feedback: "g" }] };
  const spec = (withCard: boolean) => ({ heading: "h", ...(withCard ? { interaction: card } : {}) }) as unknown as CanvasBoardSpec;
  const lots = Array.from({ length: 10 }, (_, i) => ({ key: `b${i}`, spec: spec(i % 2 === 1) }));
  assert.deepEqual(spaceCheckCards(lots).map((p) => Boolean(p.spec.interaction)), lots.map((p) => Boolean(p.spec.interaction)));
  const old = Array.from({ length: 12 }, (_, i) => ({ key: `b${i}`, spec: spec(true) }));
  assert.equal(spaceCheckCards(old).filter((p) => p.spec.interaction).length, 3);
});

test("a Practice question is always on the card, for every subject", () => {
  // History's card: What you know, Depth, Focus, Examples — no Practice tab (the model wrote none).
  const history: TeachingQuestion[] = sanitizeTeachingQuestions({ questions: [
    { id: "depth", kind: "depth", header: "Depth", question: "How deeply should we examine the causes?", options: [{ label: "Overview", value: "overview" }, { label: "Deep", value: "deep" }] },
    { id: "focus", kind: "focus", header: "Focus", question: "Which causes?", options: [{ label: "Debt", value: "debt" }, { label: "Bread", value: "bread" }, { label: "Ideas", value: "ideas" }] },
    { id: "style", kind: "style", header: "Examples", question: "How should we explore them?", options: [{ label: "Mixed", value: "mixed" }, { label: "Stories", value: "practical" }] },
  ] });
  const withPractice = withPracticeQuestion(history);
  assert.deepEqual(withPractice.map((q) => q.kind), ["depth", "focus", "style", "practice"]);
  assert.deepEqual(withPractice[3].options.map((o) => o.value), ["none", "some", "lots"]);
  // No questions at all (the call failed): still asked.
  assert.deepEqual(withPracticeQuestion([]).map((q) => q.id), [PRACTICE_QUESTION.id]);
  // Four already: it takes the place of the least useful one, so the card stays at four.
  const four = [...history, { id: "other", kind: "other" as const, header: "Proof", question: "Proof or intuition?", options: [{ label: "Proof" }, { label: "Intuition" }] }];
  const kept = withPracticeQuestion(four);
  assert.equal(kept.length, 4);
  assert.ok(kept.some((q) => q.kind === "practice") && !kept.some((q) => q.kind === "other"));
  // The model's own practice question keeps its topic wording; odd values are read by their words.
  const own = withPracticeQuestion([{ id: "checks", kind: "practice", header: "Practice", question: "How many opportunity-cost questions?", options: [{ label: "No questions", value: "skip" }, { label: "A couple", value: "a-few" }, { label: "After every board", value: "often" }] }]);
  assert.equal(own[0].question, "How many opportunity-cost questions?");
  assert.deepEqual(own[0].options.map((o) => o.value), ["none", "some", "lots"]);
  // And the answer reaches the settings the worker reads, a typed one too.
  assert.equal(teachingSettings(teachingChoices(withPractice, { practice: ["A few"] })).practice, "some");
  assert.equal(teachingSettings([{ kind: "practice", question: "How many?", answer: "loads please", values: [] }]).practice, "lots");
  assert.equal(practiceValue({ label: "None", description: "Just teach me" }), "none");
});

test("think prompts get thinking time; rhetorical questions do not", () => {
  assert.ok(isThinkPrompt("Pause and think: what is forgone for one more B?"));
  assert.ok(isThinkPrompt("Check yourself: why did debt become socially explosive?"));
  assert.ok(isThinkPrompt("Predict what happens to the price."));
  assert.ok(isThinkPrompt("Think: which side should the x go on?"));
  assert.ok(!isThinkPrompt("What does this mean for the firm?"));
  assert.ok(!isThinkPrompt("The answer is 2 units of A."));
  const blocks = [{ id: "c1", section_id: "b3", kind: "callout", callout: "check", s: 5, e: 5, board_text: "What is forgone?", spoken_text: "" }] as BoardBlock[];
  assert.ok(inCheckBlock(blocks, 5));
  assert.ok(!inCheckBlock(blocks, 6));
});

test("while a quick question is open, the board's check box, its answer and any line that says the right option are covered", () => {
  const b = (id: string, kind: BoardBlock["kind"], text: string, extra: Partial<BoardBlock> = {}) => ({ id, section_id: "s", kind, s: 0, e: 0, board_text: text, spoken_text: "", ...extra }) as BoardBlock;
  const blocks = [
    b("h", "heading", "Debt, Taxes, and Bread Prices"),
    b("p1", "paragraph", "Poor harvests in 1787 and 1788 reduced grain supplies, so bread prices soared."),
    b("c", "callout", "Check yourself: why did debt become socially explosive?", { callout: "check" }),
    b("a", "paragraph", "Because the burden fell on ordinary people, so taxes and bread were unaffordable."),
    b("p2", "paragraph", "Ordinary people faced taxes and unaffordable bread."),
    b("p3", "paragraph", "The Estates-General met in 1789."),
  ];
  const veiled = veiledBlocks(blocks, "Ordinary people faced taxes and unaffordable bread.");
  assert.deepEqual([...veiled].sort(), ["a", "c", "p2"]);
  assert.equal(veiledBlocks(undefined, "x").size, 0);
});

test("tap targets are the part's area, at least a finger wide, and never overlap", () => {
  const min = 96;
  const boxes = tapHotspots([
    { center: { x: 100, y: 100 }, region: { x: 95, y: 95, w: 10, h: 10 } },
    { center: { x: 160, y: 100 } },
    { center: { x: 600, y: 300 }, region: { x: 520, y: 260, w: 160, h: 80 } },
    { center: null },
  ], min, { x: 0, y: 0, w: 1000, h: 560 });
  const [a, b, c, d] = boxes;
  assert.equal(d, null);
  for (const r of [a!, b!, c!]) assert.ok(r.w >= min * 0.6 && r.h >= min * 0.6, "never smaller than a fingertip after trimming");
  assert.ok(c!.w >= 160 && c!.h >= min, "a big part keeps its whole area");
  // The two near parts are split down the middle, so each tap means one part.
  assert.ok(a!.x + a!.w <= b!.x + 0.001, "no overlap");
  // Clamped inside the board.
  const edge = tapHotspots([{ center: { x: 5, y: 5 } }], min, { x: 0, y: 0, w: 1000, h: 560 })[0]!;
  assert.ok(edge.x >= 0 && edge.y >= 0);
});

test("no two plan parts share a title", () => {
  const out = uniquePartTitles([
    { title: "Opportunity Cost", caption: "What you give up when you choose" },
    { title: "Scarcity", caption: "Limited resources" },
    { title: "Opportunity cost", caption: "Compare the costs of two choices, then pick" },
    { title: "Opportunity Cost", caption: "" },
  ]);
  const titles = out.map((p) => p.title);
  assert.equal(new Set(titles.map((t) => t.toLowerCase())).size, titles.length, titles.join(" | "));
  assert.equal(titles[0], "Opportunity Cost");
  assert.equal(titles[2], "Compare the Costs of Two Choices");
  assert.match(titles[3], /^Opportunity Cost \(part \d\)$/);
  const fine = [{ title: "A", caption: "" }, { title: "B", caption: "" }];
  assert.deepEqual(uniquePartTitles(fine), fine);
});

test("Review slide N: Aria re-explains the slip over the finished board", () => {
  const q = { id: "q1", beatId: "b3", prompt: "Why did debt become socially explosive?", oralPhrasing: "", rubric: { keyPoints: ["burden on the Third Estate"], modelAnswer: "The crown's debt was paid by taxing ordinary people while bread prices soared." } };
  const r = { id: "q1", status: "misconception" as const, correct: false, feedback: "Not quite.", pointsEarned: 0, pointsAvailable: 2, missingKeyPoints: [], misconception: "the nobles paid most of the taxes" };
  const review = slideReview(2, q, r);
  assert.equal(review.index, 2);
  assert.match(review.say, /^Let's look at this board again/);
  assert.match(review.say, /The slip in your answer: the nobles paid most of the taxes\./);
  assert.match(review.say, /taxing ordinary people/);
  assert.equal(review.note, "the nobles paid most of the taxes");
  const partial = slideReview(0, q, { ...r, status: "partial", misconception: undefined, missingKeyPoints: ["burden on the Third Estate"] });
  assert.match(partial.say, /What your answer missed: burden on the Third Estate/);
});

test("the planning wait shows the real clock and the usual range, and says when it runs long", () => {
  assert.equal(planningWaitLine(45_000), "0:45 · planning usually takes 2–4 min");
  assert.equal(planningWaitLine(150_000, 1, 3), "2:30 · first boards 1 of 3 ready · usually 2–4 min in all");
  assert.match(planningWaitLine(6 * 60_000), /^6:00 · taking longer than usual/);
  assert.equal(planningWaitLine(NaN), "");
});
