import { createHash, timingSafeEqual } from "node:crypto";

/**
 * THE PHONE CAPTURE'S RULES (pure, unit-tested in lib/anim/capture.test.ts): how long a QR code works, how many
 * photos it takes, what a photo must be, what counts as a bad shot, and how the phone's token is checked.
 */

export const CAPTURE_TTL_MS = 15 * 60_000;
export const MAX_PHOTOS = 6;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

export type SlotState = "reading" | "ready" | "failed" | "held" | "deleted";
export type PhotoProblem = "blurry" | "dark" | "no-page";

export type CaptureSession = {
  id: string;
  userId: string;
  /** The lesson's spend tag (lib/spendTag.ts): the photos' reading is filed under it. */
  spendTag: string | null;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  /**
   * What the pages are for (2026-11-27): "lesson" (taught like a PDF, the default) or "answers" (a practice test's
   * paper answers, marked by Aria). Only the phone's wording changes. Absent on sessions made before it existed.
   */
  purpose?: CapturePurpose;
};

export type CapturePurpose = "lesson" | "answers";

export type SlotRecord = {
  n: number;
  /** Raised on every new photo in this slot: a read of an older photo can never mark the slot ready. */
  version: number;
  state: SlotState;
  problem?: PhotoProblem | null;
  error?: string | null;
  startedAt: number;
  width?: number;
  height?: number;
};

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Constant-time: a wrong token takes as long to refuse as a nearly right one. */
export function tokenMatches(token: string | null | undefined, tokenHash: string): boolean {
  if (!token || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) return false;
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(tokenHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export const isExpired = (session: Pick<CaptureSession, "expiresAt">, now = Date.now()) => now > session.expiresAt;

export const validSlot = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_PHOTOS;

/** JPEG or PNG, by their first bytes (the type a phone claims is not trusted). */
export function imageKind(bytes: Uint8Array): "jpeg" | "png" | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  return null;
}

/**
 * What is wrong with a shot, from the straightener's measurements (scripts/pdf_pipeline.py photo): too dark to
 * read, too blurry, or no page in it. Measured on a 1000 px copy; the thresholds are a sharp printed page's.
 * A blurry shot is still read (the student may keep it); a dark one or one with no page is held until they
 * say "use anyway", so nothing is spent on a photo of the desk.
 */
export function photoProblem(m: { sharpness: number; brightness: number; pageFound: boolean }): PhotoProblem | null {
  if (m.brightness < 55) return "dark";
  if (m.sharpness < 45) return "blurry";
  if (!m.pageFound && m.sharpness < 120) return "no-page";
  return null;
}

/** The slots in the student's order: their chosen order first, then any other live slot by number. */
export function slotsInOrder(slots: SlotRecord[], order: number[] | null | undefined): SlotRecord[] {
  const live = slots.filter((s) => s.state !== "deleted");
  const byN = new Map(live.map((s) => [s.n, s]));
  const out: SlotRecord[] = [];
  for (const n of order ?? []) { const s = byN.get(n); if (s && !out.includes(s)) out.push(s); }
  for (const s of [...live].sort((a, b) => a.n - b.n)) if (!out.includes(s)) out.push(s);
  return out;
}
