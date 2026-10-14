"use client";

/**
 * WHERE THIS SLIDE CAME FROM — a quiet line under a canvas board taught from web research
 * (lib/webSources.ts): "Sources: Wikipedia — Double circulatory system · Save My Exams — Circulatory
 * systems". Each link opens the page in a new tab. Under the board, never over it, so it covers
 * nothing the board draws.
 */
export function SlideSources({ sources }: { sources: Array<{ title: string; url: string; site: string }> }) {
  return (
    <p
      data-slide-sources
      className="flex shrink-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 px-3 pb-1.5 pt-1 text-[0.72rem] leading-snug text-[var(--hud-text-faint)]"
    >
      <span className="font-semibold text-[var(--hud-text-dim)]">Sources:</span>
      {sources.map((source, i) => (
        <span key={source.url} className="inline-flex min-w-0 items-baseline">
          {i > 0 && <span aria-hidden="true" className="mr-1.5">·</span>}
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            title={source.url}
            className="max-w-[22rem] truncate underline decoration-[var(--hud-line-strong)] underline-offset-2 hover:text-[var(--hud-text)] hover:decoration-current"
          >
            {source.site}
            {source.title && source.title !== source.site ? ` — ${source.title}` : ""}
          </a>
        </span>
      ))}
    </p>
  );
}
