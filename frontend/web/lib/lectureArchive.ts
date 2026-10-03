import "server-only";

import { randomUUID } from "node:crypto";
import {
  downloadJsonBlob,
  lecturePackageBlobName,
  lectureVideoBlobName,
  progressiveLectureInputBlobName,
  uploadJsonBlob,
  uploadVideoBlob,
} from "./blobStorage";
import {
  ensureContainers,
  lectures,
  type LectureDoc,
  type LectureMode,
  type LectureSourceType,
  type LectureVideoDoc,
} from "./db/cosmos";
import type { Beat } from "./lessonContent";
import { looksLikeTitle } from "./pdfFocus";
import { stripLineMarks } from "./beatPresentation";
import type { LearnerProfileSnapshot } from "./progressiveLectureTypes";
import { selectAnimationRenderer } from "./animationRouting";
import {
  manimCacheKey,
  readCachedVideo,
  renderBeat,
  type ManimQuality,
} from "./manimRender";

export type LecturePackage = {
  schemaVersion: 1 | 2;
  lectureId: string;
  userId: string;
  topic: string;
  sourceType: LectureSourceType;
  mode: LectureMode;
  learnerProfile?: LearnerProfileSnapshot;
  createdAt: string;
  updatedAt: string;
  beats: Beat[];
  manimVideos: LectureVideoDoc[];
  videoErrors: Array<{ id: string; beatIds: string[]; message: string }>;
  /**
   * A video lecture's source (lib/youtube/videoSource.ts): its key points and its whole transcript,
   * so a replay's chat knows the video as the live lesson's did. Only saved for sourceType "youtube".
   */
  sourceDocument?: unknown;
};

export type LectureHistoryItem = Pick<
  LectureDoc,
  | "id"
  | "topic"
  | "sourceType"
  | "mode"
  | "status"
  | "beatCount"
  | "manimVideoCount"
  | "createdAt"
  | "updatedAt"
  | "error"
>;

type VideoTarget = {
  id: string;
  beatIds: string[];
  script: unknown;
};

function cloneBeats(beats: Beat[]): Beat[] {
  // A lecture package is JSON by definition. Cloning through JSON also guarantees that what is
  // returned to replay is exactly what Blob Storage received, without shared mutable references.
  return JSON.parse(JSON.stringify(beats)) as Beat[];
}

function configuredQuality(): ManimQuality {
  const value = process.env.MANIM_RENDER_QUALITY;
  return value === "low" || value === "high" ? value : "medium";
}

export function normalizeLectureSourceType(value: unknown): LectureSourceType {
  return value === "pdf" || value === "pptx" || value === "suprnotes" || value === "task-folder" || value === "youtube"
    ? value
    : "prompt";
}

export function normalizeLectureMode(value: unknown): LectureMode {
  return value === "blind" || value === "low-vision" || value === "adhd" || value === "dyslexia" || value === "deaf"
    ? value
    : "standard";
}

function collectVideoTargets(beats: Beat[], quality: ManimQuality): VideoTarget[] {
  if (process.env.MANIM_RENDER_ENABLED !== "1") return [];

  const byId = new Map<string, VideoTarget>();
  for (const beat of beats) {
    if (!beat.draw) continue;
    const selected = selectAnimationRenderer(beat.draw, {
      gsapEnabled: process.env.NEXT_PUBLIC_GSAP_RENDER_ENABLED !== "0",
      manimEnabled: true,
    });
    if (selected.renderer !== "manim") continue;

    const id = manimCacheKey(beat.draw, quality);
    const existing = byId.get(id);
    if (existing) existing.beatIds.push(beat.id);
    else byId.set(id, { id, beatIds: [beat.id], script: beat.draw });
  }
  return [...byId.values()];
}

function videoUrl(lectureId: string, videoId: string): string {
  return `/api/lectures/${encodeURIComponent(lectureId)}/videos/${encodeURIComponent(videoId)}`;
}

function withStoredVideoUrls(
  beats: Beat[],
  lectureId: string,
  videos: LectureVideoDoc[],
): Beat[] {
  const byBeat = new Map<string, string>();
  for (const video of videos) {
    for (const beatId of video.beatIds) byBeat.set(beatId, video.id);
  }
  return cloneBeats(beats).map((beat) => {
    const id = byBeat.get(beat.id);
    return id ? { ...beat, manimVideoUrl: videoUrl(lectureId, id) } : beat;
  });
}

async function replaceLecture(doc: LectureDoc): Promise<void> {
  await lectures().item(doc.id, doc.userId).replace(doc);
}

export type ArchivedLecture = {
  lectureId: string;
  /** Completes the CPU-heavy video portion after the replay package is already durable. */
  finishVideos: () => Promise<void>;
};

/**
 * Writes the replayable JSON package before returning. Video rendering is exposed as a second
 * phase so the generation job can finish promptly while the existing warm worker pool renders all
 * eligible beats concurrently in the background.
 */
/**
 * WHAT A LECTURE IS CALLED IN HISTORY. A lecture's stored topic was once whatever line an upload's
 * OCR produced — "(a) (b)", "dled automatically.", "these alternatives are poor options." When the
 * topic cannot name anything, the lecture is called by its first part that can ("Binary Search
 * Trees"). A good topic is kept as it is.
 */
export function lectureDisplayTitle(topic: string, beatTitles: string[]): string {
  const cleaned = stripLineMarks(topic ?? "");
  if (looksLikeTitle(cleaned)) return cleaned;
  for (const raw of beatTitles) {
    const title = stripLineMarks((raw ?? "").replace(/\s*\((?:part|pt\.?)\s*\d+\)\s*$/i, "")).replace(/[.:;,]+$/, "");
    if (!/^questions?\b/i.test(title) && looksLikeTitle(title)) return title;
  }
  return cleaned || topic;
}

export async function archiveLecture(input: {
  /** Optional stable id for idempotent queue-driven finalization. */
  lectureId?: string;
  userId: string;
  topic: string;
  sourceType: LectureSourceType;
  mode: LectureMode;
  beats: Beat[];
  learnerProfile?: LearnerProfileSnapshot;
  /** Kept with the lecture only for a YouTube lecture; see LecturePackage.sourceDocument. */
  sourceDocument?: unknown;
}): Promise<ArchivedLecture> {
  await ensureContainers();

  const lectureId = input.lectureId ?? randomUUID();
  const now = new Date().toISOString();
  const packageBlobName = lecturePackageBlobName(input.userId, lectureId);
  input = { ...input, topic: lectureDisplayTitle(input.topic, input.beats.map((beat) => beat.title ?? "")) };
  const quality = configuredQuality();
  const targets = collectVideoTargets(input.beats, quality);
  const initialPackage: LecturePackage = {
    schemaVersion: input.learnerProfile ? 2 : 1,
    lectureId,
    userId: input.userId,
    topic: input.topic,
    sourceType: input.sourceType,
    mode: input.mode,
    learnerProfile: input.learnerProfile,
    createdAt: now,
    updatedAt: now,
    beats: cloneBeats(input.beats),
    manimVideos: [],
    videoErrors: [],
    ...(input.sourceType === "youtube" && input.sourceDocument ? { sourceDocument: input.sourceDocument } : {}),
  };

  let doc: LectureDoc = {
    id: lectureId,
    userId: input.userId,
    topic: input.topic,
    sourceType: input.sourceType,
    mode: input.mode,
    learnerProfile: input.learnerProfile,
    packageBlobName,
    status: targets.length > 0 ? "processing-videos" : "ready",
    beatCount: input.beats.length,
    packageBytes: 0,
    manimVideoCount: 0,
    manimVideos: [],
    createdAt: now,
    updatedAt: now,
    error: null,
  };

  await lectures().items.upsert(doc);
  try {
    const packageBytes = await uploadJsonBlob(packageBlobName, initialPackage);
    doc = { ...doc, packageBytes };
    await replaceLecture(doc);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Lecture package upload failed.";
    await replaceLecture({
      ...doc,
      status: "failed",
      updatedAt: new Date().toISOString(),
      error: message.slice(0, 500),
    }).catch(() => {});
    throw error;
  }

  return {
    lectureId,
    finishVideos: async () => {
      if (targets.length === 0) return;

      const results = await Promise.all(
        targets.map(async (target) => {
          try {
            const render = await renderBeat(target.script, quality);
            const bytes = await readCachedVideo(target.id);
            if (!bytes) throw new Error("Rendered video was not found in the local cache.");
            const blobName = lectureVideoBlobName(input.userId, lectureId, target.id);
            await uploadVideoBlob(blobName, bytes, {
              durationMs: render.durationMs,
              cacheId: target.id,
            });
            const video: LectureVideoDoc = {
              id: target.id,
              beatIds: target.beatIds,
              blobName,
              durationMs: render.durationMs,
              bytes: render.bytes,
            };
            return { ok: true as const, video };
          } catch (error) {
            return {
              ok: false as const,
              error: {
                id: target.id,
                beatIds: target.beatIds,
                message: (error instanceof Error ? error.message : "Video persistence failed.").slice(0, 500),
              },
            };
          }
        }),
      );

      const videos = results.flatMap((result) => (result.ok ? [result.video] : []));
      const videoErrors = results.flatMap((result) => (result.ok ? [] : [result.error]));
      const updatedAt = new Date().toISOString();
      const finalPackage: LecturePackage = {
        ...initialPackage,
        updatedAt,
        beats: withStoredVideoUrls(input.beats, lectureId, videos),
        manimVideos: videos,
        videoErrors,
      };

      try {
        const packageBytes = await uploadJsonBlob(packageBlobName, finalPackage);
        await replaceLecture({
          ...doc,
          packageBytes,
          status: videoErrors.length > 0 ? "ready-with-errors" : "ready",
          manimVideoCount: videos.length,
          manimVideos: videos,
          updatedAt,
          error: videoErrors.length > 0 ? `${videoErrors.length} video render(s) failed.` : null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Lecture video index update failed.";
        await replaceLecture({
          ...doc,
          status: "ready-with-errors",
          manimVideoCount: videos.length,
          manimVideos: videos,
          updatedAt,
          error: message.slice(0, 500),
        }).catch(() => {});
        throw error;
      }
    },
  };
}

export async function listLecturesForUser(userId: string, limit = 30): Promise<LectureHistoryItem[]> {
  await ensureContainers();
  const { resources } = await lectures().items
    .query<LectureHistoryItem>(
      {
        query: `SELECT c.id, c.topic, c.sourceType, c.mode, c.status, c.beatCount, c.manimVideoCount, c.createdAt, c.updatedAt, c.error, c.packageBlobName
                FROM c WHERE c.userId = @userId ORDER BY c.createdAt DESC OFFSET 0 LIMIT @limit`,
        parameters: [
          { name: "@userId", value: userId },
          { name: "@limit", value: Math.max(1, Math.min(limit, 100)) },
        ],
      },
      { partitionKey: userId },
    )
    .fetchAll();
  /*
   * Lectures saved before titles were checked: only those whose topic cannot name anything have
   * their package read, for its part titles. Nothing stored is rewritten; a package that cannot be
   * read keeps the old name.
   */
  const rows = resources as Array<LectureHistoryItem & { packageBlobName?: string }>;
  return Promise.all(rows.map(async ({ packageBlobName, ...item }) => {
    if (looksLikeTitle(stripLineMarks(item.topic ?? "")) || !packageBlobName) return { ...item, topic: stripLineMarks(item.topic ?? "") || item.topic };
    try {
      const lecturePackage = await downloadJsonBlob<LecturePackage>(packageBlobName);
      return { ...item, topic: lectureDisplayTitle(item.topic, (lecturePackage.beats ?? []).map((beat) => beat.title ?? "")) };
    } catch {
      return item;
    }
  }));
}

/**
 * How many lectures this learner actually has.
 *
 * The list above stops at `limit`, so counting what it returned reported "30 saved" to anyone with
 * more than thirty — the number was a page size wearing a total's clothes. This counts the rows.
 */
export async function countLecturesForUser(userId: string): Promise<number> {
  await ensureContainers();
  const { resources } = await lectures().items
    .query<number>(
      { query: "SELECT VALUE COUNT(1) FROM c WHERE c.userId = @userId", parameters: [{ name: "@userId", value: userId }] },
      { partitionKey: userId },
    )
    .fetchAll();
  return typeof resources[0] === "number" ? resources[0] : 0;
}

export async function lectureForUser(userId: string, lectureId: string): Promise<LectureDoc | null> {
  await ensureContainers();
  const { resource } = await lectures().item(lectureId, userId).read<LectureDoc>();
  return resource ?? null;
}

export async function packageForUser(userId: string, lectureId: string): Promise<LecturePackage | null> {
  const doc = await lectureForUser(userId, lectureId);
  if (!doc || doc.status === "failed") return null;
  const lecturePackage = await downloadJsonBlob<LecturePackage>(doc.packageBlobName);
  if (lecturePackage.userId !== userId || lecturePackage.lectureId !== lectureId) return null;
  /*
   * A video lecture saved before its source was kept with it: the source is still in the input its
   * progressive session was built from (a progressive lecture's id is its session id). Best effort —
   * a miss just leaves the replay's chat with the slides alone, as before.
   */
  if (lecturePackage.sourceType === "youtube" && !lecturePackage.sourceDocument) {
    const input = await downloadJsonBlob<{ suprnotes?: unknown }>(progressiveLectureInputBlobName(userId, lectureId)).catch(() => null);
    if (input?.suprnotes) lecturePackage.sourceDocument = input.suprnotes;
  }
  // Packages written before mode tracking remain replayable and are accurately labelled Standard:
  // that was the only generated visual mode the old archive path could produce.
  return {
    ...lecturePackage,
    topic: lectureDisplayTitle(lecturePackage.topic, (lecturePackage.beats ?? []).map((beat) => beat.title ?? "")),
    mode: lecturePackage.mode ?? doc.mode ?? "standard",
  };
}
