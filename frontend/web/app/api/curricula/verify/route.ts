import { NextResponse } from "next/server";
import { lessonCaller } from "@/lib/auth";
import { createOpenAI } from "@/lib/openaiClient";
import { curriculumLessons } from "@/lib/db/cosmos";
import type { CurriculumLessonRequest } from "@/lib/curriculum/lessonSpec";
import { cacheId, type CachedLesson } from "@/lib/curriculum/lessonCache";

/**
 * An independent check of a finished curriculum lecture against its lesson spec: is every official
 * outcome actually taught, is anything taught that is outside this syllabus level, and are worked
 * answers and level right. The result is stored with the cached lesson (so a reviewer sees it next
 * to the spec) and returned to the player.
 */
const MODEL = process.env.CURRICULUM_VERIFY_MODEL ?? "gpt-5.6-luna";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["outcomes", "outOfScope", "accuracyIssues", "levelIssues"],
  properties: {
    outcomes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["n", "covered", "board", "note"],
        properties: { n: { type: "integer" }, covered: { type: "boolean" }, board: { type: "integer" }, note: { type: "string" } },
      },
    },
    outOfScope: { type: "array", items: { type: "string" } },
    accuracyIssues: { type: "array", items: { type: "string" } },
    levelIssues: { type: "array", items: { type: "string" } },
  },
} as const;

type Verification = {
  version: 3;
  checkedAt: string;
  covered: number;
  total: number;
  missing: Array<{ n: number; text: string }>;
  outOfScope: string[];
  accuracyIssues: string[];
  levelIssues: string[];
  passed: boolean;
  outcomes: Array<{ n: number; covered: boolean; board: number; note: string; text: string }>;
};

export async function POST(req: Request) {
  if (!(await lessonCaller())) return NextResponse.json({ error: "Sign in." }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { request?: CurriculumLessonRequest; boards?: Array<{ title?: string; script?: string; visual?: string }> };
  if (!body.request || !Array.isArray(body.boards) || !body.boards.length) return NextResponse.json({ error: "request and boards are required" }, { status: 400 });

  const id = cacheId(body.request);
  let cached: CachedLesson | undefined;
  const container = await curriculumLessons().catch(() => null);
  try {
    cached = (await container?.item(id, id).read<CachedLesson>())?.resource;
  } catch {
    cached = undefined;
  }
  if (!cached?.spec) return NextResponse.json({ error: "Unknown lesson" }, { status: 404 });
  const spec = cached.spec;

  const boards = body.boards.slice(0, 20).map((b, i) =>
    `BOARD ${i + 1}: ${String(b.title ?? "").slice(0, 120)}\nNARRATION:\n${String(b.script ?? "").slice(0, 2500)}\nVISIBLE BOARD EVIDENCE:\n${String(b.visual ?? "(none supplied)").slice(0, 2500)}`,
  ).join("\n\n");
  const system = `You check a finished lesson against its official specification for ${spec.courseLabel}, ${spec.level}. Be strict and literal.
- outcomes: for each numbered official outcome, covered = true only if a student can learn and observe the required skill from the narration AND visible board evidence; board = that board's number (0 if none); note = a few words.
- Treat an outcome that asks to draw, sketch, label, identify on a diagram, compare structures visually, interpret a graph, show a shape/angle, write an equation, or perform a worked method as covered ONLY when VISIBLE BOARD EVIDENCE explicitly contains the required objects, labels, relationships, values, or steps. Narration alone cannot satisfy a visual or procedural outcome.
- A generic icon is not evidence of a specific scientific structure or geometry. Merely naming the required object is not the same as showing or teaching it. If visible evidence is absent, vague, malformed, or contradicts the narration, mark the outcome uncovered and say what is missing.
- outOfScope: content taught that this syllabus level does not include (see the spec's out-of-scope list and level); [] if none.
- accuracyIssues: factual, mathematical or worked-answer errors; [] if none.
- levelIssues: places pitched clearly too hard or too easy for this level, or using vocabulary/notation this curriculum does not use; [] if none.`;
  const user = `OFFICIAL OUTCOMES:\n${spec.outcomes.map((o, i) => `${i + 1}. ${o.text}`).join("\n")}\n\nDEPTH: ${spec.depth}\nOUT OF SCOPE: ${spec.outOfScope.join("; ") || "(none listed)"}\n\nLESSON:\n${boards}`;
  try {
    const client = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_schema", json_schema: { name: "lesson_check", strict: true, schema: SCHEMA } },
    } as Parameters<typeof client.chat.completions.create>[0]);
    const raw = JSON.parse((completion as { choices: Array<{ message: { content: string | null } }> }).choices[0]?.message?.content ?? "{}") as {
      outcomes: Array<{ n: number; covered: boolean; board: number; note: string }>; outOfScope: string[]; accuracyIssues: string[]; levelIssues: string[];
    };
    const coveredSet = new Set(raw.outcomes.filter((o) => o.covered).map((o) => o.n));
    const missing = spec.outcomes.map((o, i) => ({ n: i + 1, text: o.text })).filter((o) => !coveredSet.has(o.n));
    const v: Verification = {
      version: 3,
      checkedAt: new Date().toISOString(),
      covered: spec.outcomes.length - missing.length,
      total: spec.outcomes.length,
      missing,
      outOfScope: raw.outOfScope.slice(0, 8),
      accuracyIssues: raw.accuracyIssues.slice(0, 8),
      levelIssues: raw.levelIssues.slice(0, 8),
      passed: missing.length === 0 && raw.accuracyIssues.length === 0 && raw.outOfScope.length === 0,
      outcomes: spec.outcomes.map((outcome, index) => {
        const judged = raw.outcomes.find((entry) => entry.n === index + 1);
        return { n: index + 1, covered: judged?.covered === true, board: judged?.board ?? 0, note: judged?.note ?? "No visible evidence found.", text: outcome.text };
      }),
    };
    try { await container?.items.upsert({ ...cached, verification: v }); } catch { /* best-effort */ }
    return NextResponse.json(v);
  } catch {
    return NextResponse.json({ error: "Could not check this lesson." }, { status: 502 });
  }
}
