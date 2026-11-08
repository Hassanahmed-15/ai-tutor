import type { SuprnotesContentBlock, SuprnotesLessonInput } from "../suprnotes";
import { lessonTypeOf, orderBoards, type LessonType, type OrderBoard, type StudentLevel } from "./lessonTypes";

/**
 * A COURSE LESSON TAUGHT IN TEACHING ORDER (flag CANVAS_TEACHING_ORDERS=on; owner, 2026-11-08).
 *
 * The lesson plan (lib/curriculum/lessonSpec.ts lessonDocument) has one block per idea, and the board
 * planner writes one board per block. Taught that way an idea is stated once: an overview. Here each
 * idea's block becomes the boards of its teaching order (lib/teaching/lessonTypes.ts) — for a new
 * concept: why it matters and a simple picture → a real example → the rule and a check — each block
 * carrying exactly the part of the plan its board must teach (its key points, its worked example, its
 * check), so the plan's per-board coverage check (lib/canvas/courseCoverage.ts) still holds every board
 * to its content, with nothing dropped and nothing said twice.
 *
 * Done once, when the lecture is created (app/api/progressive-lectures/route.ts), so every later step of
 * the worker reads the same blocks. Pure, unit-tested (lib/anim/teachingOrders.test.ts).
 */

export function teachingOrdersOn(): boolean {
  return process.env.CANVAS_TEACHING_ORDERS === "on";
}

/** A lecture is at most this many boards (lib/canvas/lessonRequest.ts canvasBoardCount). */
export const MAX_LESSON_BOARDS = 14;

type PlanBeat = { id: string; title: string; objective?: string; outcomeRefs?: number[]; visualRequirement?: unknown[]; sourceBlockIds?: string[] };
type LessonPlan = { sourceType?: string; beats?: PlanBeat[]; contentBlockIds?: string[]; targetBeatCount?: number; teachingOrders?: unknown };

/** Blocks the lesson frames itself with (lib/curriculum/lessonSpec.ts): taught as they are, one board each. */
const FRAMING = new Set(["exam-practice", "lesson-plan", "lesson-recap"]);

/** The pieces of a course block's text (lessonDocument writes them in this order). */
function piecesOf(block: SuprnotesContentBlock): { objective: string; worked: string; syllabus: string } {
  const text = block.text ?? "";
  const parts = text.split(/\n\n+/);
  const worked = parts.find((p) => /^Worked example:/i.test(p)) ?? "";
  const syllabus = parts.find((p) => /^Official syllabus/i.test(p)) ?? "";
  const objective = parts[0] && !/^(- |Worked example:|Official syllabus)/.test(parts[0]) ? parts[0] : "";
  return { objective, worked, syllabus };
}

const hintsLike = (hints: string[] | undefined, pattern: RegExp) => (hints ?? []).filter((h) => pattern.test(h));

/**
 * Fewer boards for the same orders, when the lesson would run past MAX_LESSON_BOARDS: the idea with the
 * most boards has its last two boards taught as one, until it fits. Every step of every order stays.
 */
function fitOrders(orders: OrderBoard[][], framing: number): OrderBoard[][] {
  const out = orders.map((o) => [...o]);
  const total = () => out.reduce((n, o) => n + o.length, 0) + framing;
  while (total() > MAX_LESSON_BOARDS) {
    const widest = out.reduce((best, o, i) => (o.length > out[best].length ? i : best), 0);
    if (out[widest].length <= 1) break;
    const o = out[widest];
    const [a, b] = o.splice(o.length - 2, 2);
    o.push({ title: a.title, does: [...a.does, ...b.does], gets: [...new Set([...a.gets, ...b.gets])] });
  }
  return out;
}

/** The course lesson with each idea's block split into its teaching order's boards. */
export function withTeachingOrders(doc: SuprnotesLessonInput, level: StudentLevel): SuprnotesLessonInput {
  const plan = doc.lessonPlan as LessonPlan | undefined;
  const blocks = doc.contentBlocks ?? [];
  if (plan?.sourceType !== "curriculum" || plan.teachingOrders || !blocks.length) return doc;
  const beats = plan.beats ?? [];
  const subject = doc.lesson?.subject ?? "";

  const types: Array<LessonType | null> = blocks.map((block) => (FRAMING.has(block.type ?? "") || block.exam ? null : lessonTypeOf({
    subject,
    title: block.heading,
    objective: piecesOf(block).objective,
    keyPoints: block.keyIdeas,
    outcomes: (block.facts ?? []).map((f) => f.claim ?? "").filter(Boolean),
  })));
  const framing = types.filter((t) => t === null).length;
  const orders = fitOrders(types.filter((t): t is LessonType => t !== null).map((t) => orderBoards(t, level)), framing);

  const outBlocks: SuprnotesContentBlock[] = [];
  const outBeats: PlanBeat[] = [];
  let idea = 0;
  blocks.forEach((block, i) => {
    const beat = beats[i];
    const type = types[i];
    if (type === null) {
      outBlocks.push({ ...block });
      if (beat) outBeats.push({ ...beat });
      return;
    }
    const order = orders[idea++];
    const { objective, worked, syllabus } = piecesOf(block);
    const heading = block.heading?.trim() || beat?.title || "This idea";
    const hints = block.teachingHints ?? [];
    // Everything the board planner must see, written into the text (the planner reads text only).
    const lessonHints = hintsLike(hints, /^(Level:|Use these terms:|Watch for:|Do not teach)/);
    const check = hintsLike(hints, /^Required understanding check:/).map((h) => h.replace(/^Required understanding check:\s*/, "")).join(" ");
    const transfer = hintsLike(hints, /^Transfer task:/).map((h) => h.replace(/^Transfer task:\s*/, "")).join(" ");
    const examined = hintsLike(hints, /^How it is examined:/);
    const pointsAt = Math.max(0, order.findIndex((b) => b.gets.includes("keyPoints")));
    order.forEach((board, k) => {
      const last = k === order.length - 1;
      const points = board.gets.includes("keyPoints");
      const id = k === 0 ? block.id : `${block.id}-${k + 1}`;
      // The step names are English: an idea headed in Urdu or Arabic keeps its own heading and is numbered instead.
      const title = /[^\u0000-\u024F\u2000-\u206F]/.test(heading) && order.length > 1 ? `${heading} (${k + 1}/${order.length})` : board.title(heading);
      const text = [
        `TEACHING ORDER — board ${k + 1} of ${order.length} for "${heading}" (a ${type.replace("_", " ")} idea, taught for a ${level} student). This board's script does exactly this, in this order:\n${board.does.map((d) => `- ${d}`).join("\n")}`,
        objective ? `What the student will understand: ${objective}` : "",
        points
          ? `Key points this board MUST teach (each in its own sentence, with its reason where it is a how or why):\n${(block.keyIdeas ?? []).map((p) => `- ${p}`).join("\n")}`
          : `The key points of "${heading}" are stated on board ${pointsAt + 1} of ${order.length}; this board builds up to them and does not list them.`,
        board.gets.includes("worked") && worked ? worked : "",
        board.gets.includes("check") && check ? `The understanding check to ask: ${check}${transfer ? ` (or, for a stronger student, this new-context task: ${transfer})` : ""}` : "",
        last && examined.length ? examined.join("\n") : "",
        lessonHints.join("\n"),
        points && syllabus ? syllabus : "",
      ].filter(Boolean).join("\n\n");
      outBlocks.push({
        ...block,
        id,
        heading: title,
        text,
        keyIdeas: points ? block.keyIdeas : [],
        teachingHints: [
          ...lessonHints,
          ...(board.gets.includes("check") ? hintsLike(hints, /^(Required understanding check|Transfer task|Visible evidence):/) : []),
          ...(last ? examined : []),
        ],
        facts: points ? block.facts : [],
        role: `teaching-order:${type}:${k + 1}/${order.length}`,
      });
      if (beat) outBeats.push({
        ...beat,
        title,
        // The syllabus's visual contract sits with the board that teaches the key points.
        visualRequirement: points ? beat.visualRequirement : [],
        sourceBlockIds: [id],
      });
    });
  });
  // Reading order and plan ids follow the new blocks.
  outBlocks.forEach((b, i) => { b.sourceOrder = i; });
  const renumbered = outBeats.map((b, i) => ({ ...b, id: `b${i + 1}` }));
  return {
    ...doc,
    contentBlocks: outBlocks,
    lesson: doc.lesson ? { ...doc.lesson, estimatedTeachingMinutes: Math.max(3, Math.round(outBlocks.length * 1.1)) } : doc.lesson,
    lessonPlan: {
      ...(doc.lessonPlan as object),
      beats: renumbered,
      contentBlockIds: outBlocks.map((b) => b.id),
      targetBeatCount: outBlocks.length,
      teachingOrders: { level, ideas: types.filter(Boolean) },
    } as SuprnotesLessonInput["lessonPlan"],
  };
}
