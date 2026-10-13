import { randomUUID } from "node:crypto";
import type { Container } from "@azure/cosmos";
import { spendEvents } from "../db/cosmos";
import type { SpendKind } from "./usage";

/**
 * THE SPEND LOG. Every paid AI call the server makes lands here (lib/openaiClient.ts records OpenAI
 * calls by itself; narration and Gemini video record theirs explicitly). One row per call:
 * which lesson it was for (`tag`), what part of the app (`kind`), the model, and its cost.
 *
 * Writes are fire-and-forget and never throw into the caller: a lost log row must never fail a
 * lecture. With no database configured (tests, scripts) rows are kept in memory only.
 */
export type SpendEvent = {
  id: string;
  day: string;
  at: string;
  tag: string | null;
  kind: SpendKind;
  model: string;
  endpoint: string;
  /** Null when the response carried no usage to price (counted, never rounded to $0). */
  usd: number | null;
};

const globalForSpend = globalThis as unknown as { ariaSpend?: { container?: Promise<Container | null>; recent: SpendEvent[] } };
const state = (globalForSpend.ariaSpend ??= { recent: [] });

function container(): Promise<Container | null> {
  if (!process.env.COSMOS_CONNECTION_STRING) return Promise.resolve(null);
  state.container ??= spendEvents().catch((error) => {
    console.warn("[spend] log unavailable:", error instanceof Error ? error.message : error);
    state.container = undefined;
    return null;
  });
  return state.container;
}

export function recordSpend(event: Omit<SpendEvent, "id" | "day" | "at">): void {
  const at = new Date().toISOString();
  const row: SpendEvent = { id: randomUUID(), day: at.slice(0, 10), at, ...event };
  state.recent.push(row);
  if (state.recent.length > 2000) state.recent.splice(0, 1000);
  if (process.env.SPEND_LOG_VERBOSE === "1") console.log(`[spend] ${row.kind} ${row.model} ${row.usd === null ? "unpriced" : `$${row.usd.toFixed(5)}`} tag=${row.tag ?? "-"}`);
  void container().then((c) => c?.items.create(row)).catch(() => {});
}

export type SpendSummary = {
  totalUsd: number;
  unpriced: number;
  calls: number;
  byKind: Partial<Record<SpendKind, number>>;
  byModel: Record<string, number>;
};

export function summarize(rows: Array<Pick<SpendEvent, "kind" | "model" | "usd">>): SpendSummary {
  const out: SpendSummary = { totalUsd: 0, unpriced: 0, calls: rows.length, byKind: {}, byModel: {} };
  for (const r of rows) {
    if (r.usd === null) {
      out.unpriced++;
      continue;
    }
    out.totalUsd += r.usd;
    out.byKind[r.kind] = (out.byKind[r.kind] ?? 0) + r.usd;
    out.byModel[r.model] = (out.byModel[r.model] ?? 0) + r.usd;
  }
  return out;
}

/** Every logged call for these lesson tags. */
export async function spendForTags(tags: string[]): Promise<SpendSummary> {
  const wanted = tags.filter(Boolean).slice(0, 8);
  if (wanted.length === 0) return summarize([]);
  const c = await container();
  if (!c) return summarize(state.recent.filter((r) => r.tag && wanted.includes(r.tag)));
  const { resources } = await c.items
    .query<SpendEvent>({ query: "SELECT c.kind, c.model, c.usd FROM c WHERE ARRAY_CONTAINS(@tags, c.tag)", parameters: [{ name: "@tags", value: wanted }] })
    .fetchAll();
  return summarize(resources);
}

/** Every logged call on one UTC day (today by default), across the whole app. */
export async function spendForDay(day = new Date().toISOString().slice(0, 10)): Promise<SpendSummary> {
  const c = await container();
  if (!c) return summarize(state.recent.filter((r) => r.day === day));
  const { resources } = await c.items
    .query<SpendEvent>({ query: "SELECT c.kind, c.model, c.usd FROM c WHERE c.day = @day", parameters: [{ name: "@day", value: day }] }, { partitionKey: day })
    .fetchAll();
  return summarize(resources);
}
