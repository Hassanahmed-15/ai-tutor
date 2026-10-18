import type { FigureComponent, FigureParams, Pt } from "../types";
import { fitText, fitWithin } from "../cuts";
import { PALETTE, Sketch, add, arrow, bool, clamp, deg, dist, fmt, lerp, mul, perp, polar, rad, sub, unit } from "./mathsKit";

/**
 * BEARINGS, DRAWN TO SCALE. The board gives the legs of a journey ("A to B: 065°, 8 km; B to C:
 * 150°, 5 km"); the code places every point from its bearing and distance, draws a north line at
 * each, the bearing as an arc turning clockwise from north with its three-figure value, and computes
 * the back bearing (bearing ± 180°). A leg between two places already fixed ("C to A") is computed —
 * its bearing and distance are the code's, not the model's.
 */

export type Leg = { from: string; to: string; bearing?: number; distance?: number; unit: string };
export type Placed = { legs: Array<Leg & { bearing: number; distance: number; computed: boolean }>; pos: Map<string, Pt> };

/** Bearing → its back bearing (the reverse direction), 0 ≤ b < 360. */
export function backBearing(b: number): number {
  return (((b + 180) % 360) + 360) % 360;
}
/** "065°" — bearings are written with three figures. */
export function bearingText(b: number): string {
  const r = Math.round((((b % 360) + 360) % 360) * 10) / 10;
  const [i, f] = String(r).split(".");
  return `${i.padStart(3, "0")}${f ? "." + f : ""}°`;
}
/** The bearing of `to` from `from` (km east = x, km north = y). */
export function bearingOf(from: Pt, to: Pt): number {
  return (((deg(Math.atan2(to.x - from.x, to.y - from.y)) % 360) + 360) % 360);
}

/** "A to B: 065°, 8 km; B to C: 150°, 5 km" (also "A→B 065 8km", "from A to B ...", "C to A: ?"). */
export function parseLegs(v: unknown): Leg[] {
  const out: Leg[] = [];
  for (const chunk of String(v ?? "").slice(0, 400).split(/[;\n]|\.\s/)) {
    const m = /(?:from\s+)?([A-Za-z][\w']{0,14})\s*(?:to|→|->|–|-)\s*([A-Za-z][\w']{0,14})\s*[:=,]?\s*(?:(?:on a )?(?:bearing(?: of)?\s*)?(\d{1,3}(?:\.\d+)?)\s*°?)?\s*(?:[,;]?\s*(?:for\s*)?(\d+(?:\.\d+)?)\s*([a-z]{1,6})?)?/i.exec(chunk.trim());
    if (!m || m[1].toLowerCase() === m[2].toLowerCase()) continue;
    const bearing = m[3] !== undefined ? Number(m[3]) : undefined;
    const distance = m[4] !== undefined ? Number(m[4]) : undefined;
    out.push({ from: m[1], to: m[2], bearing: bearing !== undefined && bearing >= 0 && bearing <= 360 ? bearing % 360 : undefined, distance: distance && distance > 0 ? clamp(distance, 0.01, 1e5) : undefined, unit: (m[5] ?? "").toLowerCase().replace(/^(kms?|kilometres?)$/, "km").replace(/^(miles?)$/, "miles") });
    if (out.length >= 4) break;
  }
  return out;
}

/** Place every place: the first leg starts at the origin; a leg between two fixed places is computed. */
export function placeLegs(legs: Leg[]): Placed {
  const pos = new Map<string, Pt>();
  const placed: Placed["legs"] = [];
  const known = legs.filter((l) => l.distance !== undefined);
  const typical = known.length ? known.reduce((t, l) => t + l.distance!, 0) / known.length : 5;
  for (const l of legs) {
    if (!pos.size) pos.set(l.from, { x: 0, y: 0 });
    const a = pos.get(l.from), b = pos.get(l.to);
    if (a && b) {
      placed.push({ ...l, bearing: bearingOf(a, b), distance: dist(a, b), computed: true });
    } else if (a) {
      const bearing = l.bearing ?? (placed.length ? (placed[placed.length - 1].bearing + 100) % 360 : 60);
      const distance = l.distance ?? typical;
      pos.set(l.to, { x: a.x + distance * Math.sin(rad(bearing)), y: a.y + distance * Math.cos(rad(bearing)) });
      placed.push({ ...l, bearing, distance, computed: false });
    } else if (b) {
      // Given backwards ("B from A" style chains): place the from-end by the reverse bearing.
      const bearing = l.bearing ?? 60, distance = l.distance ?? typical;
      pos.set(l.from, { x: b.x - distance * Math.sin(rad(bearing)), y: b.y - distance * Math.cos(rad(bearing)) });
      placed.push({ ...l, bearing, distance, computed: false });
    }
  }
  return { legs: placed, pos };
}

const PARTS = [
  { id: "north-line", name: "North line" },
  { id: "bearing", name: "Bearing (first leg)" },
  { id: "back-bearing", name: "Back bearing" },
  { id: "bearing-2", name: "Bearing (second leg)" },
  { id: "place-a", name: "First place" },
  { id: "place-b", name: "Second place" },
  { id: "place-c", name: "Third place" },
];

/** A label kept to `n` characters: ended at a word break and recorded for the rewrite pass, never "…". */
const cap = (s: string, n = 34) => fitText(s, n);

export const bearings: FigureComponent = {
  name: "bearings",
  title: "Bearings drawn to scale: places joined by legs, a north line at each place, each bearing an arc measured clockwise from north with its three-figure value, the back bearing, and a computed closing leg",
  params: `legs (the journey, e.g. "A to B: 065°, 8 km; B to C: 150°, 5 km"; up to 4 legs; a leg between two places already fixed, e.g. "C to A", is computed and drawn dashed with its bearing and distance); or bearing + distance (one leg A to B, e.g. 65 and 8) with optional bearing2 + distance2 (a second leg B to C); from, to (place names for that simple form, default "A","B"); units (default "km"); backBearing (true default: show the bearing of the first place from the second, computed as bearing ± 180°); distances (true default: write each leg's length); names longer than 2 letters are drawn by their initial and named in full in the part.`,
  match: /\bthree[- ]figure bearings?\b|\bbearings? of [A-Z]\w* from\b|\bback[- ]bearings?\b|\d{3}\s*°\s*from north|clockwise from (the )?north|\bbearings?\b(?=[\s\S]*(\b(north|compass|degrees|navigation|scale drawing|three[- ]figure|ship|plane|sails?|flies|walks?)\b|°|\b\d{3}\b))(?<!(ball|roller|wheel|load|interest|weight|child|load)[- ]bearings?)/i,
  parts: PARTS,
  build(params: FigureParams) {
    let legs = parseLegs(params.legs ?? params.journey ?? params.route);
    if (!legs.length) {
      const name = (v: unknown, d: string) => (typeof v === "string" && /^[A-Za-z][\w']{0,14}$/.test(v.trim()) ? v.trim() : d);
      const A = name(params.from, "A"), B = name(params.to, "B"), C = name(params.third, "C");
      const b1 = Number(String(params.bearing ?? "").replace(/°/, "")), d1 = Number(params.distance);
      legs = [{ from: A, to: B, bearing: Number.isFinite(b1) && String(params.bearing ?? "").trim() !== "" ? ((b1 % 360) + 360) % 360 : 65, distance: d1 > 0 ? clamp(d1, 0.01, 1e5) : 8, unit: "" }];
      const b2 = Number(String(params.bearing2 ?? "").replace(/°/, "")), d2 = Number(params.distance2);
      if (String(params.bearing2 ?? "").trim() !== "" && Number.isFinite(b2)) legs.push({ from: B, to: C, bearing: ((b2 % 360) + 360) % 360, distance: d2 > 0 ? clamp(d2, 0.01, 1e5) : 5, unit: "" });
    }
    const units = (typeof params.units === "string" && /^[a-z]{1,6}$/i.test(params.units.trim()) ? params.units.trim() : legs.find((l) => l.unit)?.unit) || "km";
    const showBack = bool(params.backBearing, true);
    const showDist = bool(params.distances, true);
    const { legs: L, pos } = placeLegs(legs);
    const places = [...pos.keys()];

    // Scale: the journey fits about 440 × 300, leaving room for the north lines above each place.
    const P = [...pos.values()];
    const minX = Math.min(...P.map((p) => p.x)), maxX = Math.max(...P.map((p) => p.x));
    const minY = Math.min(...P.map((p) => p.y)), maxY = Math.max(...P.map((p) => p.y));
    const k = Math.min(440 / Math.max(maxX - minX, 1e-6), 300 / Math.max(maxY - minY, 1e-6));
    const S = (p: Pt): Pt => ({ x: p.x * k, y: -p.y * k });
    const at = (name: string) => S(pos.get(name)!);
    const NORTH = 78;

    const sk = new Sketch();
    // North lines first (one per place), then the legs with a direction arrow at their middle.
    for (const name of places) arrow(sk, at(name), add(at(name), { x: 0, y: -NORTH }), "ink", 1.8, name === places[0] ? "north-line" : undefined, 11);
    for (const l of L) {
      const a = at(l.from), b = at(l.to);
      sk.line([a, b], { stroke: l.computed ? PALETTE.violet : "ink", width: 2.6, ...(l.computed ? { dash: "9 6" } : {}) });
      const u = unit(sub(b, a)), m = lerp(a, b, 0.5), n = perp(u);
      sk.polygon([add(m, mul(u, 7)), add(add(m, mul(u, -6)), mul(n, 6)), add(add(m, mul(u, -6)), mul(n, -6))], { fill: l.computed ? PALETTE.violet : "ink", stroke: "none" });
    }
    for (const name of places) sk.circle(at(name), 4.5, { fill: "ink", stroke: "ink", width: 1, ...(places.indexOf(name) < 3 ? { part: `place-${"abc"[places.indexOf(name)]}` } : {}) });

    // A bearing arc: clockwise from north (screen angle −90°) through the bearing. Every arc is drawn
    // before any value is placed, so no value lands on a later arc.
    const used = new Map<string, number>();
    const values: Array<() => void> = [];
    const bearingArc = (name: string, b: number, colour: `#${string}`, part: string): Pt => {
      const c = at(name), n = used.get(name) ?? 0;
      used.set(name, n + 1);
      const r = 36 + n * 18;
      const a0 = -Math.PI / 2, a1 = a0 + rad(b);
      if (b > 0.05) sk.path([{ k: "M", p: polar(c, r, a0) }, { k: "A", c, r, to: polar(c, r, a1), large: b > 180, sweep: true }], false, { fill: "none", stroke: colour, width: 2.2, part }, true);
      const mid = a0 + rad(b) / 2;
      values.push(() => sk.placeText(bearingText(b), 18, c, { x: Math.cos(mid), y: Math.sin(mid) }, { min: r + 12, max: r + 120, fill: colour, part, slide: { x: -Math.sin(mid), y: Math.cos(mid) } }));
      // The anchor sits a third of the way round, away from the value on the bisector.
      return polar(c, r, b > 0.05 ? a0 + rad(b) * (b > 60 ? 0.3 : 0.5) : a0);
    };
    const anchors: Record<string, Pt> = {};
    const first = L[0];
    if (first) anchors.bearing = bearingArc(first.from, first.bearing, PALETTE.blue, "bearing");
    if (first && showBack) anchors["back-bearing"] = bearingArc(first.to, backBearing(first.bearing), PALETTE.red, "back-bearing");
    for (let i = 1; i < L.length; i++) {
      const anchor = bearingArc(L[i].from, L[i].bearing, L[i].computed ? PALETTE.violet : PALETTE.green, "bearing-2");
      if (i === 1) anchors["bearing-2"] = anchor;
    }
    for (const place of values) place();

    // Distances beside each leg, then the "N" at each north line and the place letters.
    if (showDist) for (const l of L) {
      const a = at(l.from), b = at(l.to), m = lerp(a, b, 0.5);
      let n = perp(unit(sub(b, a)));
      const centre = mul(P.reduce((t, p) => add(t, S(p)), { x: 0, y: 0 }), 1 / P.length);
      if ((m.x - centre.x) * n.x + (m.y - centre.y) * n.y < 0) n = mul(n, -1);
      const text = `${fmt(l.distance, 2)} ${units}`;
      const spot = sk.findText(text, 17, m, n, { min: 8, max: 50, slide: unit(sub(b, a)) });
      const other = spot.ok ? spot : sk.findText(text, 17, m, mul(n, -1), { min: 8, max: 50, slide: unit(sub(b, a)) });
      sk.text(other.c, text, 17, l.computed ? PALETTE.violet : "ink");
    }
    for (const name of places) sk.text(add(at(name), { x: 0, y: -NORTH - 13 }), "N", 17, "ink", name === places[0] ? "north-line" : undefined);
    const letter = (name: string) => (name.length <= 2 ? name : name[0].toUpperCase());
    for (const name of places) {
      const c = at(name);
      const away = L.filter((l) => l.from === name || l.to === name).map((l) => unit(sub(at(l.from === name ? l.to : l.from), c)));
      const mean = away.reduce((t, d) => add(t, d), { x: 0, y: 0 });
      const out = Math.hypot(mean.x, mean.y) > 0.2 ? unit(mul(mean, -1)) : { x: -0.7, y: 0.7 };
      const i = places.indexOf(name);
      sk.placeLetter(letter(name), 22, c, [out, { x: out.x, y: Math.abs(out.y) + 0.5 }, { x: -0.8, y: 0.6 }, { x: 0.8, y: 0.6 }, { x: 0, y: 1 }], { part: i < 3 ? `place-${"abc"[i]}` : undefined, min: 10, max: 60 });
    }

    // Parts.
    if (places[0]) sk.part("north-line", `North line at ${letter(places[0])}`, add(at(places[0]), { x: 0, y: -NORTH * 0.85 }));
    if (first) sk.part("bearing", cap(`Bearing of ${letter(first.to)} from ${letter(first.from)}: ${bearingText(first.bearing)}`), anchors.bearing);
    if (first && showBack) sk.part("back-bearing", cap(`Back bearing (${letter(first.from)} from ${letter(first.to)}) ${bearingText(backBearing(first.bearing))}`), anchors["back-bearing"]);
    if (L[1]) sk.part("bearing-2", cap(`Bearing of ${letter(L[1].to)} from ${letter(L[1].from)}: ${bearingText(L[1].bearing)}`), anchors["bearing-2"]);
    places.slice(0, 3).forEach((name, i) => sk.part(`place-${"abc"[i]}`, name.length <= 2 ? `Place ${name}` : fitWithin("", name, ` (${letter(name)})`, 34), at(name)));
    return sk.finish(14);
  },
};
