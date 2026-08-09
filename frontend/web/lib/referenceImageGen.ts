import OpenAI from "openai";
import type { DrawScript } from "@/components/sketch/LiveSketch";
import type { Beat } from "@/lib/lessonContent";

type ImageOp = Extract<DrawScript["ops"][number], { kind: "image" }> & {
  assetId?: string;
  credit?: {
    title: string;
    creator: string;
    license: string;
    sourceUrl: string;
    provider?: string;
  };
};

type ReferenceImage = {
  title: string;
  thumbUrl: string;
  sourceUrl: string;
  creator: string;
  license: string;
  description: string;
  provider: string;
};

type VisionCallout = {
  text: string;
  x: number;
  y: number;
  confidence: number;
};

/** What the board director learned about each beat. Without it, no beat qualifies for a photo. */
export type ReferenceContext = {
  specs?: Map<string, { subject: string; isPhysical: boolean }>;
  forms?: Map<string, string>;
};

export type ReferenceImageStats = {
  costUsd: number;
  filled: number;
  failed: number;
};

const VISION_MODEL = process.env.OPENAI_REFERENCE_VISION_MODEL ?? "gpt-4o-mini";
const MAX_IMAGE_BYTES = 2_200_000;
// Kept ONLY to seed the Openverse search string once a beat has already qualified through the
// director. It is no longer a gate — as a gate it matched "machine" in "Support Vector Machine"
// and put a stamp vending machine in a lecture about classifiers.
const REFERENCE_TERMS = /\b(?:anatomy|organ|heart|lung|brain|bone|muscle|skin|plant|leaf|flower|root|stem|animal|bird|fish|insect|species|specimen|microscope|telescope|laboratory|equipment|engine|machine|volcano|glacier|river|mountain|fossil|artifact|cell)\b/i;

function stripHtml(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/<[^>]+>/g, " ").replace(/&[^;]+;/g, " ").replace(/\s+/g, " ").trim()
    : "";
}

/**
 * Which beat, if any, may carry a real photograph.
 *
 * THE KEYWORD GATE IS GONE, and it is worth recording why, because it looked reasonable. It tested
 * the beat text against a list of physical nouns that included the word `machine`. A lecture on
 * Support Vector Machines matched it, an Openverse full-text search for "SVM" returned a stamp
 * vending machine, and the callout pass labelled its coin return slot — under narration about
 * maximising the margin between two classes.
 *
 * No amount of extra words fixes that: a regex cannot tell "Support Vector Machine" from a machine,
 * or a Random Forest from a forest, or a Decision Tree from a tree. Machine learning is full of
 * names borrowed from physical objects, which is exactly the domain where a stock-photo search is
 * most confidently wrong.
 *
 * So the gate is now the director's own judgement: a beat qualifies only when its visual
 * specification says the subject is a REAL PHYSICAL THING (`isPhysical`) and the classifier agreed
 * it is a `labelled-diagram`. Both come from a model that was asked the question directly, with the
 * ambiguity named. And even then the image is vision-verified before use — see fillRealReferenceImage.
 *
 * With no director context (the pass is disabled, or planning failed) NO beat qualifies. That is
 * deliberate: the previous default was "guess from keywords", and its failure mode was a vending
 * machine in a lecture about classifiers.
 */
function candidateBeat(beats: Beat[], context: ReferenceContext): { beat: Beat; index: number } | null {
  let best: { beat: Beat; index: number; score: number } | null = null;
  for (let index = 0; index < beats.length; index += 1) {
    const beat = beats[index];
    if (beat.slideKind === "checkpoint" || !beat.draw) continue;
    if (beat.draw.ops.some((op) => op.kind === "image" || op.kind === "reactAnimation")) continue;

    const spec = context.specs?.get(beat.id);
    if (!spec?.isPhysical) continue;
    if (context.forms?.get(beat.id) !== "labelled-diagram") continue;

    const score = Math.min(4, beat.points.length) - (beat.slideKind === "recap" ? 4 : 0);
    if (!best || score > best.score) best = { beat, index, score };
  }
  return best ? { beat: best.beat, index: best.index } : null;
}

function searchQuery(beat: Beat): string {
  const title = beat.title.replace(/\b(?:introduction|overview|understanding|how|why|works?|the)\b/gi, " ").replace(/\s+/g, " ").trim();
  const visibleSubject = `${beat.title} ${beat.points.join(" ")}`.match(REFERENCE_TERMS)?.[0] ?? "";
  return `${title} ${visibleSubject}`.trim().slice(0, 80);
}

function referenceQueries(beat: Beat): string[] {
  const base = searchQuery(beat);
  const context = `${beat.title} ${beat.points.join(" ")} ${beat.script}`;
  const queries = [base];
  if (/\b(?:leaf|plant|root|stem|flower)\b/i.test(context)) {
    queries.unshift(/\b(?:anatomy|cell|tissue|layer|cross.?section|mesophyll|stomata)\b/i.test(context)
      ? `${base} microscope cross section`
      : `${base} botany close up`);
  } else if (/\b(?:cell|tissue|microscope|specimen)\b/i.test(context)) {
    queries.unshift(`${base} microscope specimen`);
  } else {
    queries.unshift(`${base} educational photograph`);
  }
  return Array.from(new Set(queries.map((query) => query.trim()).filter(Boolean))).slice(0, 2);
}

async function findOpenverseImage(queries: string[]): Promise<ReferenceImage | null> {
  for (const query of queries) {
    const params = new URLSearchParams({
      q: query,
      page_size: "20",
      license_type: "commercial",
    });
    const response = await fetch(`https://api.openverse.org/v1/images/?${params}`, {
      signal: AbortSignal.timeout(7_000),
      headers: { "User-Agent": "AriaAITutor/1.0 educational-reference-board" },
    });
    if (!response.ok) continue;
    const payload = await response.json() as {
    results?: Array<{
      title?: unknown;
      thumbnail?: unknown;
      foreign_landing_url?: unknown;
      creator?: unknown;
      license?: unknown;
      license_version?: unknown;
      attribution?: unknown;
      category?: unknown;
      filetype?: unknown;
      mature?: unknown;
      width?: unknown;
      height?: unknown;
    }>;
    };
    const results = Array.isArray(payload.results) ? payload.results : [];
    for (const result of results) {
      const category = typeof result.category === "string" ? result.category.toLowerCase() : "";
      const filetype = typeof result.filetype === "string" ? result.filetype.toLowerCase() : "";
      const title = typeof result.title === "string" ? result.title.trim() : "";
      const width = Number(result.width);
      const height = Number(result.height);
      if (result.mature === true || /\b(?:vector|illustration|drawing|icon|diagram|clip.?art)\b/i.test(title)) continue;
      // Openverse leaves `category` and `filetype` blank for many genuine Flickr/Wikimedia
      // photographs, so only reject an explicit non-photo category or unsupported file type.
      if (category && !/(?:photo|photograph)/.test(category)) continue;
      if (filetype && !/^(?:jpe?g|png|webp)$/.test(filetype)) continue;
      if ((Number.isFinite(width) && width < 640) || (Number.isFinite(height) && height < 420)) continue;
      const thumbUrl = typeof result.thumbnail === "string" ? result.thumbnail : "";
      const sourceUrl = typeof result.foreign_landing_url === "string" ? result.foreign_landing_url : "";
      if (!thumbUrl || !sourceUrl) continue;
      const licenseName = typeof result.license === "string" ? result.license.toUpperCase() : "Open license";
      const version = typeof result.license_version === "string" && result.license_version ? ` ${result.license_version}` : "";
      return {
        title: title || query,
        thumbUrl,
        sourceUrl,
        creator: typeof result.creator === "string" && result.creator.trim() ? result.creator.trim() : "Openverse contributor",
        license: `${licenseName}${version}`,
        description: typeof result.attribution === "string" && result.attribution.trim() ? result.attribution.trim() : query,
        provider: "Openverse",
      };
    }
  }
  return null;
}

async function findCommonsImage(query: string): Promise<ReferenceImage | null> {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: "6",
    gsrlimit: "8",
    prop: "imageinfo",
    iiprop: "url|mime|extmetadata",
    iiurlwidth: "1200",
    format: "json",
    origin: "*",
  });
  const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    signal: AbortSignal.timeout(6_000),
    headers: { "User-Agent": "AriaAITutor/1.0 educational-reference-board" },
  });
  if (!response.ok) return null;
  const payload = await response.json() as {
    query?: { pages?: Record<string, { title?: string; imageinfo?: Array<Record<string, unknown>> }> };
  };
  const pages = Object.values(payload.query?.pages ?? {});
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info) continue;
    const mime = typeof info.mime === "string" ? info.mime : "";
    if (!/^image\/(?:jpeg|png|webp)$/i.test(mime)) continue;
    const metadata = (info.extmetadata && typeof info.extmetadata === "object" ? info.extmetadata : {}) as Record<string, { value?: unknown }>;
    const license = stripHtml(metadata.LicenseShortName?.value);
    if (!/(?:CC BY|CC0|Public domain)/i.test(license)) continue;
    const thumbUrl = typeof info.thumburl === "string" ? info.thumburl : typeof info.url === "string" ? info.url : "";
    const sourceUrl = typeof info.descriptionurl === "string" ? info.descriptionurl : "";
    if (!thumbUrl || !sourceUrl) continue;
    return {
      title: (page.title ?? query).replace(/^File:/, ""),
      thumbUrl,
      sourceUrl,
      creator: stripHtml(metadata.Artist?.value) || "Wikimedia Commons contributor",
      license,
      description: stripHtml(metadata.ImageDescription?.value) || query,
      provider: "Wikimedia Commons",
    };
  }
  return null;
}

async function imageDataUrl(url: string): Promise<string | null> {
  const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) return null;
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;
  const contentType = response.headers.get("content-type") ?? "image/jpeg";
  return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
}

async function annotateImage(client: OpenAI, beat: Beat, dataUrl: string): Promise<{ callouts: VisionCallout[]; costUsd: number }> {
  const completion = await client.chat.completions.create({
    model: VISION_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You annotate a real educational reference photograph. Return JSON only: " +
          "{\"callouts\":[{\"text\":string,\"x\":number,\"y\":number,\"confidence\":number}]}. " +
          "Choose 2 or 3 clearly distinguishable, instructionally relevant regions. x and y are percentages from 0 to 100 within the image. " +
          "Each label is 2-4 words, factually supported by the lesson, and names the visible structure rather than an abstract idea. " +
          "Confidence is 0 to 1. Do not guess hidden anatomy, infer an indistinct tissue, or return any label below 0.78 confidence. " +
          "Prefer a broader structure that is genuinely visible over a more specific but uncertain substructure.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: JSON.stringify({ title: beat.title, points: beat.points, narration: beat.script }),
          },
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
        ],
      },
    ],
    temperature: 0.15,
    max_tokens: 500,
    response_format: { type: "json_object" },
  });
  const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
  const callouts = (Array.isArray(raw.callouts) ? raw.callouts : [])
    .map((item: unknown) => {
      const value = item && typeof item === "object" ? item as Record<string, unknown> : {};
      const text = typeof value.text === "string" ? value.text.trim().slice(0, 28) : "";
      const x = Number(value.x);
      const y = Number(value.y);
      const confidence = Number(value.confidence);
      return text && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(confidence) && confidence >= 0.78
        ? { text, x: Math.max(4, Math.min(96, x)), y: Math.max(4, Math.min(96, y)), confidence }
        : null;
    })
    .filter((item: VisionCallout | null): item is VisionCallout => item !== null)
    .slice(0, 3);
  const usage = completion.usage;
  const inputRate = Number(process.env.OPENAI_REFERENCE_VISION_INPUT_PER_M ?? 0.15);
  const outputRate = Number(process.env.OPENAI_REFERENCE_VISION_OUTPUT_PER_M ?? 0.6);
  const costUsd = usage ? (usage.prompt_tokens * inputRate + usage.completion_tokens * outputRate) / 1_000_000 : 0;
  return { callouts, costUsd };
}

function imageBoard(beat: Beat, image: ReferenceImage, src: string, callouts: VisionCallout[]): DrawScript {
  const imageBox = { x: 50, y: 54, w: 64, h: 58 };
  const colors = ["#14b8a6", "#3b82f6", "#be185d"];
  const sentences = beat.script.split(/(?<=[.!?])\s+/).filter(Boolean);
  const imageOp: ImageOp = {
    kind: "image",
    prompt: image.description,
    assetId: `reference:${image.provider}:${image.title}`,
    src,
    x: imageBox.x,
    y: imageBox.y,
    w: imageBox.w,
    h: imageBox.h,
    at: 0.03,
    credit: {
      title: image.title,
      creator: image.creator,
      license: image.license,
      sourceUrl: image.sourceUrl,
      provider: image.provider,
    },
  };
  const ops: DrawScript["ops"] = [
    { kind: "label", text: beat.title.slice(0, 46), x: 50, y: 8, size: "md", color: "#6b7280", at: 0.005 },
    imageOp,
  ];
  callouts.forEach((callout, index) => {
    const targetX = imageBox.x - imageBox.w / 2 + (callout.x / 100) * imageBox.w;
    const targetY = imageBox.y - imageBox.h / 2 + (callout.y / 100) * imageBox.h;
    const labelOnLeft = callout.x < 50;
    ops.push({
      kind: "callout",
      text: callout.text,
      x: targetX,
      y: targetY,
      labelX: labelOnLeft ? 10 : 90,
      labelY: Math.max(24, Math.min(84, targetY + (index - 1) * 5)),
      color: colors[index],
      at: Math.min(0.86, Math.max(0.14, (index + 1) / Math.max(4, sentences.length))),
    });
  });
  return { caption: beat.title, durationMs: beat.draw?.durationMs ?? 25_000, surface: "paper", ops };
}

/**
 * Does this photograph actually show what the beat is about?
 *
 * Nothing used to ask. A keyword search returns its best full-text match and the pipeline trusted
 * it completely — which is how a lecture on Support Vector Machines acquired a photograph of a
 * stamp vending machine, annotated with its coin return slot. The search cannot know it is wrong;
 * only something that LOOKS at the result can.
 *
 * Deliberately strict, and deliberately fail-closed: an unreadable answer, a failed call or a
 * missing model all mean "do not use this photo". A drawn board is always available as the
 * alternative, so the cost of rejecting a good photo is small and the cost of accepting a bad one
 * is a student being taught about a vending machine.
 */
async function depictsSubject(
  client: OpenAI,
  dataUrl: string,
  subject: string,
): Promise<{ ok: boolean; costUsd: number; reason?: string }> {
  try {
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_VISION_MODEL ?? "gpt-4o",
      max_tokens: 200,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You check whether a photograph is usable as the teaching illustration for a stated subject. " +
            'Reply JSON: { "depicts": boolean, "reason": string }. ' +
            "`depicts` is true ONLY if the photograph actually shows that subject. Technical names often " +
            "collide with everyday objects — a photo of a vending machine is NOT a Support Vector Machine, " +
            "a photo of woodland is NOT a Random Forest, a photo of network cabling is NOT a neural network. " +
            "When the photograph shows the everyday object instead of the technical subject, answer false.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Subject this must illustrate: ${subject}` },
            { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
          ],
        },
      ],
    });
    const usage = completion.usage;
    const costUsd = usage
      ? (usage.prompt_tokens * 2.5) / 1_000_000 + (usage.completion_tokens * 10) / 1_000_000
      : 0;
    const parsed = JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
    const ok = parsed.depicts === true;
    return { ok, costUsd, reason: typeof parsed.reason === "string" ? parsed.reason : undefined };
  } catch (err) {
    console.error(`[reference-image] verification failed, rejecting: ${err instanceof Error ? err.message : "error"}`);
    return { ok: false, costUsd: 0, reason: "verification call failed" };
  }
}

export async function fillRealReferenceImage(
  client: OpenAI,
  beats: Beat[],
  context: ReferenceContext = {},
  onFilled?: (update: { beat: Beat; beatIndex: number; costUsd: number }) => void
): Promise<ReferenceImageStats> {
  const candidate = candidateBeat(beats, context);
  if (!candidate) return { costUsd: 0, filled: 0, failed: 0 };
  const spec = context.specs?.get(candidate.beat.id);
  try {
    const queries = referenceQueries(candidate.beat);
    const image = await findOpenverseImage(queries) ?? await findCommonsImage(queries[0]);
    if (!image) return { costUsd: 0, filled: 0, failed: 0 };
    const dataUrl = await imageDataUrl(image.thumbUrl);
    if (!dataUrl) return { costUsd: 0, filled: 0, failed: 1 };

    // Look at it before using it. The beat keeps whatever board it already had.
    const subject = spec?.subject ?? candidate.beat.title;
    const verdict = await depictsSubject(client, dataUrl, subject);
    if (!verdict.ok) {
      console.error(
        `[reference-image] beat=${candidate.beat.id} REJECTED "${image.title}" for "${subject}"` +
          (verdict.reason ? ` — ${verdict.reason}` : ""),
      );
      return { costUsd: verdict.costUsd, filled: 0, failed: 1 };
    }

    const annotation = await annotateImage(client, candidate.beat, dataUrl);
    const costUsd = annotation.costUsd + verdict.costUsd;
    if (annotation.callouts.length < 2) return { costUsd, filled: 0, failed: 1 };
    candidate.beat.draw = imageBoard(candidate.beat, image, dataUrl, annotation.callouts);
    onFilled?.({ beat: candidate.beat, beatIndex: candidate.index, costUsd: annotation.costUsd });
    return { costUsd: annotation.costUsd, filled: 1, failed: 0 };
  } catch {
    return { costUsd: 0, filled: 0, failed: 1 };
  }
}
