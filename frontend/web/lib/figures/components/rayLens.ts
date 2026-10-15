import type { FigureComponent, FigureParams, FigureShape, Ink, Pt } from "../types";

/**
 * THIN-LENS IMAGE, "real is positive" convention: distances are measured from the lens; u > 0 for a
 * real object in front of it; f > 0 for a converging (convex) lens, f < 0 for a diverging (concave)
 * one; v > 0 is a real image on the far side, v < 0 a virtual image on the object's side.
 *   1/f = 1/u + 1/v   →   v = u·f / (u − f);   magnification m = −v/u (m < 0: inverted).
 * An object at the focal point of a converging lens forms its image at infinity (atInfinity).
 */
export function thinLensImage(f: number, u: number): { v: number; m: number; real: boolean; upright: boolean; atInfinity: boolean } {
  if (Math.abs(u - f) < 1e-9 * Math.max(1, Math.abs(f))) return { v: Infinity, m: -Infinity, real: true, upright: false, atInfinity: true };
  const v = (u * f) / (u - f);
  const m = -v / u;
  return { v, m, real: v > 0, upright: m > 0, atInfinity: false };
}

const num = (v: unknown, fallback: number, lo: number, hi: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};
const fmt = (n: number) => Number(n.toFixed(2));

/** Clip the segment a→b to the rectangle (Liang–Barsky); null when it misses. */
function clip(a: Pt, b: Pt, w: number, h: number): [Pt, Pt] | null {
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [p, q] of [[-dx, a.x], [dx, w - a.x], [-dy, a.y], [dy, h - a.y]] as const) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [{ x: a.x + dx * t0, y: a.y + dy * t0 }, { x: a.x + dx * t1, y: a.y + dy * t1 }];
}

export const rayLens: FigureComponent = {
  name: "rayLens",
  title: "Ray diagram for a thin lens: principal axis, lens, F and 2F on both sides, object, the standard construction rays and the image they form",
  params: `lens ("convex" = converging, default; or "concave" = diverging), f (focal length, a positive number, default 10), u (object distance from the lens, same units, default 30), objectHeight (same units, default f/2), rays (2 or 3, default 3). The code computes the image from 1/f = 1/u + 1/v (real-is-positive: v > 0 real image on the far side, v < 0 virtual image on the object's side; magnification −v/u) and names it, e.g. "Image (real, inverted, diminished)". Typical convex cases: u > 2f, u = 2f, f < u < 2f, u < f (magnifying glass: virtual, upright).`,
  match: /\b(ray diagrams? (for|of|with) (a |the )?lens|(convex|concave|converging|diverging) lens(es)?|principal (axis|focus)|thin lens|lens formula|magnifying glass)\b|\bfocal (length|point)\b(?=.*\blens)/i,
  parts: [
    { id: "lens", name: "Lens" },
    { id: "principal-axis", name: "Principal axis" },
    { id: "principal-focus", name: "Principal focus (F)" },
    { id: "object", name: "Object" },
    { id: "image", name: "Image" },
    { id: "incident-ray", name: "Incident ray" },
    { id: "refracted-ray", name: "Refracted ray" },
    { id: "ray-centre", name: "Ray through centre" },
    { id: "optical-centre", name: "Optical centre" },
  ],
  build(params: FigureParams) {
    const concave = typeof params.lens === "string" && /concave|diverg/i.test(params.lens);
    const F = num(params.f, 10, 0.5, 1000);
    const f = concave ? -F : F; // signed focal length
    const u = num(params.u, 3 * F, 0.15 * F, 6 * F);
    const h = num(params.objectHeight, F / 2, 0.05 * F, 3 * F);
    const threeRays = Number(params.rays) !== 2;
    const img = thinLensImage(f, u);

    const W = 660, H = 400, y0 = H / 2;
    // Horizontal extent: object, both 2F points, and the image if it is within reach of the figure.
    const reach = 4.6 * F;
    const imageShown = !img.atInfinity && Math.abs(img.v) <= reach;
    const left = Math.max(u, 2 * F, imageShown && !img.real ? -img.v : 0) * 1.12;
    const right = Math.max(2 * F, imageShown && img.real ? img.v : 0, img.atInfinity || !imageShown ? 2.6 * F : 0) * 1.16;
    const px = (W - 40) / (left + right);
    const lensX = 20 + left * px;
    // Vertical scale is independent (an affine stretch keeps every straight ray straight and every crossing a crossing).
    const imageH = img.atInfinity ? 0 : img.m * h;
    const hmax = Math.max(h, imageShown ? Math.abs(imageH) : Math.min(Math.abs(imageH), 2.5 * h));
    const sy = (H / 2 - 34) / (hmax * 1.12);
    const X = (x: number) => lensX + x * px, Y = (y: number) => y0 - y * sy;
    const P = (x: number, y: number): Pt => ({ x: X(x), y: Y(y) });
    const lensHalf = Math.min(H / 2 - 8, hmax * 1.12 * sy);

    const shapes: FigureShape[] = [];
    const seg = (part: string, a: Pt, b: Pt, ink: Ink, dashed = false, arrow = false) => {
      const c = clip(a, b, W, H);
      if (!c) return null;
      const [p, q] = c;
      shapes.push({ t: "path", part, d: `M${fmt(p.x)} ${fmt(p.y)} L${fmt(q.x)} ${fmt(q.y)}`, stroke: ink, width: dashed ? 1.8 : 2.2, fill: "none", ...(dashed ? { dash: "7 6" } : {}) });
      if (arrow && Math.hypot(q.x - p.x, q.y - p.y) > 30) {
        const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
        const len = Math.hypot(q.x - p.x, q.y - p.y), ux = (q.x - p.x) / len, uy = (q.y - p.y) / len;
        const s = 9;
        shapes.push({ t: "path", part, d: `M${fmt(m.x + ux * s / 2)} ${fmt(m.y + uy * s / 2)} L${fmt(m.x - ux * s / 2 - uy * s * 0.5)} ${fmt(m.y - uy * s / 2 + ux * s * 0.5)} L${fmt(m.x - ux * s / 2 + uy * s * 0.5)} ${fmt(m.y - uy * s / 2 - ux * s * 0.5)} Z`, fill: ink, stroke: ink, width: 1 });
      }
      return c;
    };
    /** A point far along the ray from a through b, beyond the figure's edge. */
    const beyond = (a: Pt, b: Pt): Pt => {
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      return { x: a.x + ((b.x - a.x) / len) * 3000, y: a.y + ((b.y - a.y) / len) * 3000 };
    };
    const arrowShape = (part: string, foot: Pt, tip: Pt, ink: Ink, dashed: boolean) => {
      const dir = tip.y < foot.y ? 1 : -1;
      shapes.push({ t: "path", part, d: `M${fmt(foot.x)} ${fmt(foot.y)} L${fmt(tip.x)} ${fmt(tip.y + dir * 8)}`, stroke: ink, width: 3.2, fill: "none", ...(dashed ? { dash: "7 5" } : {}) });
      shapes.push({ t: "path", part, d: `M${fmt(tip.x)} ${fmt(tip.y)} L${fmt(tip.x - 8)} ${fmt(tip.y + dir * 14)} L${fmt(tip.x + 8)} ${fmt(tip.y + dir * 14)} Z`, fill: ink, stroke: ink, width: 1 });
    };

    // Principal axis, then the lens on it.
    shapes.push({ t: "path", part: "principal-axis", d: `M8 ${y0} H${W - 8}`, stroke: "ink", width: 1.6, fill: "none" });
    const top = y0 - lensHalf, bot = y0 + lensHalf;
    shapes.push({
      t: "path", part: "lens",
      d: concave
        ? `M${fmt(lensX - 13)} ${fmt(top)} L${fmt(lensX + 13)} ${fmt(top)} Q${fmt(lensX - 9)} ${y0} ${fmt(lensX + 13)} ${fmt(bot)} L${fmt(lensX - 13)} ${fmt(bot)} Q${fmt(lensX + 9)} ${y0} ${fmt(lensX - 13)} ${fmt(top)} Z`
        : `M${fmt(lensX)} ${fmt(top)} Q${fmt(lensX + 30)} ${y0} ${fmt(lensX)} ${fmt(bot)} Q${fmt(lensX - 30)} ${y0} ${fmt(lensX)} ${fmt(top)} Z`,
      fill: "glass", stroke: "ink", width: 2.2,
    });
    shapes.push({ t: "circle", part: "optical-centre", cx: fmt(lensX), cy: y0, r: 3, fill: "ink", stroke: "ink", width: 1 });

    // F and 2F on both sides: ticks on the axis, letters below (moved aside if an inverted image hangs there).
    const imageX = imageShown ? X(img.v) : NaN;
    for (const k of [-2, -1, 1, 2]) {
      const x = X(k * F);
      const part = Math.abs(k) === 1 ? "principal-focus" : "principal-axis";
      shapes.push({ t: "path", part, d: `M${fmt(x)} ${y0 - 7} V${y0 + 7}`, stroke: "ink", width: 2.2, fill: "none" });
      const clash = imageShown && imageH < 0 && Math.abs(imageX - x) < 16;
      shapes.push({ t: "text", part, x: fmt(x + (clash ? 18 : 0)), y: y0 + 29, text: Math.abs(k) === 1 ? "F" : "2F", size: 19, anchor: clash ? "start" : "middle", fill: "ink" });
    }

    // Object: an upright arrow standing on the axis.
    const objFoot = P(-u, 0), objTip = P(-u, h);
    arrowShape("object", objFoot, objTip, "#2563eb", false);

    const O = P(0, 0), A = P(0, h);
    const ray1: Ink = "#dc2626", ray2: Ink = "#16a34a", ray3: Ink = "#d97706";
    const Ipt = imageShown ? P(img.v, imageH) : null;
    let refractedMid: Pt = A;
    // The incident ray a label points at is a slanted one (ray 3), so its leader never runs along a horizontal ray.
    let incidentAnchor: Pt = { x: (objTip.x + A.x) / 2, y: A.y };
    // Ray 1: parallel to the axis, refracted through F (convex) or as if from the near F (concave).
    seg("incident-ray", objTip, A, ray1, false, true);
    const out1 = concave ? beyond(A, { x: 2 * A.x - X(-F), y: 2 * A.y - y0 }) : beyond(A, P(F, 0));
    const c1 = seg("refracted-ray", A, out1, ray1, false, true);
    if (c1) refractedMid = { x: (c1[0].x + c1[1].x) / 2, y: (c1[0].y + c1[1].y) / 2 };
    if (concave) seg("refracted-ray", A, P(-F, 0), ray1, true);
    else if (!img.real && Ipt) seg("refracted-ray", A, Ipt, ray1, true);
    // Ray 2: through the optical centre, undeviated.
    const c2 = seg("ray-centre", objTip, beyond(objTip, O), ray2, false, true);
    if (!img.real && Ipt) seg("ray-centre", objTip, Ipt, ray2, true);
    // Ray 3: through (or towards) a focus, emerging parallel to the axis.
    if (threeRays && !img.atInfinity && Math.abs(imageH) <= hmax * 1.12) {
      const B = P(0, imageH); // where it meets the lens: at the image's height, as the parallel exit requires
      if (concave) {
        seg("incident-ray", objTip, B, ray3, false, true);
        incidentAnchor = { x: (objTip.x + B.x) / 2, y: (objTip.y + B.y) / 2 };
        seg("refracted-ray", B, P(F, 0), ray3, true);
      } else if (u > F) {
        seg("incident-ray", objTip, B, ray3, false, true);
        incidentAnchor = { x: (objTip.x + B.x) / 2, y: (objTip.y + B.y) / 2 };
      } else {
        seg("incident-ray", P(-F, 0), objTip, ray3, true);
        seg("incident-ray", objTip, B, ray3, false, true);
        incidentAnchor = { x: (objTip.x + B.x) / 2, y: (objTip.y + B.y) / 2 };
      }
      seg("refracted-ray", B, { x: W + 50, y: B.y }, ray3, false, true);
      if (!img.real && Ipt) seg("refracted-ray", B, Ipt, ray3, true);
    }

    // The image where the rays (or their backward extensions) meet.
    const kind = img.atInfinity ? "at infinity" : `${img.real ? "real" : "virtual"}, ${img.upright ? "upright" : "inverted"}, ${Math.abs(img.m) > 1.02 ? "larger" : Math.abs(img.m) < 0.98 ? "smaller" : "same size"}`;
    let imageAnchor: Pt;
    if (Ipt) {
      arrowShape("image", P(img.v, 0), Ipt, "#7c3aed", !img.real);
      imageAnchor = P(img.v, imageH / 2);
    } else {
      imageAnchor = c2 ? { x: (c2[1].x * 3 + O.x) / 4, y: (c2[1].y * 3 + O.y) / 4 } : O;
    }
    const centreAnchor = c2 ? { x: (O.x + c2[1].x) / 2, y: (O.y + c2[1].y) / 2 } : O;
    const focusX = concave ? X(-F) : X(F);

    return {
      w: W,
      h: H,
      shapes,
      parts: [
        { id: "lens", name: concave ? "Concave (diverging) lens" : "Convex (converging) lens", anchor: { x: lensX, y: top + lensHalf * 0.35 } },
        { id: "principal-axis", name: "Principal axis", anchor: { x: 12, y: y0 } },
        // The focus's anchor is the foot of its tick, just below the axis, so its leader never runs along (and hides) the axis.
        { id: "principal-focus", name: "Principal focus (F)", anchor: { x: focusX, y: y0 + 7 } },
        { id: "object", name: "Object", anchor: { x: objFoot.x, y: (objFoot.y + objTip.y) / 2 } },
        { id: "image", name: img.atInfinity ? "Image at infinity (rays parallel)" : Ipt ? `Image (${kind})` : `Image (${kind}, far away)`, anchor: imageAnchor },
        { id: "incident-ray", name: "Incident ray", anchor: incidentAnchor },
        { id: "refracted-ray", name: "Refracted ray", anchor: refractedMid },
        { id: "ray-centre", name: "Ray through centre", anchor: centreAnchor },
        { id: "optical-centre", name: "Optical centre", anchor: O },
      ],
    };
  },
};
