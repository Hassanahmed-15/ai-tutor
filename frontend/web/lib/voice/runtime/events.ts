/**
 * THE DECISION TRAIL. Every layer of the stack reports what it saw and what it decided, with a
 * timestamp and a reason, into one log. This is the debugging surface the lab exists to provide:
 * mic state, VAD state, speech start/end, who was speaking, whether the words were for the tutor,
 * every turn transition and why, connection state, transcription events, watchdog firings.
 *
 * Pure: a ring buffer with subscribers. The UI renders it; tests assert on it.
 */

export type EventLayer = "mic" | "vad" | "endpoint" | "speaker" | "words" | "turn" | "tutor" | "conn" | "watchdog" | "scenario" | "ui";
export type EventLevel = "info" | "ok" | "warn" | "bad";

export interface LabEvent {
  /** Milliseconds on the pipeline clock (real time in the live app, virtual time in scenarios). */
  t: number;
  layer: EventLayer;
  kind: string;
  detail?: string;
  level?: EventLevel;
  data?: Record<string, unknown>;
}

export type EventSink = (event: LabEvent) => void;

export class EventLog {
  readonly events: LabEvent[] = [];
  private readonly listeners = new Set<EventSink>();
  constructor(private readonly max = 4000) {}

  push(event: LabEvent): void {
    this.events.push(event);
    if (this.events.length > this.max) this.events.splice(0, this.events.length - this.max);
    for (const listener of this.listeners) listener(event);
  }

  log(layer: EventLayer, kind: string, t: number, detail?: string, level: EventLevel = "info", data?: Record<string, unknown>): void {
    this.push({ t, layer, kind, detail, level, data });
  }

  subscribe(listener: EventSink): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.events.length = 0;
  }

  /** Events of one layer, for assertions. */
  of(layer: EventLayer, kind?: string): LabEvent[] {
    return this.events.filter((e) => e.layer === layer && (kind === undefined || e.kind === kind));
  }

  toJSON(): LabEvent[] {
    return [...this.events];
  }
}
