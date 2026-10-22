// One real split call on the squeezed sentences of saved lectures (~$0.003): does the prompt keep values and split well?
import { readFileSync } from "node:fs";
import { client, jsonCall, PLAN_MODEL } from "@/lib/canvas/generate";
import { applySplits, SQUEEZE_PROMPT, squeezedInPlan } from "@/lib/canvas/squeeze";
const files = process.argv.slice(2);
const beats = files.flatMap((f, k) => JSON.parse(readFileSync(f, "utf8")).filter((r: any) => r.beat).map((r: any) => ({ id: `L${k}-${r.sequence}`, title: r.beat.title, script: r.beat.script, stage: "code", brief: "", objects: [], inside: null, carry: [], interaction: null, overview: false })));
const squeezed = squeezedInPlan(beats as any);
console.log(`squeezed: ${squeezed.length}`);
const { json, costUsd } = await jsonCall(client(), PLAN_MODEL, SQUEEZE_PROMPT, squeezed.map((x, i) => `[${i}] ${x.text}`).join("\n"), 3000);
const raw = ((json as any).splits ?? []) as Array<{ id: unknown; sentences: string[] }>;
const splits = raw.flatMap((r) => { const at = squeezed[Number(r.id)]; return at && Array.isArray(r.sentences) ? [{ beat: at.beat, sentence: at.sentence, sentences: r.sentences.map(String) }] : []; });
const before = new Map((beats as any[]).map((b) => [b.id, b.script]));
const n = applySplits(beats as any, splits);
console.log(`applied ${n} of ${squeezed.length}, $${costUsd.toFixed(4)}`);
for (const s of squeezed) {
  const r = raw.find((x) => squeezed[Number(x.id)] === s);
  console.log(`\n- ${s.text}\n  → ${(r?.sentences ?? []).join(" | ")}`);
}
