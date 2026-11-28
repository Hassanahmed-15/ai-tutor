import { NextResponse } from "next/server";
import { lessonCaller } from "@/lib/auth";
import { createOpenAI } from "@/lib/openaiClient";
import { studentCardFor } from "@/lib/learnerBasicsStore";
import { buildStudentCard } from "@/lib/studentCard";
import { mergeLearnerBasics } from "@/lib/learnerBasics";
import { effectiveBrief, profileAudience, sanitizeBrief } from "@/lib/lessonIntent";
import { syllabusOutcomesFor } from "@/lib/curriculum/syllabusOutcomes";
import { planLessonSpec } from "@/lib/curriculum/planSpec";
import { lessonPartDocument, lessonSpecText } from "@/lib/curriculum/lessonSpec";
import { splitIntoLessons } from "@/lib/series/split";
import { evidenceFromSyllabus, outcomesFromOutline, promptCourseLabel, promptLessonRequest, type OutlinePart } from "@/lib/curriculum/promptLesson";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * A TYPED PROMPT AS A COURSE LESSON (lib/curriculum/promptLesson.ts; owner 2026-11-28). POST { topic, request?,
 * outline: { subtopics }, brief? } → { spec, document, text } in the shape /api/curricula/lesson answers, so the
 * page builds it exactly as a course lesson. `{ off: true }` when PROMPTS_AS_COURSES is not on (the page then
 * builds the prompt lecture as before). One spec call (luna), plus a tiny subject call when the topic is outside
 * the catalogue; createOpenAI logs both in the spend log.
 */
const MODEL = process.env.CURRICULUM_SPEC_MODEL ?? "gpt-5.6-luna";

export async function POST(req: Request) {
  if (process.env.PROMPTS_AS_COURSES !== "on") return NextResponse.json({ off: true });
  const caller = await lessonCaller();
  if (!caller) return NextResponse.json({ error: "Sign in to start a lesson." }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { topic?: unknown; request?: unknown; outline?: { subtopics?: OutlinePart[] }; brief?: unknown; learnerBasics?: unknown };
  const topic = String(b.topic ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  const request = String(b.request ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
  if (topic.length < 2) return NextResponse.json({ error: "No topic." }, { status: 400 });
  const parts = Array.isArray(b.outline?.subtopics) ? b.outline!.subtopics!.slice(0, 12) : [];
  const started = Date.now();
  try {
    // Who it is for: the student's course and level (their profile, or what they said while planning).
    // The stored profile; when that read is slow or empty, the basics the page already holds (as /api/plan-lesson does).
    const card = (await Promise.race([studentCardFor(caller.userId, `${topic} ${request}`).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 4000))]))
      ?? (b.learnerBasics && typeof b.learnerBasics === "object" ? buildStudentCard(mergeLearnerBasics(b.learnerBasics as never, null, null), `${topic} ${request}`) : null);
    const brief = effectiveBrief(b.brief && typeof b.brief === "object" ? sanitizeBrief(b.brief) : null, `${request} ${topic}`, card);
    const audience = profileAudience(card);
    const curriculum = brief?.curriculum && !/general|none/i.test(brief.curriculum) ? brief.curriculum : undefined;
    const level = brief?.level ?? audience?.level ?? "Secondary school";
    const official = curriculum ? await syllabusOutcomesFor(curriculum, `${request} ${topic}`) : null;
    const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    // The subject: the official course's when the topic is in it, else one tiny call. Not the profile's word guess
    // (lib/education subjectForTopic): it called "Overfitting in machine learning" Mechanical Engineering (2026-11-28).
    let subject = official ? official.framework.replace(/\s+syllabus\b.*$/i, "") : "";
    if (!subject) {
      const res = await openai.chat.completions.create({ model: MODEL, messages: [{ role: "system", content: `Name the school subject this lesson belongs to, in 1-3 words (e.g. "Biology", "Mathematics", "Computer Science", "History", "Economics"). Return JSON only: {"subject":"..."}` }, { role: "user", content: `Lesson: ${topic}${request ? `\nAsked as: ${request}` : ""}` }], response_format: { type: "json_object" }, max_completion_tokens: 200, reasoning_effort: "low" } as never) as { choices: Array<{ message?: { content?: string | null } }> };
      try { subject = String(JSON.parse(res.choices[0]?.message?.content ?? "{}").subject ?? "").slice(0, 60); } catch { /* left empty */ }
    }
    const courseLabel = official ? official.framework.replace(/\s+syllabus\b.*$/i, "") : promptCourseLabel(curriculum, subject || "General");
    const outcomes = outcomesFromOutline(parts, topic, request);
    const evidence = evidenceFromSyllabus(official?.text);
    const { spec } = await planLessonSpec(openai, MODEL, { courseLabel, level, title: topic, outcomes, evidence });
    const meta = { request: promptLessonRequest(topic, level), framework: courseLabel, subject: subject || courseLabel };
    console.log(`[prompt-lesson] "${topic.slice(0, 60)}" as a ${courseLabel} (${level}) course lesson: ${spec.boards.length} boards from ${outcomes.length} outcomes${official ? `, official syllabus "${official.title}"` : ""}, ${Math.round((Date.now() - started) / 1000)}s`);
    // Framed exactly as a course lesson is (/api/curricula/lesson): "today's plan" first, "check what you learned"
    // last. One whole lesson, not a series: a typed topic is taught in one go.
    const whole = splitIntoLessons(spec.boards.map((x) => ({ title: x.title, outcomeRefs: x.outcomeRefs })), Math.max(1, spec.boards.length));
    return NextResponse.json({ spec, document: lessonPartDocument(spec, meta, evidence, whole, 0), text: lessonSpecText(spec) });
  } catch (error) {
    // The prompt lecture still runs: the page falls back to it.
    console.warn("[prompt-lesson] failed:", (error as Error).message);
    return NextResponse.json({ error: "Could not plan this as a course lesson." }, { status: 502 });
  }
}
