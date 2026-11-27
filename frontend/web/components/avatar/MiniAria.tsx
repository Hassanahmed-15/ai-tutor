"use client";

import { useEffect, useRef } from "react";

/**
 * MINI ARIA, peeking over the ask box while the student types (the owner's homepage design, 2026-11-27). She rises
 * from behind the box when there is text, watches the words go in (her eyes follow the end of the line), raises
 * her brows at each key, "says" the latest letters, and drifts into a thinking look with a thought bubble when the
 * typing stops. Drawn on a 64 px canvas; still when less motion is asked for.
 */
export function MiniAria({ text, className = "" }: { text: string; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef(text);
  const lastKey = useRef(-9);
  const clock = useRef(0);
  useEffect(() => {
    if (text !== textRef.current) lastKey.current = clock.current;
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    const cv = canvasRef.current;
    const m2 = cv?.getContext("2d");
    if (!cv || !m2) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const N = 720, M = 600;
    const S: Array<[number, number, number]> = [];
    for (let i = 0; i < N; i++) { const y = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - y * y), a = i * 2.39996; S.push([Math.cos(a) * r, y, Math.sin(a) * r]); }
    const R: Array<[number, number, number]> = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < M; i++) { const a = rnd() * 6.283, d = 1.45 + rnd() * 0.5; R.push([Math.cos(a) * d, (rnd() - 0.5) * 0.03, Math.sin(a) * d]); }
    let raf = 0, gx = 0, gy = 0, blinkAt = -9, nextBlink = 2, br = 0, thk = 0;
    const draw = () => {
      const mt = (clock.current += 0.016);
      const len = textRef.current.length, idle = mt - lastKey.current > 1.6;
      gx += ((idle ? -0.9 : Math.min(len / 34, 1) * 1.6 - 0.8) - gx) * 0.12;
      gy += ((idle ? -0.8 : 0.6) - gy) * 0.12;
      br += ((mt - lastKey.current < 0.6 ? 1 : 0) - br) * 0.25;
      thk += ((idle ? 1 : 0) - thk) * 0.1;
      if (mt > nextBlink) { blinkAt = mt; nextBlink = mt + 2.2 + Math.random() * 2.5; }
      const bu = (mt - blinkAt) / 0.16, bl = bu >= 0 && bu < 1 ? Math.sin(Math.PI * bu) : 0, talk = Math.max(0, 1 - (mt - lastKey.current) / 0.3);
      m2.setTransform(2, 0, 0, 2, 0, 0);
      m2.clearRect(0, 0, 64, 64);
      const u = 19, X = 32, Y = 32, yw = still ? 0.6 : mt * 1.4, cy = Math.cos(yw), sy = Math.sin(yw), tl = -0.38, ct = Math.cos(tl), st = Math.sin(tl), rr = still ? 0 : mt * 1.2, cr = Math.cos(rr), sr = Math.sin(rr);
      const ring = (p: [number, number, number]): [number, number, number] => {
        const x = p[0] * cr + p[2] * sr, z0 = -p[0] * sr + p[2] * cr;
        const y = p[1] * ct - z0 * st, z = p[1] * st + z0 * ct;
        return [x * Math.cos(0.22) - y * Math.sin(0.22), x * Math.sin(0.22) + y * Math.cos(0.22), z];
      };
      const dot = (x: number, y: number, z: number, s: number, c: string, a: number) => {
        m2.globalAlpha = a * (0.45 + 0.55 * Math.max(0, Math.min(1, (z + 1.6) / 3.2)));
        m2.fillStyle = c;
        m2.fillRect(X + x * u - s / 2, Y - y * u - s / 2, s, s);
      };
      const rp = R.map(ring);
      rp.forEach((p) => { if (p[2] < 0) dot(p[0], p[1], p[2], 1.3, "#cdbcff", 0.8); });
      m2.globalAlpha = 1;
      m2.beginPath();
      m2.arc(X, Y, u, 0, 6.283);
      const g = m2.createRadialGradient(X - 6, Y - 8, 2, X, Y, u);
      g.addColorStop(0, "#e0d4ff");
      g.addColorStop(0.55, "#ab92ff");
      g.addColorStop(1, "#7f5ce8");
      m2.fillStyle = g;
      m2.fill();
      S.forEach((p) => { const x = p[0] * cy + p[2] * sy, z = -p[0] * sy + p[2] * cy; if (z < 0) return; if ((p[1] * 0.6 - x * 0.3 + z * 0.4 + 1) / 2 > 0.64) dot(x, p[1], z, 1, "#fff", 0.55); });
      rp.forEach((p) => { if (p[2] >= 0) dot(p[0], p[1], p[2], 1.7, "#efe8ff", 0.95); });
      m2.globalAlpha = 1;
      const ink = "#2a1850", fx = X + gx * 3, fy = Y + gy * 2;
      m2.fillStyle = "rgba(255,130,185,.5)";
      [-8.6, 8.6].forEach((e) => { m2.beginPath(); m2.ellipse(fx + e, fy + 2.4, 2.4, 1.5, 0, 0, 6.283); m2.fill(); });
      m2.fillStyle = ink;
      [-5.4, 5.4].forEach((e) => {
        const h = 2.9 * (1 - 0.9 * bl);
        m2.beginPath(); m2.ellipse(fx + e, fy - 2.6, 1.8, h, 0, 0, 6.283); m2.fill();
        if (!bl) { m2.fillStyle = "#fff"; m2.beginPath(); m2.arc(fx + e + 0.5, fy - 3.6, 0.7, 0, 6.283); m2.fill(); m2.fillStyle = ink; }
      });
      m2.strokeStyle = ink; m2.lineWidth = 1.1; m2.lineCap = "round";
      const rl = br * 1.5 - thk * 0.5, rrz = br * 1.5 + thk * 2.2;
      m2.beginPath(); m2.moveTo(fx - 7.4, fy - 6.2 - rl); m2.quadraticCurveTo(fx - 5.4, fy - 8.2 - rl * 1.2, fx - 3.4, fy - 6.8 - rl); m2.stroke();
      m2.beginPath(); m2.moveTo(fx + 3.4, fy - 6.8 - rrz); m2.quadraticCurveTo(fx + 5.4, fy - 8.2 - rrz * 1.2, fx + 7.4, fy - 6.2 - rrz); m2.stroke();
      if (talk > 0.05) {
        m2.fillStyle = ink; m2.beginPath(); m2.ellipse(fx, fy + 3.6, 2.6 + talk * 0.8, 0.9 + talk * 2.3, 0, 0, 6.283); m2.fill();
        m2.fillStyle = "#ff8fb8"; m2.beginPath(); m2.ellipse(fx, fy + 4.6 + talk * 0.6, 1.6, 0.8 + talk * 0.5, 0, 0, 6.283); m2.fill();
      } else {
        m2.lineWidth = 1.4; m2.beginPath();
        if (thk > 0.5) m2.arc(fx + 1.2, fy + 1.4, 3.2, 0.15 * Math.PI, 0.75 * Math.PI); else m2.arc(fx, fy + 0.8, 5, 0.2 * Math.PI, 0.8 * Math.PI);
        m2.stroke();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} width={128} height={128} className={className} aria-hidden="true" />;
}
