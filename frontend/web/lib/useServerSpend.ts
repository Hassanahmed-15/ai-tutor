"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { onSpendTags, spendTags } from "./spendTag";
import type { SpendKind } from "./spend/usage";

/**
 * What this lesson and today have really cost, from the server's spend log (lib/spend). Polled
 * every few seconds while mounted, because spend keeps arriving as narration plays and questions are
 * asked. Null until the first answer (and when the log is unreachable).
 */
export type SpendSummary = { totalUsd: number; unpriced: number; calls: number; byKind: Partial<Record<SpendKind, number>>; byModel: Record<string, number> };

export const SPEND_KIND_LABELS: Record<SpendKind, string> = {
  planning: "planning",
  generation: "board writing & animation",
  pictures: "pictures",
  narration: "narration voice",
  questions: "questions & drawings",
  document: "reading the PDF",
  video: "reading the video",
  voice: "live voice",
  personal: "personalisation",
  other: "other",
};

const EMPTY: readonly string[] = [];

export function useServerSpend(intervalMs = 5000): { lesson: SpendSummary | null; day: SpendSummary | null } {
  const tags = useSyncExternalStore(onSpendTags, spendTags, () => EMPTY);
  const [state, setState] = useState<{ lesson: SpendSummary | null; day: SpendSummary | null }>({ lesson: null, day: null });
  const key = tags.join(",");
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/spend?day=today${key ? `&tags=${encodeURIComponent(key)}` : ""}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { lesson: SpendSummary | null; day: SpendSummary | null };
        if (alive) setState(json);
      } catch {
        // Keep the last figures.
      }
    };
    void load();
    const timer = window.setInterval(load, intervalMs);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [key, intervalMs]);
  return state;
}
