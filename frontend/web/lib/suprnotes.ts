import type { DrawScript } from "@/components/sketch/LiveSketch";
import type { Beat } from "./lessonContent";
import { fallbackWrittenDraw } from "./drawSanitize";

type UnknownRecord = Record<string, unknown>;

export type SuprnotesAsset = {
  id: string;
  type?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  caption?: string;
  description?: string;
  remoteUrl?: string;
  url?: string;
  publicUrl?: string;
  assetPath?: string;
  localPath?: string;
  sourceBlockIds?: string[];
  teachingUse?: unknown;
  pageNumber?: number;
  visualType?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  visionVerified?: boolean;
};

export type SuprnotesContentBlock = {
  id: string;
  type?: string;
  heading?: string;
  text?: string;
  items?: string[];
  columns?: string[];
  rows?: string[][];
  assetIds?: string[];
  sourceOrder?: number;
  keyIdeas?: string[];
  teachingHints?: string[];
  facts?: Array<{ claim?: string; source?: string; confidence?: string }>;
  pageNumber?: number;
  bbox?: { x: number; y: number; width: number; height: number };
  role?: string;
};

export type SuprnotesWebPreviewItem = {
  id: string;
  title?: string;
  sourceName?: string;
  url?: string;
  retrievedAt?: string;
  summary?: string;
  allowedUses?: string[];
  claims?: Array<{ claim: string; supportsBlockIds?: string[]; confidence?: string }>;
};

export type SuprnotesLessonInput = {
  schemaVersion?: string;
  source?: unknown;
  lesson?: {
    title?: string;
    subject?: string;
    level?: string;
    language?: string;
    estimatedTeachingMinutes?: number;
    learningGoals?: string[];
  };
  generationDirectives?: {
    imagePolicy?: string;
    disableAiImageGeneration?: boolean;
    preferredLectureStyle?: string;
    preserveExistingLecturePrompting?: boolean;
    visualUsage?: unknown;
  };
  assets?: SuprnotesAsset[];
  contentBlocks?: SuprnotesContentBlock[];
  suggestedLecturePlan?: unknown;
  lessonPlan?: unknown;
  contentGovernance?: {
    groundingPolicy?: string;
    hallucinationPolicy?: string;
    allowedSourceTypes?: string[];
    requireClaimSourceTags?: boolean;
    webPreviewPolicy?: string;
  };
  webPreview?: {
    status?: "not_requested" | "requested" | "available" | "failed";
    queryPlan?: string[];
    items?: SuprnotesWebPreviewItem[];
  };
};

type ImageOp = Extract<DrawScript["ops"][number], { kind: "image" }> & {
  assetId?: string;
  providedAssetId?: string;
};
type DrawOp = DrawScript["ops"][number];
type LabelOp = Extract<DrawOp, { kind: "label" }>;
type NoteOp = Extract<DrawOp, { kind: "note" }>;
type CalloutOp = Extract<DrawOp, { kind: "callout" }>;
const MAX_SUPRNOTES_SVG_BOARDS = 8;
/**
 * How many React-sandbox SVG boards composePromptedSuprnotesBoards FORCES onto a lecture.
 *
 * This — not the lecture prompt — is what actually decides how many sandbox boards a student
 * sees. It was 4-6, so every attempt to shrink their share by editing the prompt was overridden
 * a few lines later by this pass, which is exactly why a quota change from "4-5" to "3-4"
 * measured 5 boards instead of 3.
 *
 * The sandbox is the last renderer that asks the model for absolute coordinates, and it produces
 * the boards that read worst (labels stacked inside one shape, text off the canvas). Capping it
 * hands those beats to the chalk/paper boards, whose content is authored server-side and laid out
 * by code. Raise REACT_ANIMATION_BEAT_CAP to restore the old behaviour.
 */
const PROMPTED_SVG_BOARD_CAP = Math.max(0, Math.min(12, Number(process.env.REACT_ANIMATION_BEAT_CAP ?? 2)));
const MIN_PROMPTED_SVG_BOARDS = PROMPTED_SVG_BOARD_CAP;
const MAX_PROMPTED_SVG_BOARDS = PROMPTED_SVG_BOARD_CAP;
type LessonPlanBeat = {
  id?: string;
  title?: string;
  sourceBlockIds?: string[];
  recommendedVisual?: { type?: string; assetId?: string; brief?: string };
  visualMode?: string;
};

export function isSuprnotesLessonInput(value: unknown): value is SuprnotesLessonInput {
  if (!value || typeof value !== "object") return false;
  const record = value as UnknownRecord;
  return Array.isArray(record.contentBlocks) || Array.isArray(record.assets) || record.schemaVersion === "suprnotes.lesson_input.v1";
}

export function suprnotesTitle(input: SuprnotesLessonInput): string {
  return clean(input.lesson?.title) || "Imported lesson";
}

export function shouldUseOnlyProvidedImages(input: SuprnotesLessonInput | null): boolean {
  if (!input) return false;
  return input.generationDirectives?.disableAiImageGeneration === true || input.generationDirectives?.imagePolicy === "use_provided_images_only";
}

export function compactSuprnotesForPrompt(input: SuprnotesLessonInput): string {
  const isPdf = Boolean(
    input.source &&
    typeof input.source === "object" &&
    (input.source as UnknownRecord).adapter === "pdf-upload"
  );
  const assets = (input.assets ?? []).map((asset) => ({
    id: asset.id,
    caption: clean(asset.caption),
    description: clean(asset.description),
    width: asset.width,
    height: asset.height,
      sourceBlockIds: asset.sourceBlockIds ?? [],
      teachingUse: asset.teachingUse,
      pageNumber: asset.pageNumber,
      visualType: asset.visualType,
      bbox: asset.bbox,
  }));

  const blocks = (input.contentBlocks ?? [])
    .slice()
    .sort((a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0))
    .map((block) => ({
      id: block.id,
      type: block.type ?? "section",
      heading: clean(block.heading),
      text: clean(block.text).slice(0, isPdf ? 2200 : 1400),
      items: isPdf ? (block.items ?? []) : (block.items ?? []).slice(0, 8),
      columns: block.columns,
      rows: isPdf ? block.rows : block.rows?.slice(0, 8),
      assetIds: block.assetIds ?? [],
      keyIdeas: block.keyIdeas ?? [],
      teachingHints: block.teachingHints ?? [],
      facts: block.facts ?? [],
      pageNumber: block.pageNumber,
      bbox: block.bbox,
      role: block.role,
    }));

  return JSON.stringify({
    lesson: input.lesson ?? {},
    generationDirectives: input.generationDirectives ?? {},
    contentGovernance: input.contentGovernance ?? {},
    assets,
    contentBlocks: blocks,
    lessonPlan: input.lessonPlan ?? input.suggestedLecturePlan,
    suggestedLecturePlan: input.suggestedLecturePlan,
    webPreview: input.webPreview ?? { status: "not_requested" },
  });
}

export function hydrateProvidedImageOps(beats: Beat[], sourceDocument: SuprnotesLessonInput | null): number {
  if (!sourceDocument?.assets?.length) return 0;
  const assets = new Map(sourceDocument.assets.filter((asset) => asset.id).map((asset) => [asset.id, asset]));
  const pdfSource = Boolean(
    sourceDocument.source &&
    typeof sourceDocument.source === "object" &&
    (sourceDocument.source as UnknownRecord).adapter === "pdf-upload"
  );
  const plannedAssetIds = new Set(
    lessonPlanBeats(sourceDocument)
      .map((beat) => beat.recommendedVisual?.assetId)
      .filter((id): id is string => Boolean(id))
  );
  let hydrated = 0;

  for (const beat of beats) {
    for (const op of beat.draw?.ops ?? []) {
      if (op.kind !== "image") continue;
      const imageOp = op as ImageOp;
      const assetId = imageOp.assetId ?? imageOp.providedAssetId ?? inferAssetIdFromPrompt(imageOp.prompt, assets);
      if (!assetId || imageOp.src) continue;
      if (pdfSource && !plannedAssetIds.has(assetId)) continue;
      const asset = assets.get(assetId);
      const src = asset ? sourceForBrowser(asset) : "";
      if (!src) continue;
      imageOp.src = src;
      imageOp.assetId = assetId;
      if (!imageOp.prompt) {
        imageOp.prompt = [asset?.caption, asset?.description].map(clean).filter(Boolean).join(" — ") || assetId;
      }
      hydrated++;
    }
  }

  return hydrated;
}

export function removeUnhydratedSuprnotesImageOps(beats: Beat[], sourceDocument: SuprnotesLessonInput | null): number {
  if (!sourceDocument) return 0;
  let removed = 0;

  for (const beat of beats) {
    if (!beat.draw) continue;
    const before = beat.draw.ops.length;
    beat.draw.ops = beat.draw.ops.filter((op) => op.kind !== "image" || Boolean((op as ImageOp).src));
    removed += before - beat.draw.ops.length;
  }

  return removed;
}

/**
 * Provided images (real slides/infographics) already carry their own labels, so any beat that ends
 * up showing one must render CLEAN: just the image + a single top title. This strips the connector
 * callouts and stray text ops that other board builders (e.g. drawSanitize's makeImageCalloutBoard,
 * whose hardcoded keyword-matched labels could be wildly off — chemistry labels on a CS slide) may
 * have layered on before the provided image src was hydrated underneath them.
 */
export function cleanProvidedImageBoards(beats: Beat[], sourceDocument: SuprnotesLessonInput | null): number {
  if (!sourceDocument) return 0;
  let cleaned = 0;

  for (const beat of beats) {
    const ops = beat.draw?.ops;
    if (!ops?.length) continue;
    // Only touch beats that actually show a resolved provided image.
    const hasProvidedImage = ops.some((op) => op.kind === "image" && Boolean((op as ImageOp).src));
    if (!hasProvidedImage) continue;

    // Keep the top-most label as the board title; drop everything else that isn't the image or a
    // GROUNDED callout (those come from the image-explainer agent — accurate, description-derived,
    // sentence-synced — and must survive the repeated finalize passes).
    const titleLabel = ops
      .filter((op): op is Extract<DrawOp, { kind: "label" }> => op.kind === "label")
      .slice()
      .sort((a, b) => (a.y ?? 0) - (b.y ?? 0))[0];

    const before = ops.length;
    beat.draw!.ops = ops.filter(
      (op) => op.kind === "image" || op === titleLabel || (op.kind === "callout" && op.grounded === true),
    );
    if (beat.draw!.ops.length !== before) cleaned++;
  }

  return cleaned;
}

export function composeSuprnotesPaperBoards(beats: Beat[], sourceDocument: SuprnotesLessonInput | null): number {
  const blocks = sourceDocument?.contentBlocks
    ?.slice()
    .sort((a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0));
  if (!blocks?.length) return 0;

  let changed = 0;
  let svgBoards = beats.filter((beat) => beat.draw?.ops.some((op) => op.kind === "reactAnimation" && op.code)).length;
  const usedBlocks = new Set<string>();
  beats.forEach((beat, index) => {
    if (beat.draw?.ops.some((op) => op.kind === "image")) return;
    if (beat.draw?.ops.some((op) => op.kind === "reactAnimation")) return;
    // Idempotency: a chalkBoard placeholder (filled or not) is already a board beat — never
    // overwrite it. This runs after every incremental blackboard fill (route.ts), so clobbering
    // a filled board here would erase the engine's sentence-synced output.
    if (beat.draw?.ops.some((op) => op.kind === "chalkBoard")) return;

    const planBeat = plannedBeatForBeat(sourceDocument, beat, index);
    const block = blockForPlanBeat(planBeat, blocks) ?? bestBlockForBeat(beat, blocks, usedBlocks, index);
    if (!block) return;
    usedBlocks.add(block.id);
    const visualPreference = plannedVisualType(planBeat);
    const wantsSvg = visualPreference
      ? visualPreference.includes("svg") || visualPreference.includes("animation") || visualPreference.includes("diagram") || visualPreference.includes("realistic")
      : shouldUseSvgBoard(beat, block, index);
    const wantsPaper = visualPreference.includes("paper") || visualPreference.includes("notes") || visualPreference.includes("text");
    const isPlannedSvg = Boolean(visualPreference) && wantsSvg && !wantsPaper;
    // A written board (sentence-synced chalkboard) is the DEFAULT — that's the real-classroom
    // "write-then-tell" experience. Reserve the animation for a small number of beats (the key
    // mechanisms), so most concept beats are written boards, not animations. Animations are also
    // the expensive step (gpt-4o + validate/retry), so capping them keeps cost/latency down.
    const svgCap = isPlannedSvg ? MAX_SUPRNOTES_SVG_BOARDS : 1;
    const isMechanismBeat = index > 0 && beat.slideKind !== "recap";
    if (!wantsPaper && wantsSvg && isMechanismBeat && svgBoards < svgCap) {
      beat.draw = generatedSvgPaperBoard(beat, block);
      svgBoards++;
    } else {
      // Concept/text beats become a chalkBoard PLACEHOLDER filled by the sentence-synced blackboard
      // engine (write-then-tell) instead of the deterministic raw-notes board.
      beat.draw = chalkBoardPlaceholder(beat, block);
    }
    changed++;
  });

  return changed;
}

/**
 * Gives ordinary prompted/PPTX lectures the same visual grammar as a Suprnotes import.
 *
 * The first text-model pass is still responsible for the lesson plan and factual content, but
 * its visual op choices are deliberately not trusted here. The legacy sanitizer may turn those
 * choices into photo slides or sparse written boards. This pass deterministically re-composes
 * every teaching beat as either a complete Suprnotes SVG board or a concise paper note board.
 * Checkpoints remain untouched.
 */
export function composePromptedSuprnotesBoards(beats: Beat[]): number {
  const teaching = beats
    .map((beat, index) => ({ beat, index, block: promptedBlockForBeat(beat, index) }))
    .filter(({ beat }) => beat.slideKind !== "checkpoint");
  if (!teaching.length) return 0;

  const targetSvgCount = clamp(
    Math.round(teaching.length * 0.55),
    Math.min(MIN_PROMPTED_SVG_BOARDS, teaching.length),
    Math.min(MAX_PROMPTED_SVG_BOARDS, teaching.length)
  );
  const selected = selectPromptedSvgIndexes(teaching, targetSvgCount);
  let changed = 0;

  for (const { beat, index, block } of teaching) {
    // A TYPE D diagram beat is already a complete, self-contained board: one `manimScene` op whose
    // video is rendered later from its sceneBrief/spec. Composing a paper board over it destroys
    // the op — and because this pass runs BEFORE fillManimSceneOps, the fill then found nothing to
    // build and the diagram never reached the player at all.
    // Same for a TYPE E morph board: its shape/morph ops ARE the finished GSAP artwork, and no
    // later fill step rebuilds them, so composing a paper board over it loses the beat outright.
    // `reactAnimation` belongs in this list for exactly the reason the comment above gives, and its
    // absence was costing five generated boards per lecture.
    //
    // Measured with three snapshots through the route: after the fill passes a heart lecture held
    // seven reactAnimation ops carrying 11k-17k characters of working component each; after this
    // pass only two survived. The other five were overwritten by a composed paper board — already
    // generated, already critiqued, already refined, already paid for, and then discarded. It also
    // explains the intermittent "empty board": a beat left holding a reactAnimation op whose code
    // this pass had just removed rendered as nothing at all.
    //
    // Unlike manimScene, no later fill rebuilds a reactAnimation, so destroying it here is final.
    if (beat.draw?.ops.some((op) => op.kind === "manimScene" || op.kind === "morph" || op.kind === "reactAnimation" || op.kind === "structureScene" || op.kind === "plotBoard" || op.kind === "equationBoard")) continue;
    const trustedReferenceImage = beat.draw?.ops.some(
      (op) => op.kind === "image"
        && typeof op.assetId === "string"
        && (op.assetId.startsWith("reference:") || op.assetId.startsWith("commons:"))
        && Boolean(op.src)
    );
    if (trustedReferenceImage) {
      if (beat.draw) beat.draw.surface = "paper";
      continue;
    }
    if (selected.has(index)) {
      const teachingIndex = teaching.findIndex((entry) => entry.index === index);
      const context = {
        previousTitle: teaching[teachingIndex - 1]?.beat.title,
        nextTitle: teaching[teachingIndex + 1]?.beat.title,
      };
      const existing = beat.draw?.ops.find((op) => op.kind === "reactAnimation");
      const isComposedBoard = existing?.kind === "reactAnimation"
        && existing.teachingPoint?.includes("SUPRNOTES_WHITEBOARD_SVG_BOARD") === true;
      if (!isComposedBoard) {
        beat.draw = generatedSvgPaperBoard(beat, block, context);
        changed++;
      } else if (beat.draw) {
        beat.draw.surface = "paper";
      }
      continue;
    }

    const alreadyPaperNotes = beat.draw?.surface === "paper"
      && !beat.draw.ops.some((op) => op.kind === "image" || op.kind === "reactAnimation" || op.kind === "chalkBoard");
    if (!alreadyPaperNotes) {
      beat.draw = sourceNotePaperBoard(beat, block);
      changed++;
    }
  }

  return changed;
}

export function enforcePlannedSuprnotesVisualModes(beats: Beat[], sourceDocument: SuprnotesLessonInput | null): number {
  const blocks = sourceDocument?.contentBlocks
    ?.slice()
    .sort((a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0));
  if (!blocks?.length) return 0;

  let changed = 0;
  beats.forEach((beat, index) => {
    const planBeat = plannedBeatForBeat(sourceDocument, beat, index);
    const visualPreference = plannedVisualType(planBeat);
    if (!visualPreference.includes("svg") && !visualPreference.includes("animation") && !visualPreference.includes("diagram")) return;
    if (beat.draw?.ops.some((op) => op.kind === "image")) return;
    if (beat.draw?.ops.some((op) => op.kind === "reactAnimation" && op.code)) return;
    const block = blockForPlanBeat(planBeat, blocks) ?? bestBlockForBeat(beat, blocks, new Set<string>(), index);
    if (!block) return;
    beat.draw = generatedSvgPaperBoard(beat, block);
    changed++;
  });

  return changed;
}

export function repairMissingSuprnotesSvgCode(beats: Beat[], sourceDocument: SuprnotesLessonInput | null): number {
  const sourceBlocks = sourceDocument?.contentBlocks
    ?.slice()
    .sort((a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0));
  const blocks = sourceBlocks?.length
    ? sourceBlocks
    : beats.map((beat, index) => promptedBlockForBeat(beat, index));
  if (!blocks.length) return 0;

  let repaired = 0;
  const usedBlocks = new Set<string>();
  beats.forEach((beat, index) => {
    const animationOp = beat.draw?.ops.find((op) => op.kind === "reactAnimation");
    if (!animationOp || animationOp.code) return;
    const planBeat = plannedBeatForBeat(sourceDocument, beat, index);
    const block = sourceDocument
      ? blockForPlanBeat(planBeat, blocks) ?? bestBlockForBeat(beat, blocks, usedBlocks, index)
      : blocks[index];
    if (!block) return;
    usedBlocks.add(block.id);
    // Never substitute a topic-agnostic diagram here. The old emergency SVG reused the same
    // oval/wave composition on every subject and extracted short tokens such as "In" or "If",
    // which made failed generations look like fabricated lesson content. A failed premium
    // illustration now degrades to a content-grounded written board instead.
    beat.draw = {
      ...fallbackWrittenDraw(beat.title, beat.script),
      surface: "paper",
    };
    repaired++;
  });

  return repaired;
}

/** Fallback for concept beats whose chalkboard engine failed (or hasn't filled): swap the empty
 *  chalkBoard placeholder for the deterministic sourceNotePaperBoard so a beat never renders blank.
 *  Only touches chalkBoard ops with no filled ops AND status "failed" (leaves pending ones alone). */
export function repairMissingSuprnotesBoards(beats: Beat[], sourceDocument: SuprnotesLessonInput | null): number {
  const blocks = sourceDocument?.contentBlocks
    ?.slice()
    .sort((a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0));
  if (!blocks?.length) return 0;

  let repaired = 0;
  const usedBlocks = new Set<string>();
  beats.forEach((beat, index) => {
    const chalkOp = beat.draw?.ops.find((op) => op.kind === "chalkBoard");
    if (!chalkOp || chalkOp.kind !== "chalkBoard") return;
    if (chalkOp.ops?.length || chalkOp.status !== "failed") return; // filled or still pending — leave it
    const planBeat = plannedBeatForBeat(sourceDocument, beat, index);
    const block = blockForPlanBeat(planBeat, blocks) ?? bestBlockForBeat(beat, blocks, usedBlocks, index);
    if (!block) return;
    usedBlocks.add(block.id);
    beat.draw = sourceNotePaperBoard(beat, block);
    repaired++;
  });

  return repaired;
}

export function ensureSuprnotesAssetUsage(beats: Beat[], sourceDocument: SuprnotesLessonInput | null): number {
  if (!sourceDocument?.assets?.length || beats.length === 0) return 0;
  const blocks = new Map((sourceDocument.contentBlocks ?? []).filter((block) => block.id).map((block) => [block.id, block]));
  const usedAssetIds = new Set<string>();

  for (const beat of beats) {
    for (const op of beat.draw?.ops ?? []) {
      if (op.kind !== "image") continue;
      const imageOp = op as ImageOp;
      const assetId = imageOp.assetId ?? imageOp.providedAssetId ?? inferAssetIdFromPrompt(imageOp.prompt, new Map(sourceDocument.assets.map((asset) => [asset.id, asset])));
      if (assetId) usedAssetIds.add(assetId);
    }
  }

  let injected = 0;
  const planned = lessonPlanBeats(sourceDocument);
  const pdfSource = Boolean(
    sourceDocument.source &&
    typeof sourceDocument.source === "object" &&
    (sourceDocument.source as UnknownRecord).adapter === "pdf-upload"
  );
  const plannedAssetIds = new Set(
    planned.map((beat) => beat.recommendedVisual?.assetId).filter((id): id is string => Boolean(id))
  );
  for (const asset of sourceDocument.assets) {
    if (pdfSource && !plannedAssetIds.has(asset.id)) continue;
    if (!asset.id || usedAssetIds.has(asset.id)) continue;
    const src = sourceForBrowser(asset);
    if (!src) continue;
    const plannedIndex = planned.findIndex((planBeat) => planBeat.recommendedVisual?.assetId === asset.id);
    const targetIndex = plannedIndex >= 0 && plannedIndex < beats.length
      ? plannedIndex
      : bestBeatForAsset(beats, asset, blocks);
    if (targetIndex < 0) continue;
    const beat = beats[targetIndex];
    beat.draw = providedAssetBoard(beat, asset, src);
    usedAssetIds.add(asset.id);
    injected++;
  }

  return injected;
}

export function applySuprnotesPaperSurface(beats: Beat[], sourceDocument: SuprnotesLessonInput | null): void {
  if (!sourceDocument) return;
  for (const beat of beats) {
    const draw = beat.draw;
    if (!draw) continue;
    draw.surface = "paper";
    for (const op of draw.ops) {
      if (op.kind === "chalkBoard" && op.ops) {
        // The outer draw carries the surface, but keeping nested boards explicit makes streamed
        // updates robust if a client ever renders the nested ops independently.
        draw.surface = "paper";
      }
    }
  }
}

export function applySuprnotesPaperLayout(beats: Beat[], sourceDocument: SuprnotesLessonInput | null): void {
  if (!sourceDocument) return;
  const assets = new Map((sourceDocument.assets ?? []).filter((asset) => asset.id).map((asset) => [asset.id, asset]));

  for (const beat of beats) {
    if (!beat.draw) continue;
    beat.draw.surface = "paper";
    const chalkOp = beat.draw.ops.find((op) => op.kind === "chalkBoard");
    if (chalkOp?.kind === "chalkBoard") {
      // Trust the blackboard engine's own layout: its ops are already single-column, top-to-bottom,
      // non-overlapping (getBlackboardDiagnostics enforces it) AND sentence-synced via `at`.
      // Re-running layoutPaperTextBoard here re-flowed them into a broken 2-column layout (same-y
      // collisions) and overwrote the sentence timing — so filled chalk ops are left untouched. An
      // unfilled placeholder is likewise preserved for the engine to fill later.
      continue;
    }

    const imageOp = beat.draw.ops.find((op): op is ImageOp => op.kind === "image");
    if (imageOp) {
      beat.draw.ops = layoutPaperImageBoard(beat.draw.ops, beat.title, imageOp, assets);
      continue;
    }

    const animationOp = beat.draw.ops.find((op) => op.kind === "reactAnimation");
    if (animationOp) continue;

    // A TYPE D diagram beat is rendered as Manim video from its scene spec — it has no paper text
    // to lay out. Without this escape it matches none of the cases above, falls through to
    // layoutPaperTextBoard below, and its single `manimScene` op is rewritten away entirely.
    const diagramOp = beat.draw.ops.find((op) => op.kind === "manimScene" || op.kind === "morph" || op.kind === "structureScene" || op.kind === "plotBoard" || op.kind === "equationBoard");
    if (diagramOp) continue;

    const hasStructuredInk = beat.draw.ops.some(
      (op) => op.kind === "shape" || op.kind === "arrow" || op.kind === "underline" || op.kind === "circleHighlight"
    );
    const hasEnoughText = beat.draw.ops.filter((op) => op.kind === "label" || op.kind === "note").length >= 4;
    if (hasStructuredInk && hasEnoughText) continue;

    beat.draw.ops = layoutPaperTextBoard(beat.draw.ops, beat.title);
  }
}

/** Free-topic equivalent of applySuprnotesPaperLayout — same paper-appropriate re-layout pass
 *  (sparse rows, generous spacing, clean image/callout placement) but for beats with no uploaded
 *  source document, so there is no asset map to draw on. Sets `surface: "paper"` and re-lays-out
 *  chalk/label/note/image ops using the exact same layoutPaperTextBoard/layoutPaperImageBoard
 *  helpers Suprnotes uses — without this, free-topic beats keep their dark-chalkboard-tuned
 *  positions/density (many rows, tight spacing) while only the color theme flips to paper,
 *  which reads as cramped/messy rather than a clean whiteboard. */
export function applyPaperLayout(beats: Beat[]): void {
  const noAssets = new Map<string, SuprnotesAsset>();

  for (const beat of beats) {
    if (!beat.draw) continue;
    beat.draw.surface = "paper";
    const chalkOp = beat.draw.ops.find((op) => op.kind === "chalkBoard");
    if (chalkOp?.kind === "chalkBoard" && chalkOp.ops?.length) {
      chalkOp.ops = layoutPaperTextBoard(chalkOp.ops, beat.title);
      continue;
    }

    const imageOp = beat.draw.ops.find((op): op is ImageOp => op.kind === "image");
    if (imageOp) {
      beat.draw.ops = layoutPaperImageBoard(beat.draw.ops, beat.title, imageOp, noAssets);
      continue;
    }

    const animationOp = beat.draw.ops.find((op) => op.kind === "reactAnimation");
    if (animationOp) continue;

    // A TYPE D diagram beat is rendered as Manim video from its scene spec — it has no paper text
    // to lay out. Without this escape it matches none of the cases above, falls through to
    // layoutPaperTextBoard below, and its single `manimScene` op is rewritten away entirely.
    const diagramOp = beat.draw.ops.find((op) => op.kind === "manimScene" || op.kind === "morph" || op.kind === "structureScene" || op.kind === "plotBoard" || op.kind === "equationBoard");
    if (diagramOp) continue;

    const hasStructuredInk = beat.draw.ops.some(
      (op) => op.kind === "shape" || op.kind === "arrow" || op.kind === "underline" || op.kind === "circleHighlight"
    );
    const hasEnoughText = beat.draw.ops.filter((op) => op.kind === "label" || op.kind === "note").length >= 4;
    if (hasStructuredInk && hasEnoughText) continue;

    beat.draw.ops = layoutPaperTextBoard(beat.draw.ops, beat.title);
  }
}

function generatedSvgPaperBoard(
  beat: Beat,
  block: SuprnotesContentBlock,
  context?: { previousTitle?: string; nextTitle?: string }
): DrawScript {
  const heading = clean(block.heading) || beat.title;
  return {
    caption: heading,
    durationMs: beat.draw?.durationMs ?? 26000,
    surface: "paper",
    ops: [{
      kind: "reactAnimation",
      teachingPoint: suprnotesSvgBrief(beat, block, context),
      at: 0,
      endAt: 1,
    }],
  };
}

function lessonPlanBeats(input: SuprnotesLessonInput | null): LessonPlanBeat[] {
  const plan = (input?.lessonPlan ?? input?.suggestedLecturePlan) as UnknownRecord | undefined;
  const beats = plan && Array.isArray(plan.beats) ? plan.beats : [];
  return beats.filter((beat): beat is LessonPlanBeat => Boolean(beat && typeof beat === "object")) as LessonPlanBeat[];
}

function plannedBeatForBeat(input: SuprnotesLessonInput | null, beat: Beat, index: number): LessonPlanBeat | undefined {
  const planned = lessonPlanBeats(input);
  if (!planned.length) return undefined;
  const beatId = clean(beat.id).toLowerCase();
  const title = clean(beat.title).toLowerCase();
  return planned.find((item) => clean(item.id).toLowerCase() === beatId)
    ?? planned.find((item) => clean(item.title).toLowerCase() === title)
    ?? planned[index];
}

function blockForPlanBeat(planBeat: LessonPlanBeat | undefined, blocks: SuprnotesContentBlock[]): SuprnotesContentBlock | null {
  const ids = planBeat?.sourceBlockIds ?? [];
  return ids.map((id) => blocks.find((block) => block.id === id)).find(Boolean) ?? null;
}

function plannedVisualType(planBeat: LessonPlanBeat | undefined): string {
  return clean(planBeat?.visualMode || planBeat?.recommendedVisual?.type).toLowerCase();
}

/** Dense one-sentence brief handed to the chalkboard engine (BLACKBOARD_SYSTEM_PROMPT) for a
 *  concept/text beat — grounds the written board in the matched content block. */
function suprnotesChalkBoardBrief(beat: Beat, block: SuprnotesContentBlock): string {
  const heading = clean(block.heading) || beat.title;
  const ideas = boardIdeas(block).slice(0, 5).map((idea) => shortText(idea, 90));
  return [
    `Teach "${heading}" as a written board grounded ONLY in these notes.`,
    ideas.length ? `Key points to write: ${ideas.join(" / ")}.` : "",
    `Source text: ${shortText(block.text ?? beat.script, 420)}`,
  ].filter(Boolean).join(" ");
}

/** A chalkBoard PLACEHOLDER for a concept beat. The blackboard engine (lib/blackboardGen.ts) fills
 *  op.ops sentence-synced so the board is WRITTEN as it is spoken (write-then-tell). If that engine
 *  fails, repairMissingSuprnotesBoards swaps in the deterministic sourceNotePaperBoard. */
function chalkBoardPlaceholder(beat: Beat, block: SuprnotesContentBlock): DrawScript {
  return {
    caption: clean(block.heading) || beat.title,
    durationMs: beat.draw?.durationMs ?? 26000,
    surface: "paper",
    ops: [{ kind: "chalkBoard", boardBrief: suprnotesChalkBoardBrief(beat, block), at: 0, endAt: 1 }],
  };
}

function sourceNotePaperBoard(beat: Beat, block: SuprnotesContentBlock): DrawScript {
  const heading = clean(block.heading) || beat.title;
  const ideas = boardIdeas(block).slice(0, 3);
  const ops: DrawOp[] = [{
    kind: "label",
    text: boardTitle(heading),
    x: 50,
    y: 9,
    size: "md",
    color: "#7a7f87",
    at: 0.03,
  }];
  const colors = ["#14b8a6", "#3b82f6", "#be185d", "#65a30d"];
  ideas.forEach((idea, index) => {
    const y = 34 + index * 17;
    ops.push({
      kind: index === 0 ? "label" : "note",
      text: shortText(idea, index === 0 ? 48 : 54),
      x: 17,
      y,
      size: index === 0 ? "sm" : undefined,
      color: index === 0 ? colors[index] : "#6b7280",
      at: 0.16 + index * 0.13,
    } as DrawOp);
    ops.push({
      kind: "shape",
      shape: "line",
      x: 12,
      y,
      points: [{ x: 12, y: y - 5 }, { x: 12, y: y + 4 }],
      color: colors[index % colors.length],
      at: 0.19 + index * 0.13,
    });
  });
  return { caption: heading, durationMs: beat.draw?.durationMs ?? 24000, surface: "paper", ops };
}

function shouldUseSvgBoard(beat: Beat, block: SuprnotesContentBlock, index: number): boolean {
  if (beat.slideKind === "checkpoint") return false;
  if (block.rows?.length || block.type === "table") return true;
  if ((block.assetIds ?? []).length > 0) return false;
  const text = [block.heading, block.text, ...(block.keyIdeas ?? []), ...(block.items ?? [])].map(clean).join(" ").toLowerCase();
  const visualWords = [
    "transfer", "moment", "arrow", "compare", "structure", "diagram", "forms",
    "properties", "predict", "case", "between", "versus", "vs", "practical",
    "implication", "solubility", "conductivity", "boiling", "mix", "polar", "nonpolar",
  ];
  if (visualWords.some((word) => text.includes(word))) return true;
  return index === 0 || beat.slideKind === "recap";
}

function promptedBlockForBeat(beat: Beat, index: number): SuprnotesContentBlock {
  const structuredIdeas = [
    ...(beat.points ?? []),
    beat.definitionTerm && beat.definitionMeaning
      ? `${beat.definitionTerm}: ${beat.definitionMeaning}`
      : "",
    ...(beat.compareLeft?.points ?? []).map((point) => `${beat.compareLeft?.label ?? "Left"}: ${point}`),
    ...(beat.compareRight?.points ?? []).map((point) => `${beat.compareRight?.label ?? "Right"}: ${point}`),
  ].map(clean).filter(Boolean);
  const scriptIdeas = clean(beat.script)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/^(?:so|now|okay|alright|let(?:'s| us))[,\s]+/i, "").trim())
    .filter((sentence) => sentence.length >= 14)
    .slice(0, 5);

  return {
    id: `prompted-${beat.id || index}`,
    type: beat.slideKind === "compare" ? "comparison" : "section",
    heading: beat.title,
    text: beat.script,
    keyIdeas: dedupeRows([...structuredIdeas, ...scriptIdeas]).slice(0, 5),
    sourceOrder: index,
  };
}

function selectPromptedSvgIndexes(
  teaching: Array<{ beat: Beat; index: number; block: SuprnotesContentBlock }>,
  target: number
): Set<number> {
  const visualTerms = /\b(?:how|inside|structure|system|process|cycle|flow|path|mechanism|transfer|transform|convert|compare|versus|difference|relationship|cause|effect|force|field|reaction|molecule|cell|circuit|graph|timeline|map|model|anatomy|architecture)\b/i;
  const scores = new Map<number, number>();
  teaching.forEach(({ beat, index, block }, order) => {
    const source = `${beat.title} ${beat.teacherMove} ${block.keyIdeas?.join(" ") ?? ""}`;
    let score = index === 0 ? 120 : 0;
    if (beat.slideKind === "compare") score += 55;
    if (beat.slideKind === "definition") score += 18;
    if (beat.slideKind === "recap") score -= 18;
    if (visualTerms.test(source)) score += 44;
    if ((beat.points?.length ?? 0) >= 3) score += 12;
    // A small center-weight favors mechanism boards without forcing adjacent SVG slides.
    const center = (teaching.length - 1) / 2;
    score += Math.max(0, 10 - Math.abs(order - center) * 2);
    scores.set(index, score);
  });

  const selected = new Set<number>();
  const first = teaching[0];
  if (first) selected.add(first.index);
  while (selected.size < target) {
    let best: { index: number; score: number } | null = null;
    for (const { index } of teaching) {
      if (selected.has(index)) continue;
      const nearest = selected.size
        ? Math.min(...Array.from(selected, (chosen) => Math.abs(chosen - index)))
        : teaching.length;
      const spreadBonus = Math.min(30, nearest * 9);
      const score = (scores.get(index) ?? 0) + spreadBonus;
      if (!best || score > best.score) best = { index, score };
    }
    if (!best) break;
    selected.add(best.index);
  }
  return selected;
}

function suprnotesSvgBrief(
  beat: Beat,
  block: SuprnotesContentBlock,
  context?: { previousTitle?: string; nextTitle?: string }
): string {
  const heading = clean(block.heading) || beat.title;
  const ideas = boardIdeas(block).slice(0, 5);
  const table = block.rows?.length
    ? `Table/comparison data: columns=${(block.columns ?? []).join(" | ")}; rows=${block.rows.map((row) => row.join(" | ")).join("; ")}.`
    : "";
  return [
    "SUPRNOTES_WHITEBOARD_SVG_BOARD",
    `Board title: ${heading}.`,
    `Beat title: ${beat.title}.`,
    `Source text: ${shortText(block.text ?? beat.script, 520)}`,
    ideas.length ? `Key ideas to show, using plain accurate labels: ${ideas.map((idea) => shortText(idea, 120)).join(" / ")}.` : "",
    table,
    context?.previousTitle ? `Prior lesson context: ${context.previousTitle}. Preserve one small spatial or conceptual anchor from it only when that makes the relationship clearer.` : "",
    context?.nextTitle ? `Next lesson direction: ${context.nextTitle}. Reserve space or end with a visual bridge only when it naturally prepares that idea.` : "",
    "Plan the full board before drawing. Choose a content-specific reading path rather than a fixed left/right split, then interleave short handwritten claims with the exact diagrams, labels, arrows, and later annotations they explain. Use real subject-specific visuals, not generic bubbles: accurate molecular or structural sketches, professional cutaways, graphs, maps, mechanisms, or comparisons as appropriate. Keep labels short and readable; no clipped text, filler, or invented facts. The illustration should have textbook/BioRender-level proportions, layered editable SVG shapes, clean outlines, restrained depth, and meaningful colors.",
  ].filter(Boolean).join("\n");
}

export function layoutPaperImageBoard(
  ops: DrawOp[],
  title: string,
  imageOp: ImageOp,
  assets: Map<string, SuprnotesAsset>
): DrawOp[] {
  const asset = imageOp.assetId ? assets.get(imageOp.assetId) : undefined;
  const aspect = asset?.width && asset?.height ? asset.width / asset.height : 1.45;
  const box = aspect >= 1.45
    ? { x: 57, y: 53, w: 60, h: 48 }
    : { x: 56, y: 53, w: 46, h: 58 };

  const laidImage: ImageOp = {
    ...imageOp,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    at: Math.min(imageOp.at, 0.08),
  };

  const otherText = ops.filter((op): op is LabelOp | NoteOp => op.kind === "label" || op.kind === "note");
  const existingTitle = otherText.find((op) => op.kind === "label" && op.y <= 16)?.text ?? title;
  const titleOp: LabelOp = {
    kind: "label",
    text: boardTitle(existingTitle),
    x: 50,
    y: 7,
    size: "md",
    color: "#6b7280",
    at: 0.02,
  };

  const callouts = ops.filter((op): op is CalloutOp => op.kind === "callout");
  const laidCallouts = callouts.slice(0, 4).map((op, index) => layoutCalloutAroundImage(op, index, box));

  const notes = otherText
    .filter((op) => !(op.kind === "label" && op.y <= 16))
    .slice(0, Math.max(0, 2 - laidCallouts.length))
    .map((op, index): NoteOp => ({
      kind: "note",
      text: shortText(op.text, 52),
      x: 16,
      y: 36 + index * 14,
      color: markerColor(index),
      at: 0.18 + index * 0.12,
    }));

  return [titleOp, laidImage, ...laidCallouts, ...notes].sort((a, b) => a.at - b.at);
}

export function layoutCalloutAroundImage(op: CalloutOp, index: number, box: { x: number; y: number; w: number; h: number }): CalloutOp {
  const targetSlots = [
    { x: box.x - box.w * 0.24, y: box.y - box.h * 0.18 },
    { x: box.x + box.w * 0.25, y: box.y - box.h * 0.16 },
    { x: box.x - box.w * 0.2, y: box.y + box.h * 0.2 },
    { x: box.x + box.w * 0.22, y: box.y + box.h * 0.22 },
  ];
  const labelSlots = [
    { x: 18, y: 28 },
    { x: 86, y: 28 },
    { x: 18, y: 76 },
    { x: 86, y: 76 },
  ];
  const imageLeft = box.x - box.w / 2;
  const imageRight = box.x + box.w / 2;
  const imageTop = box.y - box.h / 2;
  const imageBottom = box.y + box.h / 2;
  const hasGroundedTarget =
    op.grounded === true &&
    Number.isFinite(op.x) &&
    Number.isFinite(op.y) &&
    op.x >= imageLeft &&
    op.x <= imageRight &&
    op.y >= imageTop &&
    op.y <= imageBottom;
  const target = hasGroundedTarget
    ? { x: op.x, y: op.y }
    : targetSlots[index % targetSlots.length];
  const label = labelSlots[index % labelSlots.length];
  return {
    ...op,
    text: shortText(op.text, 28),
    x: clamp(target.x, box.x - box.w / 2 + 6, box.x + box.w / 2 - 6),
    y: clamp(target.y, box.y - box.h / 2 + 6, box.y + box.h / 2 - 6),
    labelX: label.x,
    labelY: label.y,
    color: op.color ?? markerColor(index),
    at: hasGroundedTarget ? op.at : 0.18 + index * 0.13,
  };
}

export function layoutPaperTextBoard(ops: DrawOp[], title: string): DrawOp[] {
  const textOps = ops.filter((op): op is LabelOp | NoteOp => op.kind === "label" || op.kind === "note");
  const rawRows = textOps
    .filter((op) => op.y > 14)
    .map((op) => shortText(op.text, op.kind === "label" ? 34 : 58))
    .filter(Boolean);
  const rows = dedupeRows(rawRows.length ? rawRows : textOps.map((op) => shortText(op.text, 58))).slice(0, 6);
  const titleText = boardTitle(textOps.find((op) => op.kind === "label" && op.y <= 16)?.text ?? title);

  const laid: DrawOp[] = [{
    kind: "label",
    text: titleText,
    x: 50,
    y: 7,
    size: "md",
    color: "#6b7280",
    at: 0.02,
  }];

  if (rows.length <= 4) {
    rows.forEach((row, index) => {
      laid.push({
        kind: index === 0 ? "label" : "note",
        text: row,
        x: 16,
        y: 28 + index * 15,
        size: index === 0 ? "md" : undefined,
        color: markerColor(index),
        at: 0.18 + index * 0.13,
      } as DrawOp);
    });
  } else {
    rows.forEach((row, index) => {
      const col = index % 2;
      const r = Math.floor(index / 2);
      laid.push({
        kind: index < 2 ? "label" : "note",
        text: row,
        x: col === 0 ? 18 : 58,
        y: 27 + r * 18,
        size: index < 2 ? "md" : undefined,
        color: markerColor(index),
        at: 0.16 + index * 0.1,
      } as DrawOp);
    });
  }

  return laid.sort((a, b) => a.at - b.at);
}

function providedAssetBoard(beat: Beat, asset: SuprnotesAsset, src: string): DrawScript {
  const imageBox = { x: 55, y: 55, w: 62, h: 50 };
  const teachingUse = asset.teachingUse && typeof asset.teachingUse === "object"
    ? asset.teachingUse as UnknownRecord
    : null;
  const annotationNeeded = teachingUse?.annotationNeeded !== false;
  const focusRegions = annotationNeeded ? assetFocusRegions(asset) : [];
  const calloutSeeds = !annotationNeeded
    ? []
    : focusRegions.length
    ? focusRegions.map((region) => ({
        text: region.label,
        x: imageBox.x - imageBox.w / 2 + (region.x + region.width / 2) * imageBox.w,
        y: imageBox.y - imageBox.h / 2 + (region.y + region.height / 2) * imageBox.h,
        grounded: true,
      }))
    : assetCalloutLabels(asset).slice(0, 4).map((text) => ({
        text,
        x: imageBox.x,
        y: imageBox.y,
        grounded: false,
      }));
  const callouts = calloutSeeds.map((item, index): CalloutOp => ({
    kind: "callout",
    text: item.text,
    x: item.x,
    y: item.y,
    labelX: index % 2 === 0 ? 18 : 88,
    labelY: index < 2 ? 28 : 76,
    color: markerColor(index + 1),
    at: 0.22 + index * 0.12,
    grounded: item.grounded,
  }));

  return {
    caption: clean(asset.caption) || beat.title,
    durationMs: beat.draw?.durationMs ?? 26000,
    surface: "paper",
    ops: [
      {
        kind: "label",
        text: boardTitle(clean(asset.caption) || beat.title),
        x: 50,
        y: 7,
        size: "md",
        color: "#6b7280",
        at: 0.02,
      },
      {
        kind: "image",
        prompt: [asset.caption, asset.description].map(clean).filter(Boolean).join(" — ") || asset.id,
        assetId: asset.id,
        src,
        x: imageBox.x,
        y: imageBox.y,
        w: imageBox.w,
        h: imageBox.h,
        at: 0.08,
      },
      ...callouts,
    ],
  };
}

function bestBlockForBeat(
  beat: Beat,
  blocks: SuprnotesContentBlock[],
  usedBlocks: Set<string>,
  beatIndex: number
): SuprnotesContentBlock | null {
  const text = `${beat.title} ${beat.script}`.toLowerCase();
  let best: { block: SuprnotesContentBlock; score: number } | null = null;
  for (const block of blocks) {
    const terms = [block.heading, block.text, ...(block.keyIdeas ?? []), ...(block.items ?? [])]
      .map(clean)
      .flatMap(keywordTokens);
    const score = terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0)
      + (usedBlocks.has(block.id) ? -2 : 0);
    if (!best || score > best.score) best = { block, score };
  }
  if (best && best.score > 0) return best.block;

  const unused = blocks.filter((block) => !usedBlocks.has(block.id));
  if (unused.length) return unused[Math.min(unused.length - 1, Math.max(0, beatIndex - 1)) % unused.length] ?? null;
  return blocks[Math.max(0, beatIndex - 1) % blocks.length] ?? null;
}

function boardIdeas(block: SuprnotesContentBlock): string[] {
  const ideas = [
    ...(block.keyIdeas ?? []),
    ...(block.items ?? []),
  ].map(clean).filter(Boolean);
  if (ideas.length) return ideas;

  const text = clean(block.text);
  if (!text) return [clean(block.heading)].filter(Boolean);
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function bestBeatForAsset(beats: Beat[], asset: SuprnotesAsset, blocks: Map<string, SuprnotesContentBlock>): number {
  const assetBlocks = (asset.sourceBlockIds ?? []).map((id) => blocks.get(id)).filter(Boolean) as SuprnotesContentBlock[];
  const searchTerms = [
    asset.caption,
    asset.description,
    ...assetBlocks.flatMap((block) => [block.heading, block.text, ...(block.keyIdeas ?? [])]),
  ]
    .map(clean)
    .flatMap(keywordTokens);

  let best = { index: -1, score: -1 };
  beats.forEach((beat, index) => {
    if (beat.slideKind === "checkpoint") return;
    const text = `${beat.title} ${beat.script}`.toLowerCase();
    const hasImage = beat.draw?.ops.some((op) => op.kind === "image") ?? false;
    const exactBlockMatches = (beat.sourceBlockIds ?? []).filter((id) => asset.sourceBlockIds?.includes(id)).length;
    const score = searchTerms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0)
      + exactBlockMatches * 20
      + (index === 0 ? -4 : 0)
      + (hasImage ? -30 : 0);
    if (score > best.score) best = { index, score };
  });

  if (best.index >= 0 && best.score > 0) return best.index;
  return beats.findIndex((beat, index) => index > 0 && beat.slideKind !== "checkpoint" && !(beat.draw?.ops.some((op) => op.kind === "image") ?? false));
}

function assetCalloutLabels(asset: SuprnotesAsset): string[] {
  const teachingUse = asset.teachingUse;
  if (teachingUse && typeof teachingUse === "object") {
    const record = teachingUse as UnknownRecord;
    const suggested = Array.isArray(record.suggestedCallouts) ? record.suggestedCallouts : [];
    const labels = suggested
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") return clean((item as UnknownRecord).label) || clean((item as UnknownRecord).target);
        return "";
      })
      .filter(Boolean);
    if (labels.length) return labels;
    const concepts = Array.isArray(record.concepts) ? record.concepts.map(clean).filter(Boolean) : [];
    if (concepts.length) return concepts;
  }
  return [asset.caption, asset.description].map(clean).filter(Boolean).slice(0, 3);
}

function assetFocusRegions(asset: SuprnotesAsset): Array<{ label: string; x: number; y: number; width: number; height: number }> {
  if (!asset.teachingUse || typeof asset.teachingUse !== "object") return [];
  const raw = (asset.teachingUse as UnknownRecord).focusRegions;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const region = item as UnknownRecord;
    const label = clean(region.label);
    const x = Number(region.x);
    const y = Number(region.y);
    const width = Number(region.width);
    const height = Number(region.height);
    if (!label || ![x, y, width, height].every(Number.isFinite)) return [];
    return [{
      label,
      x: clamp(x, 0, 1),
      y: clamp(y, 0, 1),
      width: clamp(width, 0, 1),
      height: clamp(height, 0, 1),
    }];
  }).slice(0, 4);
}

function keywordTokens(value: string): string[] {
  const stop = new Set(["the", "and", "with", "from", "that", "this", "into", "when", "where", "bond", "bonds", "diagram"]);
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+\-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !stop.has(token))
    .slice(0, 24);
}

function dedupeRows(rows: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    const key = row.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function markerColor(index: number): string {
  return ["#6b7280", "#14b8a6", "#3b82f6", "#be185d", "#65a30d", "#d97706"][index % 6];
}

function boardTitle(value: string): string {
  return shortText(value, 42);
}

function shortText(value: string, max: number): string {
  const text = clean(value).replace(/\s+/g, " ");
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sourceForBrowser(asset: SuprnotesAsset): string {
  const candidates = [asset.publicUrl, asset.remoteUrl, asset.url, asset.assetPath, asset.localPath].map(clean).filter(Boolean);
  return candidates.find((candidate) =>
    candidate.startsWith("http://") ||
    candidate.startsWith("https://") ||
    candidate.startsWith("data:") ||
    candidate.startsWith("/lecture-assets/") ||
    candidate.startsWith("/uploads/")
  ) ?? "";
}

function inferAssetIdFromPrompt(prompt: string, assets: Map<string, SuprnotesAsset>): string {
  const lower = clean(prompt).toLowerCase();
  if (!lower) return "";
  for (const [id, asset] of assets) {
    const caption = clean(asset.caption).toLowerCase();
    if (lower.includes(id.toLowerCase()) || (caption && lower.includes(caption))) return id;
  }
  return "";
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
