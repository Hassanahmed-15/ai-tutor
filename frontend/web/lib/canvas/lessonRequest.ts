import { isLadder, ladderBoardBudget, ladderCanvasSection, strictLadderSection } from "./conceptLadder";
import type { ProgressiveLectureInput } from "../progressiveLectureTypes";
import type { PlanningKnowledge } from "../knowledge/graph";
import { isDirectQuestion, isTopicRequest } from "../planPrompt";
import { resolveDepth } from "../learnerProfile";
import { buildTeachingPolicy, policyForCanvasPlan, type TeachingPolicy } from "../teachingPolicy";
import type { SuprnotesLessonInput } from "../suprnotes";
import { termsNotInDocument, substantivePages, CANVAS_CODE_LINES, documentForCanvas, documentListings, extraBoardsForListings, listingIndex } from "./documentContext";
import { strictPlanSection, videoParts, videoPlanSection } from "./sourceLessons";
import { isVideoSource } from "../youtube/videoSource";
import { packForPrompt } from "../webSources";
import { isDataStructureTopic } from "./structure";
import { csPlanRule, isTypedCsTopic, isTypedDsaTopic } from "./csLessons";
import { isCsTopic, isLabLookTopic } from "./subjectLook";

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
  if (referenceDocumentOf(input) || strictDocumentOf(input) || videoDocumentOf(input) || curriculumDocumentOf(input)) return true;
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

/**
 * A COURSE LESSON (lib/curriculum/lessonSpec.ts): its official outcomes, planned as boards from the
 * syllabus, taught on the canvas like a typed prompt — one board per planned board, nothing outside
 * the outcomes or the level.
 */
export function curriculumDocumentOf(input: ProgressiveLectureInput): SuprnotesLessonInput | null {
  if (input.sourceType !== "suprnotes") return null;
  const doc = input.suprnotes as SuprnotesLessonInput | undefined;
  const plan = doc?.lessonPlan as { sourceType?: string; beats?: unknown[] } | undefined;
  return doc && typeof doc === "object" && plan?.sourceType === "curriculum" && Array.isArray(doc.contentBlocks) && doc.contentBlocks.length > 0 ? doc : null;
}

/** The course lesson's planned boards, as outline parts (title + what it teaches). */
function curriculumParts(doc: SuprnotesLessonInput): Array<{ title: string; caption?: string }> {
  const beats = ((doc.lessonPlan as { beats?: Array<{ title?: string; objective?: string }> } | undefined)?.beats ?? []);
  return beats.filter((b) => b.title?.trim()).map((b) => ({ title: b.title!.trim(), caption: b.objective?.trim() || undefined }));
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
      ? `${policyForCanvasPlan(policy, referenceDocumentOf(input) || strictDocumentOf(input) ? "pdf" : curriculumDocumentOf(input) ? "course" : undefined)}\nOn this topic they are ${p.expertise}. Pitch every script — its words, its examples, how much it assumes — for this student.`
      : `THE STUDENT: ${p.expertise}, learning for ${p.goal === "curiosity" ? "curiosity" : `${p.goal} reasons`}, who learns best from ${p.preferredExamples === "mixed" ? "a mix of" : p.preferredExamples} examples. Pitch every script — its words, its examples, how much it assumes — for this student.`,
  );
  // Lessons taught strictly from a source (lib/canvas/sourceLessons.ts) — no persona: its interests
  // and examples are exactly the outside material a strict lesson may not bring in.
  const strictDoc = strictDocumentOf(input);
  const video = videoDocumentOf(input);
  const persona = input.learnerPersona?.trim();
  if (persona && !strictDoc && !video) lines.push("", persona.slice(0, 2000));

  const course = curriculumDocumentOf(input);
  const parts = course && !input.outline ? curriculumParts(course) : input.outline?.subtopics.filter((s) => s.title.trim()) ?? [];
  const request = `${input.topic} ${input.focus ?? ""}`;
  // The planner's own reading of the request (lib/planPrompt.ts) when there is no approved outline.
  // A strict PDF lesson is a question exactly when the page narrowed it to one (LearnPage
  // questionFromUpload); a video lesson never is.
  const strictQuestion = strictDoc && input.sourceScope && input.sourceScope.breadth.kind !== "whole" ? input.sourceScope.breadth.focus : null;
  const question = strictDoc ? Boolean(strictQuestion) : video || course ? false : input.outline ? input.outline.scope === "question" : isDirectQuestion(input.focus || input.topic) && !isTopicRequest(input.focus || input.topic);
  const boards = canvasBoardCount(input);

  // How much to teach is the PLANNER'S decision (the outline the student approved). The canvas
  // renders it — one board per part — and never pads it into a lesson-shaped template.
  const doc = referenceDocumentOf(input);
  const listings = doc ? documentListings(doc) : [];
  const splits = extraBoardsForListings(listings);
  // A strict lecture on the whole selection teaches every page: when its outline's parts do not reach
  // them all, boards for the remaining pages follow the parts (PDF bench, 2026-10-18: 2 of 10 pages).
  const pageBoards = strictDoc && !question && input.sourceScope?.breadth.kind === "whole" ? Math.max(0, Math.min(14, substantivePages(strictDoc).length) - boards) : 0;
  if (parts.length > 0 && isLadder(input.outline?.subtopics)) {
    // THE CONCEPT LADDER (owner, 2026-10-20): what the student does not know is built from scratch.
    lines.push(...ladderCanvasSection(input.outline!.subtopics, typedCsLesson(input)));
  } else if (parts.length > 0) {
    lines.push(
      "",
      `THE APPROVED OUTLINE — ${pageBoards ? `${boards} board${boards === 1 ? "" : "s"} for its parts` : `exactly ${boards} board${boards === 1 ? "" : "s"}`}, one per part, in this order (ids b1 to b${boards}). Each board teaches its part — what its line below says — and nothing that belongs to another part:`,
      ...parts.slice(0, boards).map((s, i) => `b${i + 1}. ${s.title}${s.caption ? ` — ${s.caption}` : ""}`),
    );
    if (pageBoards > 0) lines.push(`EVERY SELECTED PAGE IS TAUGHT: after b${boards}, add up to ${pageBoards} more board${pageBoards === 1 ? "" : "s"} (b${boards + 1} on), one for each selected page the parts above do not reach, in page order, each teaching that page from its own words and naming it in "source.pages".`);
    if (splits > 0) lines.push(`The one exception: a part that teaches a code listing too long for one board (more than ${CANVAS_CODE_LINES} lines of code) takes CONSECUTIVE boards, one per piece of the listing — at most ${splits} extra board${splits === 1 ? "" : "s"} in the whole lesson for this, and none for anything else.`);
  } else if (strictDoc || video) {
    lines.push("", "HOW MANY BOARDS: as the section about the student's source below says.");
  } else {
    lines.push(
      "",
      question
        ? "HOW MANY BOARDS: this is one focused question. Answer it completely and with nothing more: ONE board for a narrow fact, meaning or single cause; two or three for a how or why about a process, each a different step of the answer."
        : `HOW MANY BOARDS: as many as "${request.trim()}" genuinely contains — one per distinct idea, in teaching order, no padding and no maximum. A narrow topic may need two or three; a broad one more.`,
    );
  }
  // What the knowledge graph says about this student and topic (lib/knowledge/planning.ts).
  const refresher = canvasRefresherAllowed(input, knowledge);
  // Not for a lesson strictly from a source: earlier lessons and refreshers are outside material.
  if (knowledge && !strictDoc && !video && (knowledge.mastered.length || knowledge.shaky.length || knowledge.earlier.length)) {
    lines.push("", "WHAT THIS STUDENT ALREADY KNOWS (from their earlier lessons):");
    if (knowledge.mastered.length) lines.push(`- Already solid: ${knowledge.mastered.join(", ")}. Do not teach these again — mention them in passing as things they know.`);
    if (knowledge.earlier.length) lines.push(`- Learned in earlier lessons: ${knowledge.earlier.map((e) => `${e.label} (in "${e.topic}")`).join(", ")}. Where one of these is genuinely part of this topic, build on it instead of re-explaining it and name the earlier lesson out loud. Never force a link to an unrelated subject: a complex-numbers lesson that said "remember electron shells from your lesson on atoms" taught nothing (audit 2026-10-17).`);
    if (refresher) lines.push(`- Shaky on what this builds on: ${knowledge.shaky.map((s) => `${s.label} (needed for ${s.for})`).join(", ")}. Put ONE short extra board FIRST that refreshes ${knowledge.shaky[0].label} — 3 sentences, "refresher": true — then the lesson's own boards. It is the only board you may add.`);
  }
  // What Aria read up on before planning (lib/webResearch.ts): the scripts teach FROM it, and each
  // slide shows the links it drew on. Not for a lesson from the student's own document or video.
  const pack = input.webSources;
  if (pack && !strictDoc && !video && !doc) {
    lines.push(
      "",
      `TEACH FROM THIS MATERIAL — what Aria read up on for this lesson; the slides show the links they drew on by themselves. The [S1]-style tags are for you only: never put a source tag or a "Sources:" line in a script — every word of a script is spoken aloud. Every fact a script states comes from this material (plain connecting explanation, analogies and worked examples in your own words are fine; a new fact, number or claim is not).${
        pack.checklist.length ? " Name every syllabus point below on the board where it belongs, in the syllabus's own terms." : ""
      }`,
      packForPrompt(pack, 8_000),
    );
    // The student's level from their profile's Study level (lib/lessonIntent.ts): a rule, not a hint.
    if (pack.audience) lines.push("", `THE LEVEL: ${pack.audience}. Teach exactly at this level — its depth, terms and expectations: nothing from a higher level, and nothing it takes for granted explained as if new.`);
  }
  // Strict: a question about something the pages never mention is answered by saying so (2026-10-18).
  const absent = strictDoc && question ? termsNotInDocument(strictQuestion || input.focus || input.topic, strictDoc) : [];
  if (absent.length) lines.push(`THE STUDENT'S DOCUMENT NEVER MENTIONS: ${absent.join(", ")}. The first sentence says so plainly ("Your document does not mention ${absent[0]}."); then, only if its pages say something closely related, teach that from the pages — never calling it "${absent[0]}" or by any name the pages do not use. Keep it to one short board.`);
  if (question) lines.push(`This lesson ANSWERS ONE QUESTION: "${(strictQuestion || input.focus || input.topic).trim()}". ${doc || strictDoc ? "The first board answers it directly; anything after only completes the answer." : 'Each board is one step of the answer, in order, and together they answer it completely: the first gets straight to it (no introduction), a "how" explains the mechanism itself (what moves, contracts or changes), and no board repeats another.'} No interaction unless the student asked to practise.`);

  // Depth buys WORDS PER BOARD, never boards (the rule the ordinary lecture planner follows too).
  const depth = p.depth;
  const length = video
    ? "as long as its part's key points need — every one of them taught — usually 5 to 10 sentences"
    // A course board teaches its listed key points: a fixed 4 to 6 sentences left 2 to 4 for up to
    // nine key points once the prediction and its answer were said, and outcomes went untaught
    // (coverage audit 2026-10-17). Each board's own length is given in its plan block.
    : course
    ? "as long as its key points need — the sentence count given for each board in THE LESSON PLAN below"
    : isLadder(input.outline?.subtopics)
    ? "4 to 7 sentences (60 to 120 words): the rungs it climbs, each step said plainly, never rushed"
    : boards === 1
    ? "5 to 8 sentences (80 to 140 words) — the whole answer, complete on this one board"
    : depth === "concise" ? "3 or 4 sentences (45 to 70 words)"
    : depth === "deep" ? "6 to 8 sentences (90 to 140 words), going further than a first introduction would"
    : "4 to 6 sentences (60 to 100 words)";
  lines.push("", `SCRIPT LENGTH: each board's script is ${length}.`);
  // WORKING IS NEVER SQUEEZED (owner, 2026-10-22: "it shows direct steps"). The length above made
  // the writer compress an eight-step derivation into "this gives the result"; working boards are as
  // long as their steps — the board wipes when full and a longer one continues on the next board
  // (lib/canvas/splitWorking.ts).
  // A typed-prompt computer-science lesson (lib/canvas/csLessons.ts): niche CS topics the shared checks
  // miss (KMP, Bloom filters, Raft, paging…) get the CS rules too. PDF, video and course lessons keep the shared checks.
  const typedPrompt = !doc && !strictDoc && !video && !course;
  const lessonText = [input.topic, asked, ...(input.outline?.subtopics ?? []).map((s) => s.title)].join(" ");
  const typedCs = typedPrompt && isTypedCsTopic(lessonText);
  if (!strictDoc && !video && (typedCs || isLabLookTopic(lessonText))) {
    lines.push("A board that WORKS something out — a proof, a derivation, a worked example, a rearrangement — is as long as its steps, past the length above: ONE sentence per step, every step a textbook shows (each expansion, substitution, cancelling, rearrangement and the result), with its reason, up to 10 sentences; longer working continues on the next board by itself. Never compress working to fit a length (\"this gives the result\", \"simplifying, we get\" with the line missing).");
  }
  // DATA STRUCTURES are taught with the structure itself on the board (owner's direction, 2026-10-15).
  // A source lesson keeps its own rules: its boards follow the document or the video.
  // A typed prompt (no PDF, video or course behind it) also counts the graph algorithms the shared list
  // misses: "BFT in Bipartite Graphs" got none of this and drew no graph (owner, 2026-10-23).
  const typedDsa = typedPrompt && isTypedDsaTopic(lessonText);
  if (typedDsa) lines.push("", TYPED_DSA_PLAN);
  // The picture each kind of CS topic needs: a protocol as machines and messages, KMP as cells and pointers.
  const picture = typedCs ? csPlanRule(lessonText) : null;
  if (picture) lines.push("", picture);
  if (!strictDoc && !video && (typedPrompt ? typedDsa : isDataStructureTopic(lessonText))) {
    lines.push(
      "",
      "THIS IS A DATA STRUCTURES / ALGORITHMS LESSON: every board that runs an operation (insert, search, delete, traverse, rotate, push, pop, swap, BFS, DFS) is a \"code\" board in REAL code — Python, or the exam board's pseudocode when the syllabus uses it — every line a statement, never a description (\"shift 7 right\", \"search cost: inspect up to n nodes\") — with the structure drawn beside it, changing line by line; a board that explains the structure itself is a \"structure\" board; never illustration, flow or scene for a data structure. Each brief names the starting values and the operation, and the script walks it one step per sentence with those same values — a board that runs an operation may take up to 10 sentences for that.",
    );
  }
  // MATHS AND COMPUTER SCIENCE are taught in a visible structure (owner, 2026-10-21: "keep your
  // intentions clear and teach in a structured way — I really don't get how you teach"; "if there is
  // any proof it should build step by step"). Not for a lesson strictly from a source: its order is the source's.
  if (!strictDoc && !video && (typedCs || isLabLookTopic(lessonText))) lines.push("", MATHS_CS_TEACHING);
  // COMPUTER SCIENCE is taught as a CS teacher teaches it (owner's manager, a CS teacher, 2026-10-22:
  // the visuals and code were nice but it "never really teaches" and did not explain its visuals).
  if (!strictDoc && !video && (typedPrompt ? typedCs : isCsTopic(lessonText))) lines.push("", CS_TEACHING);
  if (doc) lines.push("", documentPlanSection(doc, listings, Boolean(question)));
  if (strictDoc) lines.push("", strictPlanSection(strictDoc, strictQuestion));
  // What the student already knows of these pages (lib/intake.ts): how deep each part goes.
  if (strictDoc && !strictQuestion && input.learner?.parts?.length) lines.push(...strictLadderSection(input.learner.parts));
  if (video) lines.push("", videoPlanSection(video));
  if (course) lines.push("", curriculumPlanSection(course));
  return lines.join("\n");
}

/**
 * A TYPED DATA-STRUCTURES LESSON, PLANNED THE WAY DSA IS TAUGHT WELL (owner, 2026-10-23: a bipartite
 * lecture drew no graph and drifted into maximum matching; a linked-list reversal "made no sense").
 * One small example from start to finish (textbook figures, VisuAlgo), the structure on every working
 * board, and every board on the question asked.
 */
export const TYPED_DSA_PLAN = [
  "THIS LESSON TEACHES A DATA STRUCTURE OR ALGORITHM FROM A TYPED REQUEST:",
  "- Choose ONE small example before planning — 4 to 7 nodes with short names (A–G, or small numbers), e.g. a 5-vertex graph with one odd cycle for bipartite checking, or the list 1 → 2 → 3 → None for reversal — and name it, with its values AND its links (\"A→C, B→C, B→E, C→D, D→F\"), in EVERY board's brief. Every board uses that same example; a later board continues from the state the earlier one ended in.",
  "- Every board that explains or runs the algorithm DRAWS THE STRUCTURE ITSELF (a \"code\" board with the structure beside the code, or a \"structure\" board) — a graph lesson draws the graph, a linked-list lesson draws the list. Never teach a structure only in words or as a dictionary of values.",
  "- Two-colouring (bipartite checks, graph colouring) is SHOWN: the brief says which vertex goes in Set A and which in Set B, step by step, and where the same-set edge is when the graph is not bipartite.",
  "- Linked-list operations are shown ONE POINTER AT A TIME: the brief says which link turns on which sentence (\"1.next now points to None\"), and pointers that hold None are named.",
  "- STAY ON THE QUESTION ASKED: every board serves it. Never add a board on a different problem (asked how to detect a bipartite graph, there is no board on maximum matching, Hopcroft–Karp or flows).",
  "- Code is Python unless the student named another language.",
].join("\n");

/** How a maths or computer-science lesson is taught: its structure said out loud, proofs built step by step. */
export const MATHS_CS_TEACHING = [
  "THIS IS A MATHS / COMPUTER SCIENCE LESSON — TEACH IT IN A STRUCTURE THE STUDENT CAN SEE:",
  "- Each board's FIRST sentence says what this board is going to do, in plain words, and how it follows from the last board (\"We found the gradient; now we use it to find the tangent.\"). Never open with a bare fact.",
  "- Each new idea is taught in this order — what it is, a picture of it, a worked example with real numbers or values, then the general rule or a quick check for the student — on one board or over several, as the boards above are sized. A board never starts a second new idea.",
  "- Each step is said with its PURPOSE first, then the step: \"To get x on its own, we subtract 3 from both sides.\" Never a step without its reason.",
  "- A PROOF is built step by step, never stated whole: first say what will be proved; then draw the figure; then ONE step per sentence, each saying what we do and why it is allowed; the result is said only at the end (\"So a² + b² = c².\"), earned by the steps before it. Never skip a line of algebra: each rearrangement is its own sentence (\"so 360° − 2x − 2y = 180°, so 2x + 2y = 180°, so x + y = 90°\"). A general proof stays general — letters, no example numbers. A long proof takes consecutive boards, each continuing the same figure.",
  "- Say a matrix by its rows, never as brackets read aloud (\"the matrix with rows 1, 2 and 3, 4\", not \"[[1, 2], [3, 4]]\"); the board writes it as a matrix. Say every answer as an equation (\"so c = 10 centimetres\", \"so f′(x) = 2x\"): the board writes what is said.",
  "- Never skip a line of algebra — in a proof, a derivation or a worked example: each expansion, cancellation or rearrangement is said (\"(2 + h)² − 4 = 4h + h², and dividing by h gives 4 + h\"). Rearranging a formula, each operation on both sides is its own line, and the operation named is the one that gives that line (\"a ÷ sin A = b ÷ sin B; multiplying both sides by sin A sin B gives a sin B = b sin A; dividing by a gives sin B = b sin A ÷ a\") — never one named step that actually needs two.",
  "- State every condition a conclusion needs, as a mark scheme does: parallel vectors AND a shared point for collinear points; a ≠ 0 for a quadratic; a right-angled triangle for Pythagoras.",
  "- The standard case comes first: a normal worked example before any special case (an impossible or ambiguous triangle, a zero denominator, no real roots).",
  "- Code: say what the code is for, then what each line does, then trace it with real values, one step per sentence.",
  "- Each board's LAST sentence says what we now know — the result the next board builds on.",
].join("\n");

/** How a computer-science lesson is taught: as a CS teacher teaches, explaining everything it draws. */
export const CS_TEACHING = [
  "THIS IS A COMPUTER SCIENCE LESSON — TEACH IT AS A GOOD CS TEACHER DOES. A student who has never seen the topic must understand WHAT it is, WHY it works and HOW to write and trace it.",
  "- Each concept, over as many boards as it needs, in this order: WHY (the problem it solves, in one concrete situation) → THE IDEA (a real-world analogy, then a pencil \"sketch\" board of the idea with real values: boxes for memory and variables, arrows for references and pointers, the structure itself) → HOW IT WORKS (the rule or algorithm in plain steps, done by hand on that sketch with small real values, one step per sentence) → THE CODE (each line written and explained in its own sentence) → THE TRACE (the code run on concrete input, one executed line per sentence) → EDGE CASES AND MISTAKES (the empty input, the boundary, the classic bug and its fix) → COST (time and space complexity, with the reason, when the level includes it) → a CHECK (predict what a small change does).",
  "- THE CODE is real and runnable — Python unless the student or the syllabus names another language or the exam board's pseudocode, which then follows that board's conventions. Never prose dressed as code (\"push(stack, item): add item to top\"). Each line gets its OWN sentence saying what it does and WHY it is needed (\"Line 2 checks for the base case, because without it the calls would never stop\"); never \"the rest of the code\", never several lines in one sentence.",
  "- THE TRACE says, one executed line per sentence, what changes: each variable's new value, each call pushed or returned on the call stack, each node, pointer or element added, moved or removed, and what is printed. The values are the ones the code really produces. One loop pass or one call per sentence at least — never a whole loop in one sentence (\"the loop compares 9, then 2 and 7, and returns 9\"); a long run traces its first passes in full, then says the rest briefly.",
  "- ONE FUNCTION PER CODE BOARD, at most about 10 lines. A board about boundary cases or mistakes shows only the lines it adds or changes (the guard, the fixed line), never every function again.",
  "- EXPLAIN THE VISUAL AS IT IS DRAWN: every box, arrow, pointer, value, label and line of code on a board is named in the sentence that draws or lights it, and what it MEANS is said (\"this arrow is next — the address of the following node\"). Nothing appears on a board that Aria does not say.",
  "- Every term is defined in plain words the first time it is used (stack frame, pointer, index, base case, LIFO, mutable), with what it looks like on the board.",
  "- A code board shows the program working beside the code — the data structure it changes, the call stack for recursion (one frame per call, pushed and popped), or the variables with their values — so the student sees each line's effect as it is said. A code board is as long as its lines and its trace need (one sentence each, up to 10); a longer one continues on the next board by itself.",
].join("\n");

/** The steps of a block's worked example ("Worked example: 1. … 2. …" or sentences), at most 6. */
export function workedSteps(text = ""): number {
  const worked = /Worked example:\s*([\s\S]*?)(?:\n\n|$)/.exec(text)?.[1] ?? "";
  if (!worked.trim()) return 0;
  const numbered = worked.match(/(?:^|\s)\d+[.)]\s/g)?.length ?? 0;
  const sentences = worked.split(/(?<=[.!?;])\s+/).filter((x) => x.trim().length > 3).length;
  return Math.min(6, Math.max(2, numbered || sentences));
}

/**
 * Sentences a course board needs — enough to explain its content completely, never more. Depth is
 * that nothing is missed (every key point explained, the worked case done, the standard cases
 * covered), not length: one sentence per key point, one per worked step, plus the prediction and
 * its answer, capped at 11 (a board with more to say is two boards in the lesson plan). Owner,
 * 2026-10-17: "length shouldn't be the goal".
 */
export function courseBoardSentences(block: { keyIdeas?: string[]; text?: string }): number {
  const points = block.keyIdeas?.length ?? 0;
  return Math.max(6, Math.min(11, points + Math.min(4, workedSteps(block.text)) + 3));
}

/** What the planner reads for a course lesson: its official outcomes and the board plan made from the syllabus. */
function curriculumPlanSection(doc: SuprnotesLessonInput): string {
  const goals = doc.lesson?.learningGoals ?? [];
  const plan = doc.lessonPlan as { beats?: Array<{ title?: string; objective?: string; outcomeRefs?: number[]; visualRequirement?: Array<{ preferredStages?: string[]; mustShow?: string[] }> }>; visualRequirements?: Array<{ outcomeRef?: number; preferredStages?: string[]; mustShow?: string[]; reason?: string }> } | undefined;
  const planBeats = plan?.beats ?? [];
  return [
    `THIS IS A LESSON OF AN OFFICIAL COURSE (${doc.lesson?.level ?? "its level"}). Its learning outcomes are fixed by the syllabus:`,
    ...goals.map((g, i) => `${i + 1}. ${g}`),
    "- Teach EXACTLY these outcomes, at this level: every outcome is taught on the board planned for it, with the key points, worked example, terms and depth given below. Use the course's vocabulary and notation.",
    "- Nothing outside them: what the lesson plan lists under \"Do not teach\" is beyond this level — leave it out even if it seems helpful.",
    "- Every board also carries \"source\": {\"pages\": [the syllabus page numbers it draws on], \"listing\": null, \"lines\": null}.",
    "",
    "THE LESSON PLAN (one block per board, in order):",
    documentForCanvas(doc),
    "",
    "WHAT EACH BOARD'S SCRIPT MUST DO — explain its part of the topic so completely that nothing is missed, and say nothing twice:",
    "  1. every key point of its block, in the mark scheme's precise wording; a point about HOW or WHY (a process, cause, adaptation, method or effect) is said with its reason or mechanism (\"because…\", \"which means…\"); a definition or plain fact is just stated;",
    "  2. its worked example walked one step per sentence, with every number, unit or named detail it uses, to its answer;",
    "  3. the prediction question and its answer.",
    "  A common mistake from a \"Watch for\" line is corrected only on the board it belongs to (two or three in the whole lesson). Never restate what an earlier board said, never add a summary of the board, never pad.",
    "Sentence counts per board (a ceiling as well as a guide):",
    ...(doc.contentBlocks ?? []).map((block, i) => {
      const n = courseBoardSentences(block);
      if (block.exam) return `- b${i + 1} (${block.heading}): stage "exam", interaction null, diagram "none". The board shows the question, its marks and the mark scheme by itself. The script: read the question and say it is worth ${block.exam.marks} marks; say what the command word "${block.exam.commandWord}" asks for; then ${block.exam.levels?.length ? `say what lifts an answer from each level to the next, top level first, naming each level (${block.exam.levels.length} sentences), then the points a top answer makes` : `give the full-mark answer, ONE sentence per marking point, in the mark scheme's order and wording (${block.exam.markPoints.length} sentences)`}; then say how candidates lose marks and what examiners want instead → ${n} to ${n + 2} sentences.`;
      const steps = workedSteps(block.text);
      // The last board of each outcome closes with how that outcome is examined; the others end on their answer.
      const refs = planBeats[i]?.outcomeRefs ?? [];
      const lastOfOutcome = refs.some((r) => !planBeats.slice(i + 1).some((b) => b.outcomeRefs?.includes(r)));
      return `- b${i + 1} (${block.heading}): ${block.keyIdeas?.length ?? 0} key points${steps ? ` + a ${steps}-step worked example` : ""}${lastOfOutcome ? ' + a closing exam-style question as its "How it is examined" line sets it (command word first, marks said)' : ""} → at most ${n + 1} sentences.`;
    }),
    "",
    "PHASE 3 VISUAL CONTRACT — enforce these requirements in the board stage and visible content:",
    ...(plan?.beats ?? []).map((beat, i) => {
      const refs = beat.outcomeRefs?.length ? `outcomes ${beat.outcomeRefs.join(", ")}` : `board ${i + 1}`;
      const reqs = (beat.visualRequirement ?? []).flatMap((r) => [
        ...(r.preferredStages ?? []),
        ...(r.mustShow ?? []),
      ]);
      return `- ${refs} (${beat.title ?? `board ${i + 1}`}): ${reqs.length ? [...new Set(reqs)].join("; ") : "show the central relationship clearly"}. Do not substitute a decorative icon for required structure, labels, steps or evidence.`;
    }),
  ].join("\n");
}

/**
 * What the planner reads when the lesson is taught from the student's PDF: the rules, the code
 * listings it must not lose, and the whole document. The system prompt stays the typed prompt's.
 */
function documentPlanSection(doc: SuprnotesLessonInput, listings: ReturnType<typeof documentListings>, question: boolean): string {
  const lines = [
    "THE STUDENT'S DOCUMENT — they uploaded it and asked you to teach FROM it, as a reference. It is printed in full at the end of this request, page by page.",
    "- Teach what the document teaches, in its order, with its own examples, numbers, names and figures (redraw its diagrams on the board — a tree, a table, a process — with its own values). Say where it comes from when it helps (\"your notes put it like this…\", \"the example on page 4…\"). You may explain beyond the document to make an idea clear, but never contradict it and never swap its example for a different one.",
    // Prompt bench, 2026-10-18: "In the document's example, inserting 30 into a tree rooted at 40" — the
    // PDF had no such example; and two questions the PDF does not cover were answered with no word saying so.
    // Trunking slides: Erlang C written without its denominator, Erlang B never shown (PDF bench, 2026-10-18).
    "- A FORMULA THE DOCUMENT GIVES is written exactly as the document prints it — every term, the denominator included, its own symbols — never shortened or rewritten from memory; a board that names one of the document's formulas shows it, not only its shorthand.",
    "- NEVER CREDIT THE DOCUMENT WITH WHAT IT DOES NOT SAY: \"the document's example\", \"your notes show\", \"on page 4\" only for what is really on its pages. An example of your own is yours (\"take the values 10, 20, 30\"), never the document's. When the student asks about something the document does not cover, say so in one short phrase first (\"Your notes don't cover this, but…\") and keep the answer short.",
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

/** How many boards beyond the outline a PDF's long code listings may add (reference or strict: the code is on its pages). */
export function documentExtraBoards(input: ProgressiveLectureInput): number {
  const doc = referenceDocumentOf(input) ?? strictDocumentOf(input);
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
/**
 * No refresher boards (owner, 2026-10-18: "I don't want any quick refresher from anywhere"). Every
 * caller still asks here, so this one switch keeps them out of every lecture: the planner is never
 * offered one, and a board it marks as a refresher anyway is taught as an ordinary board (lib/canvas/plan.ts).
 */
export function canvasRefresherAllowed(_input: ProgressiveLectureInput, _knowledge?: PlanningKnowledge): boolean {
  return false;
}

/**
 * A computer-science lesson from a typed prompt (no PDF, video or course behind it; lib/canvas/csLessons.ts):
 * its ladder is compact, one or two boards a new part and ten at most.
 */
export function typedCsLesson(input: ProgressiveLectureInput): boolean {
  if (referenceDocumentOf(input) || strictDocumentOf(input) || videoDocumentOf(input) || curriculumDocumentOf(input)) return false;
  return isTypedCsTopic([input.topic, input.focus ?? "", ...(input.outline?.subtopics ?? []).map((s) => s.title)].join(" "));
}

export function canvasBoardCount(input: ProgressiveLectureInput): number {
  // A lesson on the concept ladder (lib/canvas/conceptLadder.ts) may take up to its ladder's boards.
  if (isLadder(input.outline?.subtopics)) return ladderBoardBudget(input.outline!.subtopics, typedCsLesson(input)).max;
  const course = curriculumDocumentOf(input);
  const parts = course && !input.outline ? curriculumParts(course).length : input.outline?.subtopics.filter((s) => s.title.trim()).length ?? 0;
  if (parts > 0) return Math.min(14, parts);
  return 0;
}

/** How long a board's narration runs, at a teacher's ~150 words a minute, plus the pauses. */
export function canvasBoardDurationMs(script: string): number {
  const words = script.split(/\s+/).filter(Boolean).length;
  return Math.round(words * 400 + 3000);
}
