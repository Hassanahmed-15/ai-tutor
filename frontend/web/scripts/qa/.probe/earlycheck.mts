// Free: what is on a board before Aria has said it — code lines, notes, variables — under the old and new reveal rules.
import { readFileSync } from "node:fs";
import { canvasSentences } from "@/lib/canvas/plan";
import { revealNotesWhenSaid } from "@/lib/canvas/equationCheck";
const files = process.argv.slice(2);
let tot = { lines: 0, earlyOld: 0, earlyNew: 0, notes: 0, notesEarly: 0, notesEarlyNew: 0, vars: 0, varsEarlyOld: 0 };
for (const f of files) {
  const beats = JSON.parse(readFileSync(f, "utf8")).sort((a: any, b: any) => a.sequence - b.sequence);
  for (const row of beats) {
    const b = row.beat; if (!b) continue;
    const spec = b.draw?.ops?.find((o: any) => o.kind === "canvasBoard")?.spec; if (!spec) continue;
    const said = canvasSentences(b.script);
    const st = spec.stage;
    if (st.kind === "code") {
      // When each line is first explained: the first sentence whose step lights it alone or with one neighbour, else lights it.
      const explained = (n: number) => Math.min(...st.steps.filter((p: any) => p.lines.includes(n)).map((p: any) => p.s), Infinity);
      const steps = [...st.steps].sort((a: any, b: any) => a.s - b.s);
      const shownAt = (n: number, rule: "old" | "new") => {
        if (st.reveal === "all" && rule === "old") return -1;
        if (rule === "old") { const first = steps[0]?.s ?? 0; if (first > 0) return -1; } // old: whole listing before the first step
        let max = 0;
        for (let k = 0; k < steps.length; k++) { max = Math.max(max, ...steps[k].lines); if (rule === "old" && k === steps.length - 1) return steps[k].s; if (max >= n) return steps[k].s; }
        return Infinity;
      };
      st.lines.forEach((l: string, i: number) => {
        if (!l.trim()) return;
        const n = i + 1, ex = explained(n);
        tot.lines++;
        if (shownAt(n, "old") < ex) tot.earlyOld++;
        if (shownAt(n, "new") < ex) tot.earlyNew++;
      });
      const names = new Map<string, number>();
      for (const p of steps) for (const v of p.state ?? []) if (!names.has(v.name)) names.set(v.name, p.s);
      const firstStateS = Math.min(...steps.filter((p: any) => p.state?.length).map((p: any) => p.s), Infinity);
      for (const [name, s] of names) { tot.vars++; if (firstStateS < s) tot.varsEarlyOld++; }
    }
    for (const n of spec.notes ?? []) {
      tot.notes++;
      const flat = (t: string) => t.toLowerCase();
      const first = said.findIndex((x: string) => { const w = (n.text.toLowerCase().match(/[a-z]{4,}/g) ?? []); return w.length >= 2 && w.filter((y: string) => flat(x).includes(y)).length >= Math.ceil(w.length * 0.6); });
      if (first > n.s) tot.notesEarly++;
    }
    const moved = revealNotesWhenSaid(spec.notes ?? [], b.script);
    moved.forEach((m: any, k: number) => {
      const first = said.findIndex((x: string) => { const w = (m.text.toLowerCase().match(/[a-z]{4,}/g) ?? []); return w.length >= 2 && w.filter((y: string) => x.toLowerCase().includes(y)).length >= Math.ceil(w.length * 0.6); });
      if (first > m.s) tot.notesEarlyNew++;
    });
  }
}
console.log(`code lines visible before explained: old ${tot.earlyOld}/${tot.lines}, new rule ${tot.earlyNew}/${tot.lines}`);
console.log(`notes up before said: ${tot.notesEarly}/${tot.notes} → after re-timing ${tot.notesEarlyNew}/${tot.notes}`);
console.log(`variable boxes drawn before the variable exists (old panel): ${tot.varsEarlyOld}/${tot.vars} → new panel 0`);
