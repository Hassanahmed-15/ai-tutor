import "server-only";
import { getNode, type LessonGraph } from "@aria/lesson-graph";
import type { ModalityLens, RenderedBeat, RenderedAnnotation } from "@aria/modality-lenses";

/** API-facing shape: the current beat plus any active interrupt annotation, both already lens-rendered. */
export interface RenderedSessionView {
  graph: LessonGraph;
  currentBeat: RenderedBeat | null;
  activeAnnotation: RenderedAnnotation | null;
}

export function renderSessionView(graph: LessonGraph, lens: ModalityLens): RenderedSessionView {
  const currentNode = graph.currentNodeId ? getNode(graph, graph.currentNodeId) : undefined;
  const openBranch = graph.branches.find(
    (b) => b.parentNodeId === graph.currentNodeId && b.status === "resolved"
  );

  return {
    graph,
    currentBeat: currentNode ? lens.renderBeat(currentNode) : null,
    activeAnnotation: openBranch ? lens.renderAnnotation(openBranch) : null,
  };
}
