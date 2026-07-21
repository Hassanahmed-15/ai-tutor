"use client";
import { Icon } from "@iconify/react";

/**
 * Renders one Iconify icon. `wobble` applies an SVG filter (feTurbulence +
 * feDisplacementMap) to fake a hand-drawn line quality on a normally-flat icon —
 * this is the "sketch" trick discussed: no drawing, just a filter on a vector glyph.
 */
export function IconBlock({
  icon,
  size = 96,
  color = "#2b5f5a",
  wobble = true,
}: {
  icon: string;
  size?: number;
  color?: string;
  wobble?: boolean;
}) {
  return (
    <div style={{ filter: wobble ? "url(#sketchWobble)" : undefined }}>
      <Icon icon={icon} width={size} height={size} color={color} />
    </div>
  );
}

/** One shared SVG filter def, mounted once, referenced by every wobbled element. */
export function SketchFilterDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }}>
      <defs>
        <filter id="sketchWobble">
          <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="7" result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" />
        </filter>
      </defs>
    </svg>
  );
}
