"use client";

import type { ReactNode } from "react";

/**
 * Shared primitives for THE PRESS — the editorial rebuild.
 *
 * The predecessor was a holographic instrument panel: glass cards, corner reticles, emissive
 * cyan, monospace data labels. This kit is its inverse. A page is paper, a panel is a block of
 * type separated by a hairline rule, and hierarchy comes from the size of a serif rather than
 * from glow or fill.
 *
 * Export names are unchanged (`Hud*`) even though nothing here is a HUD any more. They are
 * imported across every page and by the out-of-scope mode players; renaming them would mean
 * editing every call site for no user-visible gain. `HudCorners` in particular survives as a
 * no-op for exactly that reason.
 */

export type PageName =
  | "landing"
  | "tracks"
  | "about"
  | "features"
  | "complete"
  | "learn"
  | "demo"
  // Mode player routes. Nothing in the UI navigates to these while only the standard lecture is
  // offered, but the names stay in the union so those components still typecheck.
  | "blind-demo"
  | "adhd-demo"
  | "deaf-demo"
  | "dyslexia-demo";

/** Retired with the instrument-panel language. Kept because it is called from many components. */
export function HudCorners(_props: { accent?: string }) {
  return null;
}

/**
 * A block of paper. No fill, no blur, no shadow — a rule and its contents.
 *
 * `corners`, `scan` and `accent` are accepted and ignored so existing call sites keep compiling.
 */
export function HudPanel({
  children,
  className = "",
  hover = false,
}: {
  children: ReactNode;
  className?: string;
  corners?: boolean;
  scan?: boolean;
  hover?: boolean;
  accent?: string;
}) {
  return (
    <div className={`hud-panel relative ${hover ? "hud-panel-hover" : ""} ${className}`}>
      <div className="relative">{children}</div>
    </div>
  );
}

/** The masthead. One word, set in the display serif — the logo IS the typography. */
export function HudLogo({ size = 34, onClick }: { size?: number; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="group flex items-baseline gap-2" aria-label="Aria home">
      <span
        className="font-display leading-none tracking-[-0.02em] text-[var(--hud-text)] transition-opacity group-hover:opacity-60"
        style={{ fontSize: size * 0.72 }}
      >
        Aria
      </span>
    </button>
  );
}

/**
 * The masthead rule. A newspaper nameplate: wordmark left, sections right, a rule beneath the
 * whole thing. The active section is marked by ink and an underline, not a pill or a glow.
 */
export function HudNav({ current, go, onStart }: { current: PageName; go: (p: PageName) => void; onStart: () => void }) {
  const links: { label: string; page: PageName }[] = [
    { label: "The Method", page: "tracks" },
    { label: "The Craft", page: "features" },
    { label: "Position", page: "about" },
  ];
  return (
    <nav className="relative z-20 mx-auto w-full max-w-6xl px-6 pt-8">
      <div className="flex items-baseline justify-between gap-6">
        <HudLogo onClick={() => go("landing")} />
        <div className="hidden items-baseline gap-8 md:flex">
          {links.map((l) => (
            <button
              key={l.page}
              onClick={() => go(l.page)}
              className={`pb-0.5 text-[0.82rem] tracking-wide transition-colors ${
                current === l.page
                  ? "border-b border-[var(--hud-cyan)] text-[var(--hud-cyan)]"
                  : "border-b border-transparent text-[var(--hud-text-dim)] hover:text-[var(--hud-text)]"
              }`}
            >
              {l.label}
            </button>
          ))}
          <button
            onClick={onStart}
            className="hud-btn-primary px-5 py-2 text-[0.82rem]"
          >
            Begin
          </button>
        </div>
      </div>
      <hr className="hud-rule mt-5" />
    </nav>
  );
}

/** Page shell: paper, tooth, masthead, colophon. */
export function HudPage({
  current,
  go,
  onStart,
  children,
  hideNav = false,
}: {
  current: PageName;
  go: (p: PageName) => void;
  onStart: () => void;
  children: ReactNode;
  hideNav?: boolean;
}) {
  return (
    <main className="hud-canvas hud-grain relative min-h-screen w-full overflow-x-hidden">
      <div className="relative z-10 flex min-h-screen flex-col">
        {!hideNav && <HudNav current={current} go={go} onStart={onStart} />}
        <div className="flex-1">{children}</div>
        {!hideNav && <HudFooter go={go} />}
      </div>
    </main>
  );
}

/** The colophon. */
export function HudFooter({ go }: { go: (p: PageName) => void }) {
  return (
    <footer className="relative z-10 mx-auto mt-32 w-full max-w-6xl px-6 pb-14">
      <hr className="hud-rule" />
      <div className="flex flex-col items-start justify-between gap-6 pt-7 sm:flex-row sm:items-baseline">
        <HudLogo onClick={() => go("landing")} size={26} />
        <p className="max-w-sm text-xs leading-6 text-[var(--hud-text-faint)]">
          Composed on demand. No lecture here existed before someone asked for it.
        </p>
        <div className="flex gap-6 text-xs text-[var(--hud-text-dim)]">
          <button onClick={() => go("tracks")} className="transition-colors hover:text-[var(--hud-text)]">
            The Method
          </button>
          <button onClick={() => go("features")} className="transition-colors hover:text-[var(--hud-text)]">
            The Craft
          </button>
          <button onClick={() => go("about")} className="transition-colors hover:text-[var(--hud-text)]">
            Position
          </button>
        </div>
      </div>
    </footer>
  );
}

/**
 * A section mark. `.hud-eyebrow` deliberately sets no colour — a Tailwind text utility on the
 * same element has identical specificity, so whichever rule loaded later would win at random.
 * The colour is supplied here inline, which always wins the cascade.
 */
export function HudEyebrow({ children, color = "var(--hud-text-faint)" }: { children: ReactNode; color?: string }) {
  return (
    <span className="hud-eyebrow" style={{ color }}>
      {children}
    </span>
  );
}

/** Square, letterspaced, unrounded. A printed button, not a pill. */
export function HudButton({
  children,
  onClick,
  variant = "primary",
  className = "",
  type = "button",
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost";
  className?: string;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`px-7 py-3 text-sm transition disabled:cursor-not-allowed disabled:opacity-30 ${
        variant === "primary" ? "hud-btn-primary" : "hud-btn-ghost"
      } ${className}`}
    >
      {children}
    </button>
  );
}

/** A hairline rule. The accent diamond it used to carry has no place on a page like this. */
export function HudDivider() {
  return <hr className="hud-rule mx-auto mt-14 w-full max-w-2xl" />;
}

/**
 * A numbered section heading: a rule with a numeral sitting on it and a label beside it. The
 * device that makes a page read as a publication with parts rather than a scroll of sections.
 */
export function HudSection({ numeral, label }: { numeral: string; label: string }) {
  return (
    <div className="flex items-baseline gap-4">
      <span className="hud-eyebrow text-[var(--hud-cyan)]">{numeral}</span>
      <span className="hud-eyebrow text-[var(--hud-text-faint)]">{label}</span>
      <span className="h-px flex-1 bg-[var(--hud-line)]" />
    </div>
  );
}
