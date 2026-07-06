import type { InterruptBranch, LessonGraph, LessonNode } from "./types";

let counter = 0;
/** Deterministic-enough id generator; swap for a real uuid lib when persistence lands. */
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter}`;
}

export function createLessonGraph(subject: string, topic: string): LessonGraph {
  return {
    id: nextId("lesson"),
    subject,
    topic,
    createdAt: new Date().toISOString(),
    nodes: [],
    branches: [],
    currentNodeId: null,
  };
}

/** Appends a teaching beat to the main sequence and makes it current. Append-only, per README 5.1. */
export function appendNode(graph: LessonGraph, node: LessonNode): LessonGraph {
  return {
    ...graph,
    nodes: [...graph.nodes, node],
    currentNodeId: node.id,
  };
}

/**
 * Opens an interrupt branch off the current node (README 4.2, steps 1-3).
 * The parent node is untouched — the branch sits beside it.
 */
export function openInterruptBranch(
  graph: LessonGraph,
  triggerUtterance: string,
  annotation?: InterruptBranch["annotation"]
): { graph: LessonGraph; branch: InterruptBranch } {
  if (!graph.currentNodeId) {
    throw new Error("Cannot open an interrupt branch before any node has been taught.");
  }
  const branch: InterruptBranch = {
    id: nextId("branch"),
    parentNodeId: graph.currentNodeId,
    triggerUtterance,
    resolutionNodes: [],
    annotation,
    status: "open",
  };
  return { graph: { ...graph, branches: [...graph.branches, branch] }, branch };
}

/** Adds the answer beat(s) to an open branch (README 4.2 step 4, "answers"). */
export function resolveInterruptBranch(
  graph: LessonGraph,
  branchId: string,
  resolutionNodes: LessonNode[]
): LessonGraph {
  return {
    ...graph,
    branches: graph.branches.map((b) =>
      b.id === branchId ? { ...b, resolutionNodes, status: "resolved" } : b
    ),
  };
}

/** True while any branch off the current node is still open — lenses use this to keep an annotation visible. */
export function hasOpenBranch(graph: LessonGraph): boolean {
  return graph.branches.some((b) => b.parentNodeId === graph.currentNodeId && b.status === "open");
}

export function getNode(graph: LessonGraph, nodeId: string): LessonNode | undefined {
  return graph.nodes.find((n) => n.id === nodeId);
}
