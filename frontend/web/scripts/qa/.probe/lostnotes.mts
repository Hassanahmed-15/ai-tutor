// Notes on recent saved course boards that are never drawn (wiped on the sentence they are written), free.
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const { layoutPanel } = await import("../../../lib/canvas/layout");
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const beats = (await db.container("progressive-lecture-beats").items.query("SELECT TOP 600 c.sessionId, c.sequence, c.beat FROM c ORDER BY c._ts DESC").fetchAll()).resources as any[];
let boards = 0, notes = 0, lost = 0, hit = 0;
for (const b of beats) {
  const spec = b.beat?.draw?.ops?.find((o: any) => o.kind === "canvasBoard")?.spec;
  if (!spec?.subject) continue;
  boards++;
  const marks = layoutPanel(spec).marks.filter((m: any) => m.type === "note") as any[];
  notes += marks.length;
  const gone = marks.filter((m) => m.until !== undefined && m.until <= m.s);
  lost += gone.length; if (gone.length) { hit++; console.log(`${b.sessionId} ${b.sequence + 1} "${spec.heading}": ${gone.map((m) => `"${m.lines.join(" ")}"`).join(", ")}`); }
}
console.log(`${boards} course boards, ${notes} notes: ${lost} never drawn on ${hit} boards`);
process.exit(0);
