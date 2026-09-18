"use client";

/**
 * What the page picker shows before the first rendered page arrives.
 *
 * WHY A SKELETON AND NOT A SPINNER. The previous state was an 18 px spinner centred in an
 * otherwise empty full-height pane, held for the whole server render with no sense of how long it
 * would last or what was coming. A spinner says "something is happening"; this says "a column of
 * pages is arriving, and it will look like this" — so when the first real page streams in, the
 * layout is already correct and nothing shifts underneath the reader.
 *
 * The aspect ratio is US Letter (8.5 × 11), which is what the overwhelming majority of uploaded
 * papers and decks are. Being slightly wrong for A4 costs a few pixels of settle on the first
 * page; being a 400 px grey box, as the viewer's per-page skeleton is, costs a full reflow of
 * every page below it.
 */
export function PageStackSkeleton({
  count,
  label = "pages",
}: {
  /** How many placeholders to draw. The streaming route sends the real page count first; before
   *  that arrives a small number is enough to establish the shape without inventing a long
   *  document that might not exist. */
  count: number;
  label?: "pages" | "slides";
}) {
  // More than a screenful of placeholders is wasted DOM — nobody scrolls a skeleton.
  const placeholders = Math.max(1, Math.min(count, 4));

  return (
    <div
      className="h-full min-h-0 overflow-y-auto overscroll-contain px-6 py-6"
      role="status"
      aria-live="polite"
      aria-label={`Rendering ${label}`}
    >
      <div className="mx-auto flex max-w-2xl flex-col gap-10">
        {Array.from({ length: placeholders }, (_, index) => (
          <div key={index} className="flex flex-col items-center gap-2">
            <div className="mb-2 h-3 w-16 rounded-full bg-[var(--hud-line)]" />
            <div
              className="w-full overflow-hidden rounded-[var(--radius)] border"
              style={{ borderColor: "var(--hud-line)", aspectRatio: "8.5 / 11" }}
            >
              {/*
                A sweep rather than a pulse. A pulsing block reads as "broken / waiting"; a shimmer
                travelling across the placeholder reads as work in progress, and it is the same
                gesture the page itself will make when it paints.

                Each placeholder starts its sweep slightly later so the column reads top-to-bottom,
                which is the order the pages actually arrive in.
              */}
              <div
                className="h-full w-full bg-[var(--hud-surface)]"
                style={{
                  backgroundImage:
                    "linear-gradient(90deg, transparent 0%, var(--hud-line) 50%, transparent 100%)",
                  backgroundSize: "200% 100%",
                  animation: "page-skeleton-sweep 1.5s ease-in-out infinite",
                  animationDelay: `${index * 160}ms`,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
