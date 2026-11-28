import { readFile } from "node:fs/promises";
import { AI_ROUTE, BOARD_ROUTE, currentPlayer, GAME_FILE } from "@/lib/games/mathQuest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * THE GAME ITSELF: public/games/math-quest/index.html exactly as the owner made it, with one script put in front
 * of it that sets `window.MathQuestConfig` (the game's own documented hook, README "Option B") to Aria's AI and
 * league routes and the signed-in student. The game's default config only applies when none is set, so this is
 * the whole integration: not one line of the game is edited.
 */
export async function GET() {
  const html = await readFile(GAME_FILE, "utf8");
  const player = await currentPlayer();
  const config = { aiEndpoint: AI_ROUTE, leaderboardEndpoint: BOARD_ROUTE, ...(player ? { player } : {}) };
  // JSON in a <script>: escape "<" so a name can never close the tag.
  const inject = `<script>window.MathQuestConfig=${JSON.stringify(config).replace(/</g, "\\u003c")};</script>`;
  const out = html.replace(/<head>/i, (h) => `${h}\n${inject}`);
  return new Response(out, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
