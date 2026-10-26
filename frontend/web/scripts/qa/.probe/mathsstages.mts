// What saved maths lectures from typed prompts and PDFs showed on their boards (free).
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const { isMathsTopic } = await import("../../../lib/canvas/predictCard");
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const sessions = (await db.container("progressive-lecture-sessions").items.query(`SELECT TOP 400 c.id, c.topic, c.sourceType, c._ts FROM c ORDER BY c._ts DESC`).fetchAll()).resources as any[];
const maths = sessions.filter((s) => s.sourceType !== "suprnotes" && isMathsTopic(s.topic ?? ""));
const count = new Map<string, number>();
let boards = 0;
const bySource = new Map<string, number>();
for (const s of maths.slice(0, 40)) {
  bySource.set(s.sourceType ?? "?", (bySource.get(s.sourceType ?? "?") ?? 0) + 1);
  const beats = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT c.beat FROM c WHERE c.sessionId = @id", parameters: [{ name: "@id", value: s.id }] }).fetchAll()).resources as any[];
  for (const b of beats) {
    const spec = b.beat?.draw?.ops?.find((o: any) => o.kind === "canvasBoard")?.spec;
    if (!spec) continue;
    boards++;
    const st = spec.stage;
    const k = st.kind === "figure" ? `figure:${st.component}` : st.kind === "equation" && (st.figure || st.picture) ? `equation+figure:${st.figure?.component ?? "picture"}` : st.kind;
    count.set(k, (count.get(k) ?? 0) + 1);
  }
}
console.log(`${Math.min(40, maths.length)} maths lectures (${[...bySource].map(([k, v]) => `${k} ${v}`).join(", ")}), ${boards} boards:`);
for (const [k, v] of [...count].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
process.exit(0);
