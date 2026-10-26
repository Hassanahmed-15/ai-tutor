// One saved lecture's boards (free): number, plan stage, shipped stage, title.
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.id, c.topic, c.plan FROM c WHERE STARTSWITH(c.id, @id)", parameters: [{ name: "@id", value: process.argv[2] }] }).fetchAll()).resources[0] as any;
const beats = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT c.sequence, c.beat FROM c WHERE c.sessionId = @id", parameters: [{ name: "@id", value: s.id }] }).fetchAll()).resources as any[];
console.log(s.id, s.topic);
for (const p of s.plan) {
  const b = p.canvas ?? p;
  const shipped = beats.find((x) => x.sequence === s.plan.indexOf(p))?.beat?.draw?.ops?.find((o: any) => o.kind === "canvasBoard")?.spec;
  const st = shipped?.stage;
  console.log(`  b${s.plan.indexOf(p) + 1} plan=${b.stage}${b.figure ? `:${b.figure}` : ""} shipped=${st?.kind ?? "-"}${st?.component ? `:${st.component}` : st?.figure ? `+${st.figure.component}` : ""} "${b.title}"`);
}
process.exit(0);
