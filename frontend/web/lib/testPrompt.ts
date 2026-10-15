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

3-6 questions, drawn from across the WHOLE lecture (use the beat titles/scripts given to you as source material — every question must be answerable from what was actually taught). Use roughly one question per substantive teaching beat and never add questions merely to reach a quota.
Weight questions toward explain/why/compare/apply — genuine understanding, not recall-a-word-from-the-script. Do NOT write fill-in-the-blank or single-word-answer questions.
Test transfer, not memory: an apply or calculate question uses NEW numbers and a NEW situation — never the worked example, values or function the lecture already solved (a student who memorised the board must still have to think). At least one question is in the curriculum's exam format when the lecture is for an exam course (its command words: State, Explain, Calculate, Show that, Justify; AP-style data in a small table when the topic suits it).
Each question must be answerable in 1-4 sentences.
"beatId" is the id of the beat this question is drawn from (use the ids given to you exactly).
"rubric.keyPoints": 1-4 short things a correct answer must cover or demonstrate — NOT a list of magic words, a list of ideas. Every required key point MUST be explicitly requested by the question. Never hide an extra requirement in the rubric or model answer.
"rubric.modelAnswer": one strong reference answer, 1-4 sentences.
"rubric.commonMistake": one plausible WRONG answer a confused student might give — helps the grader calibrate and helps remediation later.
"oralPhrasing": the same question rephrased for being SPOKEN aloud by a live teacher — short, natural, no visual notation, no "see the diagram."
Output ONLY the JSON object.`;

export const GRADE_ANSWER_RUBRIC_INSTRUCTION = `The question text is the grading contract. Judge whether the student's answer fully and accurately answers exactly what the question asks. Use the rubric and model answer as guidance, never as hidden requirements.
A correct answer may be phrased completely differently from modelAnswer. It is still correct when it answers every explicitly requested part accurately, even if it omits useful context or rubric details that the question did not ask for.
If the prompt requests a number of examples, roles, causes, differences, or steps and the student supplies that number accurately, do not require an additional explanation unless the prompt explicitly asks for one.
Optional enrichment belongs in feedback as "For an even stronger answer..." and must not turn an otherwise complete answer into a wrong one.
An answer that uses similar words/phrasing to the rubric but misses the actual substance, or that matches "commonMistake", is WRONG.
Mark an answer wrong only for a factual error, contradiction, an explicitly requested part that is missing, or an answer too vague to satisfy the stated task. Be rigorous about those requirements, but do not invent new ones.
When the question asks the student to EXPLAIN, JUSTIFY or say WHY, credit only an explanation the student actually wrote; a correct result or working from which the reason could be inferred does not earn it — list it in missingKeyPoints.
A wrong final result (a wrong value, derivative, product, sign or unit) is an error, never just "a part missing": name it in misconception, give method credit in pointsEarned only for the steps that are right.`;

/**
 * WHY, not just what.
 *
 * The grader used to be asked for "one short sentence explaining the judgment", and what came back
 * restated the verdict: "Your answer does not address why node removal is difficult." The student
 * already knows it was marked wrong — the mark is at the top of the card. What they cannot see is
 * which idea they missed, or, when they were right, which part of their answer earned it. That is
 * the whole value of being graded by a model rather than by string matching, and it was being
 * thrown away.
 */
/**
 * MARK-SCHEME GRADING. The model judges each marking point (one rubric key point = one mark, the way
 * an exam mark scheme lists them) and code adds them up: a holistic "pointsEarned" let a lenient
 * verdict round itself to full marks, and a wrong final answer lose every method mark.
 */
export const MARK_SCHEME_INSTRUCTION = `Also return "awarded": one boolean per rubric key point, in the rubric's order — true only when the student's answer itself earns that marking point. Judge each point on its own, the way an examiner ticks a mark scheme: a correct method step earns its mark even when the final answer is wrong, and a correct final answer does not earn an explanation mark the student never wrote. The marks are added up from "awarded".`;

export const GRADE_FEEDBACK_INSTRUCTION = `"feedback" is 1-2 sentences, addressed to the student as "you", explaining WHY the answer was judged the way it was. Never merely restate the verdict.

If CORRECT: name the specific idea they got right, in their own terms where you can — "you correctly said the successor has to come from the right subtree, which is what keeps the ordering intact". If they were right but left something thin, say so in a clause.
If PARTIAL: begin with the accurate core idea, then name only the explicitly requested part that is missing. Do not describe optional elaboration as missing.
If MISCONCEPTION: name the specific thing that is factually mistaken or contradicted, and say in one clause why it matters. If the answer was empty, evasive, or unrelated, say that plainly rather than inventing a misconception they did not express.

Be concrete about THEIR answer. Never write a sentence that would fit equally well under any other question.`;

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

export type TestGradeStatus = "correct" | "partial" | "misconception";
export type TestGradeResult = {
  id: string;
  status: TestGradeStatus;
  /** Backward-compatible full-credit flag. */
  correct: boolean;
  feedback: string;
  /** Fair marking: optional detail is never silently treated as a lost mark. */
  pointsEarned: number;
  pointsAvailable: number;
  missingKeyPoints: string[];
  misconception?: string;
};
