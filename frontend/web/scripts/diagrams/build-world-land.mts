/**
 * Builds lib/diagrams/worldLand.ts from Natural Earth's 1:110m land (public domain, via world-atlas
 * land-110m.json): every land ring as [lon, lat] pairs rounded to 0.5°, tiny islands dropped. Run once:
 *   npx tsx scripts/diagrams/build-world-land.mts
 */
import fs from "node:fs";
// @ts-expect-error topojson-client ships no types; this script runs once to build lib/diagrams/worldLand.ts
import { feature } from "topojson-client";

const topo = JSON.parse(fs.readFileSync(new URL("./land-110m.json", import.meta.url), "utf8"));
const land = feature(topo, topo.objects.land) as unknown as { features: Array<{ geometry: { type: string; coordinates: number[][][] | number[][][][] } }> };
const rings: number[][] = [];
for (const f of land.features) {
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates as number[][][]] : (f.geometry.coordinates as number[][][][]);
  for (const poly of polys) {
    const outer = poly[0];
    const flat: number[] = [];
    let px = NaN, py = NaN;
    for (const [lon, lat] of outer) {
      const x = Math.round(lon * 2) / 2, y = Math.round(lat * 2) / 2;
      if (x === px && y === py) continue;
      flat.push(x, y); px = x; py = y;
    }
    // Shoelace area in degrees²: islands under ~4 deg² are dropped (invisible at board size).
    let a = 0;
    for (let i = 0; i < flat.length; i += 2) { const j = (i + 2) % flat.length; a += flat[i] * flat[j + 1] - flat[j] * flat[i + 1]; }
    if (Math.abs(a) / 2 >= 4 && flat.length >= 8) rings.push(flat);
  }
}
const out = `/** Natural Earth 1:110m land (public domain), as [lon, lat, lon, lat, …] rings at 0.5°. Built by scripts/diagrams/build-world-land.mts. */\nexport const WORLD_LAND: number[][] = ${JSON.stringify(rings)};\n`;
fs.writeFileSync(new URL("../../lib/diagrams/worldLand.ts", import.meta.url), out);
console.log(`${rings.length} rings, ${rings.reduce((n, r) => n + r.length / 2, 0)} points, ${out.length} bytes`);
