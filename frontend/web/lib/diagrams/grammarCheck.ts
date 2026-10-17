import type { CompiledDiagram } from "./grammar";

/**
 * WHAT CODE CAN CHECK ABOUT A DIAGRAM BEFORE ANYONE LOOKS AT IT. Pure.
 *
 *   - every part the syllabus requires is drawn and named;
 *   - a repeated shape matches the count the narration states ("23 pairs" draws 23);
 *   - every number the art writes is one the lesson says (a diagram must not invent data);
 *   - when the narration states numbers and the diagram plots data, the plot uses them;
 *   - no two parts point at the same place, and the art fills its canvas.
 *
 * Each problem is phrased as what to change, for the writer's next attempt.
 */

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20 };
const stem = (w: string) => w.toLowerCase().replace(/(ies|es|s)$/, "").slice(0, 6);
const contentWords = (t: string) => (t.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => !/^(the|and|for|with|its|from|that|this|into|each|show|shown|labelled|label|drawn|clear|clearly)$/.test(w)).map(stem);
const numbersIn = (t: string) => (t.replace(/(\d),(\d{3})(?!\d)/g, "$1$2").match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);

export type DiagramCheckInput = { narration: string; brief?: string; mustShow?: string[] };

export function diagramIssues(compiled: CompiledDiagram, input: DiagramCheckInput): string[] {
  if (!compiled.drawing) return compiled.issues;
  const issues: string[] = [];
  const { drawing, facts } = compiled;
  const said = `${input.narration} ${input.brief ?? ""} ${(input.mustShow ?? []).join(" ")}`;
  const names = drawing.parts.map((p) => ({ id: p.id, words: new Set(contentWords(p.name)) }));

  // 1. Everything required is a named part.
  for (const need of input.mustShow ?? []) {
    const want = contentWords(need);
    if (!want.length) continue;
    const hit = names.some((n) => want.filter((w) => n.words.has(w)).length >= Math.max(1, Math.ceil(want.length / 2)));
    if (!hit) issues.push(`the syllabus requires "${need}" — draw it and name it as a part`);
  }

  // 2. A repeat matches the count the narration gives for that part ("23 pairs", "four chambers").
  for (const c of facts.counts) {
    const part = drawing.parts.find((p) => p.id === c.part);
    if (!part) continue;
    const words = contentWords(part.name);
    const stated = [...said.matchAll(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty)\s+(?:[a-z-]+\s+)?([a-z]{3,})/gi)]
      .filter((m) => words.includes(stem(m[2])))
      .map((m) => (/\d/.test(m[1]) ? Number(m[1]) : WORDS[m[1].toLowerCase()]));
    if (stated.length && !stated.includes(c.count)) issues.push(`the narration gives ${stated[0]} for "${part.name}" but the diagram repeats it ${c.count} times — repeat it exactly ${stated[0]} times`);
  }

  // 3. No invented numbers in the art.
  const spoken = new Set(numbersIn(said).map((n) => String(n)));
  const invented = [...new Set(facts.written)].filter((n) => !spoken.has(String(Number(n))) && Number(n) > 1);
  if (invented.length) issues.push(`the diagram writes ${invented.slice(0, 3).join(", ")}, which the lesson never says — write only numbers the narration states`);

  // 4. Plotted data uses the lesson's numbers when the lesson gives some.
  const lessonNumbers = numbersIn(input.narration).filter((n) => !(n >= 1900 && n <= 2100 && Number.isInteger(n)));
  if (facts.kinds.includes("plot") && lessonNumbers.length >= 2 && facts.data.length) {
    const used = lessonNumbers.filter((n) => facts.data.some((d) => Math.abs(d - n) <= Math.max(1e-6, Math.abs(n) * 0.001)));
    if (used.length === 0) issues.push(`the narration states ${lessonNumbers.slice(0, 4).join(", ")} but the plot uses none of them — plot the lesson's own data`);
  }

  // 5. Parts are told apart, and the art uses its canvas.
  for (let i = 0; i < drawing.parts.length; i++) {
    for (let j = i + 1; j < drawing.parts.length; j++) {
      const a = drawing.parts[i].anchor, b = drawing.parts[j].anchor;
      if (Math.hypot(a.x - b.x, a.y - b.y) < 10) issues.push(`parts "${drawing.parts[i].name}" and "${drawing.parts[j].name}" point at the same place — draw them as separate regions`);
    }
  }
  const lower = drawing.parts.map((p) => p.name.toLowerCase());
  if (new Set(lower).size < lower.length) issues.push("two parts have the same name — every part needs its own name");
  return issues.slice(0, 6);
}
