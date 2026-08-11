"use client";

import { useId, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/**
 * An icon control with a real tooltip.
 *
 * The brief asks for familiar icons with tooltips instead of large text-filled rounded buttons.
 * The constraint that makes this non-trivial is accessibility: an icon-only control is invisible
 * to a screen reader unless it carries a name, and a tooltip that only appears on hover is
 * useless to a keyboard user.
 *
 * So: `aria-label` always carries the name, the tooltip shows on hover AND on keyboard focus, and
 * it is `aria-hidden` because the label already conveys it (announcing both would double-speak).
 * The tooltip is positioned with `absolute` inside a `relative` wrapper rather than a portal, so
 * it never causes a layout shift when it appears.
 */
export function IconButton({
  icon: Icon,
  label,
  onClick,
  active = false,
  disabled = false,
  tone = "default",
  shortcut,
  size = "md",
}: {
  icon: LucideIcon;
  /** The accessible name, and the tooltip text. Required — an unnamed icon button is unusable. */
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  tone?: "default" | "danger";
  /** Shown in the tooltip, e.g. "Space". Purely informational. */
  shortcut?: string;
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  const px = size === "sm" ? "size-8" : "size-9";

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active || undefined}
        aria-describedby={open ? tipId : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={`grid ${px} place-items-center rounded-[var(--radius-sm)] border transition-colors
          focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
          focus-visible:outline-[var(--listening)]
          disabled:cursor-not-allowed disabled:opacity-35`}
        style={{
          transitionDuration: "var(--motion-fast)",
          borderColor: active ? "transparent" : "var(--hud-line)",
          background: active
            ? tone === "danger"
              ? "var(--danger-dim)"
              : "var(--listening-dim)"
            : "transparent",
          color: active
            ? tone === "danger"
              ? "var(--hud-danger)"
              : "var(--listening)"
            : tone === "danger"
              ? "var(--hud-danger)"
              : "var(--hud-text-dim)",
        }}
      >
        <Icon aria-hidden="true" size={size === "sm" ? 15 : 17} strokeWidth={1.9} />
      </button>

      {open && !disabled && (
        <span
          id={tipId}
          role="tooltip"
          aria-hidden="true"
          className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-50 -translate-x-1/2
            whitespace-nowrap rounded-[var(--radius-sm)] border px-2.5 py-1.5 text-[0.72rem] leading-none"
          style={{
            background: "var(--hud-bg-2)",
            borderColor: "var(--hud-line)",
            color: "var(--hud-text)",
            boxShadow: "var(--elev-2)",
          }}
        >
          {label}
          {shortcut && <span className="ml-2 text-[var(--hud-text-faint)]">{shortcut}</span>}
        </span>
      )}
    </span>
  );
}

/** A hairline separator between groups of controls in the toolbar. */
export function ControlDivider() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px" style={{ background: "var(--hud-line)" }} />;
}

/** Groups related controls so the toolbar reads as sets rather than an undifferentiated row. */
export function ControlGroup({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1">
      {children}
    </div>
  );
}
