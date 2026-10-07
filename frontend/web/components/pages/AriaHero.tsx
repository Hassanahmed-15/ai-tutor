"use client";

import { useEffect, useRef } from "react";

/**
 * ARIA, AND NOTHING ELSE, AT THE CENTRE: her name over a glossy sphere of violet light. The rig
 * tilts a few degrees toward the pointer (CSS variables set from one pointermove listener, no
 * re-render); two rings and four motes orbit the sphere, passing behind it and in front of it —
 * each ring is a far half under the sphere and a near half over it, each mote runs an elliptical
 * path and changes layer at the far side (app/globals.css). With less motion asked for, everything
 * rests. Transforms and opacity only: the GPU does the work.
 */
export function AriaHero({ size = 176 }: { size?: number }) {
  const sceneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = scene.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / Math.max(1, window.innerWidth / 2);
        const dy = (e.clientY - (r.top + r.height / 2)) / Math.max(1, window.innerHeight / 2);
        scene.style.setProperty("--ty", `${Math.max(-1, Math.min(1, dx)) * 14}deg`);
        scene.style.setProperty("--tx", `${Math.max(-1, Math.min(1, -dy)) * 10}deg`);
      });
    };
    const onLeave = () => {
      scene.style.setProperty("--tx", "0deg");
      scene.style.setProperty("--ty", "0deg");
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  const ring = size * 1.6;
  const rings = [
    { d: ring, incl: 76, spin: 0 },
    { d: ring * 0.86, incl: 70, spin: 48 },
  ];
  // Each mote on its own ellipse: rx the orbit's radius, ry foreshortened by its tilt.
  const motes = [
    { rx: ring * 0.5, ry: ring * 0.12, dur: 11, delay: 0 },
    { rx: ring * 0.43, ry: ring * 0.16, dur: 15, delay: -6 },
    { rx: ring * 0.55, ry: ring * 0.1, dur: 19, delay: -3 },
    { rx: ring * 0.47, ry: ring * 0.2, dur: 13, delay: -9 },
  ];
  const style = (v: Record<string, string | number>) => v as React.CSSProperties;
  return (
    <div ref={sceneRef} className="orb-scene relative mx-auto grid place-items-center" style={{ width: ring, height: ring }} aria-hidden="true">
      <div className="orb-halo absolute rounded-full" style={{ width: ring * 1.5, height: ring * 1.5 }} />
      <div className="orb-tilt relative grid place-items-center" style={{ width: ring, height: ring }}>
        {rings.map((r, i) => (
          <div key={i} className="contents">
            <div className="orb-ring orb-ring-far absolute" style={style({ width: r.d, height: r.d, "--incl": `${r.incl}deg`, "--spin": `${r.spin}deg` })} />
            <div className="orb-ring orb-ring-near absolute" style={style({ width: r.d, height: r.d, "--incl": `${r.incl}deg`, "--spin": `${r.spin}deg` })} />
          </div>
        ))}
        <div className="orb-core relative rounded-full" style={{ width: size, height: size }} />
        {motes.map((m, i) => (
          <span
            key={i}
            className="orb-mote absolute"
            style={style({
              offsetPath: `ellipse(${m.rx}px ${m.ry}px at ${ring / 2}px ${ring / 2}px)`,
              left: 0,
              top: 0,
              "--dur": `${m.dur}s`,
              "--delay": `${m.delay}s`,
            })}
          />
        ))}
      </div>
    </div>
  );
}
