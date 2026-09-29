import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

/** Bench boards live in anim-lab/runs/bench/<variant>.json as [{ id, title, script, code, assetIds }]. */
const DIR = path.join(process.cwd(), "runs", "bench");

export async function GET(req: Request) {
  const url = new URL(req.url);
  const file = url.searchParams.get("variant") ?? "";
  const id = url.searchParams.get("id") ?? "";
  if (!/^[\w-]{1,60}$/.test(file)) return NextResponse.json({ error: "bad variant" }, { status: 400 });
  try {
    const boards = JSON.parse(await fs.readFile(path.join(DIR, `${file}.json`), "utf8")) as Array<{ id: string }>;
    const board = boards.find((entry) => entry.id === id);
    return board ? NextResponse.json(board) : NextResponse.json({ error: "no such board" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "no such variant" }, { status: 404 });
  }
}
