import OpenAI from "openai";
import type { Beat } from "./lessonContent";
import type { DrawScript } from "@/components/sketch/LiveSketch";
import { fallbackExplanationDraw, fallbackWrittenDraw, hasUsefulExplanationVisual } from "./drawSanitize";
import { priceFor } from "./modelPricing";

/**
 * Second step of the two-step generate-then-render pipeline. Takes beats whose DrawScript
 * ops already contain `{ kind: "image", prompt }` placeholders (written by the text model
 * in step 1), calls the configured image model to fill each one with a real base64 image, then mutates
 * the ops array in place so callers can return the enriched beats directly.
 *
 * Runs all image generations in parallel (Promise.all) to keep wall-clock latency bounded
 * to roughly one image's generation time rather than multiplying by beat count.
 *
 * If an individual image fails (content policy, rate limit, network) after 2 attempts:
 *  - The failed image op is dropped from the board.
 *  - The rest of the board (marker labels/notes/arrows) still renders normally.
 *  - If dropping the image leaves the board with no visual content at all,
 *    fallbackExplanationDraw() synthesizes a replacement image-placeholder board, which is
 *    then generated in a second round.
 *  - If the fallback image also fails, fallbackWrittenDraw() turns the beat into a dense
 *    blackboard so the client never receives a blank or half-empty teaching surface.
 *
 * Honesty: each generated landscape image costs a small but real amount.
 * A 12-beat lecture usually has 4-6 image-led boards after sanitizer variety enforcement.
 */

type ImageDrawOp = Extract<DrawScript["ops"][number], { kind: "image" }>;
type PendingImageRef = {
  beat: Beat;
  beatIndex: number;
  op: ImageDrawOp;
};

export type ImageFillStats = {
  costUsd: number;
  pending: number;
  filled: number;
  failed: number;
};

export type ImageFillUpdate = {
  beat: Beat;
  beatIndex: number;
  costUsd: number;
  phase: "image" | "fallback";
};

// Image pricing fallback: $0.011 per low-quality image when usage data is absent.
// We use actual per-token usage from the API response when available, falling back to the
// flat per-image rate when the response omits usage data.
// Source: https://openai.com/api/pricing/
const IMAGE_FLAT_RATE = 0.011;                    // conservative fallback for one low-quality image
// "gpt-image-1" is the only OpenAI image model that exists today (confirmed against the
// installed SDK's ImageModel union: 'dall-e-2' | 'dall-e-3' | 'gpt-image-1' — there is no
// "gpt-image-2"). A prior config pointed at that nonexistent model first, which meant every
// single image silently failed once, burned a network round-trip, then fell back — the direct
// cause of multi-minute generation times. "1536x1024" is gpt-image-1's actual valid landscape
// size (its size enum is 1024x1024 | 1536x1024 | 1024x1536 | auto — NOT 1792x1024, which is a
// dall-e-3-only size and would have errored too).
const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-1";
// Priced from the shared table so a change of IMAGE_MODEL cannot leave a stale rate behind.
const IMAGE_INPUT_TOKEN_PRICE = priceFor(IMAGE_MODEL).input / 1_000_000;
const IMAGE_OUTPUT_TOKEN_PRICE = priceFor(IMAGE_MODEL).output / 1_000_000;
type ImageSize = "auto" | "1536x1024" | "1024x1024" | "1024x1536" | "256x256" | "512x512";
const IMAGE_SIZE: ImageSize = (process.env.OPENAI_IMAGE_SIZE as ImageSize | undefined) ?? "1536x1024";
const IMAGE_ATTEMPTS = [{ model: IMAGE_MODEL, size: IMAGE_SIZE }];
// "medium" quality per explicit user choice — sharper, more professional images than "low",
// at roughly 3x the per-image token cost (still a few cents each).
type ImageQuality = "low" | "medium" | "high" | "auto";
const IMAGE_QUALITY: ImageQuality = (process.env.OPENAI_IMAGE_QUALITY as ImageQuality | undefined) ?? "medium";

/**
 * Neutralizes clearly text-bearing nouns in a model-authored image prompt before it reaches
 * the image model. gpt-image-1 will happily render legible signage/labels/menus if the scene
 * description invites them, defeating the "NO TEXT" instruction — so we scrub the summoning
 * nouns out of the scene itself. Deliberately narrow (only unambiguous text-surfaces) to avoid
 * mangling legitimate scenes; the prompt-level "NO TEXT" clauses catch whatever slips through.
 */
export function stripTextInvitingPhrases(prompt: string): string {
  return prompt
    // "labeled/labelled shelves" -> "stocked shelves"; generic "labeled X" -> "X"
    .replace(/\blabell?ed\s+shelves\b/gi, "stocked shelves")
    .replace(/\blabell?ed\s+/gi, "")
    // "price sign(s)" / "price tag(s)" -> "displayed goods"
    .replace(/\bprice\s+(?:sign|tag)s?\b/gi, "displayed goods")
    // storefront "with names/signage" qualifier
    .replace(/\bwith\s+(?:names|signage|signs|lettering|text)\b/gi, "")
    // text-surface nouns -> SUBSTITUTE a concrete text-free object rather than deleting, so
    // the scene keeps its content instead of ending up with a vague hole where detail was
    .replace(/\bmenus?\b/gi, "plated dishes on display")
    .replace(/\bposters?\b/gi, "bare brick wall")
    .replace(/\bbanners?\b/gi, "strings of colorful bunting")
    .replace(/\bbillboards?\b/gi, "tall rooftops")
    .replace(/\bmarquees?\b/gi, "striped awnings")
    .replace(/\bsignage\b/gi, "striped awnings")
    .replace(/\bsigns?\b/gi, "hanging lanterns")
    // ── tidy up the wreckage left by removed nouns ──
    // collapse repeated commas ("x,, and y" -> "x, and y")
    .replace(/,(\s*,)+/g, ",")
    // drop a comma stranded before a conjunction ("x, and neon" stays; ", and neon" -> "and neon")
    .replace(/(^|\band\b|\bwith\b|\bof\b)\s*,\s*/gi, "$1 ")
    // remove list connectors left dangling before a comma/period ("and , " / "with .")
    .replace(/\b(with|and|of)\s+(?=[,.])/gi, "")
    // "with and neon" / "with , and" leftovers -> clean the connector run
    .replace(/\bwith\s+and\b/gi, "with")
    .replace(/\band\s+and\b/gi, "and")
    // strip a trailing dangling connector ("... on the wall" is fine; "chef and" -> "chef")
    .replace(/\b(with|and|of)\s*$/i, "")
    // normalize whitespace and space-before-punctuation
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.])/g, "$1")
    .replace(/,\s*(and\b)/gi, ", $1")
    .trim();
}

const NO_TEXT_DIRECTIVE = `CRITICAL: This image must contain ZERO text, letters, numbers, or symbols of any kind — no storefront signage, no price tags, no book spines with titles, no banners, no chalkboards or whiteboards with writing, no product labels facing camera, no posters, no street signs, no menus, no printed paper, no screens showing text, no charts or graphs with axis labels. If a real version of this scene would have text, frame it so the text is out of view, blurred, or absent.`;

/** Extra fields attached to a pending image op by fillImageOps before generation. */
type EnrichedImageOp = ImageDrawOp & { _calloutHints?: string; _teachingPoint?: string };

/**
 * Subject-aware lighting/texture cue appended to the style suffix. One generic
 * "professional camera, cinematic lighting" suffix for every topic is a big reason images
 * came out interchangeable — a market beat and a lab beat deserve different atmospheres.
 */
function subjectStyleCue(scene: string): string {
  const s = scene.toLowerCase();
  if (/(market|stall|vendor|shop|store|bazaar|grocer)/.test(s)) return "Weathered wood textures, crates and burlap, warm morning sunlight, vivid produce colors.";
  if (/(lab|laborator|scientist|microscope|chemical|experiment|specimen)/.test(s)) return "Cool fluorescent light, brushed steel and glassware reflections, precise clinical detail.";
  if (/(leaf|plant|forest|tree|flower|garden|meadow|nature|animal|insect|bird|cell)/.test(s)) return "Macro natural detail, dew and visible surface texture, soft diffused daylight.";
  if (/(kitchen|cook|chef|bak(e|ing|er)|food|meal|restaurant)/.test(s)) return "Warm tungsten glow, rising steam, worn cutting boards and copper pans, appetizing color.";
  if (/(factory|workshop|machin|assembly|tool|construction|forge|warehouse)/.test(s)) return "Industrial haze, worn metal and sparks, strong directional work lights, gritty texture.";
  if (/(space|planet|star|galax|orbit|astronaut|telescope|moon)/.test(s)) return "Deep blacks with pin-sharp highlights, dramatic rim lighting, vast sense of scale.";
  if (/(ocean|sea|river|water|wave|rain|storm|cloud|volcan|mountain|desert|glacier|lava)/.test(s)) return "Dramatic natural light, atmospheric depth, rich elemental texture and visible motion.";
  if (/(city|street|crowd|traffic|building|urban|station)/.test(s)) return "Golden-hour side light, long shadows, layered depth from foreground to skyline.";
  if (/(ancient|medieval|castle|ruin|histor|museum|temple|battle)/.test(s)) return "Aged stone and patina textures, shafts of window light, quiet documentary framing.";
  return "Strong focal subject, rich color, tactile real-world texture, purposeful composition.";
}

// If the model's own prompt asked for a technical diagram (per drawPrompt.ts's TYPE B branch:
// mechanical/scientific topics should get a labeled cutaway/schematic, not a photo), honor that
// intent instead of forcing the photorealistic-photograph style suffix on it — asking gpt-image-1
// for a "photorealistic photograph" of a diagram produces an incoherent, vaguely-realistic blob
// instead of a real, readable technical illustration.
const DIAGRAM_KEYWORDS = /\b(diagram|cutaway|cross-section|cross section|schematic|exploded[- ]view|blueprint|technical illustration|labeled illustration|engineering drawing)\b/i;

function isDiagramPrompt(scene: string): boolean {
  return DIAGRAM_KEYWORDS.test(scene);
}

function imagePrompt(op: EnrichedImageOp) {
  const isBackdrop = (op.w ?? 100) >= 92 && (op.h ?? 100) >= 92;
  const scene = stripTextInvitingPhrases(op.prompt);
  const teachingLine = op._teachingPoint
    ? `This image must make one idea visible without words: ${op._teachingPoint}. Compose it so a viewer could infer that idea from the parts, layout, and details alone.`
    : "";
  const calloutLine = op._calloutHints
    ? `IMPORTANT COMPOSITION: live callout pins will point to specific things — place these subjects/parts at these positions: ${op._calloutHints}. Make each named subject/part physically detailed and unmistakable in that region — its shape must read clearly at a glance.`
    : "";
  const diagram = isDiagramPrompt(scene);
  const styleLine = diagram
    ? `Clean technical/engineering diagram illustration style — precise line work, accurate part shapes and proportions, flat or subtly shaded fills, the look of a real textbook or engineering-manual cutaway. Dark background, bright clearly-outlined parts in distinct colors so each component reads separately. This is a DIAGRAM, not a photograph — no photographic lighting, no camera lens effects, no photorealism, no painterly texture.`
    : `Photorealistic, ultra-sharp educational detail photograph. Shot on a professional camera, ${isBackdrop ? "cinematic wide-angle, high detail" : "shallow depth of field with sharp subject in focus"}. ${subjectStyleCue(scene)} No illustration, no painting, no cartoon, no CGI render — real photography only.`;

  return `${NO_TEXT_DIRECTIVE}

${scene}

${teachingLine}
${styleLine}
Reminder: absolutely no text, labels, or lettering anywhere in the frame — leave all wording to the live animated overlay. ${isBackdrop ? "Wide 16:9 composition, main subject clearly visible with natural surrounding context." : "Keep the subject fully visible; do not crop off important parts."}
${calloutLine}`.trim();
}

/** Generates one image, retrying once. Mutates `op.src` in place on success and returns the
 *  cost in USD (0 if generation never succeeded). */
async function generateOne(client: OpenAI, op: ImageDrawOp): Promise<number> {
  for (const config of IMAGE_ATTEMPTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await client.images.generate({
          model: config.model,
          prompt: imagePrompt(op),
          size: config.size,
          quality: IMAGE_QUALITY,
        });
        const b64 = result.data?.[0]?.b64_json;
        if (b64) {
          op.src = `data:image/png;base64,${b64}`;
          const usage = result.usage;
          return usage
            ? usage.input_tokens * IMAGE_INPUT_TOKEN_PRICE + usage.output_tokens * IMAGE_OUTPUT_TOKEN_PRICE
            : IMAGE_FLAT_RATE;
        }
      } catch {
        // Swallow per-image errors; try the fallback model/size if the default is unavailable.
      }
    }
  }
  return 0;
}

/**
 * Fills each "image" op placeholder in the beats with a real generated image.
 * Returns the total image-generation cost in USD (from actual token usage when available).
 */
// Position descriptor: converts 0-100 grid coords to plain English region names.
function regionDesc(x: number, y: number): string {
  const h = x < 35 ? "left" : x > 65 ? "right" : "center";
  const v = y < 35 ? "top" : y > 65 ? "bottom" : "middle";
  return v === "middle" ? h : `${v}-${h}`;
}

export async function fillImageOps(client: OpenAI, beats: Beat[]): Promise<number> {
  const stats = await fillImageOpsIncremental(client, beats);
  return stats.costUsd;
}

export function pauseImageOps(beats: Beat[]): ImageFillStats {
  const pending = collectPendingImageRefs(beats).length;
  repairMissingImageSurfaces(beats);
  return { costUsd: 0, pending, filled: 0, failed: pending };
}

function collectPendingImageRefs(beats: Beat[], options: { minBeatIndex?: number; maxBeatIndex?: number } = {}): PendingImageRef[] {
  const pending: PendingImageRef[] = [];
  for (let beatIndex = 0; beatIndex < beats.length; beatIndex++) {
    if (typeof options.minBeatIndex === "number" && beatIndex < options.minBeatIndex) continue;
    if (typeof options.maxBeatIndex === "number" && beatIndex > options.maxBeatIndex) break;
    const beat = beats[beatIndex];
    if (!beat.draw) continue;
    const callouts = beat.draw.ops.filter((op) => op.kind === "callout") as Extract<DrawScript["ops"][number], { kind: "callout" }>[];
    // Intro images may stay broad/atmospheric; every other image must visibly carry this
    // beat's teaching point — the single biggest lever against generic stock-photo output.
    const teachingPoint = beat.slideKind === "intro"
      ? undefined
      : [beat.title, beat.script.match(/[^.!?]+[.!?]?/)?.[0]?.trim()].filter(Boolean).join(" — ").slice(0, 180);
    for (const op of beat.draw.ops) {
      if (op.kind === "image" && op.prompt && !op.src) {
        const imgOp = op as EnrichedImageOp;
        imgOp._teachingPoint = teachingPoint;
        if (callouts.length > 0) {
          imgOp._calloutHints = callouts
            .map((c) => `"${c.text}" at the ${regionDesc(c.x, c.y)} of the image`)
            .join("; ");
        }
        pending.push({ beat, beatIndex, op: imgOp });
      }
    }
  }
  return pending;
}

function repairMissingImageSurfaces(beats: Beat[], options: { minBeatIndex?: number; maxBeatIndex?: number } = {}): ImageFillUpdate[] {
  const updates: ImageFillUpdate[] = [];
  for (let beatIndex = 0; beatIndex < beats.length; beatIndex++) {
    if (typeof options.minBeatIndex === "number" && beatIndex < options.minBeatIndex) continue;
    if (typeof options.maxBeatIndex === "number" && beatIndex > options.maxBeatIndex) break;
    const beat = beats[beatIndex];
    if (!beat.draw) continue;
    const beforeOps = beat.draw.ops;
    const filteredOps = beat.draw.ops.filter((op) => op.kind !== "image" || (op as ImageDrawOp).src);
    const removedImage = filteredOps.length !== beforeOps.length;
    beat.draw.ops = filteredOps;
    let replacedDraw = false;
    // Preserve intentional image-less visuals. Written blackboards and animation-led boards
    // are valid teaching surfaces; only synthesize a fallback image when a beat truly lost
    // its explanation visual after image generation failed.
    if (!hasUsefulExplanationVisual(beat.draw)) {
      beat.draw = fallbackExplanationDraw(beat.title, beat.script);
      replacedDraw = true;
    }
    if (removedImage || replacedDraw) {
      updates.push({ beat, beatIndex, costUsd: 0, phase: "fallback" });
    }
  }
  return updates;
}

function repairMissingFallbackImages(beats: Beat[], options: { minBeatIndex?: number; maxBeatIndex?: number } = {}): ImageFillUpdate[] {
  const updates: ImageFillUpdate[] = [];
  for (let beatIndex = 0; beatIndex < beats.length; beatIndex++) {
    if (typeof options.minBeatIndex === "number" && beatIndex < options.minBeatIndex) continue;
    if (typeof options.maxBeatIndex === "number" && beatIndex > options.maxBeatIndex) break;
    const beat = beats[beatIndex];
    if (!beat.draw) continue;
    const beforeOps = beat.draw.ops;
    const filteredOps = beat.draw.ops.filter((op) => op.kind !== "image" || (op as ImageDrawOp).src);
    const removedImage = filteredOps.length !== beforeOps.length;
    beat.draw.ops = filteredOps;
    let replacedDraw = false;
    if (!hasUsefulExplanationVisual(beat.draw)) {
      beat.draw = fallbackWrittenDraw(beat.title, beat.script);
      replacedDraw = true;
    }
    if (removedImage || replacedDraw) {
      updates.push({ beat, beatIndex, costUsd: 0, phase: "fallback" });
    }
  }
  return updates;
}

export async function fillImageOpsIncremental(
  client: OpenAI,
  beats: Beat[],
  onUpdate?: (update: ImageFillUpdate) => void | Promise<void>,
  options: { minBeatIndex?: number; maxBeatIndex?: number } = {}
): Promise<ImageFillStats> {
  let imageCostUsd = 0;
  let filled = 0;

  // Round 1: generate every image the model itself requested, in parallel — one image's
  // latency bounds the total wall-clock cost rather than multiplying by beat count.
  const firstRound = collectPendingImageRefs(beats, options);
  if (firstRound.length > 0) {
    const results = await Promise.all(firstRound.map(async (ref) => {
      const costUsd = await generateOne(client, ref.op);
      if (ref.op.src) {
        await onUpdate?.({ beat: ref.beat, beatIndex: ref.beatIndex, costUsd, phase: "image" });
      }
      return { costUsd, filled: Boolean(ref.op.src) };
    }));
    imageCostUsd += results.reduce((sum, result) => sum + result.costUsd, 0);
    filled += results.filter((result) => result.filled).length;
  }

  // Drop any image op that still has no src (both attempts failed) — the board renders
  // normally with its remaining labels/notes/arrows, graceful degradation, not a crash.
  for (const update of repairMissingImageSurfaces(beats, options)) {
    await onUpdate?.(update);
  }

  // Round 2: the fallback boards just injected above carry a brand-new, unfilled image
  // placeholder — generate those too so the final board does not keep an empty image op
  // (LiveSketch renders nothing for one). If this also fails, convert that beat into a
  // written blackboard so the teaching surface remains dense and readable.
  const secondRound = collectPendingImageRefs(beats, options);
  if (secondRound.length > 0) {
    const results = await Promise.all(secondRound.map(async (ref) => {
      const costUsd = await generateOne(client, ref.op);
      if (ref.op.src) {
        await onUpdate?.({ beat: ref.beat, beatIndex: ref.beatIndex, costUsd, phase: "image" });
      }
      return { costUsd, filled: Boolean(ref.op.src) };
    }));
    imageCostUsd += results.reduce((sum, result) => sum + result.costUsd, 0);
    filled += results.filter((result) => result.filled).length;
    for (const update of repairMissingFallbackImages(beats, options)) {
      await onUpdate?.(update);
    }
  }

  const pending = firstRound.length + secondRound.length;
  return { costUsd: imageCostUsd, pending, filled, failed: Math.max(0, pending - filled) };
}
