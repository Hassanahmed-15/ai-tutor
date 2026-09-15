import { MAX_DIAGNOSTIC_QUESTIONS, type LearnerProfile } from "./learnerProfile";

/**
 * The short conversation that happens before the lesson is planned.
 *
 * WHAT MAKES THIS NOT A QUESTIONNAIRE. A fixed form asks the same things in the same order however
 * the student answers, which is exactly what the existing clarify step does for scope and exactly
 * what this must not do for knowledge. Each call here sees the answers so far and decides the ONE
 * next question worth asking — or decides there is nothing left worth asking and returns none.
 *
 * THE COST OF ASKING. Every question spends goodwill from someone who came to learn a topic, not to
 * be assessed. So the model is told to stop early and the client enforces a hard ceiling
 * (MAX_DIAGNOSTIC_QUESTIONS); between them, the common case is one or two questions. A student who
 * says "I know nothing about this" should be taken at their word and taught immediately.
 *
 * WHY DIAGNOSTIC RATHER THAN SELF-REPORT. "Rate your level" is cheap and unreliable in both
 * directions — recognition feels like understanding, and careful people underrate themselves. A
 * question that requires USING the idea separates the two, which is the entire reason this stage
 * exists rather than a dropdown. See resolveDepth in learnerProfile.ts for how the two are
 * combined; neither is trusted alone.
 */

export const DIAGNOSTIC_SYSTEM_PROMPT = `You are Aria, an expert teacher having a brief chat with ONE student just before you teach them. Your job is to work out what they already know so the lesson lands at the right level — and then to stop asking and go and teach.

Return JSON only:
{
  "assessment": {
    "claimedLevel": 1|2|3|4|5|null,
    "confidence": "low"|"medium"|"high"|"unknown",
    "objective": "exam"|"fundamentals"|"project"|"interview"|"curiosity"|"unknown",
    "masteredConcepts": string[],
    "weakConcepts": string[],
    "misconceptions": string[],
    "prerequisiteGaps": string[],
    "preferredStyle": string|null,
    "background": string|null,
    "gradedAnswer": { "verdict": "correct"|"partial"|"incorrect"|"misconception"|"skipped", "concept": string, "misconception": string|null, "selfReport": boolean } | null
  },
  "nextQuestion": { "question": string, "kind": "open"|"diagnostic"|"goal", "options": string[] } | null,
  "reason": string
}

GRADING THE LAST ANSWER (set "gradedAnswer" whenever the student just answered something):
- "correct" — they used the idea properly, not just named it. Put the concept in masteredConcepts.
- "partial" — the right shape with a gap or imprecision. Put it in weakConcepts.
- "incorrect" — they do not have it. Put it in weakConcepts.
- "misconception" — they hold a specific WRONG model, not merely an absent one. Write the wrong belief itself in "misconception" (e.g. "thinks gradient descent finds the global minimum"). If they express two wrong beliefs at once, write only the single most damaging one — a combined restatement of both is not a third misconception. This is the most valuable thing you can detect: a wrong model blocks new learning, so name it precisely.
- "skipped" — they declined, said "just teach me", or gave nothing usable. Never penalise this, never ask it again.
- "selfReport": TRUE when they described their own level rather than used an idea ("I'm advanced", "I know this well", "I'm a total beginner"). FALSE when they actually explained, predicted, or applied something. This matters: describing yourself as an expert is not evidence that you are one, so a self-report never counts as verification of a claim. Set it on every gradedAnswer.
- Recognition is NOT mastery. "I've heard of backprop" is weakConcepts, not masteredConcepts. Only credit an idea they actually USED or explained.

CHOOSING THE NEXT QUESTION — ask at most one, and prefer none:
- Return null for "nextQuestion" the moment another answer would not change the lesson. Stopping early is the correct outcome, not a failure.
- Return null if they said they know nothing or very little. Believe them and teach; do not quiz someone who already told you they are a beginner.
- Return null if they asked you to just start, seem reluctant, or gave a one-word answer twice.
- Return null once you have found a prerequisite gap or a misconception — you already know what to do.
- If they CLAIM strong knowledge, ask exactly ONE diagnostic that requires using the idea, then stop. This is the one claim worth checking, because it is the one that is wrong often enough to matter. Never ask a second verification question.
- If they are unsure of their own level, ask ONE tiny concrete question whose answer reveals it. A prediction or a "what would happen if…" is ideal.
- If their level is clear but their GOAL is not, and the goal would genuinely change the lesson, ask what they want it for.

WHAT A GOOD QUESTION SOUNDS LIKE:
- One sentence. Conversational. The way a teacher asks across a desk, not the way a form asks.
- About THIS topic, using its real content. "What do you think happens to the weights when the error is already zero?" — not "rate your familiarity with neural networks".
- Never multiple questions at once. Never a preamble. Never "on a scale of 1 to 10".
- "options" are optional quick replies (2-4, each <=6 words) for when a chip is genuinely easier than typing. Use [] for an open question that deserves a real answer.
- Never make it feel like an exam. No "correct answer" framing, no scoring, no "let's test you". If they get it wrong, that is information for you, not a mark against them.

"reason" is one short line, for logs only — never shown to the student.

Output ONLY the JSON object.`;

/** The first thing said, before any answer exists. Deliberately open, and deliberately singular. */
export function openingQuestion(topic: string): string {
  return `Before we start — what do you already know about ${topic}?`;
}

/**
 * The user message for one turn of the diagnostic conversation.
 *
 * Sends the profile so far as prose rather than as JSON. The model reads "they have already
 * demonstrated X" more reliably than a nested object, and the whole point of this call is a
 * judgement about a person rather than a data transformation.
 */
export function buildDiagnosticUserMessage(input: {
  topic: string;
  profile: LearnerProfile;
  exchanges: { question: string; answer: string }[];
  /** Anything already known from the account — academic level, stated goals, accessibility pace. */
  accountContext?: string;
}): string {
  const { topic, profile, exchanges, accountContext } = input;
  const lines: string[] = [`Topic the student asked to learn: "${topic}"`];

  if (accountContext) lines.push(`\nWhat their account already tells you (do not re-ask any of this): ${accountContext}`);

  if (exchanges.length) {
    lines.push("\nThe conversation so far:");
    for (const ex of exchanges) lines.push(`You asked: ${ex.question}\nThey said: ${ex.answer}`);
  } else {
    lines.push("\nNothing has been asked yet. This is the very start of the conversation.");
  }

  const known: string[] = [];
  if (profile.masteredConcepts.length) known.push(`already demonstrated: ${profile.masteredConcepts.join(", ")}`);
  if (profile.weakConcepts.length) known.push(`shaky on: ${profile.weakConcepts.join(", ")}`);
  if (profile.misconceptions.length) known.push(`holds these wrong beliefs: ${profile.misconceptions.join("; ")}`);
  if (profile.prerequisiteGaps.length) known.push(`missing prerequisites: ${profile.prerequisiteGaps.join(", ")}`);
  if (known.length) lines.push(`\nAlready established about them — never ask about these again: ${known.join(" | ")}`);

  const asked = exchanges.length;
  lines.push(
    `\nYou have asked ${asked} question${asked === 1 ? "" : "s"}. You may ask at most ${Math.max(
      0,
      MAX_DIAGNOSTIC_QUESTIONS - asked,
    )} more, and fewer is better.`,
  );
  if (asked >= MAX_DIAGNOSTIC_QUESTIONS - 1) {
    lines.push("You are at the end of what you may ask. Strongly prefer returning null and teaching.");
  }

  lines.push("\nGrade whatever they just said, update what you know about them, and decide whether ONE more question is genuinely worth asking.");
  return lines.join("\n");
}

/**
 * Phrases that mean "stop asking and teach me".
 *
 * Checked in the client before the model is consulted at all. A student who has just asked to get
 * on with it should not wait on a network round-trip to find out whether the model agreed — and a
 * model told to be curious will occasionally ask one more anyway. This is the student's override,
 * so it is enforced in code rather than requested in a prompt.
 */
const IMPATIENCE = /\b(?:just (?:start|teach|go|continue|begin)|skip (?:this|the questions?|ahead)|stop asking|no more questions?|get on with it|teach me already|i don'?t (?:know|care)|whatever|dunno)\b/i;

export function wantsToStart(answer: string): boolean {
  return IMPATIENCE.test(answer.trim());
}

/**
 * Whether an answer carries enough signal to grade at all.
 *
 * "yes", "no" and "ok" are answers to a question but not evidence about a person, and treating them
 * as evidence is how a profile fills up with confident nonsense. They still end the turn — the
 * student answered — they simply do not update mastery.
 */
export function isSubstantive(answer: string): boolean {
  const trimmed = answer.trim();
  if (trimmed.length < 3) return false;
  return !/^(?:y|n|yes|no|ok|okay|sure|maybe|idk|yeah|nope)$/i.test(trimmed);
}
