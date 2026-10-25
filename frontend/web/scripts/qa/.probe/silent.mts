// HOW MUCH OF WHAT ARIA SAYS IS WRITTEN? (free, saved lectures) — per sentence: is anything WRITTEN when it is
// said (pointing does not count); spoken numbers/formulas never written; diagram labels never said.
import { readFileSync, writeFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
import { canvasSentences } from "../../../lib/canvas/plan";
import { anchorNotes } from "../../../lib/canvas/narrationSync";
import { normalizeMath, repeatsWorking, tidyNotes, withResultNotes, orderNotesAsSaid } from "../../../lib/canvas/equationCheck";
// FIXED=1: what the fixed writer ships — the planner's notes on every board (lib/canvas/generate.ts writeAsSaid).
const FIXED = process.env.FIXED === "1";
const S = "/private/tmp/claude-501/-Users-hassanahmed-ai-tutor/2735a389-20f1-4b4d-94c6-1e1ea98cc81e/scratchpad";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const decided = JSON.parse(readFileSync(`${S}/decided.json`, "utf8")) as any[];
const sessions = JSON.parse(readFileSync(`${S}/sessions.json`, "utf8")) as any[];
const pick = sessions.map((s, i) => ({ ...s, kind: decided[i].kind })).filter((s) => s.ts > Date.now() / 1000 - 6 * 86400).sort((a, b) => b.ts - a.ts);
const TEXT = ["text", "label", "value", "name", "title", "caption", "answer"];
type Stat = { sentences: number; silent: number; spokenFacts: number; unwrittenFacts: number; labels: number; unsaidLabels: number; boards: number; low: number; cover: number };
const blank = (): Stat => ({ sentences: 0, silent: 0, spokenFacts: 0, unwrittenFacts: 0, labels: 0, unsaidLabels: 0, boards: 0, low: 0, cover: 0 });
const STOP = new Set("which where there their these those about because would could should first second third other every another between through without within before after while being having still also just only than then them they this that with from into have will what when your we're let's lets now here know means called each some many more most such very much like make makes made using used gives give gets same both well even".split(" "));
const keyTerms = (sen: string) => [...new Set((sen.toLowerCase().match(/[a-z][a-z'-]{4,}/g) ?? []).filter((w) => !STOP.has(w)))];
const lowExamples: string[] = [];
const missingFacts: string[] = [];
const byKind = new Map<string, Stat>(), byStage = new Map<string, Stat>();
const examples: string[] = [];
const FACT = /\b\d+(?:\.\d+)?\b|\b(?:[A-Z][a-z]?\d*[₀-₉²³⁺⁻]*){2,}\b|[A-Za-z]\s*=\s*[^,.;]+/g;
const norm = (t: string) => t.toLowerCase().replace(/[₀-₉]/g, (c) => String("₀₁₂₃₄₅₆₇₈₉".indexOf(c))).replace(/\s+/g, "");
let done = 0;
for (const s of pick) {
  const beats = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT c.sequence, c.beat FROM c WHERE c.sessionId = @id", parameters: [{ name: "@id", value: s.id }] }).fetchAll().catch(() => ({ resources: [] }))).resources as any[];
  const planned = FIXED ? (((await db.container("progressive-lecture-sessions").items.query({ query: "SELECT ARRAY(SELECT VALUE p.canvas.boardNotes FROM p IN c.plan) AS notes FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: s.id }] }).fetchAll().catch(() => ({ resources: [] }))).resources[0] as any)?.notes ?? []) : [];
  for (const b of beats) {
    const spec = b.beat?.draw?.ops?.find((o: any) => o.kind === "canvasBoard")?.spec;
    if (!spec || spec.stage?.kind === "exam") continue;
    if (FIXED && spec.stage.kind === "equation" && planned[b.sequence]?.length) {
      const text = new Map(spec.stage.tokens.map((t: any) => [t.id, t.text]));
      const rows = spec.stage.steps.map((st: any) => normalizeMath(st.order.map((id: string) => text.get(id) ?? "").join("")).replace(/÷/g, "/"));
      spec.notes = anchorNotes(planned[b.sequence].map((n: any, k: number) => ({ id: `say-${k + 1}`, text: n.text, s: n.s })), b.beat.script).filter((n: any) => !repeatsWorking(n.text, rows));
    }
    if (FIXED && !["equation", "exam", "code"].includes(spec.stage.kind)) spec.notes = orderNotesAsSaid(tidyNotes(withResultNotes(spec.notes ?? [], b.beat.script ?? "", (text: string, s: number, k: number) => ({ id: `answer-${k + 1}`, text, s }))), b.beat.script ?? "");
    const sentences = canvasSentences(b.beat.script ?? "");
    if (!sentences.length) continue;
    const written = new Map<number, string[]>();
    const allText: string[] = [];
    const labels: string[] = [];
    const add = (sIdx: number, t: string) => { if (!t?.trim()) return; (written.get(sIdx) ?? written.set(sIdx, []).get(sIdx)!).push(t); allText.push(t); };
    const walk = (v: any, key: string, inherited?: number) => {
      if (Array.isArray(v)) return v.forEach((x) => walk(x, key, inherited));
      if (!v || typeof v !== "object") return;
      const at = typeof v.s === "number" ? v.s : inherited;
      for (const k of TEXT) if (typeof v[k] === "string") { add(at ?? 0, v[k]); if ((k === "label" || k === "name") && key !== "notes") labels.push(v[k]); }
      if (Array.isArray(v.order) && spec.stage.kind === "equation") add(at ?? 0, v.order.map((id: string) => spec.stage.tokens?.find((t: any) => t.id === id)?.text ?? "").join(" "));
      if (Array.isArray(v.lines) && typeof v.s === "number" && spec.stage.kind === "code") add(v.s, v.lines.map((n: number) => spec.stage.lines?.[n - 1] ?? "").join(" "));
      for (const [k, x] of Object.entries(v)) if (k !== "cues" && x && typeof x === "object") walk(x, k, at);
    };
    walk(spec.notes, "notes");
    walk(spec.stage, "stage");
    if (spec.stage.kind === "code" && !spec.stage.steps?.length) add(0, (spec.stage.lines ?? []).join(" "));
    const st = byKind.get(s.kind) ?? byKind.set(s.kind, blank()).get(s.kind)!;
    const sg = byStage.get(spec.stage.kind) ?? byStage.set(spec.stage.kind, blank()).get(spec.stage.kind)!;
    const board = norm(allText.join(" "));
    for (const x of [st, sg]) { x.boards++; x.sentences += sentences.length; }
    const upTo = (i: number) => norm([...written.entries()].filter(([k]) => k <= i).flatMap(([, t]) => t).join(" "));
    sentences.forEach((sen, i) => {
      const silent = !written.has(i);
      const terms = keyTerms(sen);
      const shown = upTo(i);
      const covered = terms.length ? terms.filter((w) => shown.includes(w.slice(0, Math.max(5, w.length - 2)))).length / terms.length : 1;
      for (const x of [st, sg]) { x.cover += covered; if (covered < 0.25 && terms.length >= 3) x.low++; }
      if (covered < 0.25 && terms.length >= 3 && lowExamples.length < 600) lowExamples.push(`${s.kind} | ${spec.stage.kind} | ${s.topic.slice(0, 28)} | ${Math.round(covered * 100)}% | "${sen.slice(0, 120)}"`);
      const facts = [...new Set((sen.match(FACT) ?? []).map((f) => f.trim()))].filter((f) => f.length > 1 || /\d/.test(f));
      const missing = facts.filter((f) => !board.includes(norm(f)));
      for (const x of [st, sg]) { if (silent) x.silent++; x.spokenFacts += facts.length; x.unwrittenFacts += missing.length; }
      if (missing.length && missingFacts.length < 500) missingFacts.push(`${spec.stage.kind} | ${missing.join(" · ")} | "${sen.slice(0, 100)}"`);
      if (silent && examples.length < 400) examples.push(`${s.kind} | ${spec.stage.kind} | ${s.topic.slice(0, 30)} | "${sen.slice(0, 110)}"`);
    });
    const said = norm(b.beat.script ?? "");
    for (const l of labels) { const words = l.toLowerCase().match(/[a-z]{4,}/g) ?? []; const unsaid = words.length > 0 && !words.some((w) => said.includes(w.slice(0, 5))); for (const x of [st, sg]) { x.labels++; if (unsaid) x.unsaidLabels++; } }
  }
  if (++done >= 120) break;
}
const pct = (a: number, b: number) => `${b ? Math.round((100 * a) / b) : 0}%`;
const show = (title: string, m: Map<string, Stat>) => { console.log(`\n${title}`); for (const [k, x] of [...m.entries()].sort((a, b) => b[1].sentences - a[1].sentences)) console.log(`  ${k.padEnd(14)} boards ${String(x.boards).padStart(4)}  sentences ${String(x.sentences).padStart(5)}  nothing written ${pct(x.silent, x.sentences).padStart(4)}  spoken numbers/formulas not on board ${pct(x.unwrittenFacts, x.spokenFacts).padStart(4)} (${x.unwrittenFacts}/${x.spokenFacts})  diagram labels never said ${pct(x.unsaidLabels, x.labels)}  key words on board ${Math.round((100 * x.cover) / Math.max(1, x.sentences))}%  sentences mostly unwritten ${pct(x.low, x.sentences)}`); };
show("BY SOURCE", byKind);
show("BY BOARD TYPE", byStage);
writeFileSync(`${S}/silent-examples.txt`, examples.join("\n"));
writeFileSync(`${S}/low-cover-examples.txt`, lowExamples.join("\n"));
writeFileSync(`${S}/missing-facts.txt`, missingFacts.join("\n"));
console.log(`\n${done} lectures from the last 6 days`);
