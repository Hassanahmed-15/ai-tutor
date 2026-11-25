import "server-only";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { blobStorageConfigured, deleteBlob, downloadRawBlob, uploadRawBlob } from "@/lib/blobStorage";

/**
 * WHERE A PHONE CAPTURE IS KEPT. Blob storage when it is configured — production runs several web replicas, and
 * the phone's uploads and the computer's checks can reach different ones — else a folder on this machine
 * (`.capture-cache`, development without storage). Files that never change after they are written (the session,
 * photos, read results) are also kept in this process's memory, so a replica reads its own writes at once; a
 * slot's state is always read fresh.
 */
const DISK = path.join(process.cwd(), ".capture-cache");
const CACHE_KEY = Symbol.for("aria.captureCache");
const globalRef = globalThis as unknown as Record<symbol, Map<string, { at: number; body: Buffer }>>;
const cache: Map<string, { at: number; body: Buffer }> = globalRef[CACHE_KEY] ?? new Map();
globalRef[CACHE_KEY] = cache;
const CACHE_MS = 30 * 60_000;
const CACHE_MAX = 400;

const blobName = (name: string) => `capture/${name}`;

/**
 * Blob in production only (or with CAPTURE_STORE=blob). While developing, phone and computer reach this one process,
 * and every poll, photo and result went to Azure and back over the PC's own connection: 11–50 s to "send" a photo
 * and a status read every second from each device (2026-11-25). `.capture-cache` on disk answers in milliseconds.
 */
function storeInBlob(): boolean {
  const wanted = process.env.CAPTURE_STORE ?? (process.env.NODE_ENV === "production" ? "blob" : "disk");
  return wanted === "blob" && blobStorageConfigured();
}

function remember(name: string, body: Buffer) {
  const now = Date.now();
  for (const [key, entry] of cache) if (now - entry.at > CACHE_MS) cache.delete(key);
  while (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(name, { at: now, body });
}

export async function putFile(name: string, body: Buffer, contentType: string, options: { immutable?: boolean } = {}): Promise<void> {
  if (options.immutable) remember(name, body);
  else cache.delete(name);
  if (storeInBlob()) return uploadRawBlob(blobName(name), body, contentType);
  const file = path.join(DISK, name);
  await mkdir(path.dirname(file), { recursive: true });
  // Written beside it and renamed into place, so a poll never reads a slot half-written.
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, body);
  await rename(temp, file).catch(async () => {
    await writeFile(file, body);
    await rm(temp, { force: true }).catch(() => undefined);
  });
}

export async function getFile(name: string): Promise<Buffer | null> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;
  if (storeInBlob()) {
    try {
      return await downloadRawBlob(blobName(name));
    } catch {
      // Read while it was being rewritten ("Stream drains before getting enough data": a slot's 116 bytes became 118
      // mid-read, and the status poll answered 500). Once more, a moment later; a second failure is real.
      await new Promise((resolve) => setTimeout(resolve, 200));
      return downloadRawBlob(blobName(name));
    }
  }
  return readFile(path.join(DISK, name)).catch(() => null);
}

export async function putJson(name: string, value: unknown, options: { immutable?: boolean } = {}): Promise<void> {
  await putFile(name, Buffer.from(JSON.stringify(value), "utf8"), "application/json; charset=utf-8", options);
}

export async function getJson<T>(name: string): Promise<T | null> {
  const body = await getFile(name);
  if (!body) return null;
  try {
    return JSON.parse(body.toString("utf8")) as T;
  } catch {
    return null;
  }
}

export async function removeFiles(names: string[]): Promise<void> {
  for (const name of names) cache.delete(name);
  if (storeInBlob()) {
    await Promise.all(names.map((name) => deleteBlob(blobName(name)).catch(() => undefined)));
    return;
  }
  await Promise.all(names.map((name) => rm(path.join(DISK, name), { force: true }).catch(() => undefined)));
}
