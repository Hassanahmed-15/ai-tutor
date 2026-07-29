import { NextRequest, NextResponse } from "next/server";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import OpenAI from "openai";
import type { SuprnotesAsset, SuprnotesContentBlock, SuprnotesLessonInput } from "@/lib/suprnotes";
import { applyGlobalSourceOrder, buildPdfLessonPlan } from "@/lib/pdfLessonPipeline";

export const runtime = "nodejs";
export const maxDuration = 60;

type VisualKind = "text" | "chart" | "table" | "image" | "smartart" | "mixed";

type SlideImage = {
  description: string;
  /** Base64 data URL of the actual embedded image bytes, so the lecture pipeline can ground
   *  boards in the real picture instead of only GPT-4o's text description of it. Omitted if the
   *  media file couldn't be read from the zip. */
  dataUrl?: string;
};

type ChartSeries = {
  name: string;
  values: (number | string)[];
};

type ChartData = {
  title: string;
  categories: string[];
  series: ChartSeries[];
};

type ParsedSlide = {
  index: number;
  title: string;
  body: string;
  visualKind: VisualKind;
  images: SlideImage[];
  chartData: ChartData[];
};

type ParsePptxResponse = {
  topic: string;
  slideCount: number;
  slides: ParsedSlide[];
  fullText: string;
  diagramHints: string;
  /** Present whenever at least one slide image was successfully read — gives the lecture
   *  pipeline the same grounded-asset treatment (vision verification, image-only mode,
   *  content-block-linked chalkboard boards) a task-folder upload already gets. */
  sourceDocument?: SuprnotesLessonInput;
  assetCount?: number;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Keep a:t as a scalar — it's a leaf text node. Arrays needed only for container nodes.
  isArray: (name) =>
    ["a:p", "a:r", "p:sp", "p:pic", "p:graphicFrame", "p:tbl", "a:tr", "c:ser", "c:pt", "Relationship"].includes(name),
  textNodeName: "#text",
});

/** Collect display text from a parsed PPTX run node. */
function collectRunText(run: unknown): string {
  if (!run || typeof run !== "object") return "";
  const obj = run as Record<string, unknown>;
  const at = obj["a:t"];
  if (typeof at === "string") return at;
  if (typeof at === "number") return String(at);
  if (at && typeof at === "object") {
    const inner = (at as Record<string, unknown>)["#text"];
    if (typeof inner === "string") return inner;
  }
  return "";
}

function collectParaText(para: unknown): string {
  if (!para || typeof para !== "object") return "";
  const obj = para as Record<string, unknown>;
  const texts: string[] = [];

  const runs = obj["a:r"];
  if (Array.isArray(runs)) texts.push(...runs.map(collectRunText));
  else if (runs) texts.push(collectRunText(runs));

  const flds = obj["a:fld"];
  if (Array.isArray(flds)) texts.push(...flds.map(collectRunText));
  else if (flds) texts.push(collectRunText(flds));

  return texts.filter(Boolean).join("").replace(/\s{2,}/g, " ").trim();
}

function r(v: unknown): Record<string, unknown> {
  return (v && typeof v === "object" && !Array.isArray(v)) ? (v as Record<string, unknown>) : {};
}

function extractTitle(slideXml: Record<string, unknown>): string {
  try {
    const spTree = r(r(r(slideXml["p:sld"])["p:cSld"])["p:spTree"]);
    if (!Object.keys(spTree).length) return "";
    const shapes = (spTree["p:sp"] as unknown[]) ?? [];
    for (const sp of shapes) {
      const ph = r(r(r(sp)["p:nvSpPr"])["p:nvPr"])["p:ph"];
      const phType = r(ph)["@_type"] as string | undefined;
      if (phType === "title" || phType === "ctrTitle" || r(ph)["@_idx"] === "0") {
        const txBody = r(sp)["p:txBody"];
        const paras = txBody ? ((r(txBody)["a:p"] as unknown[]) ?? []) : [];
        const texts = (Array.isArray(paras) ? paras : [paras]).map(collectParaText).filter(Boolean);
        const title = texts.join(" ").trim();
        if (title) return title;
      }
    }
  } catch {
    // malformed XML — fall through
  }
  return "";
}

function extractBody(slideXml: Record<string, unknown>): string {
  try {
    const spTree = r(r(r(slideXml["p:sld"])["p:cSld"])["p:spTree"]);
    if (!Object.keys(spTree).length) return "";
    const shapes = (spTree["p:sp"] as unknown[]) ?? [];
    const lines: string[] = [];
    for (const sp of shapes) {
      const ph = r(r(r(sp)["p:nvSpPr"])["p:nvPr"])["p:ph"];
      const phType = r(ph)["@_type"] as string | undefined;
      if (phType === "title" || phType === "ctrTitle") continue;
      const txBody = r(sp)["p:txBody"];
      if (!txBody) continue;
      const paras = (r(txBody)["a:p"] as unknown[]) ?? [];
      const paraArr = Array.isArray(paras) ? paras : [paras];
      for (const para of paraArr) {
        const line = collectParaText(para).trim();
        if (line) lines.push(line);
      }
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}

function detectVisualKind(slideXml: Record<string, unknown>): VisualKind {
  try {
    const spTree = r(r(r(slideXml["p:sld"])["p:cSld"])["p:spTree"]);
    if (!Object.keys(spTree).length) return "text";
    const xmlStr = JSON.stringify(spTree);
    const hasChart = xmlStr.includes('"c:chart"') || xmlStr.includes("c:chart");
    const hasTable = (spTree["p:graphicFrame"] as unknown[])?.some((f) => JSON.stringify(f).includes("a:tbl")) ?? false;
    const hasPic = Array.isArray(spTree["p:pic"]) && (spTree["p:pic"] as unknown[]).length > 0;
    const hasSmartArt = xmlStr.includes("dgm:") || xmlStr.includes('"p:dgm"');
    const hasText = Array.isArray(spTree["p:sp"]) && (spTree["p:sp"] as unknown[]).length > 0;

    const kinds: VisualKind[] = [];
    if (hasChart) kinds.push("chart");
    if (hasTable) kinds.push("table");
    if (hasSmartArt) kinds.push("smartart");
    if (hasPic) kinds.push("image");
    if (hasText) kinds.push("text");

    if (kinds.length === 0) return "text";
    if (kinds.length === 1) return kinds[0];
    return "mixed";
  } catch {
    return "text";
  }
}

/**
 * Parse the slide's _rels file to map relationship IDs (r:id) to target paths.
 * Returns a map: rId → "ppt/media/imageN.png" (or chart path).
 */
async function parseSlideRels(zip: JSZip, slideFile: string): Promise<Map<string, string>> {
  const slideDir = slideFile.substring(0, slideFile.lastIndexOf("/"));
  const slideBase = slideFile.substring(slideFile.lastIndexOf("/") + 1);
  const relsPath = `${slideDir}/_rels/${slideBase}.rels`;

  const relsStr = await zip.file(relsPath)?.async("string");
  if (!relsStr) return new Map();

  try {
    const relsXml = parser.parse(relsStr) as Record<string, unknown>;
    const rels = r(relsXml["Relationships"]);
    const relItems = (rels["Relationship"] as unknown[]) ?? [];
    const relArr = Array.isArray(relItems) ? relItems : [relItems];

    const map = new Map<string, string>();
    for (const rel of relArr) {
      const relObj = r(rel);
      const id = relObj["@_Id"] as string | undefined;
      const target = relObj["@_Target"] as string | undefined;
      if (id && target) {
        // Resolve relative paths like "../media/image1.png" → "ppt/media/image1.png"
        const resolved = target.startsWith("..") ? `ppt/${target.replace(/^\.\.\//, "")}` : target;
        map.set(id, resolved);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Collect the r:embed relationship IDs from p:pic and p:blipFill elements in a slide.
 * These point to the embedded images.
 */
function collectImageRIds(slideXml: Record<string, unknown>): string[] {
  const rIds: string[] = [];
  try {
    const spTree = r(r(r(slideXml["p:sld"])["p:cSld"])["p:spTree"]);
    const pics = (spTree["p:pic"] as unknown[]) ?? [];
    for (const pic of pics) {
      const blipFill = r(r(pic)["p:blipFill"]);
      const blip = r(blipFill["a:blip"]);
      const rEmbed = blip["@_r:embed"] as string | undefined;
      if (rEmbed) rIds.push(rEmbed);
    }

    // Also check graphicFrames for embedded images
    const frames = (spTree["p:graphicFrame"] as unknown[]) ?? [];
    for (const frame of frames) {
      const xmlStr = JSON.stringify(frame);
      const embedMatches = xmlStr.matchAll(/"@_r:embed"\s*:\s*"([^"]+)"/g);
      for (const m of embedMatches) {
        rIds.push(m[1]);
      }
    }
  } catch {
    // ignore
  }
  return [...new Set(rIds)]; // deduplicate
}

/**
 * Collect chart relationship IDs from graphicFrame elements.
 */
function collectChartRIds(slideXml: Record<string, unknown>): string[] {
  const rIds: string[] = [];
  try {
    const spTree = r(r(r(slideXml["p:sld"])["p:cSld"])["p:spTree"]);
    const frames = (spTree["p:graphicFrame"] as unknown[]) ?? [];
    for (const frame of frames) {
      const xmlStr = JSON.stringify(frame);
      const matches = xmlStr.matchAll(/"@_r:id"\s*:\s*"([^"]+)"/g);
      for (const m of matches) {
        rIds.push(m[1]);
      }
    }
  } catch {
    // ignore
  }
  return [...new Set(rIds)];
}

/**
 * Parse a chart XML file and extract structured data.
 */
async function parseChartXml(zip: JSZip, chartPath: string): Promise<ChartData | null> {
  const chartStr = await zip.file(chartPath)?.async("string");
  if (!chartStr) return null;

  try {
    const chartXml = parser.parse(chartStr) as Record<string, unknown>;
    const chartRoot = r(r(chartXml["c:chartSpace"])["c:chart"]);
    const plotArea = r(chartRoot["c:plotArea"]);

    // Try to get chart title
    let title = "";
    const titleEl = r(chartRoot["c:title"]);
    if (titleEl) {
      const titleTx = r(titleEl["c:tx"]);
      const titleRich = r(r(titleTx["c:rich"]));
      const titleParas = (titleRich["a:p"] as unknown[]) ?? [];
      const titleTexts = (Array.isArray(titleParas) ? titleParas : [titleParas])
        .map(collectParaText)
        .filter(Boolean);
      title = titleTexts.join(" ");
    }

    // Look for series in all chart types: barChart, lineChart, pieChart, scatterChart, etc.
    const plotAreaStr = JSON.stringify(plotArea);

    // Extract series from common chart types
    const chartTypes = ["c:barChart", "c:lineChart", "c:pieChart", "c:areaChart", "c:scatterChart", "c:radarChart"];
    let allSeries: unknown[] = [];
    for (const ct of chartTypes) {
      const chart = r(plotArea[ct]);
      const seriesInChart = (chart["c:ser"] as unknown[]) ?? [];
      if (Array.isArray(seriesInChart) && seriesInChart.length > 0) {
        allSeries = seriesInChart;
        break;
      }
    }

    // Fallback: regex-scan plotArea JSON for c:ser
    if (allSeries.length === 0 && plotAreaStr.includes("c:ser")) {
      // Try finding any nested series
      const anyChart = Object.values(plotArea).find(
        (v) => v && typeof v === "object" && !Array.isArray(v) && (v as Record<string, unknown>)["c:ser"]
      );
      if (anyChart) {
        const s = (anyChart as Record<string, unknown>)["c:ser"] as unknown[];
        if (Array.isArray(s)) allSeries = s;
      }
    }

    const categories: string[] = [];
    const series: ChartSeries[] = [];

    for (const ser of allSeries) {
      const serObj = r(ser);

      // Series name
      let seriesName = "";
      const tx = r(serObj["c:tx"]);
      const strRef = r(tx["c:strRef"]);
      const strCache = r(strRef["c:strCache"]);
      const namePts = (strCache["c:pt"] as unknown[]) ?? [];
      if (Array.isArray(namePts) && namePts.length > 0) {
        const v = r(namePts[0])["c:v"];
        seriesName = typeof v === "string" ? v : String(v ?? "");
      } else {
        // Sometimes the name is directly in c:v
        const directV = r(r(tx)["c:strRef"])["c:f"];
        seriesName = typeof directV === "string" ? directV : `Series ${series.length + 1}`;
      }

      // Category labels (only collect once from first series)
      if (categories.length === 0) {
        const cat = r(serObj["c:cat"]);
        const catStrRef = r(cat["c:strRef"] ?? cat["c:numRef"]);
        const catCache = r(catStrRef["c:strCache"] ?? catStrRef["c:numCache"]);
        const catPts = (catCache["c:pt"] as unknown[]) ?? [];
        for (const pt of catPts) {
          const v = r(pt)["c:v"];
          if (v !== undefined) categories.push(String(v));
        }
      }

      // Values
      const val = r(serObj["c:val"] ?? serObj["c:yVal"]);
      const valRef = r(val["c:numRef"]);
      const valCache = r(valRef["c:numCache"]);
      const valPts = (valCache["c:pt"] as unknown[]) ?? [];
      const values: (number | string)[] = valPts.map((pt) => {
        const v = r(pt)["c:v"];
        const num = Number(v);
        return isNaN(num) ? String(v ?? "") : num;
      });

      series.push({ name: seriesName, values });
    }

    return { title, categories, series };
  } catch {
    return null;
  }
}

/** Convert an image buffer to a base64 data URI for GPT-4o Vision. */
function toDataUri(buffer: Uint8Array, mimeType: string): string {
  const b64 = Buffer.from(buffer).toString("base64");
  return `data:${mimeType};base64,${b64}`;
}

function mimeForExt(ext: string): string {
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  return "image/png"; // default
}

/** Ask GPT-4o Vision to describe a single slide image. */
async function describeImage(client: OpenAI, dataUri: string): Promise<string> {
  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: dataUri, detail: "low" },
            },
            {
              type: "text",
              text: "Describe this presentation slide image in 1-3 sentences. Focus on the subject matter, key visual elements, data shown, or concept illustrated. Be specific and educational.",
            },
          ],
        },
      ],
    });
    return completion.choices[0]?.message?.content?.trim() ?? "";
  } catch {
    return "";
  }
}

const GENERIC_TITLES = new Set([
  "powerpoint presentation", "presentation", "untitled", "microsoft powerpoint",
  "slide 1", "slide1", "new presentation", "blank presentation",
]);

export async function POST(req: NextRequest) {
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data with a 'file' field." }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file uploaded. Send the .pptx as 'file' in form-data." }, { status: 400 });
  }

  const fileObj = file as File;
  if (!fileObj.name.toLowerCase().endsWith(".pptx")) {
    return NextResponse.json({ error: "Only .pptx files are supported." }, { status: 400 });
  }

  const MAX_BYTES = 20 * 1024 * 1024;
  if (fileObj.size > MAX_BYTES) {
    return NextResponse.json({ error: "File too large. Maximum size is 20 MB." }, { status: 413 });
  }

  let zip: JSZip;
  try {
    const buffer = await fileObj.arrayBuffer();
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return NextResponse.json({ error: "Could not read the file as a .pptx. Make sure it's a valid PowerPoint file." }, { status: 422 });
  }

  // Set up OpenAI client for vision (only used if API key is present)
  const openaiKey = process.env.OPENAI_API_KEY;
  const client = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;

  // Discover all slide files sorted by slide number
  const slideFiles = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)\.xml$/)?.[1] ?? "0", 10);
      const numB = parseInt(b.match(/slide(\d+)\.xml$/)?.[1] ?? "0", 10);
      return numA - numB;
    });

  if (slideFiles.length === 0) {
    return NextResponse.json({ error: "No slides found in the uploaded file." }, { status: 422 });
  }

  // Extract deck title from core properties
  let deckTitle = "";
  try {
    const coreXml = await zip.file("docProps/core.xml")?.async("string");
    if (coreXml) {
      const core = parser.parse(coreXml) as Record<string, unknown>;
      const raw = ((core["cp:coreProperties"] as Record<string, unknown> | undefined)?.["dc:title"] as string | undefined) ?? "";
      if (raw && !GENERIC_TITLES.has(raw.trim().toLowerCase())) deckTitle = raw.trim();
    }
  } catch {
    // Non-critical
  }

  // Step 1: parse all slide XMLs and rels in parallel (pure CPU/zip reads, no network)
  type SlideRaw = {
    index: number;
    slideFile: string;
    slideXml: Record<string, unknown>;
    title: string;
    body: string;
    visualKind: VisualKind;
    relsMap: Map<string, string>;
    imageRIds: string[];
    chartRIds: string[];
  };

  const rawSlides = (
    await Promise.all(
      slideFiles.map(async (slideFile, i) => {
        const slideXmlStr = await zip.file(slideFile)?.async("string");
        if (!slideXmlStr) return null;
        let slideXml: Record<string, unknown> = {};
        try { slideXml = parser.parse(slideXmlStr) as Record<string, unknown>; } catch { return null; }
        const relsMap = await parseSlideRels(zip, slideFile);
        return {
          index: i + 1,
          slideFile,
          slideXml,
          title: extractTitle(slideXml),
          body: extractBody(slideXml),
          visualKind: detectVisualKind(slideXml),
          relsMap,
          imageRIds: collectImageRIds(slideXml),
          chartRIds: collectChartRIds(slideXml),
        } satisfies SlideRaw;
      })
    )
  ).filter((s): s is SlideRaw => s !== null);

  if (!deckTitle && rawSlides[0]?.title) deckTitle = rawSlides[0].title;

  // Step 2: collect all unique images referenced by any slide — read their real bytes
  // unconditionally (needed for the sourceDocument's grounded assets regardless of whether Vision
  // is configured), and ALSO fire a Vision description call per image when a client is available.
  type PendingImage = { mediaPath: string; ext: string };
  const uniqueImages = new Map<string, PendingImage>(); // mediaPath → pending
  for (const s of rawSlides) {
    for (const rId of s.imageRIds) {
      const mediaPath = s.relsMap.get(rId);
      if (!mediaPath) continue;
      const ext = mediaPath.split(".").pop()?.toLowerCase() ?? "";
      if (!["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) continue;
      if (!uniqueImages.has(mediaPath)) uniqueImages.set(mediaPath, { mediaPath, ext });
    }
  }

  const describedMedia = new Map<string, { description: string; dataUrl: string }>();
  if (uniqueImages.size > 0) {
    await Promise.all(
      [...uniqueImages.values()].map(async ({ mediaPath, ext }) => {
        const imgFile = zip.file(mediaPath);
        if (!imgFile) return;
        try {
          const imgBuffer = await imgFile.async("uint8array");
          if (imgBuffer.length < 5000) return;
          const dataUrl = toDataUri(imgBuffer, mimeForExt(ext));
          const description = client ? await describeImage(client, dataUrl) : "";
          describedMedia.set(mediaPath, { description, dataUrl });
        } catch {
          // Skip this image — it simply won't appear as an asset or a description.
        }
      })
    );
  }

  // Step 3: assemble final slide objects (all chart parses also in parallel)
  const assembledSlides = await Promise.all(
    rawSlides.map(async (s) => {
      // Collect image descriptions + real bytes for this slide
      const slideImages: SlideImage[] = s.imageRIds
        .map((rId) => s.relsMap.get(rId))
        .filter((p): p is string => !!p && describedMedia.has(p))
        .map((p) => {
          const media = describedMedia.get(p)!;
          return { description: media.description, dataUrl: media.dataUrl };
        });

      // Parse charts in parallel per slide
      const slideCharts = (
        await Promise.all(
          s.chartRIds
            .map((rId) => s.relsMap.get(rId))
            .filter((p): p is string => !!p && p.includes("charts/"))
            .map((p) => parseChartXml(zip, p))
        )
      ).filter((c): c is ChartData => c !== null);

      return { ...s, images: slideImages, chartData: slideCharts };
    })
  );

  // Step 4: build text chunks and diagram hints
  const slides: ParsedSlide[] = [];
  const textChunks: string[] = [];
  const diagramSlides: string[] = [];

  for (const s of assembledSlides) {
    const slideTextParts: string[] = [];
    if (s.title) slideTextParts.push(`Title: ${s.title}`);
    if (s.body) slideTextParts.push(s.body);

    const describedImages = s.images.filter((img) => img.description);
    if (describedImages.length > 0) {
      slideTextParts.push(`[Visuals: ${describedImages.map((img, idx) => `Image ${idx + 1}: ${img.description}`).join("; ")}]`);
    }

    for (const chart of s.chartData) {
      const parts: string[] = [];
      if (chart.title) parts.push(`Chart: "${chart.title}"`);
      if (chart.categories.length > 0) parts.push(`Categories: ${chart.categories.slice(0, 8).join(", ")}`);
      for (const ser of chart.series.slice(0, 3)) {
        parts.push(`${ser.name || "Series"}: ${ser.values.slice(0, 8).join(", ")}`);
      }
      slideTextParts.push(`[${parts.join(" | ")}]`);
    }

    if (slideTextParts.length > 0) textChunks.push(`Slide ${s.index}:\n${slideTextParts.join("\n")}`);

    if (s.visualKind !== "text" || s.images.length > 0 || s.chartData.length > 0) {
      const parts: string[] = [s.visualKind];
      if (s.images.length > 0) parts.push(`${s.images.length} image(s)`);
      if (s.chartData.length > 0) parts.push(`${s.chartData.length} chart(s)`);
      diagramSlides.push(`Slide ${s.index} (${s.title || "untitled"}): ${parts.join(", ")}`);
    }

    slides.push({ index: s.index, title: s.title, body: s.body, visualKind: s.visualKind, images: s.images, chartData: s.chartData });
  }

  if (!deckTitle) {
    deckTitle = fileObj.name.replace(/\.pptx$/i, "").replace(/[-_]/g, " ").trim();
  }

  const fullTextRaw = textChunks.join("\n\n");
  const fullText = fullTextRaw.length > 4000 ? fullTextRaw.slice(0, 3900) + "\n…(truncated)" : fullTextRaw;

  const diagramHints = diagramSlides.length > 0
    ? diagramSlides.slice(0, 8).join("; ")
    : "";

  // Build a real sourceDocument for EVERY deck (not only when an image was read) so a PowerPoint
  // upload teaches its slides in exact source order, like a PDF — the deterministic
  // buildPdfLessonPlan below gives generate-lecture the same strict "follow the plan, don't reorder"
  // contract, and LearnPage.shouldSkipPlanning skips the AI outline for pptx too. One asset per
  // unique media file (a picture reused across slides is deduped via describedMedia's mediaPath
  // keys), one content block per slide, kept in slide order.
  let sourceDocument: SuprnotesLessonInput | undefined;
  {
    const assetIdByPath = new Map<string, string>();
    const assets: SuprnotesAsset[] = [];
    const contentBlocks: SuprnotesContentBlock[] = [];

    for (const s of assembledSlides) {
      const blockId = `slide-${s.index}`;
      const assetIds: string[] = [];
      for (const rId of s.imageRIds) {
        const mediaPath = s.relsMap.get(rId);
        if (!mediaPath || !describedMedia.has(mediaPath)) continue;
        let assetId = assetIdByPath.get(mediaPath);
        if (!assetId) {
          const media = describedMedia.get(mediaPath)!;
          assetId = `img-${assets.length + 1}`;
          assetIdByPath.set(mediaPath, assetId);
          assets.push({
            id: assetId,
            type: "image",
            mimeType: mimeForExt(mediaPath.split(".").pop()?.toLowerCase() ?? ""),
            url: media.dataUrl,
            description: media.description || undefined,
            sourceBlockIds: [blockId],
          });
        } else {
          const asset = assets.find((a) => a.id === assetId);
          asset?.sourceBlockIds?.push(blockId);
        }
        assetIds.push(assetId);
      }

      const textParts: string[] = [];
      if (s.title) textParts.push(s.title);
      if (s.body) textParts.push(s.body);
      for (const chart of s.chartData) {
        if (chart.title) textParts.push(`Chart: ${chart.title}`);
      }

      const text = textParts.join("\n").trim();
      // Skip an utterly empty slide (no title, no body, no image) — it has nothing to teach.
      if (!text && !assetIds.length) continue;

      contentBlocks.push({
        id: blockId,
        type: "section",
        heading: s.title || `Slide ${s.index}`,
        text: text || undefined,
        assetIds: assetIds.length ? assetIds : undefined,
        sourceOrder: s.index,
        pageNumber: s.index,
      });
    }

    if (contentBlocks.length > 0) {
      // Deterministic source-order plan — identical treatment to the PDF path, so the lecture
      // teaches slides in order, grouped into coherent beats, with no AI reordering.
      applyGlobalSourceOrder(contentBlocks);
      const lessonPlan = buildPdfLessonPlan(contentBlocks, assets);
      sourceDocument = {
        schemaVersion: "suprnotes.lesson_input.v1",
        source: { adapter: "pptx-upload", generatedAt: new Date().toISOString() },
        lesson: {
          title: deckTitle,
          subject: deckTitle,
          language: "en",
          estimatedTeachingMinutes: Math.max(5, lessonPlan.beats.length * 2),
        },
        generationDirectives: {
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
        webPreview: { status: "not_requested" },
        assets,
        contentBlocks,
        lessonPlan,
        suggestedLecturePlan: lessonPlan,
      };
    }
  }

  const result: ParsePptxResponse = {
    topic: deckTitle,
    slideCount: slides.length,
    slides,
    fullText,
    diagramHints,
    sourceDocument,
    assetCount: sourceDocument?.assets?.length ?? 0,
  };

  return NextResponse.json(result);
}
