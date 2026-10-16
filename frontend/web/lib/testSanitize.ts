import type { TestBank, TestGradeResult, TestQuestion } from "@/lib/testPrompt";
import { checkNumbers } from "./canvas/numberCheck";

/** Validates/clamps a raw generate-test model response into a usable TestBank. Drops any
 *  question missing its required fields rather than failing the whole bank over one bad entry. */
export function sanitizeTestBank(raw: unknown, fallbackTopic: string): TestBank {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const topic = typeof obj.topic === "string" && obj.topic.trim() ? obj.topic.trim() : fallbackTopic;
  const rawQuestions = Array.isArray(obj.questions) ? obj.questions : [];

  const questions: TestQuestion[] = [];
  rawQuestions.forEach((q, i) => {
    if (!q || typeof q !== "object") return;
    const rec = q as Record<string, unknown>;
    const prompt = typeof rec.prompt === "string" ? rec.prompt.trim() : "";
    if (!prompt) return;

    const rubricRaw = rec.rubric && typeof rec.rubric === "object" ? (rec.rubric as Record<string, unknown>) : {};
    const keyPoints = Array.isArray(rubricRaw.keyPoints)
      ? rubricRaw.keyPoints.filter((k): k is string => typeof k === "string" && k.trim().length > 0).slice(0, 6)
      : [];
    const modelAnswer = typeof rubricRaw.modelAnswer === "string" ? rubricRaw.modelAnswer.trim() : "";
    if (keyPoints.length === 0 || !modelAnswer) return;

    questions.push({
      id: typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : `q${i + 1}`,
      beatId: typeof rec.beatId === "string" ? rec.beatId.trim() : "",
      prompt: prompt.slice(0, 400),
      oralPhrasing: typeof rec.oralPhrasing === "string" && rec.oralPhrasing.trim() ? rec.oralPhrasing.trim().slice(0, 400) : prompt.slice(0, 400),
      rubric: {
        keyPoints,
        modelAnswer: modelAnswer.slice(0, 600),
        commonMistake: typeof rubricRaw.commonMistake === "string" ? rubricRaw.commonMistake.trim().slice(0, 300) : undefined,
      },
    });
    if (questions.length >= 10) return;
  });

  return { topic, questions: questions.slice(0, 10) };
}

/** Questions whose model answer or marking points contain a sum that does not add up. */
export function testArithmeticIssues(questions: TestQuestion[]): Array<{ id: string; calculation: string; computed: number }> {
  return questions.flatMap((q) => checkNumbers([q.rubric.modelAnswer, ...q.rubric.keyPoints].join(" \n ")).map((n) => ({ id: q.id, calculation: n.calculation, computed: n.computed })));
}

const plain = (t: string) => t.replace(/(\d),(\d{3})(?!\d)/g, "$1$2").replace(/(\d),(\d{3})(?!\d)/g, "$1$2");
/** The numbers a sentence states that matter: two or more digits, a decimal, money or a percentage. */
const statedNumbers = (t: string) => (plain(t).match(/[$£€]?\d+(?:\.\d+)?%?/g) ?? []).map((n) => n.replace(/^[$£€]/, "").replace(/%$/, "")).filter((n) => n.length >= 2 || n.includes("."));

/**
 * FEEDBACK STATES ONLY NUMBERS IT WAS GIVEN. The grader told a student the correct profit was
 * $40,800 when it is $41,800 (audit 2026-10-17) — a number it computed itself, wrongly. A feedback
 * sentence stating a number that is not in the question, the mark scheme or the student's answer, or
 * a sum that does not add up, is removed; the student is never told a wrong figure.
 */
export function groundedFeedback(feedback: string, sources: string[]): string {
  const known = new Set(sources.flatMap(statedNumbers));
  const sentences = feedback.split(/(?<=[.!?])\s+/).filter(Boolean);
  const kept = sentences.filter((sentence) => !checkNumbers(sentence).length && statedNumbers(sentence).every((n) => known.has(n)));
  return kept.join(" ").trim();
}

/** Validates/clamps a raw grade-test / grade-oral-test model response, keyed against the
 *  question ids that were actually asked so a stray/hallucinated id can never surface. */
export function sanitizeGradeResults(raw: unknown, questionIds: string[], questionRubrics: Array<Pick<TestQuestion, "id" | "rubric"> & { prompt?: string }> = [], answers: Record<string, string> = {}): TestGradeResult[] {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawResults = Array.isArray(obj.results) ? obj.results : [];
  const validIds = new Set(questionIds);
  const maxPoints = new Map(questionRubrics.map((q) => [q.id, Math.max(1, q.rubric.keyPoints.length)]));
  const keyPointsOf = new Map(questionRubrics.map((q) => [q.id, q.rubric.keyPoints]));

  const byId = new Map<string, TestGradeResult>();
  for (const r of rawResults) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id : "";
    if (!validIds.has(id)) continue;
    let missingKeyPoints = Array.isArray(rec.missingKeyPoints)
      ? rec.missingKeyPoints.filter((p): p is string => typeof p === "string" && Boolean(p.trim())).map((p) => p.trim().slice(0, 180)).slice(0, 6)
      : [];
    const said = rec.status === "correct" || rec.status === "partial" || rec.status === "misconception"
      ? rec.status
      : rec.correct === true ? "correct" : "misconception";
    // A "correct" verdict that still lists a missing requested point is a partial: full marks with
    // a gap named was the leniency the audit caught (an explanation that was asked for, never given).
    let status: TestGradeResult["status"] = said === "correct" && missingKeyPoints.length ? "partial" : said;
    const available = maxPoints.get(id) ?? 1;
    const keyPoints = keyPointsOf.get(id) ?? [];
    // Arithmetic the student wrote is recomputed by code: "2.0 × 9.8 = 21" is not a correct answer.
    const wrongSums = checkNumbers(answers[id] ?? "");
    if (wrongSums.length && status === "correct") {
      status = "partial";
      missingKeyPoints = [...missingKeyPoints, `Accuracy: ${wrongSums[0].calculation} is wrong — it comes to ${Number(wrongSums[0].computed.toPrecision(3))}`].slice(0, 6);
    }
    let pointsEarned: number;
    const awarded = Array.isArray(rec.awarded) && rec.awarded.length === keyPoints.length && keyPoints.length > 0 ? rec.awarded.map((a) => a === true) : null;
    if (awarded) {
      // Mark scheme: the marks are the points ticked, added up here (lib/testPrompt.ts
      // MARK_SCHEME_INSTRUCTION). A misconception keeps its method marks but never full marks.
      const ticked = awarded.filter(Boolean).length;
      // A named error or a named missing point is never full marks, whatever was ticked.
      const short = status === "misconception" || wrongSums.length > 0 || missingKeyPoints.length > 0;
      pointsEarned = short ? Math.min(ticked, available - 1) : ticked;
      if (status !== "misconception") status = pointsEarned >= available ? "correct" : pointsEarned > 0 ? "partial" : "misconception";
      if (status === "partial" && !missingKeyPoints.length) missingKeyPoints = keyPoints.filter((_, i) => !awarded[i]).map((p) => p.slice(0, 180)).slice(0, 6);
    } else {
      const requested = Number(rec.pointsEarned);
      pointsEarned = status === "correct"
        ? available
        : status === "misconception"
          ? 0
          : Number.isFinite(requested) ? Math.max(0, Math.min(Math.max(0, available - 1), Math.round(requested))) : Math.floor(available / 2);
    }
    // Cut at a word, never mid-word ("…and a co" — audit 2026-10-16).
    const cutAtWord = (t: string, max: number) => (t.length <= max ? t : `${t.slice(0, max).replace(/\s+\S*$/, "")}…`);
    const misconception = typeof rec.misconception === "string" && rec.misconception.trim() ? cutAtWord(rec.misconception.trim(), 320) : undefined;
    byId.set(id, {
      id,
      status,
      correct: status === "correct",
      // 400, not 300: feedback is now an explanation of why the answer was judged that way rather
      // than a one-line verdict, and a cap that clips the second sentence mid-word reads as a bug.
      feedback: (() => {
        const q = questionRubrics.find((x) => x.id === id);
        const raw = typeof rec.feedback === "string" ? rec.feedback.trim() : "";
        if (!q) return raw.slice(0, 400);
        const grounded = groundedFeedback(raw, [q.prompt ?? "", q.rubric.modelAnswer, ...q.rubric.keyPoints, answers[id] ?? ""]);
        // Everything it said rested on a figure it invented: the student gets the model answer instead.
        return (grounded || (status === "correct" ? "" : `The model answer: ${q.rubric.modelAnswer}`)).slice(0, 400);
      })(),
      pointsEarned,
      pointsAvailable: available,
      missingKeyPoints,
      ...(misconception ? { misconception } : {}),
    });
  }

  // Guarantee one result per question that was actually asked, in order — a missing model
  // judgment defaults to incorrect rather than silently vanishing from the results screen.
  return questionIds.map((id) => byId.get(id) ?? {
    id,
    status: "misconception",
    correct: false,
    feedback: "Could not grade this answer.",
    pointsEarned: 0,
    pointsAvailable: maxPoints.get(id) ?? 1,
    missingKeyPoints: [],
  });
}
