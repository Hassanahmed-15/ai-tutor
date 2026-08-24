import OpenAI from "openai";
import type { SuprnotesLessonInput } from "./suprnotes";
import { costFor } from "./modelPricing";

/**
 * Vision descriptor — "give the image to the teacher". For each provided image asset, one gpt-4o
 * vision call LOOKS AT the actual picture and writes a concrete description of what is really drawn
 * (axes, curves, points, labeled parts, regions, values). We overwrite asset.description with it so
 * every downstream agent teaches from the real image, not the upstream relevant_images.json text:
 *   - the Director (via compactSuprnotesForPrompt) writes a script that explains the real picture,
 *   - the Image-Explainer (lib/imageCalloutGen.ts) labels real visible parts.
 * On any failure/timeout the existing description is kept, so this only ever improves grounding.
 */

const MODEL = process.env.OPENAI_VISION_MODEL ?? "gpt-4o";
const MAX_TOKENS = 400;
const PER_IMAGE_TIMEOUT_MS = 25_000;

const SYSTEM_PROMPT =
  "You are describing a single teaching image (a diagram, chart, infographic, or photo) so a teacher " +
  "can explain it accurately. Look at the image and write 2-4 plain sentences stating ONLY what is " +
  "actually visible: the type of visual, the concrete objects/axes/curves/points/regions/arrows, any " +
  "readable labels or values, and how the parts relate. Name specific visible parts a teacher could " +
  "point at. Do NOT speculate about anything not shown, do NOT add background theory, and do NOT use " +
  "markdown. If text is visible in the image, quote the key labels exactly.";

function costUsd(usage: OpenAI.Chat.Completions.ChatCompletion["usage"] | undefined): number {
  return costFor(MODEL, usage);
}

async function describeOne(client: OpenAI, dataUri: string, caption: string): Promise<{ description: string | null; costUsd: number }> {
  try {
    const completion = await client.chat.completions.create(
      {
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: caption ? `This image is captioned "${caption}". Describe what is actually shown.` : "Describe what is actually shown in this image." },
              { type: "image_url", image_url: { url: dataUri, detail: "low" } },
            ],
          },
        ],
        max_tokens: MAX_TOKENS,
        temperature: 0.2,
      },
      { timeout: PER_IMAGE_TIMEOUT_MS },
    );
    const text = completion.choices[0]?.message?.content?.trim() ?? "";
    return { description: text || null, costUsd: costUsd(completion.usage) };
  } catch (err) {
    console.error(`[vision] describe failed: ${err instanceof Error ? err.message : "error"}`);
    return { description: null, costUsd: 0 };
  }
}

/**
 * Enrich each image asset's `description` in place from the actual pixels. Runs before the director
 * so the whole pipeline teaches from what's really in the picture. Returns total cost.
 */
export async function describeAssetsWithVision(client: OpenAI, sourceDocument: SuprnotesLessonInput | null): Promise<number> {
  const assets = (sourceDocument?.assets ?? []).filter(
    (a) =>
      a.visionVerified !== true &&
      typeof a.url === "string" &&
      a.url.startsWith("data:image"),
  );
  if (!assets.length) return 0;

  const results = await Promise.all(
    assets.map(async (asset) => {
      const { description, costUsd: c } = await describeOne(client, asset.url as string, (asset.caption ?? "").trim());
      if (description) {
        // Keep any prior caption as a lead-in; vision text becomes the authoritative description.
        asset.description = description;
        console.error(`[vision] asset=${asset.id} -> ${description.slice(0, 90)}`);
      }
      return c;
    }),
  );
  return results.reduce((sum, c) => sum + c, 0);
}
