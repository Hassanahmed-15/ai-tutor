import type { DrawScript } from "@/components/sketch/LiveSketch";
import type { Beat } from "./lessonContent";

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
  const assets = (input.assets ?? []).map((asset) => ({
    id: asset.id,
    caption: clean(asset.caption),
    description: clean(asset.description),
    width: asset.width,
    height: asset.height,
    sourceBlockIds: asset.sourceBlockIds ?? [],
    teachingUse: asset.teachingUse,
  }));

  const blocks = (input.contentBlocks ?? [])
    .slice()
    .sort((a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0))
    .map((block) => ({
      id: block.id,
      type: block.type ?? "section",
      heading: clean(block.heading),
      text: clean(block.text).slice(0, 1400),
      items: (block.items ?? []).slice(0, 8),
      columns: block.columns,
      rows: block.rows?.slice(0, 8),
      assetIds: block.assetIds ?? [],
      keyIdeas: block.keyIdeas ?? [],
      teachingHints: block.teachingHints ?? [],
      facts: block.facts ?? [],
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
  let hydrated = 0;

  for (const beat of beats) {
    for (const op of beat.draw?.ops ?? []) {
      if (op.kind !== "image") continue;
      const imageOp = op as ImageOp;
      const assetId = imageOp.assetId ?? imageOp.providedAssetId ?? inferAssetIdFromPrompt(imageOp.prompt, assets);
      if (!assetId || imageOp.src) continue;
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
    if (!wantsPaper && (svgBoards < MAX_SUPRNOTES_SVG_BOARDS || isPlannedSvg) && wantsSvg) {
      beat.draw = generatedSvgPaperBoard(beat, block);
      svgBoards++;
    } else {
      beat.draw = sourceNotePaperBoard(beat, block);
    }
    changed++;
  });

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
  const blocks = sourceDocument?.contentBlocks
    ?.slice()
    .sort((a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0));
  if (!blocks?.length) return 0;

  let repaired = 0;
  const usedBlocks = new Set<string>();
  beats.forEach((beat, index) => {
    const animationOp = beat.draw?.ops.find((op) => op.kind === "reactAnimation");
    if (!animationOp || animationOp.code) return;
    const planBeat = plannedBeatForBeat(sourceDocument, beat, index);
    const block = blockForPlanBeat(planBeat, blocks) ?? bestBlockForBeat(beat, blocks, usedBlocks, index);
    if (!block) return;
    usedBlocks.add(block.id);
    animationOp.code = fallbackWhiteboardSvgCode(beat, block);
    animationOp.status = "ready";
    animationOp.error = undefined;
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
  for (const asset of sourceDocument.assets) {
    if (!asset.id || usedAssetIds.has(asset.id)) continue;
    const src = sourceForBrowser(asset);
    if (!src) continue;
    const targetIndex = bestBeatForAsset(beats, asset, blocks);
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
    if (chalkOp?.kind === "chalkBoard" && chalkOp.ops?.length) {
      chalkOp.ops = layoutPaperTextBoard(chalkOp.ops, beat.title);
      continue;
    }

    const imageOp = beat.draw.ops.find((op): op is ImageOp => op.kind === "image");
    if (imageOp) {
      beat.draw.ops = layoutPaperImageBoard(beat.draw.ops, beat.title, imageOp, assets);
      continue;
    }

    const animationOp = beat.draw.ops.find((op) => op.kind === "reactAnimation");
    if (animationOp) continue;

    const hasStructuredInk = beat.draw.ops.some(
      (op) => op.kind === "shape" || op.kind === "arrow" || op.kind === "underline" || op.kind === "circleHighlight"
    );
    const hasEnoughText = beat.draw.ops.filter((op) => op.kind === "label" || op.kind === "note").length >= 4;
    if (hasStructuredInk && hasEnoughText) continue;

    beat.draw.ops = layoutPaperTextBoard(beat.draw.ops, beat.title);
  }
}

function generatedSvgPaperBoard(beat: Beat, block: SuprnotesContentBlock): DrawScript {
  const heading = clean(block.heading) || beat.title;
  return {
    caption: heading,
    durationMs: beat.draw?.durationMs ?? 26000,
    surface: "paper",
    ops: [{
      kind: "reactAnimation",
      teachingPoint: suprnotesSvgBrief(beat, block),
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
  const symbols = formulaTokens([heading, block.text, ...ideas].join(" ")).slice(0, 3);
  symbols.forEach((symbol, index) => {
    ops.push({
      kind: "label",
      text: symbol,
      x: 68 + index * 9,
      y: 80,
      size: "sm",
      color: colors[(index + 1) % colors.length],
      at: 0.62 + index * 0.08,
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

function suprnotesSvgBrief(beat: Beat, block: SuprnotesContentBlock): string {
  const heading = clean(block.heading) || beat.title;
  const ideas = boardIdeas(block).slice(0, 5);
  const table = block.rows?.length
    ? `Table/comparison data: columns=${(block.columns ?? []).join(" | ")}; rows=${block.rows.map((row) => row.join(" | ")).join("; ")}.`
    : "";
  const formulas = formulaTokens([heading, block.text, ...ideas].join(" ")).slice(0, 6);
  return [
    "SUPRNOTES_WHITEBOARD_SVG_BOARD",
    `Board title: ${heading}.`,
    `Beat title: ${beat.title}.`,
    `Source text: ${shortText(block.text ?? beat.script, 520)}`,
    ideas.length ? `Key ideas to show, using plain accurate labels: ${ideas.map((idea) => shortText(idea, 120)).join(" / ")}.` : "",
    formulas.length ? `Important symbols/examples from the notes: ${formulas.join(", ")}.` : "",
    table,
    "Create a clean whiteboard-style SVG scene grounded in these notes. Use real subject-specific visuals, not generic bubbles: diagrams, comparison panels, molecular/structural sketches, arrows, annotations, or simple illustrated objects as appropriate. Keep labels short and readable; no clipped text; no filler. Leave wide margins and place the main visual center/right with explanatory labels in clear zones around it.",
  ].filter(Boolean).join("\n");
}

function fallbackWhiteboardSvgCode(beat: Beat, block: SuprnotesContentBlock): string {
  const heading = clean(block.heading) || beat.title;
  const ideas = boardIdeas(block).slice(0, 4).map((idea) => shortText(idea, 82));
  const symbols = formulaTokens([heading, block.text, ...ideas].join(" ")).slice(0, 5);
  const columns = (block.columns ?? []).slice(0, 3).map((column) => shortText(column, 24));
  const rows = (block.rows ?? []).slice(0, 4).map((row) => row.slice(0, 3).map((cell) => shortText(cell, 26)));
  const tableMode = rows.length > 0;
  const data = JSON.stringify({ heading: boardTitle(heading), ideas, symbols, columns, rows, tableMode });

  return `export default function Animation({ progress }) {
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  const data = ${data};
  const colors = ["#14b8a6", "#3b82f6", "#be185d", "#65a30d", "#d97706"];
  const show = (i) => Math.max(0, Math.min(1, (p - i * 0.08) / 0.18));
  const textStyle = { fontFamily: "'Comic Sans MS','Trebuchet MS',sans-serif", fontWeight: 800, letterSpacing: 0 };
  return (
    <div style={{ width: "100%", height: "100%", background: "#fbfbf8" }}>
      <svg viewBox="0 0 1000 560" width="100%" height="100%" role="img" aria-label={data.heading}>
        <rect width="1000" height="560" fill="#fbfbf8" />
        <g opacity="0.22">
          {Array.from({ length: 18 }).map((_, i) => <line key={"v"+i} x1={40+i*54} y1="0" x2={40+i*54} y2="560" stroke="#e5e7eb" strokeWidth="1" />)}
          {Array.from({ length: 10 }).map((_, i) => <line key={"h"+i} x1="0" y1={42+i*52} x2="1000" y2={42+i*52} stroke="#e5e7eb" strokeWidth="1" />)}
        </g>
        <g opacity={show(0)}>
          <text x="500" y="70" textAnchor="middle" fill="#747b85" fontSize="34" style={textStyle}>{data.heading}</text>
          <path d="M 360 86 Q 500 104 640 86" fill="none" stroke="#9ca3af" strokeWidth="5" strokeLinecap="round" />
        </g>
        {data.tableMode ? (
          <g opacity={show(1)}>
            <rect x="120" y="138" width="760" height="270" rx="22" fill="#ffffff" stroke="#d1d5db" strokeWidth="3" />
            {data.columns.map((col, i) => <text key={col+i} x={220+i*260} y="186" textAnchor="middle" fill={colors[i % colors.length]} fontSize="25" style={textStyle}>{col}</text>)}
            <line x1="150" y1="210" x2="850" y2="210" stroke="#d1d5db" strokeWidth="3" />
            {data.rows.map((row, r) => (
              <g key={r} opacity={show(r+2)}>
                <rect x="150" y={230+r*42} width="700" height="31" rx="14" fill={r % 2 ? "#f8fafc" : "#ffffff"} stroke="#eef2f7" />
                {row.map((cell, c) => <text key={c} x={220+c*260} y={252+r*42} textAnchor="middle" fill={c===0 ? colors[r % colors.length] : "#6b7280"} fontSize={c===0 ? 22 : 18} style={textStyle}>{cell}</text>)}
              </g>
            ))}
          </g>
        ) : (
          <g>
            {data.ideas.map((idea, i) => (
              <g key={i} opacity={show(i+1)}>
                <circle cx="125" cy={165+i*70} r="18" fill="#ffffff" stroke={colors[i % colors.length]} strokeWidth="7" />
                <text x="170" y={174+i*70} fill={i===0 ? colors[i % colors.length] : "#6b7280"} fontSize={i===0 ? 27 : 23} style={textStyle}>{idea}</text>
              </g>
            ))}
            <g opacity={show(3)}>
              <ellipse cx="735" cy="250" rx="124" ry="86" fill="#eef6ff" stroke="#3b82f6" strokeWidth="7" />
              <ellipse cx="735" cy="250" rx="52" ry="34" fill="#ffffff" stroke="#14b8a6" strokeWidth="5" />
              {(data.symbols.length ? data.symbols : [data.heading.split(" ")[0]]).slice(0,3).map((symbol, i) => (
                <text key={i} x={650+i*82} y={355+i%2*38} textAnchor="middle" fill={colors[(i+1)%colors.length]} fontSize="30" style={textStyle}>{symbol}</text>
              ))}
              <path d="M 590 250 C 640 210, 685 210, 735 250 S 830 290, 880 250" fill="none" stroke="#9ca3af" strokeWidth="5" strokeLinecap="round" />
            </g>
          </g>
        )}
        <g opacity={show(5)}>
          <path d="M 176 470 Q 500 506 824 470" fill="none" stroke="#14b8a6" strokeWidth="6" strokeLinecap="round" />
        </g>
      </svg>
    </div>
  );
}`;
}

function layoutPaperImageBoard(
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

function layoutCalloutAroundImage(op: CalloutOp, index: number, box: { x: number; y: number; w: number; h: number }): CalloutOp {
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
  const target = targetSlots[index % targetSlots.length];
  const label = labelSlots[index % labelSlots.length];
  return {
    ...op,
    text: shortText(op.text, 28),
    x: clamp(target.x, box.x - box.w / 2 + 6, box.x + box.w / 2 - 6),
    y: clamp(target.y, box.y - box.h / 2 + 6, box.y + box.h / 2 - 6),
    labelX: label.x,
    labelY: label.y,
    color: op.color ?? markerColor(index),
    at: 0.18 + index * 0.13,
  };
}

function layoutPaperTextBoard(ops: DrawOp[], title: string): DrawOp[] {
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
  const callouts = assetCalloutLabels(asset).slice(0, 4).map((text, index): CalloutOp => ({
    kind: "callout",
    text,
    x: 50,
    y: 50,
    labelX: 20,
    labelY: 28 + index * 14,
    color: markerColor(index + 1),
    at: 0.22 + index * 0.12,
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
        x: 55,
        y: 55,
        w: 62,
        h: 50,
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

function formulaTokens(value: string): string[] {
  const matches = value.match(/\b(?:[A-Z][a-z]?\d*[+\-]?)(?:[-–][A-Z][a-z]?\d*[+\-]?|\s*[+→]\s*[A-Z][a-z]?\d*[+\-]?)*\b/g) ?? [];
  return dedupeRows(matches.map((match) => match.replace(/\s+/g, " ").trim()).filter((match) => /[A-Z]/.test(match))).slice(0, 6);
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
    const score = searchTerms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0)
      + (index === 0 ? -4 : 0)
      + (hasImage ? -2 : 0);
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
  return shortText(value, 42).toUpperCase();
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
