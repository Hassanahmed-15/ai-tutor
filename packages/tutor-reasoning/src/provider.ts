import type { LessonGraph, LessonNode } from "@aria/lesson-graph";

/**
 * Tutor Reasoning provider abstraction (README 5.2: "build against an abstraction
 * layer so real provider calls can be dropped in once keys exist"). No vendor SDK is
 * imported here — only this interface. apps/web picks a concrete implementation
 * (currently only the mock one exists) via env config, so adding a real LLM later is
 * "implement this interface," not "rewrite the app."
 */
export interface TutorReasoningProvider {
  /** Generates the initial sequence of teaching beats for a topic, text-first (README 8 Phase 0). */
  planLesson(input: { subject: string; topic: string }): Promise<LessonNode[]>;

  /**
   * Generates the resolution beat(s) for a student interrupt (README 4.2 step 4).
   * Receives the node that was interrupted and the student's utterance so the answer
   * can stay anchored to what was being taught.
   */
  resolveInterrupt(input: {
    interruptedNode: LessonNode;
    studentUtterance: string;
  }): Promise<LessonNode[]>;

  /** Scores a checkpoint response so the Confusion Radar (README 4.3) has a signal to act on. */
  evaluateCheckpointResponse(input: {
    node: LessonNode;
    studentResponse: string;
  }): Promise<{ understood: boolean; feedback: string }>;
}

/** Thrown by providers that are declared but not wired to a real backend yet — keeps failures honest instead of silent. */
export class ProviderNotConfiguredError extends Error {}
