"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Hand, ToggleLeft, ToggleRight } from "lucide-react";

const STORAGE_KEY = "aria.deaf.signing.enabled";
const SignLanguagePanel = dynamic(() => import("./SignLanguagePanel"), {
  ssr: false,
  loading: () => <div className="grid min-h-[17rem] place-items-center text-xs font-bold text-[var(--hud-text-dim)]">Preparing signing hand…</div>,
});

export function DeafSigningExtension({ transcript, active }: { transcript: string; active: boolean }) {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      setEnabled(saved === null ? true : saved === "true");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const toggle = () => {
    setEnabled((current) => {
      const next = !current;
      window.localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  };

  return (
    <section className="shrink-0 overflow-hidden rounded-lg border border-[var(--accent-deaf)]/25 bg-[var(--hud-surface)]" aria-label="Sign language support">
      <div className="flex items-center gap-2 border-b border-[var(--hud-line)] px-3 py-2.5">
        <Hand size={15} className="text-[var(--accent-deaf)]" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[0.65rem] font-black uppercase tracking-[0.14em] text-[var(--hud-text-dim)]">Signing support</p>
          <p className="text-[0.65rem] text-[var(--hud-text-dim)]">Pose-synced to the live caption</p>
        </div>
        <button
          type="button"
          onClick={toggle}
          disabled={enabled === null}
          title={enabled ? "Turn off signing support" : "Turn on signing support"}
          aria-label={enabled ? "Turn off signing support" : "Turn on signing support"}
          aria-pressed={enabled === true}
          className="grid size-9 place-items-center rounded-md text-[var(--accent-deaf)] transition hover:bg-[var(--hud-surface-2)] disabled:opacity-40"
        >
          {enabled ? <ToggleRight size={24} aria-hidden /> : <ToggleLeft size={24} aria-hidden />}
        </button>
      </div>

      {enabled === true && <SignLanguagePanel transcript={transcript} active={active} />}
      {enabled === false && (
        <button type="button" onClick={toggle} className="w-full px-4 py-5 text-left text-xs font-semibold text-[var(--hud-text-dim)] hover:bg-[var(--hud-surface-2)]">
          Signing support is off. Captions are unchanged.
        </button>
      )}
    </section>
  );
}
