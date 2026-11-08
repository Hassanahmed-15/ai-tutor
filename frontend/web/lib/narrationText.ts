/**
 * THE SENTENCES ARIA SAYS, decided in one place for the browser and the server.
 *
 * Narration is made one clip per sentence (lib/voice.ts), and since 2026-11-07 the worker makes each
 * board's clips ahead of time and stores them (lib/narrationAudio.ts). A stored clip is found by its
 * exact text, so the worker and the player must split a script into exactly the same sentences: both
 * call this. Pure — no DOM, no audio — so the worker can import it.
 */
import { withoutSourceTags } from "./webSources";
import { withoutOldTransferPrompt } from "./canvas/oldTransferPrompt";

export function splitNarrationSentences(text: string): string[] {
  // A lecture written before 2026-10-16 may end its scripts with "Sources: [S1], [S2]." or with the
  // old "Now try the same reasoning…" sentence — neither is said.
  return withoutOldTransferPrompt(withoutSourceTags(text)).split(/(?<=[.!?۔؟])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
}

/** The text one clip is made from and stored under — the same rule /api/tts applies to what it is sent. */
export function narrationInput(text: string): string {
  return text.trim().slice(0, 4000);
}

/** What Aria says when a check card is answered right, one picked at random (components/canvas/LessonCanvas.tsx). */
export const CHECK_PRAISE = ["That's right — well done!", "Correct — nice work!", "Exactly right. Great job!", "Yes, that's it — well done!"];

/**
 * EVERY SENTENCE A BOARD SAYS ON ITS OWN, as the player sends it: the script, the check card's question
 * (spoken when the card opens), each wrong answer's feedback and the praise for a right one. Lines only
 * a click or a tap brings (a hint, a replay, a picture part) are made the first time they are asked for.
 */
export function boardSpokenSentences(beat: { script?: string; draw?: { ops?: Array<{ kind?: string; spec?: unknown }> } }): string[] {
  const spec = beat.draw?.ops?.find((op) => op.kind === "canvasBoard")?.spec as { interaction?: { kind?: string; question?: string; options?: Array<{ correct?: boolean; feedback?: string }> } } | undefined;
  const card = spec?.interaction?.kind === "quiz" ? spec.interaction : undefined;
  const lines = [
    beat.script ?? "",
    ...(card ? [card.question ?? "", ...(card.options ?? []).filter((o) => !o.correct).map((o) => o.feedback ?? ""), ...CHECK_PRAISE] : []),
  ];
  return [...new Set(lines.flatMap(splitNarrationSentences))];
}
