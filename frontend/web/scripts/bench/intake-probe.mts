/**
 * INTAKE PROBE: the real intake call for a list of topics (and PDFs), printed for review, with the
 * easy-to-spot faults flagged: a check that asks "why", a scenario or a calculation; one too long;
 * options too long; a part label that is a sentence. Never answers anything: it shows what students see.
 *   NODE_OPTIONS=--conditions=react-server npx tsx --env-file=.env.local --tsconfig tsconfig.json scripts/bench/intake-probe.mts <cases.json> <out.json>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { signAccessToken } from "../../lib/auth.ts";
import { runIntake } from "./intakeSim.mts";

const [casesFile, outFile] = process.argv.slice(2);
const BASE = process.env.BENCH_BASE ?? "http://localhost:3000";
type Case = { id: string; topic: string; request?: string; docFile?: string; strict?: boolean };
const cases = JSON.parse(readFileSync(casesFile, "utf8")) as Case[];
const cookie = `aria_access=${await signAccessToken("intake-probe", "bench@test.local")}`;
const flags = (q: string, options: string[]) => [
  /\bwhy\b|\bhow (does|do|would|can)\b|\bexplain\b|\bwhat (would|will) happen\b|\bif you\b|\bimagine\b|\bsuppose\b/i.test(q) ? "reasoning" : "",
  /\d+\s*[+\-×x*/÷]\s*\d+|\bcalculate\b|\bsolve\b/i.test(q) ? "calculation" : "",
  q.split(/\s+/).length > 12 ? `long(${q.split(/\s+/).length}w)` : "",
  options.some((o) => o.split(/\s+/).length > 6) ? "long option" : "",
].filter(Boolean);
let usd = 0;
const out = [];
for (const c of cases) {
  const doc = c.docFile ? JSON.parse(readFileSync(c.docFile, "utf8")) : null;
  const d = doc?.doc ?? doc;
  try {
    const run = await runIntake(BASE, cookie, { topic: c.topic, request: c.request, doc: d, strict: c.strict }, { allNew: true });
    usd += run.costUsd;
    console.log(`\n== ${c.id}: ${c.request ?? c.topic} (${run.secs}s, $${run.costUsd.toFixed(4)})`);
    for (const p of run.parts) {
      const f = p.check ? flags(p.check.question, p.check.options) : ["NO CHECK"];
      if (p.label.split(/\s+/).length > 5) f.push(`label ${p.label.split(/\s+/).length}w`);
      console.log(`  • ${p.label}${p.check ? `\n      ${p.check.question}  [${p.check.options.map((o, k) => (k === p.check!.answer ? `*${o}*` : o)).join(" / ")}]` : ""}${f.length ? `   ⚠ ${f.join(", ")}` : ""}`);
    }
    out.push({ ...c, docFile: undefined, parts: run.parts });
  } catch (e) {
    console.log(`\n== ${c.id}: ERROR ${(e as Error).message}`);
    out.push({ ...c, error: (e as Error).message });
  }
}
writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(`\ntotal $${usd.toFixed(4)}`);
