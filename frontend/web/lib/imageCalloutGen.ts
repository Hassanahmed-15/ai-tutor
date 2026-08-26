import OpenAI from "openai";
import type { Beat } from "./lessonContent";
import { splitNarrationSentences } from "./voice";
import { layoutGroundedCalloutsAroundImage, type SuprnotesLessonInput } from "./suprnotes";
import type { DrawScript } from "@/components/sketch/LiveSketch";
import { costFor } from "./modelPricing";

/**
 * Image-Explainer agent — the multi-agent step that makes provided images "explained properly".
 * For each beat showing a real provided image, it asks the model for 2-4 SHORT labels naming real
 * things VISIBLE in that image (grounded ONLY in the image's relevant_images.json description),
 * each tagged with the sentence that explains it. We then place the labels around the image
 * (layoutCalloutAroundImage) and re-assert the sentence-synced reveal timing, and mark them
 * `grounded:true` so cleanProvidedImageBoards preserves them across the repeated finalize passes.
 *
 * Mirrors blackboardGen.ts (same fill/stream shape). Cheap: one gpt-4o-mini call per image beat.
 */

// Kept local to this file (not in lib/drawPrompt.ts) so that file's prompt text stays byte-for-byte
// unchanged — it backs the existing topic-based and PPTX/Suprnotes-JSON lecture generation.
const IMAGE_EXPLAINER_SYSTEM_PROMPT = `You are Aria's image-explainer. A real teaching image is on the board with numbered, coordinate-verified focus regions. Select only the regions the spoken explanation actually discusses.

You are given the image's DESCRIPTION, numbered FOCUS REGIONS, and the spoken script split into NUMBERED SENTENCES (0..N-1). Output JSON: { "callouts": [ { "group": number, "regionIndex": number } ] }.

RULES:
- Select only supplied focus regions. Their verified labels and coordinates are applied by code; do not rename or reinterpret them.
- "group": the index of the sentence that explains/mentions that part, so the label appears exactly when the teacher talks about it. Order callouts so their groups increase (top-to-bottom reveal).
- "regionIndex": the exact matching numbered focus region. Never substitute, clamp, or guess another region.
- 2-4 callouts maximum. Sparse and accurate beats many. No duplicate regionIndex values.

Output ONLY the JSON object.`;

type DrawOp = DrawScript["ops"][number];
type ImageOp = Extract<DrawOp, { kind: "image" }> & { assetId?: string; src?: string };
type CalloutOp = Extract<DrawOp, { kind: "callout" }>;
export type FocusRegion = { label: string; x: number; y: number; width: number; height: number };

const MODEL = process.env.OPENAI_IMAGE_EXPLAINER_MODEL ?? "gpt-4o-mini";
const MAX_TOKENS = 1_200;

export type ImageCalloutFillStats = { costUsd: number; pending: number; filled: number; rejected: number; issues: string[] };
export type ImageCalloutFillUpdate = { beat: Beat; beatIndex: number; costUsd: number; status: "ready" | "failed" };

export function sanitizeFocusRegions(rawRegions: unknown): FocusRegion[] {
  if (!Array.isArray(rawRegions)) return [];
  return rawRegions.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const region = raw as Record<string, unknown>;
    const label = typeof region.label === "string" ? region.label.replace(/\s+/g, " ").trim() : "";
    const x = Number(region.x);
    const y = Number(region.y);
    const width = Number(region.width);
    const height = Number(region.height);
    if (
      !label || ![x, y, width, height].every(Number.isFinite) ||
      x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1 || y + height > 1
    ) return [];
    return [{ label: label.slice(0, 24), x, y, width, height }];
  }).slice(0, 8);
}

/** Turn model selections into arrows only when they name an exact, verified region. */
export function buildGroundedImageCallouts(
  rawCallouts: unknown,
  focusRegions: FocusRegion[],
  sentenceCount: number,
  box: { x: number; y: number; w: number; h: number },
): CalloutOp[] {
  if (!Array.isArray(rawCallouts) || focusRegions.length === 0) return [];
  const n = Math.max(1, sentenceCount);
  const usedRegions = new Set<number>();
  const callouts: CalloutOp[] = [];
  for (const raw of rawCallouts.slice(0, 4)) {
    if (!raw || typeof raw !== "object") continue;
    const rec = raw as Record<string, unknown>;
    const regionIndex = Number(rec.regionIndex);
    if (!Number.isInteger(regionIndex) || regionIndex < 0 || regionIndex >= focusRegions.length || usedRegions.has(regionIndex)) continue;
    const region = focusRegions[regionIndex];
    const rawGroup = Number(rec.group);
    const group = Number.isFinite(rawGroup) ? Math.max(0, Math.min(n - 1, Math.floor(rawGroup))) : 0;
    usedRegions.add(regionIndex);
    callouts.push({
      kind: "callout",
      // The region detector owns both the label and target. The explainer may select it, not rename it.
      text: region.label,
      x: box.x - box.w / 2 + (region.x + region.width / 2) * box.w,
      y: box.y - box.h / 2 + (region.y + region.height / 2) * box.h,
      at: (group + 1) / n,
      group,
      grounded: true,
    });
  }
  return layoutGroundedCalloutsAroundImage(callouts, box);
}

function costUsd(usage: OpenAI.Chat.Completions.ChatCompletion["usage"] | undefined): number {
  return costFor(MODEL, usage);
}

async function generateOne(
  client: OpenAI,
  beat: Beat,
  imageOp: ImageOp,
  description: string,
  focusRegions: FocusRegion[],
): Promise<{ costUsd: number; filled: boolean }> {
  const sentences = splitNarrationSentences(beat.script);
  const n = Math.max(1, sentences.length);
  const numbered = sentences.map((s, i) => `[${i}] ${s}`).join("\n");
  const user = [
    `Image description (what is actually in the image): ${description}`,
    focusRegions.length
      ? `Visible focus regions (coordinates are already grounded to the image):\n${focusRegions.map((region, index) => `[${index}] ${region.label}`).join("\n")}`
      : "No grounded focus regions were supplied; choose only parts explicitly supported by the description.",
    `Spoken script, numbered sentences (tag each callout's "group" with the sentence that explains that part):`,
    numbered || `[0] ${beat.script}`,
    `There are ${n} sentences (groups 0..${n - 1}). Pick 2-4 real visible parts to label — or fewer if the description does not support that many.`,
  ].join("\n\n");

  let cost = 0;
  try {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: IMAGE_EXPLAINER_SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
      temperature: 0.3,
      max_tokens: MAX_TOKENS,
      response_format: { type: "json_object" },
    });
    cost = costUsd(completion.usage);
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
    const list = Array.isArray(parsed.callouts) ? parsed.callouts : [];

    const box = {
      x: typeof imageOp.x === "number" ? imageOp.x : 50,
      y: typeof imageOp.y === "number" ? imageOp.y : 56,
      w: typeof imageOp.w === "number" ? imageOp.w : 66,
      h: typeof imageOp.h === "number" ? imageOp.h : 54,
    };

    const callouts = buildGroundedImageCallouts(list, focusRegions, n, box);

    if (!callouts.length) return { costUsd: cost, filled: false };
    beat.draw?.ops.push(...callouts);
    console.error(`[image-explainer] beat=${beat.id} callouts=${callouts.length} -> ${callouts.map((c) => c.text).join(" | ")}`);
    return { costUsd: cost, filled: true };
  } catch (err) {
    console.error(`[image-explainer] beat=${beat.id} failed: ${err instanceof Error ? err.message : "error"}`);
    return { costUsd: cost, filled: false };
  }
}

export async function fillImageCalloutOpsIncremental(
  client: OpenAI,
  beats: Beat[],
  sourceDocument: SuprnotesLessonInput | null,
  onUpdate?: (update: ImageCalloutFillUpdate) => void | Promise<void>,
  options: { limit?: number } = {},
): Promise<ImageCalloutFillStats> {
  const assets = new Map((sourceDocument?.assets ?? []).filter((a) => a.id).map((a) => [a.id, a]));

  const pending: Array<{ beat: Beat; beatIndex: number; imageOp: ImageOp; description: string; focusRegions: FocusRegion[] }> = [];
  for (let beatIndex = 0; beatIndex < beats.length; beatIndex++) {
    const beat = beats[beatIndex];
    const ops = beat.draw?.ops ?? [];
    const imageOp = ops.find((o): o is ImageOp => o.kind === "image" && Boolean((o as ImageOp).src));
    if (!imageOp) continue;
    if (ops.some((o) => o.kind === "callout" && o.grounded === true)) continue; // already explained
    const asset = imageOp.assetId ? assets.get(imageOp.assetId) : undefined;
    const description = [asset?.description, asset?.caption].map((s) => (s ?? "").trim()).filter(Boolean).join(" — ");
    if (!description) continue;
    const teachingUse = asset?.teachingUse && typeof asset.teachingUse === "object"
      ? asset.teachingUse as Record<string, unknown>
      : null;
    if (teachingUse?.annotationNeeded === false) continue;
    const focusRegions = sanitizeFocusRegions(teachingUse?.focusRegions);
    // No verified target means no arrow. Keep the source image clean rather than guessing.
    if (focusRegions.length === 0) continue;
    pending.push({ beat, beatIndex, imageOp, description, focusRegions });
  }

  const selected = typeof options.limit === "number" ? pending.slice(0, Math.max(0, options.limit)) : pending;
  if (selected.length === 0) return { costUsd: 0, pending: 0, filled: 0, rejected: 0, issues: [] };

  const results = await Promise.all(
    selected.map(async ({ beat, beatIndex, imageOp, description, focusRegions }) => {
      const result = await generateOne(client, beat, imageOp, description, focusRegions);
      await onUpdate?.({ beat, beatIndex, costUsd: result.costUsd, status: result.filled ? "ready" : "failed" });
      return result;
    }),
  );
  const filled = results.filter((r) => r.filled).length;
  return {
    costUsd: results.reduce((sum, r) => sum + r.costUsd, 0),
    pending: selected.length,
    filled,
    rejected: selected.length - filled,
    issues: [],
  };
}
