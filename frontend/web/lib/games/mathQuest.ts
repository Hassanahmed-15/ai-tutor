import "server-only";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { currentUser } from "@/lib/auth";
import { users, type UserDoc } from "@/lib/db/cosmos";

/**
 * MATH QUEST in Aria (docs/math-quest.md): the owner's own game, served byte-for-byte from
 * public/games/math-quest/index.html. The game reaches the outside world only through its
 * `MathQuestConfig` (an AI route and a league route), so Aria fills that in and changes nothing else.
 */

export const GAME_FILE = path.join(process.cwd(), "public", "games", "math-quest", "index.html");
export const AI_ROUTE = "/api/games/math-quest/ai";
export const BOARD_ROUTE = "/api/games/math-quest/leaderboard";

export type Player = { id: string; name: string };

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([work, new Promise<null>((r) => setTimeout(() => r(null), ms))]).catch(() => null);
}

/** The signed-in student as the game's player (league id + first name). Null when nobody is signed in. */
export async function currentPlayer(): Promise<Player | null> {
  const me = await withTimeout(currentUser(), 4000);
  if (!me) return null;
  // The name is a nicety: a slow database must never hold up the game, so it falls back to "Player".
  const doc = await withTimeout(users().item(me.userId, me.userId).read<UserDoc>().then((r) => r.resource ?? null), 2500);
  const shown = (doc?.profile as { displayName?: string } | undefined)?.displayName ?? doc?.username ?? "";
  return { id: me.userId, name: shown.trim().split(/\s+/)[0]?.slice(0, 40) || "Player" };
}

// ---------- the weekly league: one small JSON file (local; swap for the database before deploying) ----------
const BOARD_FILE = path.join(process.cwd(), ".canvas-cache", "games", "math-quest-board.json");
export type BoardRow = { name: string; wk: string; wxp: number; xp: number; streak: number; ts: number };

export async function loadBoard(): Promise<Record<string, BoardRow>> {
  try { return JSON.parse(await readFile(BOARD_FILE, "utf8")) as Record<string, BoardRow>; } catch { return {}; }
}
let chain: Promise<unknown> = Promise.resolve();
export function saveBoardRow(id: string, row: BoardRow): Promise<void> {
  const next = chain.then(async () => {
    const board = await loadBoard();
    board[id] = row;
    await mkdir(path.dirname(BOARD_FILE), { recursive: true });
    await writeFile(BOARD_FILE, JSON.stringify(board));
  });
  chain = next.catch(() => {});
  return next;
}

// ---------- a per-player limit on AI calls (the original server allows 12 a minute) ----------
const hits = new Map<string, number[]>();
export function limited(key: string, max = Number(process.env.MQ_AI_PER_MIN) || 12): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
}

/** The original server's reply reader: strip ``` fences, parse, else the first {…} block. */
export function extractJSON(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, "").trim();
  try { return JSON.parse(t); } catch { /* fall through */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("No JSON in model reply");
}

/** The original server's offline replies (MQ_MOCK_AI=1), so the whole game can be tested for free. */
export function mockReply(prompt: string, mode: string): { text: string } | { json: unknown } {
  if (mode === "text") return { text: "Great question! Try breaking it into small steps. What do you notice first?" };
  if (prompt.startsWith("Solve each")) { const n = (prompt.match(/\n\d+\. /g) || []).length; return { json: { answers: Array(n).fill(0) } }; }
  const q = (i: number, d: number) => ({ d, q: `What is ${i} + ${i * 2}?`, type: "num", answer: i * 3, check: `${i}+${i * 2}`, hint: "Add the two numbers.", explain: `${i} + ${i * 2} = ${i * 3}` });
  return { json: { topic: "Practice topic", diagnostic: [1, 2, 3, 4].map((d) => q(d + 1, d)),
    learn: [{ head: "Getting started", body: "This is mock lesson content (MQ_MOCK_AI=1).", steps: ["Step one", "Step two"] }, { head: "Next idea", body: "Another mock card.", steps: [] }],
    revise: [{ head: "Recap", body: "Mock recap." }], questions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => q(i, 1 + (i % 3))) } };
}
