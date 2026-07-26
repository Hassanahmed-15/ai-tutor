#!/usr/bin/env node
/**
 * Suprnotes pipeline-folder  ->  suprnotes.lesson_input.v1  adapter.
 *
 * The upstream "supernotes" pipeline emits a folder (named with a UUID) containing:
 *   - generated_notes.md      markdown notes: headings + prose + LaTeX + ![alt](yolo_output/...) refs
 *   - relevant_images.json    per-image rich descriptions + similarity scores
 *   - detected_subject.json   detected topic / subject / template
 *   - yolo_output/<cat>/*.jpg  the actual images referenced by the notes
 *
 * The Aria app (frontend/web) already knows how to turn a `suprnotes.lesson_input.v1`
 * JSON into a live, grounded lesson (see frontend/web/lib/suprnotes.ts +
 * app/api/generate-lecture/route.ts). What was missing was the converter from the raw
 * folder into that JSON. This script IS that converter.
 *
 * Images are embedded as base64 data URIs directly in assets[].url, so the output is a
 * single self-contained .json you can drag straight into the Learn-page upload button —
 * no asset paths, no server, no copying files into public/.
 *
 * Usage:
 *   node backend/suprnotes-adapter/folder-to-lesson-input.mjs <folderPath> [outPath]
 *
 * Default outPath: <folderPath>/lesson_input.suprnotes.json
 */

import fs from "node:fs";
import path from "node:path";

// ---- args ---------------------------------------------------------------
const folder = process.argv[2];
if (!folder) {
  console.error("Usage: node folder-to-lesson-input.mjs <folderPath> [outPath]");
  process.exit(1);
}
if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
  console.error(`Not a directory: ${folder}`);
  process.exit(1);
}
const outPath = process.argv[3] || path.join(folder, "lesson_input.suprnotes.json");

// ---- helpers ------------------------------------------------------------
function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif" };
function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
}

/** Strip a leading "yolo_output/" so a markdown ref matches relevant_images.json file_name keys. */
function normalizeRef(ref) {
  return ref.replace(/^\.?\//, "").replace(/^yolo_output\//i, "");
}

// ---- 1. gather image descriptions from relevant_images.json -------------
// Shape: [ { "1": [ { file_name, similarity, description }, ... ] }, ... ]
const relevant = readJsonSafe(path.join(folder, "relevant_images.json"));
const descByFile = new Map();
if (Array.isArray(relevant)) {
  for (const group of relevant) {
    if (!group || typeof group !== "object") continue;
    for (const val of Object.values(group)) {
      if (!Array.isArray(val)) continue;
      for (const img of val) {
        if (img && typeof img.file_name === "string") {
          descByFile.set(normalizeRef(img.file_name), {
            description: typeof img.description === "string" ? img.description.trim() : "",
            similarity: typeof img.similarity === "number" ? img.similarity : undefined,
          });
        }
      }
    }
  }
}

// ---- 2. subject / title -------------------------------------------------
const subject = readJsonSafe(path.join(folder, "detected_subject.json")) || {};

// ---- 3. parse generated_notes.md into blocks + image refs ---------------
const mdPath = path.join(folder, "generated_notes.md");
if (!fs.existsSync(mdPath)) {
  console.error(`Missing generated_notes.md in ${folder}`);
  process.exit(1);
}
const md = fs.readFileSync(mdPath, "utf8");
const lines = md.split(/\r?\n/);

const IMG_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;

let docTitle = "";
const blocks = [];
let current = null; // { heading, level, textLines:[], refs:[{alt, ref}] }

function pushCurrent() {
  if (!current) return;
  const text = current.textLines.join("\n").trim();
  if (text || current.refs.length) blocks.push({ ...current, text });
  current = null;
}

for (const raw of lines) {
  const h = raw.match(HEADING_RE);
  if (h) {
    const level = h[1].length;
    const title = h[2].trim();
    if (level === 1 && !docTitle) {
      docTitle = title; // the document H1 becomes the lesson title
      continue;
    }
    pushCurrent();
    current = { heading: title, level, textLines: [], refs: [] };
    continue;
  }
  if (!current) current = { heading: "", level: 2, textLines: [], refs: [] };

  // pull image refs out of the line; keep the rest as prose
  let line = raw;
  let m;
  IMG_RE.lastIndex = 0;
  while ((m = IMG_RE.exec(raw)) !== null) {
    current.refs.push({ alt: m[1].trim(), ref: normalizeRef(m[2].trim()), rawRef: m[2].trim() });
  }
  line = raw.replace(IMG_RE, "").trimEnd();
  if (line.trim()) current.textLines.push(line);
}
pushCurrent();

// ---- 4. build assets (base64) + contentBlocks ---------------------------
const assets = [];
const assetIdByRef = new Map();
let imgCounter = 0;
let missing = 0;

function ensureAsset(ref, alt, blockId) {
  let id = assetIdByRef.get(ref);
  if (id) {
    const existing = assets.find((a) => a.id === id);
    if (existing && !existing.sourceBlockIds.includes(blockId)) existing.sourceBlockIds.push(blockId);
    return id;
  }
  const abs = path.join(folder, "yolo_output", ref);
  if (!fs.existsSync(abs)) {
    console.warn(`  ! image referenced but not found on disk: yolo_output/${ref}`);
    missing++;
    return null;
  }
  const b64 = fs.readFileSync(abs).toString("base64");
  const mime = mimeFor(ref);
  const meta = descByFile.get(ref) || {};
  id = `img-${++imgCounter}`;
  assetIdByRef.set(ref, id);
  assets.push({
    id,
    type: "image",
    mimeType: mime,
    caption: alt || (meta.description ? meta.description.split(".")[0] : "") || id,
    description: meta.description || alt || "",
    url: `data:${mime};base64,${b64}`,
    sourceBlockIds: [blockId],
    ...(meta.similarity != null ? { teachingUse: { similarity: meta.similarity } } : {}),
  });
  return id;
}

const contentBlocks = [];
let blockCounter = 0;
for (const b of blocks) {
  const blockId = `block-${++blockCounter}`;
  const assetIds = [];
  for (const r of b.refs) {
    const aid = ensureAsset(r.ref, r.alt, blockId);
    if (aid) assetIds.push(aid);
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

// ---- 5. assemble the lesson_input.v1 document ---------------------------
const title =
  docTitle ||
  (typeof subject.overall_topic === "string" && subject.overall_topic.trim()) ||
  path.basename(folder);

const lessonInput = {
  schemaVersion: "suprnotes.lesson_input.v1",
  source: {
    adapter: "folder-to-lesson-input",
    folder: path.basename(folder),
    generatedAt: new Date().toISOString(),
  },
  lesson: {
    title,
    subject: typeof subject.overall_topic === "string" ? subject.overall_topic : title,
    ...(Array.isArray(subject.categories) && subject.categories.length ? { level: String(subject.categories[0]) } : {}),
    language: "en",
  },
  generationDirectives: {
    // We have REAL slide images for this lesson — ground on them, don't invent visuals.
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

// ---- 6. write + report --------------------------------------------------
fs.writeFileSync(outPath, JSON.stringify(lessonInput, null, 2), "utf8");
const sizeMb = (fs.statSync(outPath).size / (1024 * 1024)).toFixed(2);

console.log(`\nWrote ${outPath}`);
console.log(`  title:         ${title}`);
console.log(`  contentBlocks: ${contentBlocks.length}`);
console.log(`  assets:        ${assets.length} embedded image(s)${missing ? `, ${missing} missing on disk` : ""}`);
console.log(`  file size:     ${sizeMb} MB (base64 images inlined)`);
console.log(`\nNext: open the Learn page, click the upload button, and pick this .json — it plays as a grounded live lesson.`);
