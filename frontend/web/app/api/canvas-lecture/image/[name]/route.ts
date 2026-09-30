import { NextResponse } from "next/server";
import { loadCanvasImage } from "@/lib/canvas/store";
import { canvasUser } from "../../access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A picture from one of the signed-in student's own canvas lectures. A picture never changes. */
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const who = await canvasUser();
  if ("error" in who) return NextResponse.json({ error: who.error }, { status: who.status });
  const { name } = await params;
  const bytes = await loadCanvasImage(who.userId, name);
  if (!bytes) return NextResponse.json({ error: "No such picture." }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
