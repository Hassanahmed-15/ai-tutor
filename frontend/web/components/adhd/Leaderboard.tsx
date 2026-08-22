"use client";

import { useEffect, useState } from "react";

/**
 * The ADHD leaderboard, shown on the prompt page.
 *
 * Rendered only for a learner whose profile is `"adhd"` — and the API enforces that independently,
 * because a board that is merely hidden in the UI is still readable by anyone who opens devtools.
 *
 * Ordering comes from Cosmos (`ORDER BY c.xp DESC`), not from a client-side sort: sorting here would
 * only sort the rows that happened to come back, which gives the wrong top-N the moment the board is
 * bigger than one page.
 */

type Entry = {
  rank: number;
  userId: string;
  username: string;
  displayName: string | null;
  xp: number;
  sessions: number;
  isYou: boolean;
};

export function Leaderboard() {
  const [entries, setEntries] = useState<Entry[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/adhd/leaderboard")
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .then((d) => { if (live) setEntries(Array.isArray(d.entries) ? d.entries : []); })
      .catch(() => { if (live) setEntries([]); });
    return () => { live = false; };
  }, []);

  // Still loading. Rendering a frame before the data arrives would make the panel flicker in on
  // every visit to the prompt page.
  if (!entries) return null;

  return (
    <section className="mt-8 w-full rounded-xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-[0.7rem] font-black uppercase tracking-[0.15em] text-teal-300">Focus leaderboard</h2>
        <span className="text-[0.66rem] text-white/35">ADHD track</span>
      </div>

      {/*
        An EMPTY BOARD STILL RENDERS.
        This used to `return null` whenever there were no rows, on the reasoning that an empty panel
        is noise. In practice it meant the first learner on the track — and, before scores were ever
        posted, every learner — opened the page and saw no leaderboard at all, with no way to tell
        whether the feature existed or was broken. Absence is indistinguishable from a bug.
        Saying what earns a place is also the only moment the scoring rules get explained anywhere.
      */}
      {entries.length === 0 && (
        <p className="px-2.5 py-1.5 text-[0.8rem] leading-relaxed text-white/45">
          No scores yet — finish a lesson to take the top spot.{" "}
          {/* Concrete numbers, now that there are only two and neither ever goes down. The whole
              point of a flat scale is that a learner can predict it, which they cannot do from a
              description of where points "come from". */}
          <span className="text-white/30">
            5 points a part, 20 for a checkpoint you get right. Nothing is ever taken away.
          </span>
        </p>
      )}

      <ol className="flex flex-col gap-1">
        {entries.map((e) => (
          <li
            key={e.userId}
            className={`flex items-center gap-3 rounded-lg px-2.5 py-1.5 text-sm ${
              e.isYou ? "bg-teal-400/12 ring-1 ring-teal-400/30" : ""
            }`}
          >
            {/* tabular-nums so ranks and scores line up as columns rather than drifting by digit width */}
            <span
              className={`w-6 shrink-0 text-right text-[0.75rem] font-black tabular-nums ${
                e.rank === 1 ? "text-amber-300" : e.rank <= 3 ? "text-white/70" : "text-white/35"
              }`}
            >
              {e.rank}
            </span>
            <span className={`min-w-0 flex-1 truncate ${e.isYou ? "font-bold text-white" : "text-white/75"}`}>
              {e.displayName || e.username}
              {e.isYou && <span className="ml-2 text-[0.66rem] font-bold text-teal-300">you</span>}
            </span>
            <span className="shrink-0 text-[0.75rem] font-black tabular-nums text-amber-300">{e.xp}</span>
            <span className="w-14 shrink-0 text-right text-[0.66rem] tabular-nums text-white/30">
              {e.sessions} {e.sessions === 1 ? "lesson" : "lessons"}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
