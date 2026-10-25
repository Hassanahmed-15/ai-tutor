// The server-side board renderer (lib/bench/renderSvg.ts) on saved boards — what a vision check would see.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
import { boardPng } from "../../../lib/bench/renderSvg";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const out = process.argv[2];
mkdirSync(out, { recursive: true });
for (const pair of process.argv.slice(3)) {
  const [id, seq] = pair.split(":");
  const b = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT c.beat FROM c WHERE c.sessionId = @id AND c.sequence = @s", parameters: [{ name: "@id", value: id }, { name: "@s", value: Number(seq) }] }).fetchAll()).resources[0] as any;
  const spec = b.beat.draw.ops.find((o: any) => o.kind === "canvasBoard").spec;
  try { writeFileSync(`${out}/${id.slice(0, 6)}-${seq}.png`, boardPng(spec)); console.log("ok", id.slice(0, 6), seq, spec.stage.kind); }
  catch (e) { console.log("FAILED", id.slice(0, 6), seq, spec.stage.kind, (e as Error).message.slice(0, 120)); }
}
