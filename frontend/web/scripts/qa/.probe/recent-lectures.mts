// READ-ONLY: the newest lecture sessions across all accounts (who, when, topic, kind), to find a tester's runs.
//   node --env-file=.env.local --conditions=react-server --import tsx scripts/qa/.probe/recent-lectures.mts [hours]
import { progressiveLectureSessions, users } from "../../../lib/db/cosmos";
const hours = Number(process.argv[2] ?? 6);
const since = new Date(Date.now() - hours * 3600_000).toISOString();
const { resources } = await progressiveLectureSessions().items.query({ query: "SELECT c.id, c.userId, c.topic, c.sourceType, c.status, c.createdAt, ARRAY_LENGTH(c.plan) AS boards FROM c WHERE c.createdAt >= @s ORDER BY c.createdAt DESC", parameters: [{ name: "@s", value: since }] }).fetchAll();
const ids = [...new Set(resources.map((r) => r.userId))];
const who = new Map<string, string>();
for (const id of ids) { const { resources: u } = await users().items.query({ query: "SELECT c.email FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: id }] }).fetchAll(); who.set(id, u[0]?.email ?? id.slice(0, 12)); }
for (const s of resources) console.log(`${s.createdAt.slice(11, 16)}  ${String(who.get(s.userId)).padEnd(34)} ${String(s.sourceType).padEnd(9)} ${String(s.status).padEnd(10)} ${s.boards ?? "?"} boards  ${String(s.topic).slice(0, 70)}  [${s.id}]`);
