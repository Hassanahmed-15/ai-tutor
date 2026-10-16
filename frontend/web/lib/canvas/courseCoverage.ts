/**
 * DOES THE PLAN TEACH WHAT THE SYLLABUS LESSON LISTS? A course lesson's spec gives every board its
 * key points (lib/curriculum/lessonSpec.ts); the planner then writes what Aria says. Nothing
 * compared the two, and audited lessons dropped four of nine key points on a board and eight of
 * sixteen required terms (coverage audit 2026-10-17). Pure: the planner retries once with this list.
 */

const STOP = new Set("about above after again also among because been before being below between both could does each every from have here into just like more most much must only other over same should some such than that their them then there these they this those through under until very were what when where which while with would your will used uses using also make makes made".split(" "));

const stem = (w: string) => w.toLowerCase().replace(/[’']s$/, "").replace(/(ies|es|s|ed|ing)$/, "").slice(0, 6);
function stems(text: string): string[] {
  const words = text.replace(/(\d),(\d{3})/g, "$1$2").match(/[\p{L}\d][\p{L}\d.%$£€-]*/gu) ?? [];
  return [...new Set(words.map((w) => w.replace(/[.-]+$/, "")).filter((w) => (/\d/.test(w) ? w.length >= 2 : w.length >= 4) && !STOP.has(w.toLowerCase())).map(stem))];
}

/** A key point is taught when most of its distinctive words are in the board's script. */
export function keyPointTaught(point: string, script: string): boolean {
  const want = stems(point);
  if (!want.length) return true;
  const said = new Set(stems(script));
  return want.filter((w) => said.has(w)).length / want.length >= 0.5;
}

/** A required term is used when each of its words is said somewhere in the lesson. */
export function termUsed(term: string, scripts: string): boolean {
  const said = new Set(stems(scripts));
  const want = stems(term);
  return !want.length || want.every((w) => said.has(w));
}

export type CoverageGap = { board: string; missing: string[]; depth?: string[] };

const REASON = /\b(because|so that|so|therefore|which means|this means|that is why|as a result|due to|since|in order to|leads? to|causes?|results? in)\b/gi;

/** Reason links in a script ("because", "so", "which means"…): how much it explains rather than lists. */
export function reasonLinks(script: string): number {
  return script.match(REASON)?.length ?? 0;
}

/** The numbers and named details of a block's worked example ("Worked example: …"). */
export function workedExampleMarkers(text = ""): string[] {
  const worked = /Worked example:\s*([\s\S]*?)(?:\n\n|$)/.exec(text)?.[1] ?? "";
  const numbers = (worked.replace(/(\d),(\d{3})/g, "$1$2").match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => !/^[1-6]$/.test(n));
  return [...new Set(numbers)];
}

/**
 * Depth faults of one course board: facts with no reasons, or a worked example that is not walked
 * through. Lessons that listed facts scored 4.5–6 on teaching depth (audit 2026-10-17).
 */
export function depthIssues(script: string, block: { keyIdeas?: string[]; text?: string }): string[] {
  const issues: string[] = [];
  const points = block.keyIdeas?.length ?? 0;
  // Definitions and plain facts need no "because": about one point in three is a how or why.
  const needReasons = Math.max(1, Math.ceil(points / 3));
  if (points && reasonLinks(script) < needReasons) issues.push(`it states facts without their reasons — give the reason or mechanism for each how/why key point ("because…", "which means…"; ${reasonLinks(script)} now, at least ${needReasons} needed)`);
  // Understandable: one idea per sentence. Sentences of 40+ words made accounting boards hard to follow.
  const long = script.split(/(?<=[.!?])\s+/).filter((x) => x.split(/\s+/).length > 35);
  if (long.length >= 2) issues.push(`${long.length} sentences are over 35 words — split each into sentences of one idea ("${long[0].split(/\s+/).slice(0, 8).join(" ")}…")`);
  const markers = workedExampleMarkers(block.text);
  if (markers.length >= 2) {
    const said = new Set((script.replace(/(\d),(\d{3})/g, "$1$2").match(/\d+(?:\.\d+)?/g) ?? []));
    const walked = markers.filter((m) => said.has(m)).length;
    if (walked / markers.length < 0.6) issues.push(`it does not walk its worked example step by step (its values ${markers.filter((m) => !said.has(m)).slice(0, 6).join(", ")} are never said)`);
  }
  return issues;
}

/**
 * The key points each board leaves out (a board passes when it teaches three in four of its points),
 * and the required terms no board uses. Refresher boards are not lesson boards; the rest are matched
 * to the lesson plan's blocks in order.
 */
export function courseCoverageGaps(
  beats: Array<{ id: string; title: string; script: string; refresher?: boolean }>,
  blocks: Array<{ heading?: string; keyIdeas?: string[]; text?: string }>,
  terms: string[] = [],
): { boards: CoverageGap[]; terms: string[] } {
  const lessonBeats = beats.filter((b) => !b.refresher);
  const boards: CoverageGap[] = [];
  blocks.forEach((block, i) => {
    const beat = lessonBeats[i];
    const points = block.keyIdeas ?? [];
    if (!beat || !points.length) return;
    const missing = points.filter((p) => !keyPointTaught(p, beat.script));
    const depth = (block as { exam?: unknown }).exam ? [] : depthIssues(beat.script, block);
    if (missing.length > points.length / 4 || depth.length) boards.push({ board: `${beat.id} (${beat.title})`, missing: missing.length > points.length / 4 ? missing : [], depth });
  });
  const all = lessonBeats.map((b) => b.script).join(" ");
  return { boards, terms: terms.filter((t) => !termUsed(t, all)) };
}

/** The gaps as an instruction the planner can act on. */
export function coverageMessage(gaps: ReturnType<typeof courseCoverageGaps>): string {
  const parts = [
    ...gaps.boards.flatMap((g) => [
      ...(g.missing.length ? [`${g.board} does not teach these key points of its block — say each one, in its own sentence: ${g.missing.map((m) => `"${m.slice(0, 160)}"`).join("; ")}`] : []),
      ...(g.depth ?? []).map((d) => `${g.board}: ${d}`),
    ]),
    ...(gaps.terms.length ? [`these required terms are never used — use each where it belongs: ${gaps.terms.join(", ")}`] : []),
  ];
  return parts.join(". ");
}

/** The required terms a course lesson document lists ("Use these terms: a, b, c."). */
export function requiredTermsOf(hints: string[] = []): string[] {
  const line = hints.find((h) => /^Use these terms:/i.test(h));
  return line ? line.replace(/^Use these terms:\s*/i, "").replace(/\.$/, "").split(/,\s*/).map((t) => t.trim()).filter(Boolean) : [];
}
