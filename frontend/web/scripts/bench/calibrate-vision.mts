/**
 * Calibrates the vision judge against hand-scored lectures, from what the student actually SAW:
 * the final screenshot of every board in the real player, plus the scripts and quiz cards.
 *
 *   node --env-file=.env.local --import tsx scripts/bench/calibrate-vision.mts <qaRoot> [model]
 *
 * <qaRoot> holds hand-scores.json, lectures/<id>-snapshot.json and the screenshot folders. The judge
 * never sees the hand scores. Writes <qaRoot>/calibration/<model>.json and prints the agreement.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { BENCH_CRITERIA, type BenchScores } from "../../lib/bench/criteria";
import { rubricLines } from "../../lib/bench/rubric";
import { calibrateJudge, type HandScoredLecture } from "../../lib/bench/handScores";
import { parseJudgeJson, type LessonJudgeVerdict } from "../../lib/bench/judge";

const root = process.argv[2];
const model = process.argv[3] ?? process.env.BENCH_JUDGE_MODEL ?? "gemini-3.8-flash";
const key = process.env.GEMINI_API_KEY;
if (!root || !key) throw new Error("usage: calibrate-vision.mts <qaRoot> [model] (GEMINI_API_KEY set)");

/** Every folder under root that holds board screenshots. */
function screenshotDirs(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).flatMap((d) => {
    const full = path.join(dir, d.name);
    const pngs = fs.readdirSync(full).some((f) => f.endsWith(".png"));
    return [...(pngs ? [full] : []), ...screenshotDirs(full)];
  });
}

/** The last screenshot of each board (not its first frame), in board order. */
function boardShots(id: string): string[] {
  const shots: string[] = [];
  for (let b = 1; b <= 12; b++) {
    const pattern = new RegExp(`^${id}-b${b}-\\d+\\.png$`);
    const found = screenshotDirs(root).flatMap((d) => fs.readdirSync(d).filter((f) => pattern.test(f)).map((f) => path.join(d, f))).sort();
    if (found.length) shots.push(found[found.length - 1]);
  }
  return shots;
}

const RUBRIC = `You are a strict Cambridge O/A Level examiner and an experienced teacher scoring ONE recorded lesson as a student experienced it. You see the final screenshot of every board, the words Aria spoke over each board, and each quiz card.
Score each criterion with an integer 1–10. Inspect the screenshots yourself: never assume a diagram is right.
Criteria (score each 1–10):\n${rubricLines()}
Return JSON only: {"scores": {${BENCH_CRITERIA.map((c) => `"${c}": n`).join(", ")}}, "notes": {"<criterion>": "one line of evidence"}, "diagramsAndLabelsEvidence": "what is wrong or right with the diagrams, board by board"}.`;

async function judge(lecture: HandScoredLecture): Promise<LessonJudgeVerdict> {
  const snap = JSON.parse(fs.readFileSync(path.join(root, "lectures", `${lecture.id}-snapshot.json`), "utf8"));
  const shots = boardShots(lecture.id);
  const parts: Array<Record<string, unknown>> = [{ text: `${RUBRIC}\n\nLesson: ${lecture.title}` }];
  (snap.beats ?? []).forEach((beat: { title: string; script: string; draw?: { ops?: Array<{ spec?: { interaction?: { kind?: string; question?: string; options?: Array<{ text: string; correct?: boolean }> } } }> } }, i: number) => {
    const card = beat.draw?.ops?.[0]?.spec?.interaction;
    const quiz = card?.kind === "quiz" ? `\nQuiz card: ${card.question} | ${card.options?.map((o) => `${o.text}${o.correct ? " (correct)" : ""}`).join(" | ")}` : "";
    parts.push({ text: `\n--- Board ${i + 1}: ${beat.title}\nAria says: ${beat.script}${quiz}` });
  });
  for (const [i, file] of shots.entries()) {
    const jpg = await sharp(file).resize({ width: 1100 }).jpeg({ quality: 80 }).toBuffer();
    parts.push({ text: `Screenshot of board ${i + 1}:` }, { inline_data: { mime_type: "image/jpeg", data: jpg.toString("base64") } });
  }
  // The free tier allows a few requests a minute: wait as long as the API asks, up to 4 tries.
  let body: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } } = {};
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", temperature: 0 } }),
    });
    body = await res.json() as typeof body;
    if (res.ok) break;
    const wait = Number(/retry in ([\d.]+)s/i.exec(body.error?.message ?? "")?.[1] ?? 0);
    // 429: over the per-minute quota (wait as asked). 503: the model is overloaded (back off: 30, 60, 120 s).
    if ((res.status !== 429 && res.status !== 503) || attempt === 4 || /per day|PerDay/i.test(body.error?.message ?? "")) throw new Error(`${model}: ${body.error?.message?.split("\n")[0] ?? res.status}`);
    await new Promise((r) => setTimeout(r, res.status === 503 ? 30_000 * 2 ** (attempt - 1) : (wait + 2) * 1000));
  }
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return parseJudgeJson(text);
}

const hand = JSON.parse(fs.readFileSync(path.join(root, "hand-scores.json"), "utf8")) as HandScoredLecture[];
const judged: Array<{ id: string; verdict: LessonJudgeVerdict }> = [];
const mean = (s: BenchScores) => BENCH_CRITERIA.reduce((n, k) => n + s[k], 0) / BENCH_CRITERIA.length;
for (const [n, lecture] of hand.entries()) {
  if (n) await new Promise((r) => setTimeout(r, 13_000)); // under 5 requests a minute
  try {
    const verdict = await judge(lecture);
    judged.push({ id: lecture.id, verdict });
    console.log(`${lecture.id.padEnd(3)} hand ${mean(lecture.scores).toFixed(2)}  judge ${mean(verdict.scores).toFixed(2)}  diagrams hand ${lecture.scores.diagramsAndLabels} judge ${verdict.scores.diagramsAndLabels}`);
  } catch (error) {
    console.log(`${lecture.id}: ${(error as Error).message}`);
  }
}
const report = calibrateJudge(hand, judged);
const mae = judged.length ? judged.reduce((n, j) => n + Math.abs(mean(hand.find((h) => h.id === j.id)!.scores) - mean(j.verdict.scores)), 0) / judged.length : NaN;
console.log(`\nn=${report.n}  overall r=${report.overallR.toFixed(2)}  diagrams r=${report.perCriterion.diagramsAndLabels.toFixed(2)}  mean abs error ${mae.toFixed(2)}  ${report.passed ? "PASSED" : "NOT YET"} (target r ≥ ${report.targetR})`);
console.log(Object.entries(report.perCriterion).map(([k, r]) => `${k} ${Number.isFinite(r) ? r.toFixed(2) : "–"}`).join(" · "));
fs.mkdirSync(path.join(root, "calibration"), { recursive: true });
fs.writeFileSync(path.join(root, "calibration", `${model}.json`), JSON.stringify({ model, report, mae, judged }, null, 1));
