import { readFileSync } from "node:fs";
import { fixLineReferences } from "@/lib/canvas/codeSync";
import { canvasSentences } from "@/lib/canvas/plan";
const [file] = process.argv.slice(2);
const beats = JSON.parse(readFileSync(file, "utf8")).sort((a: any, b: any) => a.sequence - b.sequence);
for (const row of beats) {
  const b = row.beat; if (!b) continue;
  const spec = b.draw?.ops?.find((o: any) => o.kind === "canvasBoard")?.spec; if (spec?.stage?.kind !== "code") continue;
  const before = canvasSentences(b.script);
  const r = fixLineReferences(spec, b.script);
  if (!r.fixed) { console.log(`${b.title}: no change`); continue; }
  const after = canvasSentences(r.script);
  after.forEach((s, i) => { if (s !== before[i]) console.log(`${b.title} s${i}:\n  was: ${before[i]}\n  now: ${s}\n  lights: ${spec.stage.steps.filter((p: any) => p.s === i).map((p: any) => p.lines.join(",")).join(" ; ")}`); });
}
