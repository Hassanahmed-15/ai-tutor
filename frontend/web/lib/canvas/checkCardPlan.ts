import type { CanvasBoardSpec, CanvasPlanBeat } from "./types";

/**
 * HOW OFTEN A "CHECK IT" CARD APPEARS (owner's direction, 2026-10-16: "ask questions but not at the
 * end of each slide … their freq should be less"). A card on every board turned the lecture into a
 * quiz; now it is about every third board, at most three in a lecture, never in a lecture of one or
 * two boards, and never in a strict PDF lesson, which reads the document straight through.
 *
 * Pure and client-safe: the worker uses it to decide which boards get a card written
 * (lib/canvas/progressive.ts), and the player uses the same spacing on lectures made before.
 */
export const CHECK_CARD_EVERY = 3;
export const CHECK_CARDS_MAX = 3;

/** A board a check card can follow: a teaching board, not a refresher, a recap overview or an exam. */
function teaches(beat: CanvasPlanBeat): boolean {
  // A card's close-up (lib/canvas/cardDives.ts) is part of its board: the count and the cards skip it.
  return !beat.refresher && !beat.overview && beat.stage !== "exam" && !beat.dive;
}

/**
 * The plan indices of the boards that get a card. Counted over teaching boards only: the 3rd, then
 * every 3rd after it. A board that already has a hands-on task (a slider, a drawing) is an activity
 * of its own — it gets no card and the count starts again after it, so activities stay spaced.
 */
/** Two or more hands-on tasks in a lesson: a board picked for a question card trades its task for it. */
export function tasksGiveWay(plan: CanvasPlanBeat[]): boolean {
  return plan.filter((beat) => teaches(beat) && (beat.interaction === "try" || beat.interaction === "draw")).length >= 2;
}

/**
 * HOW MANY QUESTIONS THE STUDENT ASKED FOR (QA brief, 2026-11-28: "A few" gave a lesson no question at all).
 * None = no card; "A few"/"some" = one about every 3 boards, however long the lesson; "Lots" = one about
 * every 2 boards. Not asked: the old default, every third board and at most three.
 */
export function practiceSpacing(practice: "none" | "some" | "lots" | undefined, teachingBoards: number): { every: number; most: number } {
  if (practice === "none") return { every: Infinity, most: 0 };
  if (practice === "lots") return { every: 2, most: Math.max(1, Math.floor(teachingBoards / 2)) };
  if (practice === "some") return { every: CHECK_CARD_EVERY, most: Math.max(1, Math.floor(teachingBoards / CHECK_CARD_EVERY)) };
  return { every: CHECK_CARD_EVERY, most: CHECK_CARDS_MAX };
}

export function checkCardBoards(plan: CanvasPlanBeat[], strict: boolean, practice?: "none" | "some" | "lots"): Set<number> {
  const picked = new Set<number>();
  // The student said how much checking they want on the question card (lib/teachingQuestions.ts).
  if (strict || practice === "none") return picked;
  const teaching = plan.map((beat, index) => ({ beat, index })).filter(({ beat }) => teaches(beat));
  const { every, most } = practiceSpacing(practice, teaching.length);
  if (teaching.length < every) return picked;
  // A lesson with two or more hands-on tasks still gets its questions: a slider on every board left a
  // water-cycle lesson, and a course lesson, with no question at all (2026-10-18 test). There the card
  // takes the board's place in the count and replaces that board's task (lib/canvas/progressive.ts).
  const yields = tasksGiveWay(plan);
  let since = 0;
  for (const { beat, index } of teaching) {
    since += 1;
    if (!yields && (beat.interaction === "try" || beat.interaction === "draw")) {
      since = 0;
      continue;
    }
    if (since >= every && picked.size < most) {
      picked.add(index);
      since = 0;
    }
  }
  return picked;
}

const isCheckCard = (spec: CanvasBoardSpec) => spec.interaction?.kind === "quiz" && Boolean(spec.interaction.check);

/**
 * The same spacing over boards already written — a lecture made while every board had a card shows
 * at most three, at least two boards apart. A lecture made under checkCardBoards is left as it is: its
 * cards were placed for the student's own Practice answer (one every 2 boards for "Lots"), and spacing
 * them again threw half of them away (QA 2026-11-28). Such a lecture never has cards on two boards in a row.
 */
export function spaceCheckCards<P extends { spec: CanvasBoardSpec }>(panels: P[]): P[] {
  const adjacent = panels.some((p, i) => i > 0 && isCheckCard(p.spec) && isCheckCard(panels[i - 1].spec));
  if (!adjacent) return panels;
  let kept = 0;
  let since = 0;
  // As checkCardBoards: in a lesson of many hands-on tasks, a task does not restart the count.
  const yields = panels.filter((p) => p.spec.interaction?.kind === "try" || p.spec.interaction?.kind === "draw").length >= 2;
  return panels.map((panel) => {
    since += 1;
    const kind = panel.spec.interaction?.kind;
    if (kind === "try" || kind === "draw") {
      if (!yields) since = 0;
      return panel;
    }
    if (!isCheckCard(panel.spec)) return panel;
    if (since >= CHECK_CARD_EVERY && kept < CHECK_CARDS_MAX) {
      kept += 1;
      since = 0;
      return panel;
    }
    const { interaction, ...rest } = panel.spec;
    void interaction;
    return { ...panel, spec: rest };
  });
}
