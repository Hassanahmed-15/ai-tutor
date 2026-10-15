"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BookOpenCheck,
  FileText,
  Mic,
  Network,
  PenLine,
  Accessibility,
  X,
  MonitorPlay,
} from "lucide-react";
import { AriaLockup } from "@/components/brand/AriaMark";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { DotAvatar, type DotGaze } from "@/components/avatar/DotAvatar";
import { savePendingTopic } from "@/lib/pendingTopic";

/**
 * THE FRONT DOOR for someone without an account (owner's ask, 2026-10-13: "make the sign-up page
 * look like a home screen before signing up", after a marketing landing page they liked).
 *
 * The one thing it asks is the thing the app does: "what do you want to learn?". Typing a topic and
 * pressing Generate opens sign-up with that topic named, and the topic waits in sessionStorage
 * (lib/pendingTopic.ts) through sign-up, a Google round trip and onboarding; the home page then
 * starts the lesson on it. Log in / Sign up open the same form in a dialog over the page.
 *
 * Everything said here is true of the product today — no visitor counts, no institution logos.
 */
const EXAMPLES = ["Photosynthesis", "Newton's laws", "Fractions"];

// Few words on purpose (owner, 2026-10-13: "less text"): an icon and a label, no paragraphs.
const FEATURES = [
  { icon: PenLine, title: "Drawn as she teaches" },
  { icon: Mic, title: "Ask out loud" },
  { icon: FileText, title: "Your PDFs" },
  { icon: MonitorPlay, title: "YouTube videos" },
  { icon: Network, title: "Knowledge map" },
  { icon: Accessibility, title: "For every learner" },
];

type AuthMode = "login" | "signup";

export function WelcomePage({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [topic, setTopic] = useState("");
  // A provider sign-in that failed comes back with the reason in the URL: open the form to show it.
  const [auth, setAuth] = useState<{ mode: AuthMode; topic: string } | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).has("auth_error") ? { mode: "login", topic: "" } : null;
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);

  function open(mode: AuthMode, withTopic = "") {
    opener.current = document.activeElement as HTMLElement | null;
    savePendingTopic(withTopic);
    setAuth({ mode, topic: withTopic.trim() });
  }
  function close() {
    setAuth(null);
    opener.current?.focus?.();
  }
  function generate() {
    const t = topic.trim();
    if (!t) {
      inputRef.current?.focus();
      return;
    }
    open("signup", t);
  }

  // The dialog: Escape closes it, focus moves into it, the page behind does not scroll.
  useEffect(() => {
    if (!auth) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>("input, button:not([data-close])")?.focus();
    }, 30);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth?.mode, Boolean(auth)]);

  return (
    <main className="hud-canvas welcome relative min-h-screen overflow-x-clip">
      {/* The glow behind the hero: two soft lights in the accent, nothing that moves. */}
      <div aria-hidden="true" className="welcome-glow pointer-events-none absolute inset-x-0 top-0 h-[880px]" />

      <header className="relative z-20 mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:h-20 sm:px-6">
        <AriaLockup size={30} />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => open("login")}
            className="h-10 rounded-full px-4 text-[0.92rem] font-medium text-[var(--hud-text)] transition-colors hover:bg-[var(--hud-surface-2)]"
          >
            Log in
          </button>
          <button
            type="button"
            onClick={() => open("signup")}
            className="hud-btn-primary h-10 rounded-full px-5 text-[0.92rem]"
            style={{ borderRadius: 999 }}
          >
            Sign up
          </button>
        </div>
      </header>

      {/* THE HERO */}
      <section className="relative z-10 mx-auto flex w-full max-w-4xl flex-col items-center px-4 pb-16 pt-10 text-center sm:px-6 sm:pt-16">
        <h1 className="hud-materialize font-display max-w-3xl text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.02em] text-[var(--hud-text)] sm:text-[4rem]">
          Learn anything,{" "}
          <span className="welcome-ink">taught live</span> on a board
        </h1>
        <p className="hud-materialize mt-5 text-[1.02rem] text-[var(--hud-text-dim)] sm:text-[1.15rem]">
          Type a topic. Aria teaches it, out loud.
        </p>

        <form
          id="start"
          className="hud-materialize mt-9 w-full max-w-2xl scroll-mt-24"
          onSubmit={(e) => { e.preventDefault(); generate(); }}
        >
          <div className="welcome-box flex items-center gap-2 rounded-full border border-[var(--hud-line-strong)] bg-[var(--hud-surface)] p-2 pl-5 focus-within:border-[var(--accent)]">
            <label htmlFor="welcome-topic" className="sr-only">What do you want to learn?</label>
            <BookOpenCheck aria-hidden="true" size={20} className="hidden shrink-0 text-[var(--hud-text-faint)] sm:block" />
            <input
              ref={inputRef}
              id="welcome-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Type any topic…"
              autoComplete="off"
              className="h-11 min-w-0 flex-1 bg-transparent text-[1rem] text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:outline-none sm:text-[1.05rem]"
            />
            <button
              type="submit"
              className="hud-btn-primary inline-flex h-11 shrink-0 items-center gap-2 px-5 text-[0.95rem] font-semibold"
              style={{ borderRadius: 999 }}
            >
              Generate <ArrowRight aria-hidden="true" size={16} />
            </button>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2" aria-label="Examples">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => { setTopic(ex); inputRef.current?.focus(); }}
                className="rounded-full border border-[var(--hud-line)] bg-[color-mix(in_srgb,var(--hud-surface)_60%,transparent)] px-3 py-1 text-[0.8rem] text-[var(--hud-text-dim)] transition-colors hover:border-[var(--hud-line-strong)] hover:text-[var(--hud-text)]"
              >
                {ex}
              </button>
            ))}
          </div>
        </form>

        <BoardPreview />
      </section>

      {/* WHAT SHE DOES: an icon and a label each. */}
      <section className="relative z-10 mx-auto w-full max-w-5xl px-4 py-12 sm:px-6">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {FEATURES.map(({ icon: Icon, title }) => (
            <li key={title} className="flex flex-col items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--hud-line)] bg-[var(--hud-surface)] px-3 py-6 text-center">
              <Icon aria-hidden="true" size={24} strokeWidth={1.8} className="text-[var(--accent-ink)]" />
              <span className="text-[0.9rem] font-medium text-[var(--hud-text)]">{title}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* THE LAST ASK */}
      <section className="relative z-10 mx-auto w-full max-w-5xl px-4 pb-20 pt-8 sm:px-6">
        <div className="welcome-cta flex flex-col items-center rounded-[20px] border border-[var(--hud-line-strong)] px-6 py-12 text-center">
          <h2 className="font-display text-[1.8rem] font-semibold tracking-[-0.01em] text-[var(--hud-text)] sm:text-[2.25rem]">
            What will you learn first?
          </h2>
          <button
            type="button"
            onClick={() => open("signup", topic)}
            className="hud-btn-primary mt-7 inline-flex h-12 items-center gap-2 px-7 text-[1rem] font-semibold"
            style={{ borderRadius: 999 }}
          >
            Sign up free <ArrowRight aria-hidden="true" size={16} />
          </button>
        </div>
      </section>

      <footer className="relative z-10 border-t border-[var(--hud-line)] py-8 text-center text-[0.8rem] text-[var(--hud-text-faint)]">
        © {new Date().getFullYear()} Aria
      </footer>

      {auth && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto p-4">
          <button type="button" aria-label="Close" tabIndex={-1} onClick={close} className="fixed inset-0 bg-[var(--scrim)] backdrop-blur-sm" />
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={auth.mode === "signup" ? "Create your Aria account" : "Sign in to Aria"}
            className="welcome-dialog relative my-6 w-full max-w-[26rem] rounded-[18px] border border-[var(--hud-line)] bg-[var(--hud-bg)] px-6 pb-8 pt-10 shadow-[var(--elev-2)] sm:px-8"
          >
            <button
              type="button"
              data-close
              onClick={close}
              aria-label="Close"
              className="absolute right-3 top-3 grid size-9 place-items-center rounded-full text-[var(--hud-text-dim)] hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]"
            >
              <X aria-hidden="true" size={17} />
            </button>
            <AuthScreen
              key={auth.mode}
              embedded
              initialMode={auth.mode}
              note={auth.topic ? `Your first lesson, “${auth.topic}”, starts as soon as you're in.` : undefined}
              onAuthenticated={onAuthenticated}
            />
          </div>
        </div>
      )}
    </main>
  );
}

/**
 * A board mid-lesson, so a visitor sees what "taught on a board" means before reading about it:
 * a diagram that draws itself, one line of what Aria is saying, and Dot beside it looking at the
 * pointer. With less motion asked for, the drawing is simply there.
 */
function BoardPreview() {
  const gaze = useRef<DotGaze>(null);
  const dotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let last: PointerEvent | null = null;
    const paint = () => {
      frame = 0;
      const box = dotRef.current?.getBoundingClientRect();
      if (!last || !box) return;
      const dx = last.clientX - (box.left + box.width / 2);
      const dy = last.clientY - (box.top + box.height * 0.42);
      const reach = Math.max(1, Math.hypot(dx, dy));
      const pull = Math.min(1, reach / 320);
      gaze.current = { x: (dx / reach) * pull, y: (dy / reach) * pull };
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      last = e;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <figure className="hud-materialize relative mt-14 w-full max-w-3xl" aria-label="A lesson on photosynthesis being drawn on Aria's board">
      <div className="welcome-board overflow-hidden bg-[#141428] rounded-[18px] border border-[var(--hud-line-strong)] text-left shadow-[var(--elev-2)]">
        <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-white/20" />
          <span className="size-2.5 rounded-full bg-white/20" />
          <span className="size-2.5 rounded-full bg-white/20" />
                  </div>
now        <svg viewBox="0 0 640 300" className="block h-auto w-full" aria-hidden="true">
          <text x="34" y="52" className="welcome-chalk-title" fill="#F5F3FF">How a leaf makes food</text>
          <path className="welcome-draw" style={{ animationDelay: "0.2s" }} pathLength={1} d="M34 66 H300" stroke="#F5C86B" strokeWidth="3" fill="none" strokeLinecap="round" />

          {/* sun */}
          <g className="welcome-pop" style={{ animationDelay: "0.6s" }}>
            <circle cx="96" cy="164" r="30" fill="none" stroke="#F5C86B" strokeWidth="3" />
            {Array.from({ length: 8 }, (_, i) => {
              const a = (i * Math.PI) / 4;
              return <line key={i} x1={96 + Math.cos(a) * 40} y1={164 + Math.sin(a) * 40} x2={96 + Math.cos(a) * 52} y2={164 + Math.sin(a) * 52} stroke="#F5C86B" strokeWidth="3" strokeLinecap="round" />;
            })}
            <text x="96" y="242" textAnchor="middle" className="welcome-chalk" fill="#EDEAF7">light</text>
          </g>

          <path className="welcome-draw" style={{ animationDelay: "1.2s" }} pathLength={1} d="M160 164 C 200 150, 230 150, 262 160" stroke="#EDEAF7" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path className="welcome-pop" style={{ animationDelay: "1.6s" }} d="M252 150 L264 161 L250 170" stroke="#EDEAF7" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />

          {/* leaf */}
          <g className="welcome-pop" style={{ animationDelay: "1.9s" }}>
            <path d="M290 170 C 300 110, 370 100, 400 120 C 392 175, 340 200, 290 170 Z" fill="rgba(110,219,154,0.16)" stroke="#6EDB9A" strokeWidth="3" />
            <path d="M296 166 C 330 150, 360 136, 394 124" stroke="#6EDB9A" strokeWidth="2" fill="none" />
            <text x="345" y="226" textAnchor="middle" className="welcome-chalk" fill="#EDEAF7">leaf</text>
          </g>

          <path className="welcome-draw" style={{ animationDelay: "2.6s" }} pathLength={1} d="M418 150 C 450 140, 474 140, 502 148" stroke="#EDEAF7" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path className="welcome-pop" style={{ animationDelay: "3s" }} d="M492 138 L504 149 L490 158" stroke="#EDEAF7" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />

          <g className="welcome-pop" style={{ animationDelay: "3.3s" }}>
            <text x="524" y="140" className="welcome-chalk-strong" fill="#F5C86B">sugar</text>
            <text x="524" y="176" className="welcome-chalk" fill="#EDEAF7">+ oxygen</text>
          </g>
          <g className="welcome-pop" style={{ animationDelay: "3.8s" }}>
            <text x="300" y="80" className="welcome-chalk-dim" fill="#B3B0D4">water + CO₂ go in</text>
            <path d="M330 88 L338 112" stroke="#B3B0D4" strokeWidth="2" fill="none" strokeLinecap="round" strokeDasharray="4 5" />
          </g>
        </svg>
        <figcaption className="flex items-center gap-2 border-t border-white/10 px-4 py-3 text-[0.85rem] text-white/80">
          <span className="aria-breathe size-2 shrink-0 rounded-full bg-[#F0ABFC]" />
          “The leaf catches light and uses it to turn water and carbon dioxide into sugar.”
        </figcaption>
      </div>
      <div ref={dotRef} className="welcome-dot absolute -right-3 -top-12 size-[96px] sm:-right-10 sm:-top-14 sm:size-[124px]" aria-hidden="true">
        <DotAvatar state="idle" gaze={gaze} className="h-full w-full drop-shadow-[0_10px_28px_rgba(110,80,230,0.45)]" />
      </div>
    </figure>
  );
}
