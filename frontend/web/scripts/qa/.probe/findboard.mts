import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const beats = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT TOP 5 c.sessionId, c.sequence, c._ts FROM c WHERE c.beat.title = @t ORDER BY c._ts DESC", parameters: [{ name: "@t", value: process.argv[2] }] }).fetchAll()).resources as any[];
for (const b of beats) {
  const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.topic, c.userId, c.sourceType, c.status FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: b.sessionId }] }).fetchAll()).resources[0] as any;
  console.log(new Date(b._ts * 1000).toISOString().slice(0, 16), b.sessionId.slice(0, 8), "board", b.sequence + 1, "|", s?.topic, "|", s?.sourceType, "| user", String(s?.userId).slice(0, 8));
}
