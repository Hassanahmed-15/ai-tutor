"use client";

import { useEffect, useState } from "react";

/**
 * The learner's parked thoughts, on the dashboard.
 *
 * "Park a thought" exists so an intrusive thought can be set down without derailing the lecture —
 * which only works if the thought is still there afterwards. This is the afterwards.
 *
 * Rendered only for an ADHD learner, and the API enforces that independently: a panel hidden in the
 * UI is still readable by anyone who opens devtools.
 */

type Thought = { id: string; text: string; topic: string | null; createdAt: string };

export function Thoughts() {
  const [items, setItems] = useState<Thought[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/adhd/thoughts")
      .then((r) => (r.ok ? r.json() : { thoughts: [] }))
      .then((d) => { if (live) setItems(Array.isArray(d.thoughts) ? d.thoughts : []); })
      .catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, []);

  const done = async (id: string) => {
    setBusy(id);
    // Optimistic: the learner said they are finished with it, and a list that lags behind that
    // makes the control feel broken. A failure puts it back.
    const before = items ?? [];
    setItems(before.filter((t) => t.id !== id));
    try {
      const res = await fetch(`/api/adhd/thoughts?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) setItems(before);
    } catch {
      setItems(before);
    } finally {
      setBusy(null);
    }
  };

  // Still loading. Rendering a frame before the data arrives makes the panel flicker in on every
  // visit to the dashboard.
  if (!items) return null;

  return (
    <section className="mt-6 w-full rounded-xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[0.7rem] font-black uppercase tracking-[0.15em] text-amber-300">Parked thoughts</h2>
        <span className="text-[0.66rem] text-white/35">{items.length ? `${items.length} waiting` : "ADHD track"}</span>
      </div>

      {/*
        An empty list still renders the panel, for the same reason the leaderboard does: absence is
        indistinguishable from a bug, and a learner who has never used Shift+Space has no way to
        discover the feature exists if the only sign of it is a panel that never appears.
      */}
      {items.length === 0 ? (
        <p className="px-1 text-[0.8rem] leading-relaxed text-white/45">
          Nothing parked. During a lesson press{" "}
          <span className="font-bold text-white/70">Shift + Space</span> to set a thought aside without
          losing your place — it will wait here.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((t) => (
            <li
              key={t.id}
              data-thought
              className="flex items-start gap-3 rounded-lg bg-white/[0.04] px-3 py-2 text-sm text-white/85"
            >
              <span className="min-w-0 flex-1">
                {t.text}
                {t.topic && <span className="ml-2 text-[0.68rem] text-white/35">· {t.topic}</span>}
              </span>
              <button
                data-thought-done
                onClick={() => done(t.id)}
                disabled={busy === t.id}
                title="Done with this — remove it"
                className="shrink-0 rounded-md px-2 py-1 text-[0.68rem] font-bold text-white/45 transition hover:bg-emerald-400/15 hover:text-emerald-200 disabled:opacity-40"
              >
                done
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
