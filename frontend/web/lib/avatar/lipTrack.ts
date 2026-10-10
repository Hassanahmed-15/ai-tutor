import { Aligner, weightsFromSegments, type Unit } from "./align";
import { analyseVisemeCosts, HOP_S, WINDOW_S } from "./headFeatures";
import type { VisemeWeights } from "./visemes";

/**
 * ONE REPLY'S LIP TRACK. Words come in from the transcript (as aligner units), audio comes in chunk
 * by chunk as it is scheduled (before it plays), and each time either arrives the track re-aligns
 * and hands back per-frame viseme weights keyed to the audio clock. lib/adhd/mouth.ts owns the
 * clock and the timeline; this module owns the bookkeeping between the ear, the words and the DP.
 *
 * Analysis runs in windows of at least ~250 ms of new audio with ~300 ms of context before them
 * (the worklet's gate and filters need a run-up), one window at a time; frames the window
 * already covered are not re-analysed. A long reply is capped: past ~90 s the track stops
 * growing and the plain shape carries on.
 */

export type VisemeTrack = { startAt: number; hopS: number; weights: VisemeWeights[] };

const MIN_NEW_S = 0.25;
const CONTEXT_S = 0.3;
const MAX_S = 90;

type Track = {
  startAt: number;
  sampleRate: number;
  chunks: Float32Array[];
  length: number;
  /** Samples covered by frames already given to the aligner. */
  analysedTo: number;
  aligner: Aligner;
  analysing: boolean;
  onUpdate: (track: VisemeTrack) => void;
  full: boolean;
};

let track: Track | null = null;

export function lipTrackBegin(startAt: number, onUpdate: (track: VisemeTrack) => void): void {
  track = { startAt, sampleRate: 0, chunks: [], length: 0, analysedTo: 0, aligner: new Aligner(), analysing: false, onUpdate, full: false };
}

export function lipTrackEnd(): void {
  track = null;
}

/** Words arrived: as units from lib/avatar/align's `unitsForWord`. */
export function lipTrackWords(units: Unit[]): void {
  if (!track || track.full || units.length === 0) return;
  track.aligner.addUnits(units);
  publish(track);
}

/** A chunk was scheduled at `startAt` on the audio clock. A gap since the last one is silence. */
export function lipTrackAudio(samples: Float32Array, sampleRate: number, startAt: number): void {
  if (!track || track.full) return;
  if (track.sampleRate === 0) track.sampleRate = sampleRate;
  if (sampleRate !== track.sampleRate) return; // one rate per reply
  const expectedStart = track.startAt + track.length / sampleRate;
  const gap = Math.round((startAt - expectedStart) * sampleRate);
  if (gap > sampleRate * 0.005) {
    track.chunks.push(new Float32Array(Math.min(gap, sampleRate * 5)));
    track.length += Math.min(gap, sampleRate * 5);
  }
  track.chunks.push(samples);
  track.length += samples.length;
  if (track.length > MAX_S * sampleRate) track.full = true;
  void maybeAnalyse(track);
}

async function maybeAnalyse(t: Track): Promise<void> {
  if (t.analysing || t !== track) return;
  const sr = t.sampleRate;
  if (t.length - t.analysedTo < MIN_NEW_S * sr) return;
  t.analysing = true;
  try {
    const hop = Math.round(HOP_S * sr);
    // The window starts on a frame boundary, with context before the first new frame.
    const firstNew = t.aligner.frameCount;
    const winStartFrame = Math.max(0, firstNew - Math.round(CONTEXT_S / HOP_S));
    const winStart = winStartFrame * hop;
    const winEnd = t.length;
    const samples = slice(t, winStart, winEnd);
    const costs = await analyseVisemeCosts(samples, sr);
    if (t !== track) return;
    if (!costs) {
      t.full = true; // no ear: the plain shape carries on
      return;
    }
    const fresh = costs.slice(firstNew - winStartFrame);
    if (fresh.length) t.aligner.addFrames(fresh);
    // Frames end where the last full window ends.
    t.analysedTo = (t.aligner.frameCount - 1) * hop + Math.round(WINDOW_S * sr);
    publish(t);
  } finally {
    t.analysing = false;
  }
  if (t === track && t.length - t.analysedTo >= MIN_NEW_S * sr) void maybeAnalyse(t);
}

function slice(t: Track, start: number, end: number): Float32Array {
  const out = new Float32Array(Math.max(0, end - start));
  let pos = 0;
  for (const c of t.chunks) {
    const cStart = pos;
    const cEnd = pos + c.length;
    pos = cEnd;
    if (cEnd <= start || cStart >= end) continue;
    const from = Math.max(start, cStart) - cStart;
    const to = Math.min(end, cEnd) - cStart;
    out.set(c.subarray(from, to), Math.max(start, cStart) - start);
  }
  return out;
}

function publish(t: Track) {
  const frames = t.aligner.frameCount;
  if (frames === 0) return;
  const weights = weightsFromSegments(t.aligner.segments(false), frames);
  t.onUpdate({ startAt: t.startAt, hopS: HOP_S, weights });
}

/** For the lab. */
export function lipTrackDebug(): { frames: number; units: number; segments: { viseme: string; start: number; end: number }[] } | null {
  if (!track) return null;
  return { frames: track.aligner.frameCount, units: track.aligner.unitCount, segments: track.aligner.segments(false).map((s) => ({ viseme: s.viseme, start: s.start, end: s.end })) };
}
