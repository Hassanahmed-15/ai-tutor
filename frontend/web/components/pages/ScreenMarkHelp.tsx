"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MessageCircleQuestion, MousePointerClick, PenLine, X } from "lucide-react";
import { markKeys, useDesktopApp } from "@/lib/desktopApp";

/**
 * HOW TO MARK YOUR SCREEN, in the desktop app only (lib/desktopApp.ts): a "Mark" door in the front
 * page's top bar, beside Guide, that opens the shortcut as key caps and three short lines in a small
 * panel under it. Kept out of the page itself so Courses stays in view. A dot on the door until it
 * has been opened once; the same step is also in the Guide.
 */
const SEEN_KEY = "aria.screenMark.seen";

export function ScreenMarkHelp() {
  const { desktop, mac } = useDesktopApp();
  const seenStored = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return localStorage.getItem(SEEN_KEY) === "1";
      } catch {
        return true;
      }
    },
    () => true,
  );
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // Esc or a click outside closes it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  if (!desktop) return null;

  function toggle() {
    setOpen((o) => !o);
    setSeen(true);
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // A blocked store shows the dot again next time.
    }
  }

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="screen-mark-help"
        className={`relative flex h-12 w-14 flex-col items-center justify-center gap-0.5 rounded-[var(--radius)] transition-colors hover:bg-[var(--hud-surface-2)] ${open ? "text-[var(--hud-text)]" : "text-[var(--hud-text-dim)] hover:text-[var(--hud-text)]"}`}
      >
        <span aria-hidden="true"><MousePointerClick size={18} strokeWidth={1.7} /></span>
        <span className="text-[0.625rem] font-medium tracking-[0.02em]">Mark</span>
        {!seen && !seenStored && <span aria-hidden="true" className="aria-breathe absolute right-2.5 top-1.5 size-2 rounded-full bg-[var(--hud-cyan)]" />}
      </button>

      {open && (
        <section
          id="screen-mark-help"
          aria-labelledby="screen-mark-title"
          className="absolute right-0 top-[3.25rem] z-30 w-[min(23rem,calc(100vw-2rem))] rounded-[16px] border border-[var(--hud-line)] bg-[var(--hud-surface)] p-5 text-left shadow-[var(--elev-2)]"
        >
          <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="absolute right-3 top-3 grid size-8 place-items-center rounded-full text-[var(--hud-text-faint)] hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]">
            <X aria-hidden="true" size={15} />
          </button>
          <h2 id="screen-mark-title" className="pr-8 font-display text-[1.3rem] leading-tight text-[var(--hud-text)]">Mark anything on your screen</h2>
          <p className="mt-1 text-[0.8125rem] text-[var(--hud-text-dim)]">In any app, website, PDF or video, Aria explains what you point at.</p>

          <div className="mt-3.5 flex flex-wrap items-center gap-1.5" aria-label={`Press ${markKeys(mac).join(" + ")}`}>
            {markKeys(mac).map((k, i) => (
              <span key={k} className="flex items-center gap-1.5">
                {i > 0 && <span aria-hidden="true" className="text-[var(--hud-text-faint)]">+</span>}
                <kbd className="rounded-[8px] border border-[var(--hud-line-strong)] border-b-[3px] bg-[var(--hud-surface-2)] px-2 py-0.5 font-sans text-[0.875rem] font-medium text-[var(--hud-text)]">{k}</kbd>
              </span>
            ))}
          </div>

          <ol className="mt-3.5 grid gap-2.5 text-[0.85rem] text-[var(--hud-text)]">
            <Step icon={<MousePointerClick size={16} strokeWidth={1.8} />}>
              <b className="font-medium">Click</b> on a word, formula or picture, or <b className="font-medium">circle</b> it. Esc cancels.
            </Step>
            <Step icon={<PenLine size={16} strokeWidth={1.8} />}>Aria explains it out loud and draws it on a little board.</Step>
            <Step icon={<MessageCircleQuestion size={16} strokeWidth={1.8} />}>
              Want more? Say <b className="font-medium">“Aria, …”</b> and your question, or type it under the board.
            </Step>
          </ol>
          {mac && <p className="mt-3 text-[0.72rem] leading-snug text-[var(--hud-text-faint)]">First time on a Mac: allow Aria under System Settings → Privacy &amp; Security → Screen Recording and Microphone.</p>}
        </section>
      )}
    </div>
  );
}

function Step({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span aria-hidden="true" className="mt-px grid size-6 shrink-0 place-items-center rounded-full bg-[var(--hud-surface-2)] text-[var(--hud-cyan)]">{icon}</span>
      <span className="leading-snug">{children}</span>
    </li>
  );
}
