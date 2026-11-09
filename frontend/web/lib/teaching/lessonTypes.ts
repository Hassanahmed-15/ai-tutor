/**
 * HOW EACH KIND OF IDEA IS TAUGHT (owner, 2026-11-08: "Aria teaches; she never just gives an overview").
 *
 * Every idea of a lesson is tagged with a `LessonType` — what kind of thing it is to learn — and the
 * student's `StudentLevel`, and each pair has a TEACHING ORDER: the steps a good teacher takes, in order.
 * A course lesson teaches each idea over the boards its order needs (lib/teaching/courseOrders.ts), so
 * a new idea is built up — why it matters, the idea itself, then real examples and numbers, then a check —
 * rather than stated once. THE THEORY COMES FIRST (owner, 2026-11-09: it was teaching the numericals first).
 *
 * Pure (no app imports), so it is unit-tested (lib/anim/teachingOrders.test.ts).
 */

export const LESSON_TYPES = [
  "concept", "procedure", "proof", "coding", "problem_solving", "analysis", "language",
  "memorization", "experiment", "creative", "review", "quick_answer",
] as const;
export type LessonType = (typeof LESSON_TYPES)[number];
export const STUDENT_LEVELS = ["beginner", "intermediate", "advanced"] as const;
export type StudentLevel = (typeof STUDENT_LEVELS)[number];

/** What a board of a teaching order carries from the lesson plan, so its board is checked for it. */
export type BoardGets = "keyPoints" | "worked" | "check";

/** One board of an idea's teaching order: its student-facing title and what its script does, in order. */
export type OrderBoard = { title: (idea: string) => string; does: string[]; gets: BoardGets[] };

const ALIKE = "Stay with ONE idea. Every new term is said with what it means, in plain words, the first time.";

/**
 * THE ORDERS, board by board. Each board is one step or two of the order; together they are the whole
 * order. `gets` says which part of the lesson plan the board must teach — its key points, its worked
 * example, its understanding check — so the plan's coverage check holds the board to it.
 */
const ORDERS: Record<Exclude<LessonType, "quick_answer">, { beginner: OrderBoard[]; advanced?: OrderBoard[] }> = {
  concept: {
    beginner: [
      {
        title: (t) => `Why ${t} matters`,
        does: [
          "WHY IT MATTERS: open with one real situation from the student's life or the world where this idea matters, and the question it answers.",
          "A SIMPLE PICTURE: an honest everyday comparison that works the same way. When no comparison is honest, describe the real thing plainly instead: what it looks like, what it does. Never a comparison that teaches something false.",
        ],
        gets: [],
      },
      {
        title: (t) => `${t}: the idea`,
        does: [
          "THE IDEA: explain what it is and why it works, in general, using the correct term, which is explained simply the first time and used the same way after. No worked numbers on this board.",
        ],
        gets: ["keyPoints"],
      },
      {
        title: (t) => `${t}: a real example`,
        does: [
          "A CONCRETE EXAMPLE of the idea just explained: one real case — real numbers, a real object, a real named example — walked one step per sentence, each step with its reason (\"because…\", \"which means…\").",
          "Where it helps, one NON-example beside it, or the common mistake and why it is wrong.",
          "EXPLAIN IT BACK: end on one check question the student answers: ask it, say \"pause and think\", then give the answer with its reason.",
        ],
        gets: ["worked", "check"],
      },
    ],
    advanced: [
      {
        title: (t) => `${t}: definition and example`,
        does: [
          "A SHORT, PRECISE DEFINITION with the correct terms.",
          "A HARDER OR REAL-WORLD EXAMPLE, walked one step per sentence with the reason for each step.",
        ],
        gets: ["keyPoints", "worked"],
      },
      {
        title: (t) => `${t}: limits and edge cases`,
        does: [
          "EDGE CASES AND LIMITS: where the idea stops working, the special cases, and the common mistake with why it is wrong.",
          "PRACTICE: one question that needs the idea; ask it, pause, then answer it with its reason.",
        ],
        gets: ["check"],
      },
    ],
  },
  procedure: {
    beginner: [
      {
        title: (t) => `${t}: the idea and the steps`,
        does: [
          "THE IDEA FIRST: what this is, what each quantity means, and why the method works, in plain words. Say any formula in words as well as symbols, with every symbol explained. No numbers are worked on this board.",
          "THE GENERAL STEPS: the method as numbered steps in plain words, each with when and why it is used, and the step students most often get wrong.",
        ],
        gets: ["keyPoints"],
      },
      {
        title: (t) => `${t}: a worked example`,
        does: [
          "ONE WORKED EXAMPLE using the steps just taught, start to answer: each step in its own sentence, with WHY that step is done (\"we divide both sides by 2 because we want x on its own\"). Every value and unit is said.",
        ],
        gets: ["worked"],
      },
      {
        title: (t) => `${t}: your turn`,
        does: [
          "THE STUDENT TRIES A SIMILAR ONE: give a new example of the same kind with different numbers; ask the student to try it; say \"pause and try it\"; then walk the answer step by step with the reason for each step.",
          "MORE PRACTICE, A LITTLE HARDER: one harder question; ask, pause, then answer it step by step.",
        ],
        gets: ["check"],
      },
    ],
    advanced: [
      {
        title: (t) => `${t}: method and example`,
        does: [
          "THE METHOD as numbered steps with their reasons, then ONE worked example done with it, every step said.",
        ],
        gets: ["keyPoints", "worked"],
      },
      {
        title: (t) => `${t}: harder practice`,
        does: [
          "A HARDER QUESTION the student tries (pause), then the full answer; then the mistake that loses marks and how to avoid it.",
        ],
        gets: ["check"],
      },
    ],
  },
  proof: {
    beginner: [
      {
        title: (t) => `${t}: what we will prove`,
        does: [
          "THE STATEMENT IN PLAIN WORDS: what is true, for which cases, with every letter or symbol defined.",
          "WHY IT MATTERS: what it lets us do.",
          "THE MAIN IDEA of the proof in one or two sentences, and the figure or set-up drawn.",
        ],
        gets: [],
      },
      {
        title: (t) => `${t}: the proof, step by step`,
        does: [
          "THE PROOF, one step per sentence: what we do and WHY it is allowed. Never skip a line of algebra. The result is said only at the end, earned by the steps.",
          "THE TECHNIQUE: in one sentence, the trick the proof used, so the student can use it again.",
        ],
        gets: ["keyPoints", "worked"],
      },
    ],
  },
  coding: {
    beginner: [
      {
        title: (t) => `${t}: the goal and the idea`,
        does: [
          "THE GOAL: the problem this code solves, in one concrete situation.",
          "THE CONCEPT: the general idea and its correct term, in plain words, before any code.",
          "THE IDEA AT WORK: how it works, done by hand on a picture of the data with small real values, one step per sentence.",
        ],
        gets: ["keyPoints"],
      },
      {
        title: (t) => `${t}: build it together`,
        does: [
          "BUILD THE CODE TOGETHER in small steps: each line written in its own sentence saying what it does and why it is needed. Real, runnable code.",
        ],
        gets: ["worked"],
      },
      {
        title: (t) => `${t}: run it and change it`,
        does: [
          "RUN IT: trace it on real input, one executed line per sentence — each variable's new value and what is printed.",
          "CHANGE ONE THING: change one line or value; ask the student to predict the new output; pause; then show it and say why.",
          "EDGE CASES: empty input, the boundary and, when the level includes it, the cost.",
        ],
        gets: ["check"],
      },
    ],
    advanced: [
      {
        title: (t) => `${t}: the code`,
        does: [
          "THE GOAL in one sentence, then the code, each line in its own sentence with what it does and why.",
        ],
        gets: ["keyPoints", "worked"],
      },
      {
        title: (t) => `${t}: trace and edge cases`,
        does: [
          "A TRACE on real input, one executed line per sentence; then the edge cases and the cost; then one change the student predicts (pause, then the answer).",
        ],
        gets: ["check"],
      },
    ],
  },
  problem_solving: {
    beginner: [
      {
        title: (t) => `${t}: the idea you need`,
        does: [
          "THE IDEA FIRST: the ideas and the method this kind of problem needs, each explained in plain words with why it works. No problem is worked on this board.",
        ],
        gets: ["keyPoints"],
      },
      {
        title: (t) => `${t}: the problem`,
        does: [
          "THE PROBLEM: state it in full with its data. THE STUDENT ATTEMPTS IT: ask them to try; say \"pause and try\".",
          "HINTS, ONE AT A TIME, smallest first: each says one thing to try, using the idea just taught.",
          "THE FULL SOLUTION: step by step, each with its reason, to the answer with units.",
        ],
        gets: ["worked"],
      },
      {
        title: (t) => `${t}: a similar problem`,
        does: [
          "A SIMILAR PROBLEM: new data, the same idea; the student tries (pause); then the answer with each step's reason.",
        ],
        gets: ["check"],
      },
    ],
  },
  analysis: {
    beginner: [
      {
        title: (t) => `${t}: the context`,
        does: [
          "CONTEXT: when, where and who, in plain words.",
          "THE SOURCE, TEXT OR WORK ITSELF: what it says or shows, described accurately and named with where it comes from. Never invent a quotation, date or source.",
        ],
        gets: [],
      },
      {
        title: (t) => `${t}: reading it closely`,
        does: [
          "GUIDED QUESTIONS: two or three questions a careful reader asks, each answered with evidence from the source or case.",
          "THE ANALYSIS: what the evidence shows, and why, linked to the key points.",
        ],
        gets: ["keyPoints"],
      },
      {
        title: (t) => `${t}: different views`,
        does: [
          "DIFFERENT VIEWPOINTS, FAIRLY: the main views, each with its evidence and its weakness. No personal opinion.",
          "A SUPPORTED JUDGEMENT: how a strong answer weighs them and reaches a judgement; then ask the student for their own view with one piece of evidence.",
        ],
        gets: ["worked", "check"],
      },
    ],
    advanced: [
      {
        title: (t) => `${t}: evidence and analysis`,
        does: [
          "CONTEXT in one or two sentences, then the source or case, then the analysis with evidence for each key point.",
        ],
        gets: ["keyPoints"],
      },
      {
        title: (t) => `${t}: views and judgement`,
        does: [
          "THE VIEWPOINTS with their evidence and limits, then a supported judgement; then ask the student to defend a view with evidence.",
        ],
        gets: ["worked", "check"],
      },
    ],
  },
  language: {
    beginner: [
      {
        title: (t) => `${t}: the rule`,
        does: [
          "THE LANGUAGE OF THE LESSON: explain in the language the key points are written in. Only the example sentences and the practice are in the language being learned.",
          "THE RULE, SIMPLY, with its correct grammar term explained the first time, and when it is used.",
        ],
        gets: ["keyPoints"],
      },
      {
        title: (t) => `${t}: examples in context`,
        does: [
          "EXAMPLE SENTENCES IN CONTEXT: three or four real sentences that use the rule (with a translation, and how to say it where that helps), pointing out the rule in each.",
          "GUIDED PRACTICE: one sentence the student completes with the rule; pause; then the answer with why.",
        ],
        gets: ["worked"],
      },
      {
        title: (t) => `${t}: your turn`,
        does: [
          "THE STUDENT PRODUCES IT: ask them to make their own sentence.",
          "CORRECTION WITH A REASON: the two mistakes learners make most, each corrected with why.",
        ],
        gets: ["check"],
      },
    ],
  },
  memorization: {
    beginner: [
      {
        title: (t) => `${t}: the big picture`,
        does: [
          "STRUCTURE FIRST: the groups, story, order or map the facts belong to, so each fact has a place.",
          "SMALL CHUNKS: the facts a few at a time, each with what it means.",
        ],
        gets: ["keyPoints"],
      },
      {
        title: (t) => `${t}: remember it`,
        does: [
          "A MEMORY AID: one honest mnemonic, story or picture that makes the facts stick.",
          "ACTIVE RECALL: two or three quick questions; ask each, pause, then give the answer.",
        ],
        gets: ["check"],
      },
    ],
  },
  experiment: {
    beginner: [
      {
        title: (t) => `${t}: the question and your prediction`,
        does: [
          "THE QUESTION the experiment answers.",
          "THE STUDENT'S PREDICTION: ask what they think will happen and why; pause.",
          "THE METHOD: the apparatus, the steps, and what is changed, measured and kept the same.",
        ],
        gets: [],
      },
      {
        title: (t) => `${t}: what happens and why`,
        does: [
          "OBSERVE: what is seen or measured, with real values.",
          "EXPLAIN THE RESULT with its reason, and connect it to the idea it shows. Was the prediction right?",
        ],
        gets: ["keyPoints", "worked", "check"],
      },
    ],
  },
  creative: {
    beginner: [
      {
        title: (t) => `${t}: a model`,
        does: [
          "A MODEL EXAMPLE: a short piece of the kind being made.",
          "WHAT MAKES IT GOOD: each feature named with its correct term and pointed to in the model.",
        ],
        gets: ["keyPoints"],
      },
      {
        title: (t) => `${t}: plan and write yours`,
        does: [
          "A GUIDED OUTLINE: the steps to plan one.",
          "THE STUDENT CREATES: ask them to write or design a short one; then SPECIFIC FEEDBACK — what a good one does and how to revise.",
        ],
        gets: ["worked", "check"],
      },
    ],
  },
  review: {
    beginner: [
      {
        title: (t) => `${t}: check yourself`,
        does: [
          "QUESTIONS FIRST: ask, pause, then answer each.",
          "EXPLAIN ONLY THE MISTAKES students make on them, with why.",
          "A SHORT SUMMARY of what to remember.",
        ],
        gets: ["keyPoints", "check"],
      },
    ],
  },
};

/** The boards an idea of this type is taught over, for this student. */
export function orderBoards(type: LessonType, level: StudentLevel): OrderBoard[] {
  if (type === "quick_answer") return ORDERS.concept.advanced!.slice(0, 1);
  const order = ORDERS[type];
  return level === "advanced" && order.advanced ? order.advanced : order.beginner;
}

/** The most boards any idea takes, for sizing lessons before the student's level is known. */
export const MAX_ORDER_BOARDS = 3;

/** The order as one line, for prompts (the live tutor, a side question). */
export function orderLine(type: LessonType, level: StudentLevel): string {
  return orderBoards(type, level).flatMap((b) => b.does.map((d) => d.split(":")[0].trim())).join(" → ");
}

/**
 * THE STUDENT'S LEVEL for a course lesson. A self-rating of "intermediate" says little about a syllabus
 * topic they are meeting for the first time, so a first lesson is taught from the ground up unless
 * the student is advanced.
 */
export function studentLevelFor(expertise: unknown, firstTime = true): StudentLevel {
  if (expertise === "advanced") return "advanced";
  if (expertise === "intermediate") return firstTime ? "beginner" : "intermediate";
  return "beginner";
}

const HUMANITIES = /histor|geograph|sociolog|psycholog|politic|government|law|religio|islamiyat|pakistan studies|business|econom|media|classical|philosoph|literature|global perspectives|citizenship|art history|english language/i;
/** A course in learning a language (not one taught in English about language): its ideas are language practice. */
const LANGUAGE_COURSE = /\b(urdu|arabic|french|spanish|german|chinese|mandarin|japanese|korean|italian|bengali|hindi|persian|farsi|turkish|afrikaans|bahasa|hebrew|latin|sindhi|punjabi|pashto|esl|english as a (second|foreign) language|second language|foreign language)\b/i;
const CREATIVE_SUBJECT = /\b(art|design|drama|music|creative|textile|fine arts|media production)\b/i;
const SCIENCE = /biolog|chemistr|physic|science|environment|agricultur|food/i;
const COMPUTING = /computer|computing|\bict\b|information technology|programming/i;
const MATHS = /math|statistic|calculus|further/i;

/**
 * WHAT KIND OF IDEA THIS IS, from the syllabus wording and the subject. Command words decide it: they are
 * how an official syllabus says what the student must be able to do ("calculate" is a procedure,
 * "evaluate" an analysis, "state" a fact to remember). Deterministic, so a cached lesson plan gets the
 * same tags for every student and nothing is spent on it. Checked on 40 real catalogue lessons across
 * 20 subjects (lib/anim/teachingOrders.test.ts).
 */
export function lessonTypeOf(idea: { subject: string; title?: string; objective?: string; keyPoints?: string[]; outcomes?: string[] }): LessonType {
  const words = [idea.title, idea.objective, ...(idea.outcomes ?? []), ...(idea.keyPoints ?? [])].filter(Boolean).join(" ").toLowerCase();
  const asked = [idea.title, idea.objective, ...(idea.outcomes ?? [])].filter(Boolean).join(" ").toLowerCase();
  const subject = idea.subject.toLowerCase();
  const analysisAsked = /\b(evaluat\w*|assess\w*|analy[sz]\w*|discuss|to what extent|interpret\w*|significance|causes?|consequences?|reasons? for|compare|judge|judging|justify|primary sources?|historical sources?|source analysis|use (of )?sources|explain why|importance|perspectives?|viewpoints?|critically)\b/;
  if (LANGUAGE_COURSE.test(subject)) return "language";
  // Code only when the idea is about writing, reading or tracing code — not every lesson that says "program".
  if (COMPUTING.test(subject) && /\b(writ(?:e|ing) (?:the |some |your )?code|lines? of code|the code (?:that|to|which|below|above)|coding|python|java|pseudocode|algorithms?|write (a |an )?programs?|programming|trace tables?|tracing|loops?|iteration|arrays?|variables?|subroutines?|recursion|recursive|sorting|searching|sql|html|data structures?|selection statements?|boolean logic)\b/.test(words)) return "coding";
  // A proof: "prove", "derive", or "show that" a GENERAL statement — not "show that 100 can be made from ten tens".
  if ((MATHS.test(subject) || /physic/.test(subject)) && (/\b(prove|proof|derive|derivation)\b/.test(asked) || (/\bshow that\b/.test(asked) && /\b[a-z]\s*[=+×÷^]\s*\w|\bfor (?:all|any|every)\b|\btheorem\b|\bidentity\b/.test(asked)))) return "proof";
  if (SCIENCE.test(subject) && /\b(investigat\w*|experiment\w*|practical|apparatus|test for|titration|chromatograph\w*|required practical)\b/.test(asked)) return "experiment";
  if (/\b(solve problems?|word problems?|problem[- ]solving)\b/.test(asked)) return "problem_solving";
  if (CREATIVE_SUBJECT.test(subject) && !/art history/.test(subject) && /\b(write (a|an|your)|compose|creative writing|narrative writing|descriptive writing|design (a|an|your)|produce|create|make (production )?drawings|prototyp\w*|model-making|computer-aided design|\bcad\b|sketch\w*|develop ideas|techniques?)\b/.test(asked)) return "creative";
  if (/\b(calculat\w*|solve|balanc(?:e|ing) (?:the |a |an )?(?:chemical |symbol |ionic )?equations?|convert|construct|plot|use the formula|apply the|work out|find the|determine|simplif\w*|factori[sz]\w*|expand|substitut\w*|rearrang\w*|estimate|measure|prepare (a|an|the)?\s*(statement|account|budget|cash flow|trial balance|ledger|journal)\w*|record (transactions|entries))\b/.test(asked) && !(HUMANITIES.test(subject) && analysisAsked.test(asked))) return "procedure";
  if (HUMANITIES.test(subject) && analysisAsked.test(asked)) return "analysis";
  // Facts to remember: only when every outcome asks for recall, never for an explanation.
  if (/\b(state|name|list|identify|recall|label|recognis\w*|recogniz\w*)\b/.test(asked) && !/\b(explain|describe how|why|how does|compare|evaluat\w*|discuss|examples?)\b/.test(asked)) return "memorization";
  return "concept";
}

/** RULES FOR EVERY LESSON, whatever its type (they sit beside the course's EASY WORDS). */
export const TEACHING_RULES = [
  "HOW ARIA TEACHES — TEACH, NEVER SUMMARISE:",
  "- Explain every idea fully, like a great teacher at a whiteboard. Never an overview: a sentence that only names an idea (\"Photosynthesis converts light energy into chemical energy\") is not teaching until it is built up — why, a picture, a real example, the rule, a check.",
  "- Short sentences, one idea per sentence, clear everyday words.",
  "- Simple does not mean dropping the real terms: teach the correct term, explain it simply the first time it is said, then use the same term every time.",
  "- Show every step, and say WHY each step is done.",
  "- Explain the idea first, in plain words, with why it works. Real numbers, worked examples and calculations come after the idea has been taught, never before it.",
  "- Check understanding after each idea: ask, say \"pause and think\", then give the answer with its reason.",
  "- NEVER SAY: \"basically\", \"simply\", \"obviously\", \"clearly\", \"just\" (as in \"just do this\"), \"as you know\". They tell a student who is lost that it should be easy.",
  "- A comparison must be honest: when no everyday comparison works the same way, use definition → examples AND non-examples → properties instead. Never a misleading analogy.",
  "- A contested question: the main viewpoints fairly, each with its evidence. No personal opinion.",
  "- Be accurate. Never invent a fact, quotation, date, source or number; when something is uncertain, say so.",
];

/**
 * OVERVIEW VERSUS TEACHING, one pair per kind of idea, from different subjects — what the rules above
 * mean in practice. The ✅ version is the one to write.
 */
export const TEACHING_EXAMPLES = [
  "OVERVIEW (❌) VERSUS TEACHING (✅) — write the ✅ kind:",
  "CONCEPT (Biology, beginner):",
  "❌ \"Photosynthesis converts light energy into chemical energy in chloroplasts.\"",
  "✅ \"Plants can't go to a shop for food, so they make their own. Think of a leaf as a tiny kitchen. It uses three ingredients: sunlight, water from the roots, and carbon dioxide, a gas from the air. Inside the leaf are tiny green parts called chloroplasts. A green substance in them, chlorophyll, catches the sunlight. Using that light, the leaf turns water and carbon dioxide into glucose, a sugar the plant uses as food. It also gives out oxygen. Quick check: what are the three ingredients?\"",
  "PROCEDURE (Maths, solving an equation):",
  "❌ \"To solve 3x + 5 = 20, isolate x to get x = 5.\"",
  "✅ \"We want x on its own. First, 5 is added to 3x, so we take 5 away from both sides, because an equation stays true when both sides change the same way: 3x = 15. Now x is multiplied by 3, so we divide both sides by 3: x = 5. Let's check it: 3 times 5 is 15, plus 5 is 20. It works. Your turn: solve 2x + 7 = 19.\"",
  "CODING (Computer Science, a loop):",
  "❌ \"A for loop iterates over a range and accumulates a total.\"",
  "✅ \"We want the total of the numbers 1 to 4. We start with total = 0. The line for i in range(1, 5) gives i the values 1, 2, 3 and 4, one at a time. Each time, total = total + i adds the current i. After i is 1, total is 1. After i is 2, total is 3. After i is 3, total is 6. After i is 4, total is 10. Predict: what is total if the range is range(1, 6)?\"",
  "ANALYSIS (History, causes of an event):",
  "❌ \"The First World War was caused by militarism, alliances, imperialism and nationalism.\"",
  "✅ \"In 1914, Europe's great powers were split into two alliances. An alliance is a promise to fight for each other. So when Austria-Hungary declared war on Serbia in July 1914, the promises pulled in Russia, then Germany, then France and Britain. That is why one local war became a world war. Historians disagree on how much each cause mattered. Some put most weight on the alliances. Others say Germany's choices in July 1914 mattered more. Which cause do you think mattered most, and what is your evidence?\"",
  "LANGUAGE (English, the past simple):",
  "❌ \"The past simple is formed by adding -ed to regular verbs.\"",
  "✅ \"We use the past simple tense for an action that is finished, in the past. For most verbs, we add -ed: walk becomes walked. Look: 'Yesterday I walked to school.' 'Last week she played cricket.' Both verbs end in -ed, and both actions are finished. Your turn: put 'jump' in the past simple.\"",
  "MEMORIZATION (Chemistry, the first elements):",
  "❌ \"The first five elements are hydrogen, helium, lithium, beryllium and boron.\"",
  "✅ \"The elements are listed in order of their atomic number, the number of protons in one atom. Number 1 is hydrogen, the lightest. Number 2 is helium, the gas in party balloons. Then come lithium (3), beryllium (4) and boron (5). A sentence helps you remember them: 'Happy Henry Likes Beans Bubbling', for H, He, Li, Be, B. Quick check: which element is number 3?\"",
  "EXPERIMENT (Physics, what affects a pendulum):",
  "❌ \"The period of a pendulum depends on its length, not its mass.\"",
  "✅ \"Question: does a heavier pendulum swing more slowly? Predict before we test it. We time 10 swings with a 50 g mass on a 1 m string: 20 seconds, so one swing takes 2 seconds. Now we change only the mass, to 100 g, and keep the length the same: still 20 seconds. Then we shorten the string to 25 cm: now 10 swings take 10 seconds. So the length changes the swing time, and the mass does not. Was your prediction right?\"",
];

/**
 * MATHS, TAUGHT SO A STUDENT UNDERSTANDS (owner, 2026-11-08: "edit maths and CS teaching style in a more
 * understandable and clearer way, in a way it never teaches an overview and explains every concept").
 * Replaces lib/canvas/lessonRequest.ts MATHS_CS_TEACHING for course lessons with teaching orders on.
 */
export const MATHS_TEACHING = [
  "THIS IS A MATHS LESSON — THE STUDENT MUST UNDERSTAND EVERY STEP, NOT JUST SEE THE ANSWER:",
  "- Teach every new idea before any calculation: what it is, what each quantity means and why it works, with a drawing or something the student can picture. Numbers and worked examples come after that.",
  "- Say WHAT we are trying to find before any working (\"We want the length of the side we cannot measure.\").",
  "- Every step gets its own sentence with its PURPOSE first, then the step: \"To get x on its own, we subtract 3 from both sides: 2x = 8.\" Never a step without its reason.",
  "- Never skip a line of algebra: each expansion, cancellation and rearrangement is said and written. One operation on both sides is one line, and the operation named is the one that gives that line.",
  "- Explain every symbol the first time it appears (\"θ, a Greek letter we use for an angle\"), and say every formula in words as well as symbols.",
  "- A rule is never given bare: show WHY it is true — a picture, a pattern in real numbers, or a short reason — before or right after stating it.",
  "- After the worked example, the student does one like it: give it, pause, then walk the answer. Then the common mistake and why it is wrong.",
  "- State every condition a result needs, as a mark scheme does (a right angle for Pythagoras; a ≠ 0 for a quadratic). The standard case comes first; special cases after.",
  "- Say every answer as an equation with its unit (\"so c = 10 cm\"): the board writes what is said. Say a matrix by its rows, never as brackets read aloud.",
  "- A proof is built step by step, never stated whole: what will be proved, the figure, one step per sentence with why it is allowed, and the result only at the end.",
  "- End each idea with what the student can now do, in plain words — said differently each time.",
].join("\n");

/** Computer science, taught so a student who has never seen it can write and trace it. */
export const CS_TEACHING = [
  "THIS IS A COMPUTER SCIENCE LESSON — A STUDENT WHO HAS NEVER SEEN THIS MUST UNDERSTAND WHAT IT IS, WHY IT WORKS AND HOW TO WRITE AND TRACE IT:",
  "- Every idea starts with the PROBLEM it solves, in one concrete situation (\"a shop needs the cheapest item in a list of 1,000 prices\").",
  "- Then the IDEA, done by hand on a picture of the data with small real values — boxes for variables and memory, arrows for pointers and references — one step per sentence, before any code.",
  "- Then the CODE, real and runnable (Python unless the syllabus or the student names another language, or the exam board's pseudocode). Each line gets its own sentence: what it does and WHY it is needed. Never \"the rest of the code\", never prose dressed as code.",
  "- Then the TRACE on real input, one executed line per sentence: each variable's new value, each call pushed or returned, what is printed. The values are the ones the code really produces. At least one loop pass or call per sentence; never a whole loop in one sentence.",
  "- Then CHANGE ONE THING: the student predicts what a small change does (pause), then the answer with why.",
  "- Then the EDGE CASES (empty input, one item, the boundary), the classic bug and its fix, and the cost (time and space, with the reason) when the level includes it.",
  "- Every term is defined in plain words the first time, with what it looks like on the board (index, pointer, base case, stack frame, LIFO).",
  "- Everything drawn is explained as it is drawn: every box, arrow, value and line of code is named in the sentence that draws it, with what it MEANS.",
  "- One function per code board, written whole (the code card scrolls past 10 lines). A board about edge cases shows only the lines it adds or changes.",
].join("\n");
