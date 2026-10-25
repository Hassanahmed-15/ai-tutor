import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database(env.COSMOS_DATABASE?.trim() || "aria-shared");
const since = Math.floor(Date.now() / 1000) - 48 * 3600;
const rows = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.id, c.userId, c.topic, c.sourceType, c.boardEngine, c.status, c.playhead, ARRAY_LENGTH(c.plan) AS boards, c.createdAt, c._ts FROM c WHERE c._ts > @since", parameters: [{ name: "@since", value: since }] }).fetchAll()).resources as any[];
const ids = [...new Set(rows.map((r) => r.userId))];
const users = (await db.container("users").items.query({ query: `SELECT c.id, c.username, c.email FROM c WHERE ARRAY_CONTAINS(${JSON.stringify(ids)}, c.id)` }).fetchAll()).resources as any[];
const nm = new Map(users.map((u) => [u.id, u.username ?? u.email]));
for (const r of rows.filter((r) => nm.get(r.userId) !== "local-dev-canvas").sort((a, b) => a._ts - b._ts))
  console.log(`${new Date(r._ts * 1000).toISOString().slice(5, 16)} ${String(nm.get(r.userId)).padEnd(12)} ${String(r.sourceType).padEnd(10)} ${r.boardEngine ?? "-"} boards=${r.boards} played=${r.playhead} ${r.status} | ${String(r.topic).slice(0, 60)} | ${r.id}`);
