// Where do the "board" notes go? planned per sentence → shipped notes on the board (free).
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
import { canvasSentences } from "../../../lib/canvas/plan";
const S = "/private/tmp/claude-501/-Users-hassanahmed-ai-tutor/2735a389-20f1-4b4d-94c6-1e1ea98cc81e/scratchpad";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const since = Math.floor(Date.now() / 1000) - 6 * 86400;
const sessions = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.id, ARRAY(SELECT VALUE ARRAY_LENGTH(p.canvas.boardNotes) FROM p IN c.plan) AS planned FROM c WHERE c.boardEngine = 'canvas' AND c._ts > @t", parameters: [{ name: "@t", value: since }] }).fetchAll()).resources as any[];
const by = new Map<string, { boards: number; sentences: number; planned: number; shipped: number; shippedNotesCol: number }>();
for (const s of sessions.slice(0, 120)) {
  const beats = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT c.sequence, c.beat FROM c WHERE c.sessionId = @id", parameters: [{ name: "@id", value: s.id }] }).fetchAll().catch(() => ({ resources: [] }))).resources as any[];
  for (const b of beats) {
    const spec = b.beat?.draw?.ops?.find((o: any) => o.kind === "canvasBoard")?.spec;
    if (!spec || spec.stage?.kind === "exam") continue;
    const k = spec.stage.kind;
    const r = by.get(k) ?? by.set(k, { boards: 0, sentences: 0, planned: 0, shipped: 0, shippedNotesCol: 0 }).get(k)!;
    r.boards++;
    r.sentences += canvasSentences(b.beat.script ?? "").length;
    r.planned += Number(s.planned?.[b.sequence] ?? 0);
    r.shipped += (spec.notes ?? []).length;
  }
}
console.log("board type     boards  sentences  notes planned  notes on the board");
for (const [k, r] of [...by.entries()].sort((a, b) => b[1].sentences - a[1].sentences)) console.log(`${k.padEnd(14)} ${String(r.boards).padStart(6)} ${String(r.sentences).padStart(10)} ${`${r.planned} (${Math.round((100 * r.planned) / r.sentences)}%)`.padStart(14)} ${`${r.shipped} (${Math.round((100 * r.shipped) / r.sentences)}%)`.padStart(18)}`);
