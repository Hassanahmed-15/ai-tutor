/**
 * THE LADDER A LESSON CLIMBS, AND WHAT EACH RUNG IS FOR.
 *
 * The reported failure: ask "What is overfitting?" and the lecture explains overfitting, then
 * explains it again through an analogy, then again later in different words. The cause was
 * structural, not a bad model day. Every beat was briefed with the same instruction — "develop the
 * concept: the intuition, the mechanism, a worked example, the mistake people make, and what it
 * lets you do, ALL WITHIN THIS ONE BOARD" — so every beat was a miniature of the whole lecture.
 * Beat two re-did the intuition, beat three re-did the mechanism, and "in depth" degenerated into
 * "the same idea, reworded".
 *
 * Depth is new information: mechanism after definition, consequence after mechanism, application
 * after consequence. So a lesson is a LADDER of roles, each beat owns exactly one rung, and each
 * rung has a contract saying what it must add and — just as important — what it must not repeat.
 *
 * Pure: no model calls, no React. The planner uses it to order and brief beats, the prompt uses
 * it to tell the model what this board is for, and the auditor (lib/lessonRepetition.ts) uses it
 * to decide whether a definition or an analogy is allowed where it appeared.
 */

export type TeachingRole =
  | "hook"
  | "core"
  | "mechanism"
  | "example"
  | "implication"
  | "application"
  | "pitfall"
  | "contrast"
  | "recap";

/** Canonical order. A lesson may skip rungs; it must not descend. */
export const LADDER: readonly TeachingRole[] = [
  "hook",
  "core",
  "mechanism",
  "example",
  "implication",
  "application",
  "pitfall",
  "contrast",
  "recap",
];

export function ladderRank(role: TeachingRole): number {
  return LADDER.indexOf(role);
}

/**
 * The subject of a lesson as a phrase fit for a title: "What is overfitting?" → "Overfitting",
 * "how linear regression works" → "Linear Regression", "explain photosynthesis to me" →
 * "Photosynthesis".
 *
 * The default objectives were being built from the raw question, so a board was titled
 * "What Is Overfitting? With Real Numbers" and then truncated to "What Is Overfitting? With Real".
 * A lesson is about a thing, not about the sentence the student typed.
 */
export function subjectPhrase(topic: string): string {
  const phrase = String(topic ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:please\s+)?(?:can you\s+|could you\s+|would you\s+)?(?:explain|teach|describe|tell me about|help me understand|walk me through|show me)\s+(?:me\s+)?(?:about\s+)?/i, "")
    .replace(/^(?:what|why|how|when|where|which)\s+(?:is|are|does|do|did|can|should|would|was|were)\s+(?:an?\s+|the\s+)?/i, "")
    // "how linear regression works", "why the sky is blue": a bare how/why with no auxiliary.
    .replace(/^(?:how|why)\s+(?!(?:is|are|does|do|did|can|should|would|was|were)\b)(?:the\s+|an?\s+)?/i, "")
    .replace(/^(?:the|an?)\s+/i, "")
    .replace(/\s+(?:to me|for me|please)\s*$/i, "")
    .replace(/\s+(?:work|works|working|mean|means|happen|happens|matter|matters)\s*\??\s*$/i, "")
    .replace(/[?!.]+\s*$/, "")
    .trim();
  const chosen = phrase || String(topic ?? "").trim();
  return chosen
    .split(" ")
    .map((word, index) => (index > 0 && /^(?:a|an|and|as|at|by|for|in|of|on|or|the|to|vs\.?)$/i.test(word) ? word.toLowerCase() : word.replace(/^[a-z]/, (c) => c.toUpperCase())))
    .join(" ");
}

export interface RoleContract {
  /** What this board exists to add. */
  must: string;
  /** What it must leave to other boards — the anti-repetition half of the contract. */
  mustNot: string;
  /** May this board state the definition of the lesson's subject? Only one rung may. */
  allowsDefinition: boolean;
  /** May this board offer an analogy for the subject? Only one rung may. */
  allowsAnalogy: boolean;
}

export const ROLE_CONTRACT: Record<TeachingRole, RoleContract> = {
  hook: {
    must: "Open with the concrete puzzle, question or situation that makes this topic worth learning, so the student wants the answer before it arrives — and END on that open question. The answer begins on the next board.",
    mustNot: "Do not define the term, do not explain how it works, and do not offer an analogy for it — the next board does exactly that, and doing it here means it is said twice.",
    allowsDefinition: false,
    allowsAnalogy: false,
  },
  core: {
    must: "Give the ONE canonical definition and the mental model, once, in the clearest words available, and establish the vocabulary every later board will use.",
    mustNot: "No worked example, no step-by-step mechanism, no pitfalls — later boards own those. State the definition once and never restate it in other words; at most ONE analogy, and only if it adds something the definition did not.",
    allowsDefinition: true,
    allowsAnalogy: true,
  },
  mechanism: {
    must: "Explain HOW it works: the steps, the causal chain, what changes and why, in the vocabulary already established.",
    mustNot: "Do not re-define the concept, re-motivate it, or offer a fresh analogy for it. The definition is already on the board above this one; refer to it in a clause at most.",
    allowsDefinition: false,
    allowsAnalogy: false,
  },
  example: {
    must: "Work ONE concrete example with real values through the mechanism already taught, narrating what each step produces.",
    mustNot: "Do not re-explain the mechanism in general terms first and do not re-define the concept — the example IS the explanation now. Numbers and outcomes, not restatement.",
    allowsDefinition: false,
    allowsAnalogy: false,
  },
  implication: {
    must: "Draw out what FOLLOWS: consequences, trade-offs, limits, where it breaks, and what it implies for neighbouring ideas.",
    mustNot: "Do not summarise what was taught. Every sentence must state a consequence or relationship that has not been said yet.",
    allowsDefinition: false,
    allowsAnalogy: false,
  },
  application: {
    must: "Show the concept being USED: a real task, decision or design, and what changes because the student now has it.",
    mustNot: "No re-definition and no re-derivation. Use it; do not teach it again.",
    allowsDefinition: false,
    allowsAnalogy: false,
  },
  pitfall: {
    must: "Name the specific misconception, show with the mechanism already taught exactly which step it gets wrong, and state the correct reasoning.",
    mustNot: "Do not re-teach the concept from scratch in order to correct the mistake. Correct the faulty step only.",
    allowsDefinition: false,
    allowsAnalogy: false,
  },
  contrast: {
    must: "Set the concept beside its nearest neighbour and make the DIFFERENCE precise: what each does that the other cannot, and when to choose which.",
    mustNot: "Do not re-explain the concept itself — the student has it. Explain the neighbour only as far as the contrast needs.",
    allowsDefinition: false,
    allowsAnalogy: false,
  },
  recap: {
    must: "Connect the boards into one structure — how the definition, mechanism, example and implications fit together — in a few sentences, then the single most usable takeaway.",
    mustNot: "Do not re-define, re-derive or re-exemplify anything, and do not narrate the lesson in the past tense (\"we explored\", \"we examined\", \"we noted\"). Name each idea in a clause, in the present tense, and state the RELATIONSHIP between them; a recap that re-explains is a second lecture.",
    allowsDefinition: false,
    allowsAnalogy: false,
  },
};

/*
 * Role from wording. Order matters: a title like "Common mistakes in the mechanism" is a pitfall
 * board, so the more specific rungs are tested first and the broad ones (core, mechanism) last.
 */
const ROLE_PATTERNS: Array<[TeachingRole, RegExp]> = [
  ["recap", /\b(?:recap|summar\w*|takeaways?|wrap(?:ping)?[- ]up|synthesis|bring(?:ing)? it (?:all )?together|putting it together|review)\b/i],
  ["contrast", /\b(?:versus|vs\.?|compar\w*|contrast\w*|difference|differs?|unlike|instead of|rather than|which to (?:use|choose))\b/i],
  ["pitfall", /\b(?:mistakes?|misconceptions?|pitfalls?|gotchas?|goes wrong|gets? wrong|confus\w*|myths?|traps?|common errors?)\b/i],
  ["implication", /\b(?:why (?:it|this) matters|consequences?|implications?|implies|what (?:this|it) means for|so what|trade-?offs?|limits?|limitations?|when it (?:fails|breaks)|edge cases?|generali[sz]\w*)\b/i],
  ["application", /\b(?:appl(?:y|ying|ication)|use it to|using it|in the real world|real[- ]world|in practice|try it|build\w*|design\w*|solv\w*|deploy\w*)\b/i],
  ["example", /\b(?:examples?|worked|walk(?:ing)?[- ]?through|with (?:real )?numbers|a concrete case|case study|let'?s (?:try|compute|calculate|work))\b/i],
  ["mechanism", /\b(?:how (?:it|this|they|does|do) work|how .{1,30} works?|mechanisms?|step[- ]by[- ]step|the process|under the hood|inside|stages?|pathway|cycle|sequence|algorithm|deriv\w*|what happens when)\b/i],
  ["hook", /\b(?:why (?:does|do|is|are|should|would|can'?t)|puzzle|hook|what if|imagine (?:a|you)|the problem with|worth learning|a question)\b/i],
  ["core", /\b(?:what (?:is|are)|defin\w*|meaning|the idea of|core idea|fundamentals?|basics?|intuition|in plain terms|mental model|what .{1,30} actually is)\b/i],
];

/**
 * Infer a beat's rung from its wording, falling back to its position.
 *
 * The first beat of a lesson is the hook and the last is the recap by construction — the planner
 * builds them that way — and a middle beat with no telling words is placed by where it sits, so a
 * plan with vague titles still climbs rather than wandering.
 */
export function inferRole(entry: { title: string; objective?: string }, index: number, total: number): TeachingRole {
  if (index === 0) return "hook";
  if (index === total - 1 && total > 1) return "recap";
  /*
   * The TITLE decides; the objective is only consulted when the title says nothing. Objectives
   * describe what a board must not do as well as what it must ("no example, no mechanism yet"),
   * so matching them first classified a definition board as an example board.
   */
  for (const text of [entry.title, entry.objective ?? ""]) {
    for (const [role, pattern] of ROLE_PATTERNS) {
      if (role === "hook" || role === "recap") continue;
      if (pattern.test(text)) return role;
    }
  }
  // Positional fallback across the middle beats: definition first, then mechanism, then example,
  // then what follows from it.
  const middle: TeachingRole[] = ["core", "mechanism", "example", "implication"];
  const fraction = total <= 2 ? 0 : (index - 1) / Math.max(1, total - 2);
  return middle[Math.min(middle.length - 1, Math.floor(fraction * middle.length))];
}

/**
 * Assign roles and put the beats in ladder order.
 *
 * "Never go deep first and then return to basics." A planner can propose "How it works" before
 * "What it is"; a source document can be organised by chapter rather than by pedagogy. Stable
 * sort by rung keeps the planner's order within a rung (two examples stay in their given order)
 * while guaranteeing the lesson never descends. The hook stays first and the recap last whatever
 * their wording says.
 */
export function orderByLadder<T extends { title: string; objective?: string }>(entries: T[]): Array<T & { role: TeachingRole }> {
  const total = entries.length;
  // A rung the planner assigned explicitly (the default ladder does) is authoritative; wording is
  // only inferred for subtopics that arrived without one.
  const tagged = entries.map((entry, index) => ({ entry, role: (entry as { role?: TeachingRole }).role ?? inferRole(entry, index, total), index }));
  const rankOf = (role: TeachingRole) => (role === "hook" ? -1 : role === "recap" ? LADDER.length : ladderRank(role));
  tagged.sort((a, b) => rankOf(a.role) - rankOf(b.role) || a.index - b.index);
  return tagged.map(({ entry, role }) => ({ ...entry, role }));
}

/** True when some beat sits on a lower rung than a beat before it (hook and recap excluded). */
export function descends(roles: TeachingRole[]): boolean {
  let highest = -1;
  for (const role of roles) {
    if (role === "hook" || role === "recap") continue;
    const rank = ladderRank(role);
    if (rank < highest) return true;
    highest = Math.max(highest, rank);
  }
  return false;
}

/**
 * The objectives a lesson gets when the student skipped planning: one rung each, no two alike.
 *
 * The old defaults were "Core idea / How it works / A worked example / Common mistake" — a fair
 * ladder, but the opener ALSO said "make it worth learning" and the recap ALSO said "correct the
 * main misconception", so two rungs were taught twice before the model even started. Each
 * objective here names what the board adds AND what it leaves alone.
 */
export function defaultLadderObjectives(topic: string, count: number): Array<{ title: string; objective: string; role: TeachingRole }> {
  const ladder: Array<{ title: string; objective: string; role: TeachingRole }> = [
    { role: "core", title: `What ${topic} Actually Is`, objective: `Define ${topic} once, precisely, and give the single mental model the rest of the lesson builds on. Definition and model only — no example, no mechanism yet.` },
    { role: "mechanism", title: `How ${topic} Works`, objective: `Explain the mechanism behind ${topic}: the steps and the causal chain, using the definition already given. No re-definition.` },
    { role: "example", title: `${topic} With Real Numbers`, objective: `Work one concrete example of ${topic} through the mechanism already taught, with actual values and outcomes. Do not re-explain the mechanism in general terms.` },
    { role: "implication", title: `What ${topic} Implies`, objective: `State the consequences, limits and trade-offs that follow from how ${topic} works. Only things not yet said.` },
    { role: "application", title: `Using ${topic}`, objective: `Show ${topic} used for a real task or decision and what changes because of it. Use it; do not re-teach it.` },
    { role: "pitfall", title: `Where ${topic} Goes Wrong`, objective: `Name the one misconception people hold about ${topic}, show which step of the mechanism it breaks, and correct that step only.` },
    { role: "contrast", title: `${topic} Versus Its Neighbour`, objective: `Set ${topic} beside the idea it is most confused with and make the difference precise: what each does that the other cannot.` },
  ];
  return ladder.slice(0, Math.max(1, count));
}

export interface LessonMapBeat {
  sequence: number;
  title: string;
  objective: string;
  role?: TeachingRole;
}

export interface TaughtBeatSummary {
  sequence: number;
  /** What the board established, as short claims the next boards can build on without re-stating. */
  keyClaims: string[];
}

/**
 * The lesson map the model reads before writing a board: every beat, what is done, what is now,
 * what is still to come. The previous prompt passed `fullPlan` as a bare JSON array and never said
 * what to do with it, so the model could neither avoid pre-teaching an upcoming board nor tell
 * which earlier ones it must not repeat.
 */
export function lessonMapBlock(plan: LessonMapBeat[], currentSequence: number, taught: TaughtBeatSummary[]): string {
  const claimsFor = new Map(taught.map((t) => [t.sequence, t.keyClaims]));
  const lines = plan.map((beat) => {
    const n = beat.sequence + 1;
    const role = beat.role ? ` (${beat.role})` : "";
    if (beat.sequence < currentSequence) {
      const claims = claimsFor.get(beat.sequence) ?? [];
      const established = claims.length ? ` — ESTABLISHED: ${claims.map((c) => `"${c}"`).join("; ")}` : "";
      return `  ${n}. [TAUGHT]${role} ${beat.title}${established}`;
    }
    if (beat.sequence === currentSequence) return `  ${n}. [THIS BOARD]${role} ${beat.title} — objective: ${beat.objective}`;
    return `  ${n}. [UPCOMING]${role} ${beat.title} — will teach: ${beat.objective}`;
  });
  return [
    "LESSON MAP — every board in order. Read it before writing.",
    ...lines,
    "RULES THAT FOLLOW FROM THE MAP:",
    "- Anything marked ESTABLISHED is known to the student. Do not define it, re-motivate it, re-derive it or offer another analogy for it. Refer to it in a clause and build on it.",
    "- Anything marked UPCOMING belongs to a later board. Do not pre-teach it; at most name it as what comes next.",
    "- This board adds NEW information only: a new mechanism, relationship, consequence, example or use. A sentence that could be deleted without losing information the student did not already have should not be written.",
  ].join("\n");
}

/**
 * The paragraph of the system prompt that says what THIS board is for. Replaces the old "develop
 * the concept — intuition, mechanism, example, mistake and use, all within this one board", which
 * is the sentence that made every board a whole lecture.
 */
export function roleBriefing(role: TeachingRole, movements: [number, number]): string {
  const contract = ROLE_CONTRACT[role];
  return [
    `THIS BOARD'S RUNG: ${role.toUpperCase()}.`,
    `It MUST: ${contract.must}`,
    `It MUST NOT: ${contract.mustNot}`,
    `Develop it in ${movements[0]}-${movements[1]} movements that all serve THIS rung — go deeper into the rung, never sideways into another one's job.`,
    `Depth means new information: a further step, a relationship, a consequence, a number, a use. Rewording something already said is not depth and is a failure of this board.`,
  ].join(" ");
}
