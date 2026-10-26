// How many maths course lessons does the code figure library have a figure for? (free)
import { readFileSync } from "node:fs";
const { figureFor } = await import("../../../lib/figures/registry");
const trees = process.argv.slice(2);
let lessons = 0, matched = 0;
const by = new Map<string, number>();
const missed: string[] = [];
for (const t of trees) {
  const d = JSON.parse(readFileSync(`data/curricula/trees/${t}.json`, "utf8"));
  for (const g of d.grades) for (const u of g.units ?? []) for (const tp of u.topics ?? []) for (const st of tp.subtopics ?? []) {
    lessons++;
    const text = [st.title, ...(st.outcomes ?? []).map((o: any) => o.text)].join(". ");
    const c = figureFor(text);
    if (c) { matched++; by.set(c.name, (by.get(c.name) ?? 0) + 1); } else missed.push(`${t.split("-").slice(0, 3).join("-")}: ${st.title.slice(0, 70)}`);
  }
}
console.log(`${lessons} maths lessons: ${matched} have a code figure (${Math.round((matched / lessons) * 100)}%)`);
console.log("figures used:", [...by.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", "));
console.log("\nno figure (sample):\n" + missed.filter((_, i) => i % Math.max(1, Math.floor(missed.length / 45)) === 0).join("\n"));
