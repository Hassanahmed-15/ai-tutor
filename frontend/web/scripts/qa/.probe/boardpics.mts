// A saved lecture's boards and the picture each one points to (free): is that picture actually stored?
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
for (const [k, v] of Object.entries(env)) process.env[k] ??= v as string;
const { loadCanvasImage } = await import("../../../lib/canvas/store");
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.id, c.userId, c.topic FROM c WHERE STARTSWITH(c.id, @id)", parameters: [{ name: "@id", value: process.argv[2] }] }).fetchAll()).resources[0] as any;
const beats = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT c.sequence, c.beat FROM c WHERE c.sessionId = @id", parameters: [{ name: "@id", value: s.id }] }).fetchAll()).resources as any[];
console.log(s.id, s.userId, s.topic);
for (const b of beats.sort((x, y) => x.sequence - y.sequence)) {
  const spec = b.beat?.draw?.ops?.find((o: any) => o.kind === "canvasBoard")?.spec;
  const st = spec?.stage; const pic = st?.kind === "illustration" ? st : st?.picture;
  const src = pic?.src as string | undefined;
  const name = src?.split("/image/")[1];
  const stored = name ? Boolean(await loadCanvasImage(s.userId, name)) : null;
  console.log(`  b${b.sequence + 1} ${st?.kind}${pic ? (pic.onBoard ? " +maths picture" : " +picture") : ""} "${spec?.heading}" ${src ? `src=${src.slice(-46)} stored=${stored}` : ""}`);
}
process.exit(0);
