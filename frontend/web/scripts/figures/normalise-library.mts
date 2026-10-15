/**
 * NORMALISE THE HARVEST INTO THE LIBRARY (free, offline; run after harvest-library.mts).
 *
 *   npx tsx scripts/figures/normalise-library.mts [--keep 3] [--only "heart,nephron"]
 *
 * For each downloaded candidate: sanitise the SVG (no scripts, external references, editor
 * metadata), read every label and follow its leader to the part it names (lib/figures/svgExtract.ts),
 * take the words and leaders off the art, crop to what is drawn, and write
 * data/figures/library/<id>.svg plus one entry in data/figures/library/index.json. An asset needs at
 * least 3 leader-traced ("high") parts; the best `--keep` per seed are kept.
 *
 * Entries a person has approved or rejected in /figure-lab are frozen: re-running never overwrites
 * them or their SVG.
 */
import fs from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { execFileSync } from "node:child_process";
import { analyseSvg, serializeSvg, slugPart, type Box, type OcrLine } from "../../lib/figures/svgExtract.ts";
import { words, type LibraryAsset } from "../../lib/figures/libraryIndex.ts";
import { SEEDS, type Candidate } from "./harvest-library.mts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CACHE = path.join(ROOT, "data/figures/.cache");
const LIB = path.join(ROOT, "data/figures/library");
const MAX_BYTES = 1_500_000;

/** Where the art actually draws, in root user units, measured from rendered pixels (as scripts/build-asset-catalogue.mjs does). */
function drawnBox(svg: string, page: Box): Box | null {
  const pad = Math.max(page.w, page.h) * 0.25;
  const canvas = { x: page.x - pad, y: page.y - pad, w: page.w + pad * 2, h: page.h + pad * 2 };
  const src = svg.replace(/<svg\b[^>]*>/, (tag) => tag.replace(/\s(?:width|height|viewBox)="[^"]*"/g, "").replace(/^<svg/, `<svg width="${canvas.w}" height="${canvas.h}" viewBox="${canvas.x} ${canvas.y} ${canvas.w} ${canvas.h}"`));
  const img = new Resvg(src, { fitTo: { mode: "width", value: 1200 }, font: { loadSystemFonts: false } }).render();
  const { width, height, pixels } = img;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    // Drawn = opaque and not plain white (a white page rectangle is not art).
    if (pixels[i + 3] < 24 || (pixels[i] > 246 && pixels[i + 1] > 246 && pixels[i + 2] > 246)) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return null;
  const u = canvas.w / width;
  return { x: canvas.x + (x0 - 1) * u, y: canvas.y + (y0 - 1) * u, w: (x1 - x0 + 3) * u, h: (y1 - y0 + 3) * u };
}

/** "Heart diagram-en.svg" → "Heart diagram". */
const cleanTitle = (t: string) => t.replace(/\.svg$/i, "").replace(/_/g, " ").replace(/[\s(_-]+(?:en|english)\)?$/i, "").replace(/\s+/g, " ").trim();

/**
 * Words on a render of the art, by Tesseract (local, free) — for diagrams whose labels were turned
 * into outlines. Words are grouped into lines by baseline and gap; returned in root user units.
 */
function ocrLines(svg: string, page: Box, cacheName: string): OcrLine[] {
  const px = Math.min(4200, Math.max(2600, page.w * 4));
  const scale = px / page.w;
  const src = svg.replace(/<svg\b[^>]*>/, (tag) => tag.replace(/\s(?:width|height|viewBox)="[^"]*"/g, "").replace(/^<svg/, `<svg width="${page.w}" height="${page.h}" viewBox="${page.x} ${page.y} ${page.w} ${page.h}"`));
  const png = new Resvg(src, { fitTo: { mode: "width", value: Math.round(px) }, background: "white", font: { loadSystemFonts: false } }).render().asPng();
  const dir = path.join(CACHE, "ocr");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${cacheName}.png`);
  fs.writeFileSync(file, png);
  let tsv = "";
  try { tsv = execFileSync("tesseract", [file, "stdout", "--psm", "11", "-l", "eng", "tsv"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 120_000 }); } catch { return []; } finally { fs.rmSync(file, { force: true }); }
  type W = { text: string; x: number; y: number; w: number; h: number };
  const ws: W[] = [];
  for (const row of tsv.split("\n").slice(1)) {
    const c = row.split("\t");
    if (c.length < 12 || c[0] !== "5" || Number(c[10]) < 60) continue;
    const text = c[11].trim();
    if (!/[A-Za-z]{2,}|^[A-Za-z]$/.test(text) || Number(c[9]) < 8) continue;
    ws.push({ text, x: Number(c[6]), y: Number(c[7]), w: Number(c[8]), h: Number(c[9]) });
  }
  ws.sort((a, b) => a.x - b.x);
  const lines: W[][] = [];
  for (const w of ws) {
    const line = lines.find((l) => { const last = l[l.length - 1]; const h = Math.max(last.h, w.h); return Math.abs(last.y + last.h / 2 - (w.y + w.h / 2)) < h * 0.45 && w.x - (last.x + last.w) < h * 0.9 && w.x - (last.x + last.w) > -h * 0.3; });
    if (line) line.push(w); else lines.push([w]);
  }
  return lines.map((l) => {
    const x0 = Math.min(...l.map((w) => w.x)), y0 = Math.min(...l.map((w) => w.y)), x1 = Math.max(...l.map((w) => w.x + w.w)), y1 = Math.max(...l.map((w) => w.y + w.h));
    return { text: l.map((w) => w.text).join(" "), box: { x: page.x + x0 / scale, y: page.y + y0 / scale, w: (x1 - x0) / scale, h: (y1 - y0) / scale } };
  });
}

/** Is there drawn (non-white) art within a few pixels of a point (user units from the crop's corner)? */
function drawnAt(svg: string, crop: Box): (x: number, y: number, radius?: number) => boolean {
  const img = new Resvg(svg, { fitTo: { mode: "width", value: 800 }, font: { loadSystemFonts: false } }).render();
  // resvg's `pixels` is a getter that copies the whole buffer on every access: read it once.
  const pixels = img.pixels;
  const k = img.width / crop.w;
  return (x, y, radius = 3) => {
    const cx = Math.round(x * k), cy = Math.round(y * k);
    let ink = 0, n = 0;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const px = cx + dx, py = cy + dy;
      if (px < 0 || py < 0 || px >= img.width || py >= img.height) continue;
      const i = (py * img.width + px) * 4;
      n++;
      if (pixels[i + 3] > 40 && !(pixels[i] > 240 && pixels[i + 1] > 240 && pixels[i + 2] > 240)) ink++;
    }
    return n > 0 && ink / n > (radius > 3 ? 0.08 : 0.5);
  };
}

/** "This SVG image was created by Medium69. Cette image…" → "Medium69". */
function shortAuthor(raw: string): string {
  const a = raw.replace(/^(?:this\s+[^.]{0,40}?\b(?:created|drawn|made)\s+by|created\s+by|drawn\s+by|by)\s*:?\s*/i, "").split(/\s+\.\s+|;|\s+-\s+|\. (?=[A-Z])/)[0].replace(/[\s,.]+$/, "").trim() || "Unknown author";
  return a.length > 48 ? `${a.slice(0, 46).trim()}…` : a;
}

const english = (names: string[]) => names.filter((n) => /^[A-Za-z0-9 ,'’()\-/.+]+$/.test(n)).length >= names.length * 0.8;

function main() {
  const args = process.argv.slice(2);
  const keep = args.includes("--keep") ? Number(args[args.indexOf("--keep") + 1]) : 3;
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
  const candidates: Candidate[] = JSON.parse(fs.readFileSync(path.join(CACHE, "candidates.json"), "utf8"));
  fs.mkdirSync(LIB, { recursive: true });
  const indexFile = path.join(LIB, "index.json");
  const prior: LibraryAsset[] = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, "utf8")) : [];
  const frozen = new Map(prior.filter((a) => a.reviewed || a.rejected).map((a) => [a.source.url, a]));
  const counts = { candidates: candidates.length, offSubject: 0, ocr: 0, leaderOffArt: 0, analysed: 0, failedParse: 0, traced: 0, notEnglish: 0, tooFewParts: 0, normalised: 0, kept: 0, lowParts: 0, highParts: 0 };
  type Built = { asset: LibraryAsset; svg: string; rank: number };
  const bySeed = new Map<string, Built[]>();
  const seenUrl = new Set<string>();
  for (const c of candidates) {
    if (only && !only.includes(c.seed)) continue;
    if (seenUrl.has(c.url)) continue;
    const file = path.join(CACHE, "raw", c.file);
    if (!fs.existsSync(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    if (src.length > MAX_BYTES) continue;
    const seed = SEEDS.find((s) => s.seed === c.seed);
    let a;
    let ocr = false;
    try {
      a = analyseSvg(src);
      // No real text: the labels were outlined. Read them off a render instead.
      if (a.stats.texts < 3 && !args.includes("--no-ocr")) {
        const lines = ocrLines(serializeSvg(a), a.page, c.file.replace(/\.svg$/, ""));
        if (lines.length >= 3) { a = analyseSvg(src, { ocr: lines }); ocr = true; counts.ocr++; }
      }
      counts.analysed++;
    } catch { counts.failedParse++; continue; }
    const pageArea = a.page.w * a.page.h;
    // A traced bitmap (a few enormous paths), a huge path soup, or a photo inside the SVG is not a diagram we can label.
    if ((a.stats.paths <= 4 && a.stats.pathBytes > 150_000) || a.stats.paths > 15_000 || a.stats.imageArea > pageArea * 0.02) { counts.traced++; continue; }
    // The file must be ABOUT its seed: its title names the subject (a neurone found by the
    // "animal cell" search is kept only under "neurone").
    const titleWords = words(c.title.replace(/\.svg$/i, ""));
    const about = [c.seed, ...(seed?.keywords ?? [])].some((k) => { const kw = words(k); return kw.length > 0 && kw.every((w) => titleWords.includes(w)); });
    // …and not a process diagram that merely mentions it ("Animal cell cycle", "Plant cell mitosis").
    const PROCESS = /\b(cycle|mitosis|meiosis|division|junction|transport|signal\w*|pathway|osmosis|turgor|propagation|evolution|comparison)\b/i;
    if (!about || (PROCESS.test(c.title) && !PROCESS.test(c.seed))) { counts.offSubject++; continue; }
    const high = a.labels.filter((l) => l.confidence === "high" && l.anchor);
    const low = a.labels.filter((l) => l.confidence === "low" && l.anchor);
    if (!english(a.labels.map((l) => l.name))) { counts.notEnglish++; continue; }
    if (high.length < 3) { counts.tooFewParts++; continue; }
    // (re-checked below once the art is cropped: leaders that end on blank paper do not count)
    let svg = serializeSvg(a);
    let drawn: Box | null = null;
    try { drawn = drawnBox(svg, a.page); } catch { /* fall back to the page */ }
    const anchors = [...high, ...low].map((l) => l.anchor!);
    let crop: Box = drawn ?? a.page;
    for (const p of anchors) crop = { x: Math.min(crop.x, p.x), y: Math.min(crop.y, p.y), w: Math.max(crop.x + crop.w, p.x) - Math.min(crop.x, p.x), h: Math.max(crop.y + crop.h, p.y) - Math.min(crop.y, p.y) };
    const pad = Math.max(crop.w, crop.h) * 0.015;
    crop = { x: crop.x - pad, y: crop.y - pad, w: crop.w + pad * 2, h: crop.h + pad * 2 };
    svg = serializeSvg(a, crop);
    counts.normalised++;
    seenUrl.add(c.url);
    const r = (v: number) => Math.round(v * 10) / 10;
    const base = slugPart(c.title.replace(/\.svg$/i, "").replace(/[\s_-]+en$/i, "")) || slugPart(c.seed);
    // A guessed anchor must sit on drawn art: one on blank paper (a heading over a group of labels) is dropped.
    const onArt = drawnAt(svg, crop);
    // Guesses that land on the same spot as another part are the same fallback twice: drop them.
    const near = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y) < Math.hypot(crop.w, crop.h) * 0.02;
    const kept = low.filter((l) => onArt(l.anchor!.x - crop.x, l.anchor!.y - crop.y) && ![...high, ...low].some((o) => o !== l && near(o.anchor!, l.anchor!)));
    // A leader that ends on blank paper missed its part: that part is not trusted.
    const highOnArt = high.filter((l) => onArt(l.anchor!.x - crop.x, l.anchor!.y - crop.y, 6));
    counts.leaderOffArt += high.length - highOnArt.length;
    const parts = [...highOnArt, ...kept].map((l) => ({ id: l.id, name: l.name, anchor: { x: r(l.anchor!.x - crop.x), y: r(l.anchor!.y - crop.y) }, confidence: l.confidence }));
    const asset: LibraryAsset = {
      id: base,
      title: cleanTitle(c.title),
      keywords: [...new Set([...(seed?.keywords ?? []), ...words(c.title.replace(/\.svg$/i, "")).filter((w) => w.length > 3 && w !== "svg")])],
      seed: c.seed,
      source: { url: c.page, author: c.author, licence: c.licence, licenceUrl: c.licenceUrl, revision: c.revision, file: c.url, ...(ocr ? { ocr: true } : {}) },
      credit: `${shortAuthor(c.author)}, ${c.licence}, via Wikimedia Commons`,
      w: r(crop.w),
      h: r(crop.h),
      parts,
      reviewed: false,
    };
    const rank = Math.min(25, high.length) + c.preScore * 0.6 - low.length * 0.15;
    bySeed.set(c.seed, [...(bySeed.get(c.seed) ?? []), { asset, svg, rank }]);
  }
  const index: LibraryAsset[] = [];
  const ids = new Set<string>();
  const written = new Set<string>();
  // Frozen (reviewed) entries stay exactly as the reviewer left them.
  for (const a of frozen.values()) { index.push(a); ids.add(a.id); written.add(`${a.id}.svg`); }
  for (const [seed, list] of bySeed) {
    list.sort((x, y) => y.rank - x.rank);
    for (const b of list.slice(0, keep)) {
      if (frozen.has(b.asset.source.url)) continue;
      let id = b.asset.id;
      for (let n = 2; ids.has(id); n++) id = `${b.asset.id}-${n}`;
      b.asset.id = id;
      ids.add(id);
      fs.writeFileSync(path.join(LIB, `${id}.svg`), b.svg);
      written.add(`${id}.svg`);
      index.push(b.asset);
      counts.kept++;
      counts.highParts += b.asset.parts.filter((p) => p.confidence === "high").length;
      counts.lowParts += b.asset.parts.filter((p) => p.confidence === "low").length;
      console.log(`${seed}: ${id} — ${b.asset.parts.filter((p) => p.confidence === "high").length} exact parts, ${b.asset.parts.filter((p) => p.confidence === "low").length} low (rank ${b.rank.toFixed(1)})`);
    }
  }
  // Untouched entries from an earlier run for seeds not re-run (--only) are kept too.
  if (only) for (const a of prior) if (!ids.has(a.id) && !only.includes(a.seed)) { index.push(a); ids.add(a.id); written.add(`${a.id}.svg`); }
  for (const f of fs.readdirSync(LIB)) if (f.endsWith(".svg") && !written.has(f)) fs.unlinkSync(path.join(LIB, f));
  index.sort((a, b) => a.seed.localeCompare(b.seed) || a.id.localeCompare(b.id));
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 1));
  const bytes = fs.readdirSync(LIB).reduce((s, f) => s + fs.statSync(path.join(LIB, f)).size, 0);
  console.log(JSON.stringify({ ...counts, assets: index.length, seedsCovered: new Set(index.map((a) => a.seed)).size, megabytes: Math.round(bytes / 1e4) / 100 }, null, 1));
}

main();
