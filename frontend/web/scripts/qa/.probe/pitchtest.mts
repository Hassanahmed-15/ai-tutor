// The course easy-words rewrite on a saved lesson's scripts (paid: one small call): grade, words a sentence, before and after.
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
for (const [k, v] of Object.entries(env)) process.env[k] ??= v as string;
const { pitchScripts } = await import("../../../lib/canvas/progressive");
const { client, canvasSentences } = await import("../../../lib/canvas/generate");
const { readingGrade } = await import("../../../lib/studentCard");
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const s = (await db.container("progressive-lecture-sessions").items.query({ query: "SELECT c.topic, c.plan FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: process.argv[2] }] }).fetchAll()).resources[0] as any;
const beats = s.plan.map((p: any) => ({ ...p.canvas })).filter((b: any) => b.stage !== "exam");
const before = beats.map((b: any) => b.script);
const wps = (t: string) => (t.split(/\s+/).length / canvasSentences(t).length).toFixed(1);
const out = await pitchScripts(client(), beats, 7);
beats.forEach((b: any, i: number) => {
  console.log(`\n${b.id} "${b.title}": grade ${readingGrade(before[i])} → ${readingGrade(b.script)}, words/sentence ${wps(before[i])} → ${wps(b.script)}`);
  console.log(`  BEFORE: ${canvasSentences(before[i]).slice(0, 3).join(" ")}`);
  console.log(`  AFTER:  ${canvasSentences(b.script).slice(0, 3).join(" ")}`);
});
console.log(`\n$${out.costUsd.toFixed(4)}`);
process.exit(0);
