import "server-only";

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { blobStorageConfigured, downloadJsonBlob, uploadJsonBlob } from "../blobStorage";

/**
 * What a video was read as, kept so the same video is never read twice.
 *
 * Reading is the slow and metered part of a video lecture: about 55,000 input tokens per ten
 * minutes, against a free-tier allowance of eight hours of YouTube video a day. The reading of a
 * given clip by a given model does not change, so it is stored under the video's id — in the
 * lecture blob container where one is configured (shared by every instance), otherwise in the
 * machine's temp directory, which is enough for development.
 *
 * A miss is ordinary and silent, and so is a failed write: the cache only ever saves work.
 */

const SAFE = /^[A-Za-z0-9_-]+$/;

function blobName(videoId: string, name: string): string {
  if (!SAFE.test(videoId) || !SAFE.test(name)) throw new Error("Invalid video cache key.");
  return `youtube/${videoId}/${name}.json`;
}

function localPath(videoId: string, name: string): string {
  return path.join(os.tmpdir(), "aria-youtube-cache", videoId, `${name}.json`);
}

export async function readVideoCache<T>(videoId: string, name: string): Promise<T | null> {
  try {
    if (blobStorageConfigured()) return await downloadJsonBlob<T>(blobName(videoId, name));
    return JSON.parse(await fs.readFile(localPath(videoId, name), "utf8")) as T;
  } catch {
    return null;
  }
}

export async function writeVideoCache(videoId: string, name: string, value: unknown): Promise<void> {
  try {
    if (blobStorageConfigured()) {
      await uploadJsonBlob(blobName(videoId, name), value);
      return;
    }
    const file = localPath(videoId, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(value), "utf8");
  } catch (error) {
    console.warn(`[youtube] cache write failed for ${videoId}/${name}: ${error instanceof Error ? error.message : error}`);
  }
}
