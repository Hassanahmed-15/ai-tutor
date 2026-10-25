// Which planned notes did equation boards drop? (free)
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
let shown = 0;
for (const id of process.argv.slice(2)) {
  const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT ARRAY(SELECT VALUE p.canvas.boardNotes FROM p IN c.plan) AS notes FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources[0] as any;
  const beats = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT c.sequence, c.beat FROM c WHERE c.sessionId = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources as any[];
  for (const b of beats.sort((x, y) => x.sequence - y.sequence)) {
    const spec = b.beat?.draw?.ops?.find((o: any) => o.kind === "canvasBoard")?.spec;
    if (spec?.stage?.kind !== "equation") continue;
    const planned = (s.notes?.[b.sequence] ?? []) as Array<{ s: number; text: string }>;
    const kept = new Set((spec.notes ?? []).map((n: any) => n.text));
    const rows = (spec.stage.steps ?? []).map((st: any) => st.order.map((tid: string) => spec.stage.tokens.find((t: any) => t.id === tid)?.text ?? "").join(""));
    console.log(`\n${b.beat.title}: planned ${planned.length}, kept ${kept.size}, rows ${rows.length}`);
    for (const n of planned) console.log(`   ${kept.has(n.text) ? "kept   " : "DROPPED"} s${n.s}: ${n.text}`);
    if (++shown > 6) process.exit(0);
  }
}
