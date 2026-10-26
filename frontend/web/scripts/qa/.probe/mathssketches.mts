// What saved maths prompt lectures' sketch boards draw (free): item kinds, plan visual type, title.
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const { isMathsTopic } = await import("../../../lib/canvas/predictCard");
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const sessions = (await db.container("progressive-lecture-sessions").items.query(`SELECT TOP 400 c.id, c.topic, c.sourceType, c.plan FROM c ORDER BY c._ts DESC`).fetchAll()).resources as any[];
for (const s of sessions.filter((x) => x.sourceType !== "suprnotes" && isMathsTopic(x.topic ?? "")).slice(0, 40)) {
  const beats = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT c.sequence, c.beat FROM c WHERE c.sessionId = @id", parameters: [{ name: "@id", value: s.id }] }).fetchAll()).resources as any[];
  for (const b of beats) {
    const spec = b.beat?.draw?.ops?.find((o: any) => o.kind === "canvasBoard")?.spec;
    if (spec?.stage?.kind !== "sketch") continue;
    const kinds = new Map<string, number>();
    for (const it of spec.stage.items ?? []) kinds.set(it.kind ?? it.type, (kinds.get(it.kind ?? it.type) ?? 0) + 1);
    const plan = s.plan?.[b.sequence];
    console.log(`${s.topic.slice(0, 28).padEnd(28)} | ${String(plan?.visualType ?? "-").padEnd(9)} | ${(spec.heading ?? "").slice(0, 38).padEnd(38)} | ${[...kinds].map(([k, v]) => `${k}${v}`).join(" ")}`);
  }
}
process.exit(0);
