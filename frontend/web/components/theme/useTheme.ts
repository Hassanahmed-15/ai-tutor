"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * LIGHT OR DARK — the student's choice, kept in this browser only.
 *
 * "system" follows the device. The same key is read by the script in app/layout.tsx before the
 * first paint, so a reload never flashes the other theme. Storage can be unavailable (private
 * windows, blocked site data); then the choice simply lasts until the tab closes.
 */
export type ThemeChoice = "system" | "light" | "dark";

const KEY = "aria.theme";

function readChoice(): ThemeChoice {
  try {
    const value = window.localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function apply(choice: ThemeChoice) {
  // Aria is dark by default: "system" and "dark" both resolve to the night palette; only an explicit
  // "light" gives paper. The script in app/layout.tsx makes the same call before first paint.
  const dark = choice !== "light";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    setChoice(readChoice());
  }, []);

  // While following the device, follow it live.
  useEffect(() => {
    if (choice !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [choice]);

  const choose = useCallback((next: ThemeChoice) => {
    try {
      if (next === "system") window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, next);
    } catch {
      // Not stored; still applied for this visit.
    }
    apply(next);
    setChoice(next);
  }, []);

  return [choice, choose];
}
