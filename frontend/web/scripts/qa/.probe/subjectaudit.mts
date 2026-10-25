// How often does the title-guessing put a course lesson in the wrong subject? (free, offline)
import { readdirSync, readFileSync } from "node:fs";
import { isMathsTopic } from "../../../lib/canvas/predictCard";
import { isCsTopic, isLabLookTopic } from "../../../lib/canvas/subjectLook";
const dir = "data/curricula/trees";
const kind = (subject: string) => /math|statistic|further pure|mechanics/i.test(subject) ? "maths" : /computer|computing|information (?:and communication )?technolog|\bict\b|programming|digital technolog|software/i.test(subject) ? "cs" : "other";
type Row = { course: string; subject: string; kind: string; title: string; text: string };
const rows: Row[] = [];
for (const f of readdirSync(dir)) {
  if (!/^(cie|edexcel|aqa|ocr|fbise|ib|ap|us-|uk-|au-)/.test(f)) continue;
  const t = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  for (const g of t.grades ?? []) for (const u of g.units ?? []) for (const tp of u.topics ?? []) for (const st of tp.subtopics ?? []) {
    const title = String(st.title ?? "").replace(/\s*\(\d+\)\s*$/, "");
    rows.push({ course: t.id, subject: t.subject, kind: kind(t.subject), title, text: `${title} ${(st.outcomes ?? []).map((o: any) => o.text).join(" ")}` });
  }
}
const pct = (a: number, b: number) => `${a}/${b} (${b ? Math.round((100 * a) / b) : 0}%)`;
for (const k of ["other", "maths", "cs"]) {
  const r = rows.filter((x) => x.kind === k);
  const asMathsTitle = r.filter((x) => isMathsTopic(x.title)), asCsTitle = r.filter((x) => isCsTopic(x.title)), labTitle = r.filter((x) => isLabLookTopic(x.title));
  const asMathsText = r.filter((x) => isMathsTopic(x.text)), asCsText = r.filter((x) => isCsTopic(x.text)), labText = r.filter((x) => isLabLookTopic(x.text));
  console.log(`\n${k.toUpperCase()} courses: ${r.length} lessons in ${new Set(r.map((x) => x.course)).size} courses`);
  console.log(`  by title alone:        maths ${pct(asMathsTitle.length, r.length)}   cs ${pct(asCsTitle.length, r.length)}   maths/CS look ${pct(labTitle.length, r.length)}`);
  console.log(`  by title + its content: maths ${pct(asMathsText.length, r.length)}   cs ${pct(asCsText.length, r.length)}   maths/CS look ${pct(labText.length, r.length)}`);
  const wrong = k === "other" ? labTitle : k === "maths" ? r.filter((x) => !isMathsTopic(x.title)) : r.filter((x) => !isCsTopic(x.title));
  const bySubject = new Map<string, number>();
  for (const x of wrong) bySubject.set(x.subject, (bySubject.get(x.subject) ?? 0) + 1);
  console.log(`  wrong by title, top subjects: ${[...bySubject.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, n]) => `${s.slice(0, 30)} ${n}`).join(" | ")}`);
  console.log(`  examples: ${wrong.filter((x) => /cie-olevel|cie-igcse|cie-alevel/.test(x.course)).slice(0, 14).map((x) => `[${x.subject.slice(0, 12)}] ${x.title}`).join(" · ")}`);
}

// THE NEW RULE (lib/canvas/lessonSubject.ts): the course's subject decides; a mixed course reads the lesson title.
import { courseLessonSubject } from "../../../lib/canvas/lessonSubject";
console.log("\n=== with the course's subject deciding ===");
for (const k of ["other", "maths", "cs"]) {
  const r = rows.filter((x) => x.kind === k);
  const got = r.map((x) => courseLessonSubject({ lesson: { subject: x.subject, title: x.title } } as never, x.title));
  const wrong = got.filter((g) => g !== k).length;
  console.log(`${k.toUpperCase()} courses: ${r.length} lessons — taught as the wrong subject: ${wrong} (${((100 * wrong) / r.length).toFixed(2)}%)`);
}
for (const k of ["other", "maths"]) {
  const left = rows.filter((x) => x.kind === k && courseLessonSubject({ lesson: { subject: x.subject, title: x.title } } as never, x.title) !== k);
  const m = new Map<string, number>(); for (const x of left) m.set(x.subject, (m.get(x.subject) ?? 0) + 1);
  console.log(`${k} left over by course subject:`, [...m.entries()].map(([s, n]) => `${s} ${n}`).join(" | "));
}
