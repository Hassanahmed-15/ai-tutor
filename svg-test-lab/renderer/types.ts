import type { DiagramSpec } from "./components/Diagram";

export type SceneComponent =
  | { type: "icon"; icon: string; size?: number; color?: string; wobble?: boolean }
  | { type: "text"; text: string; size?: "sm" | "md" | "lg"; color?: string }
  | { type: "bullet-list"; items: string[] }
  | { type: "formula"; latex: string }
  | { type: "flowchart"; mermaid: string }
  | { type: "timeline"; mermaid: string }
  | { type: "diagram"; spec: DiagramSpec }
  | { type: "diagram-rough"; spec: DiagramSpec };

export interface Scene {
  type: "lesson";
  title: string;
  layout: "single-column" | "two-column";
  components: SceneComponent[];
  bullets?: string[];
}
