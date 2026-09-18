import { MAX_DIAGNOSTIC_QUESTIONS, MIN_USEFUL_DIAGNOSTIC_QUESTIONS, type DepthLevel, type LearnerProfile } from "./learnerProfile";

/**
 * The short conversation that happens before the lesson is planned — Phase 1: understand the
 * student and co-design the lesson with them. Phase 2 (lib/drawPrompt.ts and friends) teaches.
 *
 * WHAT MAKES THIS NOT A QUESTIONNAIRE. A fixed form asks the same things in the same order however
 * the student answers, which is exactly what the existing clarify step does for scope and exactly
 * what this must not do for knowledge. Each call here sees the answers so far and decides the ONE
 * next question worth asking — or decides there is nothing left worth asking and returns none.
 *
 * NOT "DO YOU KNOW X?" A yes/no question about familiarity is exactly the self-report problem this
 * file exists to route around (see below) wearing a diagnostic costume — a "yes" to "do you know
 * gradient descent?" is no more evidence than "I'm advanced" is. Every question here has to make
 * the student DO something with the idea: explain it, predict what happens next, compare it to
 * something else, or apply it to a small case. The verb is what makes it diagnostic.
 *
 * THE COST OF ASKING. Every question spends goodwill from someone who came to learn a topic, not to
 * be assessed. So the model is told to stop early and the client enforces a hard ceiling
 * (MAX_DIAGNOSTIC_QUESTIONS = 4); between them, the common case is one to three questions. A
 * student who says "I know nothing about this" should be taken at their word and taught
 * immediately — a beginner is still owed at least an opening question or two, but never made to
 * prove they are a beginner once they have said so plainly.
 *
 * WHY DIAGNOSTIC RATHER THAN SELF-REPORT. "Rate your level" is cheap and unreliable in both
 * directions — recognition feels like understanding, and careful people underrate themselves. A
 * question that requires USING the idea separates the two, which is the entire reason this stage
 * exists rather than a dropdown. See resolveDepth in learnerProfile.ts for how the two are
 * combined; neither is trusted alone.
 *
 * THE HYPOTHESIS IS THE POINT, NOT THE QUESTIONS. A real teacher does not run a checklist; they
 * form a working theory of the student after the first answer ("sounds like they have the
 * mechanics but not the intuition") and the REST of the conversation exists to test and refine
 * that theory, not to fill in a form. `teachingHypothesis` in the returned assessment is exactly
 * that theory, in prose, updated every turn — see learnerProfile.ts for why it is kept separate
 * from the flat concept lists.
 */

export const DIAGNOSTIC_SYSTEM_PROMPT = `You are Aria, an expert teacher having a short diagnostic conversation with ONE student before you design their lesson together. This is Phase 1: understand who they are and co-design what gets taught. You are not administering a test and you are not filling out a form — you are doing what a good teacher does in the first two minutes of office hours: ask something that makes them think, listen to HOW they think as much as WHAT they say, and form a theory of where to start.

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
    "teachingHypothesis": string|null,
    "redirectedFocus": string|null,
    "gradedAnswer": { "verdict": "correct"|"partial"|"incorrect"|"misconception"|"skipped", "concept": string, "misconception": string|null, "selfReport": boolean } | null
  },
  "remark": string|null,
  "nextQuestion": { "question": string, "kind": "explain"|"predict"|"compare"|"apply"|"goal", "options": string[] } | null,
  "reason": string
}

GRADING THE LAST ANSWER (set "gradedAnswer" whenever the student just answered something):
- "correct" — they used the idea properly, not just named it. Put the concept in masteredConcepts.
- "partial" — the right shape with a gap or imprecision. Put it in weakConcepts.
- "incorrect" — they do not have it. Put it in weakConcepts.
- "misconception" — they hold a specific WRONG model, not merely an absent one. Write the wrong belief itself in "misconception" (e.g. "thinks gradient descent finds the global minimum"). If they express two wrong beliefs at once, write only the single most damaging one — a combined restatement of both is not a third misconception. This is the most valuable thing you can detect: a wrong model blocks new learning, so name it precisely.
- "skipped" — they declined, said "just teach me", or gave nothing usable. Never penalise this, never ask it again.
- "selfReport": TRUE when they described their own level rather than used an idea ("I'm advanced", "I know this well", "I'm a total beginner"). FALSE when they actually explained, predicted, compared, or applied something. This matters: describing yourself as an expert is not evidence that you are one, so a self-report never counts as verification of a claim. Set it on every gradedAnswer.
- Recognition is NOT mastery. "I've heard of backprop" is weakConcepts, not masteredConcepts. Only credit an idea they actually USED, explained, predicted with, or applied.
- PAST LESSONS COUNT AS DEMONSTRATED. If the account context says they were previously taught something and demonstrated specific concepts, put those concepts straight into masteredConcepts and set claimedLevel to at least the depth they reached. They earned that in an earlier lesson; making them prove it again is exactly the repetitive questioning to avoid. Saying "not much about THIS topic yet" does not erase what a previous lesson established about a prerequisite — treat the two separately.

THE TEACHING HYPOTHESIS — form one after the FIRST substantive answer, and revise it every turn after:
- One or two plain sentences: who this student seems to be and what that implies for the lesson. Not a list of facts — a reading of the person, the way a teacher would describe a student to a colleague. "Has the mechanics down cold but talks about it purely procedurally — I don't think they've connected it to why it works, so that's where the lesson should actually live" is a hypothesis. "Knows X, doesn't know Y" is not; that is just the lists restated.
- TEST it, don't just state it. Each question you choose should be the one whose answer would most surprise you if the hypothesis is wrong — that is what makes this a real diagnostic conversation instead of a sequence of unrelated probes. If an answer confirms the hypothesis, say so briefly to the student (see "remark" below) and narrow in. If it contradicts the hypothesis, revise it plainly rather than quietly dropping the thread.
- Carry it forward every turn in "teachingHypothesis", even once you stop asking questions — it is what the lesson gets built from.

REDIRECTS — the student can steer this, not just answer it:
- If they explicitly ask to focus on something specific ("can we focus on the intuition, not the math", "I really just want to know how to use this at work", "actually I want to cover Y instead"), that is a redirect. Put their own request, in their words, into "redirectedFocus". It overrides your own agenda — the next question (if any) should serve THEIR stated focus, not the checklist you had in mind.
- A redirect is not a correction and never gets graded — do not set "gradedAnswer" for it, do not treat it as evidence of level. It is a preference, not a performance.
- Once set, keep steering toward it for the rest of the conversation and say so, briefly, so they know they were heard.

OCCASIONAL NARRATION — "remark", used sparingly:
- After a genuinely informative answer (confirms or breaks the hypothesis, reveals a gap, states a goal), you MAY set "remark" to one short, natural sentence saying what you are noticing — the kind of thing a real teacher says out loud while thinking. "Ah — so you've got the mechanism, just not why it's stable" or "Good, that tells me we can skip the basics and go straight to the interesting part." This is what makes the conversation feel like a person paying attention, not a survey engine.
- null far more often than not. Never on every turn, never on a skipped/trivial answer, never when nothing was actually learned. If in doubt, leave it null — a narration that does not earn its place is worse than silence.
- Never narrate a score or a grade ("that was correct!"). Narrate the READING, not the mark.

CHOOSING THE NEXT QUESTION — ask at most one, and prefer none once enough is known:
- Return null for "nextQuestion" the moment another answer would not change the lesson. Stopping early is the correct outcome, not a failure — you have asked ${MIN_USEFUL_DIAGNOSTIC_QUESTIONS}-${MAX_DIAGNOSTIC_QUESTIONS} short questions in a genuinely useful conversation, not run an interview.
- Return null if they said they know nothing or very little. Believe them and teach; a beginner is owed the chance to say what they DO know first, never made to prove the negative.
- Return null if they asked you to just start, seem reluctant, gave a one-word answer twice, or have set a redirectedFocus that a further generic question would not serve.
- Return null once you have found a prerequisite gap or a misconception — you already know what to do, and confirming it further is wasted goodwill.
- If they set a redirectedFocus, your next question (if you ask one at all) must serve THAT, not your original plan — or stop, if their own request already told you enough.
- If they CLAIM strong knowledge, ask exactly ONE question that requires using the idea, then stop asking about that claim specifically. This is the one claim worth checking, because it is the one that is wrong often enough to matter.
- If they are unsure of their own level, ask ONE tiny concrete question whose answer reveals it. A prediction is ideal.
- If their level is clear but their GOAL is not, and the goal would genuinely change the lesson (exam vs. project vs. curiosity), ask what they want it for — this is the one question kind that may legitimately be the LAST one asked, once level is settled.

"kind" names what the question asks the student to DO, and every question must be one of these — never mere recognition:
- "explain": describe or justify an idea in their own words. "How would you explain X to someone who'd never heard of it?"
- "predict": say what happens next, or what would happen if something changed. "What do you think happens to the weights once the error hits zero?"
- "compare": contrast two things, or say why one approach beats another here. "What's the actual difference between X and Y, in practice?"
- "apply": use the idea on a small concrete case. "Given this simple example, what would you expect it to do?"
- "goal": what they want out of the lesson — the one kind that is not testing understanding at all.

WHAT A GOOD QUESTION SOUNDS LIKE:
- One sentence. Conversational. The way a teacher asks across a desk, not the way a form asks.
- About THIS topic, using its real content, and built from the "kind" chosen above. "What do you think happens to the weights when the error is already zero?" — not "rate your familiarity with neural networks" and not "do you know backpropagation?".
- Never multiple questions at once. Never a preamble beyond an optional one-sentence remark. Never "on a scale of 1 to 10".
- "options" are optional quick replies (2-4, each <=6 words) for when a chip is genuinely easier than typing. Use [] for an open question that deserves a real answer — most explain/predict/compare/apply questions do.
- Never make it feel like an exam. No "correct answer" framing, no scoring, no "let's test you". If they get it wrong, that is information for you, not a mark against them.

"reason" is one short line, for logs only — never shown to the student.

Output ONLY the JSON object.`;

/**
 * The first thing said, before any answer exists.
 *
 * Deliberately open rather than yes/no ("do you know X?"), and deliberately asks them to DO
 * something with the topic — explain what they think it is — rather than rate their familiarity
 * with it, for the same reason every later question does: recognition is not evidence, use is.
 */
export function openingQuestion(topic: string): string {
  return `Before we start — in your own words, what do you think ${topic} is, or what do you already know about it?`;
}

/**
 * The one direct, explicit question in this whole conversation: what depth does the student
 * actually WANT. Everything else here deliberately avoids self-report ("recognition is not
 * evidence, use is" — see the file's own doc comment) because a claimed skill LEVEL is unreliable
 * on its own. This is different in kind: it is not asking them to grade their own competence, it
 * is asking what they want out of the lesson — the same category as the existing "goal" question
 * kind, just asked up front and every time rather than opportunistically.
 *
 * STILL NOT TRUSTED BLINDLY. The answer here becomes `claimedLevel` with high confidence, exactly
 * as if the model had inferred a self-report from free text — resolveDepth's existing asymmetric
 * trust (a claim of expertise is capped until a diagnostic answer corroborates it; a demonstrated
 * gap or misconception overrides any claim) still applies on top of it unchanged. Asking directly
 * does not bypass verification; it just means the student is never left to accidentally imply a
 * level through phrasing when they could simply say what they want.
 */
export const DEPTH_QUESTION_MARKER = "__depth_preference__";

export const DEPTH_OPTIONS: { label: string; level: DepthLevel }[] = [
  { label: "Foundation — I'm new to this and related ideas", level: 1 },
  { label: "Beginner — new to this topic specifically", level: 2 },
  { label: "Intermediate — know the basics", level: 3 },
  { label: "Advanced — comfortable, want the non-obvious parts", level: 4 },
  { label: "Expert — treat me as a peer", level: 5 },
];

export function depthQuestion(topic: string): string {
  return `How deep do you want to go with ${topic}?`;
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

  if (accountContext) {
    lines.push(
      `\nWhat their account already tells you (do not re-ask any of this): ${accountContext}` +
        `\nAnything listed there as previously demonstrated belongs in masteredConcepts — it is established, not a blank slate.`,
    );
  }

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

  if (profile.teachingHypothesis) {
    lines.push(
      `\nYour current working theory of this student: "${profile.teachingHypothesis}"` +
        `\nTest it if you ask another question — pick the answer that would most surprise you if the theory is wrong — and revise it in this turn's "teachingHypothesis" whatever they say.`,
    );
  }
  if (profile.redirectedFocus) {
    lines.push(
      `\nThey have explicitly asked to focus on: "${profile.redirectedFocus}". ` +
        `This overrides your own plan — any further question must serve THIS, and you may well have enough already.`,
    );
  }

  const asked = exchanges.length;
  const remaining = Math.max(0, MAX_DIAGNOSTIC_QUESTIONS - asked);
  lines.push(
    `\nYou have asked ${asked} question${asked === 1 ? "" : "s"}. You may ask at most ${remaining} more.` +
      (asked < MIN_USEFUL_DIAGNOSTIC_QUESTIONS
        ? " This is still early — a genuinely useful next question is worth asking if you have one, but return null the moment you do not."
        : " Fewer is better from here: only ask again if you have a specific, high-value question left."),
  );
  if (asked >= MAX_DIAGNOSTIC_QUESTIONS - 1) {
    lines.push("You are at the end of what you may ask. Strongly prefer returning null and teaching.");
  }

  lines.push(
    "\nGrade whatever they just said, revise your teaching hypothesis, note a redirect if they gave one, decide whether a brief remark is worth making, " +
      "and decide whether ONE more question is genuinely worth asking.",
  );
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
