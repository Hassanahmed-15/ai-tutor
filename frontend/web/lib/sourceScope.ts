/**
 * How much of an uploaded source to teach, and how tightly to stick to it.
 *
 * TWO SEPARATE AXES. "Breadth" (whole document / one section / one specific question) already
 * existed as an unlabeled ad-hoc decision in lib/documentLessonPlanning.ts. "Fidelity" — whether
 * the lecture may reach past the uploaded material for outside facts, examples and context, or
 * must stay strictly inside it — did not exist at all. They are independent: a student can want
 * the whole document taught strictly, or one section taught expansively. Keeping them as two
 * fields (rather than folding fidelity into breadth's cases) is what lets each be asked, answered
 * and changed independently.
 *
 * WHY THIS TRAVELS AS ITS OWN FIELD, NOT FOLDED INTO mood. Fidelity is a hard content constraint —
 * "do not invent facts not in the source" is closer in kind to the outline's own "do not invent,
 * drop or reorder a subtopic" (see outlineGroundingInstruction in lib/planPrompt.ts) than to a
 * style preference. mood already carries four concatenated concerns by the time it reaches
 * generation; a correctness constraint deserves the same unambiguous, dedicated treatment the
 * outline gets rather than becoming a fifth clause buried in a long free-text string.
 */

export type PdfFidelity = "strict" | "reference";

export type DocumentBreadth =
  | { kind: "whole" }
  | { kind: "section"; focus: string }
  | { kind: "question"; focus: string };

export type SourceScope = {
  breadth: DocumentBreadth;
  fidelity: PdfFidelity;
  /** Only populated when more than one file was uploaded together. */
  documentLabels: string[];
};

/** The default when nothing has been asked yet, or when a topic has no upload at all: the whole
 *  source, used generously — matches today's existing (unlabeled) behavior exactly, so a lesson
 *  built before this field existed and one built with it defaulted-and-unasked behave the same. */
export function emptySourceScope(): SourceScope {
  return { breadth: { kind: "whole" }, fidelity: "reference", documentLabels: [] };
}

/**
 * Accept a source-scope value at an API boundary without trusting arbitrary client JSON.
 *
 * Both lecture routes use this helper. Keeping the parser here prevents the synchronous and
 * progressive generation paths from drifting — that drift previously made the progressive path
 * silently discard a student's "strictly from the source" choice.
 */
export function sanitizeSourceScope(value: unknown): SourceScope | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const rawBreadth = raw.breadth && typeof raw.breadth === "object"
    ? raw.breadth as Record<string, unknown>
    : null;
  const focus = typeof rawBreadth?.focus === "string" ? rawBreadth.focus.trim().slice(0, 240) : "";
  const breadth: DocumentBreadth =
    (rawBreadth?.kind === "section" || rawBreadth?.kind === "question") && focus
      ? { kind: rawBreadth.kind, focus }
      : { kind: "whole" };
  const labels = Array.isArray(raw.documentLabels)
    ? raw.documentLabels
        .filter((label): label is string => typeof label === "string" && Boolean(label.trim()))
        .map((label) => label.trim().slice(0, 120))
        .slice(0, 8)
    : [];
  return {
    breadth,
    fidelity: raw.fidelity === "strict" ? "strict" : "reference",
    documentLabels: labels,
  };
}

/** True when the student chose "strictly from the source": nothing may be taught that it does not contain. */
export function isStrictSource(scope: SourceScope | null | undefined): boolean {
  return scope?.fidelity === "strict";
}

/**
 * The strict contract, word for word, wherever a model writes for a strict lesson.
 *
 * "Strictly from the source means strictly from the source, not from outside." An earlier edit
 * allowed "clearly labelled explanatory examples or analogies", and the model took the allowance:
 * a strict lesson on a textbook's "Energy transfer" paragraph added a leaf-as-solar-panel analogy,
 * steps the page never states, and board labels from general knowledge. An illustration that is not
 * in the source is still content that is not in the source. So the line is drawn where the student
 * drew it — nothing the source does not say, not even a true thing — and what the model MAY do is
 * spelled out, because "do not add" alone tempts padding to a word count: a shorter board is correct.
 */
export const STRICT_SOURCE_RULE =
  "STRICTLY FROM SOURCE. The selected source blocks — their text, their printed figure labels and " +
  "captions — are the ONLY permitted material. Teach every selected block completely and in source " +
  "order; never skip a definition, formula, table, figure, relationship or claim it states. Do not " +
  "add any fact, number, name, example, analogy, application, history, cause, consequence or process " +
  "step that the source does not state — not even a true one, not even as an illustration, and not " +
  "from the attached page images beyond this board's own blocks. You may reorder for clarity, rephrase " +
  "in plain words using the source's own terms, say what a source term means using other words from " +
  "the source, and point the student at the labelled parts of the source's figure. If the source does " +
  "not say it, do not say it: a shorter board is correct. EXPLAIN, DO NOT READ ALOUD: teach it like a " +
  "teacher, in plain, simple words — say what each part means and how the pieces connect. Everyday " +
  "explaining words are fine; what must come ONLY from the source is the CONTENT: every fact, technical " +
  "term, name, number, cause and example. A sentence that adds content the source does not have is " +
  "deleted before the student hears it. TEACH THE CONTENT, NOT THE DOCUMENT: never say where something " +
  "is or what a part of the document does, with no \"this section discusses\", \"this board explains\", \"this part covers\", \"the " +
  "source says\", \"the paper states\", \"on page 3\" or \"next it turns to\". Say the idea itself; the student " +
  "already sees the passage highlighted on their PDF.";

/**
 * The instruction handed to both the outline planner and the lecture writer.
 *
 * Written as a directive, not a data dump — same reasoning as learnerInstruction (learnerProfile.ts):
 * a model told "the source is the only permitted material" acts on it; one handed a bare
 * `{"fidelity":"strict"}` has to infer what that means and often doesn't.
 */
export function sourceScopeInstruction(scope: SourceScope): string {
  const fidelityLine =
    scope.fidelity === "strict"
      ? STRICT_SOURCE_RULE
      : "SOURCE AS REFERENCE. Use the uploaded material as the foundation, but freely expand with " +
        "outside knowledge, additional examples, and context that helps teaching — the source anchors " +
        "the lesson, it does not fence it in. Teach the idea, not the page: reorder, condense or skip " +
        "what the document says when that teaches better. What you do take from it, teach faithfully " +
        "(its terms, its figures, its code). For a programming topic, show and explain the code — the " +
        "document's own code where it has it, otherwise a short, correct implementation of your own, " +
        "walked through step by step. " +
        // Attribution is IMPLICIT — woven into what she says, never a label. The student wants to know
        // what came from their document without being told "SOURCE:" at every turn.
        "When a point comes from the student's document, say so naturally in passing — 'your notes put " +
        "it as…', 'the figure in your document shows…'. When you go beyond it, signal that just as " +
        "lightly — 'this isn't in your document, but it helps…'. Never label, badge or announce sources; " +
        "a phrase inside the sentence is all it takes.";

  const breadthLine =
    scope.breadth.kind === "whole"
      ? "Cover the complete selected source."
      : `Cover only: ${scope.breadth.focus}.`;

  const docsLine =
    scope.documentLabels.length > 1
      ? `\nMULTIPLE SOURCES WERE PROVIDED (${scope.documentLabels.join(", ")}). Reason across all of ` +
        "them together as one body of material — cross-reference where they overlap, note where they " +
        "disagree, and do not treat them as unrelated documents."
      : "";

  return `\n\nSOURCE SCOPE.\n${fidelityLine}\n${breadthLine}${docsLine}`;
}
