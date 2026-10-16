import { createHash } from "node:crypto";

export type BenchSubject = "biology" | "maths" | "other";
export type BenchQualification = "O Level" | "A Level";
export type BenchSplit = "tuning" | "heldOut";

export type BenchLessonAddress = {
  courseId: string;
  grade: string;
  unitId: string;
  topicId: string;
  lessonId: string;
};

export type BenchCandidate = BenchLessonAddress & {
  subject: BenchSubject;
  qualification: BenchQualification;
  title: string;
};

export type BenchLesson = BenchCandidate & {
  id: string;
  split: BenchSplit;
};

export const BENCH_SEED = "aria-bench-v1";

export const BENCH_COURSES: Array<{ courseId: string; subject: BenchSubject; qualification: BenchQualification }> = [
  { courseId: "cie-olevel-biology-5090-2026-2028", subject: "biology", qualification: "O Level" },
  { courseId: "cie-alevel-biology-9700-2025-2027", subject: "biology", qualification: "A Level" },
  { courseId: "cie-olevel-mathematics-d-4024-2025-2027", subject: "maths", qualification: "O Level" },
  { courseId: "cie-alevel-mathematics-9709-2026-2027", subject: "maths", qualification: "A Level" },
  { courseId: "cie-olevel-chemistry-5070-2026-2028", subject: "other", qualification: "O Level" },
  { courseId: "cie-alevel-chemistry-9701-2025-2027", subject: "other", qualification: "A Level" },
  { courseId: "cie-olevel-physics-5054-2026-2028", subject: "other", qualification: "O Level" },
  { courseId: "cie-alevel-physics-9702-2025-2027", subject: "other", qualification: "A Level" },
];

/** Prefer diagram-heavy or exam-core topics when the tree has more lessons than the panel needs. */
export const PRIORITY: Record<BenchSubject, RegExp> = {
  biology: /photosynth|enzyme|mitos|meios|immun|kidney|heart|cell|chloroplast|gene|protein synthes|phagocyt|gas exchange|neuron|action potential|limiting factor|oxygen|leaf|stomata|kidney|neuron|virus|bacteria|digest/i,
  maths: /quadrat|inequal|transform|vector|distribut|normal|binomial|differenti|integrat|trigon|function|graph|probab|circle|matrix|coordinate|gradient|sequence/i,
  other: /bond|molecul|force|circuit|wave|atom|equilibri|organic|energy|motion|electro/i,
};

export function lessonHash(address: BenchLessonAddress, seed = BENCH_SEED): string {
  return createHash("sha256").update([seed, address.courseId, address.grade, address.unitId, address.topicId, address.lessonId].join("|")).digest("hex");
}

export function lessonId(address: BenchLessonAddress): string {
  return `${address.courseId}/${address.grade}/${address.unitId}/${address.topicId}/${address.lessonId}`;
}

/** Unique filename stem. Truncating the full id to 80 chars collided mitosis with chromosomes. */
export function benchFileSlug(lesson: { id: string; lessonId: string }): string {
  const name = lesson.lessonId.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 56);
  const hash = createHash("sha1").update(lesson.id).digest("hex").slice(0, 8);
  return `${name}-${hash}`;
}

function bucketKey(c: Pick<BenchCandidate, "subject" | "qualification">): string {
  return `${c.subject}:${c.qualification}`;
}

/**
 * 30 tuning + 10 held-out. Held-out IDs are chosen by hash so the set is stable and is not
 * hand-picked from titles. Tuning never reads held-out titles at report time.
 */
export function assignPanel(candidates: BenchCandidate[], seed = BENCH_SEED): { tuning: BenchLesson[]; heldOut: BenchLesson[] } {
  const byBucket = new Map<string, BenchCandidate[]>();
  for (const c of candidates) {
    const key = bucketKey(c);
    const list = byBucket.get(key) ?? [];
    list.push(c);
    byBucket.set(key, list);
  }
  const tuning: BenchLesson[] = [];
  const heldOut: BenchLesson[] = [];
  const heldNeed: Record<string, number> = {
    "biology:O Level": 2,
    "biology:A Level": 2,
    "maths:O Level": 2,
    "maths:A Level": 2,
    "other:O Level": 1,
    "other:A Level": 1,
  };
  const tuneNeed: Record<string, number> = {
    "biology:O Level": 5,
    "biology:A Level": 5,
    "maths:O Level": 5,
    "maths:A Level": 5,
    "other:O Level": 5,
    "other:A Level": 5,
  };

  for (const [key, list] of byBucket) {
    const ranked = [...list].sort((a, b) => {
      const pa = PRIORITY[a.subject].test(`${a.title} ${a.topicId}`) ? 0 : 1;
      const pb = PRIORITY[b.subject].test(`${b.title} ${b.topicId}`) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      return lessonHash(a, seed).localeCompare(lessonHash(b, seed));
    });
    const takeTune = tuneNeed[key] ?? 0;
    const takeHeld = heldNeed[key] ?? 0;
    const chosen = ranked.slice(0, takeTune + takeHeld);
    chosen.forEach((c, i) => {
      const lesson: BenchLesson = { ...c, id: lessonId(c), split: i < takeTune ? "tuning" : "heldOut" };
      (lesson.split === "tuning" ? tuning : heldOut).push(lesson);
    });
  }
  return { tuning, heldOut };
}

export type BenchPanelFile = {
  seed: string;
  builtAt: string;
  tuning: BenchLesson[];
  /** Addresses only in reports; titles are stored so the release script can run them later. */
  heldOut: Array<Omit<BenchLesson, "title"> & { title: string }>;
};

export function publicHeldOutIds(panel: BenchPanelFile): string[] {
  return panel.heldOut.map((l) => l.id);
}

type TreeLike = {
  id: string;
  grades: Array<{
    grade: string;
    units: Array<{
      id: string;
      title: string;
      topics: Array<{
        id: string;
        title: string;
        subtopics: Array<{ id: string; title: string }>;
      }>;
    }>;
  }>;
};

export function collectCandidates(
  tree: TreeLike,
  meta: { subject: BenchSubject; qualification: BenchQualification },
): BenchCandidate[] {
  const out: BenchCandidate[] = [];
  for (const g of tree.grades) {
    for (const u of g.units) {
      for (const t of u.topics) {
        for (const s of t.subtopics) {
          out.push({
            courseId: tree.id,
            grade: g.grade,
            unitId: u.id,
            topicId: t.id,
            lessonId: s.id,
            title: s.title,
            subject: meta.subject,
            qualification: meta.qualification,
          });
        }
      }
    }
  }
  return out;
}
