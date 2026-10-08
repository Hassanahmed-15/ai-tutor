/**
 * THE PEN'S TIP, IN PAGE PIXELS. The board sandbox reports where its pen is writing (a fraction of its
 * own viewport); ReactAnimationSandbox maps that through the iframe's box and re-dispatches it on the
 * window under this name. The classroom teacher's hand follows it. `on: false` once the pen rests.
 */
export const PEN_TIP_EVENT = "aria:pen-tip";

export type PenTip = { on: true; x: number; y: number } | { on: false };

/**
 * THE TEACHER'S HOLD ON THE PEN. A real teacher's writing waits for the teacher: while Aria walks to
 * the board, or steps along a line, she asks the board to hold its pen (the same pause a student's
 * Pause uses) and lets it go once her marker is on the tip. Window event, `detail: boolean`.
 */
export const PEN_HOLD_EVENT = "aria:pen-hold";

/**
 * THE TEACHER IS IN THE ROOM. While she is, the board's own floating pen icon stays hidden: her hand
 * and her marker are the pen. A module flag for boards mounted later, plus an event for the ones on
 * screen when she arrives or leaves.
 */
export const TEACHER_PRESENT_EVENT = "aria:teacher-present";
let teacherPresent = false;
export function isTeacherPresent(): boolean {
  return teacherPresent;
}
export function setTeacherPresent(on: boolean): void {
  if (teacherPresent === on) return;
  teacherPresent = on;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(TEACHER_PRESENT_EVENT, { detail: on }));
}
