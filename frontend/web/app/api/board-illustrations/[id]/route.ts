import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { illustrationBytes } from "@/lib/illustratedBoard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * An illustrated board's picture (lib/illustratedBoard.ts), for the sandbox to embed.
 *
 * The blob container is private, so bytes go out only to a signed-in student — except in
 * development, where the playback and board labs render boards without an account. The id is 128
 * random bits minted per picture; a picture never changes, so it is cached for good.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV === "production" && !(await currentUser())) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const { id } = await params;
  const bytes = await illustrationBytes(id);
  if (!bytes) return NextResponse.json({ error: "No such illustration." }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
