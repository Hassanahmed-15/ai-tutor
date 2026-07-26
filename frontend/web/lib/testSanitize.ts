import type { TestBank, TestGradeResult, TestQuestion } from "@/lib/testPrompt";

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

/** Validates/clamps a raw grade-test / grade-oral-test model response, keyed against the
 *  question ids that were actually asked so a stray/hallucinated id can never surface. */
export function sanitizeGradeResults(raw: unknown, questionIds: string[]): TestGradeResult[] {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rawResults = Array.isArray(obj.results) ? obj.results : [];
  const validIds = new Set(questionIds);

  const byId = new Map<string, TestGradeResult>();
  for (const r of rawResults) {
    if (!r || typeof r !== "object") continue;
    const rec = r as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id : "";
    if (!validIds.has(id)) continue;
    byId.set(id, {
      id,
      correct: rec.correct === true,
      feedback: typeof rec.feedback === "string" ? rec.feedback.trim().slice(0, 300) : "",
    });
  }

  // Guarantee one result per question that was actually asked, in order — a missing model
  // judgment defaults to incorrect rather than silently vanishing from the results screen.
  return questionIds.map((id) => byId.get(id) ?? { id, correct: false, feedback: "Could not grade this answer." });
}
