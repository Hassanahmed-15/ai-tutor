"use client";

import { useEffect } from "react";

/**
 * THE TAB ICON FOLLOWS THE APP'S THEME — the same mark as the logo on the page, violet on dark and
 * red on light. `app/icon.svg` already switches with the device's setting before any script runs;
 * this keeps the tab in step with the app's own choice (Settings → Appearance), which the device
 * cannot see. Renders nothing.
 */
const ICONS = { light: "/aria-icon-light.svg", dark: "/aria-icon-dark.svg" } as const;

export function ThemeFavicon() {
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const href = root.dataset.theme === "light" ? ICONS.light : ICONS.dark;
      const links = document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]');
      if (links.length === 0) {
        const link = document.createElement("link");
        link.rel = "icon";
        link.type = "image/svg+xml";
        link.href = href;
        document.head.appendChild(link);
        return;
      }
      links.forEach((link) => {
        if (!link.href.endsWith(href)) {
          link.type = "image/svg+xml";
          link.href = href;
        }
      });
    };
    apply();
    // The theme can change (Settings), and Next streams its own icon link into <head> after this
    // runs — both are watched, so the tab never shows the other theme's icon.
    const themeWatch = new MutationObserver(apply);
    themeWatch.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    const headWatch = new MutationObserver((records) => {
      if (records.some((r) => Array.from(r.addedNodes).some((n) => n instanceof HTMLLinkElement && /\bicon\b/.test(n.rel)))) apply();
    });
    headWatch.observe(document.head, { childList: true });
    return () => {
      themeWatch.disconnect();
      headWatch.disconnect();
    };
  }, []);
  return null;
}
