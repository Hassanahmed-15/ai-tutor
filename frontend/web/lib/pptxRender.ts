import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";

/**
 * Slide previews for a PowerPoint, so a deck can be treated exactly like a PDF.
 *
 * WHY THIS EXISTS. A PDF gets page thumbnails, a page grid and a drag-a-region selector; a deck got
 * "Slide previews are unavailable for PowerPoint files" and a list of titles. That was never a
 * decision — PowerPoint has no page raster, and rendering one properly means LibreOffice, which is
 * not in this image.
 *
 * IT USES THE REAL GEOMETRY. Every shape in a slide carries its position and size in EMU
 * (`a:off` / `a:ext`, 914400 to the inch), and the slide its own dimensions. The first version
 * ignored all of it and stacked text down the left with pictures in a column on the right — which
 * put a row of decorative icons through the middle of the first slide and looked nothing like the
 * deck. Shapes are placed where PowerPoint says they are now, scaled to the canvas.
 *
 * IT IS STILL NOT A POWERPOINT RENDERER. Themes, master layouts, fonts, SmartArt, native charts,
 * gradients and effects are not reproduced: this draws the text and the embedded pictures at their
 * true positions. The preview exists so a student can point at part of a slide and have that part
 * cropped and READ — the pictures are the file's own bitmaps, so pointing at a chart crops the
 * actual chart, and that is what has to be faithful.
 */

export type RenderedSlide = {
  slideNumber: number;
  png: Buffer;
  width: number;
  height: number;
  /** The slide's text in reading order, for the grid's excerpt. */
  text: string;
};

/** Wide enough that a cropped region is still legible to a vision model. */
const CANVAS_W = 1600;
/** English Metric Units per inch, and PowerPoint's default 16:9 slide, used when a deck omits its size. */
const EMU_PER_INCH = 914400;
const DEFAULT_CX = 12192000;
const DEFAULT_CY = 6858000;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

type Box = { x: number; y: number; w: number; h: number };
type TextShape = Box & { runs: string[]; sizePt: number; bold: boolean; placeholder: string | null };
type PicShape = Box & { embed: string };

const asArray = <T,>(v: T | T[] | undefined): T[] => (Array.isArray(v) ? v : v ? [v] : []);

/** Text runs inside one shape, in order, with paragraph breaks preserved. */
function runsOf(node: unknown): string[] {
  const body = (node as Record<string, unknown> | null)?.["p:txBody"];
  if (!body) return [];
  const out: string[] = [];
  for (const para of asArray((body as Record<string, unknown>)["a:p"])) {
    const pieces: string[] = [];
    for (const run of asArray((para as Record<string, unknown>)?.["a:r"])) {
      const t = (run as Record<string, unknown>)?.["a:t"];
      if (typeof t === "string") pieces.push(t);
      else if (typeof t === "number") pieces.push(String(t));
      else if (t && typeof t === "object") {
        const inner = (t as { "#text"?: unknown })["#text"];
        if (typeof inner === "string") pieces.push(inner);
      }
    }
    const line = pieces.join("").replace(/\s+/g, " ").trim();
    if (line) out.push(line);
  }
  return out;
}

/** The shape's own transform, if it declares one. */
function boxOf(node: unknown, key: string): Box | null {
  const props = (node as Record<string, unknown> | null)?.[key] as Record<string, unknown> | undefined;
  const xfrm = props?.["a:xfrm"] as Record<string, unknown> | undefined;
  const off = xfrm?.["a:off"] as Record<string, string> | undefined;
  const ext = xfrm?.["a:ext"] as Record<string, string> | undefined;
  if (!off || !ext) return null;
  const x = Number(off["@_x"]);
  const y = Number(off["@_y"]);
  const w = Number(ext["@_cx"]);
  const h = Number(ext["@_cy"]);
  if (![x, y, w, h].every(Number.isFinite)) return null;
  return { x, y, w, h };
}

/** "title", "ctrTitle", "subTitle", "body"… or null when the shape is not a placeholder. */
function placeholderOf(node: unknown): string | null {
  const nv = (node as Record<string, unknown> | null)?.["p:nvSpPr"] as Record<string, unknown> | undefined;
  const nvPr = nv?.["p:nvPr"] as Record<string, unknown> | undefined;
  const ph = nvPr?.["p:ph"] as Record<string, string> | undefined;
  if (!ph) return null;
  return ph["@_type"] ?? "body";
}

/** First run's point size, so a title still reads as a title. */
function sizeOf(node: unknown): { sizePt: number; bold: boolean } {
  // Returns 0 when the run declares none, so the caller can pick a size from the placeholder role.
  const body = (node as Record<string, unknown> | null)?.["p:txBody"] as Record<string, unknown> | undefined;
  for (const para of asArray(body?.["a:p"])) {
    for (const run of asArray((para as Record<string, unknown>)?.["a:r"])) {
      const props = (run as Record<string, unknown>)?.["a:rPr"] as Record<string, string> | undefined;
      const sz = Number(props?.["@_sz"]);
      // OOXML stores hundredths of a point.
      if (Number.isFinite(sz) && sz > 0) return { sizePt: sz / 100, bold: props?.["@_b"] === "1" };
    }
  }
  return { sizePt: 0, bold: false };
}

/** Walk the shape tree, including groups, collecting anything with a position. */
function walk(tree: unknown, texts: TextShape[], pics: PicShape[]): void {
  if (!tree || typeof tree !== "object") return;
  const node = tree as Record<string, unknown>;

  for (const sp of asArray(node["p:sp"])) {
    const runs = runsOf(sp);
    if (runs.length === 0) continue;
    /*
     * A shape with NO transform is normal, not broken.
     *
     * Title and body placeholders usually inherit their position from the slide layout and carry no
     * a:xfrm of their own. Requiring one dropped most of the text on a real deck — the geometry pass
     * was right for the shapes that declare it and silently threw away the ones that do not. The
     * placeholder type is enough to put those somewhere sensible.
     */
    texts.push({
      ...(boxOf(sp, "p:spPr") ?? { x: -1, y: -1, w: -1, h: -1 }),
      runs,
      ...sizeOf(sp),
      placeholder: placeholderOf(sp),
    });
  }

  for (const pic of asArray(node["p:pic"])) {
    const box = boxOf(pic, "p:spPr");
    const fill = (pic as Record<string, unknown>)["p:blipFill"] as Record<string, unknown> | undefined;
    const blip = fill?.["a:blip"] as Record<string, string> | undefined;
    const embed = blip?.["@_r:embed"];
    if (box && embed) pics.push({ ...box, embed });
  }

  // Groups carry their own transform, but children are already in slide coordinates often enough
  // that recursing plainly is closer than not drawing them at all.
  for (const grp of asArray(node["p:grpSp"])) walk(grp, texts, pics);
}

function slidePaths(zip: JSZip): string[] {
  return Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => {
      const n = (p: string) => Number(p.match(/slide(\d+)\.xml$/)?.[1] ?? 0);
      return n(a) - n(b);
    });
}

/** r:embed id → image bytes, for one slide. */
async function mediaFor(zip: JSZip, slidePath: string): Promise<Map<string, Buffer>> {
  const relsPath = slidePath.replace(/slides\/(slide\d+)\.xml$/, "slides/_rels/$1.xml.rels");
  const relsFile = zip.file(relsPath);
  const map = new Map<string, Buffer>();
  if (!relsFile) return map;

  const rels = parser.parse(await relsFile.async("string"));
  for (const rel of asArray(rels?.Relationships?.Relationship)) {
    const r = rel as Record<string, string>;
    const target = String(r["@_Target"] ?? "");
    if (!/\.(png|jpe?g|gif|bmp|tiff?)$/i.test(target)) continue;
    const media = zip.file(target.replace(/^\.\.\//, "ppt/"));
    if (!media) continue;
    try {
      map.set(String(r["@_Id"]), Buffer.from(await media.async("uint8array")));
    } catch {
      // An undecodable picture simply does not appear.
    }
  }
  return map;
}

/** Slide dimensions in EMU, from the presentation itself. */
async function slideSize(zip: JSZip): Promise<{ cx: number; cy: number }> {
  const file = zip.file("ppt/presentation.xml");
  if (!file) return { cx: DEFAULT_CX, cy: DEFAULT_CY };
  try {
    const xml = parser.parse(await file.async("string"));
    const sz = xml?.["p:presentation"]?.["p:sldSz"] as Record<string, string> | undefined;
    const cx = Number(sz?.["@_cx"]);
    const cy = Number(sz?.["@_cy"]);
    return Number.isFinite(cx) && Number.isFinite(cy) && cx > 0 && cy > 0 ? { cx, cy } : { cx: DEFAULT_CX, cy: DEFAULT_CY };
  } catch {
    return { cx: DEFAULT_CX, cy: DEFAULT_CY };
  }
}

/** Word-wrap into a width, capped by the shape's own height. */
function wrap(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) line = next;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderPptxSlides(bytes: Uint8Array): Promise<RenderedSlide[]> {
  const zip = await JSZip.loadAsync(bytes);
  const { cx, cy } = await slideSize(zip);
  const scale = CANVAS_W / cx;
  const canvasH = Math.round(cy * scale);
  const out: RenderedSlide[] = [];

  for (const [index, path] of slidePaths(zip).entries()) {
    const file = zip.file(path);
    if (!file) continue;

    const xml = parser.parse(await file.async("string"));
    const tree = xml?.["p:sld"]?.["p:cSld"]?.["p:spTree"];
    const texts: TextShape[] = [];
    const pics: PicShape[] = [];
    walk(tree, texts, pics);
    const media = await mediaFor(zip, path);

    const canvas = createCanvas(CANVAS_W, canvasH);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, CANVAS_W, canvasH);

    /*
     * Pictures first, so text drawn over them stays readable — the same order PowerPoint's own
     * z-order usually produces for a content slide.
     *
     * Decorative icons are skipped by RENDERED AREA rather than file size: a 40KB emoji and a 40KB
     * chart are indistinguishable by bytes, and it was the emoji that ended up marching down the
     * middle of the first slide.
     */
    const slideArea = CANVAS_W * canvasH;
    for (const pic of pics) {
      const buffer = media.get(pic.embed);
      if (!buffer) continue;
      const x = pic.x * scale;
      const y = pic.y * scale;
      const w = pic.w * scale;
      const h = pic.h * scale;
      if (w * h < slideArea * 0.004) continue;
      try {
        ctx.drawImage(await loadImage(buffer), x, y, w, h);
      } catch {
        // Undecodable: leave the space empty rather than lose the slide.
      }
    }

    /*
     * Lay out the shapes that inherit their position.
     *
     * A title goes across the top, everything else flows beneath it — which is what the standard
     * layouts do, and is far closer than dropping the text or piling it at the origin.
     */
    let flowY = canvasH * 0.34;
    for (const shape of texts) {
      const inherits = shape.x < 0;
      const isTitle = shape.placeholder === "title" || shape.placeholder === "ctrTitle";
      let x = shape.x * scale;
      let y = shape.y * scale;
      let w = Math.max(20, shape.w * scale);
      let h = Math.max(16, shape.h * scale);
      if (inherits) {
        x = CANVAS_W * 0.07;
        w = CANVAS_W * 0.86;
        if (isTitle) {
          y = canvasH * 0.12;
          h = canvasH * 0.18;
        } else {
          y = flowY;
          h = canvasH * 0.16;
          flowY += canvasH * 0.13;
        }
      }
      // Point size scales with the slide, exactly as it does in PowerPoint.
      // An inherited placeholder has no declared size either; a title is simply bigger.
      const pt = shape.sizePt || (isTitle ? 40 : 20);
      const px = Math.max(11, pt * (CANVAS_W / (cx / EMU_PER_INCH)) / 72);
      ctx.fillStyle = "#0f172a";
      ctx.font = `${shape.bold ? "600 " : ""}${Math.round(px)}px system-ui, sans-serif`;

      let cursor = y + px;
      for (const run of shape.runs) {
        for (const line of wrap(ctx, run, w)) {
          if (cursor > y + h + px) break;
          ctx.fillText(line, x, cursor);
          cursor += px * 1.28;
        }
      }
    }

    out.push({
      slideNumber: index + 1,
      png: canvas.toBuffer("image/png"),
      width: CANVAS_W,
      height: canvasH,
      text: texts.flatMap((t) => t.runs).join(" · ").slice(0, 400),
    });
  }

  return out;
}
