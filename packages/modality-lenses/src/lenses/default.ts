import type { InterruptBranch, LessonNode } from "@aria/lesson-graph";
import type { ModalityLens, RenderedAnnotation, RenderedBeat } from "../contract";

/**
 * The Default lens: sighted, hearing student. Whiteboard + slide, voice narration.
 * This is the baseline lens described in README Section 6's first walkthrough.
 */
export const defaultLens: ModalityLens = {
  id: "default",
  displayName: "Default (visual + audio)",

  renderBeat(node: LessonNode): RenderedBeat {
    return {
      nodeId: node.id,
      narration: [{ text: node.narration }],
      captions: [node.narration],
      drawCommands: node.visual
        ? {
            primitive: node.visual.primitive,
            elements: node.visual.elements,
            relations: node.visual.relations ?? [],
          }
        : undefined,
    };
  },

  renderAnnotation(branch: InterruptBranch): RenderedAnnotation {
    return {
      branchId: branch.id,
      description: branch.annotation?.note ?? `Side note: ${branch.triggerUtterance}`,
    };
  },
};
