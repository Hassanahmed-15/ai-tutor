/**
 * The sentence lectures used to append to the end of a board, with the prediction cycle (removed
 * 2026-10-16 on the owner's direction: "remove this at the end of every slide"). It was spoken on
 * nearly every slide. New plans never carry it (lib/canvas/plan.ts); the voice drops it from
 * lectures made before (lib/voice.ts splitNarrationSentences). Pure and dependency-free, so the
 * voice can use it without pulling in the planner.
 */
export const OLD_TRANSFER_PROMPT = "Now try the same reasoning on a new example of your own, and explain what changes.";

export function withoutOldTransferPrompt(script: string): string {
  return script.includes(OLD_TRANSFER_PROMPT) ? script.split(OLD_TRANSFER_PROMPT).join("").replace(/\s{2,}/g, " ").trim() : script;
}
