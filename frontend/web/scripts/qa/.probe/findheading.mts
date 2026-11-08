// Saved boards with a given heading (free): session, board, owner, when.
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const beats = (await db.container("progressive-lecture-beats").items.query("SELECT TOP 300 c.sessionId, c.userId, c.sequence, c.beat, c._ts FROM c ORDER BY c._ts DESC").fetchAll()).resources as any[];
for (const b of beats) {
  const spec = b.beat?.draw?.ops?.find((o: any) => o.kind === "canvasBoard")?.spec;
  if (!spec?.heading?.toLowerCase().includes(process.argv[2].toLowerCase())) continue;
  const st = spec.stage; const pic = st?.kind === "illustration" ? st : st?.picture;
  console.log(`${b.sessionId} b${b.sequence + 1} user=${String(b.userId).slice(0, 12)} ${new Date(b._ts * 1000).toISOString()} ${st?.kind} src=${pic?.src ?? "-"} onBoard=${pic?.onBoard ?? false}`);
}
process.exit(0);
