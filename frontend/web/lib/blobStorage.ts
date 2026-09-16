import "server-only";

import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob";

const globalForBlob = globalThis as unknown as {
  ariaBlobContainer?: ContainerClient;
  ariaBlobContainerReady?: Promise<ContainerClient>;
};

function configuredContainer(): ContainerClient {
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  const containerName = process.env.AZURE_STORAGE_CONTAINER;
  if (!connectionString) throw new Error("AZURE_STORAGE_CONNECTION_STRING is not set.");
  if (!containerName) throw new Error("AZURE_STORAGE_CONTAINER is not set.");

  if (!globalForBlob.ariaBlobContainer) {
    globalForBlob.ariaBlobContainer = BlobServiceClient.fromConnectionString(connectionString)
      .getContainerClient(containerName);
  }
  return globalForBlob.ariaBlobContainer;
}

export function blobStorageConfigured(): boolean {
  return Boolean(process.env.AZURE_STORAGE_CONNECTION_STRING && process.env.AZURE_STORAGE_CONTAINER);
}

/** The container is private; callers receive bytes only after application-level auth checks. */
export async function lectureBlobContainer(): Promise<ContainerClient> {
  if (!globalForBlob.ariaBlobContainerReady) {
    globalForBlob.ariaBlobContainerReady = (async () => {
      const container = configuredContainer();
      await container.createIfNotExists();
      return container;
    })().catch((error) => {
      // A transient startup failure must be retryable on the next request.
      globalForBlob.ariaBlobContainerReady = undefined;
      throw error;
    });
  }
  return globalForBlob.ariaBlobContainerReady;
}

function requireSafeSegment(value: string, label: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

export function lecturePackageBlobName(userId: string, lectureId: string): string {
  return `users/${requireSafeSegment(userId, "user id")}/lectures/${requireSafeSegment(lectureId, "lecture id")}/lecture.json`;
}

export function lectureVideoBlobName(userId: string, lectureId: string, videoId: string): string {
  return `users/${requireSafeSegment(userId, "user id")}/lectures/${requireSafeSegment(lectureId, "lecture id")}/manim/${requireSafeSegment(videoId, "video id")}.mp4`;
}

export async function uploadJsonBlob(blobName: string, value: unknown): Promise<number> {
  const body = Buffer.from(JSON.stringify(value), "utf8");
  const container = await lectureBlobContainer();
  await container.getBlockBlobClient(blobName).uploadData(body, {
    blobHTTPHeaders: {
      blobContentType: "application/json; charset=utf-8",
      blobCacheControl: "private, no-store",
    },
  });
  return body.length;
}

export async function downloadJsonBlob<T>(blobName: string): Promise<T> {
  const container = await lectureBlobContainer();
  const response = await container.getBlobClient(blobName).downloadToBuffer();
  return JSON.parse(response.toString("utf8")) as T;
}

export async function uploadVideoBlob(
  blobName: string,
  body: Buffer,
  metadata: { durationMs: number; cacheId: string },
): Promise<void> {
  const container = await lectureBlobContainer();
  await container.getBlockBlobClient(blobName).uploadData(body, {
    blobHTTPHeaders: {
      blobContentType: "video/mp4",
      blobCacheControl: "private, max-age=31536000, immutable",
    },
    metadata: {
      durationms: String(metadata.durationMs),
      cacheid: metadata.cacheId,
    },
  });
}

export type DownloadedBlobRange = {
  body: Buffer;
  totalBytes: number;
  contentType: string;
};

export async function storedBlobProperties(blobName: string): Promise<{
  totalBytes: number;
  contentType: string;
}> {
  const container = await lectureBlobContainer();
  const properties = await container.getBlobClient(blobName).getProperties();
  return {
    totalBytes: properties.contentLength ?? 0,
    contentType: properties.contentType || "application/octet-stream",
  };
}

/** Downloads only the requested byte interval, preserving seekable video playback. */
export async function downloadBlobRange(
  blobName: string,
  range?: { start: number; end: number },
): Promise<DownloadedBlobRange> {
  const container = await lectureBlobContainer();
  const client = container.getBlobClient(blobName);
  const properties = await client.getProperties();
  const totalBytes = properties.contentLength ?? 0;
  if (totalBytes <= 0) throw new Error("Stored video is empty.");

  const response = range
    ? await client.download(range.start, range.end - range.start + 1)
    : await client.download();
  if (!response.readableStreamBody) throw new Error("Stored video has no readable body.");

  const chunks: Buffer[] = [];
  for await (const chunk of response.readableStreamBody) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return {
    body: Buffer.concat(chunks),
    totalBytes,
    contentType: properties.contentType || "video/mp4",
  };
}
