import type OpenAI from "openai";
import { checkNumbers, numberIssuesText } from "@/lib/canvas/numberCheck";
import { SPEC_SCHEMA, boardBudget, completeSpec, specGaps, specSystemPrompt, specUserMessage, type Evidence, type LessonSpec, type SpecOutcome } from "@/lib/curriculum/lessonSpec";

type Planned = Omit<LessonSpec, "courseLabel" | "level" | "lessonTitle" | "outcomes">;

/**
 * One lesson spec from the model, used by /api/curricula/lesson and scripts/curriculum/pilot.mts.
 *
 * A plan that leaves an outcome untaught or points at an outcome number that does not exist (the
 * MDCAT pilot: boards referencing syllabus codes like 6.5 instead of 1-4) is asked for once more —
 * `completeSpec` would still cover every outcome, but only with bare boards made from the outcome
 * text, so a second plan is worth its ~$0.002. The better of the two is kept.
 */
export async function planLessonSpec(
  client: OpenAI,
  model: string,
  lesson: { courseLabel: string; level: string; title: string; outcomes: SpecOutcome[]; evidence: Evidence[] },
): Promise<{ spec: LessonSpec; modelGaps: number[]; attempts: number; usage: { input: number; output: number } }> {
  const usage = { input: 0, output: 0 };
  const ask = async (extra: string): Promise<LessonSpec> => {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: specSystemPrompt(lesson.courseLabel, lesson.level, lesson.outcomes) },
        { role: "user", content: specUserMessage(lesson.title, lesson.outcomes, lesson.evidence) + extra },
      ],
      response_format: { type: "json_schema", json_schema: { name: "lesson_spec", strict: true, schema: SPEC_SCHEMA as unknown as Record<string, unknown> } },
    } as Parameters<typeof client.chat.completions.create>[0]) as OpenAI.Chat.Completions.ChatCompletion;
    usage.input += completion.usage?.prompt_tokens ?? 0;
    usage.output += completion.usage?.completion_tokens ?? 0;
    const planned = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Planned;
    return { ...planned, courseLabel: lesson.courseLabel, level: lesson.level, lessonTitle: lesson.title, outcomes: lesson.outcomes };
  };
  // Worked examples and checkpoint answers are recomputed by code (lib/canvas/numberCheck.ts).
  const arithmetic = (s: LessonSpec) => [
    ...s.boards.flatMap((b) => [b.workedExample, ...b.keyPoints]),
    ...s.checkpoint.map((c) => c.answer),
  ].flatMap((text) => checkNumbers(text ?? ""));
  // Too few boards for the qualification is a fault too (lib/curriculum/lessonSpec.ts boardBudget).
  const minBoards = boardBudget(lesson.outcomes, lesson.level).min;
  const short = (s: LessonSpec) => Math.max(0, minBoards - s.boards.length);
  const faults = (s: LessonSpec) => { const g = specGaps(s); return g.untaught.length + g.badRefs + arithmetic(s).length + short(s); };

  let raw = await ask("");
  let attempts = 1;
  if (faults(raw) > 0) {
    const n = lesson.outcomes.length;
    const wrong = arithmetic(raw);
    const again = await ask(`\n\nIMPORTANT: outcomeRefs are the outcome NUMBERS 1-${n} from the list above (not syllabus codes), and every number 1-${n} must appear in some board.${short(raw) ? ` Plan at least ${minBoards} boards: this qualification needs that depth.` : ""}${wrong.length ? ` These worked calculations are wrong: ${numberIssuesText(wrong)}. Recompute them.` : ""}`).catch(() => null);
    attempts = 2;
    if (again && faults(again) < faults(raw)) raw = again;
  }
  return { spec: completeSpec(raw), modelGaps: specGaps(raw).untaught, attempts, usage };
}
