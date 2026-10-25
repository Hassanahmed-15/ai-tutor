import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const uid = process.argv[2];
const rows = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.id, c.topic, c.sourceType, c.boardEngine, c.playhead, ARRAY_LENGTH(c.plan) AS boards, ARRAY(SELECT VALUE p.canvas.stage FROM p IN c.plan) AS stages, c._ts FROM c WHERE c.userId = @u ORDER BY c._ts DESC", parameters: [{ name: "@u", value: uid }] }).fetchAll()).resources as any[];
for (const r of rows) console.log(`${new Date(r._ts * 1000).toISOString().slice(0, 16)} ${String(r.sourceType).padEnd(9)} ${r.boardEngine ?? "-"} boards=${r.boards} watched=${r.playhead + 1} | ${r.topic} | ${r.id} | ${(r.stages ?? []).join(",")}`);
