// Saved maths prompt lectures' sketch boards: their subject stamp and chooser verdict (free).
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const sessions = (await db.container("progressive-lecture-sessions").items.query(`SELECT TOP 300 c.id, c.topic, c.plan FROM c WHERE c.sourceType = "prompt" ORDER BY c._ts DESC`).fetchAll()).resources as any[];
const seen = new Map<string, number>();
for (const s of sessions) for (const raw of s.plan ?? []) {
  const b = raw.canvas ?? raw;
  if (b.stage !== "sketch") continue;
  const k = `subject=${b.subject ?? "-"} visualType=${b.visualType ?? "-"}`; if (["thing", "diagram"].includes(b.visualType)) console.log(s.id.slice(0, 8), s.topic.slice(0, 40), b.id, b.title.slice(0, 40));
  seen.set(k, (seen.get(k) ?? 0) + 1);
}
console.log([...seen].map(([k, v]) => `${v}  ${k}`).join("\n"));
console.log("plan item keys:", Object.keys(sessions.find((s) => s.plan?.length)?.plan[0] ?? {}).join(","), "| canvas keys:", Object.keys(sessions.find((s) => s.plan?.length)?.plan[0]?.canvas ?? {}).join(","));
process.exit(0);
