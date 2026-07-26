import type { SuprnotesLessonInput, SuprnotesAsset, SuprnotesContentBlock } from "./suprnotes";

/**
 * Browser-side counterpart to backend/suprnotes-adapter/folder-to-lesson-input.mjs.
 *
 * Turns a raw markdown lecture (generated_notes.md) plus its images into the
 * `suprnotes.lesson_input.v1` document the app already knows how to teach from
 * (see lib/suprnotes.ts + app/api/generate-lecture/route.ts). This is what lets a
 * student upload an .md file + images directly instead of a pre-built Suprnotes JSON.
 *
 * Images are embedded as base64 data URIs so the resulting source is self-contained —
 * no asset paths, no server round-trip for the images themselves.
 */

export type UploadedImage = {
  /** Relative path if available (webkitRelativePath), else the file name. Forward-slashed. */
  path: string;
  /** data:<mime>;base64,… produced by FileReader.readAsDataURL. */
  dataUrl: string;
};

const IMG_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.?\//, "");
}

/**
 * Canonical key for matching image references across the folder's different path forms.
 * A markdown ref ("yolo_output/graph/x.jpg"), a relevant_images file_name ("graph/x.jpg"),
 * and a folder-uploaded file's webkitRelativePath ("<root>/yolo_output/graph/x.jpg") must all
 * reduce to the same key. We take the portion after the last "yolo_output/" segment; if there
 * is none, we keep the normalized path as-is (covers hand-picked bare files).
 */
export function assetKey(p: string): string {
  const norm = normalizePath(p);
  const idx = norm.toLowerCase().lastIndexOf("yolo_output/");
  return idx >= 0 ? norm.slice(idx + "yolo_output/".length) : norm;
}

type ImageMeta = { description: string; similarity?: number };

/**
 * Match a markdown image reference to one of the uploaded files by canonical key
 * (disambiguates same-basename files in different folders), falling back to basename.
 */
function matchImage(ref: string, images: UploadedImage[]): UploadedImage | null {
  const key = assetKey(ref);
  const exact = images.find((im) => assetKey(im.path) === key);
  if (exact) return exact;
  const base = key.split("/").pop() ?? key;
  const byBase = images.filter((im) => (assetKey(im.path).split("/").pop() ?? im.path) === base);
  return byBase[0] ?? null;
}

/** Parse relevant_images.json into a map of canonical key -> { description, similarity score }. */
function parseRelevantImages(text: string | undefined): Map<string, ImageMeta> {
  const map = new Map<string, ImageMeta>();
  if (!text) return map;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return map;
  }
  if (!Array.isArray(parsed)) return map;
  for (const group of parsed) {
    if (!group || typeof group !== "object") continue;
    for (const val of Object.values(group as Record<string, unknown>)) {
      if (!Array.isArray(val)) continue;
      for (const img of val) {
        if (img && typeof (img as Record<string, unknown>).file_name === "string") {
          const rec = img as Record<string, unknown>;
          const key = assetKey(rec.file_name as string);
          const description = typeof rec.description === "string" ? rec.description.trim() : "";
          const similarity = typeof rec.similarity === "number" ? rec.similarity : undefined;
          if (key) map.set(key, { description, similarity });
        }
      }
    }
  }
  return map;
}

/**
 * The set of canonical image keys worth embedding for a folder: every image the markdown
 * references, plus every image scored in relevant_images.json. Lets the caller read/base64
 * only these instead of every stray file in a task folder.
 */
export function relevantImageKeys(mdText: string, relevantImagesText?: string): Set<string> {
  const keys = new Set<string>();
  let m: RegExpExecArray | null;
  IMG_RE.lastIndex = 0;
  while ((m = IMG_RE.exec(mdText)) !== null) keys.add(assetKey(m[2].trim()));
  for (const key of parseRelevantImages(relevantImagesText).keys()) keys.add(key);
  return keys;
}

function mimeFromDataUrl(dataUrl: string): string {
  const m = dataUrl.match(/^data:([^;,]+)[;,]/);
  return m ? m[1] : "image/jpeg";
}

export type BuildResult = {
  document: SuprnotesLessonInput;
  title: string;
  blockCount: number;
  assetCount: number;
  missingRefs: string[];
};

export function buildLessonInputFromMarkdown(
  mdText: string,
  images: UploadedImage[],
  sidecars?: { relevantImagesText?: string; detectedSubjectText?: string },
): BuildResult {
  const descByFile = parseRelevantImages(sidecars?.relevantImagesText);

  let detectedSubject: Record<string, unknown> = {};
  if (sidecars?.detectedSubjectText) {
    try {
      detectedSubject = JSON.parse(sidecars.detectedSubjectText) as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }

  // --- parse markdown into heading-delimited blocks + per-block image refs ---
  const lines = mdText.split(/\r?\n/);
  let docTitle = "";
  type RawBlock = { heading: string; level: number; text: string; refs: Array<{ alt: string; ref: string }> };
  type WorkingBlock = { heading: string; level: number; textLines: string[]; refs: Array<{ alt: string; ref: string }> };
  const blocks: RawBlock[] = [];
  let current: WorkingBlock | null = null;

  const pushCurrent = () => {
    if (!current) return;
    const text = current.textLines.join("\n").trim();
    if (text || current.refs.length) blocks.push({ heading: current.heading, level: current.level, text, refs: current.refs });
    current = null;
  };

  for (const raw of lines) {
    const h = raw.match(HEADING_RE);
    if (h) {
      const level = h[1].length;
      const titleText = h[2].trim();
      if (level === 1 && !docTitle) {
        docTitle = titleText;
        continue;
      }
      pushCurrent();
      current = { heading: titleText, level, textLines: [], refs: [] };
      continue;
    }
    if (!current) current = { heading: "", level: 2, textLines: [], refs: [] };
    let m: RegExpExecArray | null;
    IMG_RE.lastIndex = 0;
    while ((m = IMG_RE.exec(raw)) !== null) {
      current.refs.push({ alt: m[1].trim(), ref: m[2].trim() });
    }
    const line = raw.replace(IMG_RE, "").trimEnd();
    if (line.trim()) current.textLines.push(line);
  }
  pushCurrent();

  // --- build assets + content blocks ---
  const assets: SuprnotesAsset[] = [];
  const assetByPath = new Map<string, string>(); // image.path -> asset id
  const contentBlocks: SuprnotesContentBlock[] = [];
  const missingRefs: string[] = [];
  let imgCounter = 0;

  const ensureAsset = (img: UploadedImage, alt: string, blockId: string): string => {
    const existingId = assetByPath.get(img.path);
    if (existingId) {
      const a = assets.find((x) => x.id === existingId);
      if (a && a.sourceBlockIds && !a.sourceBlockIds.includes(blockId)) a.sourceBlockIds.push(blockId);
      return existingId;
    }
    const id = `img-${++imgCounter}`;
    assetByPath.set(img.path, id);
    const meta = descByFile.get(assetKey(img.path));
    const desc = meta?.description ?? "";
    assets.push({
      id,
      type: "image",
      mimeType: mimeFromDataUrl(img.dataUrl),
      caption: alt || (desc ? desc.split(".")[0] : "") || id,
      description: desc || alt || "",
      url: img.dataUrl,
      sourceBlockIds: [blockId],
      ...(meta?.similarity != null ? { teachingUse: { relevanceScore: meta.similarity } } : {}),
    });
    return id;
  };

  let blockCounter = 0;
  for (const b of blocks) {
    const blockId = `block-${++blockCounter}`;
    const assetIds: string[] = [];
    for (const r of b.refs) {
      const img = matchImage(r.ref, images);
      if (!img) {
        missingRefs.push(r.ref);
        continue;
      }
      assetIds.push(ensureAsset(img, r.alt, blockId));
    }
    contentBlocks.push({
      id: blockId,
      type: "section",
      heading: b.heading || undefined,
      text: b.text || undefined,
      assetIds: assetIds.length ? assetIds : undefined,
      sourceOrder: blockCounter,
    });
  }

  // "as much as available": include uploaded images the markdown never referenced, so the
  // tutor can still draw on them. But when a relevant_images.json sidecar is present, trust it
  // as the relevance filter — otherwise a folder upload would base64 every stray YOLO crop.
  const haveRelevanceFilter = descByFile.size > 0;
  for (const img of images) {
    const meta = descByFile.get(assetKey(img.path));
    if (haveRelevanceFilter && !meta) continue;
    if (!assetByPath.has(img.path)) {
      const id = `img-${++imgCounter}`;
      assetByPath.set(img.path, id);
      const desc = meta?.description ?? "";
      assets.push({
        id,
        type: "image",
        mimeType: mimeFromDataUrl(img.dataUrl),
        caption: desc ? desc.split(".")[0] : (img.path.split("/").pop() ?? id),
        description: desc,
        url: img.dataUrl,
        sourceBlockIds: [],
        ...(meta?.similarity != null ? { teachingUse: { relevanceScore: meta.similarity } } : {}),
      });
    }
  }

  const subjectTopic = typeof detectedSubject.overall_topic === "string" ? (detectedSubject.overall_topic as string) : "";
  const title = docTitle || subjectTopic || "Imported lesson";

  const document: SuprnotesLessonInput = {
    schemaVersion: "suprnotes.lesson_input.v1",
    source: { adapter: "markdown-upload", generatedAt: new Date().toISOString() },
    lesson: {
      title,
      subject: subjectTopic || title,
      language: "en",
    },
    generationDirectives: {
      // We have real slide images for this lesson — ground on them, don't invent visuals.
      imagePolicy: "use_provided_images_only",
      disableAiImageGeneration: true,
      preferredLectureStyle: "grounded_from_notes",
      preserveExistingLecturePrompting: true,
    },
    contentGovernance: {
      groundingPolicy: "prefer_provided_content",
      hallucinationPolicy: "hedge_when_unsupported",
      requireClaimSourceTags: false,
    },
    assets,
    contentBlocks,
    webPreview: { status: "not_requested" },
  };

  return { document, title, blockCount: contentBlocks.length, assetCount: assets.length, missingRefs };
}
