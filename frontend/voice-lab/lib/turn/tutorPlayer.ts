/**
 * THE TUTOR'S VOICE, FOR THE LAB — browser speech synthesis with true pause, resume and ducking.
 *
 * The lab tests turn-taking, not a language model, so the tutor reads scripted material through
 * the browser's own synthesiser: no key, no cost, deterministic, and it exposes the one thing the
 * arbiter needs — "is the tutor audible right now" — as a live boolean from real `start`/`end`
 * events rather than a scheduled-chunk estimate (the production bug that made barge-in structurally
 * impossible dated its echo cooldown from the END of scheduled audio).
 *
 * Pause is real: `speechSynthesis.pause()` stops audio within a frame, and `resume()` continues
 * mid-sentence. Ducking has no volume control mid-utterance, so a duck is a pause that the arbiter
 * has promised to reverse — audibly the same thing a real teacher does when a student starts
 * talking: stop, wait, carry on. A production adapter (Gemini/OpenAI audio) would implement this
 * same interface with a GainNode.
 */

export interface TutorPlayerCallbacks {
  onState: (audible: boolean, detail: string) => void;
  onSentence?: (index: number, text: string) => void;
}

export interface TutorScript {
  /** Sentences spoken in order; each is one utterance so a resume lands on a sentence boundary. */
  sentences: string[];
  /** Whether this is a lecture (expensive to stop) or a reply (cheap). */
  as: "lecture" | "reply";
  /** After the last sentence, the tutor is waiting for an answer. */
  expectsAnswer?: boolean;
}

export class TutorPlayer {
  private queue: string[] = [];
  private index = 0;
  private current: SpeechSynthesisUtterance | null = null;
  private audible = false;
  private paused = false;
  private stopped = true;
  private as: "lecture" | "reply" = "lecture";
  private onDone: (() => void) | null = null;

  constructor(private readonly callbacks: TutorPlayerCallbacks, private readonly voiceHint = /en/i) {}

  static available(): boolean {
    return typeof window !== "undefined" && "speechSynthesis" in window;
  }

  get speaking(): boolean {
    return this.audible && !this.paused;
  }

  get speakingAs(): "lecture" | "reply" {
    return this.as;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Start reading a script from the beginning. Resolves when the last sentence has been spoken. */
  say(script: TutorScript): Promise<void> {
    this.cancel("new script");
    this.queue = script.sentences;
    this.index = 0;
    this.as = script.as;
    this.stopped = false;
    this.paused = false;
    return new Promise((resolve) => {
      this.onDone = resolve;
      this.speakNext();
    });
  }

  /** Pause immediately (a duck or a barge-in). The current sentence resumes where it stopped. */
  pause(reason: string): void {
    if (this.stopped || this.paused) return;
    this.paused = true;
    window.speechSynthesis.pause();
    this.setAudible(false, `paused: ${reason}`);
  }

  resume(reason: string): void {
    if (this.stopped || !this.paused) return;
    this.paused = false;
    window.speechSynthesis.resume();
    // Safari sometimes drops a paused utterance; if nothing is speaking, restart the sentence.
    setTimeout(() => {
      if (!this.paused && !this.stopped && !window.speechSynthesis.speaking) this.speakNext();
    }, 250);
    this.setAudible(true, `resumed: ${reason}`);
  }

  /** Stop for good (the student has the floor and the tutor will answer instead). */
  cancel(reason: string): void {
    if (this.stopped && !this.current) return;
    this.stopped = true;
    this.paused = false;
    this.current = null;
    window.speechSynthesis.cancel();
    this.setAudible(false, `stopped: ${reason}`);
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }

  /** Where the tutor was, so a lecture can be picked up after an answer. */
  get position(): { index: number; total: number } {
    return { index: this.index, total: this.queue.length };
  }

  /** Continue a cancelled lecture from the sentence it was on. */
  continueFrom(index: number, script: TutorScript): Promise<void> {
    this.cancel("continuing");
    this.queue = script.sentences;
    this.index = Math.max(0, Math.min(index, script.sentences.length - 1));
    this.as = script.as;
    this.stopped = false;
    this.paused = false;
    return new Promise((resolve) => {
      this.onDone = resolve;
      this.speakNext();
    });
  }

  private speakNext(): void {
    if (this.stopped) return;
    if (this.index >= this.queue.length) {
      this.stopped = true;
      this.setAudible(false, "finished");
      const done = this.onDone;
      this.onDone = null;
      done?.();
      return;
    }
    const text = this.queue[this.index];
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = window.speechSynthesis.getVoices().find((v) => this.voiceHint.test(v.lang) && /female|samantha|karen|moira|google uk english female|zira/i.test(v.name))
      ?? window.speechSynthesis.getVoices().find((v) => this.voiceHint.test(v.lang));
    if (voice) utterance.voice = voice;
    utterance.rate = 1.0;
    utterance.onstart = () => {
      this.callbacks.onSentence?.(this.index, text);
      if (!this.paused) this.setAudible(true, `sentence ${this.index + 1}/${this.queue.length}`);
    };
    utterance.onend = () => {
      if (this.current !== utterance || this.stopped) return;
      this.index += 1;
      this.speakNext();
    };
    utterance.onerror = (event) => {
      if (event.error === "interrupted" || event.error === "canceled") return;
      this.setAudible(false, `synthesis error: ${event.error}`);
    };
    this.current = utterance;
    window.speechSynthesis.speak(utterance);
  }

  private setAudible(audible: boolean, detail: string): void {
    if (this.audible === audible && detail.startsWith("sentence")) return;
    this.audible = audible;
    this.callbacks.onState(audible, detail);
  }
}
