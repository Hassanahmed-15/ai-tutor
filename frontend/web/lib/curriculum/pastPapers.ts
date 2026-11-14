import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { downloadJsonBlob, downloadRawBlob } from "@/lib/blobStorage";

/**
 * PAST-PAPER PRACTICE AT THE END OF A COURSE LESSON (owner, 2026-11-14: IGCSE Physics, Chemistry, Biology and
 * Maths, "100 percent accurate, don't miss anything").
 *
 * Two layers, because Cambridge does not license its papers for electronic publication:
 *   - POINTERS, for every student (data/curricula/pastpapers/<courseId>.json, in the repo): which real past-paper
 *     questions test this lesson ("0625/42 · May/June 2023 · Q3"). A reference, not Cambridge's text.
 *   - THE REAL QUESTIONS — page images, text, official mark scheme — in private blob storage, served only to the
 *     accounts listed in PAST_PAPERS_FULL_USERS (the owner's personal practice).
 *
 * How the data was made (persona-lab style scripts, scratchpad pp/): 795 papers 2020–2025 cut into questions by
 * word positions (free); every paper checked — questions numbered 1..N, question totals add to the cover's total
 * mark, every question has mark-scheme rows; 794 passed (one has no published mark scheme). Each question part
 * matched to the lesson it tests by embeddings + luna, then checked a second time where the two disagreed.
 */

export type PastPaperPointer = {
  ref: string;            // "0625_s23_qp_42#3"
  paper: string;          // "0625/42"
  session: string;        // "May/June"
  year: number;
  q: number;
  mcq: boolean;
  marks: number;          // the question's marks
  parts: string[];        // the parts that test this lesson ("3(a)", "3(b)(i)"); [] for a whole MCQ question
  lessonMarks: number;    // marks of those parts
};

export type PastPaperIndex = { courseId: string; builtAt: string; lessons: Record<string, PastPaperPointer[]> };

export type PastPaperQuestion = {
  ref: string; paper: string; session: string; year: number; q: number; mcq: boolean; marks: number;
  parts: Array<{ label: string; marks: number; text: string }>;
  ms: Array<{ label: string; answer: string; guidance: string; marks: number }>;
  answer?: string | null;  // MCQ key
  images: string[];        // blob names, in reading order
};

const DATA = path.join(process.cwd(), "data/curricula/pastpapers");
const BLOB = "pastpapers";

export function pastPapersOn(): boolean {
  return process.env.CURRICULUM_PAST_PAPERS === "on";
}

const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

/**
 * Who may see the real questions and mark schemes: the owner's team, not the public (owner, 2026-11-14: "every
 * user on Aria — they are my managers and partners"; sign-up is open, so an account alone is not enough).
 *   PAST_PAPERS_FULL_USERS   account ids (every account that existed on 2026-11-14)
 *   PAST_PAPERS_FULL_EMAILS  emails, or "@domain" for a whole organisation ("@onescreensolutions.com")
 */
export function fullPastPaperAccess(userId: string | null | undefined, email?: string | null): boolean {
  if (!userId) return false;
  if (list(process.env.PAST_PAPERS_FULL_USERS).includes(userId.toLowerCase())) return true;
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return false;
  return list(process.env.PAST_PAPERS_FULL_EMAILS).some((rule) => (rule.startsWith("@") ? e.endsWith(rule) : e === rule));
}

const indexes = new Map<string, Promise<PastPaperIndex | null>>();
export function pastPaperIndex(courseId: string): Promise<PastPaperIndex | null> {
  if (!/^[a-z0-9-]{1,120}$/.test(courseId)) return Promise.resolve(null);
  if (!indexes.has(courseId)) {
    indexes.set(courseId, readFile(path.join(DATA, `${courseId}.json`), "utf8").then((s) => JSON.parse(s) as PastPaperIndex, () => null));
  }
  return indexes.get(courseId)!;
}

/**
 * The questions for one lesson part: the lesson's best-matching questions, newest first, a mix of multiple
 * choice and written, a different set for each part of a lesson series.
 */
export function pickForLesson(all: PastPaperPointer[], part = 1, count = 3): PastPaperPointer[] {
  const ranked = [...all].sort((a, b) => b.lessonMarks / Math.max(1, b.marks) - a.lessonMarks / Math.max(1, a.marks) || b.year - a.year);
  const mcq = ranked.filter((p) => p.mcq);
  const written = ranked.filter((p) => !p.mcq);
  const out: PastPaperPointer[] = [];
  const offset = Math.max(0, part - 1);
  const take = (list: PastPaperPointer[], n: number) => {
    for (let i = 0; i < n && list.length; i++) {
      const p = list[(offset * n + i) % list.length];
      if (!out.includes(p)) out.push(p);
    }
  };
  take(written, written.length ? Math.min(2, count - (mcq.length ? 1 : 0)) : 0);
  take(mcq, count - out.length);
  if (out.length < count) take(written, count - out.length);
  return out.slice(0, count);
}

const REF = /^(\d{4}_[msw]\d{2}_qp_\d{2})#(\d{1,2})$/;

export async function pastPaperQuestion(ref: string): Promise<PastPaperQuestion | null> {
  const m = ref.match(REF);
  if (!m) return null;
  return downloadJsonBlob<PastPaperQuestion>(`${BLOB}/questions/${m[1]}/${m[2]}.json`).catch(() => null);
}

export async function pastPaperImage(ref: string, k: number): Promise<Buffer | null> {
  const m = ref.match(REF);
  if (!m || !Number.isInteger(k) || k < 0 || k > 20) return null;
  return downloadRawBlob(`${BLOB}/images/${m[1]}/${m[2]}-${k}.jpg`);
}

/** "0625/42 · May/June 2023 · Q3" */
export function pointerLabel(p: Pick<PastPaperPointer, "paper" | "session" | "year" | "q">): string {
  return `${p.paper} · ${p.session} ${p.year} · Q${p.q}`;
}
