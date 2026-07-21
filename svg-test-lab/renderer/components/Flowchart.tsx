"use client";
import { useEffect, useRef, useState } from "react";

let mermaidInitialized = false;

/**
 * Renders a Mermaid diagram string to SVG, client-side, dynamically imported so
 * mermaid's ~500KB never lands in the main bundle unless a beat actually uses it.
 */
export function Flowchart({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mermaid = (await import("mermaid")).default;
      if (!mermaidInitialized) {
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: {
            primaryColor: "#f3e6d5",
            primaryTextColor: "#20180a",
            primaryBorderColor: "#9a5a1b",
            lineColor: "#5c5548",
            fontFamily: "var(--font-sketch, sans-serif)",
          },
        });
        mermaidInitialized = true;
      }
      try {
        const id = `mmd-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, chart);
        if (!cancelled) setSvg(svg);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Mermaid render failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart]);

  if (error) return <div style={{ color: "#b41e4a", fontSize: 13 }}>Flowchart error: {error}</div>;
  return <div ref={ref} dangerouslySetInnerHTML={{ __html: svg }} />;
}
