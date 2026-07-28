import OpenAI from "openai";
import type { Beat } from "./lessonContent";
import { splitNarrationSentences } from "./voice";
import { layoutCalloutAroundImage, type SuprnotesLessonInput } from "./suprnotes";
import type { DrawScript } from "@/components/sketch/LiveSketch";

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
const IMAGE_EXPLAINER_SYSTEM_PROMPT = `You are Aria's image-explainer. A real teaching image (a photo, diagram, or infographic slide) is on the board, and the teacher is talking the student through it. Pick 2-4 SHORT labels that name REAL things VISIBLE in THIS specific image, so the teacher can point at each part as they explain it.

You are given the image's DESCRIPTION, optional numbered FOCUS REGIONS, and the spoken script split into NUMBERED SENTENCES (0..N-1). Output JSON: { "callouts": [ { "text": string, "group": number, "regionIndex": number } ] }.

RULES:
- Ground every label ONLY in the DESCRIPTION. Name a concrete thing that is actually shown (a curve, a point, an axis, a region, a labeled part, an object, a value). NEVER invent a label the description does not support. If the description names fewer than 2 distinct visible parts, return FEWER callouts (even zero) rather than making things up.
- "text": <= 24 characters, a real visible part — NOT a concept, formula, or a restatement of the sentence.
- "group": the index of the sentence that explains/mentions that part, so the label appears exactly when the teacher talks about it. Order callouts so their groups increase (top-to-bottom reveal).
- "regionIndex": the matching numbered focus region when focus regions are supplied. Never point a label at a different region.
- 2-4 callouts maximum. Sparse and accurate beats many. No duplicates. No label may repeat the board title.

Output ONLY the JSON object.`;

type DrawOp = DrawScript["ops"][number];
type ImageOp = Extract<DrawOp, { kind: "image" }> & { assetId?: string; src?: string };
type CalloutOp = Extract<DrawOp, { kind: "callout" }>;
type FocusRegion = { label: string; x: number; y: number; width: number; height: number };

const MODEL = process.env.OPENAI_IMAGE_EXPLAINER_MODEL ?? "gpt-4o-mini";
const MAX_TOKENS = 1_200;
const INPUT_PRICE = 0.15 / 1_000_000; // gpt-4o-mini
const OUTPUT_PRICE = 0.6 / 1_000_000;

export type ImageCalloutFillStats = { costUsd: number; pending: number; filled: number; rejected: number; issues: string[] };
export type ImageCalloutFillUpdate = { beat: Beat; beatIndex: number; costUsd: number; status: "ready" | "failed" };

function costUsd(usage: OpenAI.Chat.Completions.ChatCompletion["usage"] | undefined): number {
  return usage ? usage.prompt_tokens * INPUT_PRICE + usage.completion_tokens * OUTPUT_PRICE : 0;
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

    const callouts: CalloutOp[] = [];
    list.slice(0, 4).forEach((raw, index) => {
      if (!raw || typeof raw !== "object") return;
      const rec = raw as Record<string, unknown>;
      const text = typeof rec.text === "string" ? rec.text.trim() : "";
      if (!text) return;
      const g = Number(rec.group);
      const group = Number.isFinite(g) ? Math.max(0, Math.min(n - 1, Math.floor(g))) : index;
      const rawRegionIndex = Number(rec.regionIndex);
      const regionIndex = Number.isFinite(rawRegionIndex)
        ? Math.max(0, Math.min(focusRegions.length - 1, Math.floor(rawRegionIndex)))
        : index % Math.max(1, focusRegions.length);
      const region = focusRegions[regionIndex];
      const targetX = region
        ? box.x - box.w / 2 + (region.x + region.width / 2) * box.w
        : box.x;
      const targetY = region
        ? box.y - box.h / 2 + (region.y + region.height / 2) * box.h
        : box.y;
      const base: CalloutOp = {
        kind: "callout",
        text,
        x: targetX,
        y: targetY,
        at: (group + 1) / n,
        grounded: Boolean(region),
      };
      const laid = layoutCalloutAroundImage(base, index, box);
      // layoutCalloutAroundImage overwrites `at` with an even spread — re-assert sentence timing so
      // the label appears exactly as its sentence is spoken, and mark it grounded so it survives.
      callouts.push({ ...laid, at: (group + 1) / n, group, grounded: true });
    });

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
    const focusRegions = Array.isArray(teachingUse?.focusRegions)
      ? teachingUse.focusRegions.flatMap((raw) => {
          if (!raw || typeof raw !== "object") return [];
          const region = raw as Record<string, unknown>;
          const label = typeof region.label === "string" ? region.label.trim() : "";
          const x = Number(region.x);
          const y = Number(region.y);
          const width = Number(region.width);
          const height = Number(region.height);
          if (!label || ![x, y, width, height].every(Number.isFinite)) return [];
          return [{ label, x, y, width, height }];
        }).slice(0, 8)
      : [];
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
