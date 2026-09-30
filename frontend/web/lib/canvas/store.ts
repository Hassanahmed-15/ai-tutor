import "server-only";

import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { blobStorageConfigured, lectureBlobContainer, uploadJsonBlob, uploadRawBlob } from "../blobStorage";
import type { Beat } from "../lessonContent";

/**
 * Where canvas lectures and their pictures live.
 *
 * Production: the private lecture blob container, under the student's own prefix
 * (`users/<id>/canvas/…`), so a student can only ever list, open or see the pictures of their own
 * lectures — every read goes through the signed-in user's id. Container Apps' disk is per replica
 * and wiped on every revision, so it is never used there.
 *
 * Development: `.canvas-cache` on disk (git-ignored), one user, so the preview works without
 * storage credentials and replays cost nothing. CANVAS_STORE=blob forces blob locally.
 */

export type CanvasLecture = {
  id: string;
  topic: string;
  title: string;
  beats: Beat[];
  costUsd: number;
  createdAt: string;
  ms: number;
  /** Per board: which model call produced it and how long each step took. */
  log: string[];
};

export type CanvasLectureSummary = { id: string; title: string; topic: string; createdAt: string };

const CACHE_DIR = path.join(process.cwd(), ".canvas-cache");
const SAFE = /^[a-zA-Z0-9_-]{1,120}$/;

function blobBacked(): boolean {
  if (process.env.CANVAS_STORE === "disk") return false;
  if (process.env.CANVAS_STORE === "blob") return true;
  return process.env.NODE_ENV === "production" && blobStorageConfigured();
}

/** Production without blob storage cannot keep a lecture past the request that made it. */
export function canvasStoreReady(): boolean {
  return blobBacked() || process.env.NODE_ENV !== "production";
}

const lectureBlob = (userId: string, id: string) => `users/${userId}/canvas/lectures/${id}.json`;
const imageBlob = (userId: string, name: string) => `users/${userId}/canvas/images/${name}.jpg`;

function check(...parts: string[]) {
  for (const p of parts) if (!SAFE.test(p)) throw new Error("invalid id");
}

export async function saveCanvasLecture(userId: string, lecture: CanvasLecture): Promise<void> {
  check(userId, lecture.id);
  if (blobBacked()) {
    await uploadJsonBlob(lectureBlob(userId, lecture.id), lecture);
    return;
  }
  await mkdir(path.join(CACHE_DIR, "lectures"), { recursive: true });
  await writeFile(path.join(CACHE_DIR, "lectures", `${lecture.id}.json`), JSON.stringify(lecture, null, 2));
}

export async function loadCanvasLecture(userId: string, id: string): Promise<CanvasLecture | null> {
  try {
    check(userId, id);
    if (blobBacked()) {
      const container = await lectureBlobContainer();
      const buffer = await container.getBlobClient(lectureBlob(userId, id)).downloadToBuffer();
      return JSON.parse(buffer.toString("utf8")) as CanvasLecture;
    }
    return JSON.parse(await readFile(path.join(CACHE_DIR, "lectures", `${id}.json`), "utf8")) as CanvasLecture;
  } catch {
    return null;
  }
}

/** The student's lectures, newest first, with when each was made (for the list and the daily cap). */
export async function listCanvasLectures(userId: string, limit = 12): Promise<CanvasLectureSummary[]> {
  try {
    check(userId);
    if (blobBacked()) {
      const container = await lectureBlobContainer();
      const found: Array<{ id: string; at: number }> = [];
      for await (const blob of container.listBlobsFlat({ prefix: `users/${userId}/canvas/lectures/` })) {
        const id = blob.name.split("/").pop()!.replace(/\.json$/, "");
        found.push({ id, at: blob.properties.createdOn?.getTime() ?? 0 });
      }
      const recent = found.sort((a, b) => b.at - a.at).slice(0, limit);
      const loaded = await Promise.all(recent.map((r) => loadCanvasLecture(userId, r.id)));
      return loaded.filter((l): l is CanvasLecture => Boolean(l)).map(summary);
    }
    const dir = path.join(CACHE_DIR, "lectures");
    const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
    const withTimes = await Promise.all(files.map(async (f) => ({ f, t: (await stat(path.join(dir, f))).mtimeMs })));
    const recent = withTimes.sort((a, b) => b.t - a.t).slice(0, limit);
    const loaded = await Promise.all(recent.map(({ f }) => loadCanvasLecture(userId, f.replace(/\.json$/, ""))));
    return loaded.filter((l): l is CanvasLecture => Boolean(l)).map(summary);
  } catch {
    return [];
  }
}

const summary = (l: CanvasLecture): CanvasLectureSummary => ({ id: l.id, title: l.title, topic: l.topic, createdAt: l.createdAt });

/** How many lectures this student has generated in the last 24 hours. */
export async function canvasLecturesToday(userId: string): Promise<number> {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  return (await listCanvasLectures(userId, 100)).filter((l) => Date.parse(l.createdAt) >= since).length;
}

export async function saveCanvasImage(userId: string, name: string, jpeg: Buffer): Promise<void> {
  check(userId, name);
  if (blobBacked()) return uploadRawBlob(imageBlob(userId, name), jpeg, "image/jpeg");
  await mkdir(path.join(CACHE_DIR, "images"), { recursive: true });
  await writeFile(path.join(CACHE_DIR, "images", `${name}.jpg`), jpeg);
}

export async function loadCanvasImage(userId: string, name: string): Promise<Buffer | null> {
  try {
    check(userId, name);
    if (blobBacked()) {
      const container = await lectureBlobContainer();
      return await container.getBlobClient(imageBlob(userId, name)).downloadToBuffer();
    }
    return await readFile(path.join(CACHE_DIR, "images", `${name}.jpg`));
  } catch {
    return null;
  }
}
