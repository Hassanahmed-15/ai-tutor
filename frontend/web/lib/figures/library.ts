import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";
import { appPath } from "../appPaths";
import { LIBRARY_ID, pickLibraryAsset, stageAsset, type LibraryAsset, type StageAsset } from "./libraryIndex";

/**
 * THE TEXTBOOK DIAGRAM LIBRARY on the server: real, openly-licensed diagrams (data/figures/library,
 * built by scripts/figures/harvest-library.mts + normalise-library.mts), each with its labelled
 * parts as exact anchors. The visual policy asks `findLibraryFigure` for a board's diagram
 * (lib/canvas/progressive.ts passes it in, so the policy stays pure); the board writer is told the
 * diagram's parts; the asset is served by app/api/figures/asset/[id].
 */

export const LIBRARY_DIR = appPath("data", "figures", "library");

let cache: LibraryAsset[] | null = null;

/** The index, read once. A missing or broken index is an empty library, never an error. */
export function libraryIndex(): LibraryAsset[] {
  if (cache) return cache;
  try {
    const raw = JSON.parse(readFileSync(path.join(LIBRARY_DIR, "index.json"), "utf8")) as LibraryAsset[];
    cache = Array.isArray(raw) ? raw.filter((a) => a && LIBRARY_ID.test(a.id) && !a.rejected && Array.isArray(a.parts)) : [];
  } catch {
    cache = [];
  }
  return cache;
}

/** Forget the cached index (the figure lab edits it in dev). */
export function reloadLibraryIndex(): void {
  cache = null;
}

/**
 * The library diagram for a board, or null. Scored by lib/figures/libraryIndex.ts
 * scoreLibraryAsset: the board must name the diagram's subject, plus at least two more signals
 * (LIBRARY_MATCH_THRESHOLD = 6). Returns what a board stage carries.
 */
export function findLibraryFigure(text: string, mustShow: string[] = []): StageAsset | null {
  const match = pickLibraryAsset(libraryIndex(), text, mustShow);
  return match ? stageAsset(match.asset) : null;
}

/** One asset as a stage carries it, by id (the server's copy — the model's is never trusted). */
export function libraryStageAsset(id: string | undefined): StageAsset | null {
  if (!id || !LIBRARY_ID.test(id)) return null;
  const asset = libraryIndex().find((a) => a.id === id);
  return asset ? stageAsset(asset) : null;
}

/** The asset's title, for the board writer. */
export function libraryAssetTitle(id: string): string | undefined {
  return libraryIndex().find((a) => a.id === id)?.title;
}

/** Absolute path of an asset's stripped SVG, or null for an id that is not a library asset. */
export function libraryAssetFile(id: string): string | null {
  if (!LIBRARY_ID.test(id)) return null;
  return libraryIndex().some((a) => a.id === id) ? path.join(LIBRARY_DIR, `${id}.svg`) : null;
}
