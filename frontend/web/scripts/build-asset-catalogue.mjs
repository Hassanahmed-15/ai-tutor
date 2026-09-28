/**
 * Builds the local artwork catalogue from Bioicons.
 *
 *   node scripts/build-asset-catalogue.mjs
 *
 * WHY A CATALOGUE AT ALL. The React sandbox is the only engine that invents its own silhouettes,
 * and the vision critic measured what that produces: 2/5 recognisability, with complaints like
 * "the mitochondrion is a plain oval without cristae". Regenerating with that complaint attached
 * changed nothing — being told what is wrong does not make a model able to draw an organelle. Real
 * artwork is the fix, so the model should POSITION a drawing rather than attempt one.
 *
 * LICENCES ARE THE FIRST FILTER, not an afterthought. Bioicons files every icon under the licence
 * it carries, so this takes only the permissive ones (`cc-0`, `cc-by-4.0`, `mit`, `bsd`) and
 * records the licence and author per asset so a board can credit them. `cc-by-sa-*` is excluded:
 * share-alike on a generated teaching board is a commitment this lab should not make silently.
 *
 * Assets land on disk rather than in a bundled module. The full set is ~1,400 files; only the
 * handful retrieved for a given brief is ever read and injected into the sandbox.
 *
 * EVERY ASSET IS MEASURED, not trusted to its page.
 *
 *   node scripts/build-asset-catalogue.mjs --measure   (offline: re-measures assets/ in place)
 *
 * Bioicons files are drawn on arbitrary pages: leaf.svg is a 53x22 leaf on a 210x297 A4 sheet, the
 * Erlenmeyer flask sits on a viewBox that starts at -120.5. The sandbox's <Asset/> fitted the PAGE
 * into the box the model asked for, so the leaf came out 65 px wide in a corner of a 320 px box and
 * every leader dot the prompt told the model to put "well inside the box" missed it. Each asset is
 * therefore rendered once here and its drawn extent — the bounds of its visible pixels, in its own
 * user units — is stored as `bbox`, which lib/assetCatalogue.ts fits into the box instead.
 *
 * Assets that draw nothing (three files are empty) or fill less than a tenth of their page are
 * DROPPED from the index, so they are never offered to the model. Their files stay on disk, so a
 * saved lecture that already names one still renders. Measuring needs no network: about ten
 * seconds for the whole catalogue, with only the board font loaded (system fonts cost ~100 ms per
 * file, and the sandbox draws asset text in the board font anyway).
 */
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = path.join(import.meta.dirname, "..");
const OUT = path.join(ROOT, "assets");
const TMP = path.join(ROOT, ".asset-build");
const ZIP_URL = "https://codeload.github.com/duerrsimon/bioicons/zip/refs/heads/main";

/** Licences that allow use and adaptation with, at most, attribution. */
const ALLOWED_LICENCES = new Set(["cc-0", "cc-by-4.0", "mit", "bsd"]);
/** Past this an icon is a full illustration, too heavy to inline into a sandbox document. */
const MAX_BYTES = 60_000;

/**
 * Below this share of its page an asset is dropped. Measured on the catalogue: the seven under it
 * are sheet-sized pages with a small drawing (leaf.svg at 1.9%, a dark oval that reads as the
 * "plain oval" the vision critic kept rejecting), and nothing above it was a speck.
 */
export const MIN_PAGE_FILL = 0.1;
/** The longer side, in pixels, of the canvas each asset is measured on (~0.1% of its page). */
const MEASURE_LONG_SIDE = 2048;
/** Alpha (0-255) at which a pixel counts as drawn — anti-aliasing haze below it does not. */
const ALPHA_VISIBLE = 16;
const BOARD_FONTS = ["PlaypenSans-SemiBold.ttf", "PlaypenSans-ExtraBold.ttf"]
  .map((file) => path.join(ROOT, "public", "fonts", file))
  .filter((file) => existsSync(file));

/** The bounds of the pixels at or above `threshold` alpha in an RGBA buffer; null when none are. */
export function alphaBounds(pixels, width, height, threshold = ALPHA_VISIBLE) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (pixels[row + x * 4 + 3] < threshold) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

/**
 * The page an SVG draws on, in its own user units: its viewBox (origin included), or — with no
 * usable viewBox — its pixel size, since user units are then pixels.
 */
export function pageOf(svgText, pixelWidth, pixelHeight) {
  const open = /<svg\b[^>]*>/i.exec(svgText)?.[0] ?? "";
  const parts = /viewBox\s*=\s*"([^"]+)"/i.exec(open)?.[1]?.trim().split(/[\s,]+/).map(Number);
  if (parts && parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
    return { x: parts[0], y: parts[1], w: parts[2], h: parts[3], fromViewBox: true };
  }
  return { x: 0, y: 0, w: pixelWidth, h: pixelHeight, fromViewBox: false };
}

/**
 * Where one asset actually draws: `{ page, bbox: [x, y, w, h], fill }` in its own user units, or
 * `{ error }` when it will not render or draws nothing. `Resvg` is the class from @resvg/resvg-js,
 * passed in so the arithmetic is tested against the real renderer.
 *
 * MEASURED ON A CANVAS LARGER THAN THE PAGE. Artwork is not confined to its viewBox — the Erlenmeyer
 * flask's neck runs above its page, and the sandbox draws that overflow (an <Asset/> is a plain <g>,
 * never clipped). Rendering only the page clipped it off, the box came out too small, and the flask
 * spilled out of the box the model asked for. So the root is re-sized to the page plus half its
 * longer side on every side — one canvas whose aspect is its own, so pixels map linearly onto user
 * units even when the root's width/height ("1.73in" x "1.81in") disagree with its viewBox.
 */
export function measureAsset(svgText, Resvg, fontFiles = BOARD_FONTS) {
  const font = { loadSystemFonts: false, fontFiles, defaultFontFamily: "Playpen Sans" };
  try {
    const probe = new Resvg(svgText, { font });
    const page = pageOf(svgText, probe.width, probe.height);
    const round = (value) => Math.round(value * 1000) / 1000;
    /*
     * Half the page's longer side of margin first; if the drawing still reaches the canvas edge,
     * once more with four times that. Drawing that reaches even the wider edge is unbounded (a
     * full-canvas background, a stray layer) and says nothing about where the artwork is, so the
     * page stands in for it — exactly what <Asset/> fitted before this measurement existed.
     */
    for (const margin of [0.5, 2]) {
      const pad = Math.max(page.w, page.h) * margin;
      const canvas = { x: page.x - pad, y: page.y - pad, w: page.w + pad * 2, h: page.h + pad * 2 };
      const source = svgText.replace(/<svg\b[^>]*>/i, (tag) =>
        tag
          .replace(/\s(?:width|height|viewBox|preserveAspectRatio)\s*=\s*("[^"]*"|'[^']*')/gi, "")
          .replace(/^<svg/i, `<svg width="${canvas.w}" height="${canvas.h}" viewBox="${canvas.x} ${canvas.y} ${canvas.w} ${canvas.h}"`),
      );
      const scale = MEASURE_LONG_SIDE / Math.max(canvas.w, canvas.h);
      const image = new Resvg(source, { font, fitTo: { mode: "width", value: Math.max(1, Math.round(canvas.w * scale)) } }).render();
      const drawn = alphaBounds(image.pixels, image.width, image.height);
      if (!drawn) return { error: "draws nothing" };
      if (drawn.x0 === 0 || drawn.y0 === 0 || drawn.x1 === image.width || drawn.y1 === image.height) continue;
      const ux = canvas.w / image.width;
      const uy = canvas.h / image.height;
      // One pixel of margin each side: the threshold trims the last of an anti-aliased edge.
      const bbox = [
        round(canvas.x + (drawn.x0 - 1) * ux),
        round(canvas.y + (drawn.y0 - 1) * uy),
        round((drawn.x1 - drawn.x0 + 2) * ux),
        round((drawn.y1 - drawn.y0 + 2) * uy),
      ];
      return { page, bbox, fill: (bbox[2] * bbox[3]) / (page.w * page.h) };
    }
    return { page, bbox: [page.x, page.y, page.w, page.h], fill: 1 };
  } catch (err) {
    return { error: err instanceof Error ? err.message.split("\n")[0] : "render failed" };
  }
}

/**
 * Measures every indexed asset in `dir`. Returns the entries worth offering, each with its `bbox`,
 * and the ones dropped with the reason — nothing is deleted from disk.
 */
export async function measureCatalogue(dir, index) {
  const { Resvg } = await import("@resvg/resvg-js");
  const kept = [];
  const dropped = [];
  for (const entry of index) {
    let svgText;
    try {
      svgText = await readFile(path.join(dir, `${entry.id}.svg`), "utf8");
    } catch {
      dropped.push({ id: entry.id, reason: "file missing" });
      continue;
    }
    const measured = measureAsset(svgText, Resvg);
    if (measured.error) {
      dropped.push({ id: entry.id, reason: measured.error });
      continue;
    }
    if (measured.fill < MIN_PAGE_FILL) {
      dropped.push({ id: entry.id, reason: `fills ${(measured.fill * 100).toFixed(1)}% of its page` });
      continue;
    }
    kept.push({ ...entry, bbox: measured.bbox });
  }
  return { kept, dropped };
}

async function writeMeasuredIndex(index) {
  const started = Date.now();
  const { kept, dropped } = await measureCatalogue(OUT, index);
  kept.sort((a, b) => a.id.localeCompare(b.id));
  // One line per box, so the catalogue's diff shows which boxes changed rather than six lines each.
  const json = JSON.stringify(kept, null, 1).replace(/"bbox": \[\s*([^\]]*?)\s*\]/g, (_, inner) => `"bbox": [${inner.split(/,\s*/).join(", ")}]`);
  await writeFile(path.join(OUT, "index.json"), `${json}\n`);
  console.log(`measured ${index.length} assets in ${((Date.now() - started) / 1000).toFixed(1)}s: ${kept.length} kept, ${dropped.length} dropped`);
  for (const { id, reason } of dropped) console.log(`  dropped ${id}: ${reason}`);
  return kept;
}

async function download() {
  await mkdir(TMP, { recursive: true });
  const zip = path.join(TMP, "bioicons.zip");
  try {
    await stat(zip);
    console.log("using cached bioicons.zip");
    return zip;
  } catch {
    /* not cached */
  }
  console.log("downloading bioicons…");
  const res = await fetch(ZIP_URL);
  if (!res.ok) throw new Error(`bioicons download failed: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(zip));
  return zip;
}

async function expand(zip) {
  const dir = path.join(TMP, "src");
  try {
    await stat(path.join(dir, "bioicons-main"));
    console.log("using expanded copy");
    return path.join(dir, "bioicons-main");
  } catch {
    /* not expanded */
  }
  console.log("expanding…");
  // The platform's own unzip avoids adding a tar/zip dependency for a one-off build step:
  // PowerShell's Expand-Archive on Windows, `unzip` everywhere else.
  if (process.platform === "win32") {
    await execFileAsync("powershell", [
      "-NoProfile",
      "-Command",
      `Expand-Archive -Path '${zip}' -DestinationPath '${dir}' -Force`,
    ]);
  } else {
    await mkdir(dir, { recursive: true });
    await execFileAsync("unzip", ["-q", "-o", zip, "-d", dir]);
  }
  return path.join(dir, "bioicons-main");
}

/** Walks a directory tree, yielding every .svg path. */
async function* svgFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* svgFiles(full);
    else if (entry.name.endsWith(".svg")) yield full;
  }
}

/** "Nuclear_pore_complex.svg" -> "nuclear pore complex", the words a brief would actually use. */
function keywordsFor(name, category, author) {
  const words = `${name} ${category}`
    .replace(/\.svg$/i, "")
    .replace(/[_\-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);
  return [...new Set(words)].filter((w) => !author.toLowerCase().includes(w));
}

const main = async () => {
  if (process.argv.includes("--measure")) {
    // Offline: re-measure the catalogue already on disk, without downloading or rewriting a file.
    const index = JSON.parse(await readFile(path.join(OUT, "index.json"), "utf8"));
    await writeMeasuredIndex(index);
    return;
  }

  const src = await expand(await download());
  const iconRoot = path.join(src, "static", "icons");

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  const index = [];
  const seen = new Set();
  let skippedLicence = 0;
  let skippedSize = 0;

  for await (const file of svgFiles(iconRoot)) {
    // Depth varies: most icons are licence/category/author/name.svg, but some sit directly under
    // licence/category/. Take the filename from the end rather than assuming a fixed shape.
    const rel = path.relative(iconRoot, file).split(path.sep);
    const licence = rel[0];
    const category = rel.length > 2 ? rel[1] : "";
    const author = rel.length > 3 ? rel[2] : "";
    const fileName = rel[rel.length - 1];
    if (!ALLOWED_LICENCES.has(licence)) {
      skippedLicence++;
      continue;
    }
    const info = await stat(file);
    if (info.size > MAX_BYTES) {
      skippedSize++;
      continue;
    }

    const base = fileName.replace(/\.svg$/i, "");
    // Names collide across contributors; the id has to stay stable and unique because the model
    // refers to assets by it.
    let id = base.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
    let n = 2;
    while (seen.has(id)) id = `${base.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${n++}`;
    seen.add(id);

    await writeFile(path.join(OUT, `${id}.svg`), await readFile(file));
    index.push({
      id,
      name: base.replace(/[_-]+/g, " "),
      category: category.replace(/_/g, " "),
      author: author.replace(/_/g, " "),
      licence,
      keywords: keywordsFor(base, category, author),
    });
  }

  console.log(`\n${index.length} assets written to assets/`);
  console.log(`skipped: ${skippedLicence} on licence, ${skippedSize} over ${MAX_BYTES / 1000}KB`);
  const kept = await writeMeasuredIndex(index);
  const byLicence = {};
  for (const a of kept) byLicence[a.licence] = (byLicence[a.licence] ?? 0) + 1;
  console.log("by licence:", byLicence);
};

// Run only as a script: the measuring functions above are imported by lib/anim/assetCatalogueBuild.test.mjs.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
