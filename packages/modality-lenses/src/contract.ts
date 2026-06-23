import type { LessonNode, InterruptBranch } from "@aria/lesson-graph";

/**
 * The Modality Lens contract (README 5.3): "given a Lesson Graph node, produce the
 * modality-appropriate output." This is the one interface every lens implements —
 * adding a 5th/6th/7th disability track later means writing a new lens, not touching
 * the reasoning layer, the schema, or any other lens (README 5.3 closing line).
 */

/** A single span of text the renderer should speak/show, with optional sync timing for highlighting. */
export interface NarrationUnit {
  text: string;
  /** If true, this unit should be visually/verbally emphasized (e.g. bold, slower, louder). */
  emphasis?: boolean;
}

/** A non-speech audio cue — used heavily by the Visual Impairment lens (README 3.2, sonified diagrams). */
export interface SonicCue {
  kind: "tone-rising" | "tone-falling" | "tick" | "chime";
  meaning: string;
}

/**
 * What a lens produces for one LessonNode. Every field is optional because a lens may
 * legitimately skip a channel it doesn't use (e.g. Visual Impairment lens produces no
 * `visualDescription` boxes — it folds everything into `narration`).
 */
export interface RenderedBeat {
  nodeId: string;
  /** Spoken / primary narration, broken into units so renderers can sync highlighting to TTS timing. */
  narration: NarrationUnit[];
  /** Caption track — may differ from narration (e.g. shorter, punctuation-normalized) for the Hearing lens. */
  captions?: string[];
  /** Structured description of the visual, already adapted to this lens (e.g. verbalized for blind users). */
  visualDescription?: string;
  /** Raw drawing instructions for lenses that render an actual whiteboard (Default, Hearing). Opaque to lenses that don't draw. */
  drawCommands?: unknown;
  sonicCues?: SonicCue[];
  /** Suggested pacing multiplier (1 = normal). ADHD lens and Confusion Radar both modulate this (README 4.3). */
  pacingMultiplier?: number;
  /** Hint that this beat should be chunked into a shorter checkpoint cycle (ADHD lens, README 3.2). */
  suggestCheckpointSoon?: boolean;
}

/** How a lens renders an active interrupt annotation over the current beat (README 4.2 step 3). */
export interface RenderedAnnotation {
  branchId: string;
  /** Spoken/visual description of what's being annotated, lens-appropriate. */
  description: string;
  sonicCues?: SonicCue[];
}

export interface ModalityLens {
  id: "default" | "visual-impairment" | "hearing-impairment" | "dyslexia" | "adhd";
  displayName: string;
  renderBeat(node: LessonNode): RenderedBeat;
  renderAnnotation(branch: InterruptBranch): RenderedAnnotation;
}
