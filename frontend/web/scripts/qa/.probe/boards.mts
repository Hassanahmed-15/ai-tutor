import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const id = process.argv[2];
const beats = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT c.sequence, c.beat, c.fallbackUsed FROM c WHERE c.sessionId = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources.sort((a: any, b: any) => a.sequence - b.sequence) as any[];
for (const b of beats) {
  const op = b.beat?.draw?.ops?.find((o: any) => o.kind === "canvasBoard");
  const spec = op?.spec;
  const sentences = (b.beat?.script ?? "").split(/(?<=[.!?])\s+/).filter(Boolean);
  console.log(`\n=== ${b.sequence}. ${b.beat?.title} | stage=${spec?.stage?.kind}${spec?.stage?.component ? "/" + spec.stage.component : ""} | fallback=${b.fallbackUsed} | ${sentences.length} sentences`);
  console.log("SCRIPT:", (b.beat?.script ?? "").slice(0, 900));
  console.log("HEADING:", spec?.heading);
  console.log("NOTES:", JSON.stringify((spec?.notes ?? []).map((n: any) => `${n.s}:${n.text}`)));
  const st = spec?.stage ?? {};
  if (st.kind === "equation") console.log("ROWS:", st.steps?.length, "tokens", st.tokens?.length);
  if (st.kind === "figure") console.log("FIGURE:", JSON.stringify(st).slice(0, 300));
}
