/**
 * A one-shot handoff between the front page and the lesson builder.
 *
 * The app routes by swapping components on a `PageName`, not by URL, so there is no query string
 * or route param to carry a brief through. A topic could travel via sessionStorage, but a `File`
 * cannot be serialised — and asking the student to pick the same file twice because of an
 * implementation detail is not acceptable.
 *
 * So the file is held in a module variable for the moment between "chosen on the front page" and
 * "read by the builder". Deliberately consumed on read (`take`), so a later visit to the builder
 * cannot pick up a stale document from a lesson the student has already moved on from.
 *
 * This is not state anyone should subscribe to. It exists for exactly one hop.
 */
export type PendingBrief = {
  topic: string;
  file: File | null;
};

let pending: PendingBrief | null = null;

export function setPendingBrief(brief: PendingBrief): void {
  pending = brief;
}

/** Returns the pending brief and clears it. Null when there is nothing waiting. */
export function takePendingBrief(): PendingBrief | null {
  const held = pending;
  pending = null;
  return held;
}
