import { NextResponse } from "next/server";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { catalogEntry, type CatalogEntry } from "@/lib/curriculum/catalog";
import { buildMenu } from "@/lib/curriculum/curation";
import type { CurriculumTree } from "@/lib/curriculum/types";

/**
 * The course menu students browse: the catalogue index (lib/curriculum/catalog.ts, built by
 * scripts/curriculum/catalog.mts) curated by lib/curriculum/curation.ts.
 * Outside production it rebuilds itself when course trees have been added since it was written, so
 * courses appear while the extraction runs are still going.
 */
const DIR = path.join(process.cwd(), "data/curricula");

async function rebuildIfStale(): Promise<void> {
  if (process.env.NODE_ENV === "production") return;
  const trees = path.join(DIR, "trees");
  const [dir, cat] = await Promise.all([stat(trees).catch(() => null), stat(path.join(DIR, "catalog.json")).catch(() => null)]);
  if (!dir || (cat && cat.mtimeMs >= dir.mtimeMs)) return;
  const files = (await readdir(trees)).filter((f) => f.endsWith(".json")).sort();
  const entries = [];
  for (const f of files) {
    try {
      const tree = JSON.parse(await readFile(path.join(trees, f), "utf8")) as CurriculumTree;
      if (tree.grades?.length) entries.push(catalogEntry(tree));
    } catch {
      // A tree being written right now: it joins on the next rebuild.
    }
  }
  await writeFile(path.join(DIR, "catalog.json"), JSON.stringify({ builtAt: new Date().toISOString(), entries }, null, 1));
}

export async function GET() {
  try {
    await rebuildIfStale();
    const catalog = JSON.parse(await readFile(path.join(DIR, "catalog.json"), "utf8")) as { builtAt: string; entries: CatalogEntry[] };
    // Students see the curated menu (lib/curriculum/curation.ts), not every document we extracted.
    return NextResponse.json({ builtAt: catalog.builtAt, menu: buildMenu(catalog.entries) }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ builtAt: null, menu: { regions: [] } });
  }
}
