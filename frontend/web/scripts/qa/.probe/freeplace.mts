// How many sketch boards place their items freely (every item has "at")? (free)
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const since = Math.floor(Date.now() / 1000) - 6 * 86400;
const rows = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT c.sessionId, c.sequence, c.beat.title AS title, ARRAY(SELECT VALUE o.spec.stage FROM o IN c.beat.draw.ops WHERE o.kind = 'canvasBoard') AS stages FROM c WHERE c._ts > @t", parameters: [{ name: "@t", value: since }] }).fetchAll()).resources as any[];
let sketch = 0, free = 0;
const ex: string[] = [];
for (const r of rows) {
  const st = r.stages?.[0];
  if (st?.kind !== "sketch") continue;
  sketch++;
  if (st.items?.length && st.items.every((i: any) => i.at)) { free++; if (ex.length < 8) ex.push(`${r.title} (${st.items.length} items: ${st.items.map((i: any) => i.type).join(",")})`); }
}
console.log(`sketch boards ${sketch}, placed freely ${free}`);
for (const e of ex) console.log("  ", e);
