/**
 * A SCRIPTED STUDENT FOR THE INTAKE (lib/intake.ts): the real intake call (POST /api/plan-lesson
 * mode "intake", through the dev server), answered the way a bench entry says — which parts the
 * student knows or has heard of (1-based), and which checks they get wrong — then turned into the
 * profile exactly as LearnPage does (checksToAsk → gradeCheck → readParts → profileFromIntake).
 */
import { checksToAsk, gradeCheck, profileFromIntake, readParts, type CheckOutcome, type IntakePart, type PartMark } from "../../lib/intake.ts";
import { emptyProfile, type LearnerProfile } from "../../lib/learnerProfile.ts";
import { documentSections } from "../../lib/canvas/documentContext.ts";
import type { SuprnotesLessonInput } from "../../lib/suprnotes.ts";

export type Student = { know?: number[]; heard?: number[]; wrong?: number[]; allNew?: boolean };
export type IntakeRun = { parts: IntakePart[]; asked: Array<{ part: string; question: string; options: string[]; answered: string; outcome: CheckOutcome }>; profile: LearnerProfile; costUsd: number; secs: number };

export async function runIntake(base: string, cookie: string, req: { topic: string; request?: string; doc?: SuprnotesLessonInput | null; strict?: boolean }, student: Student): Promise<IntakeRun> {
  const t0 = Date.now();
  const given = req.doc ? documentSections(req.doc) : [];
  const res = await fetch(`${base}/api/plan-lesson`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ mode: "intake", topic: req.topic, request: req.request ?? req.topic, ...(given.length ? { parts: given } : {}), ...(req.doc ? { sourceDocument: req.doc } : {}), ...(req.strict ? { strict: true } : {}) }),
  });
  const data = (await res.json()) as { parts?: IntakePart[]; costUsd?: number; degraded?: string };
  const parts = data.parts ?? [];
  if (parts.length < 2) throw new Error(`intake gave no parts${data.degraded ? `: ${data.degraded}` : ""}`);
  const marks: Record<string, PartMark> = {};
  if (!student.allNew) {
    for (const i of student.know ?? []) if (parts[i - 1]) marks[parts[i - 1].id] = "know";
    for (const i of student.heard ?? []) if (parts[i - 1]) marks[parts[i - 1].id] = "heard";
  }
  const outcomes: Record<string, CheckOutcome> = {};
  const asked: IntakeRun["asked"] = [];
  for (const part of checksToAsk(parts, marks)) {
    const index = parts.indexOf(part) + 1;
    const c = part.check!;
    const answered = (student.wrong ?? []).includes(index) ? c.options[(c.answer + 1) % c.options.length] : c.options[c.answer];
    const outcome = gradeCheck(part, answered);
    outcomes[part.id] = outcome;
    asked.push({ part: part.label, question: c.question, options: c.options, answered, outcome });
  }
  const profile = profileFromIntake(req.topic, readParts(parts, marks, outcomes), emptyProfile(req.topic));
  return { parts, asked, profile, costUsd: Number(data.costUsd ?? 0), secs: Math.round((Date.now() - t0) / 1000) };
}

/** One line per part: its label, the student's status, and its check — for the run log. */
export function intakeReport(run: IntakeRun): string {
  const status = new Map((run.profile.parts ?? []).map((p) => [p.label, p.status]));
  return [
    ...run.parts.map((p, i) => `   part ${i + 1}: ${p.label} → ${status.get(p.label) ?? "?"}${p.check ? `  | check: ${p.check.question} [${p.check.options.map((o, k) => (k === p.check!.answer ? `*${o}*` : o)).join(" / ")}]` : "  | no check"}`),
    ...run.asked.map((a) => `   asked: "${a.question}" → answered "${a.answered}" (${a.outcome})`),
  ].join("\n");
}
