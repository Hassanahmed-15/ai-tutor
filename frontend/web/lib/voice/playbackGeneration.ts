/** Prevents stale Live audio/onended callbacks from reviving an interrupted response. */
export interface PlaybackToken { sessionId: string; generation: number; responseId: string; }

export class PlaybackGenerationController {
  private generation = 0;
  private responseId = "";
  private playedSamples = 0;
  private acceptedSamples = 0;
  constructor(readonly sessionId: string) {}

  begin(responseId: string): PlaybackToken {
    this.generation += 1;
    this.responseId = responseId;
    this.playedSamples = 0;
    this.acceptedSamples = 0;
    return this.token;
  }
  get token(): PlaybackToken { return { sessionId: this.sessionId, generation: this.generation, responseId: this.responseId }; }
  accept(token: PlaybackToken): boolean {
    return token.sessionId === this.sessionId && token.generation === this.generation && token.responseId === this.responseId;
  }
  noteAccepted(token: PlaybackToken, samples: number): boolean {
    if (!this.accept(token)) return false;
    this.acceptedSamples += samples;
    return true;
  }
  notePlayed(token: PlaybackToken, samples: number): boolean {
    if (!this.accept(token)) return false;
    this.playedSamples += samples;
    return true;
  }
  invalidate(): PlaybackToken {
    this.generation += 1;
    this.responseId = `cancelled-${this.generation}`;
    this.playedSamples = 0;
    this.acceptedSamples = 0;
    return this.token;
  }
  get metrics() { return { generation: this.generation, acceptedSamples: this.acceptedSamples, playedSamples: this.playedSamples, queuedSamples: Math.max(0, this.acceptedSamples - this.playedSamples) }; }
}
