import test from "node:test";
import assert from "node:assert/strict";
import {
  absoluteClaim, applySentenceRewrite, boardWorkingLines, currenciesIn, fragmentSentences, isBareArithmetic, lessonReadability,
  mixedCurrency, overusedTerms, rateUnitClash, readability, scriptIssues, workingLineIssues,
} from "../canvas/wordingChecks";
import { spokenBoardCheck, spokenBoardLog } from "../canvas/spokenBoardCheck";
import { applyExplanationFixes, checkExplanations, EXPLANATION_CHECK_PROMPT } from "../canvas/explanationCheck";
import { acceptProofread, proofread, PROOFREAD_PROMPT } from "../text/proofread";
import { testWordingIssues, testWordingRule, testWordingTarget } from "../testWording";
import { applyMentions, MENTION_PROMPT } from "../canvas/labelMentions";
import { buildTeachingPolicy, isNovice, NOVICE_READING_GRADE, NOVICE_SENTENCE_WORDS, NOVICE_WORDS_LINE, policyForPlanner, policyForWriter } from "../teachingPolicy";
import type { StudentCard } from "../studentCard";
import type { CanvasBoardSpec } from "../canvas/types";

/*
 * THE WORDS A BEGINNER HEARS (owner QA brief, 2026-11-28). The fixture sentences below are taken from saved QA
 * lessons; they are test data only — no check, prompt or route names a topic, word or example.
 */

/* ── reading level ───────────────────────────────────────────────────────────────────────── */

const HARD = "This created resentment because economic importance did not bring equal political or social standing. The mechanism was direct: unequal status produced unequal obligations, and unequal obligations weakened loyalty to the old order.";
const PLAIN = "This made people angry. They paid most of the taxes. But they had little say in how the country was run. So they stopped trusting the old system.";

test("a hard sentence is caught above a beginner's grade, the plain version passes", () => {
  const novice = { grade: NOVICE_READING_GRADE, sentenceWords: NOVICE_SENTENCE_WORDS };
  assert.ok(readability(HARD).grade > NOVICE_READING_GRADE + 1, `hard reads at ${readability(HARD).grade}`);
  const issues = scriptIssues(HARD, novice);
  assert.ok(issues.some((i) => /reads at grade/.test(i)));
  assert.ok(issues.some((i) => /more than 15 words/.test(i)), "the second sentence is 19 words");
  assert.ok(readability(PLAIN).grade <= NOVICE_READING_GRADE + 1, `plain reads at ${readability(PLAIN).grade}`);
  assert.deepEqual(scriptIssues(PLAIN, novice), []);
});

test("readability reports the longest sentence and which run over", () => {
  const r = readability("One two three. One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen.", 15);
  assert.equal(r.maxSentenceWords, 16);
  assert.deepEqual(r.long, [1]);
});

/* ── one term again and again ───────────────────────────────────────────────────────────── */

test("a term said a dozen times is overused; a name and the lesson's own subject are not, lesson-wide", () => {
  const boards = [
    "The value given up is forgone. Forgone means not taken. You chose one thing, so the other is forgone.",
    "Forgone income is money you did not earn. Forgone time is time spent elsewhere. Each forgone option has a value.",
    "The forgone choice matters. We count what is forgone. The forgone value is the cost.",
    "Here is one more forgone case.",
  ];
  const over = overusedTerms(boards, ["Choices", "Income", "Value", "Cases"], { topic: "Choices and costs" });
  const t = over.find((x) => x.term === "forgone");
  assert.ok(t, "the repeated term is found");
  assert.equal(t!.count, 10);
  assert.deepEqual(t!.perBoard, [3, 3, 3, 1]);
  // A name written with capitals (two named groups), and the lesson's subject word: never jargon lesson-wide.
  const names = Array.from({ length: 8 }, () => "The Third Estate paid more than the First Estate.");
  assert.equal(overusedTerms(names, ["Estate system"]).length, 0);
  const subject = Array.from({ length: 4 }, () => "An equation is balanced. Solve the equation.");
  assert.equal(overusedTerms(subject, ["Equations"], { topic: "Solving equations" }).filter((x) => x.term === "equation").length, 0);
});

test("the rewrite is told which term to plain-word on which board", () => {
  const boards = Array.from({ length: 3 }, () => "Allocation means sharing out. Allocation decides use. Allocation is a choice. Allocation matters.");
  const over = overusedTerms(boards);
  const issues = scriptIssues(boards[0], { grade: 8, sentenceWords: 20 }, { overused: over, boardIndex: 0, lessonText: boards.join(" ") });
  assert.ok(issues.some((i) => /"allocation" is said 12 times in the lesson \(4 here\)/.test(i)), issues.join(" | "));
});

/* ── natural sentences ──────────────────────────────────────────────────────────────────── */

test("fragments: a dash start, a pasted heading capital, a number with no verb", () => {
  const lesson = "France faced many causes of unrest. Each choice has a cost. A choice means picking one use.";
  assert.equal(fragmentSentences("—and this part here is the Causes?", "Causes of unrest", lesson).length, 1);
  assert.match(fragmentSentences("It showed many things, and this part here is the Causes?", "Causes of unrest", lesson)[0].why, /capitalised mid-sentence/);
  assert.equal(fragmentSentences("Part of 2%.", "", lesson).length, 1);
  assert.equal(fragmentSentences("Every group makes a Choice, giving up its next best option.", "Comparing", lesson).length, 1);
  // Names, colons and working are left alone.
  assert.equal(fragmentSentences("The First and Second Estates were exempt from most direct taxes.", "Estates", "the estates").length, 0);
  assert.equal(fragmentSentences("Third, assess the impact: Prices rose.", "", "prices").length, 0);
  assert.equal(fragmentSentences("So x = 5.", "", "").length, 0);
  assert.equal(fragmentSentences("It paid 98%.", "", "").length, 0);
});

/* ── currency and units ─────────────────────────────────────────────────────────────────── */

test("a lesson that switches currency is caught; one about exchanging currencies is not", () => {
  const boards = ["A phone costs 8,000 rupees.", "That leaves 2,000 rupees.", "Work pays 10 dollars per hour."];
  const mixed = mixedCurrency(boards);
  assert.deepEqual(mixed, { main: "rupees", others: ["dollars"], boards: [2] });
  assert.ok(scriptIssues(boards[2], { grade: 9, sentenceWords: 20 }, { boardIndex: 2, currency: mixed }).some((i) => /lesson's money is rupees/.test(i)));
  assert.equal(mixedCurrency(["The exchange rate is 280 rupees to one dollar.", "So 10 dollars buys 2,800 rupees."]), null);
  assert.equal(mixedCurrency(["It costs $5.", "It costs $8."]), null);
  assert.equal(currenciesIn("It weighs 5 pounds.").size, 0, "a bare 'pounds' is a weight");
});

test("a rate that changes its unit inside a calculation", () => {
  assert.match(rateUnitClash("The forgone income is 10 dollars multiplied by 4 hours, which equals 40 dollars per day.") ?? "", /per day.*hours/);
  assert.equal(rateUnitClash("10 dollars per hour times 4 hours equals 40 dollars."), null);
  assert.equal(rateUnitClash("8 hours a day at 5 dollars per hour gives 40 dollars per day."), null);
  assert.equal(rateUnitClash("She earns 40 dollars per day."), null, "no calculation");
});

/* ── lines of working ───────────────────────────────────────────────────────────────────── */

test("bare arithmetic needs a label; algebra and labelled lines do not", () => {
  assert.equal(isBareArithmetic("50 − 40 = 10"), true);
  assert.equal(isBareArithmetic("4x = 16"), false);
  assert.equal(isBareArithmetic("Net benefit: 50 − 40 = 10"), false);
  assert.equal(workingLineIssues([{ text: "50 − 40 = 10" }]).length, 1);
  assert.deepEqual(workingLineIssues([{ text: "50 − 40 = 10", label: "net benefit" }]), []);
  assert.equal(workingLineIssues([{ text: "8,000 rupees − 10 dollars = …", label: "left" }]).filter((i) => /mixes/.test(i)).length, 1);
});

const equationBoard = (caption?: string): CanvasBoardSpec => ({
  heading: "Net benefit",
  notes: [{ id: "n1", text: "Leisure worth 50", s: 0 }],
  stage: {
    kind: "equation",
    tokens: [{ id: "a", text: "50", tex: "50" }, { id: "m", text: "−", tex: "-" }, { id: "b", text: "40", tex: "40" }, { id: "e", text: "=", tex: "=" }, { id: "c", text: "10", tex: "10" }],
    steps: [{ s: 1, order: ["a", "m", "b", "e", "c"], ...(caption ? { caption } : {}) }],
  },
  cues: [],
} as unknown as CanvasBoardSpec);

test("an equation board's rows are read with their caption or the note on their sentence", () => {
  assert.equal(workingLineIssues(boardWorkingLines(equationBoard())).length, 1, "no caption, no note on sentence 1");
  assert.deepEqual(workingLineIssues(boardWorkingLines(equationBoard("net benefit"))), []);
});

/* ── claims with no exceptions ──────────────────────────────────────────────────────────── */

test("an all-or-nothing claim is marked for the fact-check; a measured one is not", () => {
  assert.equal(absoluteClaim("The privileged First and Second Estates pay none under this description."), "none");
  assert.equal(absoluteClaim("They never paid tax."), "never");
  assert.equal(absoluteClaim("They were exempt from most direct taxes and paid far less."), null);
});

/* ── a rewrite that splits a sentence ───────────────────────────────────────────────────── */

test("a long sentence split in two carries its board notes and cycle with it", () => {
  const beat = { script: "One idea here. A long sentence with two ideas in it. Last one.", boardNotes: [{ s: 1, text: "two ideas" }, { s: 2, text: "last" }], teachingCycle: { teach: 0, predict: 1, reveal: 2, transfer: 2 } };
  const out = applySentenceRewrite(beat, ["One idea here.", "A short sentence. Then the second idea.", "Last one."]);
  assert.ok(out);
  assert.equal(out!.script, "One idea here. A short sentence. Then the second idea. Last one.");
  assert.deepEqual(out!.boardNotes, [{ s: 1, text: "two ideas" }, { s: 3, text: "last" }]);
  assert.deepEqual(out!.teachingCycle, { teach: 0, predict: 1, reveal: 3, transfer: 3 });
  assert.equal(applySentenceRewrite(beat, ["One.", "Two."]), null, "entries must line up with the sentences");
  assert.equal(applySentenceRewrite(beat, ["One.", "A. B. C.", "Last."]), null, "two sentences an entry at most");
  assert.equal(applySentenceRewrite({ ...beat, sentenceBlocks: ["p1", "p2", "p3"] }, ["One idea here.", "A short one. Then more.", "Last one."]), null, "a strict-source board never splits");
});

test("lesson numbers for the QA log", () => {
  const r = lessonReadability([HARD, PLAIN], ["Why people were angry", "Taxes"], 15);
  assert.ok(r.grade > 6);
  assert.equal(r.longSentences, 1, "the 19-word sentence; the 15-word one is at the limit");
  assert.equal(r.currency, null);
});

/* ── board vs speech ────────────────────────────────────────────────────────────────────── */

test("board coverage: the board's words said, and items said on their own sentence", () => {
  const spec: CanvasBoardSpec = {
    heading: "Taxes",
    notes: [{ id: "n1", text: "Third Estate paid most", s: 0 }, { id: "n2", text: "Nobles exempt", s: 1 }, { id: "n3", text: "Bread prices soared", s: 1 }],
    stage: { kind: "sketch", items: [] },
    cues: [],
  } as unknown as CanvasBoardSpec;
  const good = spokenBoardCheck(spec, "The Third Estate paid most of the tax. Nobles were exempt, and bread prices soared.");
  assert.equal(good.wordShare, 1);
  assert.equal(good.offSentence.length, 0);
  assert.equal(spokenBoardLog("b1", good), null);
  const bad = spokenBoardCheck(spec, "The Third Estate paid most of the tax. Nobles were exempt.");
  assert.ok(bad.wordShare < 0.9);
  assert.deepEqual(bad.offSentence.map((i) => i.text), ["Bread prices soared"]);
  assert.match(spokenBoardLog("b1", bad) ?? "", /under 90%.*bread/);
});

/* ── remediation checked before it is spoken ────────────────────────────────────────────── */

test("a wrong remediation line is corrected; one with no usable correction fails", () => {
  const items = [
    { key: "s1", text: "A balance scale represents the unknown quantity." },
    { key: "s2", text: "An identity means more than one value works." },
    { key: "s3", text: "Subtract 3 from both sides." },
  ];
  const out = applyExplanationFixes(items, {
    fixes: { s1: "A balance scale shows that the two sides are equal.", s2: "An identity means every value works." },
    why: { s1: "the scale shows equality, not the unknown", s2: "every value, not just more than one" },
  });
  assert.deepEqual(out.items.map((i) => i.text), ["A balance scale shows that the two sides are equal.", "An identity means every value works.", "Subtract 3 from both sides."]);
  assert.equal(out.fixed.length, 2);
  assert.equal(out.failed.length, 0);
  const failed = applyExplanationFixes(items, { fixes: { s1: "" }, why: { s1: "wrong meaning" } });
  assert.deepEqual(failed.failed, [{ key: "s1", why: "wrong meaning" }]);
  const twoForOne = applyExplanationFixes(items, { fixes: { s1: "It shows balance. Both sides match." }, why: { s1: "x" } });
  assert.equal(twoForOne.failed.length, 1, "a correction must keep the sentence count (each is timed)");
  assert.equal(applyExplanationFixes(items, { fixes: {}, why: {} }).fixed.length, 0);
});

test("the explanation check asks once, and reports when it could not run", async () => {
  let asked = "";
  const ok = await checkExplanations(async (system, user) => { asked = `${system}\n${user}`; return { json: { fixes: { s1: "A balance scale shows that the two sides are equal." }, why: { s1: "equality" } }, costUsd: 0.001 }; }, "Right answer: the two sides are equal.", [{ key: "s1", text: "A balance scale represents the unknown quantity." }]);
  assert.equal(ok.checked, true);
  assert.equal(ok.items[0].text, "A balance scale shows that the two sides are equal.");
  assert.match(asked, /WHAT THE LESSON TAUGHT/);
  assert.match(EXPLANATION_CHECK_PROMPT, /misspelt word or a wrong word/);
  const down = await checkExplanations(async () => { throw new Error("offline"); }, "", [{ key: "s1", text: "Anything." }]);
  assert.equal(down.checked, false);
});

/* ── spelling and wrong words ───────────────────────────────────────────────────────────── */

test("a proofreading change is taken; a rewrite or a changed number is not", async () => {
  assert.equal(acceptProofread("Five hours of work forgives 70 dollars.", "Five hours of work forgoes 70 dollars."), true);
  assert.equal(acceptProofread("Five hours of work forgives 70 dollars.", "Five hours of work forgoes 80 dollars."), false);
  assert.equal(acceptProofread("You named the right idea but missed the cost.", "Your answer is mostly right, though you did not explain why the cost is what is given up."), false);
  const out = await proofread(async () => ({ fixed: { q1: "Five hours of work forgoes 70 dollars." } }), { q1: "Five hours of work forgives 70 dollars.", q2: "Good answer." });
  assert.equal(out.texts.q1, "Five hours of work forgoes 70 dollars.");
  assert.equal(out.texts.q2, "Good answer.");
  assert.equal(out.changed.length, 1);
  assert.match(PROOFREAD_PROMPT, /wrong words/);
  const down = await proofread(async () => { throw new Error("offline"); }, { q1: "Text here." });
  assert.equal(down.texts.q1, "Text here.");
});

/* ── the written test reads like the lesson ─────────────────────────────────────────────── */

test("a test question worded far harder than the lesson is sent back", () => {
  const target = testWordingTarget([PLAIN, "You have only so much money. So you must choose. Each choice gives up something else."]);
  assert.ok(target.grade <= 5, `lesson grade ${target.grade}`);
  const issues = testWordingIssues([
    { id: "q1", prompt: "Explain why scarcity necessarily creates choices for consumers, producers and governments simultaneously." },
    { id: "q2", prompt: "Why must you choose when you have only so much money?" },
  ], target);
  assert.deepEqual(issues.map((i) => i.id), ["q1"]);
  assert.match(testWordingRule(target), new RegExp(`reading grade ${target.grade}`));
});

/* ── a label named in the sentence, never pasted on ─────────────────────────────────────── */

test("a spliced label mention is refused for the plain clause; the prompt no longer models the splice", () => {
  const script = "Many things led to unrest. Prices rose fast.";
  const out = applyMentions(script, [{ s: 0, labels: ["Causes"] }], [{ i: 0, text: "Many things led to unrest, and this part here is the Causes?" }]);
  assert.doesNotMatch(out.script, /this part here/);
  // Merged with Minahil's c78fec33: a refused rewrite leaves her own sentence as it was (no "; on the diagram …" clause).
  assert.match(out.script, /^Many things led to unrest\. Prices rose fast\.$/);
  assert.doesNotMatch(MENTION_PROMPT, /\("…, and this part here is the <label>\."\)/);
  assert.match(MENTION_PROMPT, /never a tacked-on phrase/);
});

/* ── a student new to the whole topic ───────────────────────────────────────────────────── */

const card = (): StudentCard => ({
  level: "IGCSE", readingGrade: 10, country: "Pakistan", curricula: ["Cambridge IGCSE"], subjectCurricula: [], inSubject: null, subjectLevel: null, topicSubject: null,
  preferences: null, support: { simplerLanguage: null, slowerPace: null, accessibility: null }, moreExamples: 0,
} as unknown as StudentCard);

test("all parts new: grade 6, 15-word sentences, plain words before terms, doing before naming", () => {
  const learner = { parts: [{ label: "A", status: "new" as const }, { label: "B", status: "new" as const }] };
  assert.equal(isNovice(learner as never), true);
  assert.equal(isNovice({ parts: [{ label: "A", status: "new" }, { label: "B", status: "known" }] } as never), false);
  assert.equal(isNovice({ parts: [] } as never), false);
  const p = buildTeachingPolicy(card(), { learner: learner as never });
  assert.equal(p.novice, true);
  assert.equal(p.readingGrade, NOVICE_READING_GRADE);
  assert.equal(p.conceptGrade, 10, "the ideas stay at their level");
  assert.equal(p.language.sentenceWords, NOVICE_SENTENCE_WORDS);
  assert.ok(policyForWriter(p).includes(NOVICE_WORDS_LINE));
  assert.match(policyForPlanner(p), /DO the simplest case first/);
  const beginner = buildTeachingPolicy(card(), { beginner: true });
  assert.equal(beginner.novice, true);
  const usual = buildTeachingPolicy(card());
  assert.equal(usual.novice, false);
  assert.equal(usual.readingGrade, 10);
  assert.ok(!policyForWriter(usual).includes(NOVICE_WORDS_LINE));
  // General: the rule names no topic, word or example.
  assert.doesNotMatch(NOVICE_WORDS_LINE, /econom|opportunit|forgo|equation|revolution|rupee|dollar/i);
});
