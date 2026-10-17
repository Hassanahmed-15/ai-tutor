import type { SuprnotesContentBlock, SuprnotesLessonInput } from "@/lib/suprnotes";
import { PHYSICAL } from "../canvas/visualPolicy";
import { classifyInstructionalTask } from "../canvas/instructionalTask";
import { namedIn } from "../canvas/labelPolicy";
import { figureComponent } from "../figures/registry";

/**
 * A CURRICULUM LESSON, SPECIFIED BEFORE IT IS WRITTEN (owner, 2026-10-14: "never ask the model to
 * decide what the curriculum contains — give it the exact requirements and ask it to teach them").
 *
 *   course + exact lesson address (CurriculumLessonRequest)
 *     → the lesson's official outcomes, from the reviewed course tree (never from a model)
 *     → the syllabus text those outcomes come from (data/curricula/sources, by address — no search
 *       across countries, levels or years)
 *     → a LessonSpec: boards that teach exactly those outcomes at that level (a model plans HOW,
 *       under a strict JSON schema; `specGaps` checks in code that every outcome is taught)
 *     → a lesson document (SuprnotesLessonInput) for the existing source-grounded lecture writer,
 *       the same path uploaded PDFs and YouTube videos take.
 *
 * Pure functions; tests: lib/anim/curriculumLessonSpec.test.ts. Server route:
 * app/api/curricula/lesson/route.ts.
 */

/** What "Start lesson" sends: an address, not a description. The server reads everything else. */
export type CurriculumLessonRequest = {
  courseId: string;
  /** The course build the student saw (tree build time): a lesson is cached per version. */
  version: string;
  grade: string;
  unitId: string;
  topicId: string;
  lessonId: string;
};

export type Evidence = { page: number; code: string | null; text: string };
export type SpecOutcome = { code: string | null; text: string };

export type OutcomeContract = {
  outcomeRef: number;
  teach: string;
  visualEvidence: string;
  check: string;
  transfer: string;
};

/**
 * AN EXAM QUESTION WITH ITS MARK SCHEME. Lessons taught the content but never showed how it is
 * examined: auditors scored exam readiness 5.5–6 for "no command words, no mark-scheme phrasing, no
 * mark allocation" (audit 2026-10-17). Each outcome gets one question in the qualification's style,
 * worth as many marks as it has marking points, written as the mark scheme words them.
 */
export type ExamPractice = {
  outcomeRef: number;
  commandWord: string;
  question: string;
  marks: number;
  markPoints: string[];
  modelAnswer: string;
  lostMarks: string;
  /** For a question marked by levels of response (an essay): the bands, top first. Empty when marked point by point. */
  levels?: Array<{ level: string; marks: string; descriptor: string }>;
};

export type BoardBudget = { min: number; max: number; recommended: number; reason: string };

export type VisualRequirement = {
  outcomeRef: number;
  required: boolean;
  preferredStages: string[];
  mustShow: string[];
  reason: string;
};

/** Turns syllabus verbs into concrete, testable visual obligations for the canvas planner. */
export function visualRequirements(outcomes: SpecOutcome[], contracts: OutcomeContract[] = []): VisualRequirement[] {
  return outcomes.map((outcome, i) => {
    const ref = i + 1;
    const contract = contracts.find((c) => c.outcomeRef === ref);
    const contractEvidence = contract?.visualEvidence && !/^Add a labelled example/i.test(contract.visualEvidence) ? contract.visualEvidence : "";
    const text = `${outcome.text} ${contract?.teach ?? ""} ${contractEvidence}`;
    const stages: string[] = [];
    const mustShow: string[] = [];
    const add = (stage: string, ...items: string[]) => { if (!stages.includes(stage)) stages.push(stage); mustShow.push(...items); };
    const task = classifyInstructionalTask({ title: outcome.text, brief: contract?.teach ?? "", script: contractEvidence, objects: [], requiredVisual: undefined });
    // The figure's minimum parts, plus every part the OUTCOME itself names: "Label a dicot leaf's
    // cuticle, stomata, guard cells, mesophyll, air spaces, vascular bundles, chloroplasts and
    // epidermis" required only palisade, stoma and xylem, so five listed structures were never
    // labelled (coverage audit 2026-10-17).
    if (task.figure) {
      const named = (figureComponent(task.figure)?.parts ?? []).filter((p) => namedIn(outcome.text, p.name) || namedIn(outcome.text, p.id.replace(/-/g, " "))).map((p) => p.id);
      add("figure", ...(task.requiredParts ?? []), ...named);
    }
    else if (/molecular (shape|geometry|structure)|shapes? of (a |the |simple )?molecules?|vsepr|bond angle|lone pairs?|covalent bond|structural formula|displayed formula/i.test(text)) add("molecule", "named atoms", "bonds", "geometry", "bond angle or lone pairs when required");
    // Chemistry only: "product" alone is also an economics and a sociology word (a company's product).
    else if (/photosynthesis|respiration|conservation of (?:mass|matter)|\batoms?\b|balanced (?:chemical )?equation|reactants?\b.*\bproducts?\b/i.test(text)) add("atom-map", "reactant and product atom counts", "separate energy lane when relevant");
    // An outcome solved on a graph ("solve … graphically") allows both boards: forced to an equation,
    // a board teaching the parabola failed every attempt and shipped the backup (audit 2026-10-17).
    else if (/equation|formula|calculate|solve|substitut|rearrange|algebra/i.test(text) || /graph|plot|gradient|slope|relationship between|rate against/i.test(text)) {
      if (/graph|plot|gradient|slope|relationship between|rate against|sketch|curve|parabola/i.test(text)) add("graph", "labelled axes", "curve or plotted relationship", "relevant marker or guide");
      if (/equation|formula|calculate|solve|substitut|rearrange|algebra/i.test(text)) add("equation", "formula", "operators", "worked steps and answer");
    }
    else if (/compar\w*|differen\w*|similarit|distinguish|versus|perspectives?\b|viewpoints?|evaluat\w*|strengths?|limitations?|advantages?|disadvantages?|judge|assess/i.test(text)) add("compare", "both sides", "distinguishing features");
    else if (/draw|diagram|label|identify|structure|organ|cell|anatom|part of|cycle|process|sequence|pathway/i.test(text)) {
      if (/cycle|process|sequence|pathway|steps/i.test(text)) add("flow", "ordered nodes", "directional arrows");
      // A picture only for a physical thing: "identifying" perspectives once forced an AI picture of
      // an abstract grid with no words on it (Global Perspectives audit 2026-10-15).
      else if (PHYSICAL.test(text)) add("illustration", "distinct visible parts", "labels for every required part");
      else add("compare", "both sides", "distinguishing features");
    // Programming only: "variable cost" made an accounting budget statement a Python board, and a
    // "function" is also a maths and a biology word (audit 2026-10-17).
    } else if (/\b(program(s|ming|med)?|source code|pseudocode|algorithms?|python|java|loops?|iteration|subroutines?|procedures? (call|in code))\b/i.test(outcome.text)) add("code", "real code", "execution steps");
    const required = stages.length > 0;
    if (!required) add("scene", "the central relationship or definition");
    return {
      outcomeRef: ref,
      required,
      preferredStages: stages,
      mustShow: [...new Set(mustShow)],
      reason: required ? `The outcome uses a visual or procedural verb: ${outcome.text}` : "The outcome can be taught with a clear central concept board.",
    };
  });
}

export type SpecBoard = {
  title: string;
  objective: string;
  /** 1-based positions in `outcomes` this board teaches. */
  outcomeRefs: number[];
  keyPoints: string[];
  workedExample: string;
  evidencePages: number[];
};

export type LessonSpec = {
  courseLabel: string;
  level: string;
  lessonTitle: string;
  outcomes: SpecOutcome[];
  prerequisites: string[];
  requiredTerms: string[];
  requiredMethods: string[];
  commandWords: string[];
  depth: string;
  misconceptions: string[];
  outOfScope: string[];
  boards: SpecBoard[];
  /** New Phase 2 contract; optional in the type so cached Phase 1 specs remain readable. */
  outcomeContracts?: OutcomeContract[];
  visualRequirements?: VisualRequirement[];
  boardBudget?: BoardBudget;
  checkpoint: Array<{ question: string; answer: string; outcomeRef: number }>;
  /** Optional so specs cached before spec-3 remain readable. */
  examPractice?: ExamPractice[];
};

/**
 * A small, deterministic budget keeps simple outcomes concise and gives complex outcomes room — and
 * never falls below what the qualification needs. Sized by outcome count alone, a one-outcome O Level
 * Global Perspectives topic became a two-minute, two-board lesson (audit 2026-10-15).
 */
export function boardBudget(outcomes: SpecOutcome[], level = ""): BoardBudget {
  const complex = outcomes.filter((o) => /calculate|derive|evaluate|compare|interpret|draw|diagram|label|explain how|method|formula|graph|explore|assess|judge|discuss|analy[sz]e|justify/i.test(o.text)).length;
  const floor = /\b(a[\s-]?level|as\b|ap\b|advanced|grade 1[12]|university)/i.test(level) ? 4 : /\b(o[\s-]?level|igcse|gcse|grade (9|10)|class (9|10)|matric)/i.test(level) ? 3 : 2;
  const recommended = Math.max(floor, Math.min(8, outcomes.length + Math.ceil(complex / 2)));
  const min = Math.max(floor - 1, Math.min(recommended, outcomes.length || 1), 1);
  const max = Math.max(min + 1, Math.min(8, recommended + (complex > 0 ? 1 : 0)));
  return { min, max, recommended, reason: `${outcomes.length} official outcome(s), ${complex} requiring a worked method, diagram, comparison, interpretation or judgement; at least ${floor} boards at ${level || "this level"}.` };
}

/**
 * WHAT AN EXAM ANSWER AT THIS LEVEL CONTAINS, by subject family. The spec model was told to add
 * nothing beyond the outcomes, so it listed "named sociologists or research studies" as out of
 * scope — the very evidence A Level answers are marked on (AO1 "evidence", AO3 "evaluate").
 */
export function depthRule(courseLabel: string): string {
  if (/global perspectives/i.test(courseLabel)) return "GLOBAL PERSPECTIVES: teach the issue itself — its causes, its consequences, real evidence (named places, data, organisations) and possible courses of action with their likely effects — and then the personal, local, national and global perspectives on it. Students are marked on researching, analysing and evaluating issues, not on naming the four perspectives.";
  if (/sociolog|psycholog|histor|geograph|politic|government|law|religio|islamiyat|pakistan studies|business|econom|media|classical|philosoph|english lit|literature|art history|african american/i.test(courseLabel)) return "EXAM DEPTH FOR THIS SUBJECT: answers at this level are marked on knowledge, application and evaluation. Teach with at least two specific named sources the syllabus area is known for — theorists, studies, case studies, real examples with places and dates (standard textbook ones) — and, wherever an outcome says explain, assess, evaluate, judge or discuss, a board that weighs strengths against limitations, gives a counter-view and reaches a supported judgement.";
  if (/math|calculus|statistic|physic|chemistr|biolog|science|computer|computing|engineering|further/i.test(courseLabel)) return "EXAM DEPTH FOR THIS SUBJECT: teach mechanisms and reasons, not only facts; every calculation-type outcome gets a full worked example with units and a second one the student completes; use the qualification's notation and the command words it examines. Every standard case and question set-up the exam uses for an outcome is its own key point (each test or condition a topic has, each standard diagram or configuration examiners draw, each direction of a calculation) — a lesson that teaches only the easiest case does not cover the outcome.";
  return "EXAM DEPTH: teach to the depth an examiner at this level rewards, with specific examples and the qualification's command words.";
}

/** The part of the spec a model writes (outcomes, course and level are filled in from the tree). */
export const SPEC_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["prerequisites", "requiredTerms", "requiredMethods", "commandWords", "depth", "misconceptions", "outOfScope", "boards", "outcomeContracts", "checkpoint", "examPractice"],
  properties: {
    prerequisites: { type: "array", items: { type: "string" } },
    requiredTerms: { type: "array", items: { type: "string" } },
    requiredMethods: { type: "array", items: { type: "string" } },
    commandWords: { type: "array", items: { type: "string" } },
    depth: { type: "string" },
    misconceptions: { type: "array", items: { type: "string" } },
    outOfScope: { type: "array", items: { type: "string" } },
    boards: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "objective", "outcomeRefs", "keyPoints", "workedExample", "evidencePages"],
        properties: {
          title: { type: "string" },
          objective: { type: "string" },
          outcomeRefs: { type: "array", items: { type: "integer" } },
          keyPoints: { type: "array", items: { type: "string" } },
          workedExample: { type: "string" },
          evidencePages: { type: "array", items: { type: "integer" } },
        },
      },
    },
    outcomeContracts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["outcomeRef", "teach", "visualEvidence", "check", "transfer"],
        properties: {
          outcomeRef: { type: "integer" },
          teach: { type: "string" },
          visualEvidence: { type: "string" },
          check: { type: "string" },
          transfer: { type: "string" },
        },
      },
    },
    checkpoint: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["question", "answer", "outcomeRef"],
        properties: { question: { type: "string" }, answer: { type: "string" }, outcomeRef: { type: "integer" } },
      },
    },
    examPractice: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["outcomeRef", "commandWord", "question", "marks", "markPoints", "modelAnswer", "lostMarks", "levels"],
        properties: {
          outcomeRef: { type: "integer" },
          commandWord: { type: "string" },
          question: { type: "string" },
          marks: { type: "integer" },
          markPoints: { type: "array", items: { type: "string" } },
          modelAnswer: { type: "string" },
          lostMarks: { type: "string" },
          levels: { type: "array", items: { type: "object", additionalProperties: false, required: ["level", "marks", "descriptor"], properties: { level: { type: "string" }, marks: { type: "string" }, descriptor: { type: "string" } } } },
        },
      },
    },
  },
} as const;

export function specSystemPrompt(courseLabel: string, level: string, outcomes: SpecOutcome[] = []): string {
  const budget = boardBudget(outcomes, level);
  return `You plan ONE lesson of an official course: ${courseLabel}, ${level}.
You are given the lesson's official learning outcomes (numbered) and the syllabus text they come from. The outcomes ARE the lesson — do not add, drop or reinterpret any. Plan how to teach exactly them, at exactly this level:
- boards: ${budget.min}-${budget.max} boards in teaching order (aim for ${budget.recommended}; give each board one teachable idea at exam depth rather than splitting one idea to fill space). Every outcome number appears in at least one board's outcomeRefs. Each board: a short student-facing title, its objective, 3 to 5 key points that MUST be taught (facts, definitions, formulas, steps — a point about how or why something happens includes its reason or mechanism; consistent with the syllabus text and correct for this level; together they leave nothing of the board's idea out — an idea needing more than five points is two boards), a workedExample on EVERY board, written as 2 to 4 numbered steps that end in the answer (a calculation: every substitution, value and unit; a science structure or process: one specific case worked from structure or cause through each linked step to its effect; a humanities, business or language idea: one named real case or text analysed step by step to a judgement), and evidencePages (the syllabus pages it draws on).
- outcomeContracts: exactly one object for every outcome number. For each, state what the lesson will teach (teach), the visible evidence a student should be able to point to (visualEvidence; say "none" only when a visual is genuinely inappropriate), one answerable understanding check (check), and one new-context transfer task (transfer). These are teaching requirements, not vague promises.
- depth: one or two sentences on the depth this level expects (vocabulary, notation, mathematical level, how far to go).
- commandWords: the syllabus command words these outcomes use (define, explain, calculate…).
- prerequisites: what the student must already know; requiredTerms and requiredMethods: the vocabulary and methods this level expects.
- misconceptions: common mistakes at this level. outOfScope: only content that belongs to a LATER lesson or a HIGHER level (do not teach it) — never the named studies, theorists, case studies, examples or evaluation that exam answers at this level are expected to use.
- checkpoint: one short question per outcome (outcomeRef = its number) in the style of this qualification, with the correct answer.
- examPractice: one exam-style question per outcome, exactly as this qualification's papers set them. commandWord: the syllabus command word the question opens with (State, Describe, Explain, Calculate, Show that, Compare, Evaluate…). question: the full question, with any data, diagram description or figures it needs. marks: 2 to 6. markPoints: exactly one point per mark, each worded as the mark scheme credits it — the precise term, value with unit, or step of working (for a calculation: method, substitution, answer with unit). modelAnswer: a full-mark answer a strong candidate writes, in exam language. lostMarks: the most common way candidates lose marks on this question and what examiners want instead. levels: when this qualification marks the question by levels of response rather than point by point (extended writing — essays and "assess", "evaluate", "discuss", "to what extent" questions in humanities and social sciences at this level), the official-style level bands from top to bottom, each {"level": "Level 4", "marks": "13–15", "descriptor": what an answer at that level does, in a few words}, with "marks" the question's real total and markPoints the points a top-level answer makes; otherwise levels: []. Use real-world contexts and numbers in the style of past papers; never quote a real past paper question.
${depthRule(courseLabel)}
Stay within the outcomes' scope and this level, but teach them to the depth the exam rewards. If the syllabus text does not state a fact you need, use standard, uncontroversial textbook knowledge for this level.`;
}

export function specUserMessage(lessonTitle: string, outcomes: SpecOutcome[], evidence: Evidence[]): string {
  const outs = outcomes.map((o, i) => `${i + 1}. ${o.code ? `[${o.code}] ` : ""}${o.text}`).join("\n");
  const src = evidence.length
    ? evidence.map((e) => `--- syllabus page ${e.page}${e.code ? ` (around ${e.code})` : ""} ---\n${e.text}`).join("\n\n")
    : "(no syllabus text available for this lesson — teach the outcomes as stated)";
  return `LESSON: ${lessonTitle}\n\nOFFICIAL OUTCOMES:\n${outs}\n\nSYLLABUS TEXT:\n${src}`;
}

/** Outcome numbers no board teaches, and boards that point at outcomes that do not exist. */
export function specGaps(spec: Pick<LessonSpec, "outcomes" | "boards">): { untaught: number[]; badRefs: number } {
  const taught = new Set<number>();
  let badRefs = 0;
  for (const b of spec.boards) for (const r of b.outcomeRefs) {
    if (Number.isInteger(r) && r >= 1 && r <= spec.outcomes.length) taught.add(r);
    else badRefs++;
  }
  const untaught = spec.outcomes.map((_, i) => i + 1).filter((n) => !taught.has(n));
  return { untaught, badRefs };
}

/**
 * A spec that teaches every outcome: invalid references dropped, empty boards removed, and any
 * outcome still untaught given its own board (so coverage never depends on the model alone).
 */
export function completeSpec(spec: LessonSpec): LessonSpec {
  const n = spec.outcomes.length;
  const boards = spec.boards
    .map((b) => ({ ...b, outcomeRefs: [...new Set(b.outcomeRefs.filter((r) => Number.isInteger(r) && r >= 1 && r <= n))] }))
    .filter((b) => b.title.trim() && b.outcomeRefs.length);
  const { untaught } = specGaps({ outcomes: spec.outcomes, boards });
  for (const r of untaught) {
    const o = spec.outcomes[r - 1];
    boards.push({ title: o.text.split(/[.,;:]/)[0].slice(0, 60), objective: o.text, outcomeRefs: [r], keyPoints: [o.text], workedExample: "", evidencePages: [] });
  }
  const budget = boardBudget(spec.outcomes, spec.level);
  const existing = new Map((spec.outcomeContracts ?? []).filter((c) => c.outcomeRef >= 1 && c.outcomeRef <= n).map((c) => [c.outcomeRef, c]));
  const outcomeContracts = spec.outcomes.map((o, i) => existing.get(i + 1) ?? {
    outcomeRef: i + 1,
    teach: o.text,
    visualEvidence: "Add a labelled example, diagram, table or worked representation where appropriate.",
    check: `Can you explain or demonstrate: ${o.text}`,
    transfer: `Apply the same idea to a new example: ${o.text}`,
  });
  return { ...spec, boards, boardBudget: budget, outcomeContracts, visualRequirements: visualRequirements(spec.outcomes, outcomeContracts), checkpoint: spec.checkpoint.filter((c) => c.outcomeRef >= 1 && c.outcomeRef <= n), examPractice: cleanExamPractice(spec.examPractice ?? [], n) };
}

/** Exam questions made consistent: one mark per marking point (2–6), the command word opening the question. */
export function cleanExamPractice(list: ExamPractice[], outcomes: number): ExamPractice[] {
  return list
    .filter((q) => q && q.outcomeRef >= 1 && q.outcomeRef <= outcomes && q.question?.trim() && (q.markPoints ?? []).filter((m) => m?.trim()).length >= 2)
    .map((q) => {
      const markPoints = q.markPoints.map((m) => m.trim()).filter(Boolean).slice(0, 6);
      const commandWord = (q.commandWord?.trim() || q.question.trim().split(/\s+/)[0]).replace(/^\w/, (c) => c.toUpperCase());
      // Marked by levels: the total is the top band's top mark, not one mark per point.
      const levels = (q.levels ?? []).filter((l) => l?.level?.trim() && l?.descriptor?.trim()).slice(0, 5).map((l) => ({ level: l.level.trim(), marks: String(l.marks ?? "").trim(), descriptor: l.descriptor.trim() }));
      const top = Math.max(0, ...levels.flatMap((l) => (l.marks.match(/\d+/g) ?? []).map(Number)));
      return { ...q, commandWord, question: q.question.trim(), marks: levels.length >= 2 && top ? top : markPoints.length, markPoints, modelAnswer: q.modelAnswer?.trim() ?? "", lostMarks: q.lostMarks?.trim() ?? "", ...(levels.length >= 2 ? { levels } : {}) };
    });
}

/**
 * The lesson's exam-practice question: the one worth the most marks (a multi-point "explain" or a
 * full calculation teaches technique; a 2-mark "state" teaches little), the later outcome on a tie.
 */
export function examBoardQuestion(spec: Pick<LessonSpec, "examPractice">): ExamPractice | undefined {
  return [...(spec.examPractice ?? [])].sort((a, b) => b.marks - a.marks || b.outcomeRef - a.outcomeRef)[0];
}

/** The spec as the lesson document the existing source-grounded lecture writer takes. */
export function lessonDocument(
  spec: LessonSpec,
  meta: { request: CurriculumLessonRequest; framework: string; subject: string; sourceUrl?: string },
  evidence: Evidence[],
): SuprnotesLessonInput {
  const byPage = new Map(evidence.map((e) => [e.page, e]));
  const blocks: SuprnotesContentBlock[] = spec.boards.map((b, i) => {
    const pages = b.evidencePages.filter((p) => byPage.has(p));
    const excerpt = (pages.length ? pages : evidence.slice(0, 1).map((e) => e.page)).map((p) => byPage.get(p)!.text.slice(0, 700)).join("\n");
    const outs = b.outcomeRefs.map((r) => spec.outcomes[r - 1]).filter(Boolean);
    return {
      id: `c${i + 1}`,
      type: "concept",
      heading: b.title,
      text: [
        b.objective,
        b.keyPoints.map((k) => `- ${k}`).join("\n"),
        b.workedExample ? `Worked example: ${b.workedExample}` : "",
        excerpt ? `Official syllabus (${meta.framework}):\n${excerpt}` : "",
      ].filter(Boolean).join("\n\n"),
      keyIdeas: b.keyPoints,
      teachingHints: [
        `Level: ${spec.level}. ${spec.depth}`,
        spec.requiredTerms.length ? `Use these terms: ${spec.requiredTerms.join(", ")}.` : "",
        spec.misconceptions.length ? `Watch for: ${spec.misconceptions.join("; ")}.` : "",
        spec.outOfScope.length ? `Do not teach (outside this syllabus level): ${spec.outOfScope.join("; ")}.` : "",
        ...b.outcomeRefs.map((r) => spec.outcomeContracts?.find((c) => c.outcomeRef === r)).filter(Boolean).flatMap((c) => [
          `Required understanding check: ${c!.check}`,
          `Transfer task: ${c!.transfer}`,
          c!.visualEvidence ? `Visible evidence: ${c!.visualEvidence}` : "",
        ]),
        // How this board's outcome is examined: its last sentence asks a short question in this style.
        ...b.outcomeRefs.map((r) => spec.examPractice?.find((q) => q.outcomeRef === r)).filter(Boolean).map((q) => `How it is examined: "${q!.question}" [${q!.marks} marks] — the mark scheme credits: ${q!.markPoints.join("; ")}.`),
      ].filter(Boolean),
      facts: outs.map((o) => ({ claim: o.text, source: `${meta.framework}${o.code ? ` ${o.code}` : ""}`, confidence: "official" })),
      pageNumber: pages[0] ?? evidence[0]?.page,
      sourceOrder: i,
    };
  });
  // EXAM PRACTICE: the lesson ends on one real exam-style question answered the way the mark scheme
  // wants it — command word, marks, one marking point per mark, the mistake that loses marks.
  const exam = examBoardQuestion(spec);
  const examPlan = exam ? [{ id: `b${spec.boards.length + 1}`, title: "Exam practice", objective: `Answer an exam question on outcome ${exam.outcomeRef} for full marks.`, outcomeRefs: [exam.outcomeRef], visualRequirement: [], sourceBlockIds: [`c${blocks.length + 1}`] }] : [];
  if (exam) {
    blocks.push({
      id: `c${blocks.length + 1}`,
      type: "exam-practice",
      heading: "Exam practice",
      text: [
        `Exam question (${exam.marks} marks): ${exam.question}`,
        `Command word: ${exam.commandWord}.`,
        exam.levels ? `Marked by levels:\n${exam.levels.map((l) => `- ${l.level} (${l.marks}): ${l.descriptor}`).join("\n")}\nA top-level answer makes these points:\n${exam.markPoints.map((m) => `- ${m}`).join("\n")}` : `Mark scheme — one mark each:\n${exam.markPoints.map((m) => `- ${m}`).join("\n")}`,
        exam.modelAnswer ? `Model answer: ${exam.modelAnswer}` : "",
        exam.lostMarks ? `Where candidates lose marks: ${exam.lostMarks}` : "",
      ].filter(Boolean).join("\n\n"),
      keyIdeas: exam.markPoints,
      teachingHints: [`Level: ${spec.level}. Answer exactly as the mark scheme credits.`],
      exam: { commandWord: exam.commandWord, question: exam.question, marks: exam.marks, markPoints: exam.markPoints, lostMarks: exam.lostMarks, ...(exam.levels ? { levels: exam.levels } : {}) },
      facts: [],
      sourceOrder: blocks.length,
    });
  }
  return {
    schemaVersion: "suprnotes.lesson_input.v1",
    source: {
      adapter: "aria.curriculum.v1",
      courseId: meta.request.courseId,
      version: meta.request.version,
      lesson: `${meta.request.grade}/${meta.request.unitId}/${meta.request.topicId}/${meta.request.lessonId}`,
      outcomeCodes: spec.outcomes.map((o) => o.code).filter(Boolean),
      url: meta.sourceUrl,
      pages: [...new Set(evidence.map((e) => e.page))],
    },
    lesson: {
      title: spec.lessonTitle,
      subject: meta.subject,
      level: spec.level,
      language: "en",
      learningGoals: spec.outcomes.map((o) => o.text),
      estimatedTeachingMinutes: Math.max(3, Math.round(spec.boards.length * 1.6)),
    },
    generationDirectives: { preferredLectureStyle: "curriculum_lesson", preserveExistingLecturePrompting: true },
    contentGovernance: { groundingPolicy: "prefer_provided_content", hallucinationPolicy: "hedge_when_unsupported", requireClaimSourceTags: false },
    assets: [],
    contentBlocks: blocks,
    lessonPlan: {
      sourceType: "curriculum",
      strategy: "outcome_complete_coverage",
      requireCompleteCoverage: true,
      targetBeatCount: blocks.length,
      boardBudget: spec.boardBudget ?? boardBudget(spec.outcomes, spec.level),
      outcomeContracts: spec.outcomeContracts ?? [],
      // Recomputed, not read from the cache: the rules are deterministic and improve over time.
      visualRequirements: visualRequirements(spec.outcomes, spec.outcomeContracts ?? []),
      contentBlockIds: blocks.map((b) => b.id),
      beats: spec.boards.map((b, i) => ({
        id: `b${i + 1}`,
        title: b.title,
        objective: b.objective,
        outcomeRefs: b.outcomeRefs,
        visualRequirement: b.outcomeRefs.map((r) => visualRequirements(spec.outcomes, spec.outcomeContracts ?? []).find((v) => v.outcomeRef === r)).filter(Boolean),
        sourceBlockIds: [`c${i + 1}`],
      })).concat(examPlan as never[]),
    },
    webPreview: { status: "not_requested" },
  };
}

/** The whole spec as text, for the lesson chat and the voice tutor (they answer within it). */
export function lessonSpecText(spec: LessonSpec): string {
  return [
    `Context: This is an official curriculum course lesson, not the student's uploaded notes. Refer to it as "this lesson", "the course", or "the syllabus" — never "your notes" or "your document".`,
    `${spec.lessonTitle} — ${spec.courseLabel}, ${spec.level}`,
    `Official outcomes:\n${spec.outcomes.map((o, i) => `${i + 1}. ${o.code ? `[${o.code}] ` : ""}${o.text}`).join("\n")}`,
    `Depth: ${spec.depth}`,
    ...spec.boards.map((b) => `${b.title}: ${b.keyPoints.join("; ")}${b.workedExample ? ` | Worked example: ${b.workedExample}` : ""}`),
    ...(spec.outcomeContracts ?? []).map((c) => `Outcome ${c.outcomeRef} contract — teach: ${c.teach}; check: ${c.check}; transfer: ${c.transfer}`),
    // When the student asks how this comes up in an exam, Aria answers with these, not the lesson's own example.
    ...(spec.examPractice ?? []).map((q) => `Exam-style question on outcome ${q.outcomeRef}: "${q.question}" [${q.marks} marks]. Mark scheme (one mark each): ${q.markPoints.join("; ")}. Model answer: ${q.modelAnswer}. Candidates lose marks by: ${q.lostMarks}`),
    spec.outOfScope.length ? `Outside this level: ${spec.outOfScope.join("; ")}` : "",
  ].filter(Boolean).join("\n\n");
}
