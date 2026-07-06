/**
 * Autism-track companion content for the photosynthesis lecture. Built to the supplied
 * spec exactly: a literal step-by-step breakdown of any vague instruction, a plainer
 * "explain simply" version of each beat, a short schedule label for the Now / Next / Later
 * strip, and sensory pre-warnings for upcoming beats whose visuals/audio could overload.
 *
 * Purely additive — keyed by the same beat `id`s already in lessonContent.ts, read only by
 * AutismLessonPlayer. Zero effect on any other track.
 */

export interface AutismBeatContent {
  /** Very short label for the Now / Next / Later schedule strip (≤ ~22 chars). */
  scheduleLabel: string;
  /** A plainer, calmer restatement of the beat — shown/spoken when the student taps
   *  "Explain Simply". Literal, concrete, no idioms. */
  explainSimply: string;
  /** When the beat contains an instruction or question that is vague/implicit, the literal
   *  step-by-step task breakdown (the spec's "Just summarize your thoughts" -> 3-step
   *  checklist). Omitted when the beat has no actionable instruction. */
  literalSteps?: string[];
  /** If this beat's visuals/audio could be a sensory-overload trigger, a short warning the
   *  player surfaces ~before the beat begins (the spec's "Heads up: loud video in 30s"). */
  sensoryWarning?: string;
  /** Rough spoken length of this beat in seconds — drives the per-step time estimate so the
   *  student always knows how long the current step lasts (predictability reduces anxiety). */
  seconds: number;
}

/**
 * Lecture-wide idiom / metaphor glossary. The photosynthesis script leans heavily on a
 * "kitchen" metaphor ("a leaf is a kitchen", "the stove", "cooking", "the recipe"). Figures
 * of speech are a well-known friction point for literal-minded autistic learners, so the
 * player can flag each phrase inline and show its plain, literal meaning on tap. Match is
 * case-insensitive on the `phrase`.
 */
export interface IdiomEntry {
  phrase: string;
  literal: string;
}

export const lectureIdioms: IdiomEntry[] = [
  { phrase: "kitchen", literal: "the place inside the leaf where food is made (the chloroplast)" },
  { phrase: "stove", literal: "the sunlight — the energy source that powers the process" },
  { phrase: "cooks its own", literal: "makes its own food, instead of eating food from outside" },
  { phrase: "cooking", literal: "the process of making food (photosynthesis)" },
  { phrase: "delivery truck", literal: "the way the ingredients (sunlight, water, gas) arrive at the leaf" },
  { phrase: "the meal", literal: "the sugar the plant makes and keeps as food" },
  { phrase: "exhaust", literal: "oxygen — the leftover gas the plant releases into the air" },
  { phrase: "order up", literal: "the food (sugar) is finished and ready" },
  { phrase: "reverse kitchen", literal: "the opposite process — your body breaking food down instead of building it" },
  { phrase: "recipe", literal: "the set of steps the plant follows to make food" },
];

export const autismBeatContent: Record<string, AutismBeatContent> = {
  hook: {
    scheduleLabel: "The big question",
    seconds: 35,
    explainSimply:
      "A plant never eats food like you do. But it still grows. We will find out where a plant gets its energy. The plant makes its own food using sunlight. The name for this is photosynthesis.",
  },
  "define-photosynthesis": {
    scheduleLabel: "What the word means",
    seconds: 25,
    explainSimply:
      "The word photosynthesis has two parts. \"Photo\" means light. \"Synthesis\" means building something. So photosynthesis means: using light to build food.",
  },
  "ingredients-fast": {
    scheduleLabel: "The 3 ingredients",
    seconds: 25,
    explainSimply:
      "A plant needs three things to make food. One: sunlight. Two: water from the ground. Three: a gas from the air called carbon dioxide. That is all it needs.",
  },
  "checkpoint-1": {
    scheduleLabel: "Your turn: question 1",
    seconds: 20,
    explainSimply: "It is your turn to answer. Name the three things a plant needs to make food.",
    // The spec's core example: a vague instruction rewritten as a literal checklist.
    literalSteps: [
      "Think about the last slide.",
      "Type the three ingredients a plant needs.",
      "They are: sunlight, water, and carbon dioxide.",
      "Press Enter to send your answer.",
    ],
  },
  chloroplast: {
    scheduleLabel: "Where food is made",
    seconds: 30,
    explainSimply:
      "Inside every leaf are tiny parts called chloroplasts. This is the exact place where the food is made. The green color of a leaf comes from these parts.",
  },
  mechanism: {
    scheduleLabel: "How food is made",
    seconds: 45,
    explainSimply:
      "Here is how the food gets made, step by step. Light splits water into smaller pieces. Those pieces join with carbon dioxide. Together they form sugar. Sugar is the plant's food.",
    sensoryWarning: "Heads up: this next part has fast-moving animation. It is okay to take a break if you need one.",
  },
  "checkpoint-2": {
    scheduleLabel: "Your turn: question 2",
    seconds: 20,
    explainSimply: "It is your turn again. Explain what the light energy does inside the plant.",
    literalSteps: [
      "Think about the last slide about making food.",
      "Type what the light energy does.",
      "The light energy splits water apart.",
      "Press Enter to send your answer.",
    ],
  },
  outputs: {
    scheduleLabel: "What the plant makes",
    seconds: 30,
    explainSimply:
      "Making food creates two things. One: sugar, which the plant keeps and uses to grow. Two: oxygen, which the plant lets out into the air. We breathe that oxygen.",
  },
  "compare-respiration": {
    scheduleLabel: "Plants vs. you",
    seconds: 30,
    explainSimply:
      "Plants and people do opposite things. A plant takes in light, water, and carbon dioxide, and makes sugar and oxygen. Your body takes in sugar and oxygen, and makes energy and carbon dioxide. You are opposites that help each other.",
  },
  "checkpoint-3": {
    scheduleLabel: "Your turn: question 3",
    seconds: 20,
    explainSimply: "Last question. Explain where the oxygen from a plant comes from.",
    literalSteps: [
      "Think about the step where light split water apart.",
      "Type where the oxygen comes from.",
      "The oxygen comes from splitting water.",
      "Press Enter to send your answer.",
    ],
  },
  "why-it-matters": {
    scheduleLabel: "Why it matters",
    seconds: 30,
    explainSimply:
      "Photosynthesis is very important. Almost all food on Earth starts with plants making food. Almost all the oxygen we breathe came from plants. One small process does a very big job.",
  },
  recap: {
    scheduleLabel: "Review of today",
    seconds: 30,
    explainSimply:
      "Here is everything in order. The plant takes in sunlight, water, and carbon dioxide. Inside the leaf, light splits water and builds sugar. The plant keeps the sugar and lets out oxygen. That is photosynthesis.",
  },
};

export const DEFAULT_AUTISM_BEAT: AutismBeatContent = {
  scheduleLabel: "Lesson step",
  seconds: 30,
  explainSimply: "",
};
