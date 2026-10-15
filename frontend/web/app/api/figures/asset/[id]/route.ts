import { readFile } from "node:fs/promises";
import { libraryAssetFile } from "@/lib/figures/library";

export const runtime = "nodejs";

/**
 * A library diagram's art (lib/figures/library.ts): openly-licensed, already stripped of scripts,
 * external references and its own labels by scripts/figures/normalise-library.mts. Public — it is
 * credited, licensed content — and served with a CSP that forbids everything but inline styles, in
 * case the file is ever opened directly rather than as an <image>.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-z0-9-]+$/.test(id)) return new Response("Not found", { status: 404 });
  const file = libraryAssetFile(id);
  if (!file) return new Response("Not found", { status: 404 });
  try {
    const svg = await readFile(file);
    return new Response(new Uint8Array(svg), {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "public, max-age=2592000, stale-while-revalidate=604800",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
