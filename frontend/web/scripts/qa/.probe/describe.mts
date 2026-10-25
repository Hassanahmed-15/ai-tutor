import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
import * as D from "../../../lib/canvas/describe";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
for (const pair of process.argv.slice(2)) {
  const [id, seq] = pair.split(":");
  const b = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT c.beat FROM c WHERE c.sessionId = @id AND c.sequence = @s", parameters: [{ name: "@id", value: id }, { name: "@s", value: Number(seq) }] }).fetchAll()).resources[0] as any;
  const spec = b.beat.draw.ops.find((o: any) => o.kind === "canvasBoard").spec;
  const fn = D.describeCanvasSpec;
  console.log(`\n===== ${b.beat.title} (${spec.stage.kind})\n` + String(fn(spec)).slice(0, 1400));
}
