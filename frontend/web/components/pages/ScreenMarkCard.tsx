"use client";

import { useState, useSyncExternalStore } from "react";
import { MessageCircleQuestion, MousePointerClick, PenLine, X } from "lucide-react";
import { markKeys, useDesktopApp } from "@/lib/desktopApp";

/**
 * HOW TO MARK YOUR SCREEN, on the front page of the desktop app only (lib/desktopApp.ts): the
 * shortcut as key caps, then what to do and what happens, in three short lines. Closing it is
 * remembered; the same steps stay in the Guide.
 */
const HIDDEN_KEY = "aria.screenMarkCard.hidden";

export function ScreenMarkCard() {
  const { desktop, mac } = useDesktopApp();
  const storedHidden = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return localStorage.getItem(HIDDEN_KEY) === "1";
      } catch {
        return false;
      }
    },
    () => true,
  );
  const [closed, setClosed] = useState(false);
  if (!desktop || storedHidden || closed) return null;

  function close() {
    setClosed(true);
    try {
      localStorage.setItem(HIDDEN_KEY, "1");
    } catch {
      // A blocked store shows it again next time.
    }
  }

  return (
    <section aria-labelledby="screen-mark-title" className="home-lift relative rounded-[16px] border border-[var(--hud-line)] bg-[var(--hud-surface)] p-5 shadow-[var(--elev-1)]">
      <button type="button" onClick={close} aria-label="Hide these instructions" className="absolute right-3 top-3 grid size-8 place-items-center rounded-full text-[var(--hud-text-faint)] hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]">
        <X aria-hidden="true" size={15} />
      </button>
      <h2 id="screen-mark-title" className="pr-8 font-display text-[1.45rem] leading-tight text-[var(--hud-text)]">Mark anything on your screen</h2>
      <p className="mt-1 text-[0.875rem] text-[var(--hud-text-dim)]">In any app, a website, a PDF or a video, Aria explains what you point at.</p>

      <div className="mt-4 flex flex-wrap items-center gap-1.5" aria-label={`Press ${markKeys(mac).join(" + ")}`}>
        {markKeys(mac).map((k, i) => (
          <span key={k} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true" className="text-[var(--hud-text-faint)]">+</span>}
            <kbd className="rounded-[8px] border border-[var(--hud-line-strong)] border-b-[3px] bg-[var(--hud-surface-2)] px-2.5 py-1 font-sans text-[0.95rem] font-medium text-[var(--hud-text)]">{k}</kbd>
          </span>
        ))}
        <span className="ml-1 text-[0.8125rem] text-[var(--hud-text-faint)]">from anywhere</span>
      </div>

      <ol className="mt-4 grid gap-2.5 text-[0.9rem] text-[var(--hud-text)]">
        <Step icon={<MousePointerClick size={17} strokeWidth={1.8} />}>
          <b className="font-medium">Click</b> on a word, formula or picture, or <b className="font-medium">circle</b> it. Esc cancels.
        </Step>
        <Step icon={<PenLine size={17} strokeWidth={1.8} />}>Aria explains it out loud and draws it on a little board.</Step>
        <Step icon={<MessageCircleQuestion size={17} strokeWidth={1.8} />}>
          Want more? Say <b className="font-medium">“Aria, …”</b> and your question, or type it under the board.
        </Step>
      </ol>
      {mac && <p className="mt-3 text-[0.75rem] text-[var(--hud-text-faint)]">First time on a Mac: allow Aria under System Settings → Privacy &amp; Security → Screen Recording and Microphone.</p>}
    </section>
  );
}

function Step({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span aria-hidden="true" className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-[var(--hud-surface-2)] text-[var(--hud-cyan)]">{icon}</span>
      <span className="leading-snug">{children}</span>
    </li>
  );
}
