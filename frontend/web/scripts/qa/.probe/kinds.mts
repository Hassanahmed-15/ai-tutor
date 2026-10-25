import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
for (const id of process.argv.slice(2)) {
  const saved = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT c.sequence, c.beat FROM c WHERE c.sessionId = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources as any[];
  console.log(id.slice(0, 8), saved.sort((a, b) => a.sequence - b.sequence).map((b) => { const st = b.beat?.draw?.ops?.find((o: any) => o.kind === "canvasBoard")?.spec?.stage; return `${b.sequence + 1}:${st?.kind}${st?.coursePicture ? "*" : ""}`; }).join(" "));
}
process.exit(0);
