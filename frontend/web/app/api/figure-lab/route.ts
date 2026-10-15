import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { LIBRARY_DIR, reloadLibraryIndex } from "@/lib/figures/library";
import { LIBRARY_ID, type LibraryAsset } from "@/lib/figures/libraryIndex";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The figure lab's store (app/figure-lab): development only. GET lists the whole index (rejected
 * included) or, with ?svg=<id>, returns one asset's art; POST records a review — approve, reject or
 * reset, part names edited, parts dropped — straight into data/figures/library/index.json.
 */
const INDEX = () => path.join(LIBRARY_DIR, "index.json");
const devOnly = () => (process.env.NODE_ENV === "production" ? NextResponse.json({ error: "Not available." }, { status: 404 }) : null);

async function readIndex(): Promise<LibraryAsset[]> {
  try { return JSON.parse(await readFile(INDEX(), "utf8")) as LibraryAsset[]; } catch { return []; }
}

export async function GET(request: Request) {
  const blocked = devOnly();
  if (blocked) return blocked;
  const id = new URL(request.url).searchParams.get("svg");
  if (id) {
    if (!LIBRARY_ID.test(id)) return new Response("Not found", { status: 404 });
    try {
      const svg = await readFile(path.join(LIBRARY_DIR, `${id}.svg`));
      return new Response(new Uint8Array(svg), { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" } });
    } catch { return new Response("Not found", { status: 404 }); }
  }
  return NextResponse.json({ assets: await readIndex() });
}

type Review = { id?: unknown; action?: unknown; names?: unknown; drop?: unknown };

export async function POST(request: Request) {
  const blocked = devOnly();
  if (blocked) return blocked;
  const body = (await request.json().catch(() => ({}))) as Review;
  const id = typeof body.id === "string" && LIBRARY_ID.test(body.id) ? body.id : "";
  const action = body.action === "approve" || body.action === "reject" || body.action === "reset" || body.action === "save" ? body.action : null;
  if (!id || !action) return NextResponse.json({ error: "id and action (approve | reject | reset | save) are required" }, { status: 400 });
  const index = await readIndex();
  const asset = index.find((a) => a.id === id);
  if (!asset) return NextResponse.json({ error: "No such asset." }, { status: 404 });
  const names = body.names && typeof body.names === "object" ? (body.names as Record<string, unknown>) : {};
  const drop = new Set(Array.isArray(body.drop) ? body.drop.filter((d): d is string => typeof d === "string") : []);
  for (const p of asset.parts) {
    const name = names[p.id];
    if (typeof name === "string" && name.trim()) p.name = name.replace(/\s+/g, " ").trim().slice(0, 60);
  }
  asset.parts = asset.parts.filter((p) => !drop.has(p.id));
  if (action === "approve") { asset.reviewed = true; delete asset.rejected; }
  if (action === "reject") { asset.rejected = true; asset.reviewed = true; }
  if (action === "reset") { asset.reviewed = false; delete asset.rejected; }
  await writeFile(INDEX(), JSON.stringify(index, null, 1));
  reloadLibraryIndex();
  return NextResponse.json({ asset });
}
