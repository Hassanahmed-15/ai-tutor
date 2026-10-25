import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const rows = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT TOP 40 c.topic, c.sourceType, c.costUsd, ARRAY_LENGTH(c.plan) AS boards, c.status, c._ts FROM c WHERE c.sourceType = 'suprnotes' AND IS_DEFINED(c.costUsd) ORDER BY c._ts DESC" }).fetchAll()).resources as any[];
for (const r of rows) console.log(new Date(r._ts * 1000).toISOString().slice(0, 10), String(r.status).padEnd(9), `$${Number(r.costUsd ?? 0).toFixed(3)}`, `${r.boards} boards`, r.topic?.slice(0, 50));
