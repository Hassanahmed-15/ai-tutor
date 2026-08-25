"use client";

import { useState } from "react";
import {
  DEFAULT_PREFS,
  TINT_COLORS,
  TINT_LABELS,
  type DyslexiaPrefs,
  type DyslexiaTint,
} from "@/lib/dyslexiaPrefs";

/**
 * Reading-comfort controls.
 *
 * Collapsed by default. This is a lesson, not a settings screen, and a student who is happy with the
 * defaults should never have to look at six controls to get past them — but the ones who need a
 * different typeface or wider spacing need it on the first beat, not buried in an account page.
 *
 * Every control changes the page live as it moves. That is the point: spacing is judged by looking,
 * so a preview-then-apply flow would make it guesswork.
 */
export function ComfortControls({
  prefs,
  update,
  reset,
}: {
  prefs: DyslexiaPrefs;
  update: (patch: Partial<DyslexiaPrefs>) => void;
  reset: () => void;
}) {
  const [open, setOpen] = useState(false);

  const changed =
    prefs.font !== DEFAULT_PREFS.font ||
    prefs.letterSpacing !== DEFAULT_PREFS.letterSpacing ||
    prefs.wordSpacing !== DEFAULT_PREFS.wordSpacing ||
    prefs.lineHeight !== DEFAULT_PREFS.lineHeight ||
    prefs.tint !== DEFAULT_PREFS.tint;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="dys-comfort"
        className="rounded-[var(--radius)] border border-white/15 px-3 py-1.5 text-[0.8rem] text-white/70 transition-colors hover:text-white"
      >
        Reading comfort{changed ? " ·" : ""}
      </button>

      {open && (
        <div
          id="dys-comfort"
          className="absolute right-0 z-50 mt-2 w-[19rem] rounded-[var(--radius-lg)] border border-white/15 p-4 shadow-xl"
          style={{ background: "#12131a" }}
        >
          <Row label="Typeface">
            <div className="flex gap-1.5">
              {(["opendyslexic", "sans"] as const).map((font) => (
                <button
                  key={font}
                  type="button"
                  onClick={() => update({ font })}
                  aria-pressed={prefs.font === font}
                  className="flex-1 rounded-[var(--radius)] border px-2 py-1.5 text-[0.78rem] transition-colors"
                  style={{
                    borderColor: prefs.font === font ? "var(--accent-dyslexia)" : "rgba(255,255,255,0.15)",
                    color: prefs.font === font ? "var(--accent-dyslexia)" : "rgba(255,255,255,0.7)",
                  }}
                >
                  {font === "opendyslexic" ? "OpenDyslexic" : "Plain sans"}
                </button>
              ))}
            </div>
          </Row>

          <Slider
            label="Letter spacing"
            value={prefs.letterSpacing}
            min={0}
            max={0.3}
            step={0.01}
            onChange={(letterSpacing) => update({ letterSpacing })}
          />
          <Slider
            label="Word spacing"
            value={prefs.wordSpacing}
            min={0}
            max={0.5}
            step={0.02}
            onChange={(wordSpacing) => update({ wordSpacing })}
          />
          <Slider
            label="Line height"
            value={prefs.lineHeight}
            min={1.3}
            max={2.4}
            step={0.05}
            onChange={(lineHeight) => update({ lineHeight })}
            format={(v) => v.toFixed(2)}
          />

          <Row label="Page tint">
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(TINT_COLORS) as DyslexiaTint[]).map((tint) => (
                <button
                  key={tint}
                  type="button"
                  onClick={() => update({ tint })}
                  aria-pressed={prefs.tint === tint}
                  title={TINT_LABELS[tint]}
                  className="size-7 rounded-full border-2 transition-transform"
                  style={{
                    background: tint === "none" ? "transparent" : TINT_COLORS[tint],
                    borderColor: prefs.tint === tint ? "var(--accent-dyslexia)" : "rgba(255,255,255,0.2)",
                    transform: prefs.tint === tint ? "scale(1.12)" : "none",
                  }}
                >
                  {/* Colour alone must not carry the choice. */}
                  <span className="sr-only">{TINT_LABELS[tint]}</span>
                  {tint === "none" && <span aria-hidden="true" className="text-[0.7rem] text-white/60">✕</span>}
                </button>
              ))}
            </div>
          </Row>

          {prefs.tint !== "none" && (
            <Slider
              label="Tint strength"
              value={prefs.tintOpacity}
              min={0.04}
              max={0.3}
              step={0.02}
              onChange={(tintOpacity) => update({ tintOpacity })}
            />
          )}

          <button
            type="button"
            onClick={reset}
            className="mt-3 w-full rounded-[var(--radius)] border border-white/15 py-1.5 text-[0.78rem] text-white/60 hover:text-white"
          >
            Reset to defaults
          </button>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <p className="mb-1.5 text-[0.72rem] uppercase tracking-[0.14em] text-white/45">{label}</p>
      {children}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = (v: number) => v.toFixed(2),
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
}) {
  const id = `dys-${label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="mb-3">
      <label htmlFor={id} className="mb-1 flex items-center justify-between text-[0.72rem] uppercase tracking-[0.14em] text-white/45">
        <span>{label}</span>
        <span className="tabular-nums text-white/35">{format(value)}</span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--accent-dyslexia)]"
      />
    </div>
  );
}
