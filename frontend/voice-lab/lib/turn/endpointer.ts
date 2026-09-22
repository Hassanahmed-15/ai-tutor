/**
 * WHERE AN UTTERANCE STARTS AND WHERE IT ENDS — the endpointer.
 *
 * The detector says "speech / not speech" fifty times a second. That is not a turn: a turn has a
 * start that must survive a cough and a stutter, and an end that must survive the pauses inside a
 * sentence. This machine owns exactly those two edges and nothing else — who is speaking and
 * whether the words are for the tutor are the arbiter's questions.
 *
 *   silent ──speech──▶ onset ──sustained onsetMs──▶ speaking ◀──resume── paused
 *                        │ quiet before confirmation                         ▲   │ quiet ≥ grace
 *                        ▼ abort (blip)                        quiet ≥150ms ─┘   ▼ end / abort(too short)
 *                      silent                                                  silent
 *
 * NATURAL PAUSES. A speaker pausing mid-sentence must not end the turn, and a speaker who has
 * finished must not wait long for a reply. The grace period is therefore ADAPTIVE: 700 ms by
 * default, extended when the words so far look unfinished — "so the thing is…", "because", a
 * trailing comma — which the pipeline reports through `setContinuationHint`. The hint only ever
 * lengthens the grace; it never shortens it, so a wrong hint costs a few hundred milliseconds of
 * latency rather than a cut-off sentence.
 *
 * STUCK STATES. No utterance is allowed to run forever: `maxUtteranceMs` ends it, and the arbiter
 * can `forceEnd` when the microphone stalls. The pre-roll ring buffer is always kept, so a turn can
 * start in the past and the first syllable is never lost.
 *
 * Pure and clock-injected: the caller supplies frames and `now`.
 */

export type EndpointState = "silent" | "onset" | "speaking" | "paused";

export interface EndpointerConfig {
  frameMs: number;
  /** Speech sustained this long before an utterance is confirmed. Must exceed the steadiness window (160 ms). */
  onsetMs: number;
  /** Utterances shorter than this are a cough, a click, a "hm" — aborted, never ended. */
  minSpeechMs: number;
  /** Quiet longer than this inside an utterance is a pause (reported, tolerated). */
  pauseAfterMs: number;
  /** A pause this long ends the utterance. */
  pauseGraceMs: number;
  /** …unless the words so far look unfinished, in which case this applies. */
  unfinishedPauseGraceMs: number;
  /** Nothing runs longer than this; the turn is ended for the arbiter to deal with. */
  maxUtteranceMs: number;
  /** Audio kept from before the onset and handed over when the utterance is confirmed. */
  prerollMs: number;
  /** Quiet inside the onset that aborts it — a click has no second syllable, while speech over noise flickers for ~100-200 ms at a time. */
  onsetQuietMs: number;
}

export const DEFAULT_ENDPOINTER_CONFIG: EndpointerConfig = {
  frameMs: 20,
  onsetMs: 180,
  minSpeechMs: 240,
  pauseAfterMs: 150,
  pauseGraceMs: 700,
  unfinishedPauseGraceMs: 1100,
  maxUtteranceMs: 20_000,
  prerollMs: 500,
  onsetQuietMs: 300,
};

export type EndpointEvent =
  | { type: "onset"; at: number }
  | { type: "start"; at: number; startedAt: number; preroll: Float32Array[] }
  | { type: "pause"; at: number; spokenMs: number }
  | { type: "resume"; at: number; pausedMs: number }
  | { type: "end"; at: number; startedAt: number; durationMs: number; reason: "silence" | "max-utterance" | "forced" }
  | { type: "abort"; at: number; reason: string };

export class Endpointer {
  readonly config: EndpointerConfig;
  private state: EndpointState = "silent";
  private preroll: Float32Array[] = [];
  private onsetFrames: Float32Array[] = [];
  private readonly prerollFrames: number;
  private onsetSince = 0;
  /** Speech actually heard during the onset — confirmation counts this, not wall time, so flicker under noise does not reset it. */
  private onsetSpeechMs = 0;
  private startedAt = 0;
  private lastSpeechAt = -Infinity;
  private pauseSince = 0;
  private continuationHint = false;

  constructor(private readonly onEvent: (event: EndpointEvent) => void, config: Partial<EndpointerConfig> = {}) {
    this.config = { ...DEFAULT_ENDPOINTER_CONFIG, ...config };
    this.prerollFrames = Math.max(1, Math.round(this.config.prerollMs / this.config.frameMs));
  }

  getState(): EndpointState {
    return this.state;
  }

  /** The words so far promise more ("because…", "and…"): tolerate a longer pause. */
  setContinuationHint(unfinished: boolean): void {
    this.continuationHint = unfinished;
  }

  push(pcm: Float32Array, speech: boolean, now: number): void {
    this.preroll.push(pcm);
    if (this.preroll.length > this.prerollFrames) this.preroll.shift();

    switch (this.state) {
      case "silent":
        if (speech) {
          this.state = "onset";
          this.onsetSince = now;
          this.onsetSpeechMs = this.config.frameMs;
          this.lastSpeechAt = now;
          this.onsetFrames = [];
          this.onEvent({ type: "onset", at: now });
        }
        return;
      case "onset":
        this.onsetFrames.push(pcm);
        if (speech) {
          this.lastSpeechAt = now;
          this.onsetSpeechMs += this.config.frameMs;
          // A voice over a fan flickers below the guarded floor every few frames; what confirms an
          // utterance is how much speech was heard, not whether it was unbroken.
          if (this.onsetSpeechMs >= this.config.onsetMs) {
            this.state = "speaking";
            this.startedAt = this.onsetSince;
            this.continuationHint = false;
            // Everything from before the onset plus the onset itself: the turn starts in the past.
            const handed = [...this.preroll.slice(0, Math.max(0, this.preroll.length - this.onsetFrames.length)), ...this.onsetFrames];
            this.onsetFrames = [];
            this.onEvent({ type: "start", at: now, startedAt: this.startedAt, preroll: handed });
          }
        } else if (now - this.lastSpeechAt >= this.config.onsetQuietMs) {
          this.state = "silent";
          this.onsetFrames = [];
          this.onEvent({ type: "abort", at: now, reason: `blip: ${now - this.onsetSince} ms of voice, then quiet` });
        }
        return;
      case "speaking":
        if (speech) {
          this.lastSpeechAt = now;
        } else if (now - this.lastSpeechAt >= this.config.pauseAfterMs) {
          this.state = "paused";
          this.pauseSince = this.lastSpeechAt;
          this.onEvent({ type: "pause", at: now, spokenMs: this.lastSpeechAt - this.startedAt });
        }
        this.checkMax(now);
        return;
      case "paused": {
        if (speech) {
          this.state = "speaking";
          this.lastSpeechAt = now;
          this.onEvent({ type: "resume", at: now, pausedMs: now - this.pauseSince });
          this.checkMax(now);
          return;
        }
        const grace = this.continuationHint ? this.config.unfinishedPauseGraceMs : this.config.pauseGraceMs;
        if (now - this.pauseSince >= grace) this.finish(now, "silence");
        else this.checkMax(now);
        return;
      }
    }
  }

  /** The arbiter ends the utterance on its own evidence (a stalled microphone, a reset). */
  forceEnd(now: number, reason: string): void {
    if (this.state === "onset") {
      this.state = "silent";
      this.onsetFrames = [];
      this.onEvent({ type: "abort", at: now, reason });
      return;
    }
    if (this.state === "speaking" || this.state === "paused") this.finish(now, "forced");
  }

  private checkMax(now: number): void {
    if (now - this.startedAt >= this.config.maxUtteranceMs) this.finish(now, "max-utterance");
  }

  private finish(now: number, reason: "silence" | "max-utterance" | "forced"): void {
    const durationMs = Math.max(0, this.lastSpeechAt - this.startedAt);
    const startedAt = this.startedAt;
    this.state = "silent";
    this.continuationHint = false;
    if (durationMs < this.config.minSpeechMs && reason === "silence") {
      this.onEvent({ type: "abort", at: now, reason: `too short: ${durationMs} ms of speech` });
      return;
    }
    this.onEvent({ type: "end", at: now, startedAt, durationMs, reason });
  }

  reset(): void {
    this.state = "silent";
    this.preroll = [];
    this.onsetFrames = [];
    this.continuationHint = false;
    this.lastSpeechAt = -Infinity;
  }
}
