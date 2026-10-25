// The board photo the eyes will see (lib/canvas/boardLook.ts boardPhoto), for saved boards — free.
//   NODE_OPTIONS=--conditions=react-server npx tsx --tsconfig tsconfig.json scripts/qa/.probe/lookshot.mts <outDir> <session:seq>...
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
import { boardPhoto } from "../../../lib/canvas/boardLook";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
for (const [k, v] of Object.entries(env)) process.env[k] ??= v as string;
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const out = process.argv[2];
mkdirSync(out, { recursive: true });
for (const pair of process.argv.slice(3)) {
  const [id, seq] = pair.split(":");
  const r = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT c.beat, c.userId FROM c WHERE c.sessionId = @id AND c.sequence = @s", parameters: [{ name: "@id", value: id }, { name: "@s", value: Number(seq) }] }).fetchAll()).resources[0] as any;
  const spec = r.beat.draw.ops.find((o: any) => o.kind === "canvasBoard").spec;
  const t = Date.now();
  const png = await boardPhoto(spec, { userId: r.userId, topic: r.beat.title });
  if (png) { writeFileSync(`${out}/${id.slice(0, 6)}-${seq}.png`, png); console.log("photo", id.slice(0, 6), seq, spec.stage.kind, `${Date.now() - t} ms`, `${Math.round(png.length / 1024)} KB`); }
  else console.log("NO PHOTO", id.slice(0, 6), seq);
}
process.exit(0);
