import { cognitiveLoad, type DepthLevel, type LearnerProfile, type LearningObjective } from "./learnerProfile";
import { interestExamples, type LearningGoal } from "./learningPreferences";
import { gradeRules, type StudentCard } from "./studentCard";

/**
 * THE TEACHING POLICY — how to teach ONE student, decided once and followed by every stage that
 * writes their lesson: the outline planner, the planning questions, the script writer, the canvas
 * planner, the boards and Aria's live voice. Pure, unit-tested in lib/anim/teachingPolicy.test.ts.
 *
 * WHY ONE POLICY. The profile used to reach the models as half a dozen paragraphs written in
 * different places (the student card, the profile lines, the accessibility choices, the portrait's
 * teaching plan, the depth guidance), each cut to its own length and none aware of the others — so
 * nothing stopped "simpler language" sitting next to a Grade 11 reading rule. Now the facts (the
 * card: lib/studentCard.ts) and what this lesson has shown (the planning conversation's profile)
 * become one set of decisions, and each stage is handed the same decisions in its own words.
 *
 * WHAT DRIVES EACH DECISION, strongest first:
 *   1. Support the student chose (simpler language, slower pace, ADHD, dyslexia) — always honoured.
 *   2. This lesson's evidence: what the planning conversation showed they know. Prior knowledge is
 *      the strongest lever there is (expertise reversal, Kalyuga 2007): a Grade 11 novice still
 *      starts from a worked example, a Grade 8 student who has the basics does not.
 *   3. Their preferences (lib/learningPreferences.ts) — goal, challenge, what helps, interests,
 *      English. A preference changes what a lesson LEANS ON; it never removes the voice or the board.
 *   4. Their grade — the default for everything above, and the reading level.
 *
 * TWO GRADES, ON PURPOSE. `conceptGrade` is what may be assumed (the maths, the ideas);
 * `readingGrade` is how hard the sentences are. Plainer English or "simpler language" lowers only
 * the second: a Grade 11 student still learning English gets Grade 11 ideas in plain sentences.
 */

export type ReadingBand = "early" | "primary" | "middle" | "secondary" | "university";
export type Guidance = "worked" | "faded" | "independent";

export type TeachingPolicy = {
  card: StudentCard;
  band: ReadingBand;
  /** How hard the sentences are (US grade). What every script is checked against. */
  readingGrade: number;
  /** How far the ideas go — what may be assumed. Never lowered for language. */
  conceptGrade: number;
  language: { sentenceWords: number; newTermsPerBoard: number; plainEnglish: boolean; assume: string };
  /** Concrete before abstract for the young and for novices at any age. */
  abstraction: "concrete" | "concrete-first" | "balanced" | "formal";
  /** Worked example → faded → independent (expertise reversal). */
  guidance: Guidance;
  pacing: { ideasPerBoard: 1 | 2; checkIns: "often" | "sometimes" | "rarely"; recap: boolean };
  examples: { from: string[]; fromInterests: boolean; local: string | null; realLife: boolean; second: boolean };
  visuals: { lead: "pictures" | "balanced"; labelWords: number; keyNotes: boolean };
  practice: "often" | "sometimes" | "light";
  goal: LearningGoal | null;
  /** Why — "Grade 8", "you like pictures" — for the planning screen's one line. */
  because: string[];
};

/** What this lesson has shown, when there was a planning conversation. */
export type LessonEvidence = { learner?: LearnerProfile | null; depth?: DepthLevel | null };

const GOAL_FOR_OBJECTIVE: Partial<Record<LearningObjective, LearningGoal>> = { exam: "exams", curiosity: "curious", fundamentals: "understand" };

function bandFor(grade: number): ReadingBand {
  return grade <= 3 ? "early" : grade <= 5 ? "primary" : grade <= 8 ? "middle" : grade <= 12 ? "secondary" : "university";
}

const GUIDANCE_ORDER: Guidance[] = ["worked", "faded", "independent"];
const shift = (g: Guidance, by: number): Guidance => GUIDANCE_ORDER[Math.max(0, Math.min(2, GUIDANCE_ORDER.indexOf(g) + by))];

export function buildTeachingPolicy(card: StudentCard, evidence: LessonEvidence = {}): TeachingPolicy {
  const prefs = card.preferences;
  const helps = new Set(prefs?.helps ?? []);
  const support = card.support;
  const adhd = support.accessibility === "adhd";
  const dyslexia = support.accessibility === "dyslexia";
  const conceptGrade = card.readingGrade;
  const plainEnglish = prefs?.english === "learning";
  // Plain English is short, common-word, active sentences (Abedi & Lord 2001) — two grades down, so
  // it bites even where a model already writes below the grade; simpler language stacks on it.
  const readingGrade = Math.max(2, conceptGrade - (plainEnglish ? 2 : 0) - (support.simplerLanguage ? 1 : 0));
  const band = bandFor(conceptGrade);
  const young = band === "early" || band === "primary";
  const rules = gradeRules(readingGrade);
  const because: string[] = [];
  if (card.level) because.push(card.level);

  // What this lesson showed beats the grade's default: a novice at any age gets the worked example.
  const depth = evidence.depth ?? null;
  let guidance: Guidance = depth !== null
    ? depth <= 2 ? "worked" : depth === 3 ? "faded" : "independent"
    : band === "university" || band === "secondary" ? "faded" : "worked";
  if (prefs?.challenge === "gentle") guidance = shift(guidance, -1);
  if (prefs?.challenge === "stretch") guidance = shift(guidance, 1);
  if (helps.has("worked-examples") && guidance === "independent") guidance = "faded";

  const abstraction: TeachingPolicy["abstraction"] = young
    ? "concrete"
    : band === "middle" || (depth !== null && depth <= 2)
      ? "concrete-first"
      : band === "university" && (depth ?? 3) >= 4 && prefs?.challenge !== "gentle"
        ? "formal"
        : "balanced";

  const load = evidence.learner && depth ? cognitiveLoad(evidence.learner, depth) : "medium";
  const oneIdea = young || support.slowerPace || adhd || prefs?.challenge === "gentle" || load === "high";
  const checkIns: TeachingPolicy["pacing"]["checkIns"] = young || adhd || helps.has("try-it") || prefs?.challenge === "gentle"
    ? "often"
    : band === "university" && prefs?.challenge === "stretch" ? "rarely" : "sometimes";

  // This lesson's own stated aim ("I have an exam") beats the profile's general one.
  const lessonGoal = evidence.learner ? GOAL_FOR_OBJECTIVE[evidence.learner.objective] : undefined;
  const goal = lessonGoal ?? prefs?.goal ?? null;

  const interests = interestExamples(prefs?.interests ?? []);
  const practice: TeachingPolicy["practice"] = helps.has("try-it") || goal === "exams"
    ? "often"
    : goal === "curious" && !young ? "light" : "sometimes";

  if (helps.has("pictures")) because.push("pictures");
  if (helps.has("worked-examples")) because.push("step-by-step examples");
  if (helps.has("real-life")) because.push("real-life examples");
  if (helps.has("short-notes")) because.push("short notes");
  if (helps.has("try-it")) because.push("trying it yourself");
  if (plainEnglish) because.push("plain English");
  if (support.simplerLanguage && !plainEnglish) because.push("simpler language");

  return {
    card,
    band,
    readingGrade,
    conceptGrade,
    language: {
      sentenceWords: plainEnglish ? Math.min(14, rules.sentenceWords) : rules.sentenceWords,
      newTermsPerBoard: rules.newTerms,
      plainEnglish,
      assume: gradeRules(conceptGrade).assume,
    },
    abstraction,
    guidance,
    pacing: { ideasPerBoard: oneIdea ? 1 : 2, checkIns, recap: young || goal === "exams" || helps.has("short-notes") || support.slowerPace },
    examples: {
      from: interests.length ? interests : [rules.examples],
      fromInterests: interests.length > 0,
      local: card.country,
      realLife: helps.has("real-life"),
      second: helps.has("worked-examples") || helps.has("real-life") || card.moreExamples >= 2,
    },
    visuals: {
      lead: helps.has("pictures") || young ? "pictures" : "balanced",
      labelWords: Math.max(2, (band === "early" ? 2 : band === "primary" ? 3 : band === "middle" ? 4 : 5) - (dyslexia ? 1 : 0)),
      keyNotes: helps.has("short-notes"),
    },
    practice,
    goal,
    because,
  };
}

/* ── the policy, in each stage's words ───────────────────────────────────────────────────── */

const ABSTRACTION_LINE: Record<TeachingPolicy["abstraction"], string> = {
  concrete: "Everything concrete: start from something they can see, hold or picture, and name the idea only after the example. No rule without a real case in front of it.",
  "concrete-first": "Concrete first: a real case or picture, then the general idea, then its name.",
  balanced: "Pair each general idea with one concrete case.",
  formal: "State ideas precisely; formal notation is fine once each symbol has been said in words.",
};

const GUIDANCE_LINE: Record<Guidance, string> = {
  worked: "Show a fully worked example before the general rule, saying every step out loud.",
  faded: "Work the first steps of an example, then let them predict the last one before you show it.",
  independent: "Do not walk through basics they have; state the idea, then spend the time on why it works, edge cases and where it breaks.",
};

const GOAL_LINE: Record<LearningGoal, string> = {
  exams: "THEIR GOAL IS EXAMS: stay inside their syllabus, use its terms and the question words their exam uses (state, explain, calculate…), name the common mistake, and end on the points worth remembering.",
  homework: "THEY WANT HOMEWORK HELP: teach the method on an example like theirs, step by step, so they can do their own — the method is the lesson, not one answer.",
  understand: "THEY WANT TO REALLY UNDERSTAND: give the why before the how, and connect each idea to the one before it.",
  curious: "THEY ARE LEARNING FOR CURIOSITY: lead with what is surprising or wonderful about it, tell it as a story, and keep notation light.",
};

/** One sentence written at each young band's level — models write closer to a level they can see (Huang et al. 2024). */
const SAMPLE: Partial<Record<ReadingBand, string>> = {
  early: 'Plants need food too. But they do not eat like we do. They make food from sunlight, water and air.',
  primary: 'Plants make their own food. Their green leaves catch sunlight. They use it to turn water and air into sugar.',
  middle: 'Plants make their own food in their leaves. Chlorophyll, the green colouring, catches sunlight. The plant uses that energy to turn water and carbon dioxide into sugar.',
};

function wordsLine(p: TeachingPolicy): string {
  const l = p.language;
  const lines = [`WRITE FOR A READING LEVEL OF GRADE ${p.readingGrade}: sentences of at most ${l.sentenceWords} words; at most ${l.newTermsPerBoard} new technical term${l.newTermsPerBoard === 1 ? "" : "s"} per board, each explained in plain words the first time it appears.`];
  if (l.plainEnglish) lines.push("English is not their strongest language: short active sentences, everyday words, no idioms or phrasal verbs, the same name for a thing every time, and a key word's meaning said right after it.");
  if (p.readingGrade < p.conceptGrade) lines.push(`Only the sentences are simpler — the ideas stay at their level (${p.card.level ?? `grade ${p.conceptGrade}`}).`);
  const sample = SAMPLE[bandFor(p.readingGrade)];
  if (sample) lines.push(`Sound like this: "${sample}"`);
  return lines.join(" ");
}

function whoLine(p: TeachingPolicy): string {
  const c = p.card;
  const where = c.country ? ` in ${c.country}` : "";
  return `THE STUDENT: ${c.level ? `${c.level}${where}` : `a student${where}`}${c.curricula.length ? ` (${c.curricula.join(", ")})` : ""}.`;
}

function syllabusLine(p: TeachingPolicy): string {
  const c = p.card;
  if (c.inSubject) {
    const syllabus = c.subjectCurricula.length ? c.subjectCurricula.join(", ") : c.curricula.join(", ");
    return `This is ${c.inSubject}, one of their school subjects${c.subjectLevel ? `, which they study at ${c.subjectLevel}` : ""}: teach it the way ${syllabus ? `the ${syllabus} syllabus` : "their syllabus"} teaches it at their level — its scope, its terms, its usual examples — and nothing it leaves for later years.`;
  }
  if (c.topicSubject) return `${c.topicSubject} is not one of their school subjects, so treat it as new ground — but they are still ${c.level ?? "the same student"}: same language, same age.`;
  return "";
}

function examplesLine(p: TeachingPolicy): string {
  const e = p.examples;
  const local = e.local ? `, set in ${e.local} — its places, its money, its everyday life — unless the topic is about somewhere else` : "";
  const parts = [`Examples from ${e.fromInterests ? "what they are into" : "their own life"} (${e.from.join("; ")})${local}.`];
  if (e.realLife) parts.push("Tie each idea to where they meet it in real life.");
  if (e.second) parts.push("Give the key idea a second, different example.");
  return parts.join(" ");
}

function pacingLine(p: TeachingPolicy): string {
  const ideas = p.pacing.ideasPerBoard === 1 ? "One new idea per board, said again in other words before moving on." : "Up to two connected ideas per board.";
  const checks = p.pacing.checkIns === "often" ? " Check in often with a quick question they can answer in their head." : p.pacing.checkIns === "rarely" ? " Keep check-ins rare; they want momentum." : "";
  return `${ideas}${checks}${p.pacing.recap ? " Close with the few points worth remembering." : ""}`;
}

function questionsLine(p: TeachingPolicy): string {
  if (p.band === "early" || p.band === "primary") return 'Questions are friendly and concrete: "what do you think happens if…?", with an everyday answer.';
  if (p.goal === "exams") return "Questions sound like their exam's: recall a fact, explain why, apply it to a short case.";
  if (p.guidance === "independent") return "Questions ask them to apply the idea to a new case or predict where it breaks.";
  return "Questions mix remembering, explaining why, and applying it to a small case.";
}

/** The lecture writer: the whole policy. A strict lesson keeps only the words — its content is its source. */
export function policyForWriter(p: TeachingPolicy, options: { strict?: boolean } = {}): string {
  if (options.strict) return wordsLine(p);
  return [
    `${whoLine(p)} HOW TO TEACH THEM — their Teaching Policy; follow every line:`,
    syllabusLine(p),
    wordsLine(p),
    `Assume ${p.language.assume}.`,
    ABSTRACTION_LINE[p.abstraction],
    GUIDANCE_LINE[p.guidance],
    pacingLine(p),
    examplesLine(p),
    questionsLine(p),
    p.goal ? GOAL_LINE[p.goal] : "",
  ].filter(Boolean).join("\n");
}

/** The outline planner: who it is for and how far it goes — not how to write. */
export function policyForPlanner(p: TeachingPolicy): string {
  const c = p.card;
  const who = `${c.level ?? "A student"}${c.country ? ` in ${c.country}` : ""}${c.curricula.length ? ` (${c.curricula.join(", ")})` : ""}`;
  const scope = c.inSubject
    ? `${c.inSubject} is one of their school subjects${c.subjectLevel ? ` (at ${c.subjectLevel})` : ""}: plan what their syllabus covers at this level, and nothing it leaves for later years.`
    : c.topicSubject
      ? `${c.topicSubject} is not one of their school subjects: plan it as new ground, pitched for their level.`
      : "Pitch the plan for their level.";
  const steps = p.pacing.ideasPerBoard === 1 ? " Plan small steps: one idea per part." : "";
  const goal = p.goal === "exams" ? " They are preparing for exams: cover what their exam asks." : p.goal === "homework" ? " They want homework help: plan the method, then an example like theirs." : p.goal === "curious" ? " They are learning for curiosity: plan the surprising, interesting parts too." : "";
  return `\nWHO THE LESSON IS FOR: ${who}. ${scope}${steps}${goal}`;
}

/** The canvas planner writes every script AND picks each board's stage, so it gets the boards too. */
export function policyForCanvasPlan(p: TeachingPolicy): string {
  const boards: string[] = [];
  if (p.visuals.lead === "pictures") boards.push("Lean on pictures: where an idea has something to see — a thing, a process, a change — choose a stage that shows it (illustration, flow, scene, graph) rather than a wordy one. Still choose by content.");
  if (p.visuals.keyNotes) boards.push("Each board's brief asks for its key point written as a short note they can keep.");
  if (p.practice === "often") boards.push("They like to practise: a lesson of three or more boards carries a quiz (a prediction) and, where a quantity can vary, a try.");
  if (p.practice === "light") boards.push("Keep interaction light: only where it genuinely helps.");
  return [policyForWriter(p), boards.length ? `THE BOARDS: ${boards.join(" ")}` : ""].filter(Boolean).join("\n");
}

/** The board generators: presentation only — never what the board depicts. */
export function policyForBoards(p: TeachingPolicy): string {
  const parts = [`Labels of at most ${p.visuals.labelWords} words, in words a Grade ${p.readingGrade} reader knows.`];
  if (p.band === "early" || p.band === "primary") parts.push("Big, simple and few elements; change one thing at a time.");
  if (p.visuals.lead === "pictures") parts.push("Show rather than write.");
  if (p.visuals.keyNotes) parts.push("Write the board's key point as one short note.");
  return parts.join(" ");
}

/** The planning questions and their answer cards, worded for the student reading them. */
export function policyForQuestions(p: TeachingPolicy): string {
  const kid = p.band === "early" || p.band === "primary";
  return `\nWORD EVERY QUESTION AND ANSWER CARD FOR ${p.card.level ?? `GRADE ${p.readingGrade}`}: reading level of grade ${p.readingGrade}, at most ${p.language.sentenceWords} words a sentence${kid ? ", friendly everyday words, and situations a child knows" : ""}${p.language.plainEnglish ? ", plain English with no idioms" : ""}.`;
}

/** Aria's live voice: the same student, in a few lines she can keep in mind while talking. */
export function policyForVoice(p: TeachingPolicy): string {
  return [
    whoLine(p),
    wordsLine(p),
    examplesLine(p),
    questionsLine(p),
    p.guidance === "worked" ? "When they are stuck, walk through a worked example step by step." : "",
  ].filter(Boolean).join("\n");
}

/** The one line the planning screen shows, so the student can see what Aria assumed. */
export function policyNote(p: TeachingPolicy | null | undefined): string {
  if (!p || !p.card.level) return "";
  const parts = [p.card.level, p.card.country, p.card.inSubject ? p.card.subjectCurricula[0] ?? p.card.curricula[0] : null].filter(Boolean);
  const leaning = p.because.slice(1, 3);
  return `Pitched for ${parts.join(" · ")}${leaning.length ? ` · ${leaning.join(", ")}` : ""}`;
}
