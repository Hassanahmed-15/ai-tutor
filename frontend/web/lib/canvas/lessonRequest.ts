import type { ProgressiveLectureInput } from "../progressiveLectureTypes";
import type { PlanningKnowledge } from "../knowledge/graph";
import { isDirectQuestion, isTopicRequest } from "../planPrompt";
import { resolveDepth } from "../learnerProfile";
import { buildTeachingPolicy, policyForCanvasPlan, type TeachingPolicy } from "../teachingPolicy";
import type { SuprnotesLessonInput } from "../suprnotes";
import { CANVAS_CODE_LINES, documentForCanvas, documentListings, extraBoardsForListings, listingIndex } from "./documentContext";
import { strictPlanSection, videoParts, videoPlanSection } from "./sourceLessons";
import { isVideoSource } from "../youtube/videoSource";

/**
 * WHICH LECTURES ARE TAUGHT ON THE LESSON CANVAS, and what its planner is told about them.
 *
 * Pure, so it is unit-tested (lib/anim/lessonCanvas.test.ts). lib/progressiveLectureStore.ts reads
 * `canvasEngineFor` when a lecture is created; lib/canvas/progressive.ts sends `canvasPlanRequest`.
 */

/**
 * EVERY lecture from a typed prompt is taught on the canvas — programming included, now that the
 * canvas has a code stage (a listing walked through line by line, with its trace and output). One
 * engine means one way of deciding what a board needs; programming topics used to fall to the
 * ordinary boards, whose keyword rules made every board that named a construct a code board.
 * Lectures made from a document keep the ordinary boards (they quote and picture the pages).
 * CANVAS_LECTURES=0 puts every lecture back on the ordinary boards.
 */
export function canvasEngineFor(input: ProgressiveLectureInput, env: Record<string, string | undefined> = process.env): boolean {
  if (env.CANVAS_LECTURES === "0") return false;
  if (referenceDocumentOf(input) || strictDocumentOf(input) || videoDocumentOf(input)) return true;
  if (input.sourceType !== "prompt") return false;
  return !(input.suprnotes || input.context || input.transcript || input.documentId || input.selection || input.slideImages?.length);
}

/**
 * A PDF used "as a reference" is taught on the canvas too — the same boards, animations, code
 * stage and screen as a typed prompt — with the whole document as extra context
 * (lib/canvas/documentContext.ts). STRICT mode keeps the ordinary boards and its PDF workspace, and
 * so does a lecture on a region the student boxed on the page (a `selection`).
 */
export function referenceDocumentOf(input: ProgressiveLectureInput): SuprnotesLessonInput | null {
  if (input.sourceType !== "pdf" || input.sourceScope?.fidelity !== "reference" || input.selection) return null;
  const doc = input.suprnotes as SuprnotesLessonInput | undefined;
  return doc && typeof doc === "object" && Array.isArray(doc.contentBlocks) && doc.contentBlocks.length > 0 ? doc : null;
}

/**
 * A PDF taught STRICTLY from the source is on the canvas too (2026-10-10, the student's ask: the
 * same animation quality as a typed prompt), with its PDF panel beside the board boxing what is
 * being said (lib/canvas/sourceLessons.ts). A boxed region (`selection`) keeps the ordinary boards.
 */
export function strictDocumentOf(input: ProgressiveLectureInput): SuprnotesLessonInput | null {
  if (input.sourceType !== "pdf" || input.sourceScope?.fidelity !== "strict" || input.selection) return null;
  const doc = input.suprnotes as SuprnotesLessonInput | undefined;
  return doc && typeof doc === "object" && Array.isArray(doc.contentBlocks) && doc.contentBlocks.length > 0 ? doc : null;
}

/** A YouTube video's lesson, on the canvas: one board per part of the video, strictly from it. */
export function videoDocumentOf(input: ProgressiveLectureInput): SuprnotesLessonInput | null {
  if (input.sourceType !== "youtube" || !isVideoSource(input.suprnotes)) return null;
  const doc = input.suprnotes as SuprnotesLessonInput;
  return videoParts(doc).length > 0 ? doc : null;
}

/**
 * The planner's request: the topic, the student, and — what makes it THIS lecture rather than a
 * generic one — the outline the student approved in the planning conversation, at the depth they
 * chose. The system prompt's "6 to 8 boards" is the default these lines override.
 */
export function canvasPlanRequest(input: ProgressiveLectureInput, knowledge?: PlanningKnowledge): string {
  const lines = [`Topic: ${input.topic}`];
  const asked = input.focus?.replace(/\s+/g, " ").trim();
  if (asked && asked.toLowerCase() !== input.topic.toLowerCase()) lines.push(`The student asked: "${asked.slice(0, 400)}"`);

  const p = input.learnerProfile;
  // THE TEACHING POLICY (lib/teachingPolicy.ts) — grade, preferences, support and this lesson's
  // evidence as rules — before the portrait, which is background and may be cut. Without a profile,
  // the planning conversation's summary is all there is.
  const policy = canvasPolicy(input);
  lines.push(
    "",
    policy
      ? `${policyForCanvasPlan(policy)}\nOn this topic they are ${p.expertise}. Pitch every script — its words, its examples, how much it assumes — for this student.`
      : `THE STUDENT: ${p.expertise}, learning for ${p.goal === "curiosity" ? "curiosity" : `${p.goal} reasons`}, who learns best from ${p.preferredExamples === "mixed" ? "a mix of" : p.preferredExamples} examples. Pitch every script — its words, its examples, how much it assumes — for this student.`,
  );
  // Lessons taught strictly from a source (lib/canvas/sourceLessons.ts) — no persona: its interests
  // and examples are exactly the outside material a strict lesson may not bring in.
  const strictDoc = strictDocumentOf(input);
  const video = videoDocumentOf(input);
  const persona = input.learnerPersona?.trim();
  if (persona && !strictDoc && !video) lines.push("", persona.slice(0, 2000));

  const parts = input.outline?.subtopics.filter((s) => s.title.trim()) ?? [];
  const request = `${input.topic} ${input.focus ?? ""}`;
  // The planner's own reading of the request (lib/planPrompt.ts) when there is no approved outline.
  // A strict PDF lesson is a question exactly when the page narrowed it to one (LearnPage
  // questionFromUpload); a video lesson never is.
  const strictQuestion = strictDoc && input.sourceScope && input.sourceScope.breadth.kind !== "whole" ? input.sourceScope.breadth.focus : null;
  const question = strictDoc ? Boolean(strictQuestion) : video ? false : input.outline ? input.outline.scope === "question" : isDirectQuestion(input.focus || input.topic) && !isTopicRequest(input.focus || input.topic);
  const boards = canvasBoardCount(input);

  // How much to teach is the PLANNER'S decision (the outline the student approved). The canvas
  // renders it — one board per part — and never pads it into a lesson-shaped template.
  const doc = referenceDocumentOf(input);
  const listings = doc ? documentListings(doc) : [];
  const splits = extraBoardsForListings(listings);
  if (parts.length > 0) {
    lines.push(
      "",
      `THE APPROVED OUTLINE — exactly ${boards} board${boards === 1 ? "" : "s"}, one per part, in this order (ids b1 to b${boards}). Each board teaches its part — what its line below says — and nothing that belongs to another part:`,
      ...parts.slice(0, boards).map((s, i) => `b${i + 1}. ${s.title}${s.caption ? ` — ${s.caption}` : ""}`),
    );
    if (splits > 0) lines.push(`The one exception: a part that teaches a code listing too long for one board (more than ${CANVAS_CODE_LINES} lines of code) takes CONSECUTIVE boards, one per piece of the listing — at most ${splits} extra board${splits === 1 ? "" : "s"} in the whole lesson for this, and none for anything else.`);
  } else if (strictDoc || video) {
    lines.push("", "HOW MANY BOARDS: as the section about the student's source below says.");
  } else {
    lines.push(
      "",
      question
        ? "HOW MANY BOARDS: this is one focused question. Answer it on ONE board; use a second only if one genuinely cannot answer it completely."
        : `HOW MANY BOARDS: as many as "${request.trim()}" genuinely contains — one per distinct idea, in teaching order, no padding and no maximum. A narrow topic may need two or three; a broad one more.`,
    );
  }
  // What the knowledge graph says about this student and topic (lib/knowledge/planning.ts).
  const refresher = canvasRefresherAllowed(input, knowledge);
  // Not for a lesson strictly from a source: earlier lessons and refreshers are outside material.
  if (knowledge && !strictDoc && !video && (knowledge.mastered.length || knowledge.shaky.length || knowledge.earlier.length)) {
    lines.push("", "WHAT THIS STUDENT ALREADY KNOWS (from their earlier lessons):");
    if (knowledge.mastered.length) lines.push(`- Already solid: ${knowledge.mastered.join(", ")}. Do not teach these again — mention them in passing as things they know.`);
    if (knowledge.earlier.length) lines.push(`- Learned in earlier lessons: ${knowledge.earlier.map((e) => `${e.label} (in "${e.topic}")`).join(", ")}. Build on these instead of re-explaining them, and say so out loud at least once, naming the earlier lesson ("remember electron shells from your lesson on atoms?").`);
    if (refresher) lines.push(`- Shaky on what this builds on: ${knowledge.shaky.map((s) => `${s.label} (needed for ${s.for})`).join(", ")}. Put ONE short extra board FIRST that refreshes ${knowledge.shaky[0].label} — 3 sentences, "refresher": true — then the lesson's own boards. It is the only board you may add.`);
  }
  if (question) lines.push(`This lesson ANSWERS ONE QUESTION: "${(strictQuestion || input.focus || input.topic).trim()}". The first board answers it directly; anything after only completes the answer. No interaction unless the student asked to practise.`);

  // Depth buys WORDS PER BOARD, never boards (the rule the ordinary lecture planner follows too).
  const depth = p.depth;
  const length = video
    ? "as long as its part's key points need — every one of them taught — usually 5 to 10 sentences"
    : boards === 1
    ? "5 to 8 sentences (80 to 140 words) — the whole answer, complete on this one board"
    : depth === "concise" ? "3 or 4 sentences (45 to 70 words)"
    : depth === "deep" ? "6 to 8 sentences (90 to 140 words), going further than a first introduction would"
    : "4 to 6 sentences (60 to 100 words)";
  lines.push("", `SCRIPT LENGTH: each board's script is ${length}.`);
  if (doc) lines.push("", documentPlanSection(doc, listings, Boolean(question)));
  if (strictDoc) lines.push("", strictPlanSection(strictDoc, strictQuestion));
  if (video) lines.push("", videoPlanSection(video));
  return lines.join("\n");
}

/**
 * What the planner reads when the lesson is taught from the student's PDF: the rules, the code
 * listings it must not lose, and the whole document. The system prompt stays the typed prompt's.
 */
function documentPlanSection(doc: SuprnotesLessonInput, listings: ReturnType<typeof documentListings>, question: boolean): string {
  const lines = [
    "THE STUDENT'S DOCUMENT — they uploaded it and asked you to teach FROM it, as a reference. It is printed in full at the end of this request, page by page.",
    "- Teach what the document teaches, in its order, with its own examples, numbers, names and figures (redraw its diagrams on the board — a tree, a table, a process — with its own values). Say where it comes from when it helps (\"your notes put it like this…\", \"the example on page 4…\"). You may explain beyond the document to make an idea clear, but never contradict it and never swap its example for a different one.",
    question
      ? "- The student's words are a QUESTION about this document: answer exactly that, completely, using everything the document says about it — every page that bears on it, not only the first."
      : "- No question was asked: the lesson covers the selected pages as a whole.",
    "- Every board also carries \"source\": {\"pages\": [the page numbers it teaches from], \"listing\": the LISTING number it shows or null, \"lines\": [first, last] printed line numbers of that listing shown on this board, or null}.",
  ];
  if (listings.length) {
    lines.push(
      "",
      "CODE IN THE DOCUMENT — these are ALL its code listings:",
      listingIndex(listings),
      "- A board about code is a \"code\" board that shows the document's OWN listing, copied exactly, in its language — never rewritten in Python, never shortened into pseudo-code, never invented when the document has the code.",
      question
        ? "- When the question is about the document's code (\"explain the code\", \"explain the AVL code\", \"the implementation\"), it means EVERY listing above that the question covers — all of them when it names no particular routine — in the document's order. Never stop after the first routine: insertion, deletion and the helpers they call are all part of \"the code\"."
        : "- Every listing above is taught on a code board, in the document's order.",
      `- A board shows at most ${CANVAS_CODE_LINES} lines of code. A longer listing is taught on CONSECUTIVE code boards, split where one function ends or between two complete statements — never between an if or else and the line it controls, and never between a { and the lines it opens — each board naming its "lines". A board may leave out the comment block above a function (say what it says instead).`,
      "- A code board's script walks through its lines in order — what each part does and why — with 6 to 10 sentences, so every few lines get their own sentence.",
      "- NEVER say a line number aloud (\"line 27\", \"lines 1 through 6\"): each board numbers its own lines from 1, so a spoken number points at the wrong line. Name the code instead (\"the null check\", \"the call to balance\", \"the two recursive calls\") — the board lights the lines as you say them.",
    );
  }
  lines.push("", "THE DOCUMENT:", documentForCanvas(doc));
  return lines.join("\n");
}

/** How many boards beyond the outline a reference document's long code listings may add. */
export function documentExtraBoards(input: ProgressiveLectureInput): number {
  const doc = referenceDocumentOf(input);
  return doc ? extraBoardsForListings(documentListings(doc)) : 0;
}

/** The lecture's Teaching Policy, or null for a student without a profile. */
export function canvasPolicy(input: ProgressiveLectureInput): TeachingPolicy | null {
  if (!input.studentCard) return null;
  return buildTeachingPolicy(input.studentCard, { learner: input.learner, depth: input.learner ? resolveDepth(input.learner) : null });
}

/**
 * How many boards the plan is told to write: the approved outline's parts, one each (the planner
 * already sized it — a question is 1-2, a topic as many as it contains); with no outline, a ceiling
 * the model plans under. Never a floor: one board is a complete lesson when one board answers it.
 */
/** A refresher board is for a LESSON whose topic builds on something the student is shaky on — never for a question. */
export function canvasRefresherAllowed(input: ProgressiveLectureInput, knowledge?: PlanningKnowledge): boolean {
  if (strictDocumentOf(input) || videoDocumentOf(input)) return false;
  return Boolean(knowledge?.shaky.length) && input.outline?.scope !== "question" && (input.outline?.subtopics.length ?? 2) >= 2;
}

export function canvasBoardCount(input: ProgressiveLectureInput): number {
  const parts = input.outline?.subtopics.filter((s) => s.title.trim()).length ?? 0;
  if (parts > 0) return Math.min(14, parts);
  return 0;
}

/** How long a board's narration runs, at a teacher's ~150 words a minute, plus the pauses. */
export function canvasBoardDurationMs(script: string): number {
  const words = script.split(/\s+/).filter(Boolean).length;
  return Math.round(words * 400 + 3000);
}
