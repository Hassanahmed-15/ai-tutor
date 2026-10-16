/**
 * Equirectangular projection: a point on the globe is (longitude, latitude) in degrees, and the
 * drawing's x/y follow that rectangle. Code, not the model, places every map mark.
 */

export type LonLat = { lon: number; lat: number };

export function clampLon(lon: number): number {
  if (!Number.isFinite(lon)) return 0;
  let x = lon;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}

export function clampLat(lat: number): number {
  if (!Number.isFinite(lat)) return 0;
  return Math.max(-90, Math.min(90, lat));
}

/** Map a lon/lat into a drawing rectangle (y grows down, north at the top). */
export function project(lon: number, lat: number, box: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
  const λ = clampLon(lon);
  const φ = clampLat(lat);
  return {
    x: box.x + ((λ + 180) / 360) * box.w,
    y: box.y + ((90 - φ) / 180) * box.h,
  };
}

export function validLonLat(lon: unknown, lat: unknown): boolean {
  return typeof lon === "number" && typeof lat === "number" && Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
}
