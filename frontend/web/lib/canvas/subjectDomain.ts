/**
 * WHICH SUBJECT A TYPED LESSON IS — ASKED, NOT GUESSED (owner, 2026-10-24: "make an api call with the
 * prompt as input and see whether these are CS or math topic or none; for none keep the normal
 * pipeline, for math apply math rules and for CS apply CS rules"). Keyword lists missed whole fields
 * ("what is off policy and how importance sampling is done in such algo" matched nothing: "algo" is
 * not "algorithm") and caught impostors ("stacks" in coastal erosion).
 *
 * The answer is asked once, when a typed lesson is planned and created (lib/canvas/subjectClassifier.ts),
 * and kept on the lecture as `subjectDomain`. Every rule that asked "is this CS / maths?" of a typed
 * lesson reads it here; without an answer (an older lecture, a failed call) the keyword checks decide as
 * before. PDF, video and course lessons never carry one.
 */
import { isLabLookTopic } from "./subjectLook";
import { isMathsTopic } from "./predictCard";
import { isTypedCsTopic } from "./csLessons";

export type SubjectDomain = "cs" | "maths" | "none";

export function isSubjectDomain(value: unknown): value is SubjectDomain {
  return value === "cs" || value === "maths" || value === "none";
}

/** A computer-science lesson: the asked answer, else the typed-prompt keyword check. */
export function domainIsCs(domain: SubjectDomain | undefined, text: string): boolean {
  return domain ? domain === "cs" : isTypedCsTopic(text);
}

/** A maths lesson: the asked answer, else the maths keyword check. */
export function domainIsMaths(domain: SubjectDomain | undefined, text: string): boolean {
  return domain ? domain === "maths" : isMathsTopic(text);
}

/**
 * Taught the maths/CS way (structured teaching, working step by step, the marker): either subject.
 * MATHS RUNS AS ON THE PARENT BRANCH (owner, 2026-10-25: "i want prev math lec pipeline as in the parent
 * branch"): only a "cs" answer counts here; anything else is the keyword check visual-clarity-labels used.
 */
export function domainIsLab(domain: SubjectDomain | undefined, text: string): boolean {
  return domain === "cs" || isLabLookTopic(text);
}

/** The keyword answer, for when the call cannot be made or fails. */
export function keywordDomain(text: string): SubjectDomain {
  if (isTypedCsTopic(text)) return "cs";
  if (isMathsTopic(text)) return "maths";
  return "none";
}
