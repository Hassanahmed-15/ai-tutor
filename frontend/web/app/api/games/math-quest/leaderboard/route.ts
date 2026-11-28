import { NextResponse } from "next/server";
import { currentPlayer, loadBoard, saveBoardRow } from "@/lib/games/mathQuest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * MATH QUEST'S WEEKLY LEAGUE (the game's `leaderboardEndpoint`): GET ?week=YYYY-MM-DD → {rows:[{id,name,wxp,streak}]}
 * (top 30 by weekly XP); POST {id,name,wk,wxp,xp,streak} upserts a row. When a student is signed in, the id and
 * name come from their session, never from the request body.
 */
export async function GET(req: Request) {
  const wk = new URL(req.url).searchParams.get("week");
  const board = await loadBoard();
  const rows = Object.entries(board).filter(([, v]) => v.wk === wk).map(([id, v]) => ({ id, name: v.name, wxp: v.wxp, streak: v.streak }))
    .sort((a, b) => b.wxp - a.wxp).slice(0, 30);
  return NextResponse.json({ rows });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const me = await currentPlayer();
  const id = (me?.id ?? String(b.id ?? "")).slice(0, 80);
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  await saveBoardRow(id, {
    name: (me?.name ?? String(b.name || "Player")).slice(0, 40),
    wk: String(b.wk ?? "").slice(0, 10),
    wxp: Math.max(0, Math.min(1e6, Number(b.wxp) || 0)),
    xp: Number(b.xp) || 0,
    streak: Number(b.streak) || 0,
    ts: Date.now(),
  });
  return NextResponse.json({ ok: true });
}
