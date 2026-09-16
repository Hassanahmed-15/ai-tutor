"use client";

import { useState } from "react";
import { Copy, Highlighter, ListPlus, Sparkles, Check } from "lucide-react";
import { HIGHLIGHT_COLORS } from "@/lib/viewerTypes";

/**
 * The floating toolbar that appears above a text selection.
 *
 * Plain browser Ctrl/Cmd+C already works on the text layer without any of this — the toolbar is an
 * ADDITIONAL surface for the actions a copy-paste cannot do: highlighting, collecting into the
 * side panel, and asking the tutor about the selection. It is positioned entirely in screen space
 * (viewport coordinates from the selection's own bounding rect), so it tracks correctly regardless
 * of scroll position, zoom, or which page the selection is on.
 */
export function SelectionToolbar({
  anchorRect,
  selectionVersion,
  onCopy,
  onHighlight,
  onCollect,
  onAsk,
}: {
  /** The selection's bounding box in viewport coordinates, or null to hide the toolbar. */
  anchorRect: DOMRect | null;
  /** Increments each time the browser selection genuinely changes — see DocumentViewer.tsx. Used,
   *  not `anchorRect` itself, to key the "this is a fresh selection" reset below: a DOMRect is a
   *  new object every read even for the SAME selection (e.g. on an unrelated re-render), so
   *  comparing rect identity would reset the toolbar's local state far more often than intended. */
  selectionVersion: number;
  onCopy: () => void;
  onHighlight: (color: string) => void;
  onCollect: () => void;
  onAsk: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  // Which selection the state above was reset for — compared during render (React's documented
  // "adjusting state when a prop changes" pattern) rather than inside a useEffect, for the same
  // reason usePdfDocument.ts and SearchPanel.tsx do the same thing: a change that must be visible
  // on the very next paint cannot wait for an effect to run after that paint has already happened.
  const [resetForVersion, setResetForVersion] = useState(selectionVersion);
  if (selectionVersion !== resetForVersion) {
    setCopied(false);
    setColorPickerOpen(false);
    setResetForVersion(selectionVersion);
  }

  if (!anchorRect) return null;

  const top = Math.max(8, anchorRect.top - 52);
  const left = Math.min(
    Math.max(8, anchorRect.left + anchorRect.width / 2 - 110),
    window.innerWidth - 228,
  );

  return (
    <div
      role="toolbar"
      aria-label="Selection actions"
      className="viewer-selection-toolbar fixed z-50 flex items-center gap-0.5 rounded-xl border border-[var(--hud-line-strong)] bg-[var(--hud-bg-2)] p-1 shadow-[0_8px_32px_rgba(0,0,0,0.5)] backdrop-blur"
      style={{ top, left }}
      // Selection collapses on mousedown outside the text layer; stopping it here means clicking a
      // toolbar button does not first destroy the very selection the button is about to act on.
      onMouseDown={(e) => e.preventDefault()}
    >
      <ToolbarButton
        label={copied ? "Copied" : "Copy"}
        icon={copied ? Check : Copy}
        onClick={() => {
          onCopy();
          setCopied(true);
        }}
      />
      <div className="relative">
        <ToolbarButton label="Highlight" icon={Highlighter} onClick={() => setColorPickerOpen((v) => !v)} />
        {colorPickerOpen && (
          <div className="absolute left-1/2 top-full mt-1.5 flex -translate-x-1/2 gap-1.5 rounded-lg border border-[var(--hud-line)] bg-[var(--hud-bg-2)] p-1.5 shadow-lg">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.name}
                aria-label={`Highlight in ${c.name}`}
                onClick={() => {
                  onHighlight(c.value);
                  setColorPickerOpen(false);
                }}
                className="size-6 rounded-full border border-white/20 transition hover:scale-110"
                style={{ background: c.value }}
              />
            ))}
          </div>
        )}
      </div>
      <ToolbarButton label="Add to Collection" icon={ListPlus} onClick={onCollect} />
      <div className="mx-0.5 h-5 w-px bg-[var(--hud-line-strong)]" />
      <ToolbarButton label="Ask AI" icon={Sparkles} accent onClick={onAsk} />
    </div>
  );
}

function ToolbarButton({
  label,
  icon: Icon,
  accent,
  onClick,
}: {
  label: string;
  icon: typeof Copy;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
        accent
          ? "text-[var(--hud-cyan-bright)] hover:bg-[var(--hud-cyan-glow-soft)]"
          : "text-[var(--hud-text-dim)] hover:bg-[var(--hud-surface-2)] hover:text-[var(--hud-text)]"
      }`}
    >
      <Icon className="size-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
