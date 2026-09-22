/**
 * HOW A LECTURE IS PLANNED — the part of the progressive worker that needs no server.
 *
 * Moved out of lib/progressiveLectureWorker.ts, which is `server-only`, so the plan a real lecture
 * gets can be built and inspected by tests and by the generation harness
 * (scripts/audit-lesson-generation.mjs) without running the queue, Cosmos and the worker. The
 * worker imports from here; nothing here imports from the worker.
 */

import { isRecapTitle, polishBeatPlan } from "./beatPresentation";
import { defaultLadderObjectives, inferRole, orderByLadder, subjectPhrase, type TeachingRole } from "./lessonLadder";
import { expandConceptPasses, type ConceptPass } from "./board/conceptPasses";
import { scopedBlockText } from "./beatSourceScope";
import { boardCountFor, depthBudget, type DepthLevelName } from "./lectureDepth";
import { CODE_BEAT_PATTERN, asksForCode, looksLikeCode, mergeSplitCodeBeats } from "./codeSpec";
import type { ProgressiveBeatPlan, ProgressiveLectureInput, ProgressiveVisualKind } from "./progressiveLectureTypes";
import { isSuprnotesLessonInput, type SuprnotesLessonInput } from "./suprnotes";

/** The depth slider as the three names the budget and the pass-count both speak. */
function depthLevel(depth: string | undefined): DepthLevelName {
  return depth === "deep" ? "deep" : depth === "concise" ? "concise" : "balanced";
}

/**
 * What must be understood before this beat: the previous CONCEPT, not the previous beat.
 *
 * Keyed off concepts rather than sequence numbers, so a three-pass subtopic lists the subtopic
 * before it once, instead of naming its own earlier passes as prerequisites of itself.
 */
function prerequisitesFor(entries: ConceptPass[], sequence: number): string[] {
  const self = entries[sequence].conceptKey;
  for (let i = sequence - 1; i >= 0; i--) {
    if (entries[i].conceptKey !== self) return [entries[i].conceptKey];
  }
  return [];
}

/**
 * A continuation pass climbs one rung ABOVE the pass before it, starting from the subtopic's own
 * rung: an example subtopic's second board draws the implication, an implication subtopic's second
 * board shows the application. Passes therefore never share a rung and never descend — which is
 * what keeps "board 2 of 3" from being board 1 said again (it was: eight sentences of one TCP
 * lesson's second pass were its first pass reworded).
 */
function roleForPass(base: TeachingRole, passRole: ConceptPass["passRole"]): TeachingRole {
  const climb: TeachingRole[] = ["core", "mechanism", "example", "implication", "application", "pitfall", "contrast"];
  // The hook and the recap are not on the climb and never have passes; they keep their rung.
  // (Clamping them to index 0 is how the opener and the recap were both labelled "core".)
  if (!climb.includes(base)) return base;
  const from = climb.indexOf(base);
  const steps = passRole === "establish" ? 0 : passRole === "example" ? 1 : 2;
  return climb[Math.min(climb.length - 1, from + steps)];
}

/** The student wants code: they said so, or their confirmed profile asks for code examples. */
function requestedCode(input: ProgressiveLectureInput): boolean {
  return input.learnerProfile.codeExamples || asksForCode(`${input.topic ?? ""} ${input.focus ?? ""}`);
}

/** Builds the global map synchronously so no model round-trip delays the first beat. */
export function buildProgressivePlan(input: ProgressiveLectureInput): ProgressiveBeatPlan[] {
  const sourcePlan = sourceDocumentPlan(input);
  if (sourcePlan.length > 0) return sourcePlan;
  // The THING the lesson is about, not the sentence the student typed: "What is overfitting?"
  // is a lesson on Overfitting, and its boards are titled for overfitting.
  const subject = subjectPhrase(input.topic);
  const supplied = (input.outline?.subtopics ?? [])
    .map((item) => ({ title: clean(item.title), objective: clean(item.caption || item.reason || item.title) }))
    .filter((item) => item.title);
  /*
   * THE CONCEPTS DECIDE THE COUNT — see lib/lectureDepth.ts.
   *
   * This used to pad the plan up to `beatCountForDepth(depth)` with invented beats titled
   * "${subject}: idea 2/3/4", every one carrying the same objective string, and then truncate
   * anything longer. That is the whole shallow-and-repetitive complaint in two statements: the
   * padding manufactured duplicate teaching instructions, and the truncation threw away real
   * concepts the planner had reasoned about. `polishBeatPlan` then renamed the duplicates to
   * "Worked Example" / "Common Pitfalls", which hid the repetition behind distinct headings.
   *
   * A narrow topic now gets three boards taught thoroughly; a broad one gets eight. The depth
   * setting buys WORDS PER BOARD (depthBudget), never more boards.
   */
  // Default objectives arrive with their rung already assigned, and orderByLadder honours it.
  const middle = supplied.length > 0 ? supplied : defaultLadderObjectives(subject, 4);
  /*
   * Titles are uniquified HERE, over the subtopics, and never again afterwards. `polishBeatPlan`
   * renames any duplicate title it sees, so running it after the concept expansion below would
   * rename the second and third pass over one subtopic into two unrelated-looking headings — which
   * is precisely the "separate slides for one subtopic" symptom being fixed.
   */
  const opener = { title: subject, objective: `Open with the concrete puzzle or situation that makes ${subject} worth learning, and end on the open question. Do NOT define ${subject} or explain how it works — the next board does.` };
  const recap = { title: `${subject} Recap`, objective: `Connect the boards into one structure — how the definition, mechanism, example and implications of ${subject} fit together — then the single most usable takeaway. Do not re-define, re-derive or re-exemplify anything.` };
  /*
   * PLANNER TITLES ARE POLISHED; DEFAULT TITLES ARE NOT. `polishBeatPlan` exists to rescue weak or
   * duplicate titles from a model, and it does so by stripping a leading "What"/"How" and trimming
   * to five words — which turned the default "What Overfitting Implies" into "Overfitting Implies"
   * and "TCP Three-way Handshake With Real Numbers" into "…With Real". The defaults are written
   * here, for the subject, and are already distinct; they go through as written.
   */
  const subtopics = supplied.length > 0
    ? polishBeatPlan([opener, ...middle, recap].slice(0, boardCountFor(middle.length + 2)), subject)
    : [opener, ...middle, recap].slice(0, boardCountFor(middle.length + 2));

  /*
   * THE LADDER. Each subtopic is given its rung (hook, core, mechanism, example, …) and the plan is
   * put in ladder order, so a definition never follows a mechanism and basics never follow an
   * example — see lib/lessonLadder.ts. The rung travels with the beat into its prompt, where it
   * decides what the board must add and what it must not repeat.
   */
  const ordered = orderByLadder(subtopics);
  const roleByTitle = new Map(ordered.map((item) => [item.title, item.role]));
  /*
   * Continuation passes are for the PLANNER'S subtopics, which are broad ideas ("Chlorophyll") that
   * can genuinely take two or three boards. The default ladder already gives every board its own
   * rung, so expanding it only produced same-rung neighbours — two "implication" boards in a row —
   * with nothing new for the second to say.
   */
  const entries = expandConceptPasses(ordered, supplied.length > 0 ? depthLevel(input.learnerProfile.depth) : "concise", slug);

  const plan = entries.map((entry, sequence) => ({
    // The id stays per-beat and unique; the CONCEPT is what repeats.
    id: `beat-${sequence + 1}-${slug(entry.title)}${entry.passes > 1 ? `-p${entry.pass}` : ""}`,
    sequence,
    title: entry.title,
    objective: entry.objective,
    conceptId: entry.conceptKey,
    conceptPass: entry.pass,
    conceptPasses: entry.passes,
    role: roleForPass(roleByTitle.get(entry.title) ?? "mechanism", entry.passRole),
    prerequisiteConceptIds: prerequisitesFor(entries, sequence),
    visualKind: visualKindFor(sequence, entries.length, input, entry),
    estimatedDurationMs: depthBudget(input.learnerProfile.depth).boardMs,
  }));
  // A prompted lecture should exercise the live animation engine, not accidentally collapse into
  // blackboards/structure boards because every outline title matched a broad keyword. Prefer the
  // most process-like teaching beat, and keep specialised equation/plot choices intact.
  if (!plan.some((beat) => beat.visualKind === "react-animation")) {
    const candidate = plan.find((beat) =>
      beat.sequence < plan.length - 1 &&
      /how|work|apply|example|try|mechanism|process|change|step/i.test(`${beat.title} ${beat.objective}`) &&
      !["equation", "plot"].includes(beat.visualKind),
    ) ?? plan.find((beat) => beat.sequence < plan.length - 1 && !["equation", "plot"].includes(beat.visualKind));
    if (candidate) candidate.visualKind = "react-animation";
  }
  return plan;
}

function sourceDocumentPlan(input: ProgressiveLectureInput): ProgressiveBeatPlan[] {
  if (!isSuprnotesLessonInput(input.suprnotes)) return [];
  const document = input.suprnotes;
  const rawPlan = (document.lessonPlan ?? document.suggestedLecturePlan) as Record<string, unknown> | undefined;
  const rawBeats = Array.isArray(rawPlan?.beats) ? rawPlan.beats : [];
  const plannedRaw = rawBeats
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    .map((item) => {
      const sourceBlockIds = Array.isArray(item.sourceBlockIds)
        ? item.sourceBlockIds.filter((id): id is string => typeof id === "string")
        : [];
      return {
        title: clean(item.title),
        objective: clean(item.objective) || clean(item.teachingGoal) || clean(item.title),
        sourceBlockIds,
        visualKind: sourceCodeKind(document, sourceBlockIds) ?? sourceVisualKind(item),
      };
    })
    // A document section planned as a recap/summary is dropped too — no lecture ends on a recap.
    .filter((item) => item.title && !isRecapTitle(item.title));
  // A listing the planner cut across beats is re-joined, so the code board shows the whole function.
  const planned = mergeSplitCodeBeats(plannedRaw, (ids) => scopedBlockText(document.contentBlocks ?? [], ids));
  /*
   * DEPTH CAPS THE BEAT COUNT FOR A DOCUMENT TOO, not just for a typed topic.
   *
   * The prompt path has always honoured depth — 6 beats concise, 8 balanced, 10 deep. This path
   * ignored it and took a flat 12 blocks, so an uploaded PDF produced a longer lecture than the
   * same request typed as a sentence, and asking for "concise" changed only the words per beat
   * while the lecture still ran twelve sections. That is the regression: concise stopped meaning
   * concise on exactly the source type where documents are longest.
   *
   * Applied to the model's own plan as well as the block fallback, since a long PDF makes the
   * planner propose many beats and the cap is what makes the student's choice win.
   */
  /*
   * A document's board count follows the document's own structure, not the depth slider. Depth is
   * spent on WORDS PER BOARD instead (depthBudget), so "concise" on a long PDF now means each
   * section is taught briskly rather than the last two thirds of the document being dropped —
   * `planned.slice(0, beatCap)` silently discarded the tail of real material.
   */
  const beatCap = boardCountFor(planned.length > 0 ? planned.length : (document.contentBlocks ?? []).length);
  const fallback = planned.length > 0 ? planned.slice(0, beatCap) : (document.contentBlocks ?? [])
    .slice()
    .sort((a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0))
    .slice(0, beatCap)
    .map((block) => ({
      title: clean(block.heading) || `Page ${block.pageNumber ?? "source"}`,
      objective: clean(block.text).slice(0, 260) || `Teach the source material in ${block.id}.`,
      sourceBlockIds: [block.id],
      visualKind: (looksLikeCode(block.text) ? "code" : "react-animation") as ProgressiveVisualKind,
    }));
  /*
   * A DOCUMENT'S SECTIONS GET THE SAME CONTINUOUS BOARD as a typed topic's subtopics.
   *
   * This path previously emitted no `conceptId` at all, so every beat fell back to a `legacy:` id
   * and no two beats could ever share a concept — a PDF section explained over two boards produced
   * two unrelated titled slides, which is the reported behaviour. Expanding here keeps the source's
   * own structure (one section is still one concept) while letting a section that needs a worked
   * example take a second board underneath the first.
   *
   * Source provenance is carried onto every pass, so an extracted figure still attaches to each
   * board that teaches its page.
   */
  const polished = polishBeatPlan(fallback, input.topic);
  const provenance = new Map(polished.map((item) => [item.title, item]));
  const expanded = expandConceptPasses(
    polished.map((item) => ({ title: item.title, objective: item.objective })),
    depthLevel(input.learnerProfile.depth),
    slug,
  );
  return expanded.map((item, sequence) => {
    const source = provenance.get(item.title);
    return {
      id: `beat-${sequence + 1}-${slug(item.title)}${item.passes > 1 ? `-p${item.pass}` : ""}`,
      sequence,
      title: item.title,
      objective: item.objective,
      conceptId: item.conceptKey,
      conceptPass: item.pass,
      conceptPasses: item.passes,
      prerequisiteConceptIds: prerequisitesFor(expanded, sequence),
      sourceBlockIds: source?.sourceBlockIds,
      visualKind: source?.visualKind ?? ("react-animation" as ProgressiveVisualKind),
      estimatedDurationMs: depthBudget(input.learnerProfile.depth).boardMs,
    };
  });
}

/**
 * A beat planned from pages that contain program source teaches THAT code, so it gets the code
 * board whatever the planner recommended. Asked about a PDF's `remove()` function, the lecture drew
 * an animated tree and never showed the function the student was reading.
 */
function sourceCodeKind(document: SuprnotesLessonInput, sourceBlockIds: string[]): ProgressiveVisualKind | null {
  if (sourceBlockIds.length === 0) return null;
  return looksLikeCode(scopedBlockText(document.contentBlocks ?? [], sourceBlockIds)) ? "code" : null;
}

function sourceVisualKind(item: Record<string, unknown>): ProgressiveVisualKind {
  const recommended = item.recommendedVisual && typeof item.recommendedVisual === "object"
    ? item.recommendedVisual as Record<string, unknown>
    : {};
  const value = `${String(recommended.type ?? "")} ${String(item.visualMode ?? "")}`.toLowerCase();
  if (value.includes("react") || value.includes("svg")) return "react-animation";
  if (value.includes("manim")) return "manim";
  if (value.includes("geometry")) return "manim";
  if (value.includes("transform")) return "react-animation";
  if (value.includes("structure") || value.includes("flow") || value.includes("cycle") || value.includes("tree")) return "structure";
  if (value.includes("plot") || value.includes("chart") || value.includes("graph")) return "plot";
  if (value.includes("equation") || value.includes("formula") || value.includes("derivation")) return "equation";
  if (value.includes("blackboard") || value.includes("text") || value.includes("notes")) return "blackboard";
  // A source planner often says only "diagram" or omits the engine. The full pipeline used the
  // sandbox for those visual teaching beats; defaulting them to blackboard caused uploaded-source
  // progressive lectures to lose animation entirely.
  return "react-animation";
}


function visualKindFor(
  sequence: number,
  total: number,
  input: ProgressiveLectureInput,
  entry: { title: string; objective: string },
): ProgressiveVisualKind {
  const title = entry.title.toLowerCase();
  const planText = `${entry.title} ${entry.objective}`.toLowerCase();
  if (/\b(?:equation|formula|derivation|solve|algebra|calculus)\b/.test(title)) return "equation";
  if (/\b(?:chart|graph|trend|probability distribution|data plot)\b/.test(title)) return "plot";
  if (/\b(?:cycle|pipeline|state machine|hierarchy|workflow|architecture)\b/.test(title)) return "structure";
  if (/\b(?:definition)\b/.test(title)) return "blackboard";
  // A student who asked for code gets it on the beats that teach an implementation. This rule used
  // to exist and return "react-animation" — i.e. it did nothing, and no lecture ever showed code.
  if (requestedCode(input) && CODE_BEAT_PATTERN.test(planText)) return "code";
  // The sandbox is the normal teaching surface, matching the pre-progressive pipeline. Specialised
  // renderers above are opt-ins only when the title explicitly calls for their grammar.
  return "react-animation";
}

export function clean(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42) || "lesson";
}
