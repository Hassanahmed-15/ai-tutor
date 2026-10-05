/**
 * HOW THE STUDENT LIKES TO LEARN — the answers to the "How do you like to learn?" screen
 * (components/auth/PreferencesScreen.tsx), stored on the learner profile and turned into the
 * Teaching Policy (lib/teachingPolicy.ts). Pure, unit-tested in lib/anim/teachingPolicy.test.ts.
 *
 * WHAT THESE ANSWERS DO, AND WHAT THEY DO NOT. Matching lessons to a "visual" or "verbal" learning
 * style does not make anyone learn more (Pashler et al. 2008, and every careful study since). So a
 * preference here changes what a lesson LEANS ON — more pictures, more worked steps, more practice —
 * and never takes a channel away: every lesson still has Aria's voice and a drawn board, and nobody
 * is ever labelled a "visual learner". What does have evidence behind it is used for real: examples
 * built from the student's interests (Walkington 2013), a goal that changes scope and practice, and
 * comfort with English kept apart from grade (a Grade 11 student still learning English gets Grade
 * 11 ideas in plainer sentences).
 *
 * Owner's decisions (2026-10-05): no "videos" option (Aria cannot make one); lessons are English only.
 */

export type LearningGoal = "exams" | "homework" | "understand" | "curious";
export type LearningHelp = "pictures" | "worked-examples" | "real-life" | "short-notes" | "try-it";
export type Challenge = "gentle" | "steady" | "stretch";
export type EnglishComfort = "first" | "comfortable" | "learning";

export type LearningPreferences = {
  goal: LearningGoal | null;
  /** What helps them most, in the order they picked it (at most MAX_HELPS). */
  helps: LearningHelp[];
  challenge: Challenge | null;
  /** Interest ids from INTERESTS (at most MAX_INTERESTS). */
  interests: string[];
  english: EnglishComfort | null;
  /** When the screen was finished or skipped — it is shown once either way. */
  completedAt: string | null;
};

export const MAX_HELPS = 3;
export const MAX_INTERESTS = 5;

/** One answer card: the adult wording, and the wording a primary-school child reads. */
export type PreferenceOption<T extends string> = { value: T; label: string; hint: string; kidLabel?: string; kidHint?: string; icon: string };

export const GOAL_OPTIONS: PreferenceOption<LearningGoal>[] = [
  { value: "exams", label: "Do well in my exams", hint: "Syllabus, exam-style questions, common mistakes", kidLabel: "Do well in tests", kidHint: "Practise the things tests ask", icon: "Trophy" },
  { value: "homework", label: "Get help with homework", hint: "The method, shown on an example like mine", kidLabel: "Help with homework", kidHint: "Show me how to do it", icon: "NotebookPen" },
  { value: "understand", label: "Really understand my subjects", hint: "The why behind it, not just the steps", kidLabel: "Understand my lessons", kidHint: "Know why things work", icon: "Lightbulb" },
  { value: "curious", label: "Explore what I'm curious about", hint: "Stories, surprises and connections", kidLabel: "Learn cool new things", kidHint: "Find out how the world works", icon: "Telescope" },
];

export const HELP_OPTIONS: PreferenceOption<LearningHelp>[] = [
  { value: "pictures", label: "Pictures and diagrams", hint: "Aria draws it out", kidLabel: "Pictures", kidHint: "Show me drawings", icon: "Shapes" },
  { value: "worked-examples", label: "Step-by-step examples", hint: "A worked example before the rule", kidLabel: "Step by step", kidHint: "One small step at a time", icon: "ListOrdered" },
  { value: "real-life", label: "Real-life examples", hint: "Where you meet it in everyday life", kidLabel: "Real-life examples", kidHint: "Things I see every day", icon: "Globe2" },
  { value: "short-notes", label: "Short written notes", hint: "Key points written down to keep", kidLabel: "Short notes", kidHint: "The main idea written down", icon: "StickyNote" },
  { value: "try-it", label: "Trying it myself", hint: "Questions and things to try along the way", kidLabel: "Trying it myself", kidHint: "Little games and questions", icon: "Hand" },
];

export const CHALLENGE_OPTIONS: PreferenceOption<Challenge>[] = [
  { value: "gentle", label: "Gentle", hint: "Small steps and plenty of help", kidLabel: "Nice and easy", kidHint: "Small steps", icon: "Feather" },
  { value: "steady", label: "Just right", hint: "A steady pace that builds up", kidLabel: "Just right", kidHint: "Not too easy, not too hard", icon: "Gauge" },
  { value: "stretch", label: "Stretch me", hint: "Bigger steps and harder questions", kidLabel: "Make it tricky!", kidHint: "Give me a challenge", icon: "Rocket" },
];

export const ENGLISH_OPTIONS: PreferenceOption<EnglishComfort>[] = [
  { value: "first", label: "It's my first language", hint: "", kidLabel: "Yes, it's easy", icon: "MessageCircle" },
  { value: "comfortable", label: "I'm comfortable with it", hint: "", kidLabel: "Mostly easy", icon: "MessagesSquare" },
  { value: "learning", label: "I'm still learning it", hint: "Aria uses plainer English and explains key words", kidLabel: "Sometimes hard", kidHint: "Aria will use easy words", icon: "Languages" },
];

/** Interests, for examples. `examples` is what the lesson writer is told to draw from. */
export const INTERESTS: Array<{ id: string; label: string; icon: string; examples: string }> = [
  { id: "sports", label: "Sports", icon: "Trophy", examples: "sports — cricket, football, running" },
  { id: "games", label: "Video games", icon: "Gamepad2", examples: "video games" },
  { id: "music", label: "Music", icon: "Music", examples: "music and instruments" },
  { id: "animals", label: "Animals", icon: "PawPrint", examples: "animals and pets" },
  { id: "space", label: "Space", icon: "Orbit", examples: "space, planets and rockets" },
  { id: "cooking", label: "Food & cooking", icon: "ChefHat", examples: "food and cooking" },
  { id: "tech", label: "Tech & gadgets", icon: "Smartphone", examples: "phones, apps and gadgets" },
  { id: "art", label: "Art & design", icon: "Palette", examples: "drawing, art and design" },
  { id: "cars", label: "Cars & machines", icon: "Car", examples: "cars, bikes and machines" },
  { id: "nature", label: "Nature", icon: "Leaf", examples: "plants, weather and the outdoors" },
  { id: "money", label: "Money & business", icon: "Wallet", examples: "money, shops and small businesses" },
  { id: "health", label: "Health & body", icon: "HeartPulse", examples: "health, fitness and the human body" },
  { id: "movies", label: "Films & stories", icon: "Clapperboard", examples: "films, books and stories" },
  { id: "building", label: "Building things", icon: "Hammer", examples: "building, making and fixing things" },
];

export function emptyPreferences(): LearningPreferences {
  return { goal: null, helps: [], challenge: null, interests: [], english: null, completedAt: null };
}

function pick<T extends string>(value: unknown, options: PreferenceOption<T>[]): T | null {
  return options.some((o) => o.value === value) ? (value as T) : null;
}

/**
 * Preferences as a client may send them, made safe. Unknown values are dropped rather than refused:
 * a stale card on an old client should not stop someone finishing onboarding. `completedAt` is set
 * by the server (`now`) whenever the client marks the screen done — skipping counts as done.
 */
export function sanitizePreferences(raw: unknown, existing: LearningPreferences | null | undefined, now = new Date().toISOString()): LearningPreferences {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const has = (k: string) => Object.hasOwn(body, k);
  const base = existing ?? emptyPreferences();
  const list = <T extends string>(value: unknown, allowed: readonly T[], max: number): T[] =>
    Array.isArray(value) ? [...new Set(value.filter((v): v is T => allowed.includes(v as T)))].slice(0, max) : [];
  return {
    goal: has("goal") ? pick(body.goal, GOAL_OPTIONS) : base.goal,
    helps: has("helps") ? list(body.helps, HELP_OPTIONS.map((o) => o.value), MAX_HELPS) : base.helps,
    challenge: has("challenge") ? pick(body.challenge, CHALLENGE_OPTIONS) : base.challenge,
    interests: has("interests") ? list(body.interests, INTERESTS.map((i) => i.id), MAX_INTERESTS) : base.interests,
    english: has("english") ? pick(body.english, ENGLISH_OPTIONS) : base.english,
    completedAt: body.complete === true ? base.completedAt ?? now : base.completedAt,
  };
}

/** The interests' example sources, for the lesson writer. */
export function interestExamples(ids: string[]): string[] {
  return ids.map((id) => INTERESTS.find((i) => i.id === id)?.examples).filter((e): e is string => Boolean(e));
}

/** True when the student said anything at all on the screen (rather than skipping every question). */
export function hasPreferences(p: LearningPreferences | null | undefined): boolean {
  return Boolean(p && (p.goal || p.helps.length || p.challenge || p.interests.length || p.english));
}

/** The answers as short phrases, for settings — "Do well in my exams", "Pictures and diagrams", … */
export function preferenceSummary(p: LearningPreferences | null | undefined): string[] {
  if (!p) return [];
  const label = <T extends string>(options: PreferenceOption<T>[], v: T | null) => options.find((o) => o.value === v)?.label;
  return [
    label(GOAL_OPTIONS, p.goal),
    ...p.helps.map((h) => label(HELP_OPTIONS, h)),
    label(CHALLENGE_OPTIONS, p.challenge),
    ...p.interests.map((id) => INTERESTS.find((i) => i.id === id)?.label),
    p.english === "learning" ? "Plain English" : null,
  ].filter((x): x is string => Boolean(x));
}
