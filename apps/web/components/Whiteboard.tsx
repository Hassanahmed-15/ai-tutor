"use client";

import { SketchBoard, type BoardAnnotation } from "./whiteboard/SketchBoard";
import type { DrawCommands } from "@/lib/layout";

interface WhiteboardProps {
  drawCommands: DrawCommands | undefined;
  title?: string;
  annotation?: BoardAnnotation | null;
}

/**
 * Thin pass-through to the generic hand-drawn engine. There is intentionally no
 * per-topic branching here — SketchBoard + lib/layout.ts derive everything from
 * the StructuredVisual data itself, so a new topic never requires a new component.
 */
export function Whiteboard({ drawCommands, title, annotation }: WhiteboardProps) {
  return <SketchBoard drawCommands={drawCommands} title={title} annotation={annotation} />;
}
