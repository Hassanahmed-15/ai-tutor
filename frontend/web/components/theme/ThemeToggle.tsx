"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme/useTheme";

/**
 * THE LIGHT/DARK BUTTON on the front screens (owner, 2026-11-08: "add a light mode button on the front
 * screen"). One tap flips the whole app, the lesson board included (white board, dark ink); the same
 * choice as Settings → Appearance, kept in this browser (useTheme).
 */
export function ThemeToggle() {
  const [, choose] = useTheme();
  // What the page shows now, so a change made in Settings is seen here too.
  const [light, setLight] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setLight(root.dataset.theme === "light");
    read();
    const watch = new MutationObserver(read);
    watch.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => watch.disconnect();
  }, []);
  return (
    <button
      type="button"
      onClick={() => choose(light ? "dark" : "light")}
      aria-label={light ? "Switch to dark mode" : "Switch to light mode"}
      title={light ? "Dark mode" : "Light mode"}
      className="grid size-9 place-items-center rounded-full border border-[var(--hud-line)] bg-[var(--hud-surface)] text-[var(--hud-text-dim)] transition-colors hover:border-[var(--hud-line-strong)] hover:text-[var(--hud-text)]"
    >
      {light ? <Moon aria-hidden="true" size={17} strokeWidth={1.8} /> : <Sun aria-hidden="true" size={17} strokeWidth={1.8} />}
    </button>
  );
}
