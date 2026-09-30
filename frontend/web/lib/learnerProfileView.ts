import type { LearnerBasics, LearnerOption } from "./db/cosmos";
import type { ConceptMemory, LearnerMemory } from "./learnerModel";
import { subjectForTopic } from "./education";

/**
 * THE LEARNER PROFILE AS IT STANDS — the basics the student gave (onboarding screen 1) joined with
 * what Aria has learned about them since (lib/learnerModel.ts), subject by subject.
 *
 * The owner's spec (2026-09-29) lists what it grows into: study level and curriculum per subject,
 * typical lesson duration, strong and weak areas, preferred explanation, current topics, mastered,
 * needs review. None of that is asked for: it is DERIVED from the memory every lesson already
 * updates, so it evolves with every interaction and is never out of step with it. Settings shows it
 * and lets the student correct it (the memory's own edits); the lesson writers read it through
 * `learnerContextForPrompt`.
 *
 * Pure: unit-tested in lib/anim/learnerProfileView.test.ts.
 */

const MASTERED = 0.85;
const STRONG = 0.65;
const WEAK = 0.4;
const STALE_DAYS = 30;
const CURRENT_DAYS = 14;
/** A lesson beat is about 45 seconds of narration and board. */
const MINUTES_PER_BEAT = 0.75;

export type SubjectProfile = {
  subject: LearnerOption | null;
  studyLevel: LearnerOption | null;
  strong: ConceptMemory[];
  weak: string[];
  mastered: ConceptMemory[];
  needsReview: ConceptMemory[];
  weakConcepts: ConceptMemory[];
  currentTopics: string[];
};

export type LearnerProfileView = {
  basics: LearnerBasics | null;
  subjects: SubjectProfile[];
  currentTopics: string[];
  /** "10–15 minutes", from the lessons actually watched; null before there are any. */
  typicalLessonDuration: string | null;
  /** "Visual boards + worked examples" — what their behaviour says works, or what they told Aria. */
  preferredExplanation: string | null;
};

const daysAgo = (iso: string, now: number) => (now - Date.parse(iso)) / 86_400_000;

function subjectOf(text: string, basics: LearnerBasics | null): LearnerOption | null {
  const subjects = basics?.subjects ?? [];
  if (subjects.length === 0) return null;
  return subjectForTopic(text, subjects) ?? (subjects.length === 1 ? subjects[0] : null);
}

export function typicalLessonDuration(memory: LearnerMemory | null | undefined): string | null {
  const beats = (memory?.lessons ?? []).map((l) => l.beatsWatched).filter((n) => n > 0).sort((a, b) => a - b);
  if (beats.length === 0) return null;
  const median = beats[Math.floor(beats.length / 2)];
  const minutes = median * MINUTES_PER_BEAT;
  if (minutes < 5) return "under 5 minutes";
  const low = Math.floor(minutes / 5) * 5;
  return `${low}–${low + 5} minutes`;
}

export function preferredExplanation(memory: LearnerMemory | null | undefined): string | null {
  if (memory?.preferences.style) return memory.preferences.style;
  const s = memory?.signals ?? {};
  const parts: Array<[number, string]> = [
    [s["more-examples"] ?? 0, "worked examples"],
    [s.code ?? 0, "code examples"],
    [s.deeper ?? 0, "in-depth explanations"],
    [s.simpler ?? 0, "simple, step-by-step explanations"],
  ];
  const liked = parts.filter(([n]) => n > 0).sort((a, b) => b[0] - a[0]).slice(0, 2).map(([, label]) => label);
  if (liked.length === 0) return (memory?.lessons.length ?? 0) > 0 ? "Visual boards" : null;
  return ["Visual boards", ...liked].join(" + ");
}

export function learnerProfileView(basics: LearnerBasics | null | undefined, memory: LearnerMemory | null | undefined, now = Date.now()): LearnerProfileView {
  const b = basics ?? null;
  const bySubject = new Map<string, SubjectProfile>();
  const slot = (subject: LearnerOption | null): SubjectProfile => {
    const key = subject?.id ?? "__other";
    let entry = bySubject.get(key);
    if (!entry) {
      entry = {
        subject,
        studyLevel: (subject && b?.subjectLevels?.[subject.id]) ?? b?.studyLevel ?? null,
        strong: [], weak: [], mastered: [], needsReview: [], weakConcepts: [], currentTopics: [],
      };
      bySubject.set(key, entry);
    }
    return entry;
  };
  // Every chosen subject has a card, even before a lesson in it.
  for (const subject of b?.subjects ?? []) slot(subject);

  for (const concept of Object.values(memory?.concepts ?? {})) {
    const entry = slot(subjectOf(`${concept.label} ${concept.topics.join(" ")}`, b));
    const stale = daysAgo(concept.lastSeen, now) > STALE_DAYS;
    if (concept.mastery >= MASTERED && !stale) entry.mastered.push(concept);
    else if (concept.mastery >= STRONG && !stale) entry.strong.push(concept);
    else if (concept.mastery < WEAK) entry.weakConcepts.push(concept);
    else entry.needsReview.push(concept);
  }
  for (const m of memory?.misconceptions ?? []) {
    if (m.resolved) continue;
    slot(subjectOf(`${m.text} ${m.topic}`, b)).weak.push(m.text);
  }

  const recent = (memory?.lessons ?? [])
    .filter((l) => daysAgo(l.at, now) <= CURRENT_DAYS)
    .sort((a, c) => Date.parse(c.at) - Date.parse(a.at));
  const currentTopics: string[] = [];
  for (const lesson of recent) {
    if (currentTopics.some((t) => t.toLowerCase() === lesson.topic.toLowerCase())) continue;
    currentTopics.push(lesson.topic);
    const entry = slot(subjectOf(lesson.topic, b));
    if (!entry.currentTopics.includes(lesson.topic)) entry.currentTopics.push(lesson.topic);
    if (currentTopics.length >= 6) break;
  }

  const byMastery = (a: ConceptMemory, c: ConceptMemory) => c.mastery - a.mastery;
  const subjects = [...bySubject.values()]
    .map((s) => ({
      ...s,
      mastered: s.mastered.sort(byMastery).slice(0, 8),
      strong: s.strong.sort(byMastery).slice(0, 8),
      needsReview: s.needsReview.sort(byMastery).slice(0, 8),
      weakConcepts: s.weakConcepts.sort((a, c) => a.mastery - c.mastery).slice(0, 8),
      weak: s.weak.slice(0, 6),
    }))
    .filter((s) => s.subject || s.mastered.length + s.strong.length + s.needsReview.length + s.weakConcepts.length + s.weak.length + s.currentTopics.length > 0);

  return { basics: b, subjects, currentTopics, typicalLessonDuration: typicalLessonDuration(memory), preferredExplanation: preferredExplanation(memory) };
}

/**
 * The profile, as a few lines for the models that plan questions, draft outlines, write scripts and
 * brief boards. Background only — the student's words in a request always win — so the lesson's
 * terms, examples and level fit their country, curriculum and subjects, and what they have already
 * mastered is not re-taught while what they are weak on gets care.
 */
export function learnerContextForPrompt(view: LearnerProfileView): string {
  const b = view.basics;
  if (!b && view.subjects.length === 0) return "";
  const lines: string[] = ["THE STUDENT'S PROFILE (background — their own request always wins):"];
  if (b?.country) lines.push(`Studies in: ${countryLabel(b.country)}.`);
  if (b?.studyLevel) lines.push(`Study level: ${b.studyLevel.label}.`);
  if (b?.curricula.length) lines.push(`Curriculum / exam / track: ${b.curricula.map((c) => c.label).join(", ")} — use its terminology, notation and style of question.`);
  if (b?.subjects.length) lines.push(`Subjects: ${b.subjects.map((s) => s.label).join(", ")}.`);
  for (const s of view.subjects) {
    const name = s.subject?.label ?? "Other topics";
    const bits = [
      s.studyLevel && s.subject && b?.subjectLevels?.[s.subject.id] ? `level ${s.studyLevel.label}` : "",
      s.mastered.length ? `mastered ${s.mastered.slice(0, 4).map((c) => c.label).join(", ")}` : "",
      s.strong.length ? `strong on ${s.strong.slice(0, 4).map((c) => c.label).join(", ")}` : "",
      s.weakConcepts.length ? `weak on ${s.weakConcepts.slice(0, 4).map((c) => c.label).join(", ")}` : "",
      s.needsReview.length ? `needs review: ${s.needsReview.slice(0, 3).map((c) => c.label).join(", ")}` : "",
      s.weak.length ? `misconceptions to correct: ${s.weak.slice(0, 2).join("; ")}` : "",
    ].filter(Boolean);
    if (bits.length) lines.push(`${name}: ${bits.join("; ")}.`);
  }
  if (view.currentTopics.length) lines.push(`Currently studying: ${view.currentTopics.slice(0, 4).join(", ")}.`);
  if (view.preferredExplanation) lines.push(`Learns best with: ${view.preferredExplanation}.`);
  return lines.join("\n");
}

function countryLabel(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
