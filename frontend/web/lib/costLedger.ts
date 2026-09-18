/**
 * What THIS lecture has cost so far, across every stream that spends money.
 *
 * WHY THIS EXISTS. The badge used to show one number — generation — and said so ("excludes
 * document & playback"). Honest about its scope, but not the cost of the lecture: reading an
 * uploaded document, planning, narrating every sentence, answering questions and the live voice
 * tutor all spend real money and none of it was shown. Each of those now reports what it measured,
 * and this ledger adds it up for the lecture in front of the student.
 *
 * Two rules keep the total honest:
 *   - Only MEASURED figures are added — usage the provider returned, priced from lib/modelPricing.
 *   - Spend that could not be measured is counted as UNPRICED, never as $0, and the badge says how
 *     many such calls there were. A total that quietly omits them would be the old bug again.
 *
 * Module-level on purpose: the streams report from places with no shared React parent (the voice
 * engine, the chat panel, the live tutor hooks), and there is one lecture on screen at a time.
 */

export type CostStream = "document" | "planning" | "generation" | "narration" | "questions" | "liveTutor";

export const COST_STREAM_LABELS: Record<CostStream, string> = {
  document: "document",
  planning: "planning",
  generation: "generation",
  narration: "narration",
  questions: "questions",
  liveTutor: "live tutor",
};

type Line = { usd: number; unpriced: number };
export type CostLedgerSnapshot = {
  lines: Record<CostStream, Line>;
  totalUsd: number;
  unpriced: number;
};

const STREAMS = Object.keys(COST_STREAM_LABELS) as CostStream[];

function empty(): CostLedgerSnapshot {
  const lines = Object.fromEntries(STREAMS.map((s) => [s, { usd: 0, unpriced: 0 }])) as Record<CostStream, Line>;
  return { lines, totalUsd: 0, unpriced: 0 };
}

let snapshot = empty();
const listeners = new Set<() => void>();

function commit(stream: CostStream, update: (line: Line) => Line) {
  const lines = { ...snapshot.lines, [stream]: update(snapshot.lines[stream]) };
  const totalUsd = STREAMS.reduce((sum, s) => sum + lines[s].usd, 0);
  const unpriced = STREAMS.reduce((sum, s) => sum + lines[s].unpriced, 0);
  snapshot = { lines, totalUsd, unpriced };
  for (const listener of listeners) listener();
}

/** Add measured spend. A non-finite or negative figure is recorded as unpriced, never as free. */
export function addCost(stream: CostStream, usd: unknown): void {
  const value = typeof usd === "number" ? usd : typeof usd === "string" && usd.trim() !== "" ? Number(usd) : NaN;
  if (!Number.isFinite(value) || value < 0) {
    commit(stream, (line) => ({ ...line, unpriced: line.unpriced + 1 }));
    return;
  }
  if (value === 0) return;
  commit(stream, (line) => ({ ...line, usd: line.usd + value }));
}

/** Replace a stream's figure with a running total its source already keeps (generation does). */
export function setCost(stream: CostStream, usd: number): void {
  if (!Number.isFinite(usd) || usd < 0) return;
  commit(stream, (line) => ({ ...line, usd }));
}

/** Record calls that spent money but reported no usage to price. */
export function addUnpriced(stream: CostStream, count = 1): void {
  if (count > 0) commit(stream, (line) => ({ ...line, unpriced: line.unpriced + count }));
}

/** Start a new lecture's ledger. */
export function resetCostLedger(): void {
  snapshot = empty();
  for (const listener of listeners) listener();
}

export function getCostLedger(): CostLedgerSnapshot {
  return snapshot;
}

/**
 * Record a /api/tts response. A cache hit reports "0" and costs nothing; a response with no cost
 * header spent money we could not measure.
 */
export function recordTtsResponse(res: Response): void {
  if (!res.ok) return;
  const header = res.headers.get("X-Cost-Usd");
  if (header === null) addUnpriced("narration");
  else addCost("narration", header);
}

/** Record a JSON body that carries `costUsd` (and optionally `unpricedCalls`). */
export function recordJsonCost(stream: CostStream, data: unknown): void {
  const body = data as { costUsd?: unknown; unpricedCalls?: unknown } | null;
  if (!body || body.costUsd === undefined) return;
  addCost(stream, body.costUsd);
  if (typeof body.unpricedCalls === "number") addUnpriced(stream, body.unpricedCalls);
}

/**
 * Be told when the ledger changes. Returns the unsubscribe function.
 *
 * NO React in this module, deliberately. lib/voice.ts records narration cost here, and voice.ts is
 * imported by server code (lib/blackboardGen.ts, reached from the lecture-start route). When the
 * React hook lived here, that chain pulled a client-only hook into a server route and every new
 * lecture failed to start with a 500. The hook lives in components/LectureCostBadge.tsx.
 */
export function subscribeCostLedger(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The snapshot to render on the server, where no lecture is being costed. */
export const EMPTY_COST_LEDGER: CostLedgerSnapshot = empty();
