"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, Plus, Sparkles, X } from "lucide-react";
import { customOption, searchOptions, type EduOption } from "@/lib/education";

/**
 * A SEARCHABLE PICKER for onboarding and settings: subjects (many), study level and country (one),
 * curricula (many). The owner's spec (2026-09-29): search, select one or several, and always be able
 * to enter your own when it is not in the list. When a search finds little, Aria suggests real
 * options for the learner's context (/api/education/suggest) — the catalogue is a starting point,
 * never the limit.
 *
 * An ARIA combobox: the input owns a listbox, arrow keys move through it, Enter picks, Escape
 * closes; selected items are chips with their own remove buttons.
 */
export function OptionPicker({
  label,
  hint,
  options,
  value,
  onChange,
  multiple,
  placeholder,
  suggestKind,
  suggestContext,
  required,
  inputId,
}: {
  label: string;
  hint?: string;
  options: EduOption[];
  value: EduOption[];
  onChange: (next: EduOption[]) => void;
  multiple: boolean;
  placeholder: string;
  /** Ask Aria for real options when the search comes back thin. */
  suggestKind?: "subject" | "level" | "curriculum";
  suggestContext?: { country?: string | null; level?: EduOption | null; subjects?: EduOption[] };
  required?: boolean;
  inputId?: string;
}) {
  const autoId = useId();
  const id = inputId ?? `picker-${autoId}`;
  const listId = `${id}-list`;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // Suggestions belong to the query they were fetched for; typing on makes them stale at once.
  const [suggestion, setSuggestion] = useState<{ query: string; options: EduOption[] }>({ query: "", options: [] });
  const [suggesting, setSuggesting] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const chosen = new Set(value.map((v) => v.id));
  const matches = useMemo(() => searchOptions(options, query, 12).filter((o) => !chosen.has(o.id)), [options, query, value]); // eslint-disable-line react-hooks/exhaustive-deps
  const trimmed = query.trim();
  const suggested = suggestion.query === trimmed ? suggestion.options : [];
  const exact = [...options, ...value, ...suggested].some((o) => o.label.toLowerCase() === trimmed.toLowerCase());
  const aiExtra = suggested.filter((s) => !chosen.has(s.id) && !matches.some((m) => m.label.toLowerCase() === s.label.toLowerCase()));
  const rows: Array<{ option: EduOption; kind: "match" | "ai" | "custom" }> = [
    ...matches.map((option) => ({ option, kind: "match" as const })),
    ...aiExtra.map((option) => ({ option, kind: "ai" as const })),
    ...(trimmed.length >= 2 && !exact ? [{ option: customOption(trimmed), kind: "custom" as const }] : []),
  ];

  // Thin results: ask Aria, once the student has paused typing.
  useEffect(() => {
    if (!suggestKind || trimmed.length < 3 || matches.length >= 3) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSuggesting(true);
      fetch("/api/education/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: suggestKind, query: trimmed, ...suggestContext }),
        signal: controller.signal,
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => setSuggestion({ query: trimmed, options: Array.isArray(data?.options) ? data.options : [] }))
        .catch(() => {})
        .finally(() => setSuggesting(false));
    }, 600);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, suggestKind, matches.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function pick(option: EduOption) {
    if (multiple) onChange([...value.filter((v) => v.id !== option.id), option]);
    else onChange([option]);
    setQuery("");
    setActive(0);
    setOpen(multiple);
  }

  function remove(option: EduOption) {
    onChange(value.filter((v) => v.id !== option.id));
  }

  return (
    <div ref={wrapRef} className="relative">
      <label htmlFor={id} className="mb-1.5 block text-[0.84rem] font-medium text-[var(--hud-text)]">
        {label}
        {required && <span className="ml-1 text-[var(--hud-text-faint)]" aria-hidden="true">*</span>}
      </label>
      {hint && <p id={`${id}-hint`} className="-mt-0.5 mb-2 text-[0.76rem] text-[var(--hud-text-faint)]">{hint}</p>}

      {value.length > 0 && (multiple || !open) && (
        <ul className="mb-2 flex flex-wrap gap-1.5" aria-label={`Selected ${label.toLowerCase()}`}>
          {value.map((v) => (
            <li key={v.id} className="flex items-center gap-1 rounded-full border py-1 pl-3 pr-1 text-[0.82rem] text-[var(--hud-text)]" style={{ borderColor: "var(--hud-cyan)", background: "var(--hud-cyan-glow)" }}>
              {v.label}
              <button type="button" onClick={() => remove(v)} aria-label={`Remove ${v.label}`} className="grid size-5 place-items-center rounded-full text-[var(--hud-text-dim)] hover:text-[var(--hud-text)]">
                <X aria-hidden="true" size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        id={id}
        role="combobox"
        aria-expanded={open && rows.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-required={required}
        aria-describedby={hint ? `${id}-hint` : undefined}
        aria-activedescendant={open && rows[active] ? `${listId}-${active}` : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(rows.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter") {
            if (open && rows[active]) { e.preventDefault(); pick(rows[active].option); }
            else if (trimmed.length >= 2) { e.preventDefault(); pick(customOption(trimmed)); }
          } else if (e.key === "Escape") setOpen(false);
          else if (e.key === "Backspace" && !query && multiple && value.length) remove(value[value.length - 1]);
        }}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-[var(--radius)] border bg-[var(--hud-surface)] px-4 py-3 text-[0.93rem] text-[var(--hud-text)] placeholder:text-[var(--hud-text-faint)] focus:outline-none focus:ring-1 focus:ring-[var(--hud-cyan)]"
        style={{ borderColor: "var(--hud-line)" }}
      />

      {open && (rows.length > 0 || suggesting) && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          aria-multiselectable={multiple || undefined}
          className="absolute inset-x-0 z-30 mt-1 max-h-64 overflow-y-auto rounded-[var(--radius)] border border-[var(--hud-line)] bg-[var(--hud-surface)] p-1 shadow-[var(--elev-2)]"
          style={{ borderColor: "var(--hud-line-strong)" }}
        >
          {rows.map((row, i) => (
            <li
              key={`${row.kind}-${row.option.id}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => { e.preventDefault(); pick(row.option); }}
              onMouseEnter={() => setActive(i)}
              className={`flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[0.88rem] ${i === active ? "bg-[var(--hud-surface-2)] text-[var(--hud-text)]" : "text-[var(--hud-text-dim)]"}`}
            >
              {row.kind === "custom" ? <Plus aria-hidden="true" size={14} /> : row.kind === "ai" ? <Sparkles aria-hidden="true" size={14} className="text-[var(--hud-cyan)]" /> : <Check aria-hidden="true" size={14} className="opacity-0" />}
              <span className="min-w-0 flex-1 truncate">{row.kind === "custom" ? `Add “${row.option.label}”` : row.option.label}</span>
              {row.kind === "ai" && <span className="text-[0.7rem] text-[var(--hud-text-faint)]">suggested</span>}
            </li>
          ))}
          {suggesting && <li className="px-3 py-2 text-[0.8rem] text-[var(--hud-text-faint)]" aria-live="polite">Aria is looking for more options…</li>}
        </ul>
      )}
    </div>
  );
}

/** A row of the most relevant options, one tap each — above a picker, for the common case. */
export function QuickChips({ options, value, onToggle, label }: { options: EduOption[]; value: EduOption[]; onToggle: (o: EduOption) => void; label: string }) {
  if (!options.length) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map((o) => {
        const on = value.some((v) => v.id === o.id);
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(o)}
            className="rounded-full border px-3 py-1.5 text-[0.82rem] transition-colors"
            style={{ borderColor: on ? "var(--hud-cyan)" : "var(--hud-line)", background: on ? "var(--hud-cyan-glow)" : "transparent", color: on ? "var(--hud-text)" : "var(--hud-text-dim)" }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
