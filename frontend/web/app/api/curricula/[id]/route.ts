import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

/** One full curriculum tree (lib/curriculum/types.ts) by its registry id. */
export async function GET(_req: Request, ctx: RouteContext<"/api/curricula/[id]">) {
  const { id } = await ctx.params;
  if (!/^[a-z0-9][a-z0-9-]{0,120}$/.test(id)) return NextResponse.json({ error: "Unknown course" }, { status: 404 });
  try {
    const text = await readFile(path.join(process.cwd(), "data/curricula/trees", `${id}.json`), "utf8");
    return new NextResponse(text, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Unknown course" }, { status: 404 });
  }
}
