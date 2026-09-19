import { resolveDepth, type DepthLevel, type LearnerProfile, type LearningObjective } from "./learnerProfile";
import { shouldIncludeCodeExamples, type LearnerGoal, type LearnerProfileSnapshot } from "./progressiveLectureTypes";

/**
 * What Aria remembers about a student ACROSS lectures.
 *
 * WHY THIS EXISTS. Each planning conversation builds a rich picture of the student — what they have
 * shown they know, what they are shaky on, which wrong beliefs they hold — and until now all of it
 * was thrown away when the page closed. The next lecture started from nothing, re-asked the same
 * questions, and could re-teach a concept the student had demonstrated a week earlier. Only a list
 * of the last twenty topics survived.
 *
 * The shape follows dialogue-based knowledge tracing (Scarlatos, Baker & Lan, LAK 2025): evidence
 * from conversation and checkpoints is attached to individual CONCEPTS, and each concept carries a
 * mastery estimate that moves with every new piece of evidence. It is deliberately simpler than a
 * Bayesian model — this app teaches arbitrary topics, so there is no fixed skill graph to calibrate
 * one against — but it keeps the property that matters: one lucky or unlucky answer moves the
 * estimate, it does not overwrite it.
 *
 * The student can see and edit all of this (components/memory/LearnerMemoryPanel.tsx). Nothing
 * here is hidden inference; it is a record they can correct.
 *
 * Pure: no database. lib/learnerMemoryStore.ts persists it.
 */

export type ConceptEvidence = {
  source: "planning" | "checkpoint" | "lecture" | "student";
  at: string;
  note: string;
};

export type ConceptMemory = {
  key: string;
  label: string;
  /** 0 = has not got it, 1 = solid. */
  mastery: number;
  evidence: ConceptEvidence[];
  lastSeen: string;
  topics: string[];
};

export type MisconceptionMemory = {
  id: string;
  text: string;
  topic: string;
  firstSeen: string;
  lastSeen: string;
  resolved: boolean;
};

export type LearnerMemory = {
  version: 1;
  concepts: Record<string, ConceptMemory>;
  misconceptions: MisconceptionMemory[];
  preferences: { style: string | null; background: string | null };
  goals: Array<{ topic: string; objective: LearningObjective; at: string }>;
  /** The level the last planning conversation settled on, 1-5. */
  lastLevel: DepthLevel | null;
  /** Every lesson started, newest last — so what Aria remembers is never blank after a lesson. */
  lessons: LessonRecord[];
  /**
   * How they behave in lectures, tallied: asked for code, to go deeper, for simpler, for more
   * examples, or asked a question. Patterns, not words — "asks for code" says who they are.
   */
  signals: Partial<Record<LearnerSignal, number>>;
  /** The student's own words — planning answers and questions asked mid-lecture. */
  excerpts: MemoryExcerpt[];
  /** Aria's written portrait of the student, synthesised from everything above. */
  persona: LearnerPersona | null;
  updatedAt: string;
};

export type LessonRecord = {
  topic: string;
  at: string;
  beatsWatched: number;
  /** How they asked for it: with code, at what level, for what. Absent on lessons recorded earlier. */
  codeExamples?: boolean;
  expertise?: string;
  goal?: string;
};

export type LearnerSignal = "code" | "deeper" | "simpler" | "more-examples" | "question";
export const LEARNER_SIGNALS: LearnerSignal[] = ["code", "deeper", "simpler", "more-examples", "question"];

export type MemoryExcerpt = { source: "planning" | "question"; topic: string; text: string; at: string };

/**
 * What Aria thinks about the student — the portrait shown at the top of "What Aria remembers" and
 * handed to every model that plans or writes their lectures (see personaForPrompt).
 */
export type LearnerPersona = {
  /** 2-4 sentences, written to the student ("You..."). */
  summary: string;
  interests: string[];
  strengths: string[];
  growthAreas: string[];
  learningStyle: string;
  /** How Aria will teach them, in one or two sentences. */
  teachingPlan: string;
  /** The student's own correction, kept verbatim and treated as authoritative on every refresh. */
  studentNote: string | null;
  generatedAt: string;
  basedOn: { lessons: number; excerpts: number; concepts: number };
};

export const MEMORY_LIMITS = { concepts: 200, misconceptions: 50, goals: 20, lessons: 50, excerpts: 60, evidencePerConcept: 5 } as const;

/**
 * Where each kind of evidence pulls a concept's mastery.
 *
 * A misconception sits BELOW a plain gap on purpose: a wrong model actively blocks new learning,
 * which simply not knowing does not (the reason learnerInstruction corrects misconceptions first).
 */
export const MASTERY_TARGETS = { mastered: 0.85, weak: 0.35, misconception: 0.15, missing: 0.05, covered: 0.55 } as const;
/** How far one new piece of evidence moves an existing estimate toward its target. */
const LEARNING_RATE = 0.5;
/** Days for an unrefreshed estimate to drift halfway back to "unknown" (0.5). */
const HALF_LIFE_DAYS = 60;
/** Misconceptions older than this are not carried into a new lecture (they stay visible and editable). */
export const MISCONCEPTION_MEMORY_DAYS = 120;

export function emptyMemory(now = new Date().toISOString()): LearnerMemory {
  return { version: 1, concepts: {}, misconceptions: [], preferences: { style: null, background: null }, goals: [], lastLevel: null, lessons: [], signals: {}, excerpts: [], persona: null, updatedAt: now };
}

/** One key per concept however it was phrased: "Transition Matrices" and "transition matrix" agree. */
export function conceptKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (word.length > 4 && word.endsWith("ices") ? `${word.slice(0, -4)}ix` : word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word))
    .join(" ")
    .trim();
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function touchConcept(
  memory: LearnerMemory,
  label: string,
  target: number,
  evidence: ConceptEvidence,
  topic: string,
  rate = LEARNING_RATE,
): void {
  const key = conceptKey(label);
  if (!key) return;
  const existing = memory.concepts[key];
  const mastery = existing ? existing.mastery + rate * (target - existing.mastery) : target;
  memory.concepts[key] = {
    key,
    label: existing?.label ?? label.trim().slice(0, 120),
    mastery: clamp01(mastery),
    evidence: [...(existing?.evidence ?? []), evidence].slice(-MEMORY_LIMITS.evidencePerConcept),
    lastSeen: evidence.at,
    topics: [...new Set([...(existing?.topics ?? []), topic].filter(Boolean))].slice(-8),
  };
}

function normaliseText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Keep the memory to a bounded size: the most recently seen concepts and misconceptions win. */
export function boundMemory(memory: LearnerMemory): LearnerMemory {
  const concepts = Object.values(memory.concepts)
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, MEMORY_LIMITS.concepts);
  return {
    ...memory,
    concepts: Object.fromEntries(concepts.map((c) => [c.key, c])),
    misconceptions: [...memory.misconceptions].sort((a, b) => b.lastSeen.localeCompare(a.lastSeen)).slice(0, MEMORY_LIMITS.misconceptions),
    goals: memory.goals.slice(-MEMORY_LIMITS.goals),
    lessons: (memory.lessons ?? []).slice(-MEMORY_LIMITS.lessons),
    signals: memory.signals ?? {},
    excerpts: (memory.excerpts ?? []).slice(-MEMORY_LIMITS.excerpts),
  };
}

/**
 * Fold one planning conversation's profile into long-term memory.
 *
 * Merge, never replace: a concept the student showed mastery of last month and is merely not
 * mentioned today keeps its estimate. Only concepts this profile has evidence about move.
 */
export function mergeSessionProfile(
  memory: LearnerMemory,
  profile: LearnerProfile,
  now = new Date().toISOString(),
): LearnerMemory {
  const next: LearnerMemory = structuredClone(memory);
  const topic = profile.topic;
  const note = (what: string) => ({ source: "planning" as const, at: now, note: `${what} while planning "${topic}"` });
  for (const label of profile.masteredConcepts) touchConcept(next, label, MASTERY_TARGETS.mastered, note("showed they know it"), topic);
  for (const label of profile.weakConcepts) touchConcept(next, label, MASTERY_TARGETS.weak, note("recognised it but could not use it"), topic);
  for (const label of profile.prerequisiteGaps) touchConcept(next, label, MASTERY_TARGETS.missing, note("had not met it"), topic);

  for (const text of profile.misconceptions) {
    const existing = next.misconceptions.find((m) => normaliseText(m.text) === normaliseText(text));
    if (existing) {
      existing.lastSeen = now;
      existing.resolved = false; // it came back, so it was not resolved after all
    } else {
      next.misconceptions.push({ id: `m${Date.parse(now).toString(36)}${next.misconceptions.length}`, text: text.slice(0, 200), topic, firstSeen: now, lastSeen: now, resolved: false });
    }
  }

  if (profile.preferredStyle) next.preferences.style = profile.preferredStyle;
  if (profile.background) next.preferences.background = profile.background;
  if (profile.objective !== "unknown") next.goals.push({ topic, objective: profile.objective, at: now });
  next.lastLevel = resolveDepth(profile);
  next.updatedAt = now;
  return boundMemory(next);
}

/** A checkpoint answer is direct evidence about one concept. */
export function applyCheckpoint(
  memory: LearnerMemory,
  concept: string,
  correct: boolean,
  topic: string,
  now = new Date().toISOString(),
): LearnerMemory {
  if (!conceptKey(concept)) return memory;
  const next: LearnerMemory = structuredClone(memory);
  touchConcept(
    next,
    concept,
    correct ? MASTERY_TARGETS.mastered : MASTERY_TARGETS.weak,
    { source: "checkpoint", at: now, note: correct ? `answered a checkpoint correctly in "${topic}"` : `missed a checkpoint in "${topic}"` },
    topic,
    0.4,
  );
  next.updatedAt = now;
  return boundMemory(next);
}

/** Mastery as of `now`: evidence that has not been refreshed drifts back toward "unknown". */
export function effectiveMastery(concept: ConceptMemory, now = Date.now()): number {
  const days = Math.max(0, (now - Date.parse(concept.lastSeen)) / 86_400_000);
  if (!Number.isFinite(days)) return concept.mastery;
  return 0.5 + (concept.mastery - 0.5) * Math.pow(0.5, days / HALF_LIFE_DAYS);
}

/** Words that say nothing about which concepts a topic touches. */
const TOPIC_STOPWORDS = new Set(["the", "and", "for", "with", "how", "what", "why", "between", "diff", "difference", "into", "from", "about", "does", "work"]);

function relevance(concept: ConceptMemory, topic: string): number {
  const words = new Set(conceptKey(topic).split(" ").filter((w) => w.length > 2 && !TOPIC_STOPWORDS.has(w)));
  if (words.size === 0) return 0;
  const text = `${concept.key} ${concept.topics.map(conceptKey).join(" ")}`.split(" ");
  return text.filter((w) => words.has(w)).length;
}

/**
 * A starting profile for a new topic, from what is already remembered.
 *
 * Only concepts that plausibly relate to the topic are carried in — a student's calculus history is
 * not evidence about their Spanish. The self-reported level is left empty: the conversation still
 * asks, but it can skip what memory already answers, and the lecture does not re-teach it.
 */
export function seedProfile(memory: LearnerMemory, topic: string, base: LearnerProfile, now = Date.now()): LearnerProfile {
  const related = Object.values(memory.concepts)
    .map((concept) => ({ concept, score: relevance(concept, topic), mastery: effectiveMastery(concept, now) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.concept.lastSeen.localeCompare(a.concept.lastSeen));
  const pick = (test: (m: number) => boolean, cap: number) =>
    related.filter((entry) => test(entry.mastery)).slice(0, cap).map((entry) => entry.concept.label);
  // A misconception not seen for months may well have been fixed since; carrying it forward would
  // "correct" a student who no longer holds it. Only recent, unresolved ones seed a lecture.
  const misconceptions = memory.misconceptions
    .filter((m) => now - Date.parse(m.lastSeen) < MISCONCEPTION_MEMORY_DAYS * 86_400_000)
    .filter((m) => !m.resolved && relevance({ key: conceptKey(m.text), label: m.text, mastery: 0, evidence: [], lastSeen: m.lastSeen, topics: [m.topic] }, topic) > 0)
    .slice(0, 5)
    .map((m) => m.text);
  return {
    ...base,
    topic,
    masteredConcepts: pick((m) => m >= 0.7, 8),
    weakConcepts: pick((m) => m >= 0.3 && m < 0.7, 8),
    prerequisiteGaps: pick((m) => m < 0.3, 5),
    misconceptions,
    preferredStyle: memory.preferences.style ?? base.preferredStyle,
    background: memory.preferences.background ?? base.background,
  };
}

/** True when memory contributed anything to a seeded profile — the planning chat says so. */
export function memoryWasUsed(seeded: LearnerProfile): boolean {
  return seeded.masteredConcepts.length + seeded.weakConcepts.length + seeded.prerequisiteGaps.length + seeded.misconceptions.length > 0;
}

const GOAL_FOR_OBJECTIVE: Record<LearningObjective, LearnerGoal> = {
  exam: "exam",
  fundamentals: "school",
  project: "practical",
  interview: "professional",
  curiosity: "curiosity",
  unknown: "curiosity",
};

/**
 * The five-field summary the lecture pipeline requires, DERIVED from the profile.
 *
 * It used to be inferred a second time by a separate model call at build time, which could disagree
 * with the conversation the student just had. Deriving it keeps one source of truth.
 */
export function snapshotFrom(profile: LearnerProfile, depth: DepthLevel = resolveDepth(profile)): LearnerProfileSnapshot {
  const expertise = depth <= 2 ? "beginner" : depth === 3 ? "intermediate" : "advanced";
  const goal = GOAL_FOR_OBJECTIVE[profile.objective];
  const style = (profile.preferredStyle ?? "").toLowerCase();
  const preferredExamples = /worked|step/.test(style)
    ? "worked"
    : /real|world|practical|everyday/.test(style)
      ? "real-world"
      : /visual|diagram|picture/.test(style)
        ? "visual"
        : "mixed";
  return {
    expertise,
    depth: depth >= 4 ? "deep" : "balanced",
    goal,
    codeExamples: shouldIncludeCodeExamples({ expertise, goal }),
    preferredExamples,
    rationale: (profile.teachingHypothesis ?? "").slice(0, 400),
    confirmedAt: new Date().toISOString(),
  };
}

/* ── edits the student makes in "What Aria remembers" ─────────────────────── */

export type MemoryEdit =
  | { op: "setMastery"; key: string; mastery: number }
  | { op: "removeConcept"; key: string }
  | { op: "resolveMisconception"; id: string; resolved: boolean }
  | { op: "removeMisconception"; id: string }
  | { op: "setPreference"; field: "style" | "background"; value: string | null }
  | { op: "setPersonaNote"; text: string };

export function isMemoryEdit(value: unknown): value is MemoryEdit {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== "object") return false;
  switch (v.op) {
    case "setMastery":
      return typeof v.key === "string" && typeof v.mastery === "number" && Number.isFinite(v.mastery);
    case "removeConcept":
      return typeof v.key === "string";
    case "resolveMisconception":
      return typeof v.id === "string" && typeof v.resolved === "boolean";
    case "removeMisconception":
      return typeof v.id === "string";
    case "setPreference":
      return (v.field === "style" || v.field === "background") && (v.value === null || typeof v.value === "string");
    case "setPersonaNote":
      return typeof v.text === "string";
    default:
      return false;
  }
}

/** Apply one student edit. The student's word about themselves is the strongest evidence there is. */
export function applyMemoryEdit(memory: LearnerMemory, edit: MemoryEdit, now = new Date().toISOString()): LearnerMemory {
  const next: LearnerMemory = structuredClone(memory);
  switch (edit.op) {
    case "setMastery": {
      const concept = next.concepts[edit.key];
      if (concept) {
        concept.mastery = clamp01(edit.mastery);
        concept.lastSeen = now;
        concept.evidence = [...concept.evidence, { source: "student" as const, at: now, note: "set by the student" }].slice(-MEMORY_LIMITS.evidencePerConcept);
      }
      break;
    }
    case "removeConcept":
      delete next.concepts[edit.key];
      break;
    case "resolveMisconception": {
      const m = next.misconceptions.find((x) => x.id === edit.id);
      if (m) m.resolved = edit.resolved;
      break;
    }
    case "removeMisconception":
      next.misconceptions = next.misconceptions.filter((x) => x.id !== edit.id);
      break;
    case "setPreference":
      next.preferences[edit.field] = edit.value ? edit.value.slice(0, 300) : null;
      break;
    case "setPersonaNote": {
      // The student's own words become the portrait at once, and stay authoritative: every later
      // refresh is told to build on them, never to contradict them.
      const text = edit.text.trim().slice(0, 1200);
      next.persona = {
        ...(next.persona ?? { interests: [], strengths: [], growthAreas: [], learningStyle: "", teachingPlan: "", basedOn: { lessons: 0, excerpts: 0, concepts: 0 } }),
        summary: text || next.persona?.summary || "",
        studentNote: text || null,
        generatedAt: now,
      };
      break;
    }
  }
  next.updatedAt = now;
  return next;
}

/** Accept a stored document without trusting its shape; anything malformed becomes empty memory. */
export function parseMemory(raw: unknown): LearnerMemory {
  const r = raw as Partial<LearnerMemory> | null;
  if (!r || typeof r !== "object" || r.version !== 1 || typeof r.concepts !== "object" || !Array.isArray(r.misconceptions)) {
    return emptyMemory();
  }
  return {
    version: 1,
    concepts: r.concepts as Record<string, ConceptMemory>,
    misconceptions: r.misconceptions as MisconceptionMemory[],
    preferences: { style: r.preferences?.style ?? null, background: r.preferences?.background ?? null },
    goals: Array.isArray(r.goals) ? r.goals : [],
    lastLevel: typeof r.lastLevel === "number" ? (r.lastLevel as DepthLevel) : null,
    lessons: Array.isArray(r.lessons) ? r.lessons : [],
    signals: r.signals && typeof r.signals === "object" ? r.signals : {},
    excerpts: Array.isArray(r.excerpts) ? r.excerpts : [],
    persona: r.persona && typeof r.persona === "object" && typeof r.persona.summary === "string" ? r.persona : null,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : new Date().toISOString(),
  };
}

/**
 * True when a planning conversation actually learned something about the student.
 *
 * An untouched profile (no level, no answers, no concepts) must not be sent as though it described
 * someone: the lecture would be pitched from defaults while claiming to be personalised.
 */
export function profileHasSignal(profile: LearnerProfile): boolean {
  return (
    profile.claimedLevel !== null ||
    profile.diagnostics.length > 0 ||
    profile.masteredConcepts.length + profile.weakConcepts.length + profile.prerequisiteGaps.length + profile.misconceptions.length > 0 ||
    Boolean(profile.redirectedFocus || profile.teachingHypothesis)
  );
}

/**
 * What Aria tells the student she remembers, when memory seeded this conversation.
 *
 * Said out loud rather than applied silently: a student who sees "I remember you know X" can say
 * "actually I've forgotten it", and one who is never told cannot correct it.
 */
export function rememberedLine(seeded: LearnerProfile): string {
  const bits: string[] = [];
  if (seeded.masteredConcepts.length) bits.push(`you know ${seeded.masteredConcepts.slice(0, 3).join(", ")}`);
  if (seeded.weakConcepts.length) bits.push(`you were unsure about ${seeded.weakConcepts.slice(0, 2).join(", ")}`);
  if (seeded.prerequisiteGaps.length) bits.push(`${seeded.prerequisiteGaps.slice(0, 2).join(", ")} was new to you`);
  if (seeded.misconceptions.length) bits.push(`we had a mix-up about "${seeded.misconceptions[0]}"`);
  if (bits.length === 0) return "";
  return `From our earlier lessons I remember ${bits.join("; ")}. Tell me if any of that has changed.`;
}

/* ── what the LECTURE itself teaches Aria ─────────────────────────────────── */

/**
 * A lesson started. Recorded for every lecture, whatever the planning conversation did or did not
 * establish — measured in a real account, a student who watched half a lecture came back to
 * "Nothing yet", because memory only learned from the conversation's concept lists and theirs named
 * none. What Aria remembers must at least include that the lesson happened.
 */
export function recordLesson(
  memory: LearnerMemory,
  topic: string,
  now = new Date().toISOString(),
  how?: { codeExamples?: boolean; expertise?: string; goal?: string },
): LearnerMemory {
  const next: LearnerMemory = structuredClone(memory);
  const clean = topic.trim().slice(0, 200);
  if (!clean) return memory;
  next.lessons = [...(next.lessons ?? []), { topic: clean, at: now, beatsWatched: 0, ...(how ?? {}) }];
  next.updatedAt = now;
  return boundMemory(next);
}

/** One thing the student did in a lecture: asked for code, to go deeper, for simpler, or a question. */
export function recordSignal(memory: LearnerMemory, signal: LearnerSignal, now = new Date().toISOString()): LearnerMemory {
  const next: LearnerMemory = structuredClone(memory);
  next.signals = { ...(next.signals ?? {}), [signal]: (next.signals?.[signal] ?? 0) + 1 };
  next.updatedAt = now;
  return next;
}

/**
 * The student watched these beats to the end: each is a concept they have now been TAUGHT.
 *
 * Evidence of exposure, not of understanding, so it lands at "covered" (still settling) — a
 * checkpoint answer is what moves it further. And it never LOWERS an estimate: being taught
 * something you already showed you know is not evidence you know it less.
 */
export function applyLectureProgress(
  memory: LearnerMemory,
  topic: string,
  watched: Array<{ concept: string }>,
  now = new Date().toISOString(),
): LearnerMemory {
  if (watched.length === 0) return memory;
  const next: LearnerMemory = structuredClone(memory);
  for (const { concept } of watched) {
    const key = conceptKey(concept);
    if (!key) continue;
    const before = next.concepts[key]?.mastery;
    touchConcept(next, concept, MASTERY_TARGETS.covered, { source: "lecture", at: now, note: `taught in the lesson "${topic}"` }, topic);
    if (before !== undefined && before > next.concepts[key].mastery) next.concepts[key].mastery = before;
  }
  const lesson = [...(next.lessons ?? [])].reverse().find((l) => l.topic === topic.trim().slice(0, 200));
  if (lesson) lesson.beatsWatched += watched.length;
  next.updatedAt = now;
  return boundMemory(next);
}

/* ── the portrait: evidence in, persona out ───────────────────────────────── */

/** Keep the student's own words, deduplicated and capped. Very short fragments say nothing. */
export function addExcerpts(
  memory: LearnerMemory,
  entries: Array<{ source: MemoryExcerpt["source"]; topic: string; text: string }>,
  now = new Date().toISOString(),
): LearnerMemory {
  const next: LearnerMemory = structuredClone(memory);
  next.excerpts = next.excerpts ?? [];
  const seen = new Set(next.excerpts.map((e) => normaliseText(e.text)));
  let added = 0;
  for (const entry of entries) {
    const text = String(entry.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (text.length < 4 || seen.has(normaliseText(text))) continue;
    seen.add(normaliseText(text));
    next.excerpts.push({ source: entry.source, topic: String(entry.topic ?? "").slice(0, 120), text, at: now });
    added += 1;
  }
  if (added === 0) return memory;
  next.updatedAt = now;
  return boundMemory(next);
}

const EVIDENCE_MAX_CHARS = 6_000;

/**
 * Everything Aria knows, as one compact text for the model that writes the portrait.
 *
 * Capped, and ordered so the most telling evidence survives the cap: the student's own correction
 * first, then their own words, then lessons, then what they know and struggle with.
 */
export function personaEvidence(memory: LearnerMemory, now = Date.now()): string {
  const parts: string[] = [];
  if (memory.persona?.studentNote) parts.push(`THE STUDENT'S OWN DESCRIPTION OF THEMSELVES (authoritative):\n${memory.persona.studentNote}`);
  const excerpts = [...(memory.excerpts ?? [])].reverse().slice(0, 40);
  if (excerpts.length) {
    parts.push(`THEIR OWN WORDS (newest first):\n${excerpts.map((e) => `- [${e.source === "question" ? "asked during" : "said while planning"} "${e.topic}"] ${e.text}`).join("\n")}`);
  }
  const allLessons = memory.lessons ?? [];
  const lessons = [...allLessons].reverse().slice(0, 50);
  if (lessons.length) {
    // Every topic, compactly: the PATTERN of what they choose to learn is the strongest clue to who
    // they are, and a long list of one-liners would push it out of the cap.
    const flag = (l: LessonRecord) => [l.codeExamples ? "code" : "", l.expertise, l.goal].filter(Boolean).join(", ");
    parts.push(`ALL ${allLessons.length} LESSONS THEY CHOSE (newest first; "code" = asked for code examples):\n${lessons.map((l) => `- ${l.topic}${flag(l) ? ` [${flag(l)}]` : ""}`).join("\n")}`);
    const withCode = allLessons.filter((l) => l.codeExamples).length;
    const known = allLessons.filter((l) => l.codeExamples !== undefined).length;
    const watched = allLessons.reduce((sum, l) => sum + l.beatsWatched, 0);
    const habits = [
      known ? `asked for code examples in ${withCode} of ${known} lessons` : "",
      `watched ${watched} lecture parts in total`,
      ...LEARNER_SIGNALS.map((s) => (memory.signals?.[s] ? `${SIGNAL_WORDS[s]} ${memory.signals[s]} time${memory.signals[s] === 1 ? "" : "s"}` : "")),
    ].filter(Boolean);
    parts.push(`HOW THEY BEHAVE IN LECTURES:\n${habits.map((h) => `- ${h}`).join("\n")}`);
  }
  const concepts = Object.values(memory.concepts).map((c) => ({ c, m: effectiveMastery(c, now) }));
  const describe = (list: typeof concepts) =>
    list.slice(0, 40).map(({ c, m }) => `- [${c.key}] ${c.label} (${m.toFixed(2)}; ${c.evidence.map((e) => e.note).slice(-2).join("; ")})`).join("\n");
  const strong = concepts.filter((x) => x.m >= 0.7);
  const settling = concepts.filter((x) => x.m >= 0.3 && x.m < 0.7);
  const weak = concepts.filter((x) => x.m < 0.3);
  if (strong.length) parts.push(`CONCEPTS THEY KNOW:\n${describe(strong)}`);
  if (weak.length) parts.push(`CONCEPTS THEY STRUGGLED WITH OR HAD NOT MET:\n${describe(weak)}`);
  if (settling.length) parts.push(`CONCEPTS COVERED BUT NOT YET CHECKED:\n${describe(settling)}`);
  const misconceptions = memory.misconceptions.filter((m) => !m.resolved);
  if (misconceptions.length) parts.push(`MISCONCEPTIONS SEEN:\n${misconceptions.map((m) => `- ${m.text} (${m.topic})`).join("\n")}`);
  const prefs = [memory.preferences.style && `style: ${memory.preferences.style}`, memory.preferences.background && `background: ${memory.preferences.background}`].filter(Boolean);
  if (prefs.length) parts.push(`PREFERENCES:\n${prefs.join("\n")}`);
  if (memory.goals.length) parts.push(`GOALS:\n${memory.goals.slice(-8).map((g) => `- ${g.objective} (${g.topic})`).join("\n")}`);
  let text = parts.join("\n\n");
  if (text.length > EVIDENCE_MAX_CHARS) text = `${text.slice(0, EVIDENCE_MAX_CHARS - 1)}…`;
  return text;
}

const SIGNAL_WORDS: Record<LearnerSignal, string> = {
  code: "asked to see it as code",
  deeper: "asked to go deeper",
  simpler: "asked for a simpler explanation",
  "more-examples": "asked for more examples",
  question: "asked a question mid-lecture",
};

function strings(value: unknown, cap: number, max = 80): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim().slice(0, max)).slice(0, cap)
    : [];
}

/** Merge several concepts into one, keeping all evidence and the highest mastery. */
function mergeConcepts(memory: LearnerMemory, keys: string[], label: string): void {
  const sources = keys.map((key) => memory.concepts[key]).filter(Boolean);
  if (sources.length === 0) return;
  const target = conceptKey(label);
  if (!target) return;
  const existing = memory.concepts[target];
  const all = existing && !keys.includes(target) ? [...sources, existing] : sources;
  const merged: ConceptMemory = {
    key: target,
    label: label.trim().slice(0, 120),
    mastery: Math.max(...all.map((c) => c.mastery)),
    evidence: all.flatMap((c) => c.evidence).sort((a, b) => a.at.localeCompare(b.at)).slice(-MEMORY_LIMITS.evidencePerConcept),
    lastSeen: all.map((c) => c.lastSeen).sort().at(-1) as string,
    topics: [...new Set(all.flatMap((c) => c.topics))].slice(-8),
  };
  for (const key of keys) delete memory.concepts[key];
  memory.concepts[target] = merged;
}

/**
 * Apply the model's portrait and concept clean-up, trusting none of it.
 *
 * Malformed output changes nothing. The clean-up may only touch concepts that exist; merges keep
 * every piece of evidence and the highest mastery; and a concept the student named, answered a
 * checkpoint on, or set themselves is never dropped — only lecture-title noise can be.
 */
export function applyPersonaResult(memory: LearnerMemory, raw: unknown, now = new Date().toISOString()): LearnerMemory {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || typeof r.summary !== "string" || r.summary.trim().length < 20) return memory;
  const next: LearnerMemory = structuredClone(memory);

  const cleanup = (r.concepts && typeof r.concepts === "object" ? r.concepts : {}) as Record<string, unknown>;
  for (const item of Array.isArray(cleanup.merge) ? cleanup.merge : []) {
    const m = item as { into?: unknown; keys?: unknown };
    if (typeof m.into !== "string") continue;
    const keys = strings(m.keys, 20, 160).filter((key) => next.concepts[key]);
    if (keys.length) mergeConcepts(next, keys, m.into);
  }
  for (const item of Array.isArray(cleanup.rename) ? cleanup.rename : []) {
    const m = item as { key?: unknown; label?: unknown };
    if (typeof m.key === "string" && typeof m.label === "string" && next.concepts[m.key]) mergeConcepts(next, [m.key], m.label);
  }
  for (const key of strings(cleanup.drop, 100, 160)) {
    const concept = next.concepts[key];
    if (concept && concept.evidence.every((e) => e.source === "lecture")) delete next.concepts[key];
  }

  next.persona = {
    summary: r.summary.trim().slice(0, 1200),
    interests: strings(r.interests, 8),
    strengths: strings(r.strengths, 8),
    growthAreas: strings(r.growthAreas, 8),
    learningStyle: typeof r.learningStyle === "string" ? r.learningStyle.trim().slice(0, 300) : "",
    teachingPlan: typeof r.teachingPlan === "string" ? r.teachingPlan.trim().slice(0, 400) : "",
    studentNote: memory.persona?.studentNote ?? null,
    generatedAt: now,
    basedOn: { lessons: (next.lessons ?? []).length, excerpts: (next.excerpts ?? []).length, concepts: Object.keys(next.concepts).length },
  };
  next.updatedAt = now;
  return boundMemory(next);
}

/** True when there is no portrait yet, or something has been learned since it was written. */
export function personaIsStale(memory: LearnerMemory): boolean {
  const hasEvidence = (memory.lessons ?? []).length + (memory.excerpts ?? []).length + Object.keys(memory.concepts).length > 0;
  if (!hasEvidence) return false;
  return !memory.persona || memory.updatedAt > memory.persona.generatedAt;
}

const PERSONA_PROMPT_MAX_CHARS = 900;

/**
 * The portrait as a block for the models that plan and write lectures, or "" when there is none.
 * Framed as background: what the student says in THIS conversation takes precedence.
 */
export function personaForPrompt(memory: LearnerMemory | null | undefined): string {
  const p = memory?.persona;
  if (!p?.summary) return "";
  const lines = [
    "WHAT ARIA KNOWS ABOUT THIS STUDENT FROM EARLIER LESSONS (use it to personalise; where it differs from what they say now, what they say now wins):",
    p.summary,
    p.interests.length ? `Interests: ${p.interests.join(", ")}.` : "",
    p.strengths.length ? `Strong on: ${p.strengths.join(", ")} — build on these, do not re-teach them.` : "",
    p.growthAreas.length ? `Still settling: ${p.growthAreas.join(", ")} — give these extra care.` : "",
    p.teachingPlan ? `How to teach them: ${p.teachingPlan}` : "",
    p.studentNote && p.studentNote !== p.summary ? `In their own words: ${p.studentNote}` : "",
  ].filter(Boolean);
  const text = lines.join("\n");
  return text.length > PERSONA_PROMPT_MAX_CHARS ? `${text.slice(0, PERSONA_PROMPT_MAX_CHARS - 1)}…` : text;
}
