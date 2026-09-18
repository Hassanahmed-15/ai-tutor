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
 * The instruction handed to both the outline planner and the lecture writer.
 *
 * Written as a directive, not a data dump — same reasoning as learnerInstruction (learnerProfile.ts):
 * a model told "the source is the only permitted material" acts on it; one handed a bare
 * `{"fidelity":"strict"}` has to infer what that means and often doesn't.
 */
export function sourceScopeInstruction(scope: SourceScope): string {
  const fidelityLine =
    scope.fidelity === "strict"
      ? "STRICTLY FROM SOURCE. Teach only what the uploaded material actually contains. Do not add " +
        "outside facts, outside examples, or outside context that is not present in the source — if " +
        "something is not in the material, do not teach it. You may clarify or rephrase what IS there, " +
        "but never supplement it with general knowledge about the subject."
      : "SOURCE AS REFERENCE. Use the uploaded material as the foundation, but freely expand with " +
        "outside knowledge, additional examples, and context that helps teaching — the source anchors " +
        "the lesson, it does not fence it in.";

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
