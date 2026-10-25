// Recent saved course boards that carry a course picture (free): session, board, subject, part count.
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const beats = (await db.container("progressive-lecture-beats").items.query("SELECT TOP 400 c.sessionId, c.sequence, c.beat, c._ts FROM c ORDER BY c._ts DESC").fetchAll()).resources as any[];
const seen = new Set<string>();
for (const b of beats) {
  const spec = b.beat?.draw?.ops?.find((o: any) => o.kind === "canvasBoard")?.spec;
  const pic = spec?.stage?.kind === "illustration" ? spec.stage : spec?.stage?.picture;
  if (!spec?.subject || !pic?.coursePicture) continue;
  const key = `${b.sessionId}:${b.sequence}`;
  if (seen.has(key)) continue; seen.add(key);
  console.log(`${b.sessionId} ${b.sequence + 1} ${spec.subject} ${spec.stage.kind} parts=${pic.parts?.length ?? 0} "${spec.heading}" ${new Date(b._ts * 1000).toISOString().slice(0, 10)}`);
}
process.exit(0);
