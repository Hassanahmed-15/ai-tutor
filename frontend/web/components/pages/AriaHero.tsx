"use client";

import { useEffect, useRef } from "react";

/**
 * ARIA, AND NOTHING ELSE, AT THE CENTRE: her name over a sphere of violet light with two rings in
 * orbit, in real 3D. The rig tilts a few degrees toward the pointer (CSS variables set from one
 * pointermove listener, no re-render), the sphere breathes, the rings turn. With less motion asked
 * for, it all rests. Transforms and opacity only: the GPU does the work.
 */
export function AriaHero({ size = 180 }: { size?: number }) {
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
        scene.style.setProperty("--ty", `${Math.max(-1, Math.min(1, dx)) * 10}deg`);
        scene.style.setProperty("--tx", `${Math.max(-1, Math.min(1, -dy)) * 8}deg`);
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

  const ring = size * 1.55;
  return (
    <div ref={sceneRef} className="orb-scene relative mx-auto grid place-items-center" style={{ width: ring, height: ring }} aria-hidden="true">
      <div className="orb-halo absolute rounded-full" style={{ width: ring * 1.4, height: ring * 1.4 }} />
      <div className="orb-rig relative grid place-items-center" style={{ width: ring, height: ring }}>
        <div className="orb-ring orb-ring-a absolute" style={{ width: ring, height: ring }} />
        <div className="orb-ring orb-ring-b absolute" style={{ width: ring * 0.82, height: ring * 0.82 }} />
        <div className="orb-core relative rounded-full" style={{ width: size, height: size, transform: "translateZ(24px)" }} />
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="orb-mote absolute"
            style={{
              width: 4 + (i % 3),
              height: 4 + (i % 3),
              left: `${18 + i * 16}%`,
              top: `${22 + ((i * 29) % 56)}%`,
              animationDelay: `${i * -1.7}s`,
              transform: `translateZ(${40 + i * 10}px)`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
