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
  return !beat.refresher && !beat.overview && beat.stage !== "exam";
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

export function checkCardBoards(plan: CanvasPlanBeat[], strict: boolean): Set<number> {
  const picked = new Set<number>();
  if (strict) return picked;
  const teaching = plan.map((beat, index) => ({ beat, index })).filter(({ beat }) => teaches(beat));
  if (teaching.length < CHECK_CARD_EVERY) return picked;
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
    if (since >= CHECK_CARD_EVERY && picked.size < CHECK_CARDS_MAX) {
      picked.add(index);
      since = 0;
    }
  }
  return picked;
}

const isCheckCard = (spec: CanvasBoardSpec) => spec.interaction?.kind === "quiz" && Boolean(spec.interaction.check);

/**
 * The same spacing over boards already written — a lecture made while every board had a card shows
 * at most three, at least two boards apart. A lecture made under checkCardBoards is left as it is.
 */
export function spaceCheckCards<P extends { spec: CanvasBoardSpec }>(panels: P[]): P[] {
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
