import "server-only";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { blobStorageConfigured, downloadJsonBlob, uploadJsonBlob } from "@/lib/blobStorage";
import { EXAM_ID } from "./rules";
import type { StoredExam } from "./types";

/**
 * WHERE A PRACTICE EXAM IS KEPT, with its mark schemes, between writing it and marking it: blob storage
 * (`practice/exam/<examId>.json`) in production or with PRACTICE_STORE=blob, else a folder on this machine
 * (`.canvas-cache/practice/exam`, gitignored). Requests from this machine to Azure stall at times while developing
 * (the capture store moved to disk for the same reason). This process also keeps each exam in memory, so the route
 * that wrote it reads it back at once.
 */
const DISK = path.join(process.cwd(), ".canvas-cache", "practice", "exam");
const KEY = Symbol.for("aria.practiceExams");
const g = globalThis as unknown as Record<symbol, Map<string, StoredExam>>;
const memory: Map<string, StoredExam> = g[KEY] ?? new Map();
g[KEY] = memory;

export const examBlobName = (id: string) => `practice/exam/${id}.json`;

function inBlob(): boolean {
  const wanted = process.env.PRACTICE_STORE ?? (process.env.NODE_ENV === "production" ? "blob" : "disk");
  return wanted === "blob" && blobStorageConfigured();
}

function remember(exam: StoredExam) {
  memory.delete(exam.id);
  memory.set(exam.id, exam);
  while (memory.size > 200) memory.delete(memory.keys().next().value!);
}

export async function saveExam(exam: StoredExam): Promise<void> {
  if (!EXAM_ID.test(exam.id)) throw new Error("Invalid exam id.");
  remember(exam);
  if (inBlob()) {
    await uploadJsonBlob(examBlobName(exam.id), exam);
    return;
  }
  await mkdir(DISK, { recursive: true });
  const file = path.join(DISK, `${exam.id}.json`);
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(exam));
  await rename(temp, file);
}

export async function loadExam(id: string): Promise<StoredExam | null> {
  if (!EXAM_ID.test(id)) return null;
  const hit = memory.get(id);
  if (hit) return hit;
  try {
    const exam = inBlob() ? await downloadJsonBlob<StoredExam>(examBlobName(id)) : (JSON.parse(await readFile(path.join(DISK, `${id}.json`), "utf8")) as StoredExam);
    if (exam?.id !== id) return null;
    remember(exam);
    return exam;
  } catch {
    return null;
  }
}
