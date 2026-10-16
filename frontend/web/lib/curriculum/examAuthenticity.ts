import type { CanvasPlanBeat } from "../canvas/types";

/**
 * Phase 4 exam authenticity WITHOUT downloading publisher mark schemes. Official outcomes already
 * in the curriculum tree carry Cambridge command words (state, describe, explain, calculate…).
 * A lecture is exam-ready when those verbs appear as the exam asks them, especially on the last
 * teaching board's transfer.
 */
export const SYLLABUS_COMMANDS = /\b(state|describe|explain|outline|define|calculate|determine|show that|suggest|predict|deduce|compare|discuss|evaluate|assess|sketch|plot|label)\b/gi;

export function commandWordsOf(outcomes: string[]): string[] {
  const found: string[] = [];
  for (const outcome of outcomes) {
    for (const m of outcome.matchAll(SYLLABUS_COMMANDS)) found.push(m[1].toLowerCase());
  }
  return [...new Set(found)];
}

export function examAuthenticityIssues(outcomes: string[], beats: CanvasPlanBeat[]): string[] {
  const words = commandWordsOf(outcomes);
  if (!words.length) return [];
  const scripts = beats.map((b) => `${b.title} ${b.script}`).join(" ");
  const issues: string[] = [];
  const missing = words.filter((w) => !new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(scripts));
  if (missing.length) issues.push(`syllabus command word(s) never used as the exam asks them: ${missing.join(", ")}`);
  const last = [...beats].reverse().find((b) => !b.overview && !b.refresher);
  if (last && !words.some((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(last.script))) {
    issues.push("the last teaching board's transfer is not phrased with a syllabus command word");
  }
  return issues;
}

export function examReadinessScore(outcomes: string[], beats: CanvasPlanBeat[]): number {
  const words = commandWordsOf(outcomes);
  const scripts = beats.map((b) => b.script).join(" ");
  const anyExam = /\b(state|describe|explain|calculate|suggest|predict|deduce|outline|define)\b/i.test(scripts);
  if (!words.length) return anyExam ? 10 : 8;
  const used = words.filter((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(scripts)).length;
  const lastOk = examAuthenticityIssues(outcomes, beats).every((i) => !/last teaching board/.test(i));
  if (!used && !anyExam) return 7;
  return Math.max(8, Math.min(10, Math.round(8 + (used / words.length) + (lastOk ? 1 : 0))));
}
