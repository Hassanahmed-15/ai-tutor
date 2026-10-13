import OpenAI, { type ClientOptions } from "openai";
import { recordSpend } from "./spend/record";
import { currentSpendScope } from "./spend/scope";
import { adaptChatBody, endpointOf, usageFromEventStream, usdForUsage, type SpendKind } from "./spend/usage";

const KINDS = ["planning", "generation", "pictures", "narration", "questions", "document", "video", "voice", "personal", "other"] as const;

/**
 * THE ONE WAY TO TALK TO OPENAI. Use `createOpenAI(...)` wherever `new OpenAI(...)` was used.
 *
 * It is the ordinary SDK client with its network layer wrapped, which does two things on every call:
 *
 *  1. ADAPTS THE REQUEST to the model. Cheaper GPT-5.x models (luna) reject `temperature` and
 *     `max_tokens`; call sites written for gpt-4o are rewritten on the way out (lib/spend/usage.ts),
 *     so moving a feature to a cheaper model is a one-line default change, not a rewrite.
 *  2. LOGS WHAT IT COST. The response's usage is priced (lib/modelPricing.ts) and written to the
 *     spend log (lib/spend/record.ts) with the lesson it was for and the part of the app that made
 *     it. Nothing is left out because a feature forgot to report its cost: it is measured here.
 *
 * The SDK's own fetch is kept (only wrapped), so file uploads and streaming behave exactly as before.
 */
export function createOpenAI(options: ClientOptions = {}): OpenAI {
  const client = new OpenAI(options);
  const holder = client as unknown as { fetch: (url: string, init?: RequestInit) => Promise<Response> };
  const base = holder.fetch;
  holder.fetch = (url: string, init?: RequestInit) => meteredFetch(base, url, init);
  return client;
}

async function meteredFetch(base: (url: string, init?: RequestInit) => Promise<Response>, url: string, init?: RequestInit): Promise<Response> {
  const endpoint = endpointOf(String(url));
  let model = "unknown";
  let requestInit = init;
  if (init && typeof init.body === "string") {
    try {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      if (typeof body.model === "string") model = body.model;
      if (endpoint === "chat") {
        const adapted = adaptChatBody(body);
        if (adapted !== body) requestInit = { ...init, body: JSON.stringify(adapted) };
      }
    } catch {
      // Not JSON: send as is.
    }
  }
  // A multipart upload (speech-to-text) hides its model from us: use the one the route is set to.
  if (model === "unknown" && endpoint === "transcription") model = process.env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe";
  const scope = await spendScopeNow();
  const response = await base(url, requestInit);
  if (response.ok && endpoint !== "other") void logCost(response, endpoint, model, scope);
  return response;
}

async function logCost(response: Response, endpoint: string, model: string, given: { tag: string | null; kind: SpendKind }) {
  // Pictures get their own line whichever part of the app asked for them: they are the priciest call.
  const scope = endpoint === "image" ? { ...given, kind: "pictures" as const } : given;
  try {
    const type = response.headers.get("content-type") ?? "";
    const copy = response.clone();
    if (type.includes("application/json")) {
      const json = (await copy.json()) as { model?: string; usage?: Parameters<typeof usdForUsage>[1] & { input_token_details?: unknown } };
      const priced = typeof json.model === "string" ? json.model : model;
      recordSpend({ ...scope, model: priced, endpoint, usd: usdForUsage(priced, json.usage) });
    } else if (type.includes("text/event-stream")) {
      const found = usageFromEventStream(await copy.text());
      const priced = found?.model ?? model;
      recordSpend({ ...scope, model: priced, endpoint, usd: found ? usdForUsage(priced, found.usage) : null });
    } else {
      // Audio bytes from a plain speech call carry no usage: counted as unpriced, never as $0.
      // (The narration route measures its own and logs it; see app/api/tts/route.ts.)
      if (endpoint !== "speech") recordSpend({ ...scope, model, endpoint, usd: null });
    }
  } catch {
    // Logging must never break the call it watches.
  }
}

/**
 * Who this call is for: the worker's scope when there is one, else the browser's own headers on the
 * API request being served (`x-aria-spend` = lesson tag, `x-aria-spend-kind` = part of the app).
 */
export async function spendScopeNow(): Promise<{ tag: string | null; kind: SpendKind }> {
  const scoped = currentSpendScope();
  if (scoped) return scoped;
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const tag = h.get("x-aria-spend");
    const raw = h.get("x-aria-spend-kind") ?? "";
    const kind: SpendKind = (KINDS as readonly string[]).includes(raw) ? (raw as SpendKind) : "other";
    return { tag: tag && tag.length <= 80 ? tag : null, kind };
  } catch {
    return { tag: null, kind: "other" };
  }
}
