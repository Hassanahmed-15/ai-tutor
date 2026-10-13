import { AsyncLocalStorage } from "node:async_hooks";
import type { SpendKind } from "./usage";

/**
 * WHO A CALL IS SPENT FOR. Work that runs outside a browser request — the lecture worker — runs
 * inside `withSpendScope({ tag: sessionId, kind: "generation" })`, so every OpenAI call it makes is
 * filed under that lecture. Inside an API request the browser's own header says it instead (see
 * lib/openaiClient.ts).
 */
export type SpendScope = { tag: string | null; kind: SpendKind; userId?: string | null };

const storage = new AsyncLocalStorage<SpendScope>();

export function withSpendScope<T>(scope: SpendScope, fn: () => Promise<T>): Promise<T> {
  return storage.run(scope, fn);
}

export function currentSpendScope(): SpendScope | undefined {
  return storage.getStore();
}
