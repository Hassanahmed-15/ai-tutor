"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen, X, type LucideIcon } from "lucide-react";
import { IconButton } from "./IconButton";

/**
 * The classroom's structural chrome: status bar, progress, and side panels.
 *
 * These are presentation only. Progress, beat titles and panel contents are passed in from
 * LessonPlayer, which keeps owning all lesson state — the point of extracting them is that the
 * classroom layout can be rebuilt without editing the file that coordinates live audio.
 */

/** A compact top bar: lesson identity on the left, live status on the right. */
export function StatusBar({
  title,
  step,
  total,
  onToggleOutline,
  outlineOpen,
  right,
}: {
  title: string;
  step: number;
  total: number;
  onToggleOutline?: () => void;
  outlineOpen?: boolean;
  right?: ReactNode;
}) {
  const pct = total > 0 ? Math.round(((step + 1) / total) * 100) : 0;

  return (
    <header
      className="flex shrink-0 items-center gap-3 border-b px-3 py-2"
      style={{ borderColor: "var(--hud-line)", background: "var(--hud-bg-2)" }}
    >
      {onToggleOutline && (
        <div className="lg:hidden">
          <IconButton
            icon={outlineOpen ? PanelLeftClose : PanelLeftOpen}
            label={outlineOpen ? "Hide lesson outline" : "Show lesson outline"}
            onClick={onToggleOutline}
            size="sm"
          />
        </div>
      )}

      {/* min-w-0 + truncate: a long generated lesson title must never push the status controls
          off-screen or force the page to scroll horizontally. */}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[0.9rem] font-medium leading-tight text-[var(--hud-text)]">{title}</h1>
        <p className="mt-0.5 text-[0.72rem] leading-none text-[var(--hud-text-faint)]">
          Part {step + 1} of {total}
        </p>
      </div>

      {/* Progress as a bar AND as text, so it does not rely on a visual channel alone. */}
      <div className="hidden items-center gap-2 sm:flex" role="group" aria-label={`Lesson progress: ${pct} percent`}>
        <div className="h-1 w-24 overflow-hidden rounded-full" style={{ background: "var(--hud-line)" }}>
          <div
            className="h-full rounded-full transition-[width]"
            style={{ width: `${pct}%`, background: "var(--hud-text-dim)", transitionDuration: "var(--motion-slow)" }}
          />
        </div>
        <span className="text-[0.72rem] tabular-nums leading-none text-[var(--hud-text-faint)]">{pct}%</span>
      </div>

      {right}
    </header>
  );
}

/**
 * A side panel. On desktop it is a column; below `lg` it becomes an overlay drawer, because a
 * three-column layout on a tablet leaves the board too narrow to read — which would defeat the
 * one rule this screen has (the board is the visual priority).
 *
 * Escape closes it and focus moves to the panel on open, so it is operable without a mouse.
 */
export function SidePanel({
  open,
  onClose,
  title,
  icon: Icon,
  side = "right",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: LucideIcon;
  side?: "left" | "right";
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Scrim, drawer mode only. */}
      <div
        className="fixed inset-0 z-30 bg-black/60 lg:hidden"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={ref}
        tabIndex={-1}
        role="complementary"
        aria-label={title}
        className={`fixed inset-y-0 z-40 flex w-[min(22rem,88vw)] flex-col border-[var(--hud-line)]
          lg:static lg:z-auto lg:w-80 lg:shrink-0
          ${side === "right" ? "right-0 border-l" : "left-0 border-r"}`}
        style={{ background: "var(--hud-bg-2)" }}
      >
        <div
          className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5"
          style={{ borderColor: "var(--hud-line)" }}
        >
          {Icon && <Icon aria-hidden="true" size={15} className="text-[var(--hud-text-faint)]" />}
          <h2 className="flex-1 text-[0.82rem] font-medium text-[var(--hud-text)]">{title}</h2>
          <IconButton icon={X} label={`Close ${title.toLowerCase()}`} onClick={onClose} size="sm" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">{children}</div>
      </aside>
    </>
  );
}

/**
 * The lesson outline. Marks the current beat with colour, a filled dot, AND `aria-current`, so
 * position is conveyed three ways rather than by highlight alone.
 */
export function Outline({
  items,
  current,
  onJump,
}: {
  items: { id: string; title: string }[];
  current: number;
  onJump?: (index: number) => void;
}) {
  return (
    <nav aria-label="Lesson outline">
      <ol className="space-y-0.5">
        {items.map((item, i) => {
          const isCurrent = i === current;
          const done = i < current;
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={onJump ? () => onJump(i) : undefined}
                disabled={!onJump}
                aria-current={isCurrent ? "step" : undefined}
                className="flex w-full items-start gap-2.5 rounded-[var(--radius-sm)] px-2 py-2 text-left transition-colors
                  hover:bg-[var(--hud-surface)] disabled:cursor-default disabled:hover:bg-transparent
                  focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]
                  focus-visible:outline-[var(--listening)]"
                style={{ transitionDuration: "var(--motion-fast)" }}
              >
                <span
                  aria-hidden="true"
                  className="mt-1.5 size-1.5 shrink-0 rounded-full"
                  style={{
                    background: isCurrent
                      ? "var(--listening)"
                      : done
                        ? "var(--hud-text-faint)"
                        : "var(--hud-line-strong)",
                  }}
                />
                <span
                  className="text-[0.82rem] leading-snug"
                  style={{
                    color: isCurrent ? "var(--hud-text)" : done ? "var(--hud-text-dim)" : "var(--hud-text-faint)",
                    fontWeight: isCurrent ? 500 : 400,
                  }}
                >
                  {item.title}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
