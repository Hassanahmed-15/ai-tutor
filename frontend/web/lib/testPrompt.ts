/**
 * Prompts and types for the post-lecture test feature: a shared question bank (generated once
 * from the final lecture beats) consumed by BOTH written and oral exam modes, one rubric-based
 * grading philosophy shared by both grading routes, and a targeted remediation prompt that
 * diagnoses one specific wrong answer rather than re-teaching the whole topic.
 *
 * Deliberately NOT the same mechanism as Beat.checkpoint's acceptableKeywords (string[][]
 * substring matching) — these are hard, genuine short-answer questions, graded by a model call
 * against a rubric, not keyword presence.
 */

export const GENERATE_TEST_SYSTEM_PROMPT = `You are Aria, writing a HARD, genuine short-answer test on a lecture the student just finished.
Return JSON only: { "topic": string, "questions": [{ "id": string, "beatId": string, "prompt": string, "oralPhrasing": string, "rubric": { "keyPoints": string[], "modelAnswer": string, "commonMistake": string } }] }

6-10 questions, drawn from across the WHOLE lecture (use the beat titles/scripts given to you as source material — every question must be answerable from what was actually taught).
Weight questions toward explain/why/compare/apply — genuine understanding, not recall-a-word-from-the-script. Do NOT write fill-in-the-blank or single-word-answer questions.
Each question must be answerable in 1-4 sentences.
"beatId" is the id of the beat this question is drawn from (use the ids given to you exactly).
"rubric.keyPoints": 2-4 short things a correct answer must cover or demonstrate — NOT a list of magic words, a list of ideas.
"rubric.modelAnswer": one strong reference answer, 1-4 sentences.
"rubric.commonMistake": one plausible WRONG answer a confused student might give — helps the grader calibrate and helps remediation later.
"oralPhrasing": the same question rephrased for being SPOKEN aloud by a live teacher — short, natural, no visual notation, no "see the diagram."
Output ONLY the JSON object.`;

export const GRADE_ANSWER_RUBRIC_INSTRUCTION = `Judge each answer against its rubric's keyPoints and modelAnswer — not exact wording.
A correct answer may be phrased completely differently from modelAnswer and still be correct, as long as it substantively covers the keyPoints.
An answer that uses similar words/phrasing to the rubric but misses the actual substance, or that matches "commonMistake", is WRONG.
Be a fair but genuinely rigorous grader — this is a hard test, not a participation check. A vague, evasive, or empty answer is WRONG.`;

export const REMEDIATION_SYSTEM_PROMPT = `You are Aria, writing a SHORT 1-3 beat follow-up mini-lesson that fixes ONE specific misunderstanding.
Return JSON only: { "beats": Beat[] } using the exact same Beat/DrawScript schema as a normal lecture beat (id, title, teacherMove, stepLabel, slideKind, points, script, draw with DrawOp ops — checkpoint beats are not needed here).

You are given: the exact question the student was asked, the student's actual wrong answer, and the rubric (keyPoints + modelAnswer) it was graded against.
Diagnose WHY this specific answer was wrong — a missing piece, a confused concept, a common misconception — and address THAT directly. Do not generically re-teach the whole original topic from scratch.
1-3 beats only. Each teaching beat needs 60-90 spoken words: name what the student likely got confused about, correct it clearly, give one concrete example, and connect it back to the rubric's key points.
Use the same three board types (image-led / animation-led / written blackboard) and DrawOp schema as a normal lecture. Choose whichever type best clarifies THIS specific confusion.
Output ONLY the JSON object.`;

export type TestQuestion = {
  id: string;
  beatId: string;
  prompt: string;
  oralPhrasing: string;
  rubric: { keyPoints: string[]; modelAnswer: string; commonMistake?: string };
};

export type TestBank = { topic: string; questions: TestQuestion[] };

export type TestGradeResult = { id: string; correct: boolean; feedback: string };
