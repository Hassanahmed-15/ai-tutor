/**
 * TEXT FIRST, VOICE RIGHT AFTER (owner's QA brief, 2026-11-28: measured over ~110 sentences the voice came
 * BEFORE the board text 38–44% of the time, up to 1.4 s early, and with it only half the time).
 *
 * For every sentence, on every board: the sentence's board element starts drawing first, and her voice
 * for it starts TEXT_LEAD_MS later — driven by the moment the writing really starts (TextStartWatch sees
 * it become visible: rendered, faded in, uncovered by the marker), not by a timer, so a slow clip or a heavy
 * board cannot flip the order. If the clip is not ready the text waits for it (the cue is only sent once
 * the clip is in hand); if the text is not drawing yet the voice waits for it, at most TEXT_WAIT_MAX_MS.
 *
 * This replaces the 2026-10-23 order "the pen waits for her voice"; her next sentence still waits (briefly)
 * for the pen to finish the last one (lib/canvas/penClock.ts).
 *
 * Pure rules first (unit-tested: lib/anim/textLead.test.ts), then the one-live-board registry the board
 * reports to and the player reads, then the dev sync logger.
 */

/** How long her voice follows the start of a sentence's writing at 1x (ms). */
export const TEXT_LEAD_MS = 200;
/** The lead never drops below this, however fast the lecture plays (ms). */
export const MIN_TEXT_LEAD_MS = 100;
/** The longest her voice waits for writing that should be starting (ms at 1x): a board that never draws never stops a lecture. */
export const TEXT_WAIT_MAX_MS = 4000;
/** A board not on screen yet (its first render after the cue) is waited for this long before "no writing" is assumed (ms at 1x). */
export const BOARD_MOUNT_WAIT_MS = 900;
/** The dev logger warns when her voice comes more than this long after the writing began (ms). */
export const SYNC_WARN_GAP_MS = 600;
/** How often the narration asks again while it waits (ms). */
export const TEXT_POLL_MS = 30;

const speedOf = (speed: number) => (Number.isFinite(speed) && speed > 0 ? speed : 1);

/** The lead at a playback speed: TEXT_LEAD_MS at 1x, shorter when faster, never under MIN_TEXT_LEAD_MS. */
export function textLeadMs(speed = 1): number {
  return Math.max(MIN_TEXT_LEAD_MS, Math.round(TEXT_LEAD_MS / speedOf(speed)));
}

export type VoiceWaitInput = {
  now: number;
  /** When the sentence's board cue was sent (performance.now()). */
  cuedAt: number;
  /** When its writing became visible, or null while it has not. */
  textStart: number | null;
  /**
   * Does the sentence put anything on the board? false: nothing to wait for — the lead runs from the cue.
   * undefined: the board has not said yet (it is still mounting) — waited for, at most BOARD_MOUNT_WAIT_MS.
   */
  expectsText: boolean | undefined;
  speed: number;
};

/**
 * How long her voice for a sentence must still wait (ms; 0 = say it now). THE ORDERING RULE:
 *   - writing started at T → the voice at T + lead, never before;
 *   - writing expected but not started → keep waiting (a poll), up to TEXT_WAIT_MAX_MS after the cue;
 *   - nothing to write → the lead from the cue (whatever the cue shows — a caption, a slide — comes first).
 */
export function voiceWaitMs({ now, cuedAt, textStart, expectsText, speed }: VoiceWaitInput): number {
  const lead = textLeadMs(speed);
  if (textStart !== null && Number.isFinite(textStart)) return Math.max(0, textStart + lead - now);
  const waited = now - cuedAt;
  const k = speedOf(speed);
  if (expectsText === false || (expectsText === undefined && waited >= BOARD_MOUNT_WAIT_MS / k)) return Math.max(0, cuedAt + lead - now);
  // Waiting for the writing. Given up on at the cap: the lecture goes on (the logger reports it).
  if (waited >= TEXT_WAIT_MAX_MS / Math.max(0.5, Math.min(2, k))) return 0;
  return TEXT_POLL_MS;
}

/**
 * For a line shown on screen as it is spoken (a question card's question, an answer's feedback): her voice
 * may start once the lead has passed since now — the moment the caller put the text up.
 */
export function leadFromNow(speed: number): () => number {
  const shownAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  return () => voiceWaitMs({ now: typeof performance !== "undefined" ? performance.now() : Date.now(), cuedAt: shownAt, textStart: shownAt, expectsText: true, speed });
}

/**
 * Pieces timed to her words inside a sentence (the full board's phrases, lib/canvas/blocks.ts): each
 * sentence's FIRST piece is moved to the sentence's start, so it is written as the sentence is cued — before
 * her voice — instead of a word or two into it. Later pieces still follow her words. Order is kept.
 */
export function leadFirstPieces<T extends { at: number }>(units: T[]): T[] {
  let last = Number.NEGATIVE_INFINITY;
  return units.map((u) => {
    const sentence = Math.floor(u.at);
    if (!Number.isFinite(u.at) || sentence <= last) return u;
    last = sentence;
    return u.at === sentence ? u : { ...u, at: sentence };
  });
}

/** The sentences whose writing starts in these pieces (after leadFirstPieces: at a whole sentence). */
export function pieceSentences(units: Array<{ at: number }>): Set<number> {
  return new Set(units.filter((u) => Number.isFinite(u.at)).map((u) => Math.floor(u.at)));
}

export type SyncVerdict = "ok" | "voice-first" | "late-voice" | "no-text";

/** A sentence's verdict from when its writing and its voice started (ms on one clock). */
export function syncVerdict(textStart: number | null, audioStart: number, maxGap = SYNC_WARN_GAP_MS): SyncVerdict {
  if (textStart === null || !Number.isFinite(textStart)) return "no-text";
  if (audioStart < textStart) return "voice-first";
  if (audioStart - textStart > maxGap) return "late-voice";
  return "ok";
}

/**
 * Text first is always on. A dev build can turn it off with `localStorage["aria.textFirst"] = "0"` — the old
 * order (cue as her voice starts), kept only so the sync probe can measure before and after on one build.
 */
export function textFirstEnabled(): boolean {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem("aria.textFirst") !== "0";
  } catch {
    return true;
  }
}

/*
 * THE LIVE BOARD'S WRITING CLOCK. One live board at a time (the lecture's), like the pen clock: it says
 * which of its sentences put something on it, and reports when each sentence's writing became visible.
 */
type Board = { key: string; expects: (sentence: number) => boolean };
let board: Board | null = null;
const starts = new Map<string, number>();
const startKey = (key: string, sentence: number) => `${key}#${sentence}`;

/** The live board says which of its sentences write something. Returns the unregister. */
export function reportBoardText(key: string, expects: (sentence: number) => boolean): () => void {
  const mine: Board = { key, expects };
  board = mine;
  return () => {
    if (board === mine) board = null;
  };
}

/** Does `sentence` of board `key` write something? undefined when that board is not the live one (yet). */
export function boardExpectsText(key: string, sentence: number): boolean | undefined {
  if (!board || board.key !== key) return undefined;
  try {
    return board.expects(sentence);
  } catch {
    return undefined;
  }
}

/** The writing of `sentence` on board `key` became visible at `t`. The first report wins. */
export function markTextStart(key: string, sentence: number, t: number): void {
  const k = startKey(key, sentence);
  if (starts.has(k)) return;
  starts.set(k, t);
  if (starts.size > 400) starts.delete(starts.keys().next().value as string);
  syncLog("text", key, sentence, t);
}

export function textStartOf(key: string, sentence: number): number | null {
  return starts.get(startKey(key, sentence)) ?? null;
}

/** A sentence about to be cued again (a replay of the board): its writing is drawn, and waited for, anew. */
export function clearTextStart(key: string, sentence: number): void {
  starts.delete(startKey(key, sentence));
}

/*
 * THE DEV SYNC LOGGER. `localStorage["aria.syncDebug"] = "1"` (the flag BlocksView already reads) in a dev
 * build: every sentence's cue, writing start and voice start go to `window.__textVoiceSync`, and a voice
 * that came first, or more than SYNC_WARN_GAP_MS after the writing, is console.warn-ed. Test scripts
 * (scripts/qa/.probe/text-voice-sync.mts) read the records.
 */
export type SyncRecord = { key: string; sentence: number; cueAt?: number; textStart?: number; audioStart?: number; lead?: number; speed?: number; verdict?: SyncVerdict };

function syncDebugOn(): boolean {
  if (process.env.NODE_ENV === "production" || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("aria.syncDebug") === "1";
  } catch {
    return false;
  }
}

function syncLog(kind: "cue" | "text" | "audio", key: string, sentence: number, t: number, speed?: number): void {
  if (!syncDebugOn()) return;
  const w = window as unknown as { __textVoiceSync?: SyncRecord[] };
  const log = (w.__textVoiceSync ??= []);
  // A replay of the sentence starts a new record.
  let rec = [...log].reverse().find((r) => r.key === key && r.sentence === sentence);
  if (!rec || (kind === "cue" && rec.audioStart !== undefined)) {
    rec = { key, sentence };
    log.push(rec);
  }
  if (kind === "cue") rec.cueAt = Math.round(t);
  if (kind === "text" && rec.textStart === undefined) rec.textStart = Math.round(t);
  if (kind === "audio" && rec.audioStart === undefined) {
    rec.audioStart = Math.round(t);
    rec.speed = speed;
    rec.verdict = syncVerdict(rec.textStart ?? null, rec.audioStart);
    if (rec.textStart !== undefined) rec.lead = rec.audioStart - rec.textStart;
    if (rec.verdict === "voice-first" || rec.verdict === "late-voice") {
      console.warn(`[text-voice-sync] ${rec.verdict}: board ${key} sentence ${sentence} — voice ${rec.lead} ms after its writing (want ${textLeadMs(speed ?? 1)} ms)`);
    }
  }
}

/** The player sent sentence `sentence` of board `key` to the board (dev logger only). */
export function logSentenceCue(key: string, sentence: number, t: number): void {
  syncLog("cue", key, sentence, t);
}

/** Her voice for sentence `sentence` of board `key` started (dev logger only). */
export function logSentenceVoice(key: string, sentence: number, t: number, speed: number): void {
  syncLog("audio", key, sentence, t, speed);
}
