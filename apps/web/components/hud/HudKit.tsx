"use client";

import type { ReactNode } from "react";

/**
 * Shared holographic-HUD UI primitives — replaces the sunset components/lux/LuxKit.tsx. The
 * design language: deep navy-black canvas, cyan-white emissive glow, corner-bracket "reticle"
 * chrome, monospace data-label type. Used across every redesigned page so the whole product
 * reads as one instrument, not a luxury brochure.
 */

export type PageName =
  | "landing"
  | "tracks"
  | "about"
  | "features"
  | "complete"
  | "learn"
  // lesson players (kept as routes so nav can return to them)
  | "demo"
  | "blind-demo"
  | "adhd-demo"
  | "deaf-demo"
  | "dyslexia-demo";

/** Four corner-bracket reticle marks, the HUD's signature motif. Purely static (no
 *  animation) — safe for every accessibility track, including ADHD and Autism. */
export function HudCorners({ accent }: { accent?: string }) {
  const style = accent ? { borderColor: accent } : undefined;
  return (
    <>
      <span className="hud-corner hud-corner-tl" style={style} />
      <span className="hud-corner hud-corner-tr" style={style} />
      <span className="hud-corner hud-corner-bl" style={style} />
      <span className="hud-corner hud-corner-br" style={style} />
    </>
  );
}

/** The glass instrument panel — replaces .lux-card / <div className="lux-card"> one-for-one.
 *  `corners` is on by default (the signature motif). `scan` is OFF by default: the animated
 *  sweep is opt-in per panel, never ambient/global, so accessibility tracks that are sensitive
 *  to motion (ADHD, Autism) simply never pass it. */
export function HudPanel({
  children,
  className = "",
  corners = true,
  scan = false,
  hover = false,
  accent,
}: {
  children: ReactNode;
  className?: string;
  corners?: boolean;
  scan?: boolean;
  hover?: boolean;
  accent?: string;
}) {
  return (
    <div className={`hud-panel relative ${hover ? "hud-panel-hover" : ""} ${scan ? "hud-scan" : ""} ${className}`}>
      {corners && <HudCorners accent={accent} />}
      {/* display:contents removes this wrapper from layout entirely — children become direct
          flex/grid items of the outer div above instead of being boxed inside an extra block
          element. Without this, any caller passing multi-child flex layout on the outer div
          (flex-row with gap/justify-between, or a flex-col that needs an inner child to
          shrink/scroll via flex-1 + min-h-0) silently didn't work: the outer div only ever had
          ONE actual flex item (this wrapper), so gap/justify-between/flex-1/min-h-0 were all
          no-ops, and overflowing content in a scrollable child got clipped (via the outer's
          overflow-hidden) instead of scrolling — the "no scrollbar" bug in the lesson chat
          panel. The outer div already provides its own `relative` positioning context, so
          absolutely-positioned children losing this wrapper's own `position:relative` is fine. */}
      <div style={{ display: "contents" }}>{children}</div>
    </div>
  );
}

/** The animated logo mark — an interlocking 'A' rendered in cyan glow instead of gold. */
export function HudLogo({ size = 34, onClick }: { size?: number; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="group flex items-center gap-3" aria-label="Aria home">
      <span className="relative grid place-items-center" style={{ width: size, height: size }}>
        <svg viewBox="0 0 40 40" width={size} height={size} className="relative">
          <defs>
            <linearGradient id="hud-logo-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#aef5ec" />
              <stop offset="100%" stopColor="#1f9e92" />
            </linearGradient>
          </defs>
          <circle cx="20" cy="20" r="18.5" fill="none" stroke="url(#hud-logo-grad)" strokeWidth="1.2" opacity="0.6" />
          <path d="M20 9 L29 30 L24.5 30 L20 19 L15.5 30 L11 30 Z" fill="url(#hud-logo-grad)" />
          <circle cx="20" cy="24.5" r="1.6" fill="#06080d" />
        </svg>
      </span>
      <span className="font-display text-xl tracking-tight text-[var(--hud-text)]">Aria</span>
    </button>
  );
}

/** Top navigation bar shared by all marketing pages. */
export function HudNav({ current, go, onStart }: { current: PageName; go: (p: PageName) => void; onStart: () => void }) {
  const links: { label: string; page: PageName }[] = [
    { label: "Home", page: "landing" },
    { label: "Modes", page: "tracks" },
    { label: "How it works", page: "features" },
    { label: "Manifesto", page: "about" },
  ];
  return (
    <nav className="relative z-20 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
      <HudLogo onClick={() => go("landing")} />
      <div className="hidden items-center gap-8 md:flex">
        {links.map((l) => (
          <button
            key={l.page}
            onClick={() => go(l.page)}
            className={`hud-eyebrow text-[0.68rem] normal-case tracking-[0.08em] transition-colors ${
              current === l.page ? "text-[var(--hud-cyan)]" : "text-[var(--hud-text-dim)] hover:text-[var(--hud-text)]"
            }`}
            style={{ fontWeight: 600 }}
          >
            {l.label}
          </button>
        ))}
      </div>
      <button onClick={onStart} className="hud-btn-primary rounded-full px-5 py-2.5 text-sm font-bold">
        Begin a lesson
      </button>
    </nav>
  );
}

/** Shared page shell: canvas + grain + nav + footer. */
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

export function HudFooter({ go }: { go: (p: PageName) => void }) {
  return (
    <footer className="relative z-10 mx-auto mt-24 w-full max-w-6xl px-6 pb-12">
      <div className="h-px w-full bg-[var(--hud-line)]" />
      <div className="flex flex-col items-center justify-between gap-6 pt-8 sm:flex-row">
        <HudLogo onClick={() => go("landing")} size={28} />
        <p className="hud-eyebrow text-[0.65rem] normal-case tracking-[0.04em] text-[var(--hud-text-faint)]">
          One lesson, many minds. © {new Date().getFullYear()} Aria.
        </p>
        <div className="flex gap-6 text-xs text-[var(--hud-text-dim)]">
          <button onClick={() => go("tracks")} className="hover:text-[var(--hud-cyan)]">Modes</button>
          <button onClick={() => go("features")} className="hover:text-[var(--hud-cyan)]">How it works</button>
          <button onClick={() => go("about")} className="hover:text-[var(--hud-cyan)]">Manifesto</button>
        </div>
      </div>
    </footer>
  );
}

/** `.hud-eyebrow` deliberately carries no color (see the comment in globals.css), so this
 *  component supplies the default cyan via inline style — inline styles always win the
 *  cascade regardless of source order, unlike stacking two same-specificity classes. Pass
 *  `color` to use a per-mode accent instead. */
export function HudEyebrow({ children, color = "var(--hud-cyan)" }: { children: ReactNode; color?: string }) {
  return (
    <span className="hud-eyebrow" style={{ color }}>
      {children}
    </span>
  );
}

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
      className={`rounded-full px-7 py-3 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
        variant === "primary" ? "hud-btn-primary" : "hud-btn-ghost"
      } ${className}`}
    >
      {children}
    </button>
  );
}

/** A thin animated divider rule with a centered cyan diamond. */
export function HudDivider() {
  return (
    <div className="mx-auto flex w-full max-w-xs items-center gap-4 py-2">
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-[var(--hud-line-strong)]" />
      <span className="size-1.5 rotate-45 bg-[var(--hud-cyan)]" />
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-[var(--hud-line-strong)]" />
    </div>
  );
}
