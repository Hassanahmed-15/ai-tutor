import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { getJson, putJson, removeFiles } from "./store";
import { CAPTURE_TTL_MS, MAX_PHOTOS, hashToken, isExpired, tokenMatches, type CaptureSession, type SlotRecord, type CapturePurpose } from "./rules";

/**
 * A PHONE CAPTURE SESSION (the QR code's other end). Every file is under `<id>/`:
 *   session.json            who it is for, the token's hash, expiry — written once
 *   slot-<n>.json           that photo's state; only the photo upload and its own read write it
 *   p<n>-v<k>.jpg …         the photo's versions (straightened page, vision copy, thumb) and its read result
 *   connected/sent/cancelled.json, order.json   markers, each with one writer
 * A session never has one mutable file two requests write at once.
 */

export type CaptureMarker = "connected" | "sent" | "cancelled";

export const names = {
  session: (id: string) => `${id}/session.json`,
  slot: (id: string, n: number) => `${id}/slot-${n}.json`,
  marker: (id: string, m: CaptureMarker) => `${id}/${m}.json`,
  order: (id: string) => `${id}/order.json`,
  page: (id: string, n: number, v: number) => `${id}/p${n}-v${v}.jpg`,
  vision: (id: string, n: number, v: number) => `${id}/p${n}-v${v}-vision.jpg`,
  thumb: (id: string, n: number, v: number) => `${id}/p${n}-v${v}-thumb.jpg`,
  result: (id: string, n: number, v: number) => `${id}/p${n}-v${v}-result.json`,
};

const ID = /^[0-9a-f-]{36}$/;

export async function createSession(userId: string, spendTag: string | null, purpose: CapturePurpose = "lesson"): Promise<{ session: CaptureSession; token: string }> {
  const token = randomBytes(16).toString("base64url");
  const now = Date.now();
  const session: CaptureSession = { id: randomUUID(), userId, spendTag, tokenHash: hashToken(token), createdAt: now, expiresAt: now + CAPTURE_TTL_MS, ...(purpose === "answers" ? { purpose } : {}) };
  await putJson(names.session(session.id), session, { immutable: true });
  return { session, token };
}

export async function loadSession(id: string): Promise<CaptureSession | null> {
  if (!ID.test(id)) return null;
  return getJson<CaptureSession>(names.session(id));
}

/** The session the phone may write to: its token matches, it has not expired and was not cancelled. */
export async function phoneSession(id: string, token: string | null): Promise<{ session: CaptureSession } | { error: string; status: number }> {
  const session = await loadSession(id);
  if (!session || !tokenMatches(token, session.tokenHash)) return { error: "This code is not valid.", status: 404 };
  if (isExpired(session)) return { error: "This code has expired. Ask for a new one on your computer.", status: 410 };
  if (await hasMarker(id, "cancelled")) return { error: "This capture was closed on the computer.", status: 410 };
  return { session };
}

/** The session the signed-in student owns. */
export async function ownerSession(id: string, userId: string): Promise<CaptureSession | null> {
  const session = await loadSession(id);
  return session && session.userId === userId ? session : null;
}

export async function readSlot(id: string, n: number): Promise<SlotRecord | null> {
  return getJson<SlotRecord>(names.slot(id, n));
}

export async function writeSlot(id: string, slot: SlotRecord): Promise<void> {
  await putJson(names.slot(id, slot.n), slot);
}

export async function allSlots(id: string): Promise<SlotRecord[]> {
  const found = await Promise.all(Array.from({ length: MAX_PHOTOS }, (_, i) => readSlot(id, i + 1)));
  return found.filter((s): s is SlotRecord => Boolean(s));
}

export async function setMarker(id: string, marker: CaptureMarker): Promise<void> {
  await putJson(names.marker(id, marker), { at: Date.now() });
}

export async function hasMarker(id: string, marker: CaptureMarker): Promise<boolean> {
  return Boolean(await getJson(names.marker(id, marker)));
}

export async function readOrder(id: string): Promise<number[]> {
  const o = await getJson<{ order?: unknown }>(names.order(id));
  return Array.isArray(o?.order) ? o!.order.map(Number).filter((n) => Number.isInteger(n)) : [];
}

export async function writeOrder(id: string, order: number[]): Promise<void> {
  await putJson(names.order(id), { order });
}

/** Everything the session wrote, deleted (finish or cancel). Every name is known: nothing is listed. */
export async function deleteSession(id: string, slots: SlotRecord[], options: { keepRecord?: boolean } = {}): Promise<void> {
  // keepRecord: the photos go, the small session record stays (expired by its own clock), so a phone still open
  // learns the pages were used instead of "this code is not valid".
  const files = options.keepRecord ? [names.order(id)] : [names.session(id), names.order(id), names.marker(id, "connected"), names.marker(id, "sent"), names.marker(id, "cancelled")];
  for (const s of slots) {
    files.push(names.slot(id, s.n));
    for (let v = 1; v <= s.version; v++) files.push(names.page(id, s.n, v), names.vision(id, s.n, v), names.thumb(id, s.n, v), names.result(id, s.n, v));
  }
  await removeFiles(files);
}

/** What the computer and the phone both poll. */
export async function captureStatus(id: string, session: CaptureSession) {
  const [slots, order, connected, sent, cancelled] = await Promise.all([allSlots(id), readOrder(id), hasMarker(id, "connected"), hasMarker(id, "sent"), hasMarker(id, "cancelled")]);
  const status = cancelled ? "cancelled" : isExpired(session) && !sent ? "expired" : sent ? "sent" : connected ? "connected" : "waiting";
  return {
    status,
    purpose: session.purpose ?? "lesson",
    expiresAt: session.expiresAt,
    order,
    slots: slots.filter((s) => s.state !== "deleted").map((s) => ({ n: s.n, version: s.version, state: s.state, problem: s.problem ?? null, error: s.error ?? null })),
  };
}
