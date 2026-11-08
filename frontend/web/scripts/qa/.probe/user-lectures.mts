// READ-ONLY: a user's most recent lectures (topic, kind, how far they played), found by part of their email or name.
//   node --conditions=react-server --import tsx scripts/qa/.probe/user-lectures.mts <email-or-name-part> [count]
import { users, progressiveLectureSessions } from "../../../lib/db/cosmos";
const [needle, count = "15"] = process.argv.slice(2);
const { resources: found } = await users().items.query({ query: "SELECT c.id, c.email, c.name, c.createdAt FROM c WHERE CONTAINS(LOWER(c.email), @n) OR CONTAINS(LOWER(c.name), @n)", parameters: [{ name: "@n", value: needle.toLowerCase() }] }).fetchAll();
console.log("accounts:", found.map((u) => `${u.email} (${u.name ?? "-"}) ${u.id.slice(0, 8)}…`));
for (const u of found) {
  const { resources } = await progressiveLectureSessions().items.query({ query: `SELECT TOP ${Number(count)} c.id, c.topic, c.sourceType, c.mode, c.status, c.playhead, ARRAY_LENGTH(c.plan) AS boards, c.createdAt, c.updatedAt FROM c WHERE c.userId = @u ORDER BY c.createdAt DESC`, parameters: [{ name: "@u", value: u.id }] }, { partitionKey: u.id }).fetchAll();
  console.log(`\n${u.email}: ${resources.length} most recent`);
  for (const s of resources) console.log(`${s.createdAt.slice(0, 16).replace("T", " ")}  ${String(s.sourceType ?? "").padEnd(9)} ${String(s.status).padEnd(10)} played ${s.playhead ?? 0}/${s.boards ?? "?"}  ${String(s.topic).slice(0, 90)}  [${s.id.slice(0, 8)}]`);
}
