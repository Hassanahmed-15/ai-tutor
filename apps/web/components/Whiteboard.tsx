"use client";

import { useEffect, useState } from "react";

interface VisualElement {
  id: string;
  label: string;
  value?: string | number;
  emphasis?: boolean;
}

interface VisualRelation {
  from: string;
  to: string;
  kind: string;
  label?: string;
}

interface DrawCommands {
  primitive: string;
  elements: VisualElement[];
  relations: VisualRelation[];
}

/**
 * Renders a "diagram" beat as progressively-appearing boxes (README 4.2: strokes
 * appear live, not a static fade-in). This is the array/diagram primitive only —
 * tree/graph/timeline/comparison-table primitives (README 7.4) are not yet built,
 * consistent with README Section 9's MVP scope.
 */
export function Whiteboard({ drawCommands }: { drawCommands: DrawCommands | undefined }) {
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    setVisibleCount(0);
    if (!drawCommands) return;
    const total = drawCommands.elements.length;
    let i = 0;
    const interval = setInterval(() => {
      i += 1;
      setVisibleCount(i);
      if (i >= total) clearInterval(interval);
    }, 120);
    return () => clearInterval(interval);
  }, [drawCommands]);

  if (!drawCommands) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-neutral-300 text-sm text-neutral-400">
        (no visual for this beat — narration only)
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-300 bg-white p-6">
      <div className="flex flex-wrap items-center gap-3">
        {drawCommands.elements.slice(0, visibleCount).map((el) => (
          <div
            key={el.id}
            className={`flex h-12 w-12 items-center justify-center rounded-md border-2 text-sm font-semibold transition-all duration-200 ${
              el.emphasis
                ? "border-amber-500 bg-amber-100 text-amber-900 scale-110"
                : "border-neutral-300 bg-neutral-50 text-neutral-700"
            }`}
          >
            {el.label}
          </div>
        ))}
      </div>
      {drawCommands.relations.length > 0 && visibleCount >= drawCommands.elements.length && (
        <div className="mt-4 space-y-1">
          {drawCommands.relations.map((rel, i) => (
            <p key={i} className="text-xs text-neutral-500">
              {rel.label ?? `${rel.kind}: ${rel.from} → ${rel.to}`}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
