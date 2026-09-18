import { costFor, type TokenUsage } from "./modelPricing";

/**
 * What one request actually spent on model calls, measured from the usage every completion returns.
 *
 * WHY THIS EXISTS. Only planning and generation reported cost. Document parsing (up to dozens of
 * vision calls per upload) and mid-lecture questions spent real money and reported nothing, so the
 * cost shown for a lecture was the cost of the part that happened to be instrumented. Threading a
 * running total through every helper in those routes would touch a dozen call sites; wrapping the
 * one client each request creates touches none of them and cannot miss a call added later.
 *
 * A completion with no usage block (a streamed call) is counted as UNPRICED rather than as $0, so
 * the total never quietly claims to be complete when it is not.
 */
export type CostMeter = {
  readonly totalUsd: number;
  readonly calls: number;
  readonly unpricedCalls: number;
  /** Meters `client.chat.completions.create` on this instance and returns the same client. */
  wrap<T>(client: T): T;
};

type Completions = { create: (params: { model?: string }, ...rest: unknown[]) => Promise<unknown> };

export function createCostMeter(): CostMeter {
  let totalUsd = 0;
  let calls = 0;
  let unpricedCalls = 0;

  const record = (model: string | undefined, usage: TokenUsage) => {
    calls += 1;
    if (!model || !usage) {
      unpricedCalls += 1;
      return;
    }
    totalUsd += costFor(model, usage);
  };

  return {
    get totalUsd() {
      return totalUsd;
    },
    get calls() {
      return calls;
    },
    get unpricedCalls() {
      return unpricedCalls;
    },
    wrap<T>(client: T): T {
      const completions = (client as { chat?: { completions?: Completions } } | null)?.chat?.completions;
      if (!completions || typeof completions.create !== "function") return client;
      const original = completions.create.bind(completions);
      // Own property on this instance only: the client is created per request, so nothing shared
      // with other requests is changed.
      completions.create = async (params, ...rest) => {
        const result = await original(params, ...rest);
        const usage = (result as { usage?: TokenUsage } | null)?.usage;
        // Prefer the model the API says it used (a dated snapshot) over the alias that was asked for.
        const model = (result as { model?: string } | null)?.model ?? params?.model;
        record(model, usage ?? null);
        return result;
      };
      return client;
    },
  };
}
