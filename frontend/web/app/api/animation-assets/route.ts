import { NextResponse } from "next/server";
import { assetRuntimeFor, loadAssets, type AssetMeta } from "@/lib/assetCatalogue";

/**
 * Serves the `<Asset/>` runtime for a board: the helper plus the SVG bodies it can place.
 *
 * Why a route rather than shipping the markup on the op — one board's runtime measured ~85KB, and
 * a lecture carries several animation beats, so inlining would add hundreds of KB to every lesson
 * payload for artwork the browser may never need. The op carries IDs; this resolves them.
 *
 * The sandbox itself cannot call this: its CSP is `default-src 'none'`, so nothing inside the
 * iframe reaches the network. The PARENT fetches this and injects the result into the sandbox
 * document, exactly as it already does with the React UMD bundles.
 */
export const runtime = "nodejs";

/** A board offers at most 8 assets; anything beyond that is a malformed or hostile request. */
const MAX_IDS = 8;

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("ids") ?? "";
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    // Ids are filenames on disk. Anything outside this alphabet cannot name a real asset, and
    // letting `..` or a slash through would turn this into a file-read primitive.
    .filter((id) => /^[a-z0-9-]+$/.test(id))
    .slice(0, MAX_IDS);

  if (ids.length === 0) {
    return NextResponse.json({ error: "no valid asset ids" }, { status: 400 });
  }

  // loadAssets only needs the id to read the file; the rest of the metadata is for prompts and
  // attribution, neither of which the browser does anything with.
  const metas = ids.map((id) => ({ id, name: id, category: "", author: "", licence: "", keywords: [] }) as AssetMeta);
  const assets = await loadAssets(metas);
  if (assets.length === 0) {
    return NextResponse.json({ error: "none of those assets exist" }, { status: 404 });
  }

  return new NextResponse(assetRuntimeFor(assets), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // Content-addressed by id and shipped with the build, so it never changes under a client.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
