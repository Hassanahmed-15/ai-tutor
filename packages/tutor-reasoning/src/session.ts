import {
  appendNode,
  createLessonGraph,
  openInterruptBranch,
  resolveInterruptBranch,
  getNode,
  type LessonGraph,
} from "@aria/lesson-graph";
import type { TutorReasoningProvider } from "./provider";

/**
 * A thin orchestration layer over LessonGraph + a TutorReasoningProvider — the
 * "Session Orchestrator" box from README 5.1, minus the WebSocket/transport concerns
 * (those live in apps/web; this package is transport-agnostic on purpose so it's
 * testable without a server).
 */
export class TutorSession {
  public graph: LessonGraph;

  constructor(private provider: TutorReasoningProvider, subject: string, topic: string) {
    this.graph = createLessonGraph(subject, topic);
  }

  async start(): Promise<LessonGraph> {
    const nodes = await this.provider.planLesson({ subject: this.graph.subject, topic: this.graph.topic });
    for (const node of nodes) {
      this.graph = appendNode(this.graph, node);
    }
    // start() pre-plans the whole lesson for MVP simplicity; currentNodeId is reset to
    // the first beat so the UI teaches beat-by-beat rather than dumping everything at once.
    this.graph = { ...this.graph, currentNodeId: nodes[0]?.id ?? null };
    return this.graph;
  }

  advanceToNextNode(): LessonGraph {
    const currentIndex = this.graph.nodes.findIndex((n) => n.id === this.graph.currentNodeId);
    const next = this.graph.nodes[currentIndex + 1];
    // No next beat (already on the last node, or called before start()): stay put rather than
    // going blank. A blank lesson on the final beat reads as broken, not "finished" (caught by
    // calling advance an extra time past the recap node during manual verification).
    if (!next) return this.graph;
    this.graph = { ...this.graph, currentNodeId: next.id };
    return this.graph;
  }

  /** Implements the full interrupt flow from README 4.2: open a branch, resolve it, leave the parent beat untouched. */
  async handleInterrupt(studentUtterance: string): Promise<LessonGraph> {
    const { graph, branch } = openInterruptBranch(this.graph, studentUtterance, {
      targetElementIds: [],
      note: studentUtterance,
    });
    this.graph = graph;

    const interruptedNode = getNode(this.graph, branch.parentNodeId);
    if (!interruptedNode) {
      throw new Error("Interrupt branch references a node that doesn't exist in the graph.");
    }

    const resolutionNodes = await this.provider.resolveInterrupt({
      interruptedNode,
      studentUtterance,
    });
    this.graph = resolveInterruptBranch(this.graph, branch.id, resolutionNodes);
    return this.graph;
  }

  async submitCheckpointResponse(studentResponse: string) {
    const node = getNode(this.graph, this.graph.currentNodeId ?? "");
    if (!node || node.type !== "checkpoint") {
      throw new Error("submitCheckpointResponse called while the current node is not a checkpoint.");
    }
    return this.provider.evaluateCheckpointResponse({ node, studentResponse });
  }
}
