/**
 * ARIA'S TEACHERS (owner 2026-11-28): three teachers, each one voice with its own personality, chosen in the last
 * planning question ("Who would you like to learn with?") and in Settings. The personality changes the WORDS (the
 * script writer and the reading-level rewrite are given the teacher's style) and HOW they are said (a default
 * delivery word for the cloned voice). Boards, facts, steps and everything to be taught stay the same.
 *   - Aria: calm and patient — the voice and style every lesson had before; no extra instruction (unchanged).
 *   - Zara: funny and energetic — Minahil's voice (GEMINI_TTS_VOICE_MINAHIL), with her recorded consent.
 *   - Kai: strict and focused — Hassan's voice (GEMINI_TTS_VOICE_HASSAN), with his recorded consent.
 * The key is also the voice key (lib/voices.ts). Pure: the page, the routes and the tests share it.
 */
export type TeacherKey = "aria" | "zara" | "kai";

export type Teacher = {
  key: TeacherKey;
  name: string;
  /** Two or three words, shown on the cards. */
  trait: string;
  /** For the planning card and Settings. */
  description: string;
  /** Said by the Settings sample button, in the teacher's own style. */
  sample: string;
  /** For the script writer: how this teacher talks. Empty for Aria (her lessons are unchanged). */
  style: string;
  /** The cloned voice's delivery for a plain sentence (lib/voiceDelivery.ts gives questions and warnings their own). */
  delivery?: string;
};

export const TEACHERS: Teacher[] = [
  {
    key: "aria",
    name: "Aria",
    trait: "Calm and patient",
    description: "Gentle and patient, takes it step by step",
    sample: "Hi, I'm Aria. We'll take this one step at a time, and there's no rush at all.",
    style: "",
  },
  {
    key: "zara",
    name: "Zara",
    trait: "Funny and energetic",
    description: "Full of energy, with jokes and playful examples",
    sample: "Hey, I'm Zara! Get ready, because today's lesson is way more fun than it sounds. Let's go!",
    style:
      "THE TEACHER IS ZARA — FUNNY AND ENERGETIC. Talk with bright, upbeat energy, like a favourite teacher who makes the class laugh. On most boards add ONE short, kind, age-appropriate joke, pun or playful comparison that is about the idea itself (never about the student, never sarcastic, never a pop-culture reference a student might not know). Use playful everyday examples. The joke is extra: every fact, term, step, number and check stays exactly as it must be taught, and a joke never replaces an explanation. Keep sentences short.",
    delivery: "cheerful",
  },
  {
    key: "kai",
    name: "Kai",
    trait: "Strict and focused",
    description: "Direct and exam-focused, like a tough coach",
    sample: "I'm Kai. We focus, we practise, and we get it right. Let's begin.",
    style:
      "THE TEACHER IS KAI — STRICT AND FOCUSED, LIKE AN EXAM COACH. Short, direct sentences. No jokes, no chit-chat, no gushing praise: praise is brief and earned (\"Correct.\", \"Good. Next.\"). Say plainly what is wrong and exactly what the examiner wants to see, with the precise term. Ask the student to try before you give an answer. Firm and respectful, never rude. Every fact, term, step, number and check stays exactly as it must be taught.",
    delivery: "calm and firm",
  },
];

export function teacherOf(key: string | null | undefined): Teacher {
  return TEACHERS.find((t) => t.key === key) ?? TEACHERS[0];
}

/** The script writer's instruction for this teacher, or "" (Aria, or no choice). */
export function teacherStyleLine(key: string | null | undefined): string {
  return teacherOf(key).style;
}

/** The planning card's last question (lib/teachingQuestions.ts shape), the remembered teacher first. */
export const TEACHER_QUESTION_ID = "teacher";
export function teacherQuestion(available: string[], remembered?: string | null) {
  const list = TEACHERS.filter((t) => available.includes(t.key));
  const ordered = remembered ? [...list.filter((t) => t.key === remembered), ...list.filter((t) => t.key !== remembered)] : list;
  return {
    id: TEACHER_QUESTION_ID,
    kind: "other" as const,
    header: "Teacher",
    question: "Who would you like to learn with?",
    options: ordered.map((t) => ({ label: t.name, description: `${t.trait}: ${t.description.charAt(0).toLowerCase()}${t.description.slice(1)}${t.key === remembered ? " (your teacher last time)" : ""}`, value: t.key })),
  };
}
