/**
 * The learner model, and the depth decision that comes out of it.
 *
 * WHY THIS EXISTS. Standard Mode asked about SCOPE before a lesson ("focus on A or B?", "mechanism
 * or applications?") and never once about the student. The clarify call resolves what the topic
 * means; nothing resolved who is being taught. So every lecture was pitched at the same imagined
 * middle beginner: an undergraduate who already implements backprop sat through a slide defining
 * what a neuron is, and someone who had never met a derivative hit the chain rule with no warning.
 *
 * SELF-REPORT IS EVIDENCE, NOT A VERDICT. The obvious design — ask "are you a beginner,
 * intermediate or advanced?" and branch — fails in both directions, and the literature on learner
 * modelling is consistent about why: confidence and competence are only loosely correlated.
 * Someone who has read about a topic recognises every term and rates themselves high; someone
 * meticulous rates themselves low because they can name what they do not know. So `claimedLevel` is
 * one input among several here, and a claim of expertise is worth acting on only once a diagnostic
 * answer has agreed with it (see `resolveDepth`).
 *
 * MACRO- VS MICRO-ADAPTATION. This file is macro-adaptation: the decision, made once before the
 * lecture is written, about how deep the whole thing should go. Micro-adaptation — reacting to a
 * checkpoint answer mid-lecture — already exists in this codebase as `safetyNet` (planPrompt.ts),
 * and this deliberately feeds that rather than replacing it: the profile decides where the lecture
 * starts, the safety nets decide what happens when a particular learner stumbles.
 *
 * DELIBERATELY NOT A KNOWLEDGE-TRACING ENGINE. A full ITS would maintain per-skill mastery
 * probabilities updated by a Bayesian model. That is the right architecture when you own a fixed
 * skill graph and thousands of interactions per learner; here every lesson is a new generated
 * topic and the whole interaction is a two-minute conversation, so the posterior would be almost
 * entirely prior. A structured profile plus adaptive prompting gets the behaviour that matters
 * without inventing a skill graph that nothing can populate.
 */

/**
 * How deep the lecture goes. Five levels, because four collapses the distinction that matters most
 * in practice — between someone who needs the prerequisite taught first (Foundation) and someone
 * who has it but has never used this topic (Beginner).
 */
export type DepthLevel = 1 | 2 | 3 | 4 | 5;

export const DEPTH_NAMES: Record<DepthLevel, string> = {
  1: "Foundation",
  2: "Beginner",
  3: "Intermediate",
  4: "Advanced",
  5: "Expert",
};

/** What the student says they want out of this. Changes emphasis far more than it changes depth. */
export type LearningObjective =
  | "exam"
  | "fundamentals"
  | "project"
  | "interview"
  | "curiosity"
  | "unknown";

/** How sure the student sounded. Tracked separately from level precisely so the two can disagree. */
export type Confidence = "low" | "medium" | "high" | "unknown";

/**
 * One diagnostic exchange: a question that tested understanding, and how the answer scored.
 *
 * `verdict` is the whole point of the record. "correct" is evidence the claimed level is real;
 * "misconception" is the single most valuable signal available here, because a wrong model actively
 * blocks new learning in a way that simply not knowing does not.
 */
export type DiagnosticResult = {
  question: string;
  answer: string;
  verdict: "correct" | "partial" | "incorrect" | "misconception" | "skipped";
  /** Present when verdict is "misconception" — the specific wrong belief, in one line. */
  misconception?: string;
  /** The concept this question was probing, so it can land in mastered/weak. */
  concept?: string;
  /**
   * True when the "answer" was the student describing their own level rather than using an idea.
   *
   * Kept out of verification counts: someone claiming expertise has not thereby demonstrated it,
   * and treating the claim as its own evidence is what let an unverified boast skip the probe.
   */
  selfReport?: boolean;
};

export type LearnerProfile = {
  topic: string;
  /** What the student said about themselves. Never used alone — see resolveDepth. */
  claimedLevel: DepthLevel | null;
  confidence: Confidence;
  /** Concepts the student demonstrated (not merely claimed) they hold. */
  masteredConcepts: string[];
  /** Concepts they recognise but could not use, or got wrong. */
  weakConcepts: string[];
  /** Specific wrong beliefs to correct explicitly, not merely to route around. */
  misconceptions: string[];
  /** Prior ideas the lecture must establish before the topic proper. */
  prerequisiteGaps: string[];
  objective: LearningObjective;
  /** Diagnostic exchanges so far, oldest first. */
  diagnostics: DiagnosticResult[];
  /** Free-text style preference, e.g. "prefers worked examples over formalism". */
  preferredStyle: string | null;
  /** The student's own words about their background, when they gave any. */
  background: string | null;
  /**
   * The model's running, revisable theory of who this student is — one or two sentences, in
   * plain language, updated after every exchange.
   *
   * WHY THIS EXISTS SEPARATELY FROM THE LISTS ABOVE. masteredConcepts/weakConcepts/etc. are
   * DATA — individually true, but a list is not a picture of a person. "Knows gradient descent,
   * shaky on chain rule, wants project help" is three facts; "has the calculus but hasn't
   * connected it to how networks actually learn yet, and just wants to ship something" is a
   * THEORY that explains the facts and predicts what will land next. That prose is what a real
   * teacher forms in their head during office hours and revises as the conversation goes — this
   * field is that, made explicit so it can be tested (does the next answer fit it?) and handed to
   * the lecture writer as a synthesis rather than a table it has to re-derive.
   *
   * Null until the first exchange gives the model something to theorise about.
   */
  teachingHypothesis: string | null;
  /**
   * What the student explicitly asked to focus on instead of, or within, the topic — in their own
   * words. Set only when they actually redirected ("can we focus on X instead", "I really just
   * want to understand Y"), never inferred from an ordinary answer.
   *
   * A student's own stated interest overrides the diagnostic's own agenda: the conversation is
   * co-designing the lesson WITH them, not administering a fixed assessment they can only answer
   * within. See wantsToRedirect in diagnosticPrompt.ts for how this is detected.
   */
  redirectedFocus: string | null;
  updatedAt: string;
};

export function emptyProfile(topic: string): LearnerProfile {
  return {
    topic,
    claimedLevel: null,
    confidence: "unknown",
    masteredConcepts: [],
    weakConcepts: [],
    misconceptions: [],
    prerequisiteGaps: [],
    objective: "unknown",
    diagnostics: [],
    preferredStyle: null,
    background: null,
    teachingHypothesis: null,
    redirectedFocus: null,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * The concept-level picture of this student, presented as one structure rather than four separate
 * lists — this is the "Concept Map" the diagnostic conversation builds.
 *
 * DELIBERATELY A VIEW, NOT A SEPARATE DATA STRUCTURE. A graph of concept nodes and prerequisite
 * edges is the textbook shape for a concept map, and it is the wrong shape here: populating one
 * honestly needs either a pre-built domain ontology (this app teaches arbitrary topics — there is
 * no fixed graph to populate) or many more interactions than a 2-4 question conversation produces
 * to infer relationships with any confidence. What the conversation CAN honestly produce — and
 * does, via masteredConcepts/weakConcepts/misconceptions/prerequisiteGaps — is exactly what a
 * concept map is FOR: which concepts are solid, which are shaky, which are simply missing, and
 * which are actively wrong. This function names that existing data as the concept map it already
 * is, rather than asking the model to also produce a graph it cannot populate reliably.
 */
export type ConceptMapEntry = { concept: string; status: "mastered" | "weak" | "missing" | "misconception" };

export function conceptMap(profile: LearnerProfile): ConceptMapEntry[] {
  return [
    ...profile.masteredConcepts.map((concept): ConceptMapEntry => ({ concept, status: "mastered" })),
    ...profile.weakConcepts.map((concept): ConceptMapEntry => ({ concept, status: "weak" })),
    ...profile.prerequisiteGaps.map((concept): ConceptMapEntry => ({ concept, status: "missing" })),
    ...profile.misconceptions.map((concept): ConceptMapEntry => ({ concept, status: "misconception" })),
  ];
}

/**
 * The decision this whole file exists to make.
 *
 * `claimedLevel` is the starting point, and every other signal can move it. The asymmetry is
 * deliberate and is the part worth reading carefully:
 *
 * A CLAIM OF EXPERTISE IS CAPPED UNTIL IT IS DEMONSTRATED. Someone selecting "advanced" with no
 * correct diagnostic answer is held at Intermediate. Being over-pitched is the more damaging error:
 * a learner pitched too low is bored and skips ahead, while one pitched too high is lost and has no
 * way back, because the explanation they needed was skipped as "obvious". So the benefit of the
 * doubt runs downward, not upward.
 *
 * A DEMONSTRATED GAP OVERRIDES ANY CLAIM. A prerequisite gap or a live misconception drops the
 * floor regardless of what was claimed — an advanced student who has a wrong model of gradient
 * descent needs that fixed before backprop, and their self-rating does not change that.
 */
export function resolveDepth(profile: LearnerProfile, topicComplexity: DepthLevel = 3): DepthLevel {
  const claimed = profile.claimedLevel ?? 2;
  let depth: number = claimed;

  const correct = profile.diagnostics.filter((d) => d.verdict === "correct").length;
  const wrong = profile.diagnostics.filter(
    (d) => d.verdict === "incorrect" || d.verdict === "misconception",
  ).length;

  /*
   * Verification gate. A high claim is only honoured once something corroborates it; otherwise the
   * lecture would skip the fundamentals on the strength of a dropdown selection.
   */
  if (claimed >= 4 && correct === 0) depth = Math.min(depth, 3);
  // Two clean diagnostic answers are worth a level on their own, whatever was claimed — this is
  // what lets a modest student who actually knows the material stop being taught the basics.
  if (correct >= 2) depth += 1;
  // Demonstrated failure pulls down harder than success pushes up, for the asymmetry above.
  if (wrong >= 1) depth -= 1;
  if (wrong >= 2) depth -= 1;

  /*
   * CONCEPTS DEMONSTRATED IN AN EARLIER LESSON RAISE THE FLOOR.
   *
   * Without this, cross-session memory was incoherent: a learner returning after a lesson on
   * gradient descent had those concepts correctly carried into masteredConcepts, and was then
   * taught at Foundation anyway — the lecture was simultaneously told "skip gradient descent" and
   * "define every term on first use". The cause is that `claimedLevel` reflects what they said
   * about TODAY's topic ("not much about backprop yet"), which is true and not evidence of being a
   * beginner overall.
   *
   * Fixed here rather than in the prompt. Relying on the model to remember to raise `claimedLevel`
   * is exactly the kind of instruction that is followed most of the time, and a depth decision
   * should not be probabilistic when the evidence is sitting in the profile. Held to Beginner
   * rather than higher because prior mastery of the PREREQUISITES says nothing about this topic.
   */
  if (profile.masteredConcepts.length >= 2 && profile.prerequisiteGaps.length === 0) {
    depth = Math.max(depth, 2);
  }

  /*
   * A missing prerequisite is a hard floor, not a nudge. There is no version of a good lecture that
   * builds on an idea the student does not have, so this caps depth at Beginner and the outline is
   * separately told to teach the prerequisite first.
   */
  if (profile.prerequisiteGaps.length > 0) depth = Math.min(depth, 2);
  // A live misconception means something must be unlearned before anything is added on top.
  if (profile.misconceptions.length > 0) depth = Math.min(depth, 3);

  /*
   * Objective shifts depth only where it genuinely implies it. "Fundamentals" is a request to be
   * taught properly from the ground up even by someone capable of more; an interview or exam needs
   * fluency at the level being examined rather than research depth.
   */
  if (profile.objective === "fundamentals") depth = Math.min(depth, 3);
  if (profile.objective === "curiosity") depth = Math.min(depth, 3);

  /*
   * A topic cannot be taught deeper than it goes. "What is a prime number" has no expert treatment,
   * and pretending otherwise produces padding — the failure lessonScope.ts exists to prevent.
   */
  depth = Math.min(depth, topicComplexity + 1);

  return Math.max(1, Math.min(5, Math.round(depth))) as DepthLevel;
}

/** Objective-specific emphasis. Depth says how deep; this says what to spend the depth on. */
function objectiveLine(objective: LearningObjective): string {
  switch (objective) {
    case "exam":
      return "GOAL — EXAM. Prioritise the things that get marked: precise definitions, the standard worked procedures, the distinctions examiners test, and the mistakes that lose marks. Include practice items with the shape of real questions. Historical background and tangents are a waste of their time right now.";
    case "interview":
      return "GOAL — INTERVIEW. Prioritise being able to explain the idea out loud and reason about trade-offs. Favour the 'why' and the comparisons over derivations, and include the follow-up questions an interviewer would actually ask.";
    case "project":
      return "GOAL — PRACTICAL/PROJECT. Prioritise what they will type and the decisions they will face. Concrete, runnable, specific. Include the failure modes and gotchas that bite in practice; skip theory that does not change what they build.";
    case "fundamentals":
      return "GOAL — FUNDAMENTALS. They want to genuinely understand it, not pass something. Build the intuition before the formalism, show where each idea comes from, and do not skip a step because it is 'standard'.";
    case "curiosity":
      return "GOAL — CURIOSITY. They are here because it is interesting. Lead with the striking idea, keep the machinery light, and favour vivid examples over completeness.";
    default:
      return "GOAL — UNSTATED. Teach for genuine understanding and keep it applicable.";
  }
}

/** What each depth level actually changes about the lecture. */
function depthLine(depth: DepthLevel): string {
  switch (depth) {
    case 1:
      return "DEPTH 1 — FOUNDATION. They are missing prerequisites. Teach the prior idea FIRST as its own part of the lesson, in plain language, before the topic proper. Define every term on first use. One idea per board. Concrete before abstract, always. No unexplained notation, no assumed background, no jargon used before it is introduced.";
    case 2:
      return "DEPTH 2 — BEGINNER. New to this topic but has the prerequisites. Lead with intuition and a concrete example, then name the formal idea. Define terminology as it appears. Keep mathematics light and always interpret it in words. Analogies are welcome and should be explicitly marked as analogies.";
    case 3:
      return "DEPTH 3 — INTERMEDIATE. Knows the basics — do not re-teach them. Open at the level of the actual mechanism. Use correct terminology without stopping to define the standard terms. Show the real derivation or procedure rather than a simplified cartoon. Spend the time on why it works and where it breaks.";
    case 4:
      return "DEPTH 4 — ADVANCED. Comfortable and fluent. SKIP the basics entirely — do not define standard terms, do not re-explain the introductory framing. Go to the non-obvious: the derivation's subtle steps, edge cases, failure modes, trade-offs against alternatives, and the assumptions that are usually left implicit. Use full notation.";
    case 5:
      return "DEPTH 5 — EXPERT. Treat them as a peer. Assume the standard treatment is known and go to what is genuinely hard or contested: the sharp edges, the limitations of the usual account, connections to adjacent theory, and where the current understanding runs out. No recap of the textbook version.";
  }
}

/**
 * The instruction handed to the planner and the lecture writer.
 *
 * Written as concrete teaching directives rather than as a data dump of the profile. A model given
 * `{"claimedLevel": 4, "masteredConcepts": [...]}` has to infer what to do about it and frequently
 * infers nothing; a model told "skip the basics, they already have X" acts on it.
 *
 * `omitEmpty` keeps this honest: a profile with nothing in it produces a short instruction rather
 * than a page of "none recorded" lines, which would otherwise teach the model that these fields are
 * usually empty and can be ignored.
 */
export function learnerInstruction(profile: LearnerProfile, depth: DepthLevel): string {
  const parts: string[] = [
    `\n\nSTUDENT PROFILE — this lesson is for ONE person, and this is what is known about them. Teach THEM, not a generic audience.`,
    depthLine(depth),
    objectiveLine(profile.objective),
  ];

  if (profile.masteredConcepts.length) {
    parts.push(
      `ALREADY KNOWS (demonstrated, not merely claimed): ${profile.masteredConcepts.join(", ")}. ` +
        `Do NOT re-teach these. Refer to them as shared ground you can build on — "you already know X, so Y is just…". ` +
        `Re-explaining something they have just demonstrated is the fastest way to lose them.`,
    );
  }
  if (profile.weakConcepts.length) {
    parts.push(
      `SHAKY ON: ${profile.weakConcepts.join(", ")}. They recognise these but cannot use them. ` +
        `Re-establish each one briefly and concretely at the point it is first needed — not as a separate preamble.`,
    );
  }
  if (profile.prerequisiteGaps.length) {
    parts.push(
      `MISSING PREREQUISITES: ${profile.prerequisiteGaps.join(", ")}. ` +
        `Teach these FIRST, as genuine parts of the lesson with their own explanation and example. ` +
        `The main topic cannot be taught on top of a gap — do not simply mention them in passing.`,
    );
  }
  if (profile.misconceptions.length) {
    parts.push(
      `MISCONCEPTIONS TO CORRECT — highest priority in this lesson: ${profile.misconceptions.join("; ")}. ` +
        `Address each one EXPLICITLY: state the belief, show concretely why it fails, then give the correct model. ` +
        `Do not route around it politely — an uncorrected wrong model blocks everything built on top of it.`,
    );
  }
  if (profile.preferredStyle) {
    parts.push(`EXPLANATION STYLE: ${profile.preferredStyle}.`);
  }
  if (profile.background) {
    parts.push(`THEIR BACKGROUND, IN THEIR WORDS: "${profile.background}". Use it for examples where it genuinely helps.`);
  }
  if (profile.teachingHypothesis) {
    parts.push(
      `TEACHING HYPOTHESIS, FORMED DURING THE DIAGNOSTIC: ${profile.teachingHypothesis} ` +
        `Teach this lesson as the confirmation or correction of that read — it is your best current theory of this student, not a fact to restate.`,
    );
  }
  if (profile.redirectedFocus) {
    parts.push(
      `THE STUDENT ASKED TO FOCUS ON: ${profile.redirectedFocus}. This overrides the default scope of the topic — ` +
        `build the lesson around what they actually asked for, not a generic treatment of the original topic.`,
    );
  }

  /*
   * Cognitive load. Derived rather than asked about — nobody can report their own working-memory
   * load, but a learner who is simultaneously missing a prerequisite and holding a wrong model is
   * demonstrably carrying more than one who is not.
   */
  const load = cognitiveLoad(profile, depth);
  if (load === "high") {
    parts.push(
      `PACING — HIGH LOAD. This student is juggling several unfamiliar things at once. One new idea per board, ` +
        `consolidate before adding, and check understanding more often than usual. Prefer more short steps over fewer dense ones.`,
    );
  } else if (load === "low") {
    parts.push(`PACING — LOW LOAD. They can take bigger steps. Do not pad with consolidation they do not need.`);
  }

  return parts.join("\n");
}

/**
 * Estimated cognitive load, from what the profile demonstrates rather than from self-report.
 *
 * Exported because the build screen and the live tutor both benefit from knowing when to slow down,
 * not only the lecture writer.
 */
export function cognitiveLoad(profile: LearnerProfile, depth: DepthLevel): "low" | "medium" | "high" {
  const strain =
    profile.prerequisiteGaps.length * 2 + profile.misconceptions.length * 2 + profile.weakConcepts.length;
  if (strain >= 3) return "high";
  // Being pitched well above where they demonstrated competence is itself load, even with no
  // recorded gaps — depth 4-5 assumes fluency the profile has not evidenced.
  if (strain === 0 && depth <= 3 && profile.masteredConcepts.length > 0) return "low";
  return "medium";
}

/**
 * A one-line summary for the UI and the live tutor. Never exposes the internal reasoning — the
 * student should see "starting from the mechanism, skipping the basics", not a scored breakdown of
 * their own answers, which reads as being graded.
 */
export function profileSummary(profile: LearnerProfile, depth: DepthLevel): string {
  const bits: string[] = [DEPTH_NAMES[depth].toLowerCase()];
  if (profile.masteredConcepts.length) bits.push(`skipping ${profile.masteredConcepts.slice(0, 2).join(" and ")}`);
  if (profile.prerequisiteGaps.length) bits.push(`starting from ${profile.prerequisiteGaps[0]}`);
  if (profile.misconceptions.length) bits.push("clearing up one thing first");
  return bits.join(", ");
}

/**
 * Fold a new diagnostic exchange into the profile.
 *
 * Additive and idempotent-ish by concept: re-answering the same concept correctly moves it out of
 * `weakConcepts` into `masteredConcepts` rather than leaving it in both, which is what makes this
 * safe to call repeatedly as a conversation continues (see the continuous-adaptation path in
 * app/api/plan-lesson).
 */
/** Strip filler so two phrasings of the same belief compare equal. */
function normalizeBelief(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b(?:thinks?|believes?|assumes?|that|the|it|is|are|a|an|and|directly|most of)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the list already expresses this belief, exactly or as a superset of it. */
function isRedundantMisconception(existing: string[], candidate: string): boolean {
  const norm = normalizeBelief(candidate);
  if (!norm) return true;
  return existing.some((m) => {
    const e = normalizeBelief(m);
    return e === norm || e.includes(norm);
  });
}

export function applyDiagnostic(profile: LearnerProfile, result: DiagnosticResult): LearnerProfile {
  const next: LearnerProfile = {
    ...profile,
    diagnostics: [...profile.diagnostics, result],
    masteredConcepts: [...profile.masteredConcepts],
    weakConcepts: [...profile.weakConcepts],
    misconceptions: [...profile.misconceptions],
    updatedAt: new Date().toISOString(),
  };

  const concept = result.concept?.trim();
  if (concept) {
    const drop = (list: string[]) => list.filter((c) => c.toLowerCase() !== concept.toLowerCase());
    if (result.verdict === "correct") {
      next.weakConcepts = drop(next.weakConcepts);
      if (!next.masteredConcepts.some((c) => c.toLowerCase() === concept.toLowerCase())) {
        next.masteredConcepts.push(concept);
      }
    } else if (result.verdict === "incorrect" || result.verdict === "partial" || result.verdict === "misconception") {
      next.masteredConcepts = drop(next.masteredConcepts);
      if (!next.weakConcepts.some((c) => c.toLowerCase() === concept.toLowerCase())) {
        next.weakConcepts.push(concept);
      }
    }
  }

  /*
   * Near-duplicates, not just exact ones.
   *
   * One answer ("it happens in the nucleus and makes most of the ATP") reliably produces both the
   * two separate misconceptions AND a combined restatement of them, so exact-match dedup let three
   * overlapping corrections into the lecture prompt. Containment catches the restatement; the
   * lecture should correct the belief once, clearly.
   */
  const misconception = result.misconception?.trim();
  if (misconception && !isRedundantMisconception(next.misconceptions, misconception)) {
    next.misconceptions = [
      ...next.misconceptions.filter((m) => !normalizeBelief(m).includes(normalizeBelief(misconception))),
      misconception,
    ];
  }

  return next;
}

/**
 * Whether the profile is confident enough to stop asking and start teaching.
 *
 * THE POINT IS TO STOP EARLY. The requirement that matters most here is "do not ask ten questions
 * before teaching" — a student who came to learn something will not sit through an intake
 * interview, and every question after the useful ones costs goodwill. So this returns true as soon
 * as the answer would not change the lecture:
 *
 * - A confidently-stated low level needs no verification. Nobody falsely claims to be a beginner,
 *   and the cost of believing them is small: a foundation lesson for someone who did not need one
 *   is mildly slow, whereas verifying it wastes the one question they were willing to answer.
 * - A high claim needs one probe, because that is the claim that is wrong often enough to matter.
 * - Any demonstrated gap or misconception is already actionable — keep asking and it becomes an
 *   interrogation about something already established.
 */
export function hasEnoughSignal(profile: LearnerProfile): boolean {
  if (profile.prerequisiteGaps.length > 0 || profile.misconceptions.length > 0) return true;
  if (profile.diagnostics.length >= 2) return true;
  if (profile.claimedLevel !== null && profile.claimedLevel <= 2 && profile.confidence !== "unknown") return true;
  /*
   * A HIGH CLAIM IS VERIFIED BY A DEMONSTRATION, NEVER BY THE CLAIM ITSELF.
   *
   * This read `diagnostics.length >= 1`, and that was wrong in exactly the case the whole
   * verification rule exists for. Saying "I know everything about neural networks" IS a turn, so
   * the model grades it, so a diagnostic gets recorded — and the gate then concluded the claim had
   * been checked. A boast counted as its own evidence, the probe was suppressed, and the one
   * student the spec says to verify was the one student who never got a question.
   *
   * `verifyingDiagnostics` counts only answers that actually tested the idea, so a self-report can
   * no longer verify itself.
   */
  if (profile.claimedLevel !== null && profile.claimedLevel >= 3 && verifyingDiagnostics(profile) >= 1) return true;
  return false;
}

/**
 * Diagnostics that constitute EVIDENCE about what the student can do.
 *
 * A "skipped" verdict is a non-answer. A graded self-report ("I'm advanced") describes a belief
 * about themselves rather than a demonstration, and is excluded by requiring a concept the answer
 * actually engaged with.
 */
function verifyingDiagnostics(profile: LearnerProfile): number {
  return profile.diagnostics.filter(
    (d) => d.verdict !== "skipped" && Boolean(d.concept?.trim()) && d.selfReport !== true,
  ).length;
}

/**
 * Hard ceiling on questions, whatever the model wants. Nine is an interview; four is a chat — the
 * high end of "a short diagnostic conversation", never reached unless the topic and the answers
 * genuinely warrant it (a straightforward beginner is usually taught after one).
 */
export const MAX_DIAGNOSTIC_QUESTIONS = 4;
/** The floor a genuinely uncertain profile is nudged toward before settling for "enough" — not
 *  enforced (hasEnoughSignal can still stop earlier when the evidence is already conclusive), just
 *  the number below which "I could ask one more useful thing" should usually win the argument. */
export const MIN_USEFUL_DIAGNOSTIC_QUESTIONS = 2;
