// Every stored canvas lecture with what the subject logic decides for it today (free, read-only).
import { readFileSync, writeFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const rows = (await db.container("progressive-lecture-sessions").items.query("SELECT c.id, c.userId, c.topic, c.sourceType, c.boardEngine, c.plan, c._ts FROM c WHERE c.boardEngine = 'canvas'").fetchAll()).resources as any[];
const out = rows.map((r) => ({ id: r.id, user: r.userId, topic: r.topic, sourceType: r.sourceType, ts: r._ts, plan: (r.plan ?? []).map((p: any) => p.canvas).filter(Boolean).map((b: any) => ({ title: b.title, brief: b.brief, stage: b.stage, subject: b.subject })) }));
writeFileSync("/private/tmp/claude-501/-Users-hassanahmed-ai-tutor/2735a389-20f1-4b4d-94c6-1e1ea98cc81e/scratchpad/sessions.json", JSON.stringify(out));
const by = new Map<string, number>(); for (const r of out) by.set(r.sourceType, (by.get(r.sourceType) ?? 0) + 1);
console.log(out.length, "canvas lectures;", [...by.entries()].map(([k, v]) => `${k} ${v}`).join(", "), "| distinct topics:", new Set(out.map((r) => r.topic.trim().toLowerCase())).size);
