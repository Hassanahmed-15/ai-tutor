/**
 * THE ARIA MARK — an A drawn as one rounded pen stroke, with a dot where the crossbar would be:
 * the tip of the marker on the board, and the voice that explains it.
 *
 * The tile follows the theme accent (red on light, violet on dark) and the stroke the colour that
 * sits on it, so the mark never sinks into the page. Below 24px the stroke thickens and the dot
 * grows, so it still reads as an A with a dot. The tab icon is the same small mark:
 * `app/icon.svg` (by device setting) and `public/aria-icon-{light,dark}.svg`, chosen by
 * `components/theme/ThemeFavicon.tsx` to follow the app's theme.
 */
export function AriaMark({ size = 24, label, className = "" }: { size?: number; label?: string; className?: string }) {
  const small = size < 24;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={`shrink-0 ${className}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <rect width="64" height="64" rx={small ? 14 : 16} fill="var(--accent)" />
      <path
        d={small ? "M18 48L32 15L46 48" : "M19 47L32 17L45 47"}
        fill="none"
        stroke="var(--accent-on)"
        strokeWidth={small ? 7.5 : 6.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="32" cy={small ? 40.5 : 39.5} r={small ? 4.3 : 3.8} fill="var(--accent-on)" />
    </svg>
  );
}

/** The mark with the name beside it, as it sits in a header. */
export function AriaLockup({ size = 24, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <AriaMark size={size} />
      <span className="font-semibold leading-none tracking-[-0.01em] text-[var(--hud-text)]" style={{ fontSize: Math.round(size * 0.75) }}>
        Aria
      </span>
    </span>
  );
}
