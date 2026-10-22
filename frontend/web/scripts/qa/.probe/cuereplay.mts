// Free: re-run the pen-cue repair on a saved lecture's boards and print what changes.
import { readFileSync } from "node:fs";
import { repairCues } from "@/lib/canvas/cueRepair";
import { layoutPanel } from "@/lib/canvas/layout";
import { canvasSentences } from "@/lib/canvas/plan";
const beats = JSON.parse(readFileSync(process.argv[2], "utf8")).sort((a: any, b: any) => a.sequence - b.sequence);
let before = 0, after = 0;
for (const row of beats) {
  const b = row.beat; if (!b) continue;
  const op = b.draw?.ops?.find((o: any) => o.kind === "canvasBoard"); if (!op) continue;
  const spec = op.spec;
  const shipped = layoutPanel(spec);
  const onBoard = new Set([...Object.keys(shipped.targets), ...shipped.marks.flatMap((m: any) => (m.type === "graph" ? (m.spec.markers ?? []).map((k: any) => k.id) : []))]);
  const out = repairCues(spec, b, onBoard);
  const s = canvasSentences(b.script);
  const key = (c: any) => `s${c.s} ${c.action} ${c.target}`;
  const was = spec.cues.map(key), now = out.cues.map(key);
  before += spec.cues.length; after += out.cues.length;
  if (was.join() === now.join()) continue;
  console.log(`\n${row.sequence + 1}. ${b.title}`);
  for (const k of was) if (!now.includes(k)) console.log(`  - ${k}   (${(s[Number(k.slice(1, k.indexOf(" ")))] ?? "").slice(0, 90)})`);
  for (const k of now) if (!was.includes(k)) console.log(`  + ${k}`);
}
console.log(`\ncues ${before} → ${after}`);
