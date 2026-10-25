// Fixes 1 and 2 replayed on a saved lesson's real boards (read-only, free).
import { readFileSync } from "node:fs";
import { CosmosClient } from "@azure/cosmos";
import { removeNamedLines } from "../../../lib/canvas/boardLookCheck";
import { dropRowsWhere, saysNothing } from "../../../lib/canvas/equationCheck";
const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]));
const db = new CosmosClient(env.COSMOS_CONNECTION_STRING).database("aria-shared");
const saved = (await db.container("progressive-lecture-beats").items.query({ query: "SELECT * FROM c WHERE c.sessionId = @id", parameters: [{ name: "@id", value: process.argv[2] }] }).fetchAll()).resources as any[];
const specOf = (n: number) => structuredClone(saved.find((b) => b.sequence === n - 1)?.beat?.draw?.ops?.find((o: any) => o.kind === "canvasBoard")?.spec);
const rows = (st: any) => st.steps.map((p: any) => p.order.map((id: string) => st.tokens.find((t: any) => t.id === id)?.text).join(" "));
for (const n of [2, 3, 7]) {
  const spec = specOf(n);
  console.log(`board ${n} rows:`, JSON.stringify(rows(spec.stage)), "\n  notes:", JSON.stringify(spec.notes.map((x: any) => x.text)));
  const st = structuredClone(spec.stage);
  console.log("  fix 2 removes:", JSON.stringify(dropRowsWhere(st, saysNothing)));
}
// Fix 1 with the lines as the look would copy them from the board (as the student sees them).
const b2 = specOf(2);
const out = removeNamedLines(b2, [{ kind: "wrong-fact", detail: "two hydroxide ions", serious: true, where: "writing", lines: ["Ca(OH)₂ → Ca²⁺ + OH⁻", "calcium hydroxide = Ca²⁺ + OH⁻"] }]);
console.log("fix 1 on board 2 removes:", JSON.stringify(out.removed), "\n  rows left:", JSON.stringify(rows(out.spec.stage)), "\n  notes left:", out.spec.notes.length, "of", b2.notes.length);
process.exit(0);
