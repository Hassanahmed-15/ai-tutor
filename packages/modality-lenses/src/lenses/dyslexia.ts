import type { InterruptBranch, LessonNode } from "@aria/lesson-graph";
import type { ModalityLens, NarrationUnit, RenderedAnnotation, RenderedBeat } from "../contract";

/**
 * Splits narration into short clauses so the renderer can highlight word-by-word /
 * clause-by-clause in sync with TTS (README 3.2: "word-by-word TTS highlighting synced to speech").
 * This is a simple punctuation-based split — good enough for MVP; a real sentence
 * simplifier (shorter clauses, simpler vocabulary) is Phase 1 work, not faked here.
 */
function splitIntoClauses(text: string): NarrationUnit[] {
  return text
    .split(/(?<=[,.;:])\s+/)
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => ({ text: chunk.trim() }));
}

/**
 * The Dyslexia lens: same content as Default, but narration is chunked for sync
 * highlighting and the render output flags typography preferences the UI must honor
 * (README 3.2: adjustable font incl. OpenDyslexic, spacing, line length).
 */
export const dyslexiaLens: ModalityLens = {
  id: "dyslexia",
  displayName: "Dyslexia-friendly (chunked text + TTS sync)",

  renderBeat(node: LessonNode): RenderedBeat {
    return {
      nodeId: node.id,
      narration: splitIntoClauses(node.narration),
      captions: [node.narration],
      drawCommands: node.visual
        ? {
            primitive: node.visual.primitive,
            elements: node.visual.elements,
            relations: node.visual.relations ?? [],
          }
        : undefined,
      // Slightly slower default pacing reduces reading/listening mismatch (README 3.2).
      pacingMultiplier: 0.85,
    };
  },

  renderAnnotation(branch: InterruptBranch): RenderedAnnotation {
    return {
      branchId: branch.id,
      description: branch.annotation?.note ?? `Side note: ${branch.triggerUtterance}`,
    };
  },
};
