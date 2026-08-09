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
 */
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
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
  // PowerShell's Expand-Archive avoids adding a tar/zip dependency for a one-off build step.
  await execFileAsync("powershell", [
    "-NoProfile",
    "-Command",
    `Expand-Archive -Path '${zip}' -DestinationPath '${dir}' -Force`,
  ]);
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

  index.sort((a, b) => a.id.localeCompare(b.id));
  await writeFile(path.join(OUT, "index.json"), `${JSON.stringify(index, null, 1)}\n`);

  console.log(`\n${index.length} assets written to assets/`);
  console.log(`skipped: ${skippedLicence} on licence, ${skippedSize} over ${MAX_BYTES / 1000}KB`);
  const byLicence = {};
  for (const a of index) byLicence[a.licence] = (byLicence[a.licence] ?? 0) + 1;
  console.log("by licence:", byLicence);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
